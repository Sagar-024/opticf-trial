/**
 * Deterministic pseudo-random number generation.
 *
 * The whole sample dataset is generated from one integer seed so the demo is
 * reproducible: the same seed always produces the same CSV files and therefore
 * the same metrics, charts and answers.
 */

/** Hash an arbitrary string into a 32-bit unsigned integer seed. */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Mulberry32 - a small, fast, well-distributed 32-bit PRNG.
 * Returns a function that yields floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent, stable PRNG for a named entity from a base seed. */
export function seededFor(baseSeed: number, key: string): () => number {
  return mulberry32((baseSeed ^ hashSeed(key)) >>> 0);
}
