import type { Widget } from '@/ai/types';

/** The side panel stays legible to about three dozen bars; past that the full view reads better. */
export const DENSE_CHART_THRESHOLD = 38;

/** A chart whose longest series runs past what the side panel can hold. */
export function isDenseChart(widget: Widget): boolean {
  if (widget.type !== 'chart') return false;
  return Math.max(...widget.series.map((series) => series.points.length)) > DENSE_CHART_THRESHOLD;
}
