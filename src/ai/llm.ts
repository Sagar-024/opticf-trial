import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

/**
 * LLM transport, kept behind a small interface so the orchestration loop never
 * depends on a specific SDK and the test harness can inject a mock.
 *
 * Provider: any OpenAI-compatible chat-completions endpoint (OpenCode Go).
 * Config comes only from the environment: LLM_BASE_URL, LLM_API_KEY, MODEL_NAME.
 * The key is never logged.
 */

export interface LlmToolCall {
  id: string;
  name: string;
  /** Raw JSON string of the arguments (may be malformed - callers must parse defensively). */
  arguments: string;
}

export interface LlmToolCallRaw {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: LlmToolCallRaw[];
  tool_call_id?: string;
}

export interface LlmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmChatParams {
  model: string;
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  finishReason: string | null;
}

export interface LlmClient {
  chat(params: LlmChatParams): Promise<LlmResponse>;
}

/** Error with a clear, key-free message and the HTTP status where known. */
export class LlmError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

export function classifyLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  const status = (error as { status?: number } | undefined)?.status;
  if (status === 401) return new LlmError('Authentication failed (401). Check LLM_API_KEY and LLM_BASE_URL.', status);
  if (status === 403) return new LlmError('Access forbidden (403). The key may not have access to this model.', status);
  if (status === 404) return new LlmError('Not found (404). Check LLM_BASE_URL and MODEL_NAME.', status);
  if (status === 429) return new LlmError('Rate limited (429). Try again later - no retries were attempted.', status);
  const message = error instanceof Error ? error.message : 'Unknown LLM error';
  return new LlmError(message, status);
}

export interface LlmEnv {
  baseURL: string;
  apiKey: string;
  model: string;
}

/** Read the three environment variables; throws a clear error if any is missing. */
export function readLlmEnv(): LlmEnv {
  const baseURL = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.MODEL_NAME;
  if (!baseURL) throw new LlmError('LLM_BASE_URL is not set');
  if (!apiKey) throw new LlmError('LLM_API_KEY is not set');
  if (!model) throw new LlmError('MODEL_NAME is not set');
  return { baseURL, apiKey, model };
}

/** Optional routing header, used by OpenCode Go. Not a secret. */
export const LLM_SESSION_HEADER = 'x-opencode-session';

/** Returns the session header only when LLM_SESSION is set, so other providers need no code change. */
export function llmSessionHeaders(): Record<string, string> {
  const session = process.env.LLM_SESSION;
  return session ? { [LLM_SESSION_HEADER]: session } : {};
}

/** Build the real OpenAI-compatible client from the environment. */
export function createLlmClient(): LlmClient {
  const { baseURL, apiKey } = readLlmEnv();
  const headers = llmSessionHeaders();
  const client = new OpenAI({
    apiKey,
    baseURL,
    ...(Object.keys(headers).length > 0 ? { defaultHeaders: headers } : {}),
  });

  return {
    async chat({ model, messages, tools }: LlmChatParams): Promise<LlmResponse> {
      try {
        const response = await client.chat.completions.create({
          model,
          messages: messages as unknown as ChatCompletionMessageParam[],
          tools: tools as unknown as ChatCompletionTool[],
          tool_choice: 'auto',
          max_tokens: 1400,
        });
        const choice = response.choices[0];
        const message = choice?.message;
        const toolCalls: LlmToolCall[] = (message?.tool_calls ?? [])
          .filter((call) => call.type === 'function')
          .map((call) => ({
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          }));
        return {
          text: message?.content ?? '',
          toolCalls,
          finishReason: choice?.finish_reason ?? null,
        };
      } catch (error) {
        throw classifyLlmError(error);
      }
    },
  };
}
