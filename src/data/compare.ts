import type { Dataset } from '../domain/types';
import { formatMoney, formatPercent, formatSignedPp, formatSignedPercent } from '../lib/format';
import { monthLabel } from '../lib/months';
import { monthsOf, practicesById } from './dataset';
import { aggregateMetrics, selectPerformance } from './metrics';

/**
 * `compare` - compare two periods for a metric, at group, region or practice
 * level. This powers questions like "which practices had the biggest revenue
 * drop versus last month?" and "compare North West with the other regions".
 *
 * Every row carries raw values (for sorting and charts) and pre-formatted
 * strings (for the LLM to quote), so no arithmetic happens in prose.
 */

export type CompareMetric = 'revenue' | 'conversion' | 'contactLens';
export type CompareGroupBy = 'group' | 'region' | 'practice';
export type CompareSort = 'delta-asc' | 'delta-desc' | 'key';

export interface Period {
  /** Inclusive start month (`YYYY-MM`). */
  from: string;
  /** Inclusive end month (`YYYY-MM`). */
  to: string;
}

export interface CompareQuery {
  metric: CompareMetric;
  /** The "current" period. */
  periodA: Period;
  /** The "previous" period to compare against. */
  periodB: Period;
  groupBy?: CompareGroupBy;
  regions?: string[];
  practiceIds?: string[];
  /** Only include groups with at least this many examinations (reduces noise). */
  minExams?: number;
  sort?: CompareSort;
}

export interface CompareRow {
  key: string;
  label: string;
  region?: string;
  /** Metric value in period A (GBP for money, percent for conversion). */
  current: number;
  /** Metric value in period B. */
  previous: number;
  /** Absolute change (GBP, or percentage points for conversion). */
  delta: number;
  /** Percentage change (money metrics only; null for conversion). */
  deltaPct: number | null;
  direction: 'up' | 'down' | 'flat';
  currentDisplay: string;
  previousDisplay: string;
  deltaDisplay: string;
  /** Examinations in period A - the confidence behind a conversion figure. */
  exams: number;
}

export interface CompareResult {
  metric: CompareMetric;
  groupBy: CompareGroupBy;
  periodA: Period;
  periodB: Period;
  periodALabel: string;
  periodBLabel: string;
  rows: CompareRow[];
}

const EPSILON = 1e-9;

function labelForPeriod(period: Period): string {
  if (period.from === period.to) return monthLabel(period.from);
  return `${monthLabel(period.from)} - ${monthLabel(period.to)}`;
}

function metricValue(rows: ReturnType<typeof selectPerformance>, metric: CompareMetric): {
  value: number;
  exams: number;
} {
  const agg = aggregateMetrics(rows, 0);
  switch (metric) {
    case 'revenue':
      return { value: agg.revenue.actual, exams: agg.conversion.exams };
    case 'conversion':
      return { value: agg.conversion.ratePct, exams: agg.conversion.exams };
    case 'contactLens':
      return { value: agg.contactLens.actual, exams: agg.conversion.exams };
  }
}

function formatMetricValue(metric: CompareMetric, value: number): string {
  return metric === 'conversion' ? formatPercent(value) : formatMoney(value);
}

function formatDelta(metric: CompareMetric, delta: number, deltaPct: number | null): string {
  if (metric === 'conversion') return formatSignedPp(delta);
  const pct = deltaPct === null ? '' : ` (${formatSignedPercent(deltaPct)})`;
  return `${delta >= 0 ? '+' : '-'}${formatMoney(Math.abs(delta))}${pct}`;
}

function directionOf(delta: number): 'up' | 'down' | 'flat' {
  if (Math.abs(delta) < EPSILON) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

function compareRows(
  currentRows: ReturnType<typeof selectPerformance>,
  previousRows: ReturnType<typeof selectPerformance>,
  metric: CompareMetric,
  keyOf: (practiceId: string) => string,
  labelOf: (practiceId: string) => string,
  regionOf: (practiceId: string) => string | undefined,
  minExams: number,
): CompareRow[] {
  const current = new Map<string, ReturnType<typeof selectPerformance>>();
  const previous = new Map<string, ReturnType<typeof selectPerformance>>();
  const pairRows = (rows: ReturnType<typeof selectPerformance>, bucket: Map<string, ReturnType<typeof selectPerformance>>) => {
    for (const row of rows) {
      const key = keyOf(row.practiceId);
      const list = bucket.get(key);
      if (list) list.push(row);
      else bucket.set(key, [row]);
    }
  };
  pairRows(currentRows, current);
  pairRows(previousRows, previous);

  const keys = new Set([...current.keys(), ...previous.keys()]);
  const rows: CompareRow[] = [];

  for (const key of keys) {
    const c = metricValue(current.get(key) ?? [], metric);
    const p = metricValue(previous.get(key) ?? [], metric);
    if (c.exams < minExams && p.exams < minExams) continue;

    const delta = c.value - p.value;
    const deltaPct = metric === 'conversion' ? null : p.value !== 0 ? (delta / Math.abs(p.value)) * 100 : null;
    const samplePracticeId = (current.get(key) ?? previous.get(key) ?? [])[0]?.practiceId ?? key;

    rows.push({
      key,
      label: labelOf(samplePracticeId),
      region: regionOf(samplePracticeId),
      current: c.value,
      previous: p.value,
      delta,
      deltaPct,
      direction: directionOf(delta),
      currentDisplay: formatMetricValue(metric, c.value),
      previousDisplay: formatMetricValue(metric, p.value),
      deltaDisplay: formatDelta(metric, delta, deltaPct),
      exams: c.exams,
    });
  }

  return rows;
}

/** Compare two periods for a metric. */
export function compare(dataset: Dataset, query: CompareQuery): CompareResult {
  const groupBy = query.groupBy ?? 'group';
  const minExams = query.minExams ?? 0;
  const byId = practicesById(dataset);

  const scope = { regions: query.regions, practiceIds: query.practiceIds };

  const currentRows = selectPerformance(dataset, {
    ...scope,
    from: query.periodA.from,
    to: query.periodA.to,
  });
  const previousRows = selectPerformance(dataset, {
    ...scope,
    from: query.periodB.from,
    to: query.periodB.to,
  });

  let rows: CompareRow[];
  if (groupBy === 'group') {
    const c = metricValue(currentRows, query.metric);
    const p = metricValue(previousRows, query.metric);
    const delta = c.value - p.value;
    const deltaPct = query.metric === 'conversion' ? null : p.value !== 0 ? (delta / Math.abs(p.value)) * 100 : null;
    rows = [{
      key: 'group',
      label: 'Group',
      current: c.value,
      previous: p.value,
      delta,
      deltaPct,
      direction: directionOf(delta),
      currentDisplay: formatMetricValue(query.metric, c.value),
      previousDisplay: formatMetricValue(query.metric, p.value),
      deltaDisplay: formatDelta(query.metric, delta, deltaPct),
      exams: c.exams,
    }];
  } else {
    const keyOf = groupBy === 'region'
      ? (id: string) => byId.get(id)?.region ?? 'Unknown'
      : (id: string) => id;
    const labelOf = groupBy === 'region'
      ? (id: string) => byId.get(id)?.region ?? 'Unknown'
      : (id: string) => byId.get(id)?.name ?? id;
    const regionOf = groupBy === 'region'
      ? () => undefined
      : (id: string) => byId.get(id)?.region;
    rows = compareRows(currentRows, previousRows, query.metric, keyOf, labelOf, regionOf, minExams);
  }

  const sort = query.sort ?? 'delta-asc';
  if (sort === 'delta-asc') rows.sort((a, b) => a.delta - b.delta || a.key.localeCompare(b.key));
  else if (sort === 'delta-desc') rows.sort((a, b) => b.delta - a.delta || a.key.localeCompare(b.key));
  else rows.sort((a, b) => a.key.localeCompare(b.key));

  return {
    metric: query.metric,
    groupBy,
    periodA: query.periodA,
    periodB: query.periodB,
    periodALabel: labelForPeriod(query.periodA),
    periodBLabel: labelForPeriod(query.periodB),
    rows,
  };
}

/**
 * Compare the latest month against the previous month, for a metric and level.
 * The common shortcut behind "biggest drop vs last month".
 */
export function compare_latest_month(
  dataset: Dataset,
  metric: CompareMetric,
  groupBy: CompareGroupBy = 'practice',
  options: { regions?: string[]; practiceIds?: string[]; minExams?: number; sort?: CompareSort } = {},
): CompareResult {
  const months = monthsOf(dataset);
  const to = months[months.length - 1];
  const from = months[months.length - 2] ?? to;
  return compare(dataset, {
    metric,
    groupBy,
    periodA: { from: to, to },
    periodB: { from, to: from },
    minExams: options.minExams,
    sort: options.sort,
    regions: options.regions,
    practiceIds: options.practiceIds,
  });
}
