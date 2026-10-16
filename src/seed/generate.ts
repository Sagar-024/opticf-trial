import type {
  Dataset,
  MonthlyPerformance,
  Practice,
  Refund,
  RefundReason,
  TrainingRecord,
} from '../domain/types';
import { seededFor } from '../lib/prng';
import {
  ABOVE_AUTHORITY_PRACTICES,
  CL_BELOW_TARGET,
  CL_TARGET_SHARE,
  COLLAPSE_MONTH,
  CONVERSION_OVERRIDES,
  CONVERSION_TARGET,
  DEFAULT_SEED,
  DIVESTED_AFTER,
  EXACT_TARGET_PRACTICES,
  GOODWILL_AUTHORITY_LIMIT,
  GOODWILL_CLUSTER_PRACTICES,
  MENTORS,
  MISSING_ORDER_REF_PRACTICES,
  MISSING_PERFORMANCE_MONTHS,
  MODULES,
  MONTHS,
  NEW_PRACTICE_REQUIRED_COMPLETE,
  NO_REFUND_PRACTICES,
  NORTH_WEST_REGION,
  NORTH_WEST_SHARP_DECLINE,
  OPENED_MID_WINDOW,
  PRACTICES,
  REFUND_SPIKE_PRACTICES,
  REVENUE_TARGET_UPLIFT,
  SEASONALITY,
  TRAINING_DATE_MISSING,
  TRAINING_GAP_PRACTICES,
  UNKNOWN_REASON_CODE,
  UNKNOWN_REASON_PRACTICES,
  ZERO_AMOUNT_REFUND_PRACTICES,
  type PracticeConfig,
} from './config';

/**
 * Pure, deterministic generation of the whole sample dataset.
 *
 * Given the same seed, `generateDataset` always returns byte-identical rows -
 * that is what makes the demo reproducible and the test suite meaningful.
 */

export interface GenerateOptions {
  /** Integer seed. Defaults to `DEFAULT_SEED`. */
  seed?: number;
}

/** Round to a sensible reporting granularity (nearest £10). */
function round10(n: number): number {
  return Math.round(n / 10) * 10;
}

/** A plausible completion date within the first three quarters of 2026. */
function completionDate(rng: () => number): string {
  const month = 1 + Math.floor(rng() * 8);
  const day = 1 + Math.floor(rng() * 28);
  return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Build the training records for one practice, honouring the planted gaps. */
function trainingFor(
  practiceId: string,
  index: number,
  rng: () => number,
): TrainingRecord[] {
  const requiredModules = MODULES.filter((m) => m.required);
  const isGap = TRAINING_GAP_PRACTICES.includes(practiceId);
  const newComplete = NEW_PRACTICE_REQUIRED_COMPLETE[practiceId];
  const dateMissing = TRAINING_DATE_MISSING[practiceId] ?? [];

  // A deterministic rotation selects which required modules are missing.
  const missingCount = isGap
    ? 1 + (index % 3)
    : newComplete !== undefined
      ? requiredModules.length - newComplete
      : 0;
  const rotation = index % requiredModules.length;
  const rotated = [...requiredModules.slice(rotation), ...requiredModules];
  const missing = new Set(rotated.slice(0, missingCount).map((m) => m.moduleId));

  // Alternate overdue vs simply-outstanding gaps. A new practice's gaps are
  // onboarding, never overdue.
  const overdue = isGap && index % 2 === 0;

  return MODULES.map((module) => {
    const isMissing = missing.has(module.moduleId);
    const completed = module.required ? !isMissing : index % 3 !== 0;

    let dueDate = '2026-12-31';
    if (module.required) {
      if (isMissing) dueDate = overdue ? '2026-08-31' : '2026-11-30';
      else dueDate = '2026-09-30';
    }

    return {
      practiceId,
      moduleId: module.moduleId,
      moduleName: module.moduleName,
      required: module.required,
      completed,
      // A recorded completion can still have lost its date upstream.
      completedDate: completed && !dateMissing.includes(module.moduleId) ? completionDate(rng) : '',
      dueDate,
    };
  });
}

/**
 * Build the refund rows for one practice, honouring the planted stories and
 * the active window (a practice that opened late or left early only has rows
 * for the months it reported).
 *
 * Background: a small mix of frame faults, fit issues, change-of-mind and the
 * occasional small gesture. Stories: Chorlton's frame-fault spike climbs from
 * August, Plymouth leaves many gestures just under the authority line, and
 * Liverpool records one above the line without approval. Reading and Dundee
 * carry a reason code the app has never seen, Sale lost two order references,
 * Shrewsbury exported one voided payment at zero, and Lancaster records none.
 * Consumes `rng` after the performance and training streams, so adding refunds
 * never shifts them.
 */
function refundsFor(cfg: PracticeConfig, rng: () => number): Refund[] {
  if (NO_REFUND_PRACTICES.includes(cfg.practiceId)) return [];

  const rows: Refund[] = [];
  const isSpike = REFUND_SPIKE_PRACTICES.includes(cfg.practiceId);
  const isCluster = GOODWILL_CLUSTER_PRACTICES.includes(cfg.practiceId);
  const isAbove = ABOVE_AUTHORITY_PRACTICES.includes(cfg.practiceId);
  const isUnknown = UNKNOWN_REASON_PRACTICES.includes(cfg.practiceId);
  const opened = OPENED_MID_WINDOW[cfg.practiceId];
  const divested = DIVESTED_AFTER[cfg.practiceId];

  const push = (month: string, amount: number, reason: RefundReason, escalated: boolean): void => {
    const day = 1 + Math.floor(rng() * 28);
    rows.push({
      refundId: '', // numbered in one deterministic pass in generateDataset
      practiceId: cfg.practiceId,
      date: `${month}-${String(day).padStart(2, '0')}`,
      amount: Math.round(amount),
      reason,
      orderRef: `O-${10000 + Math.floor(rng() * 89999)}`,
      authorisedBy: cfg.manager,
      escalated,
    });
  };

  MONTHS.forEach((month, t) => {
    const inWindow =
      (!opened || month >= opened.fromMonth) &&
      (!divested || month <= divested.lastMonth);
    if (!inWindow) return;

    const isLatest = t === MONTHS.length - 1;

    if (isCluster) {
      // Story 5: gestures just under the £50 authority line, month after month.
      const gestures = isLatest ? 5 : 4 + Math.floor(rng() * 3);
      for (let i = 0; i < gestures; i += 1) {
        push(month, 41 + Math.floor(rng() * 8), 'goodwill', false);
      }
      return;
    }

    // Background: one to three payments, mixed reasons.
    const count = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < count; i += 1) {
      const roll = rng();
      if (roll < 0.32) push(month, 90 + rng() * 140, 'frame-fault', false);
      else if (roll < 0.55) push(month, 55 + rng() * 85, 'lens-fit', false);
      else if (roll < 0.8) push(month, 45 + rng() * 105, 'change-of-mind', false);
      else push(month, 20 + rng() * 28, 'goodwill', false);
    }

    // The rare, compliant above-limit gesture elsewhere in the group.
    if (!isAbove && rng() < 0.06) {
      push(month, 55 + rng() * 35, 'goodwill', true);
    }

    if (isSpike) {
      // Story 4: frame replacements climb from August (t=3) and peak in the
      // latest month, alongside the refit and supply-account context in the Brain.
      if (t === 3) {
        push(month, 130 + rng() * 120, 'frame-fault', false);
        push(month, 110 + rng() * 100, 'frame-fault', false);
      } else if (t === 4) {
        push(month, 150 + rng() * 140, 'frame-fault', false);
        push(month, 170 + rng() * 130, 'frame-fault', false);
        push(month, 140 + rng() * 110, 'frame-fault', false);
        push(month, 80 + rng() * 60, 'lens-fit', false);
      } else if (t === 5) {
        for (let i = 0; i < 5; i += 1) {
          push(month, 170 + rng() * 200, 'frame-fault', false);
        }
        push(month, 150 + rng() * 60, 'change-of-mind', false);
      }
    }

    if (isAbove && t >= 3) {
      // Story 6: above the authority line, with no regional lead recorded.
      push(month, GOODWILL_AUTHORITY_LIMIT + 5 + rng() * 45, 'goodwill', false);
    }

    if (isUnknown) {
      // The source system emitted a reason code the app has never seen. The
      // seed writes it raw, exactly as an export would; the parser is the
      // boundary that normalises it (see parseRefunds).
      push(month, 60 + rng() * 90, UNKNOWN_REASON_CODE as RefundReason, false);
    }
  });

  // Two rows in Sale's export lost their order reference.
  if (MISSING_ORDER_REF_PRACTICES.includes(cfg.practiceId)) {
    if (rows[0]) rows[0].orderRef = '';
    if (rows[5]) rows[5].orderRef = '';
  }

  // One voided payment at Shrewsbury was exported with amount zero.
  if (ZERO_AMOUNT_REFUND_PRACTICES.includes(cfg.practiceId) && rows[2]) {
    rows[2].amount = 0;
  }

  return rows;
}

/** P001 -> 0, P042 -> 41. Stable across roster edits, unlike the array position. */
function practiceIndex(practiceId: string): number {
  const n = Number.parseInt(practiceId.slice(1), 10);
  return Number.isFinite(n) ? n - 1 : 0;
}

/** Generate the full dataset. */
export function generateDataset(options: GenerateOptions = {}): Dataset {
  const seed = options.seed ?? DEFAULT_SEED;

  const practices: Practice[] = PRACTICES.map((cfg) => ({
    practiceId: cfg.practiceId,
    name: cfg.name,
    region: cfg.region,
    town: cfg.town,
    postcode: cfg.postcode,
    manager: cfg.manager,
    mentorId: cfg.mentorId,
    mentorName: MENTORS.find((m) => m.mentorId === cfg.mentorId)?.name ?? cfg.mentorId,
    openedYear: cfg.openedYear,
    pmsSystem: cfg.pmsSystem,
  }));

  const performance: MonthlyPerformance[] = [];
  const training: TrainingRecord[] = [];
  const refunds: Refund[] = [];

  PRACTICES.forEach((cfg) => {
    // Identity, not roster position: inserting a practice must never
    // reshuffle another practice's training rotation.
    const index = practiceIndex(cfg.practiceId);
    const rng = seededFor(seed, cfg.practiceId);
    const isNorthWest = cfg.region === NORTH_WEST_REGION;
    const isSharp = NORTH_WEST_SHARP_DECLINE.includes(cfg.practiceId);
    const clBelow = CL_BELOW_TARGET.includes(cfg.practiceId);
    const base = cfg.monthlyBaseline;
    const opened = OPENED_MID_WINDOW[cfg.practiceId];
    const divested = DIVESTED_AFTER[cfg.practiceId];
    const missingMonths = MISSING_PERFORMANCE_MONTHS[cfg.practiceId] ?? [];
    const collapse = COLLAPSE_MONTH[cfg.practiceId];
    const exactTarget = EXACT_TARGET_PRACTICES.includes(cfg.practiceId);
    const lastT = MONTHS.length - 1;

    // Revenue trend per month: the North West declines, the rest grows gently.
    const regionDrift = isNorthWest ? (isSharp ? -0.03 : -0.015) : 0.006;
    const practiceDrift = (rng() - 0.5) * 0.004;

    // Contact-lens share of revenue: low for the planted under-performers.
    const clShare = clBelow ? 0.1 : 0.16;

    // Conversion path, in percent.
    const override = CONVERSION_OVERRIDES[cfg.practiceId];
    const convStart = override ? override.start : isNorthWest ? 66 : 64 + (rng() - 0.5) * 2;
    const convEnd = override
      ? override.end
      : isNorthWest
        ? isSharp ? 52 : 56
        : 64 + rng() * 5;

    const examBase = base / 210;
    const clTarget = round10(base * CL_TARGET_SHARE);

    // A practice that lands exactly on plan does so in the latest two months,
    // so the change reads as flat and the attainment reads 100 percent.
    const exactRevenue = exactTarget
      ? round10(base * REVENUE_TARGET_UPLIFT * (1 + 0.004 * lastT))
      : null;

    MONTHS.forEach((month, t) => {
      const seasonal = SEASONALITY[t];
      const noise = (rng() - 0.5) * 0.03;

      let revenue = round10(base * (1 + (regionDrift + practiceDrift) * t + noise) * seasonal);
      if (exactRevenue !== null && t >= lastT - 1) revenue = exactRevenue;
      if (collapse && month === collapse.month) revenue = round10(revenue * collapse.revenueFactor);
      const revenueTarget = round10(base * REVENUE_TARGET_UPLIFT * (1 + 0.004 * t));

      // Examinations broadly stable in the North West, growing elsewhere.
      const examGrowth = isNorthWest ? 1 + 0.003 * t : 1 + 0.008 * t;
      let exams = Math.round(examBase * examGrowth * (1 + (rng() - 0.5) * 0.02));
      if (collapse && month === collapse.month) exams = Math.round(exams * collapse.examFactor);

      const fraction = MONTHS.length > 1 ? t / (MONTHS.length - 1) : 0;
      const convRate = convStart + (convEnd - convStart) * fraction + (rng() - 0.5) * 0.6;
      const purchases = Math.min(exams, Math.round((exams * convRate) / 100));

      // A practice only reports for the months it was part of the estate.
      const reported =
        (!opened || month >= opened.fromMonth) &&
        (!divested || month <= divested.lastMonth) &&
        !missingMonths.includes(month);
      if (!reported) return;

      performance.push({
        practiceId: cfg.practiceId,
        month,
        revenue,
        revenueTarget,
        eyeExams: exams,
        purchases,
        conversionTarget: CONVERSION_TARGET,
        clRevenue: round10(revenue * clShare),
        clTarget,
      });
    });

    training.push(...trainingFor(cfg.practiceId, index, rng));
    refunds.push(...refundsFor(cfg, rng));
  });

  // One deterministic numbering pass: practice, then date, then generation
  // order, so the ids (and the CSV) are byte-identical for a given seed.
  const numbered = refunds
    .map((refund, sourceIndex) => ({ refund, sourceIndex }))
    .sort(
      (a, b) =>
        a.refund.practiceId.localeCompare(b.refund.practiceId) ||
        a.refund.date.localeCompare(b.refund.date) ||
        a.sourceIndex - b.sourceIndex,
    )
    .map(({ refund }, index) => ({ ...refund, refundId: `R${String(index + 1).padStart(5, '0')}` }));

  return { practices, performance, training, refunds: numbered };
}
