import type { Dataset, MonthlyPerformance } from '../domain/types';
import {
  formatMoney,
  formatPercent,
  formatSignedPp,
} from '../lib/format';
import { monthLabel, previousMonth } from '../lib/months';
import { monthsOf, practicesById, practiceDisplayName } from './dataset';

/**
 * `query_metrics` - aggregate the trading numbers for a slice of the group.
 *
 * This is the function the BI layer calls to fill dashboards and answer
 * "how are we doing?" questions. It returns *both* raw values (for charts) and
 * pre-formatted strings (for the LLM to quote verbatim), so no number is ever
 * recomputed in prose.
 */

export interface MetricsQuery {
  /** Restrict to these practices. */
  practiceIds?: string[];
  /** Restrict to these regions (ignored if `practiceIds` is set). */
  regions?: string[];
  /** Restrict to a single month. */
  month?: string;
  /** Restrict to an explicit set of months. */
  months?: string[];
  /** Inclusive month range (`YYYY-MM`). */
  from?: string;
  to?: string;
  /**
   * `group` (default) returns one aggregate.
   * `region` / `practice` also return a per-key breakdown.
   */
  groupBy?: 'group' | 'region' | 'practice';
}

export interface SeriesMetrics {
  months: string[];
  monthLabels: string[];
  practiceCount: number;
  revenue: {
    actual: number;
    target: number;
    variance: number;
    variancePct: number;
    attainmentPct: number;
    actualDisplay: string;
    targetDisplay: string;
    varianceDisplay: string;
    attainmentDisplay: string;
  };
  conversion: {
    exams: number;
    purchases: number;
    /** Weighted conversion rate, percent. */
    ratePct: number;
    targetPct: number;
    variancePp: number;
    rateDisplay: string;
    targetDisplay: string;
    varianceDisplay: string;
  };
  contactLens: {
    actual: number;
    target: number;
    variance: number;
    attainmentPct: number;
    actualDisplay: string;
    targetDisplay: string;
    varianceDisplay: string;
    attainmentDisplay: string;
  };
}

export interface MetricsBreakdownRow {
  key: string;
  label: string;
  region?: string;
  metrics: SeriesMetrics;
}

export interface MetricsResult extends SeriesMetrics {
  /** Present when `groupBy` is `region` or `practice`. */
  breakdown?: MetricsBreakdownRow[];
}

function sumBy<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

/** Resolve the month window selected by a query, clamped to the dataset. */
export function resolveMonths(dataset: Dataset, query: MetricsQuery = {}): string[] {
  const available = monthsOf(dataset);
  if (query.months && query.months.length > 0) {
    return available.filter((m) => query.months!.includes(m));
  }
  if (query.month) {
    return available.includes(query.month) ? [query.month] : [];
  }
  if (query.from || query.to) {
    const from = query.from ?? available[0];
    const to = query.to ?? available[available.length - 1];
    return available.filter((m) => m >= from && m <= to);
  }
  return available;
}

/** Which practice ids fall inside a query's scope. */
export function resolvePracticeIds(dataset: Dataset, query: MetricsQuery = {}): string[] {
  if (query.practiceIds && query.practiceIds.length > 0) {
    const known = practicesById(dataset);
    return query.practiceIds.filter((id) => known.has(id));
  }
  if (query.regions && query.regions.length > 0) {
    return dataset.practices.filter((p) => query.regions!.includes(p.region)).map((p) => p.practiceId);
  }
  return dataset.practices.map((p) => p.practiceId);
}

/** Select the performance rows that match a query. */
export function selectPerformance(dataset: Dataset, query: MetricsQuery = {}): MonthlyPerformance[] {
  const ids = new Set(resolvePracticeIds(dataset, query));
  const months = new Set(resolveMonths(dataset, query));
  return dataset.performance.filter((row) => ids.has(row.practiceId) && months.has(row.month));
}

/** Aggregate a set of performance rows into a single metrics block. */
export function aggregateMetrics(rows: MonthlyPerformance[], practiceCount: number): SeriesMetrics {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const revenue = sumBy(rows, (r) => r.revenue);
  const revenueTarget = sumBy(rows, (r) => r.revenueTarget);
  const exams = sumBy(rows, (r) => r.eyeExams);
  const purchases = sumBy(rows, (r) => r.purchases);
  const clRevenue = sumBy(rows, (r) => r.clRevenue);
  const clTarget = sumBy(rows, (r) => r.clTarget);

  const ratePct = exams > 0 ? (purchases / exams) * 100 : 0;
  const targetPct = exams > 0 ? sumBy(rows, (r) => r.conversionTarget * r.eyeExams) / exams : 0;

  const revenueVariance = revenue - revenueTarget;
  const revenueVariancePct = revenueTarget > 0 ? (revenueVariance / revenueTarget) * 100 : 0;
  const revenueAttainment = revenueTarget > 0 ? (revenue / revenueTarget) * 100 : 0;

  const clVariance = clRevenue - clTarget;
  const clAttainment = clTarget > 0 ? (clRevenue / clTarget) * 100 : 0;

  return {
    months,
    monthLabels: months.map(monthLabel),
    practiceCount,
    revenue: {
      actual: revenue,
      target: revenueTarget,
      variance: revenueVariance,
      variancePct: revenueVariancePct,
      attainmentPct: revenueAttainment,
      actualDisplay: formatMoney(revenue),
      targetDisplay: formatMoney(revenueTarget),
      varianceDisplay: `${revenueVariance >= 0 ? '+' : '-'}${formatMoney(Math.abs(revenueVariance))}`,
      attainmentDisplay: formatPercent(revenueAttainment),
    },
    conversion: {
      exams,
      purchases,
      ratePct,
      targetPct,
      variancePp: ratePct - targetPct,
      rateDisplay: formatPercent(ratePct),
      targetDisplay: formatPercent(targetPct),
      varianceDisplay: formatSignedPp(ratePct - targetPct),
    },
    contactLens: {
      actual: clRevenue,
      target: clTarget,
      variance: clVariance,
      attainmentPct: clAttainment,
      actualDisplay: formatMoney(clRevenue),
      targetDisplay: formatMoney(clTarget),
      varianceDisplay: `${clVariance >= 0 ? '+' : '-'}${formatMoney(Math.abs(clVariance))}`,
      attainmentDisplay: formatPercent(clAttainment),
    },
  };
}

function groupRows(
  rows: MonthlyPerformance[],
  keyOfRow: (row: MonthlyPerformance) => string,
  keyOfPractice: (practiceId: string) => string,
  labelOf: (key: string, samplePracticeId: string) => string,
  practiceIds: string[],
  dataset: Dataset,
): MetricsBreakdownRow[] {
  const byId = practicesById(dataset);
  const buckets = new Map<string, MonthlyPerformance[]>();
  for (const row of rows) {
    const key = keyOfRow(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const countByKey = new Map<string, number>();
  for (const id of practiceIds) {
    const key = keyOfPractice(id);
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const practice = byId.get(bucket[0].practiceId);
      return {
        key,
        label: labelOf(key, bucket[0].practiceId),
        region: practice?.region,
        metrics: aggregateMetrics(bucket, countByKey.get(key) ?? 1),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Aggregate metrics for a query. With `groupBy: 'region'` or `'practice'` the
 * result also carries a per-group breakdown for dashboards.
 */
export function query_metrics(dataset: Dataset, query: MetricsQuery = {}): MetricsResult {
  const practiceIds = resolvePracticeIds(dataset, query);
  const rows = selectPerformance(dataset, query);
  const base = aggregateMetrics(rows, practiceIds.length);

  const groupBy = query.groupBy ?? 'group';
  if (groupBy === 'group') return base;

  const byId = practicesById(dataset);
  const keyOfPractice = groupBy === 'region'
    ? (id: string) => byId.get(id)?.region ?? 'Unknown'
    : (id: string) => id;
  const keyOfRow = groupBy === 'region'
    ? (row: MonthlyPerformance) => byId.get(row.practiceId)?.region ?? 'Unknown'
    : (row: MonthlyPerformance) => row.practiceId;
  // Region groups are labelled by the region itself, not by a practice name.
  const labelOf = groupBy === 'region'
    ? (key: string) => key
    : (key: string, samplePracticeId: string) => practiceDisplayName(dataset, samplePracticeId);

  return { ...base, breakdown: groupRows(rows, keyOfRow, keyOfPractice, labelOf, practiceIds, dataset) };
}

/** Convenience: metrics for a single named month (defaults to the latest). */
export function query_metrics_for_month(dataset: Dataset, month?: string): MetricsResult {
  const months = monthsOf(dataset);
  const target = month ?? months[months.length - 1];
  return query_metrics(dataset, { month: target });
}

/**
 * Month-over-month change for the whole scope, using the same aggregation as
 * `query_metrics` so the two are always consistent.
 */
export function query_metrics_mom(dataset: Dataset, query: MetricsQuery = {}): {
  current: SeriesMetrics;
  previous: SeriesMetrics;
  currentMonth: string;
  previousMonth: string | null;
} {
  const months = resolveMonths(dataset, { practiceIds: query.practiceIds, regions: query.regions });
  const currentMonth = query.month ?? months[months.length - 1];
  const prev = previousMonth(months, currentMonth);
  const current = query_metrics(dataset, { ...query, month: currentMonth });
  const previous = prev
    ? query_metrics(dataset, { ...query, month: prev })
    : query_metrics(dataset, { ...query, months: [] });
  return { current, previous, currentMonth, previousMonth: prev };
}
