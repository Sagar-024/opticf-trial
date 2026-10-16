import { monthLabel } from '../lib/months';
import type { TableWidget, Widget } from './types';

/**
 * The live trace narrates each tool step in the reader's words, using only
 * what the tool really returned: counts and names are read from the real
 * output, never invented. An unfamiliar shape yields {} so the UI falls back
 * to the plain step label, and nothing here ever throws.
 */

export interface ToolStepDetail {
  detail?: string;
  items?: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty string field, trimmed; undefined for anything else. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function widgetsOf(output: unknown): Widget[] {
  const widgets = asRecord(output)?.widgets;
  return Array.isArray(widgets) ? (widgets as Widget[]) : [];
}

/** The table a tool built under its known widget id, or null. */
function tableById(output: unknown, id: string): TableWidget | null {
  for (const widget of widgetsOf(output)) {
    const record = asRecord(widget);
    if (record && record.type === 'table' && record.id === id) return widget as TableWidget;
  }
  return null;
}

/** The string rows of a table, defensively. */
function rowsOf(table: TableWidget | null): string[][] {
  if (!table || !Array.isArray(table.rows)) return [];
  return table.rows.filter((row): row is string[] => Array.isArray(row));
}

/** A `YYYY-MM` key as its human label; anything else is not a month. */
function monthText(value: unknown): string | undefined {
  const key = asString(value);
  return key && /^\d{4}-\d{2}$/.test(key) ? monthLabel(key) : undefined;
}

/** "1 practice" / "2 practices". */
function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** search_brain lists every document it chose, in its own table and sources. */
function searchBrainStep(output: unknown): ToolStepDetail {
  const record = asRecord(output);
  const table = tableById(output, 'brain-table');
  let titles: string[] | null = null;
  if (table) {
    // The guidance table's second column is the document title.
    titles = rowsOf(table)
      .map((row) => row[1])
      .filter((title): title is string => typeof title === 'string' && title.length > 0);
  } else if (record && Array.isArray(record.sources)) {
    // Each returned document is also named as a "Brain: <title>" source.
    const sources: unknown[] = record.sources;
    titles = sources
      .filter((source): source is string => typeof source === 'string' && source.startsWith('Brain: '))
      .map((source) => source.slice('Brain: '.length));
  }
  if (!titles) return {};
  return {
    detail: `Found ${titles.length} ${plural(titles.length, 'note', 'notes')} in your saved notes`,
    items: titles.slice(0, 3),
  };
}

/** get_practice's context table is titled "<name> - context" once resolved. */
function getPracticeStep(input: unknown, output: unknown): ToolStepDetail {
  const title = asString(tableById(output, 'practice-table')?.title);
  const resolved = title && title.endsWith(' - context') ? title.slice(0, -' - context'.length) : undefined;
  // The name the model asked for is the fallback when the output resolved none.
  const name = resolved ?? asString(asRecord(input)?.practice_id);
  if (!name) return {};
  return { detail: `Looked up ${name}`, items: [] };
}

/** query_metrics reports its real month and level in the output context. */
function queryMetricsStep(input: unknown, output: unknown): ToolStepDetail {
  const context = asRecord(asRecord(output)?.context);
  const month = monthText(asRecord(context?.period)?.month) ?? monthText(asRecord(input)?.month);
  if (!month) return {};
  const detail = `Read ${asString(asRecord(input)?.metric) ?? 'your numbers'} for ${month}`;
  // A practice-level breakdown names the practices it grouped.
  const items: string[] = [];
  if (asString(context?.group_by) === 'practice') {
    for (const row of rowsOf(tableById(output, 'table-metrics-by-practice'))) {
      if (typeof row[0] === 'string' && row[0].length > 0) items.push(row[0]);
    }
  }
  return items.length > 0 ? { detail, items: items.slice(0, 3) } : { detail };
}

/** compare compares two real periods from the call's own arguments. */
function compareStep(input: unknown): ToolStepDetail {
  const args = asRecord(input);
  const periodA = asRecord(args?.period_a);
  const periodB = asRecord(args?.period_b);
  const current = monthText(periodA?.to) ?? monthText(periodA?.from);
  const previous = monthText(periodB?.to) ?? monthText(periodB?.from);
  if (!current || !previous) return {};
  return { detail: `Compared ${current} with ${previous}` };
}

/** The compare card names the practices the view actually built. */
function comparePracticesStep(output: unknown): ToolStepDetail {
  const widget = widgetsOf(output).find((entry) => asRecord(entry)?.type === 'compare');
  const view = asRecord(asRecord(widget)?.view);
  const sides = view && Array.isArray(view.sides) ? view.sides : [];
  const names = sides
    .map((side) => asString(asRecord(side)?.name))
    .filter((name): name is string => Boolean(name));
  if (names.length < 2) return {};
  return { detail: `Compared ${names[0]} with ${names[1]}` };
}

/** training_status: the table shows at most 20 rows, the summary the real total. */
function trainingStatusStep(output: unknown): ToolStepDetail {
  const table = tableById(output, 'training-table');
  if (!table) return {};
  const summary = asString(asRecord(output)?.summary) ?? '';
  const stated = Number(/across (\d+) practices/.exec(summary)?.[1]);
  const count = Number.isFinite(stated) ? stated : rowsOf(table).length;
  return { detail: `Checked training for ${count} ${plural(count, 'practice', 'practices')}` };
}

/** rank_attention ranks the practices listed in its own table. */
function rankAttentionStep(output: unknown): ToolStepDetail {
  const rows = rowsOf(tableById(output, 'attention-table'));
  if (rows.length === 0) return {};
  const names = rows
    .map((row) => row[0])
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
  return {
    detail: `Ranked ${rows.length} ${plural(rows.length, 'practice', 'practices')} by need`,
    items: names.slice(0, 3),
  };
}

/** below_cl_target: the table lists exactly the practices below target. */
function belowClTargetStep(output: unknown): ToolStepDetail {
  const base = 'Checked contact lens targets';
  const table = tableById(output, 'cl-table');
  if (!table) return { detail: base };
  const below = rowsOf(table).length;
  return { detail: `${base}, ${below} below target` };
}

/** today_priorities lists one table row per priority it found. */
function todayPrioritiesStep(output: unknown): ToolStepDetail {
  const table = tableById(output, 'today-table');
  if (!table) return {};
  const count = rowsOf(table).length;
  return { detail: `Read ${count} ${plural(count, 'priority', 'priorities')}` };
}

/** The trace detail for one step, from the tool's real arguments and output. */
export function toolStep(name: string, input: unknown, output: unknown): ToolStepDetail {
  try {
    switch (name) {
      case 'search_brain': return searchBrainStep(output);
      case 'query_metrics': return queryMetricsStep(input, output);
      case 'compare': return compareStep(input);
      case 'compare_practices': return comparePracticesStep(output);
      case 'training_status': return trainingStatusStep(output);
      case 'rank_attention': return rankAttentionStep(output);
      case 'today_priorities': return todayPrioritiesStep(output);
      case 'get_practice': return getPracticeStep(input, output);
      case 'below_cl_target': return belowClTargetStep(output);
      // highlight_on_map, build_dashboard and unknown tools keep the plain label.
      default: return {};
    }
  } catch {
    return {}; // A trace line must never break a tool call.
  }
}
