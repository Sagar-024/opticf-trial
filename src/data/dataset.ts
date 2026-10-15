import type { Dataset, MonthlyPerformance, Practice, RawDataset, Refund, RefundReason, TrainingRecord } from '../domain/types';
import { parseCsvObjects, toCsv } from '../lib/csv';
import { uniqueMonths } from '../lib/months';

/**
 * Parsing in and out of the CSV representation.
 *
 * These functions are pure: they take text and return typed rows (or vice
 * versa). File I/O lives only in `loadDatasetFromDir`, so everything else can
 * be unit-tested without touching the filesystem.
 */

function toInt(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function toFloat(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function toBool(value: string): boolean {
  return value === 'true' || value === '1' || value.toLowerCase() === 'yes';
}

const PRACTICE_HEADER = [
  'practice_id',
  'name',
  'region',
  'town',
  'postcode',
  'manager',
  'mentor_id',
  'mentor_name',
  'opened_year',
  'pms_system',
];

const PERFORMANCE_HEADER = [
  'practice_id',
  'month',
  'revenue',
  'revenue_target',
  'eye_exams',
  'purchases',
  'conversion_target',
  'cl_revenue',
  'cl_target',
];

const TRAINING_HEADER = [
  'practice_id',
  'module_id',
  'module_name',
  'required',
  'completed',
  'completed_date',
  'due_date',
];

const REFUND_HEADER = [
  'refund_id',
  'practice_id',
  'date',
  'amount',
  'reason',
  'order_ref',
  'authorised_by',
  'escalated',
];

const REFUND_REASON_VALUES: RefundReason[] = ['frame-fault', 'lens-fit', 'change-of-mind', 'goodwill'];

/** Parse the practices CSV into typed rows. */
export function parsePractices(csv: string): Practice[] {
  return parseCsvObjects(csv).map((r) => ({
    practiceId: r.practice_id,
    name: r.name,
    region: r.region,
    town: r.town,
    postcode: r.postcode,
    manager: r.manager,
    mentorId: r.mentor_id,
    mentorName: r.mentor_name,
    openedYear: toInt(r.opened_year),
    pmsSystem: r.pms_system,
  }));
}

/** Parse the monthly performance CSV into typed rows. */
export function parsePerformance(csv: string): MonthlyPerformance[] {
  return parseCsvObjects(csv).map((r) => ({
    practiceId: r.practice_id,
    month: r.month,
    revenue: toInt(r.revenue),
    revenueTarget: toInt(r.revenue_target),
    eyeExams: toInt(r.eye_exams),
    purchases: toInt(r.purchases),
    conversionTarget: toFloat(r.conversion_target),
    clRevenue: toInt(r.cl_revenue),
    clTarget: toInt(r.cl_target),
  }));
}

/** Parse the training CSV into typed rows. */
export function parseTraining(csv: string): TrainingRecord[] {
  return parseCsvObjects(csv).map((r) => ({
    practiceId: r.practice_id,
    moduleId: r.module_id,
    moduleName: r.module_name,
    required: toBool(r.required),
    completed: toBool(r.completed),
    completedDate: r.completed_date ?? '',
    dueDate: r.due_date ?? '',
  }));
}

/** Parse the refunds CSV into typed rows. Unknown reasons fall back to `goodwill`. */
export function parseRefunds(csv: string): Refund[] {
  return parseCsvObjects(csv).map((r) => ({
    refundId: r.refund_id,
    practiceId: r.practice_id,
    date: r.date,
    amount: toInt(r.amount),
    reason: REFUND_REASON_VALUES.includes(r.reason as RefundReason) ? (r.reason as RefundReason) : 'goodwill',
    orderRef: r.order_ref ?? '',
    authorisedBy: r.authorised_by ?? '',
    escalated: toBool(r.escalated),
  }));
}

/** Build a Dataset from raw CSV text. */
export function parseDataset(raw: RawDataset): Dataset {
  return {
    practices: parsePractices(raw.practices),
    performance: parsePerformance(raw.performance),
    training: parseTraining(raw.training),
    refunds: parseRefunds(raw.refunds),
  };
}

/** Serialise a Dataset back to CSV text, in ascending month order. */
export function serializeDataset(dataset: Dataset): RawDataset {
  const practices = toCsv(
    PRACTICE_HEADER,
    dataset.practices.map((p) => [
      p.practiceId,
      p.name,
      p.region,
      p.town,
      p.postcode,
      p.manager,
      p.mentorId,
      p.mentorName,
      p.openedYear,
      p.pmsSystem,
    ]),
  );

  const performance = toCsv(
    PERFORMANCE_HEADER,
    [...dataset.performance]
      .sort((a, b) => (a.practiceId === b.practiceId ? a.month.localeCompare(b.month) : a.practiceId.localeCompare(b.practiceId)))
      .map((m) => [
        m.practiceId,
        m.month,
        m.revenue,
        m.revenueTarget,
        m.eyeExams,
        m.purchases,
        m.conversionTarget,
        m.clRevenue,
        m.clTarget,
      ]),
  );

  const training = toCsv(
    TRAINING_HEADER,
    [...dataset.training]
      .sort((a, b) => (a.practiceId === b.practiceId ? a.moduleId.localeCompare(b.moduleId) : a.practiceId.localeCompare(b.practiceId)))
      .map((t) => [
        t.practiceId,
        t.moduleId,
        t.moduleName,
        t.required,
        t.completed,
        t.completedDate,
        t.dueDate,
      ]),
  );

  const refunds = toCsv(
    REFUND_HEADER,
    [...dataset.refunds]
      .sort((a, b) =>
        a.practiceId === b.practiceId
          ? a.date === b.date
            ? a.refundId.localeCompare(b.refundId)
            : a.date.localeCompare(b.date)
          : a.practiceId.localeCompare(b.practiceId),
      )
      .map((r) => [
        r.refundId,
        r.practiceId,
        r.date,
        r.amount,
        r.reason,
        r.orderRef,
        r.authorisedBy,
        r.escalated,
      ]),
  );

  return { practices, performance, training, refunds };
}

/** Ascending list of month keys present in the dataset. */
export function monthsOf(dataset: Dataset): string[] {
  return uniqueMonths(dataset.performance.map((p) => p.month));
}

/** Index practices by id. */
export function practicesById(dataset: Dataset): Map<string, Practice> {
  return new Map(dataset.practices.map((p) => [p.practiceId, p]));
}

/** Distinct region names, in first-seen order. */
export function regionsOf(dataset: Dataset): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of dataset.practices) {
    if (!seen.has(p.region)) {
      seen.add(p.region);
      out.push(p.region);
    }
  }
  return out;
}
