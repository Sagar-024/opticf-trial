import { runChatStream, type RunChatResult } from '@/ai/chat';
import { cacheKey, ResponseCache } from '@/ai/cache';
import { getDataset } from '@/ai/dataset';
import { LlmError } from '@/ai/llm';
import { logChat } from '@/ai/log';
import { callerKey, checkRateLimit } from '@/ai/rate-limit';
import { PROMPT_VERSION } from '@/ai/system-prompt';
import {
  isBodyTooLarge,
  isJsonRequest,
  sanitizeBrainOverrides,
  sanitizeContext,
  validateMessages,
} from '@/ai/validate';
import { MAX_BODY_BYTES } from '@/ai/validate';

/**
 * POST /api/chat
 *
 * Body:  { messages: {role,content}[], context?: ChatContext, brainOverrides? }
 * Reply: newline-delimited JSON events, in order:
 *   { type: 'delta',   text }        prose chunks, streamed
 *   { type: 'tool',    name, detail, items }  a tool ran, with what it found
 *   { type: 'widgets', widgets }     widget list grew
 *   { type: 'done',    text, widgets, mapHighlight, context, sources, flagged,
 *                      flagReason, withdrawn, durationMs, traceId, promptVersion,
 *                      usage, cached, trace }
 *   { type: 'error',   message, status? }
 *
 * Guards, in order: content type, body size, rate limit, message shape, context
 * and guidance whitelisting. Nothing untrusted reaches the model.
 *
 * Production notes: identical questions are served from a ten minute cache,
 * every request carries a trace id that appears on every log line, token usage
 * is logged for cost tracking, and the same text can never answer a different
 * question because the cache key includes the prompt version and the context.
 */

export const runtime = 'nodejs';
// The slowest questions run 25 to 30 seconds across several tool rounds. Vercel
// would kill a function at its default limit mid-stream, so the route declares
// its own budget. Keep this above the chat loop's total budget.
export const maxDuration = 60;

/** Ten minute cache of identical questions, so repeats cost nothing. */
const cache = new ResponseCache<RunChatResult>(10 * 60_000);

interface ChatRequestBody {
  messages?: unknown;
  context?: unknown;
  /** Untrusted Brain state from the browser: edits plus the reader's own documents. */
  brainOverrides?: unknown;
}

function jsonError(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: message, ...extra }, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.LLM_BASE_URL || !process.env.LLM_API_KEY || !process.env.MODEL_NAME) {
    return jsonError('LLM not configured. Set LLM_BASE_URL, LLM_API_KEY and MODEL_NAME in .env.local.', 500);
  }

  if (!isJsonRequest(request.headers.get('content-type'))) {
    return jsonError('Content-Type must be application/json.', 415);
  }

  if (isBodyTooLarge(request.headers.get('content-length'))) {
    return jsonError(`Request too large. Limit is ${Math.round(MAX_BODY_BYTES / 1024)} KB.`, 413);
  }

  // No auth by design for the trial, so the key is protected by a rate limit.
  const limit = checkRateLimit(callerKey(request), { limit: 20, windowMs: 60_000 });
  if (!limit.allowed) {
    logChat({ event: 'chat.error', error: 'rate limited', status: 429 });
    return Response.json(
      { error: `Too many questions in a short time. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  const validated = validateMessages(body.messages);
  if (!validated.ok) {
    return jsonError(validated.error, validated.status);
  }

  const lastUser = [...validated.messages].reverse().find((message) => message.role === 'user');
  if (!lastUser || lastUser.content.trim().length === 0) {
    return jsonError('Ask a question before sending.', 400);
  }

  const dataset = getDataset();
  const context = sanitizeContext(body.context, dataset);
  const brainOverrides = sanitizeBrainOverrides(
    body.brainOverrides,
    new Set(dataset.practices.map((practice) => practice.practiceId)),
  );
  const encoder = new TextEncoder();
  const traceId = globalThis.crypto?.randomUUID?.() ?? `t-${Date.now().toString(36)}`;

  const key = cacheKey({
    promptVersion: PROMPT_VERSION,
    messages: validated.messages,
    context,
    brainOverrides,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      const finish = (result: RunChatResult, cached: boolean) => {
        send({
          type: 'done',
          text: result.text,
          widgets: result.widgets,
          mapHighlight: result.mapHighlight,
          context: result.context,
          sources: result.sources,
          flagged: result.flagged ?? false,
          flagReason: result.flagReason ?? null,
          withdrawn: result.withdrawn ?? false,
          durationMs: result.durationMs,
          traceId,
          promptVersion: result.promptVersion,
          usage: result.usage,
          cached,
          trace: result.trace,
        });
      };

      // A repeat of the same question is served from memory.
      const hit = cache.get(key);
      if (hit) {
        logChat({
          event: 'chat.done',
          durationMs: 0,
          toolCalls: hit.toolCalls.length,
          widgets: hit.widgets.length,
          flagged: hit.flagged,
          cached: true,
          promptVersion: PROMPT_VERSION,
        });
        send({ type: 'delta', text: hit.text });
        finish(hit, true);
        controller.close();
        return;
      }

      try {
        const result = await runChatStream(
          { messages: validated.messages, context, brainOverrides, signal: request.signal, traceId },
          {
            onDelta: (text) => send({ type: 'delta', text }),
            onReasoning: (text) => send({ type: 'reasoning', text }),
            onTool: (record) =>
              send({ type: 'tool', name: record.name, malformed: Boolean(record.malformed), detail: record.detail, items: record.items }),
            onWidgets: (widgets) => send({ type: 'widgets', widgets }),
          },
        );

        // Only cache clean answers.
        if (!result.flagged) cache.set(key, result);

        finish(result, false);
      } catch (error) {
        if (error instanceof LlmError) {
          logChat({ event: 'chat.error', error: error.message, status: error.status, traceId });
          send({ type: 'error', message: error.message, status: error.status });
        } else {
          // Never leak internals; log the detail and return something usable.
          const detail = error instanceof Error ? error.message : 'unknown error';
          logChat({ event: 'chat.error', error: detail.slice(0, 120), traceId });
          send({ type: 'error', message: 'Something went wrong while answering. Please try again.' });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
      'X-RateLimit-Remaining': String(limit.remaining),
    },
  });
}
