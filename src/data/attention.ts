import type { Dataset } from '../domain/types';
import { formatMoney, formatPercent, formatSignedPp, formatSignedPercent } from '../lib/format';
import { monthLabel } from '../lib/months';
import { monthsOf, practiceDisplayName } from './dataset';
import { aggregateMetrics, selectPerformance } from './metrics';
import { refund_findings, REFUND_WEIGHTS } from './refunds';
import { training_status } from './training';

/**
 * `rank_attention` - score and rank practices by how much attention they need,
 * with the evidence behind each score.
 *
 * This is the single source of truth for the Today tab and for "which
 * practices need the most attention, and what in the data suggests that?".
 * Each signal carries a formatted evidence string so the answer can be quoted
 * without the model doing any maths.
 */

export type AttentionSignalCode =
  | 'revenue-decline'
  | 'conversion-decline'
  | 'below-revenue-target'
  | 'cl-below-target'
  | 'training-incomplete'
  | 'training-overdue'
  | 'refund-spike'
  | 'refund-rate-high'
  | 'goodwill-above-authority'
  | 'goodwill-near-threshold';

export interface AttentionSignal {
  code: AttentionSignalCode;
  label: string;
  /** Human-readable evidence with the numbers already formatted. */
  evidence: string;
  /** Contribution to the 0-100 score for this practice. */
  weight: number;
  /** 0-1 strength of the signal. */
  severity: number;
  points: number;
}

export interface AttentionRow {
  practiceId: string;
  name: string;
  region: string;
  manager: string;
  mentorId: string;
  /** 0-100, higher means more attention needed. */
  score: number;
  /** Coarse band for UI colouring and ordering. */
  band: 'high' | 'medium' | 'low';
  signals: AttentionSignal[];
  stats: {
    latestMonth: string;
    latestMonthLabel: string;
    revenue: number;
    revenueDisplay: string;
    revenueMoMPct: number;
    revenueMoMDisplay: string;
    revenueAttainmentPct: number;
    conversionPct: number;
    conversionDisplay: string;
    conversionMoMPp: number;
    conversionMoMDisplay: string;
    clAttainmentPct: number;
    clAttainmentDisplay: string;
    trainingCompletionPct: number;
    trainingCompletionDisplay: string;
    /** Refunds for the latest month, with the rate and the movement. */
    refundLatestDisplay: string;
    refundCountDisplay: string;
    refundRateDisplay: string;
    /** Signed percentage against the previous month, or empty. */
    refundMoMDisplay: string;
  };
}

export interface AttentionOptions {
  regions?: string[];
  practiceIds?: string[];
  /** Limit the returned list to the top N. */
  limit?: number;
  /** Minimum score to be included. */
  minScore?: number;
  asOf?: string;
}

const WEIGHTS = {
  revenueDecline: 30,
  conversionDecline: 25,
  clBelowTarget: 20,
  belowRevenueTarget: 15,
  training: 15,
  trainingOverdue: 6,
} as const;

const THRESHOLDS = {
  revenueDeclinePct: -3,
  conversionDeclinePp: -2,
  revenueAttainmentPct: 95,
  clAttainmentPct: 90,
  trainingPct: 100,
} as const;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function bandFor(score: number): 'high' | 'medium' | 'low' {
  if (score >= 45) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

/** Rank practices by attention score, highest first. */
export function rank_attention(dataset: Dataset, options: AttentionOptions = {}): AttentionRow[] {
  const months = monthsOf(dataset);
  const latest = months[months.length - 1];
  const previous = months[months.length - 2] ?? latest;

  const training = training_status(dataset, {
    regions: options.regions,
    practiceIds: options.practiceIds,
    asOf: options.asOf,
  });
  const trainingByPractice = new Map(training.byPractice.map((t) => [t.practiceId, t]));

  // Refund findings come from the refunds layer, which owns the thresholds and
  // the evidence strings. This file only weights them into the score.
  const refunds = refund_findings(dataset, {
    regions: options.regions,
    practiceIds: options.practiceIds,
  });
  const refundsByPractice = new Map(refunds.map((row) => [row.practiceId, row]));

  const scoped = dataset.practices.filter((p) => {
    if (options.practiceIds && options.practiceIds.length > 0) return options.practiceIds.includes(p.practiceId);
    if (options.regions && options.regions.length > 0) return options.regions.includes(p.region);
    return true;
  });

  const rows: AttentionRow[] = [];

  for (const practice of scoped) {
    const latestRows = selectPerformance(dataset, { practiceIds: [practice.practiceId], month: latest });

    // A practice with no row in the latest month is not part of the reporting
    // estate (opened later, or left the group). "No data" must never read as a
    // collapse or a shortfall, so it produces no signals at all.
    if (latestRows.length === 0) continue;

    const previousRows = previous === latest
      ? latestRows
      : selectPerformance(dataset, { practiceIds: [practice.practiceId], month: previous });

    const now = aggregateMetrics(latestRows, 1);
    const before = aggregateMetrics(previousRows, 1);

    const revenueMoMPct = before.revenue.actual > 0
      ? ((now.revenue.actual - before.revenue.actual) / before.revenue.actual) * 100
      : 0;
    const conversionMoMPp = now.conversion.ratePct - before.conversion.ratePct;

    const signals: AttentionSignal[] = [];

    const addSignal = (
      code: AttentionSignalCode,
      label: string,
      weight: number,
      severity: number,
      evidence: string,
    ) => {
      const s = clamp01(severity);
      const points = Math.round(weight * s);
      if (points <= 0) return;
      signals.push({ code, label, weight, severity: s, points, evidence });
    };

    // Revenue decline vs the previous month. Crossing the threshold already
    // scores a meaningful floor, then scales with the size of the fall.
    if (revenueMoMPct <= THRESHOLDS.revenueDeclinePct) {
      const severity = clamp01(0.3 + (-revenueMoMPct - 3) / 15);
      addSignal(
        'revenue-decline',
        'Revenue falling',
        WEIGHTS.revenueDecline,
        severity,
        `Revenue ${formatSignedPercent(revenueMoMPct)} (${formatMoney(now.revenue.actual)}) vs ${formatMoney(before.revenue.actual)} in ${monthLabel(previous)}.`,
      );
    }

    // Conversion decline, in percentage points.
    if (conversionMoMPp <= THRESHOLDS.conversionDeclinePp) {
      const severity = clamp01(0.3 + (-conversionMoMPp - 2) / 10);
      addSignal(
        'conversion-decline',
        'Conversion falling',
        WEIGHTS.conversionDecline,
        severity,
        `Conversion ${formatPercent(before.conversion.ratePct)} → ${formatPercent(now.conversion.ratePct)} (${formatSignedPp(conversionMoMPp)}) with ${now.conversion.exams} examinations.`,
      );
    }

    // Revenue below plan for the latest month.
    if (now.revenue.attainmentPct < THRESHOLDS.revenueAttainmentPct) {
      const severity = clamp01((THRESHOLDS.revenueAttainmentPct - now.revenue.attainmentPct) / 25);
      addSignal(
        'below-revenue-target',
        'Below revenue target',
        WEIGHTS.belowRevenueTarget,
        severity,
        `${now.revenue.actualDisplay} against a ${now.revenue.targetDisplay} target (${now.revenue.attainmentDisplay} of plan).`,
      );
    }

    // Contact-lens revenue below plan.
    if (now.contactLens.attainmentPct < THRESHOLDS.clAttainmentPct) {
      const severity = clamp01((THRESHOLDS.clAttainmentPct - now.contactLens.attainmentPct) / 25);
      addSignal(
        'cl-below-target',
        'Contact lens below target',
        WEIGHTS.clBelowTarget,
        severity,
        `Contact lens ${now.contactLens.actualDisplay} against ${now.contactLens.targetDisplay} (${now.contactLens.attainmentDisplay} of target).`,
      );
    }

    // Training gaps.
    const t = trainingByPractice.get(practice.practiceId);
    if (t && t.completionPct < THRESHOLDS.trainingPct) {
      const severity = clamp01((100 - t.completionPct) / 40);
      const missing = t.gaps.map((g) => g.moduleName).join(', ');
      addSignal(
        'training-incomplete',
        'Training incomplete',
        WEIGHTS.training,
        severity,
        `${t.completedModules}/${t.requiredModules} required modules complete (${t.completionDisplay}). Missing: ${missing}.`,
      );
      if (t.overdueCount > 0) {
        addSignal(
          'training-overdue',
          'Training overdue',
          WEIGHTS.trainingOverdue,
          clamp01(t.overdueCount / t.requiredModules),
          `${t.overdueCount} module${t.overdueCount === 1 ? '' : 's'} past the due date.`,
        );
      }
    }

    // Refunds and goodwill: the findings arrive scored, with evidence.
    const r = refundsByPractice.get(practice.practiceId);
    if (r) {
      for (const finding of r.findings) {
        signals.push({
          code: finding.code,
          label: finding.label,
          weight: REFUND_WEIGHTS[finding.code],
          severity: finding.severity,
          points: finding.points,
          evidence: finding.evidence,
        });
      }
    }

    const rawScore = signals.reduce((sum, s) => sum + s.points, 0);
    const score = Math.min(100, rawScore);

    rows.push({
      practiceId: practice.practiceId,
      name: practiceDisplayName(dataset, practice.practiceId),
      region: practice.region,
      manager: practice.manager,
      mentorId: practice.mentorId,
      score,
      band: bandFor(score),
      signals,
      stats: {
        latestMonth: latest,
        latestMonthLabel: monthLabel(latest),
        revenue: now.revenue.actual,
        revenueDisplay: now.revenue.actualDisplay,
        revenueMoMPct,
        revenueMoMDisplay: formatSignedPercent(revenueMoMPct),
        revenueAttainmentPct: now.revenue.attainmentPct,
        conversionPct: now.conversion.ratePct,
        conversionDisplay: now.conversion.rateDisplay,
        conversionMoMPp,
        conversionMoMDisplay: formatSignedPp(conversionMoMPp),
        clAttainmentPct: now.contactLens.attainmentPct,
        clAttainmentDisplay: now.contactLens.attainmentDisplay,
        trainingCompletionPct: t?.completionPct ?? 100,
        trainingCompletionDisplay: t?.completionDisplay ?? '100%',
        refundLatestDisplay: r?.latestTotalDisplay ?? formatMoney(0),
        refundCountDisplay: r?.latestCountDisplay ?? '0',
        refundRateDisplay: r?.rateDisplay ?? formatPercent(0),
        refundMoMDisplay: r?.momDisplay ?? '',
      },
    });
  }

  rows.sort((a, b) => b.score - a.score || a.practiceId.localeCompare(b.practiceId));

  const minScore = options.minScore ?? 0;
  const filtered = rows.filter((r) => r.score >= minScore && r.signals.length > 0);
  return options.limit ? filtered.slice(0, options.limit) : filtered;
}
