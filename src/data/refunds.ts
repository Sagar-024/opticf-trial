import type { Dataset, Refund, RefundReason } from '../domain/types';
import { formatMoney, formatNumber, formatPercent, formatSignedPercent } from '../lib/format';
import { monthLabel, previousMonth } from '../lib/months';
import { monthsOf, practicesById, practiceDisplayName } from './dataset';
import { query_metrics, resolveMonths, resolvePracticeIds } from './metrics';

/**
 * `refund_summary` and `refund_findings` - the money that was booked and then
 * given back.
 *
 * Same house rules as the rest of the data layer: pure, deterministic, every
 * figure returned with a pre-formatted display string so the chart, the table,
 * the watch and the chat answer can never disagree.
 *
 * The four checks are plain rules, none of them a black box:
 *  1. `refund-spike`            - the latest month against the practice's own
 *     usual level, with an absolute floor so small numbers stay quiet.
 *  2. `refund-rate-high`        - refunds as a share of revenue, above the
 *     review level, again with a floor.
 *  3. `goodwill-above-authority` - a gesture above £50 with no regional lead
 *     recorded: the Brain's policy, checked against the rows.
 *  4. `goodwill-near-threshold` - a cluster of gestures just under £50.
 */

export const REFUND_THRESHOLDS = {
  /** A month must reach this before it can count as a spike at all. */
  spikeFloorGbp: 600,
  /** Spike: latest month above this multiple of the practice's own median. */
  spikeRatio: 1.5,
  /** Fewer payments than this is not a pattern. */
  spikeMinCount: 3,
  /** Refund rate review level, percent of revenue. */
  ratePct: 1.0,
  /** The rate check only applies above this monthly total. */
  rateFloorGbp: 400,
  /** The near-threshold band for goodwill gestures, GBP: from (inclusive), to (exclusive). */
  clusterBandFrom: 40,
  clusterBandTo: 50,
  /** A cluster is this many gestures in the band in one month. */
  clusterMinCount: 4,
  /** Gestures above this need the regional lead, per the Brain's policy. */
  authorityLimitGbp: 50,
} as const;

export type RefundFindingCode =
  | 'refund-spike'
  | 'refund-rate-high'
  | 'goodwill-above-authority'
  | 'goodwill-near-threshold';

/** The points each finding contributes, mirroring how attention weights work. */
export const REFUND_WEIGHTS: Record<RefundFindingCode, number> = {
  'refund-spike': 25,
  'refund-rate-high': 20,
  'goodwill-above-authority': 15,
  'goodwill-near-threshold': 12,
};

/** The reasons in display order, with the labels everything quotes. */
export const REFUND_REASON_LABELS: Array<{ reason: RefundReason; label: string }> = [
  { reason: 'frame-fault', label: 'Frame or product fault' },
  { reason: 'lens-fit', label: 'Contact lens fit issue' },
  { reason: 'change-of-mind', label: 'Customer change of mind' },
  { reason: 'goodwill', label: 'Goodwill gesture' },
  { reason: 'other', label: 'Other reason' },
];

const FINDING_LABEL: Record<RefundFindingCode, string> = {
  'refund-spike': 'Refunds spiking',
  'refund-rate-high': 'Refund rate high',
  'goodwill-above-authority': 'Goodwill above the authority line',
  'goodwill-near-threshold': 'Gestures clustered under the limit',
};

export interface RefundFinding {
  code: RefundFindingCode;
  label: string;
  /** Human-readable evidence with the numbers already formatted. */
  evidence: string;
  /** 0-1 strength of the signal. */
  severity: number;
  points: number;
}

export interface RefundPracticeRow {
  practiceId: string;
  name: string;
  region: string;
  manager: string;
  latestMonth: string;
  latestMonthLabel: string;
  latestTotal: number;
  latestTotalDisplay: string;
  latestCount: number;
  latestCountDisplay: string;
  ratePct: number;
  rateDisplay: string;
  prevMonth: string | null;
  prevMonthLabel: string | null;
  prevTotalDisplay: string | null;
  momPct: number | null;
  /** Signed percentage against the previous month, or empty when there is none. */
  momDisplay: string;
  findings: RefundFinding[];
}

export interface RefundFindingsOptions {
  regions?: string[];
  practiceIds?: string[];
  /** The month treated as "this month". Defaults to the latest in the data. */
  month?: string;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function monthOf(refund: Refund): string {
  return refund.date.slice(0, 7);
}

function sumAmount(rows: Refund[]): number {
  return rows.reduce((total, row) => total + row.amount, 0);
}

/** Index revenue by `practiceId:month` for rate calculations. */
function revenueIndex(dataset: Dataset): Map<string, number> {
  const index = new Map<string, number>();
  for (const row of dataset.performance) {
    index.set(`${row.practiceId}:${row.month}`, row.revenue);
  }
  return index;
}

/**
 * Per-practice refund facts and findings for the newest month, with the
 * evidence behind each. Every scoped practice appears, flagged or not, so the
 * layers above can quote the figures either way.
 */
export function refund_findings(dataset: Dataset, options: RefundFindingsOptions = {}): RefundPracticeRow[] {
  const months = monthsOf(dataset);
  const latest = options.month && months.includes(options.month) ? options.month : months[months.length - 1];
  const prev = previousMonth(months, latest);
  const trailingMonths = months.filter((m) => m < latest);

  const scoped = dataset.practices.filter((practice) => {
    if (options.practiceIds && options.practiceIds.length > 0) return options.practiceIds.includes(practice.practiceId);
    if (options.regions && options.regions.length > 0) return options.regions.includes(practice.region);
    return true;
  });

  const revenue = revenueIndex(dataset);
  const byPractice = new Map<string, Refund[]>();
  for (const refund of dataset.refunds) {
    const list = byPractice.get(refund.practiceId);
    if (list) list.push(refund);
    else byPractice.set(refund.practiceId, [refund]);
  }

  const rows: RefundPracticeRow[] = scoped.map((practice) => {
    const practiceRefunds = byPractice.get(practice.practiceId) ?? [];
    const inMonth = (month: string) => practiceRefunds.filter((refund) => monthOf(refund) === month);

    const latestRows = inMonth(latest);
    const latestTotal = sumAmount(latestRows);
    const latestMonthRevenue = revenue.get(`${practice.practiceId}:${latest}`) ?? 0;
    const ratePct = latestMonthRevenue > 0 ? (latestTotal / latestMonthRevenue) * 100 : 0;

    const prevRows = prev ? inMonth(prev) : [];
    const prevTotal = sumAmount(prevRows);
    const momPct = prevTotal > 0 ? ((latestTotal - prevTotal) / prevTotal) * 100 : null;

    const findings: RefundFinding[] = [];
    const add = (code: RefundFindingCode, severity: number, evidence: string): void => {
      const s = clamp01(severity);
      const points = Math.round(REFUND_WEIGHTS[code] * s);
      if (points <= 0) return;
      findings.push({ code, label: FINDING_LABEL[code], evidence, severity: s, points });
    };

    // 1. Spike against the practice's own usual level.
    if (trailingMonths.length >= 3) {
      const trailing = trailingMonths.map((month) => sumAmount(inMonth(month)));
      const usual = median(trailing);
      if (
        latestTotal > Math.max(REFUND_THRESHOLDS.spikeFloorGbp, REFUND_THRESHOLDS.spikeRatio * usual) &&
        latestRows.length >= REFUND_THRESHOLDS.spikeMinCount
      ) {
        const ratio = usual > 0 ? latestTotal / usual : 4;
        const evidence =
          usual > 0
            ? `Refunds ${formatMoney(latestTotal)} across ${formatNumber(latestRows.length)} payments in ${monthLabel(latest)}, against a usual ${formatMoney(usual)} a month (median of ${monthLabel(trailingMonths[0])} to ${monthLabel(trailingMonths[trailingMonths.length - 1])}).`
            : `Refunds ${formatMoney(latestTotal)} across ${formatNumber(latestRows.length)} payments in ${monthLabel(latest)}, against no material refunds in the previous months.`;
        add('refund-spike', 0.3 + (ratio - REFUND_THRESHOLDS.spikeRatio) / 3, evidence);
      }
    }

    // 2. Refund rate above the review level, with a money floor.
    if (
      latestTotal >= REFUND_THRESHOLDS.rateFloorGbp &&
      ratePct >= REFUND_THRESHOLDS.ratePct
    ) {
      add(
        'refund-rate-high',
        0.3 + (ratePct - REFUND_THRESHOLDS.ratePct) / 2,
        `Refunds are ${formatPercent(ratePct)} of revenue in ${monthLabel(latest)} (${formatMoney(latestTotal)} against ${formatMoney(latestMonthRevenue)}), above the ${formatPercent(REFUND_THRESHOLDS.ratePct)} review level.`,
      );
    }

    // 3. Goodwill above the authority line without the regional lead recorded.
    const aboveLimit = latestRows.filter(
      (refund) =>
        refund.reason === 'goodwill' &&
        refund.amount > REFUND_THRESHOLDS.authorityLimitGbp &&
        !refund.escalated,
    );
    if (aboveLimit.length > 0) {
      const largest = Math.max(...aboveLimit.map((refund) => refund.amount));
      add(
        'goodwill-above-authority',
        0.5 + aboveLimit.length * 0.15,
        `${formatNumber(aboveLimit.length)} goodwill gesture${aboveLimit.length === 1 ? '' : 's'} above ${formatMoney(REFUND_THRESHOLDS.authorityLimitGbp)} without the regional lead recorded (largest ${formatMoney(largest)}). The guidance requires approval above ${formatMoney(REFUND_THRESHOLDS.authorityLimitGbp)}.`,
      );
    }

    // 4. A cluster of gestures just under the line.
    const nearLimit = latestRows.filter(
      (refund) =>
        refund.reason === 'goodwill' &&
        refund.amount >= REFUND_THRESHOLDS.clusterBandFrom &&
        refund.amount < REFUND_THRESHOLDS.clusterBandTo,
    );
    if (nearLimit.length >= REFUND_THRESHOLDS.clusterMinCount) {
      add(
        'goodwill-near-threshold',
        0.3 + nearLimit.length / 10,
        `${formatNumber(nearLimit.length)} goodwill gestures between ${formatMoney(REFUND_THRESHOLDS.clusterBandFrom)} and ${formatMoney(REFUND_THRESHOLDS.clusterBandTo)} in ${monthLabel(latest)}, a pattern of gestures staying under the approval line.`,
      );
    }

    return {
      practiceId: practice.practiceId,
      name: practiceDisplayName(dataset, practice.practiceId),
      region: practice.region,
      manager: practice.manager,
      latestMonth: latest,
      latestMonthLabel: monthLabel(latest),
      latestTotal,
      latestTotalDisplay: formatMoney(latestTotal),
      latestCount: latestRows.length,
      latestCountDisplay: formatNumber(latestRows.length),
      ratePct,
      rateDisplay: formatPercent(ratePct),
      prevMonth: prev,
      prevMonthLabel: prev ? monthLabel(prev) : null,
      prevTotalDisplay: prev ? formatMoney(prevTotal) : null,
      momPct,
      momDisplay: momPct === null ? '' : formatSignedPercent(momPct),
      findings: findings.sort((a, b) => b.points - a.points),
    };
  });

  const pointsOf = (row: RefundPracticeRow): number => row.findings.reduce((total, finding) => total + finding.points, 0);
  return rows.sort(
    (a, b) =>
      pointsOf(b) - pointsOf(a) ||
      b.latestTotal - a.latestTotal ||
      a.practiceId.localeCompare(b.practiceId),
  );
}

// ── The summary used by the chat tool, charts and tables ────────────────────

export interface RefundQuery {
  practiceIds?: string[];
  regions?: string[];
  /** Restrict to a single month. */
  month?: string;
  /** Restrict to an explicit set of months. */
  months?: string[];
  from?: string;
  to?: string;
  groupBy?: 'group' | 'region' | 'practice';
}

export interface RefundReasonRow {
  reason: RefundReason;
  label: string;
  count: number;
  total: number;
  totalDisplay: string;
  sharePct: number;
  shareDisplay: string;
}

export interface RefundTrendPoint {
  month: string;
  monthLabel: string;
  total: number;
  totalDisplay: string;
  count: number;
  ratePct: number;
  rateDisplay: string;
}

export interface RefundBreakdownRow {
  key: string;
  label: string;
  region?: string;
  total: number;
  totalDisplay: string;
  count: number;
  ratePct: number;
  rateDisplay: string;
  momPct: number | null;
  momDisplay: string;
}

export interface RefundAuthorityEntry {
  practiceId: string;
  name: string;
  region: string;
  count: number;
  total: number;
  totalDisplay: string;
  evidence: string;
}

export interface RefundClusterEntry {
  practiceId: string;
  name: string;
  region: string;
  count: number;
  evidence: string;
}

export interface RefundSummary {
  months: string[];
  monthLabels: string[];
  monthLabel: string;
  practiceCount: number;
  total: number;
  totalDisplay: string;
  count: number;
  countDisplay: string;
  ratePct: number;
  rateDisplay: string;
  revenue: number;
  revenueDisplay: string;
  netRevenue: number;
  netRevenueDisplay: string;
  previous: {
    month: string | null;
    monthLabel: string | null;
    total: number;
    totalDisplay: string | null;
    changePct: number | null;
    changeDisplay: string | null;
  };
  byReason: RefundReasonRow[];
  trend: RefundTrendPoint[];
  breakdown?: RefundBreakdownRow[];
  aboveAuthority: RefundAuthorityEntry[];
  nearThreshold: RefundClusterEntry[];
  flaggedPracticeIds: string[];
}

/** Aggregate refunds for a slice of the group, with the trend and the checks. */
export function refund_summary(dataset: Dataset, query: RefundQuery = {}): RefundSummary {
  const available = monthsOf(dataset);
  const explicit = Boolean(query.month || (query.months && query.months.length > 0) || query.from || query.to);
  const window = explicit ? resolveMonths(dataset, query) : [available[available.length - 1]];
  const scope = { practiceIds: resolvePracticeIds(dataset, query), regions: query.regions };
  const idSet = new Set(scope.practiceIds);
  const windowSet = new Set(window);

  const rows = dataset.refunds.filter((refund) => idSet.has(refund.practiceId) && windowSet.has(monthOf(refund)));
  const total = sumAmount(rows);
  const count = rows.length;

  const metrics = query_metrics(dataset, { ...scope, months: window });
  const revenue = metrics.revenue.actual;
  const ratePct = revenue > 0 ? (total / revenue) * 100 : 0;

  const lastMonth = window[window.length - 1];
  const prev = window.length === 1 ? previousMonth(available, lastMonth) : null;
  const prevRows = prev
    ? dataset.refunds.filter((refund) => idSet.has(refund.practiceId) && monthOf(refund) === prev)
    : [];
  const prevTotal = sumAmount(prevRows);
  const changePct = prev && prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

  // A reason the label set has never seen is bucketed as `other` rather than
  // dropped, so the mix always accounts for every payment and every pound.
  const knownReasons = new Set(REFUND_REASON_LABELS.map((row) => row.reason));
  const byReason: RefundReasonRow[] = REFUND_REASON_LABELS.map(({ reason, label }) => {
    const reasonRows = rows.filter((refund) =>
      reason === 'other'
        ? refund.reason === 'other' || !knownReasons.has(refund.reason)
        : refund.reason === reason,
    );
    const reasonTotal = sumAmount(reasonRows);
    const sharePct = total > 0 ? (reasonTotal / total) * 100 : 0;
    return {
      reason,
      label,
      count: reasonRows.length,
      total: reasonTotal,
      totalDisplay: formatMoney(reasonTotal),
      sharePct,
      shareDisplay: formatPercent(sharePct),
    };
  })
    .filter((row) => row.count > 0)
    .sort((a, b) => b.total - a.total || a.reason.localeCompare(b.reason));

  // The trend always covers the full available window, whatever the slice.
  const revenueByMonth = new Map<string, number>();
  for (const row of dataset.performance) {
    if (!idSet.has(row.practiceId)) continue;
    revenueByMonth.set(row.month, (revenueByMonth.get(row.month) ?? 0) + row.revenue);
  }
  const rowsByMonth = new Map<string, Refund[]>();
  for (const refund of dataset.refunds) {
    if (!idSet.has(refund.practiceId)) continue;
    const month = monthOf(refund);
    const list = rowsByMonth.get(month);
    if (list) list.push(refund);
    else rowsByMonth.set(month, [refund]);
  }
  const trend: RefundTrendPoint[] = available.map((month) => {
    const monthRows = rowsByMonth.get(month) ?? [];
    const monthTotal = sumAmount(monthRows);
    const monthRevenue = revenueByMonth.get(month) ?? 0;
    const rate = monthRevenue > 0 ? (monthTotal / monthRevenue) * 100 : 0;
    return {
      month,
      monthLabel: monthLabel(month),
      total: monthTotal,
      totalDisplay: formatMoney(monthTotal),
      count: monthRows.length,
      ratePct: rate,
      rateDisplay: formatPercent(rate),
    };
  });

  // Optional breakdown by region or practice.
  let breakdown: RefundBreakdownRow[] | undefined;
  const groupBy = query.groupBy ?? 'group';
  if (groupBy !== 'group') {
    const byId = practicesById(dataset);
    const keyOf = (practiceId: string) =>
      groupBy === 'region' ? byId.get(practiceId)?.region ?? 'Unknown' : practiceId;
    const groups = new Map<string, Refund[]>();
    for (const refund of rows) {
      const key = keyOf(refund.practiceId);
      const list = groups.get(key);
      if (list) list.push(refund);
      else groups.set(key, [refund]);
    }
    breakdown = [...groups.entries()]
      .map(([key, groupRows]) => {
        const groupTotal = sumAmount(groupRows);
        const sampleId = groupRows[0].practiceId;
        const label = groupBy === 'region' ? key : practiceDisplayName(dataset, sampleId);
        const region = groupBy === 'region' ? key : byId.get(sampleId)?.region;
        const groupRevenue =
          groupBy === 'region'
            ? sumRevenue(dataset, idSet, windowSet, (row) => byId.get(row.practiceId)?.region === key)
            : sumRevenue(dataset, new Set([key]), windowSet);
        const groupPrev = prev
          ? dataset.refunds.filter((refund) => keyOf(refund.practiceId) === key && monthOf(refund) === prev)
          : [];
        const groupPrevTotal = sumAmount(groupPrev);
        const groupMomPct = groupPrevTotal > 0 ? ((groupTotal - groupPrevTotal) / groupPrevTotal) * 100 : null;
        return {
          key,
          label,
          ...(region !== undefined ? { region } : {}),
          total: groupTotal,
          totalDisplay: formatMoney(groupTotal),
          count: groupRows.length,
          ratePct: groupRevenue > 0 ? (groupTotal / groupRevenue) * 100 : 0,
          rateDisplay: formatPercent(groupRevenue > 0 ? (groupTotal / groupRevenue) * 100 : 0),
          momPct: groupMomPct,
          momDisplay: groupMomPct === null ? '' : formatSignedPercent(groupMomPct),
        };
      })
      .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  }

  // Policy checks and findings for the summary's window (finding dates match
  // the summary's last month so "this month" means one thing everywhere).
  const findings = refund_findings(dataset, {
    practiceIds: scope.practiceIds.filter((id) => idSet.has(id)),
    month: lastMonth,
  });
  const aboveAuthority: RefundAuthorityEntry[] = [];
  const nearThreshold: RefundClusterEntry[] = [];
  const flaggedPracticeIds: string[] = [];
  for (const row of findings) {
    if (row.findings.length > 0) flaggedPracticeIds.push(row.practiceId);
    const above = windowRows(dataset, row.practiceId, windowSet).filter(
      (refund) =>
        refund.reason === 'goodwill' &&
        refund.amount > REFUND_THRESHOLDS.authorityLimitGbp &&
        !refund.escalated,
    );
    if (above.length > 0) {
      const aboveTotal = sumAmount(above);
      aboveAuthority.push({
        practiceId: row.practiceId,
        name: row.name,
        region: row.region,
        count: above.length,
        total: aboveTotal,
        totalDisplay: formatMoney(aboveTotal),
        evidence: `${formatNumber(above.length)} goodwill gesture${above.length === 1 ? '' : 's'} above ${formatMoney(REFUND_THRESHOLDS.authorityLimitGbp)} without the regional lead recorded (${formatMoney(aboveTotal)}).`,
      });
    }
    const near = windowRows(dataset, row.practiceId, windowSet).filter(
      (refund) =>
        refund.reason === 'goodwill' &&
        refund.amount >= REFUND_THRESHOLDS.clusterBandFrom &&
        refund.amount < REFUND_THRESHOLDS.clusterBandTo,
    );
    if (near.length >= REFUND_THRESHOLDS.clusterMinCount) {
      nearThreshold.push({
        practiceId: row.practiceId,
        name: row.name,
        region: row.region,
        count: near.length,
        evidence: `${formatNumber(near.length)} goodwill gestures between ${formatMoney(REFUND_THRESHOLDS.clusterBandFrom)} and ${formatMoney(REFUND_THRESHOLDS.clusterBandTo)} across the period.`,
      });
    }
  }

  const monthText = window.length === 1 ? monthLabel(window[0]) : `${monthLabel(window[0])} to ${monthLabel(window[window.length - 1])}`;

  return {
    months: window,
    monthLabels: window.map((month) => monthLabel(month)),
    monthLabel: monthText,
    practiceCount: scope.practiceIds.length,
    total,
    totalDisplay: formatMoney(total),
    count,
    countDisplay: formatNumber(count),
    ratePct,
    rateDisplay: formatPercent(ratePct),
    revenue,
    revenueDisplay: formatMoney(revenue),
    netRevenue: revenue - total,
    netRevenueDisplay: formatMoney(revenue - total),
    previous: {
      month: prev,
      monthLabel: prev ? monthLabel(prev) : null,
      total: prevTotal,
      totalDisplay: prev ? formatMoney(prevTotal) : null,
      changePct,
      changeDisplay: changePct === null ? null : formatSignedPercent(changePct),
    },
    byReason,
    trend,
    ...(breakdown ? { breakdown } : {}),
    aboveAuthority,
    nearThreshold,
    flaggedPracticeIds,
  };
}

function windowRows(dataset: Dataset, practiceId: string, windowSet: Set<string>): Refund[] {
  return dataset.refunds.filter((refund) => refund.practiceId === practiceId && windowSet.has(monthOf(refund)));
}

function sumRevenue(
  dataset: Dataset,
  idSet: Set<string>,
  monthSet: Set<string>,
  extra?: (row: Dataset['performance'][number]) => boolean,
): number {
  return dataset.performance
    .filter((row) => idSet.has(row.practiceId) && monthSet.has(row.month) && (!extra || extra(row)))
    .reduce((total, row) => total + row.revenue, 0);
}
