/**
 * Tool ids are for us; these phrases are for the person reading the answer.
 * Shared by the chat and the practice ask box so both narrate work the same way.
 */
export const TOOL_LABELS: Record<string, string> = {
  search_brain: 'searching the Brain',
  query_metrics: 'reading the numbers',
  compare: 'comparing periods',
  compare_practices: 'comparing the practices',
  training_status: 'checking training',
  rank_attention: 'ranking attention',
  today_priorities: 'reading the priorities',
  get_practice: 'reading the practice',
  below_cl_target: 'checking contact lens targets',
  highlight_on_map: 'marking the map',
  build_dashboard: 'building the dashboard',
};

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ');
}
