/**
 * Short lived response cache.
 *
 * Identical questions get identical answers from the same data, so serving a
 * repeat from memory cuts cost and latency. Big production systems use semantic
 * caching; exact match is the honest first step and is trivial to reason about.
 *
 * The key includes the prompt version, the conversation, the analytical context
 * and any guidance edits, so a stale entry can never answer a different question.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const MAX_ENTRIES = 200;

export class ResponseCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs = 10 * 60_000) {}

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    // Bound the map even when nothing has expired.
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get(key: string): T | undefined {
    const now = Date.now();
    this.prune(now);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    const now = Date.now();
    this.prune(now);
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Stable key for a request: prompt version, conversation, context, edits. */
export function cacheKey(parts: {
  promptVersion: string;
  messages: Array<{ role: string; content: string }>;
  context?: unknown;
  brainOverrides?: unknown;
}): string {
  const payload = JSON.stringify({
    v: parts.promptVersion,
    m: parts.messages.map((message) => `${message.role}:${message.content}`),
    c: parts.context ?? null,
    b: parts.brainOverrides ?? null,
  });
  // Small, dependency free hash: FNV-1a over the payload.
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${payload.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}
