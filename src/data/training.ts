import type { Dataset, Practice, TrainingRecord } from '../domain/types';
import { formatPercent } from '../lib/format';

/**
 * `training_status` - per-practice training compliance.
 *
 * Answers "which practices haven't completed their training?" and feeds the
 * Today tab and the training map lens. Completion is computed from the raw
 * records so a percentage can never disagree with the modules behind it.
 */

export interface TrainingQuery {
  regions?: string[];
  practiceIds?: string[];
  /** ISO date used to judge overdue modules. Defaults to `2026-10-12`. */
  asOf?: string;
  /** When true, only return practices with at least one gap. */
  onlyIncomplete?: boolean;
}

export interface TrainingGap {
  moduleId: string;
  moduleName: string;
  required: boolean;
  dueDate: string;
  overdue: boolean;
}

export interface TrainingPracticeRow {
  practiceId: string;
  name: string;
  region: string;
  manager: string;
  /** Required modules assigned to the practice. */
  requiredModules: number;
  completedModules: number;
  completionPct: number;
  completionDisplay: string;
  /** Required modules not yet completed. */
  gaps: TrainingGap[];
  overdueCount: number;
  compliant: boolean;
  status: 'complete' | 'incomplete' | 'overdue';
}

export interface TrainingModuleRow {
  moduleId: string;
  moduleName: string;
  required: boolean;
  assigned: number;
  completed: number;
  completionPct: number;
  completionDisplay: string;
}

export interface TrainingStatusResult {
  asOf: string;
  summary: {
    practices: number;
    requiredModulesAssigned: number;
    requiredModulesCompleted: number;
    completionPct: number;
    completionDisplay: string;
    compliantPractices: number;
    practicesWithGaps: number;
    practicesOverdue: number;
  };
  byPractice: TrainingPracticeRow[];
  byModule: TrainingModuleRow[];
}

const DEFAULT_AS_OF = '2026-10-12';

function inScope(practice: Practice, query: TrainingQuery): boolean {
  if (query.practiceIds && query.practiceIds.length > 0) {
    return query.practiceIds.includes(practice.practiceId);
  }
  if (query.regions && query.regions.length > 0) {
    return query.regions.includes(practice.region);
  }
  return true;
}

/** Compute training compliance for the requested practices. */
export function training_status(dataset: Dataset, query: TrainingQuery = {}): TrainingStatusResult {
  const asOf = query.asOf ?? DEFAULT_AS_OF;

  const scoped = dataset.practices.filter((p) => inScope(p, query));

  const recordsByPractice = new Map<string, TrainingRecord[]>();
  for (const record of dataset.training) {
    const list = recordsByPractice.get(record.practiceId);
    if (list) list.push(record);
    else recordsByPractice.set(record.practiceId, [record]);
  }

  const byPractice: TrainingPracticeRow[] = scoped.map((practice) => {
    const records = recordsByPractice.get(practice.practiceId) ?? [];
    const required = records.filter((r) => r.required);
    const completed = required.filter((r) => r.completed);
    const gaps: TrainingGap[] = required
      .filter((r) => !r.completed)
      .map((r) => ({
        moduleId: r.moduleId,
        moduleName: r.moduleName,
        required: r.required,
        dueDate: r.dueDate,
        overdue: r.dueDate !== '' && r.dueDate < asOf,
      }));
    const overdueCount = gaps.filter((g) => g.overdue).length;
    const completionPct = required.length > 0 ? (completed.length / required.length) * 100 : 100;

    return {
      practiceId: practice.practiceId,
      name: practice.name,
      region: practice.region,
      manager: practice.manager,
      requiredModules: required.length,
      completedModules: completed.length,
      completionPct,
      completionDisplay: formatPercent(completionPct, 0),
      gaps,
      overdueCount,
      compliant: gaps.length === 0,
      status: gaps.length === 0 ? 'complete' : overdueCount > 0 ? 'overdue' : 'incomplete',
    };
  });

  // Group the same records by module for a secondary view.
  const moduleMap = new Map<string, TrainingModuleRow>();
  for (const practice of scoped) {
    const records = recordsByPractice.get(practice.practiceId) ?? [];
    for (const record of records) {
      const existing = moduleMap.get(record.moduleId) ?? {
        moduleId: record.moduleId,
        moduleName: record.moduleName,
        required: record.required,
        assigned: 0,
        completed: 0,
        completionPct: 0,
        completionDisplay: '',
      };
      existing.assigned += 1;
      if (record.completed) existing.completed += 1;
      moduleMap.set(record.moduleId, existing);
    }
  }
  const byModule = [...moduleMap.values()]
    .map((m) => {
      const completionPct = m.assigned > 0 ? (m.completed / m.assigned) * 100 : 100;
      return { ...m, completionPct, completionDisplay: formatPercent(completionPct, 0) };
    })
    .sort((a, b) => a.moduleId.localeCompare(b.moduleId));

  const requiredModulesAssigned = byPractice.reduce((n, p) => n + p.requiredModules, 0);
  const requiredModulesCompleted = byPractice.reduce((n, p) => n + p.completedModules, 0);
  const completionPct = requiredModulesAssigned > 0
    ? (requiredModulesCompleted / requiredModulesAssigned) * 100
    : 100;

  const filtered = query.onlyIncomplete ? byPractice.filter((p) => !p.compliant) : byPractice;
  filtered.sort((a, b) => a.completionPct - b.completionPct || a.practiceId.localeCompare(b.practiceId));

  const summary = {
    practices: byPractice.length,
    requiredModulesAssigned,
    requiredModulesCompleted,
    completionPct,
    completionDisplay: formatPercent(completionPct, 1),
    compliantPractices: byPractice.filter((p) => p.compliant).length,
    practicesWithGaps: byPractice.filter((p) => !p.compliant).length,
    practicesOverdue: byPractice.filter((p) => p.overdueCount > 0).length,
  };

  return { asOf, summary, byPractice: filtered, byModule };
}
