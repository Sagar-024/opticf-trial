/**
 * Pure number formatters.
 *
 * Returning pre-formatted strings alongside raw numbers is deliberate: it lets
 * the chat/LLM layer quote a figure verbatim without doing any arithmetic or
 * rounding of its own.
 */

const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

const gbpWhole = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

const plain = new Intl.NumberFormat('en-GB');

/** `£92,400`. */
export function formatCurrency(value: number): string {
  return gbp.format(Math.round(value));
}

/** Whole-pound currency without decimals, e.g. `£92,400`. */
export function formatMoney(value: number): string {
  return gbpWhole.format(Math.round(value));
}

/** Compact currency, e.g. `£1.23m` or `£92.4k`. */
export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `£${(value / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `£${(value / 1_000).toFixed(1)}k`;
  return gbpWhole.format(Math.round(value));
}

/** `54.0%` (input is already in percentage units). */
export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/** `+3.2%` / `-12.4%`. */
export function formatSignedPercent(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

/** Percentage-point change, e.g. `-9.0pp`. */
export function formatSignedPp(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}pp`;
}

/** Thousands-separated integer, e.g. `1,234`. */
export function formatNumber(value: number): string {
  return plain.format(value);
}
