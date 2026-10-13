import type { ToolOutput } from './types';

/**
 * Number guard.
 *
 * After the model answers, every number in the prose must have appeared in a
 * tool result. We collect all numbers from tool output (summaries + widgets)
 * and flag anything the model produced that we cannot trace back.
 */

// Matches currency, decimals, percentages, pp and compact (m/k) forms.
const NUMBER_RE = /(?:£)?-?\d[\d,]*(?:\.\d+)?(?:pp|m|k|%)?/gi;

/** Raw number-like tokens found in a string. */
export function extractNumbers(text: string): string[] {
  return text.match(NUMBER_RE) ?? [];
}

/**
 * Normalise a token so `£3,282,110` and `3,282,110` compare equal.
 *
 * Signs are dropped deliberately. Our formatters emit signed values such as
 * `-2.9%` and `-2.3pp`, while a model writing "conversion fell 2.3pp" omits the
 * minus. Comparing magnitudes avoids flagging correct answers, at the cost of
 * not catching a flipped sign. Direction is carried by the words around it, and
 * an invented or wrong magnitude is still caught.
 */
export function normalizeNumber(token: string): string {
  return token.toLowerCase().replace(/[£,%\s+]/g, '').replace(/^-/, '');
}

/** The set of every normalised number the tools have returned. */
export function allowedSet(outputs: ToolOutput[], extra: string[] = []): Set<string> {
  const set = new Set<string>();
  const add = (text: string) => {
    for (const token of extractNumbers(text)) set.add(normalizeNumber(token));
  };
  for (const output of outputs) {
    add(output.summary);
    add(JSON.stringify(output.widgets));
    add(JSON.stringify(output.mapHighlight ?? []));
  }
  for (const text of extra) add(text);
  return set;
}

/** Numbers used in an answer that never appeared in tool results. */
export function findUnsupportedNumbers(text: string, allowed: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of extractNumbers(text)) {
    const normalised = normalizeNumber(token);
    if (!normalised) continue;
    if (/^\d{4}$/.test(normalised)) continue; // bare 4-digit years
    if (allowed.has(normalised)) continue;
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}
