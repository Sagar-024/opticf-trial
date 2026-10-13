/**
 * Simple in-memory rate limiter.
 *
 * The demo deliberately has no authentication (it would hurt a trial), so this
 * is the cheapest protection for the API key: a sliding window per caller.
 * In-memory means it is per server instance, which is fine for a demo and for
 * a single Vercel lambda; a shared store would be the production upgrade.
 */

interface Bucket {
  /** Timestamps of recent requests, oldest first. */
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Drop buckets that have been idle so the map cannot grow without bound. */
function prune(now: number, windowMs: number): void {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    const newest = bucket.hits[bucket.hits.length - 1] ?? 0;
    if (now - newest > windowMs) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  options: { limit?: number; windowMs?: number } = {},
): RateLimitResult {
  const limit = options.limit ?? 20;
  const windowMs = options.windowMs ?? 60_000;
  const now = Date.now();

  prune(now, windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((time) => now - time < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 };
}

/** Best-effort caller identity from proxy headers, falling back to a constant. */
export function callerKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim().slice(0, 60);
  return request.headers.get('x-real-ip')?.slice(0, 60) ?? 'local';
}

/** Test helper: clear all buckets. */
export function resetRateLimit(): void {
  buckets.clear();
}
