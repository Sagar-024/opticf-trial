import type {
  Dataset,
  MonthlyPerformance,
  Practice,
  TrainingRecord,
} from '../domain/types';
import { seededFor } from '../lib/prng';
import {
  CL_BELOW_TARGET,
  CL_TARGET_SHARE,
  CONVERSION_OVERRIDES,
  CONVERSION_TARGET,
  DEFAULT_SEED,
  MENTORS,
  MODULES,
  MONTHS,
  NORTH_WEST_REGION,
  NORTH_WEST_SHARP_DECLINE,
  PRACTICES,
  REVENUE_TARGET_UPLIFT,
  SEASONALITY,
  TRAINING_GAP_PRACTICES,
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

  // A deterministic rotation selects which required modules are missing.
  const missingCount = isGap ? 1 + (index % 3) : 0;
  const rotation = index % requiredModules.length;
  const rotated = [...requiredModules.slice(rotation), ...requiredModules];
  const missing = new Set(rotated.slice(0, missingCount).map((m) => m.moduleId));

  // Alternate overdue vs simply-outstanding gaps.
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
      completedDate: completed ? completionDate(rng) : '',
      dueDate,
    };
  });
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

  PRACTICES.forEach((cfg, index) => {
    const rng = seededFor(seed, cfg.practiceId);
    const isNorthWest = cfg.region === NORTH_WEST_REGION;
    const isSharp = NORTH_WEST_SHARP_DECLINE.includes(cfg.practiceId);
    const clBelow = CL_BELOW_TARGET.includes(cfg.practiceId);
    const base = cfg.monthlyBaseline;

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

    MONTHS.forEach((month, t) => {
      const seasonal = SEASONALITY[t];
      const noise = (rng() - 0.5) * 0.03;

      const revenue = round10(base * (1 + (regionDrift + practiceDrift) * t + noise) * seasonal);
      const revenueTarget = round10(base * REVENUE_TARGET_UPLIFT * (1 + 0.004 * t));

      // Examinations broadly stable in the North West, growing elsewhere.
      const examGrowth = isNorthWest ? 1 + 0.003 * t : 1 + 0.008 * t;
      const exams = Math.round(examBase * examGrowth * (1 + (rng() - 0.5) * 0.02));

      const fraction = MONTHS.length > 1 ? t / (MONTHS.length - 1) : 0;
      const convRate = convStart + (convEnd - convStart) * fraction + (rng() - 0.5) * 0.6;
      const purchases = Math.min(exams, Math.round((exams * convRate) / 100));

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
  });

  return { practices, performance, training };
}
