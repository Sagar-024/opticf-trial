/**
 * Domain model for the Optific+ demo dataset.
 *
 * These types are the single source of truth for every number shown anywhere
 * in the product. UI, chat, charts, the map and the Today tab must all read
 * from these rows via the pure functions in `src/data/*`. The LLM layer is
 * not allowed to compute or invent figures - it may only quote values that
 * these functions return.
 */

/** A UK month key, always `YYYY-MM`. */
export type MonthKey = string;

/** A practice within the group. */
export interface Practice {
  /** Stable id, e.g. `P001`. */
  practiceId: string;
  /** Trading name, e.g. `Chorlton`. */
  name: string;
  /** Region name, e.g. `North West`. */
  region: string;
  town: string;
  postcode: string;
  /** Practice manager (person responsible locally). */
  manager: string;
  /** Group mentor who supports this practice. */
  mentorId: string;
  /** Display name of that mentor. */
  mentorName: string;
  /** Year the practice opened. */
  openedYear: number;
  /** Practice management system in use (fictional). */
  pmsSystem: string;
}

/**
 * One month of trading performance for one practice.
 *
 * Raw counts are stored (exams, purchases) and rates are *derived* in the data
 * layer, so a conversion rate can never disagree with the counts behind it.
 */
export interface MonthlyPerformance {
  practiceId: string;
  month: MonthKey;
  /** Revenue in whole GBP. */
  revenue: number;
  /** Revenue plan for the month, whole GBP. */
  revenueTarget: number;
  /** Completed eye examinations. */
  eyeExams: number;
  /** Eye examinations that converted to a purchase. */
  purchases: number;
  /** Conversion plan, as a percentage (e.g. 64 means 64%). */
  conversionTarget: number;
  /** Contact-lens revenue, whole GBP. */
  clRevenue: number;
  /** Contact-lens revenue plan for the month, whole GBP. */
  clTarget: number;
}

/** A required training module and whether a practice has completed it. */
export interface TrainingRecord {
  practiceId: string;
  moduleId: string;
  moduleName: string;
  /** Required modules count towards compliance; optional ones do not. */
  required: boolean;
  completed: boolean;
  /** ISO date (`YYYY-MM-DD`) or empty string when not completed. */
  completedDate: string;
  /** ISO date by which the module was due. */
  dueDate: string;
}

/** The whole dataset, typically loaded once from the generated CSV files. */
export interface Dataset {
  practices: Practice[];
  performance: MonthlyPerformance[];
  training: TrainingRecord[];
}

/** Raw CSV text for each table - the on-disk representation of a Dataset. */
export interface RawDataset {
  practices: string;
  performance: string;
  training: string;
}
