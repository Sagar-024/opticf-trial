import { runChat } from '@/ai/chat';
import { LlmError } from '@/ai/llm';
import type { ChatContext, ChatMessage } from '@/ai/types';

/**
 * POST /api/chat
 *
 * Body:  { messages: {role,content}[], context?: ChatContext }
 * Reply: { text, widgets[], mapHighlight: string[], context, flagged }
 *
 * Provider config is server-only, from .env.local:
 *   LLM_BASE_URL, LLM_API_KEY, MODEL_NAME
 */

export const runtime = 'nodejs';

interface ChatRequestBody {
  messages?: ChatMessage[];
  context?: ChatContext | null;
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

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: 'messages[] is required.' }, { status: 400 });
  }

  try {
    const result = await runChat({ messages: body.messages, context: body.context ?? null });
    return Response.json({
      text: result.text,
      widgets: result.widgets,
      mapHighlight: result.mapHighlight,
      context: result.context,
      flagged: result.flagged ?? false,
    });
  } catch (error) {
    if (error instanceof LlmError) {
      // Clear, key-free message; the client decides whether to surface it.
      return Response.json({ error: error.message }, { status: error.status ?? 502 });
    }
    const message = error instanceof Error ? error.message : 'Chat request failed.';
    return Response.json({ error: message }, { status: 500 });
  }
}
