import type { Dataset } from '../domain/types';
import { formatMoney, formatPercent, formatSignedPercent, formatSignedPp } from '../lib/format';
import { monthLabel } from '../lib/months';
import { monthsOf, practiceDisplayName } from './dataset';
import { aggregateMetrics, selectPerformance } from './metrics';
import { refund_findings } from './refunds';
import { training_status } from './training';
import { rank_attention } from './attention';

/**
 * The map view-model.
 *
 * One row per practice, with every number the map lenses and the inspector
 * need. Built from the same pure functions the chat tools use, so the map can
 * never disagree with an answer. All display strings are pre-formatted here.
 */

export interface MapPractice {
  practiceId: string;
  name: string;
  region: string;
  manager: string;
  mentorId: string;
  mentorName: string;
  pmsSystem: string;
  /** True when the practice has a row in the latest month. False when it opened later or has left. */
  reported: boolean;

  revenue: number;
  revenueDisplay: string;
  revenueTargetDisplay: string;
  revenueAttainmentPct: number;
  revenueAttainmentDisplay: string;
  revenueMoMPct: number;
  revenueMoMDisplay: string;

  conversionPct: number;
  conversionDisplay: string;
  conversionMoMPp: number;
  conversionMoMDisplay: string;
  conversionTargetPct: number;

  clAttainmentPct: number;
  clAttainmentDisplay: string;
  clActualDisplay: string;
  clTargetDisplay: string;

  trainingCompletionPct: number;
  trainingCompletionDisplay: string;
  trainingOverdue: number;
  trainingGaps: string[];
  trainingStatus: 'complete' | 'incomplete' | 'overdue';

  /** Refunds for the latest month, with the rate and the movement. */
  refundTotal: number;
  refundCount: number;
  refundLatestDisplay: string;
  refundRatePct: number;
  refundRateDisplay: string;
  refundMoMDisplay: string;
  /** Which refund checks fired, as finding codes. Empty means no flags. */
  refundFlags: string[];

  /** The evidence behind this practice's position on the map, plain sentences. */
  attentionSignals: string[];

  /** Revenue for the last six months, oldest first. Null where no row exists. */
  revenueTrend: Array<number | null>;
  /** The month this practice last reported. For a practice that has left, its last real numbers. */
  lastReportedLabel: string;
}

export interface MapModel {
  month: string;
  monthLabel: string;
  previousMonth: string;
  previousMonthLabel: string;
  practices: MapPractice[];
  regions: Array<{ name: string; practiceCount: number }>;
  mentors: Array<{ mentorId: string; name: string; practiceCount: number }>;
}

export function buildMapModel(dataset: Dataset, month?: string): MapModel {
  const months = monthsOf(dataset);
  const target = month && months.includes(month) ? month : months[months.length - 1];
  const targetIndex = months.indexOf(target);
  const previous = targetIndex > 0 ? months[targetIndex - 1] : target;

  const training = training_status(dataset, { asOf: '2026-10-12' });
  const trainingByPractice = new Map(training.byPractice.map((row) => [row.practiceId, row]));

  const attention = rank_attention(dataset, { asOf: '2026-10-12' });
  const attentionByPractice = new Map(attention.map((row) => [row.practiceId, row]));

  const refunds = refund_findings(dataset);
  const refundByPractice = new Map(refunds.map((row) => [row.practiceId, row]));

  const practices: MapPractice[] = dataset.practices.map((practice) => {
    const rowsFor = (month: string): ReturnType<typeof selectPerformance> =>
      selectPerformance(dataset, { practiceIds: [practice.practiceId], month });

    const currentRows = rowsFor(target);
    const reported = currentRows.length > 0;

    // A practice that stopped reporting (opened later, or left the group)
    // shows its last reported month instead of a month it was not there for.
    const lastReported = reported
      ? target
      : [...months].reverse().find((month) => rowsFor(month).length > 0) ?? target;
    const lastIndex = months.indexOf(lastReported);
    const previousRows = reported
      ? rowsFor(previous)
      : lastIndex > 0
        ? rowsFor(months[lastIndex - 1])
        : [];

    const now = aggregateMetrics(currentRows.length > 0 ? currentRows : rowsFor(lastReported), 1);
    const before = aggregateMetrics(previousRows, 1);

    const revenueMoMPct = before.revenue.actual > 0
      ? ((now.revenue.actual - before.revenue.actual) / before.revenue.actual) * 100
      : 0;
    const conversionMoMPp = now.conversion.ratePct - before.conversion.ratePct;

    const trend = months
      .slice(0, targetIndex + 1)
      .map((month) => {
        const rows = rowsFor(month);
        return rows.length > 0 ? aggregateMetrics(rows, 1).revenue.actual : null;
      });

    const t = trainingByPractice.get(practice.practiceId);
    const a = attentionByPractice.get(practice.practiceId);
    const r = refundByPractice.get(practice.practiceId);

    return {
      practiceId: practice.practiceId,
      name: practiceDisplayName(dataset, practice.practiceId),
      region: practice.region,
      manager: practice.manager,
      mentorId: practice.mentorId,
      mentorName: practice.mentorName,
      pmsSystem: practice.pmsSystem,
      reported,

      revenue: now.revenue.actual,
      revenueDisplay: now.revenue.actualDisplay,
      revenueTargetDisplay: now.revenue.targetDisplay,
      revenueAttainmentPct: now.revenue.attainmentPct,
      revenueAttainmentDisplay: now.revenue.attainmentDisplay,
      revenueMoMPct,
      revenueMoMDisplay: formatSignedPercent(revenueMoMPct),

      conversionPct: now.conversion.ratePct,
      conversionDisplay: now.conversion.rateDisplay,
      conversionMoMPp,
      conversionMoMDisplay: formatSignedPp(conversionMoMPp),
      conversionTargetPct: now.conversion.targetPct,

      clAttainmentPct: now.contactLens.attainmentPct,
      clAttainmentDisplay: now.contactLens.attainmentDisplay,
      clActualDisplay: now.contactLens.actualDisplay,
      clTargetDisplay: now.contactLens.targetDisplay,

      trainingCompletionPct: t?.completionPct ?? 100,
      trainingCompletionDisplay: t?.completionDisplay ?? '100%',
      trainingOverdue: t?.overdueCount ?? 0,
      trainingGaps: t?.gaps.map((gap) => gap.moduleName) ?? [],
      trainingStatus: t?.status ?? 'complete',

      refundTotal: r?.latestTotal ?? 0,
      refundCount: r?.latestCount ?? 0,
      refundLatestDisplay: r?.latestTotalDisplay ?? formatMoney(0),
      refundRatePct: r?.ratePct ?? 0,
      refundRateDisplay: r?.rateDisplay ?? formatPercent(0),
      refundMoMDisplay: r?.momDisplay ?? '',
      refundFlags: r?.findings.map((finding) => finding.code) ?? [],

      attentionSignals: a?.signals.map((signal) => signal.evidence) ?? [],

      revenueTrend: trend,
      lastReportedLabel: monthLabel(lastReported),
    };
  });

  const regionCounts = new Map<string, number>();
  const mentorCounts = new Map<string, { name: string; count: number }>();
  for (const practice of dataset.practices) {
    regionCounts.set(practice.region, (regionCounts.get(practice.region) ?? 0) + 1);
    const mentor = mentorCounts.get(practice.mentorId) ?? { name: practice.mentorName, count: 0 };
    mentor.count += 1;
    mentorCounts.set(practice.mentorId, mentor);
  }

  return {
    month: target,
    monthLabel: monthLabel(target),
    previousMonth: previous,
    previousMonthLabel: monthLabel(previous),
    practices,
    regions: [...regionCounts.entries()].map(([name, practiceCount]) => ({ name, practiceCount })),
    mentors: [...mentorCounts.entries()].map(([mentorId, value]) => ({
      mentorId,
      name: value.name,
      practiceCount: value.count,
    })),
  };
}

/** Region leads and mentors, for the region level inspector. */
export function mapMeta(dataset: Dataset): { totalPractices: number; totalRegions: number } {
  return {
    totalPractices: dataset.practices.length,
    totalRegions: new Set(dataset.practices.map((p) => p.region)).size,
  };
}

/**
 * How each mentor's portfolio is performing.
 *
 * Revenue change uses portfolio totals; conversion change is the mean of the
 * practices so one large practice cannot dominate. This is an observed result
 * for the same cohort, not a causal estimate and not a ranking of people.
 */
export interface MentorPortfolio {
  mentorId: string;
  name: string;
  practiceCount: number;
  revenueDisplay: string;
  revenueChangePct: number;
  revenueChangeDisplay: string;
  conversionDisplay: string;
  conversionChangePp: number;
  conversionChangeDisplay: string;
  practicesImproving: number;
  /** Practices trading under 95% of their revenue target this month. */
  belowTargetCount: number;
  trainingGaps: number;
  practiceIds: string[];
}

export function mentor_portfolios(model: MapModel): MentorPortfolio[] {
  return model.mentors.map((mentor) => {
    const practices = model.practices.filter((practice) => practice.mentorId === mentor.mentorId);
    // A practice that stopped reporting keeps its place in the portfolio (the
    // map still highlights it) but its current numbers are not counted:
    // counting them would read as a collapse.
    const reported = practices.filter((practice) => practice.reported);

    const revenue = reported.reduce((total, practice) => total + practice.revenue, 0);
    const previousRevenue = reported.reduce((total, practice) => {
      // Recover the previous month from the published change.
      const factor = 1 + practice.revenueMoMPct / 100;
      return total + (factor > 0.01 ? practice.revenue / factor : practice.revenue);
    }, 0);
    const revenueChangePct = previousRevenue > 0 ? ((revenue - previousRevenue) / previousRevenue) * 100 : 0;

    const conversion = reported.length
      ? reported.reduce((total, practice) => total + practice.conversionPct, 0) / reported.length
      : 0;
    const conversionChangePp = reported.length
      ? reported.reduce((total, practice) => total + practice.conversionMoMPp, 0) / reported.length
      : 0;

    return {
      mentorId: mentor.mentorId,
      name: mentor.name,
      practiceCount: reported.length,
      revenueDisplay: formatMoney(revenue),
      revenueChangePct,
      revenueChangeDisplay: formatSignedPercent(revenueChangePct),
      conversionDisplay: formatPercent(conversion),
      conversionChangePp,
      conversionChangeDisplay: formatSignedPp(conversionChangePp),
      practicesImproving: reported.filter((practice) => practice.revenueMoMPct > 0).length,
      belowTargetCount: reported.filter((practice) => practice.revenueAttainmentPct < 95).length,
      trainingGaps: reported.filter((practice) => practice.trainingCompletionPct < 100).length,
      practiceIds: practices.map((practice) => practice.practiceId),
    };
  });
}
