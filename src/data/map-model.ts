import type { Dataset } from '../domain/types';
import { formatMoney, formatPercent, formatSignedPercent, formatSignedPp } from '../lib/format';
import { monthLabel } from '../lib/months';
import { monthsOf } from './dataset';
import { aggregateMetrics, selectPerformance } from './metrics';
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

  attentionScore: number;
  attentionBand: 'high' | 'medium' | 'low';
  attentionSignals: string[];

  /** Revenue for the last six months, oldest first. Used by the inspector. */
  revenueTrend: number[];
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

  const practices: MapPractice[] = dataset.practices.map((practice) => {
    const currentRows = selectPerformance(dataset, { practiceIds: [practice.practiceId], month: target });
    const previousRows = selectPerformance(dataset, { practiceIds: [practice.practiceId], month: previous });
    const now = aggregateMetrics(currentRows, 1);
    const before = aggregateMetrics(previousRows, 1);

    const revenueMoMPct = before.revenue.actual > 0
      ? ((now.revenue.actual - before.revenue.actual) / before.revenue.actual) * 100
      : 0;
    const conversionMoMPp = now.conversion.ratePct - before.conversion.ratePct;

    const trend = months
      .slice(0, targetIndex + 1)
      .map((m) => selectPerformance(dataset, { practiceIds: [practice.practiceId], month: m }))
      .map((rows) => aggregateMetrics(rows, 1).revenue.actual);

    const t = trainingByPractice.get(practice.practiceId);
    const a = attentionByPractice.get(practice.practiceId);

    return {
      practiceId: practice.practiceId,
      name: practice.name,
      region: practice.region,
      manager: practice.manager,
      mentorId: practice.mentorId,
      mentorName: practice.mentorName,
      pmsSystem: practice.pmsSystem,

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

      attentionScore: a?.score ?? 0,
      attentionBand: a?.band ?? 'low',
      attentionSignals: a?.signals.map((signal) => signal.evidence) ?? [],

      revenueTrend: trend,
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

export { formatMoney, formatPercent };
