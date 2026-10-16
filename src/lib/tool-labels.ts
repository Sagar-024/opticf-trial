/**
 * Tool ids are for us; these phrases are for the person reading the answer.
 * Shared by the chat and the practice ask box so both narrate work the same way.
 */
export const TOOL_LABELS: Record<string, string> = {
  search_brain: 'checking your saved notes',
  query_metrics: 'reading your numbers',
  compare: 'comparing this month with last month',
  compare_practices: 'comparing your practices',
  training_status: 'checking training records',
  rank_attention: 'finding what needs attention',
  today_priorities: "reading today's priorities",
  get_practice: 'looking up the practice',
  below_cl_target: 'checking contact lens targets',
  highlight_on_map: 'showing them on the map',
  build_dashboard: 'building the chart',
};

/**
 * Where each tool's information comes from, in the reader's terms. The trace
 * names these sources so a reader can see the answer is grounded in their own
 * records, never invented.
 */
export const TOOL_SOURCE: Record<string, 'data' | 'notes'> = {
  query_metrics: 'data',
  compare: 'data',
  compare_practices: 'data',
  training_status: 'data',
  rank_attention: 'data',
  today_priorities: 'data',
  get_practice: 'data',
  below_cl_target: 'data',
  search_brain: 'notes',
};

/** The sources a run actually touched, data first, each named once. */
export function toolSources(tools: string[]): Array<'data' | 'notes'> {
  const seen = new Set<'data' | 'notes'>();
  for (const tool of tools) {
    const source = TOOL_SOURCE[tool];
    if (source) seen.add(source);
  }
  return (['data', 'notes'] as const).filter((source) => seen.has(source));
}

/** "your practice data", "your saved notes", or both; null when nothing was read. */
export function sourcePhrase(tools: string[]): string | null {
  const sources = toolSources(tools);
  if (sources.length === 0) return null;
  if (sources.length === 2) return 'your practice data and your saved notes';
  return sources[0] === 'data' ? 'your practice data' : 'your saved notes';
}

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ');
}
