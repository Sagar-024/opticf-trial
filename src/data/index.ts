/**
 * Public surface of the data layer.
 *
 * Everything the app (chat, BI, map, Today) needs to read numbers is exported
 * here. Each function is pure and takes an already-loaded `Dataset`, so the
 * same call powers a chart, a table and a chat answer identically.
 */

export type {
  Dataset,
  MonthKey,
  MonthlyPerformance,
  Practice,
  RawDataset,
  TrainingRecord,
} from '../domain/types';

export {
  monthsOf,
  parseDataset,
  parsePerformance,
  parsePractices,
  parseTraining,
  practicesById,
  regionsOf,
  serializeDataset,
} from './dataset';

export { DATA_DIR, loadDatasetFromDir } from './load';

export {
  aggregateMetrics,
  query_metrics,
  query_metrics_for_month,
  query_metrics_mom,
  resolveMonths,
  resolvePracticeIds,
  selectPerformance,
} from './metrics';
export type {
  MetricsBreakdownRow,
  MetricsQuery,
  MetricsResult,
  SeriesMetrics,
} from './metrics';

export { compare, compare_latest_month } from './compare';
export type {
  CompareGroupBy,
  CompareMetric,
  CompareQuery,
  CompareResult,
  CompareRow,
  Period,
} from './compare';

export { training_status } from './training';
export type {
  TrainingGap,
  TrainingModuleRow,
  TrainingPracticeRow,
  TrainingQuery,
  TrainingStatusResult,
} from './training';

export { rank_attention } from './attention';
export type {
  AttentionOptions,
  AttentionRow,
  AttentionSignal,
  AttentionSignalCode,
} from './attention';

export { today_priorities } from './today';
export type {
  DashboardQuery,
  MapView,
  PracticeIssue,
  TodayIssue,
  TodayPriorities,
  TodayPriority,
} from './today';
