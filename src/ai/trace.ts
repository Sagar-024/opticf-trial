/**
 * Trace spans for one question.
 *
 * Production LLM systems emit a trace per request so you can see where the time
 * went. This is deliberately tiny: an in-memory list of spans returned with the
 * result, logged as one line, and never containing prompt or question content.
 */

export interface TraceSpan {
  name: string;
  ms: number;
  /** Optional small detail, for example the tool name or the round number. */
  detail?: string;
}

export class Trace {
  private readonly started = Date.now();
  private readonly spans: TraceSpan[] = [];

  async measure<T>(name: string, operation: () => Promise<T>, detail?: string): Promise<T> {
    const started = Date.now();
    try {
      return await operation();
    } finally {
      this.spans.push({ name, ms: Date.now() - started, detail });
    }
  }

  span(name: string, ms: number, detail?: string): void {
    this.spans.push({ name, ms, detail });
  }

  total(): number {
    return Date.now() - this.started;
  }

  summary(): TraceSpan[] {
    return [...this.spans];
  }
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Only present when the price per million tokens is configured. */
  estimatedCostUsd?: number;
}

/** Add usage reports together, since one question can make several model calls. */
export function addUsage(total: TokenUsage, next?: { inputTokens: number; outputTokens: number }): TokenUsage {
  if (!next) return total;
  return {
    ...total,
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
  };
}

/**
 * Estimate cost only when the operator supplies prices, so nothing is hardcoded.
 * `LLM_PRICE_INPUT_PER_M` and `LLM_PRICE_OUTPUT_PER_M` are US dollars per
 * million tokens.
 */
export function estimateCost(usage: TokenUsage): number | undefined {
  const input = Number(process.env.LLM_PRICE_INPUT_PER_M);
  const output = Number(process.env.LLM_PRICE_OUTPUT_PER_M);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  return (usage.inputTokens / 1_000_000) * input + (usage.outputTokens / 1_000_000) * output;
}
