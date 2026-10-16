import type { Widget } from '@/ai/types';

/** The side panel holds roughly two dozen bars legibly; past that the full view reads better. */
export const DENSE_CHART_THRESHOLD = 24;

/** A chart whose longest series runs past what the side panel can hold. */
export function isDenseChart(widget: Widget): boolean {
  if (widget.type !== 'chart') return false;
  return Math.max(...widget.series.map((series) => series.points.length)) > DENSE_CHART_THRESHOLD;
}
