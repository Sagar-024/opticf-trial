import { runChatStream } from '@/ai/chat';
import { getDataset } from '@/ai/dataset';
import { LlmError } from '@/ai/llm';
import { sanitizeContext, validateMessages } from '@/ai/validate';

/**
 * POST /api/chat
 *
 * Body:  { messages: {role,content}[], context?: ChatContext }
 * Reply: newline-delimited JSON events, in order:
 *   { type: 'delta',   text }        prose chunks, streamed
 *   { type: 'tool',    name }        a tool ran
 *   { type: 'widgets', widgets }     widget list grew
 *   { type: 'done',    text, widgets, mapHighlight, context, sources, flagged }
 *   { type: 'error',   message, status? }
 *
 * Both messages and context are validated before anything reaches the model.
 * Provider config is server-only: LLM_BASE_URL, LLM_API_KEY, MODEL_NAME.
 */

export const runtime = 'nodejs';

interface ChatRequestBody {
  messages?: unknown;
  context?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.LLM_BASE_URL || !process.env.LLM_API_KEY || !process.env.MODEL_NAME) {
    return Response.json(
      { error: 'LLM not configured. Set LLM_BASE_URL, LLM_API_KEY and MODEL_NAME in .env.local.' },
      { status: 500 },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const validated = validateMessages(body.messages);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: validated.status });
  }

  const context = sanitizeContext(body.context, getDataset());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const result = await runChatStream(
          { messages: validated.messages, context },
          {
            onDelta: (text) => send({ type: 'delta', text }),
            onTool: (record) => send({ type: 'tool', name: record.name, malformed: Boolean(record.malformed) }),
            onWidgets: (widgets) => send({ type: 'widgets', widgets }),
          },
        );

        send({
          type: 'done',
          text: result.text,
          widgets: result.widgets,
          mapHighlight: result.mapHighlight,
          context: result.context,
          sources: result.sources,
          flagged: result.flagged ?? false,
          durationMs: result.durationMs,
        });
      } catch (error) {
        const message = error instanceof LlmError ? error.message : 'Chat request failed.';
        const status = error instanceof LlmError ? error.status : undefined;
        send({ type: 'error', message, status });
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
    },
  });
}
