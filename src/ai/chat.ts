import { monthsOf } from '../data/index';
import { monthLabel } from '../lib/months';
import { getDataset } from './dataset';
import { buildSystemPrompt } from './system-prompt';
import { getTool, llmToolDefinitions, type ToolContext } from './tools';
import { sanitizeToolInput } from './validate';
import { mergeBrainDocuments } from '../content/brain';
import { allowedSet, findUnsupportedNumbers } from './guard';
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

/** Strip em/en dashes from model prose (house style). */
function sanitize(text: string): string {
  return text.split('\u2014').join('-').split('\u2013').join('-');
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
  logChat({ event: 'chat.start' }, lastUser?.content);
  const system = buildSystemPrompt(latest, input.context ?? null);
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
  let context: ChatContext = input.context ?? emptyContext();
  let explicitHighlight: string[] | null = null;
  let largestHighlight: string[] = [];
  let text = '';
  let executed = 0;
  let iterations = 0;
  let budgetExceeded = false;
  const tools = gateTools(lastUser?.content ?? '', input.context ?? null);

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

    const response = await client.stream({ model, messages, tools, signal: input.signal }, (delta) => {
      text += delta;
      handlers.onDelta?.(delta);
    });

    if (response.toolCalls.length === 0) {
      if (!text) text = response.text;
      break;
    }

    const rawCalls: LlmToolCallRaw[] = response.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
    messages.push({ role: 'assistant', content: response.text || null, tool_calls: rawCalls });

    for (const call of response.toolCalls) {
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
          output = tool
            ? tool.run(dataset, safeInput, toolContext)
            : { summary: `Unknown tool ${call.name}.`, widgets: [], numbers: [] };
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

  // Guard: every number in the prose must have come from a tool result, from the
  // brief, or from the question the user asked (they may quote their own numbers).
  const allowed = allowedSet(outputs, [
    system,
    latest,
    monthLabel(latest),
    ...input.messages.filter((message) => message.role === 'user').map((message) => message.content),
  ]);
  let unsupported = findUnsupportedNumbers(text, allowed);
  let flagged = false;

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
    unsupported = findUnsupportedNumbers(text, allowed);
    flagged = unsupported.length > 0;
  }

  const sources = [...new Set(outputs.flatMap((output) => output.sources ?? []))];

  logChat({
    event: 'chat.done',
    durationMs: Date.now() - started,
    iterations,
    toolCalls: toolCalls.length,
    widgets: outputs.flatMap((output) => output.widgets).length,
    flagged,
    budgetExceeded,
  });

  return {
    text: sanitize(text),
    widgets: dedupeWidgets(outputs.flatMap((output) => output.widgets)).slice(0, 12),
    mapHighlight: explicitHighlight ?? largestHighlight,
    context,
    sources,
    flagged,
    toolCalls,
    durationMs: Date.now() - started,
    iterations,
    budgetExceeded,
  };
}

/** Non-streaming convenience wrapper (used by tests and scripts). */
export async function runChat(input: RunChatInput): Promise<RunChatResult> {
  return runChatStream(input, {});
}
