import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';

/**
 * LLM transport behind a small interface, so the orchestration loop never
 * depends on a specific SDK and tests can inject a mock.
 *
 * Provider: any OpenAI-compatible chat-completions endpoint.
 * Config from env only: LLM_BASE_URL, LLM_API_KEY, MODEL_NAME, and optionally
 * LLM_SESSION (routing header) and LLM_TIMEOUT_MS (per-call timeout).
 * The key is never logged.
 */

export interface LlmToolCall {
  id: string;
  name: string;
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
  /** Caller signal, so a client abort also cancels the provider request. */
  signal?: AbortSignal;
}

export interface LlmResponse {
  text: string;
  toolCalls: LlmToolCall[];
  finishReason: string | null;
  /** Token usage when the provider reports it, for cost accounting. */
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LlmClient {
  /** Non-streaming completion. */
  chat(params: LlmChatParams): Promise<LlmResponse>;
  /** Streaming completion; `onDelta` receives prose chunks as they arrive. */
  stream(params: LlmChatParams, onDelta: (text: string) => void): Promise<LlmResponse>;
}

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
  const name = (error as { name?: string } | undefined)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new LlmError('The model took too long to respond and was stopped.');
  }
  const status = (error as { status?: number } | undefined)?.status;
  if (status === 401) return new LlmError('Authentication failed (401). Check LLM_API_KEY and LLM_BASE_URL.', status);
  if (status === 403) return new LlmError('Access forbidden (403). The key may not have access to this model.', status);
  if (status === 404) return new LlmError('Not found (404). Check LLM_BASE_URL and MODEL_NAME.', status);
  if (status === 429) return new LlmError('Rate limited (429). Try again later. No retries were attempted.', status);
  const message = error instanceof Error ? error.message : 'Unknown LLM error';
  return new LlmError(message, status);
}

export interface LlmEnv {
  baseURL: string;
  apiKey: string;
  model: string;
}

export function readLlmEnv(): LlmEnv {
  const baseURL = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.MODEL_NAME;
  if (!baseURL) throw new LlmError('LLM_BASE_URL is not set');
  if (!apiKey) throw new LlmError('LLM_API_KEY is not set');
  if (!model) throw new LlmError('MODEL_NAME is not set');
  return { baseURL, apiKey, model };
}

/** Optional routing header (OpenCode Go). Not a secret, omitted when unset. */
export const LLM_SESSION_HEADER = 'x-opencode-session';
export function llmSessionHeaders(): Record<string, string> {
  const session = process.env.LLM_SESSION;
  return session ? { [LLM_SESSION_HEADER]: session } : {};
}

function timeoutMs(): number {
  const raw = Number(process.env.LLM_TIMEOUT_MS ?? 45000);
  return Number.isFinite(raw) && raw > 1000 ? raw : 45000;
}

/**
 * One bounded retry for transient failures only.
 *
 * Production clients retry 5xx and network errors with backoff and jitter, and
 * never retry 4xx: a bad key or a rate limit will fail again immediately. We do
 * exactly one retry, with jitter, so a blip does not surface to the user.
 */
async function withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const status = (error as { status?: number } | undefined)?.status;
    const retryable = status === undefined || status >= 500;
    if (!retryable) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 250));
    return operation();
  }
}

function usageOf(usage: unknown): { inputTokens: number; outputTokens: number } | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const record = usage as { prompt_tokens?: number; completion_tokens?: number };
  if (typeof record.prompt_tokens !== 'number' && typeof record.completion_tokens !== 'number') return undefined;
  return { inputTokens: record.prompt_tokens ?? 0, outputTokens: record.completion_tokens ?? 0 };
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

  // A per-call timeout, and the caller's own signal if they provided one, so a
  // client abort stops the provider request instead of paying for it.
  const signalFor = (caller?: AbortSignal): AbortSignal => {
    const timeout = AbortSignal.timeout(timeoutMs());
    if (!caller) return timeout;
    return typeof AbortSignal.any === 'function' ? AbortSignal.any([timeout, caller]) : timeout;
  };

  return {
    async chat({ model, messages, tools, signal }: LlmChatParams): Promise<LlmResponse> {
      try {
        const response = await withTransientRetry(() =>
          client.chat.completions.create(
            {
              model,
              messages: messages as unknown as ChatCompletionMessageParam[],
              tools: tools as unknown as ChatCompletionTool[],
              tool_choice: 'auto',
              max_tokens: 2200,
            },
            { signal: signalFor(signal) },
          ),
        );
        const choice = response.choices[0];
        const message = choice?.message;
        const toolCalls: LlmToolCall[] = (message?.tool_calls ?? [])
          .filter((call) => call.type === 'function')
          .map((call) => ({ id: call.id, name: call.function.name, arguments: call.function.arguments }));
        return {
          text: message?.content ?? '',
          toolCalls,
          finishReason: choice?.finish_reason ?? null,
          usage: usageOf(response.usage),
        };
      } catch (error) {
        throw classifyLlmError(error);
      }
    },

    async stream({ model, messages, tools, signal }: LlmChatParams, onDelta): Promise<LlmResponse> {
      try {
        const stream = await withTransientRetry(() =>
          client.chat.completions.create(
            {
              model,
              messages: messages as unknown as ChatCompletionMessageParam[],
              tools: tools as unknown as ChatCompletionTool[],
              tool_choice: 'auto',
              max_tokens: 2200,
              stream: true,
              // Ask for token usage on the final chunk, for cost accounting.
              stream_options: { include_usage: true },
            },
            { signal: signalFor(signal) },
          ),
        );

        let text = '';
        let finishReason: string | null = null;
        let usage: { inputTokens: number; outputTokens: number } | undefined;
        const partial = new Map<number, { id: string; name: string; arguments: string }>();

        for await (const chunk of stream) {
          const reported = usageOf((chunk as { usage?: unknown }).usage);
          if (reported) usage = reported;

          const choice = chunk.choices[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;

          const delta = choice.delta;
          if (delta?.content) {
            text += delta.content;
            onDelta(delta.content);
          }

          for (const call of delta?.tool_calls ?? []) {
            const index = call.index ?? 0;
            const current = partial.get(index) ?? { id: '', name: '', arguments: '' };
            if (call.id) current.id = call.id;
            if (call.function?.name) current.name += call.function.name;
            if (call.function?.arguments) current.arguments += call.function.arguments;
            partial.set(index, current);
          }
        }

        const toolCalls: LlmToolCall[] = [...partial.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, value]) => ({ id: value.id, name: value.name, arguments: value.arguments }));

        return { text, toolCalls, finishReason, usage };
      } catch (error) {
        throw classifyLlmError(error);
      }
    },
  };
}
