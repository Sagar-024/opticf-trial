import { monthsOf } from '../data/index';
import { monthLabel } from '../lib/months';
import { getDataset } from './dataset';
import { buildSystemPrompt } from './system-prompt';
import { getTool, llmToolDefinitions, type ToolContext } from './tools';
import { sanitizeToolInput } from './validate';
import { mergeBrainDocuments } from '../content/brain';
import { allowedSet, findUnsupportedNumbers } from './guard';
import { extractLeakedToolCalls, MarkupStreamFilter, stripModelMarkup } from './markup';
import { validateWidgets } from './widgets';
import { checkOutput, flagReasonFrom, looksLikeDataQuestion, redactSecrets } from './output-guard';
import { addUsage, estimateCost, Trace, type TokenUsage, type TraceSpan } from './trace';
import { PROMPT_VERSION } from './system-prompt';
import { logChat } from './log';
import {
  createLlmClient,
  type LlmClient,
  type LlmMessage,
  type LlmToolCallRaw,
  type LlmToolDefinition,
} from './llm';
import type { ChatContext, ChatMessage, ChatResponse, ToolCallRecord, ToolOutput, Widget } from './types';

/**
 * The chat orchestration loop (provider-agnostic).
 *
 * - Capped at MAX_TOOL_ITERATIONS tool-call rounds, and MAX_TOOL_CALLS in total.
 * - A single round may request several tools in parallel.
 * - Follow-up refinements reuse the previous context and are gated to a small
 *   tool set so they do not re-run discovery.
 * - The final prose is streamed as it arrives.
 * - The final text is guarded: every number must come from tool output.
 */

export interface RunChatInput {
  messages: ChatMessage[];
  context?: ChatContext | null;
  client?: LlmClient;
  model?: string;
  /** Local guidance edits from the Brain tab, applied over the shipped documents. */
  brainOverrides?: Record<string, { content?: string; owner?: string; conflict?: boolean }>;
  /** Client abort signal, so Stop also cancels the provider request. */
  signal?: AbortSignal;
  /** Correlates every log line for one request. */
  traceId?: string;
}

export interface RunChatHandlers {
  /** Prose chunks, streamed as the model writes them. */
  onDelta?: (text: string) => void;
  /** Fired after each tool has run. */
  onTool?: (record: ToolCallRecord) => void;
  /** Fired with the full widget list whenever it grows. */
  onWidgets?: (widgets: Widget[]) => void;
}

export interface RunChatResult extends ChatResponse {
  toolCalls: ToolCallRecord[];
  durationMs: number;
  iterations: number;
  /** True when the question hit the total time budget. */
  budgetExceeded: boolean;
  /** Per step timings for observability. */
  trace: TraceSpan[];
  /** Tokens used, and cost when prices are configured. */
  usage: TokenUsage;
  /** Version of the instructions that produced this answer. */
  promptVersion: string;
}

const MAX_TOOL_ITERATIONS = 6;
const MAX_TOOL_CALLS = 8;

/** Total wall-clock budget for one question, so a serverless call cannot hang. */
function totalBudgetMs(): number {
  const raw = Number(process.env.LLM_TOTAL_BUDGET_MS ?? 100_000);
  return Number.isFinite(raw) && raw > 5_000 ? raw : 100_000;
}

function emptyContext(): ChatContext {
  return { filters: {}, period: {}, practiceIds: [] };
}

function mergeContext(current: ChatContext, patch: Partial<ChatContext>): ChatContext {
  return {
    metric: patch.metric ?? current.metric,
    group_by: patch.group_by ?? current.group_by,
    filters: {
      regions: patch.filters?.regions ?? current.filters.regions,
      practiceIds: patch.filters?.practiceIds ?? current.filters.practiceIds,
    },
    period: { ...current.period, ...patch.period },
    practiceIds: patch.practiceIds && patch.practiceIds.length > 0 ? patch.practiceIds : current.practiceIds,
  };
}

function dedupeWidgets(widgets: Widget[]): Widget[] {
  const seen = new Set<string>();
  const out: Widget[] = [];
  for (const widget of widgets) {
    if (seen.has(widget.id)) continue;
    seen.add(widget.id);
    out.push(widget);
  }
  return out;
}

/**
 * House style plus markup scrubbing. Model prose may not contain em or en
 * dashes, and a gateway that leaks the model's raw tool call markup as text
 * must never reach the user.
 */
function sanitize(text: string): string {
  const clean = stripModelMarkup(text).text;
  return clean.split('\u2014').join('-').split('\u2013').join('-');
}

function parseArgs(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const value = raw && raw.trim() ? JSON.parse(raw) : {};
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ok: true, value: value as Record<string, unknown> };
    }
    return { ok: true, value: {} };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid JSON' };
  }
}

function isRefinement(message: string): boolean {
  return /\b(only|just|filter|narrow|those|them|that|break\b.*\bdown|by practice|by region|drill|on the map|map)\b/i.test(message);
}

/**
 * Questions about the product itself, not the group's data: "is this
 * hardcoded", "where do these numbers come from", "how does this work".
 *
 * These are answered in prose, so the request is given no tools at all. The
 * model cannot re-run a tool to prove a point, and a question that is not
 * about the data can never re-emit a widget from the previous turn. Patterns
 * are kept narrow on purpose: a data question must never lose its tools.
 */
const PRODUCT_QUESTION_PATTERNS: RegExp[] = [
  /\bhard[- ]?coded\b/i,
  /\bis (this|it|that) live\b/i,
  /\bwhere (do|does) (the|these|those|your|its) (numbers|figures|data|values)\b/i,
  /\b(are|is) (these|this|those)( numbers| figures| values| data)? (real|fake|mock|made ?up|invented)\b/i,
  /\bhow does (this|the app|the product|optific) work\b/i,
  /\bwhat model\b/i,
  /\bwhich (ai|model)\b/i,
  /\bare you (an? )?(ai|bot|human|robot)\b/i,
];

export function isProductQuestion(message: string): boolean {
  return PRODUCT_QUESTION_PATTERNS.some((pattern) => pattern.test(message));
}

/** Restrict the tool list for refuements so discovery tools cannot re-run. */
function gateTools(message: string, context: ChatContext | null): LlmToolDefinition[] {
  const all = llmToolDefinitions();
  if (!context || !isRefinement(message)) return all;
  const q = message.toLowerCase();
  let allow: string[] | null = null;
  if (/\bmap\b/.test(q)) allow = ['highlight_on_map'];
  else if (/break\b.*\bdown|by practice|by region|drill/.test(q)) allow = ['query_metrics', 'build_dashboard', 'compare'];
  else if (/\b(only|just|filter|narrow)\b/.test(q)) allow = ['query_metrics', 'build_dashboard', 'compare', 'below_cl_target', 'training_status'];
  if (!allow) return all;
  const filtered = all.filter((tool) => allow!.includes(tool.function.name));
  return filtered.length > 0 ? filtered : all;
}

export async function runChatStream(input: RunChatInput, handlers: RunChatHandlers = {}): Promise<RunChatResult> {
  const started = Date.now();
  const dataset = getDataset();
  const months = monthsOf(dataset);
  const latest = months[months.length - 1];
  const client: LlmClient = input.client ?? createLlmClient();
  const model = input.model ?? (input.client ? 'mock' : process.env.MODEL_NAME);
  if (!model) throw new Error('MODEL_NAME is not set');

  const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
  logChat({ event: 'chat.start', ...(input.traceId !== undefined ? { traceId: input.traceId } : {}) }, lastUser?.content);
  const question = lastUser?.content ?? '';
  const system = buildSystemPrompt(latest, input.context ?? null, months[0]);
  const toolContext: ToolContext = {
    brainDocuments: mergeBrainDocuments(input.brainOverrides ?? {}),
  };
  const messages: LlmMessage[] = [
    { role: 'system', content: system },
    ...input.messages.map((m) => ({ role: m.role, content: m.content }) as LlmMessage),
  ];

  const outputs: ToolOutput[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const memo = new Map<string, ToolOutput>();
  const trace = new Trace();
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let context: ChatContext = input.context ?? emptyContext();
  let explicitHighlight: string[] | null = null;
  let largestHighlight: string[] = [];
  let text = '';
  let executed = 0;
  let iterations = 0;
  let budgetExceeded = false;
  let salvagedCalls = 0;
  let markupEvents = 0;
  // A question about the product itself is answered in prose, so it gets no
  // tools at all: the model cannot re-run a comparison to demonstrate
  // anything, and no widget is re-emitted for a question that is not about
  // the data. Everything else keeps the usual (possibly gated) tool set.
  const productQuestion = isProductQuestion(question);
  const tools = productQuestion ? [] : gateTools(question, input.context ?? null);

  const emitWidgets = () => handlers.onWidgets?.(dedupeWidgets(outputs.flatMap((output) => output.widgets)));

  for (let step = 0; step < MAX_TOOL_ITERATIONS; step += 1) {
    iterations = step + 1;

    // Stop if the whole question has run past its budget, and answer with what
    // the tools have already returned rather than hanging the request.
    if (Date.now() - started > totalBudgetMs()) {
      const final = await client.chat({ model, messages, tools: [], signal: input.signal }).catch(() => null);
      text = text || final?.text || 'Stopped: this question took longer than the budget allows. The figures already returned come from the loaded data.';
      budgetExceeded = true;
      break;
    }

    const streamFilter = new MarkupStreamFilter();
    const response = await trace.measure(`model.round${step + 1}`, () =>
      client.stream({ model, messages, tools, signal: input.signal }, (delta) => {
        text += delta;
        const clean = streamFilter.push(delta);
        if (clean) handlers.onDelta?.(clean);
      }),
    );
    const streamTail = streamFilter.flush();
    if (streamTail) handlers.onDelta?.(streamTail);
    if (streamFilter.stripped) markupEvents += 1;
    usage = addUsage(usage, response.usage);

    // A gateway sometimes returns the model's tool call markup as plain text
    // instead of a structured call. Recover the call so the question still gets
    // answered, rather than showing the user raw markup.
    let calls = response.toolCalls;
    if (calls.length === 0) {
      const known = new Set(tools.map((definition) => definition.function.name));
      const salvaged = extractLeakedToolCalls(response.text, known);
      if (salvaged.length > 0) {
        calls = salvaged;
        salvagedCalls += salvaged.length;
        markupEvents += 1;
      }
    }

    if (calls.length === 0) {
      if (!text) text = response.text;
      break;
    }

    const rawCalls: LlmToolCallRaw[] = calls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
    // Never feed leaked markup back to the model as if it were prose.
    messages.push({
      role: 'assistant',
      content: calls === response.toolCalls ? response.text || null : null,
      tool_calls: rawCalls,
    });

    for (const call of calls) {
      const parsed = parseArgs(call.arguments);
      let output: ToolOutput;
      let record: ToolCallRecord;

      if (executed >= MAX_TOOL_CALLS) {
        output = { summary: 'Tool call limit reached; answer using the results already returned.', widgets: [], numbers: [] };
        record = { name: call.name, input: call.arguments, widgetTypes: [], mapHighlight: [] };
      } else if (!parsed.ok) {
        output = { summary: `Tool ${call.name} was called with malformed arguments; nothing was run.`, widgets: [], numbers: [] };
        record = { name: call.name, input: call.arguments, widgetTypes: [], mapHighlight: [], malformed: true, error: parsed.error };
        executed += 1;
      } else {
        const memoKey = `${call.name}:${call.arguments}`;
        const cached = memo.get(memoKey);
        if (cached) {
          output = cached;
        } else {
          const tool = getTool(call.name);
          // Model supplied arguments are untrusted: clamp and whitelist first.
          const safeInput = sanitizeToolInput(parsed.value);
          const toolStarted = Date.now();
          output = tool
            ? tool.run(dataset, safeInput, toolContext)
            : { summary: `Unknown tool ${call.name}.`, widgets: [], numbers: [] };
          trace.span(`tool.${call.name}`, Date.now() - toolStarted);
          memo.set(memoKey, output);
        }
        record = {
          name: call.name,
          input: parsed.value,
          widgetTypes: output.widgets.map((w) => w.type),
          mapHighlight: output.mapHighlight ?? [],
        };
        executed += 1;
      }

      outputs.push(output);
      if (output.mapHighlight && output.mapHighlight.length > 0) {
        if (call.name === 'highlight_on_map') explicitHighlight = output.mapHighlight;
        if (output.mapHighlight.length > largestHighlight.length) largestHighlight = output.mapHighlight;
      }
      if (output.context) context = mergeContext(context, output.context);
      toolCalls.push(record);
      handlers.onTool?.(record);
      emitWidgets();

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({
          summary: output.summary,
          mapHighlight: output.mapHighlight ?? [],
          widgets: output.widgets.map((w) => ({ type: w.type, id: w.id, title: w.title })),
        }),
      });
    }

    if (executed >= MAX_TOOL_CALLS) {
      const final = await client.chat({ model, messages, tools: [] });
      text = text || final.text;
      break;
    }
  }

  if (!text) {
    const final = await client.chat({ model, messages, tools: [], signal: input.signal });
    text = final.text;
  }

  // ── Guarding ───────────────────────────────────────────────────────────────
  // Order matters: grounding first (it may add tool results), then the numbers
  // check against everything the tools returned, then the output checks.

  // A data question answered with no tool call at all is not grounded. Give the
  // model one chance to go and look before telling the user to be careful.
  // Product questions are exempt: they carry no tools by design, so they can
  // never be flagged for answering without one.
  const requiresGrounding = !productQuestion && looksLikeDataQuestion(question, dataset);
  if (requiresGrounding && outputs.length === 0) {
    messages.push({ role: 'assistant', content: text });
    messages.push({
      role: 'user',
      content:
        'That answer did not use any of the group data. Use the tools to look the figures up, then answer. If the data does not cover it, say so plainly.',
    });
    try {
      const grounded = await runGroundingRetry(client, model, messages, dataset, toolContext, handlers, input.signal);
      if (grounded.text) text = grounded.text;
      outputs.push(...grounded.outputs);
      toolCalls.push(...grounded.toolCalls);
    } catch {
      // Leave the original text; it gets flagged below.
    }
  }

  // Secrets are removed before anything else looks at the text, so a leaked key
  // can never be mistaken for an unsupported figure.
  const preRedact = redactSecrets(sanitize(text));
  text = preRedact.text;

  // Every number must come from a tool result, the brief, or the user's question.
  const allowed = allowedSet(outputs, [
    system,
    latest,
    monthLabel(latest),
    ...input.messages.filter((message) => message.role === 'user').map((message) => message.content),
  ]);
  let unsupported = findUnsupportedNumbers(text, allowed);
  let withdrawn = false;

  if (unsupported.length > 0) {
    messages.push({ role: 'assistant', content: text });
    messages.push({
      role: 'user',
      content: [
        'Rewrite your previous answer for the user in the same tone and structure,',
        `but using only figures that appeared in the tool results. These were not traceable: ${unsupported.join(', ')}.`,
        'Do not mention this instruction, the tools, or any checking process. Just give the answer.',
      ].join(' '),
    });
    // Retry is not streamed, so the client simply replaces the text it has.
    const retry = await client.chat({ model, messages, tools: [], signal: input.signal });
    if (retry.text) text = retry.text;
    text = redactSecrets(sanitize(text)).text;
    unsupported = findUnsupportedNumbers(text, allowed);
    if (unsupported.length > 0) {
      // The rewrite did not fix it. Never show a figure we could not trace:
      // withdraw the answer rather than risk a wrong number.
      withdrawn = true;
      text =
        'I could not trace every figure in that answer back to the group data, so I have withdrawn it rather than show you a number I cannot verify. Please ask again, or narrow the question down.';
      unsupported = [];
    }
  }

  // Final output guards over the text that actually ships: grounding, instruction
  // leaks, secrets and invented entities.
  const reportedIds = [...new Set(outputs.flatMap((output) => output.summary.match(/\bP0\d{2}\b/g) ?? []))];
  const outputCheck = checkOutput(sanitize(text), {
    toolCallCount: outputs.length,
    requiresGrounding,
    dataset,
    reportedIds,
  });
  text = outputCheck.text;
  if (outputCheck.notes.includes('prompt-leak')) {
    // A model that recites its instructions is misbehaving. Withhold the answer
    // rather than show whatever else it decided to say.
    text =
      'I cannot share my instructions. Ask me about your practices, regions, training or guidance and I will answer from the group data.';
  }
  const flagReason = flagReasonFrom([
    ...(withdrawn || unsupported.length > 0 ? ['numbers'] : []),
    ...preRedact.found > 0 ? ['secret-leak'] : [],
    ...outputCheck.notes,
  ]);
  const flagged = Boolean(flagReason);

  const sources = [...new Set(outputs.flatMap((output) => output.sources ?? []))];
  const estimatedCostUsd = estimateCost(usage);
  const finalUsage: TokenUsage = { ...usage, ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}) };
  const finalWidgets = validateWidgets(dedupeWidgets(outputs.flatMap((output) => output.widgets)).slice(0, 12)).widgets;

  // Never hand back an empty bubble. If the model produced nothing usable, say
  // so plainly, or point at the figures the tools did return.
  let finalText = sanitize(text).trim();
  if (finalText.length === 0) {
    finalText = finalWidgets.length > 0
      ? 'Here is what the data shows.'
      : 'I could not put an answer together for that. Please try asking again, or rephrase the question.';
  }

  logChat({
    event: 'chat.done',
    durationMs: Date.now() - started,
    iterations,
    toolCalls: toolCalls.length,
    widgets: finalWidgets.length,
    flagged,
    budgetExceeded,
    promptVersion: PROMPT_VERSION,
    inputTokens: finalUsage.inputTokens,
    outputTokens: finalUsage.outputTokens,
    ...(finalUsage.estimatedCostUsd !== undefined ? { estimatedCostUsd: finalUsage.estimatedCostUsd } : {}),
    ...(markupEvents > 0 ? { markupEvents } : {}),
    ...(salvagedCalls > 0 ? { salvagedToolCalls: salvagedCalls } : {}),
    trace: trace.summary().map((span) => `${span.name}:${span.ms}ms`).join(','),
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
  });

  return {
    text: finalText,
    widgets: finalWidgets,
    mapHighlight: explicitHighlight ?? largestHighlight,
    context,
    sources,
    flagged,
    flagReason,
    withdrawn,
    toolCalls,
    durationMs: Date.now() - started,
    iterations,
    budgetExceeded,
    trace: trace.summary(),
    usage: finalUsage,
    promptVersion: PROMPT_VERSION,
  };
}

/** Non-streaming convenience wrapper (used by tests and scripts). */
export async function runChat(input: RunChatInput): Promise<RunChatResult> {
  return runChatStream(input, {});
}

/**
 * One short tool loop used when a data question came back with no tool calls.
 * Same execution path as the main loop, but bounded to three rounds.
 */
async function runGroundingRetry(
  client: LlmClient,
  model: string,
  messages: LlmMessage[],
  dataset: ReturnType<typeof getDataset>,
  toolContext: ToolContext,
  handlers: RunChatHandlers,
  signal?: AbortSignal,
): Promise<{ text: string; outputs: ToolOutput[]; toolCalls: ToolCallRecord[] }> {
  const outputs: ToolOutput[] = [];
  const toolCalls: ToolCallRecord[] = [];
  let text = '';

  for (let step = 0; step < 3; step += 1) {
    const streamFilter = new MarkupStreamFilter();
    const response = await client.stream({ model, messages, tools: llmToolDefinitions(), signal }, (delta) => {
      text += delta;
      const clean = streamFilter.push(delta);
      if (clean) handlers.onDelta?.(clean);
    });
    const streamTail = streamFilter.flush();
    if (streamTail) handlers.onDelta?.(streamTail);

    // Same leaked markup recovery as the main loop.
    let calls = response.toolCalls;
    if (calls.length === 0) {
      const known = new Set(llmToolDefinitions().map((definition) => definition.function.name));
      const salvaged = extractLeakedToolCalls(response.text, known);
      if (salvaged.length > 0) calls = salvaged;
    }

    if (calls.length === 0) {
      if (!text) text = response.text;
      break;
    }

    messages.push({
      role: 'assistant',
      content: calls === response.toolCalls ? response.text || null : null,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    for (const call of calls) {
      const parsed = parseArgs(call.arguments);
      const tool = getTool(call.name);
      const output: ToolOutput = parsed.ok && tool
        ? tool.run(dataset, sanitizeToolInput(parsed.value), toolContext)
        : { summary: `Tool ${call.name} could not be run.`, widgets: [], numbers: [] };

      outputs.push(output);
      toolCalls.push({
        name: call.name,
        input: parsed.ok ? parsed.value : call.arguments,
        widgetTypes: output.widgets.map((widget) => widget.type),
        mapHighlight: output.mapHighlight ?? [],
      });
      handlers.onTool?.(toolCalls[toolCalls.length - 1]);
      handlers.onWidgets?.(dedupeWidgets(outputs.flatMap((entry) => entry.widgets)));

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({
          summary: output.summary,
          mapHighlight: output.mapHighlight ?? [],
          widgets: output.widgets.map((widget) => ({ type: widget.type, id: widget.id, title: widget.title })),
        }),
      });
    }
  }

  return { text, outputs, toolCalls };
}
