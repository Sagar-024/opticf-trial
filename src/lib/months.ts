import type { MonthKey } from '../domain/types';

/**
 * Pure helpers for the `YYYY-MM` month keys used by the dataset.
 * No clock access here: the "current" period is always derived from the data
 * (the latest month present), so results never drift between runs.
 */

/** Sort month keys ascending (lexical order is chronological for `YYYY-MM`). */
export function sortMonths(months: MonthKey[]): MonthKey[] {
  return [...months].sort();
}

/** Distinct, ascending month keys present in a list. */
export function uniqueMonths(months: MonthKey[]): MonthKey[] {
  return sortMonths([...new Set(months)]);
}

/** The single latest month key. Throws on an empty list. */
export function latestMonth(months: MonthKey[]): MonthKey {
  const sorted = uniqueMonths(months);
  if (sorted.length === 0) throw new Error('No months supplied');
  return sorted[sorted.length - 1];
}

/** The month immediately before `month`, or null if `month` is the first known one. */
export function previousMonth(allMonths: MonthKey[], month: MonthKey): MonthKey | null {
  const sorted = uniqueMonths(allMonths);
  const idx = sorted.indexOf(month);
  if (idx <= 0) return null;
  return sorted[idx - 1];
}

/** Inclusive slice of ascending month keys between `from` and `to`. */
export function monthRange(allMonths: MonthKey[], from: MonthKey, to: MonthKey): MonthKey[] {
  return uniqueMonths(allMonths).filter((m) => m >= from && m <= to);
}

/** Human label for a month key, e.g. `Sep 2026`. */
export function monthLabel(month: MonthKey): string {
  const [year, m] = month.split('-');
  const names = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const idx = Number(m) - 1;
  return `${names[idx] ?? m} ${year}`;
}
