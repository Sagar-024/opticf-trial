import { answerFromBrain, BRAIN_ASK_PROMPT_VERSION } from '@/brain/ask';
import type { BrainAskEvent, BrainAskResult } from '@/brain/ask';
import type { AskHistoryTurn, PracticeRef } from '@/brain/retrieve';
import { cacheKey, ResponseCache } from '@/ai/cache';
import { getDataset } from '@/ai/dataset';
import { LlmError } from '@/ai/llm';
import { logChat } from '@/ai/log';
import { callerKey, checkRateLimit } from '@/ai/rate-limit';
import { isBodyTooLarge, isJsonRequest, sanitizeBrainOverrides, validateMessages } from '@/ai/validate';
import { MAX_BODY_BYTES } from '@/ai/validate';
import { mergeBrainDocuments } from '@/content/brain';
import { practiceDisplayName } from '@/data/index';

/**
 * POST /api/brain/ask
 *
 * Body:  { question: string, history?: {role,content}[], brainOverrides? }
 * Reply: newline-delimited JSON events, in order:
 *   { type: 'meta',  docs, practiceIds, truncated }   document chips, always first
 *   { type: 'delta', text }                           prose chunks, streamed
 *   { type: 'done',  text, citations, docs, flagged, flagReason, withdrawn,
 *                    durationMs, traceId, promptVersion, usage, cached }
 *   { type: 'error', message, status? }
 *
 * Guards, in order: content type, body size, its own rate limit, question and
 * history shape, then guidance whitelisting. Nothing untrusted reaches the
 * model: overrides are sanitised against the dataset and documents only ever
 * appear as quoted data inside the built messages.
 *
 * The ask bucket (`caller:brain`, 12/min) is deliberately separate from the
 * chat's, so asking the Brain can never starve the main chat, and repeats of
 * the same question are served from a ten minute cache keyed on the prompt
 * version, the question, the history and the sanitised overrides.
 */

export const runtime = 'nodejs';
// One grounded generation, no tool loop: half the chat's budget is plenty.
export const maxDuration = 60;

/** Ten minute cache of identical asks, so repeats cost nothing. */
const cache = new ResponseCache<BrainAskResult>(10 * 60_000);

interface BrainAskRequestBody {
  question?: unknown;
  history?: unknown;
  /** Untrusted Brain state from the browser: edits plus the reader's own documents. */
  brainOverrides?: unknown;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

function metaEvent(result: BrainAskResult): BrainAskEvent {
  return {
    type: 'meta',
    docs: result.docs,
    practiceIds: result.retrieval.practiceIds,
    truncated: result.retrieval.truncated,
  };
}

function doneEvent(result: BrainAskResult, traceId: string, cached: boolean): BrainAskEvent {
  return {
    type: 'done',
    text: result.text,
    citations: result.citations,
    docs: result.docs,
    flagged: result.flagged,
    flagReason: result.flagReason,
    withdrawn: result.withdrawn,
    durationMs: result.durationMs,
    traceId,
    promptVersion: result.promptVersion,
    usage: result.usage,
    cached,
  };
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

  // The ask surface gets its own bucket, so it can never trample the chat.
  const limit = checkRateLimit(`${callerKey(request)}:brain`, { limit: 12, windowMs: 60_000 });
  if (!limit.allowed) {
    logChat({ event: 'chat.error', error: 'rate limited', status: 429 });
    return Response.json(
      { error: `Too many questions in a short time. Try again in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  let body: BrainAskRequestBody;
  try {
    body = (await request.json()) as BrainAskRequestBody;
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  if (body.history !== undefined && !Array.isArray(body.history)) {
    return jsonError('history must be an array of messages.', 400);
  }
  const history = Array.isArray(body.history) ? body.history : [];
  if (history.length > 6) {
    return jsonError('history must contain at most 6 messages.', 400);
  }
  if (typeof body.question !== 'string' || body.question.trim().length === 0) {
    return jsonError('Ask a question before sending.', 400);
  }
  const question = body.question.trim();

  // The history and the question go through the chat's own validator, built as
  // the full message array so its caps (length, count, content size) all apply.
  const validated = validateMessages([...history, { role: 'user', content: question }]);
  if (!validated.ok) {
    return jsonError(validated.error, validated.status);
  }
  const validatedHistory = validated.messages.slice(0, -1) as AskHistoryTurn[];

  const dataset = getDataset();
  const practices: PracticeRef[] = dataset.practices.map((practice) => ({
    id: practice.practiceId,
    name: practiceDisplayName(dataset, practice.practiceId),
  }));
  const brainOverrides = sanitizeBrainOverrides(
    body.brainOverrides,
    new Set(dataset.practices.map((practice) => practice.practiceId)),
  );
  const documents = mergeBrainDocuments(brainOverrides);

  const encoder = new TextEncoder();
  const traceId = globalThis.crypto?.randomUUID?.() ?? `t-${Date.now().toString(36)}`;

  const key = cacheKey({
    promptVersion: BRAIN_ASK_PROMPT_VERSION,
    messages: validated.messages,
    context: null,
    brainOverrides,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: BrainAskEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      // A repeat of the same question is served from memory.
      const hit = cache.get(key);
      if (hit) {
        logChat({
          event: 'chat.done',
          durationMs: 0,
          toolCalls: 0,
          docs: hit.docs.length,
          citations: hit.citations.length,
          truncated: hit.retrieval.truncated,
          flagged: hit.flagged,
          cached: true,
          promptVersion: BRAIN_ASK_PROMPT_VERSION,
          inputTokens: hit.usage.inputTokens,
          outputTokens: hit.usage.outputTokens,
          ...(hit.usage.estimatedCostUsd !== undefined ? { estimatedCostUsd: hit.usage.estimatedCostUsd } : {}),
          traceId,
        });
        send(metaEvent(hit));
        send({ type: 'delta', text: hit.text });
        send(doneEvent(hit, traceId, true));
        controller.close();
        return;
      }

      try {
        const result = await answerFromBrain(
          {
            question,
            history: validatedHistory,
            documents,
            practices,
            signal: request.signal,
            traceId,
          },
          {
            onMeta: (docs, retrieval) =>
              send({ type: 'meta', docs, practiceIds: retrieval.practiceIds, truncated: retrieval.truncated }),
            onDelta: (text) => send({ type: 'delta', text }),
          },
        );

        // Only cache clean answers.
        if (!result.flagged) cache.set(key, result);

        send(doneEvent(result, traceId, false));
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
