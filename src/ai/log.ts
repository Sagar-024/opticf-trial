/**
 * Structured server logging for the chat route.
 *
 * One JSON line per event, so runs are greppable. Deliberately never logs the
 * API key, the request headers, or the body of a question beyond a short
 * preview, and never logs guidance content.
 */

export interface ChatLogEvent {
  event: 'chat.start' | 'chat.done' | 'chat.error';
  /** Short preview of the latest question, for debugging only. */
  question?: string;
  durationMs?: number;
  iterations?: number;
  toolCalls?: number;
  widgets?: number;
  flagged?: boolean;
  budgetExceeded?: boolean;
  /** Version of the instructions that produced the answer. */
  promptVersion?: string;
  /** Tokens reported by the provider, for cost tracking. */
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  /** True when the answer was served from the short lived cache. */
  cached?: boolean;
  /** How many model responses contained leaked tool call markup. */
  markupEvents?: number;
  /** How many tool calls were recovered from leaked markup. */
  salvagedToolCalls?: number;
  /** Correlates every log line for one request. */
  traceId?: string;
  /** Per step timings, so a slow answer can be explained without a debugger. */
  trace?: string;
  error?: string;
  status?: number;
}

function preview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function logChat(event: ChatLogEvent, question?: string): void {
  const payload = {
    ts: new Date().toISOString(),
    ...event,
    ...(question !== undefined ? { question: preview(question) } : {}),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}
