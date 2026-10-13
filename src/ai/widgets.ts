import type { Widget } from './types';

/**
 * Validate widget payloads before they leave the server.
 *
 * Widgets are built by our own tools, so this is a defensive boundary rather
 * than a security control: it guarantees the client never receives a shape it
 * cannot render, whatever a future tool does.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isWidget(value: unknown): value is Widget {
  if (!value || typeof value !== 'object') return false;
  const widget = value as Record<string, unknown>;
  if (typeof widget.id !== 'string' || typeof widget.title !== 'string') return false;

  if (widget.type === 'kpi') {
    return Array.isArray(widget.items) && widget.items.every((item) => {
      if (!item || typeof item !== 'object') return false;
      const entry = item as Record<string, unknown>;
      return typeof entry.label === 'string' && typeof entry.value === 'string'
        && (entry.sub === undefined || typeof entry.sub === 'string');
    });
  }

  if (widget.type === 'chart') {
    if (widget.chart !== 'bar' && widget.chart !== 'grouped-bar' && widget.chart !== 'line') return false;
    if (widget.valueType !== 'currency' && widget.valueType !== 'percent' && widget.valueType !== 'number') return false;
    if (!Array.isArray(widget.series)) return false;
    const series = widget.series as Array<Record<string, unknown>>;
    if (series.length === 0) return false;
    const lengths = series.map((entry) => (Array.isArray(entry.points) ? entry.points.length : -1));
    if (lengths.some((length) => length < 2)) return false;
    return series.every((entry) =>
      typeof entry.name === 'string' &&
      Array.isArray(entry.points) &&
      (entry.points as Array<Record<string, unknown>>).every((point) =>
        typeof point.label === 'string' && typeof point.value === 'number' && typeof point.display === 'string'),
    );
  }

  if (widget.type === 'table') {
    if (!isStringArray(widget.columns)) return false;
    if (!Array.isArray(widget.rows)) return false;
    return (widget.rows as unknown[]).every((row) => isStringArray(row));
  }

  return false;
}

export function validateWidgets(widgets: Widget[]): { widgets: Widget[]; dropped: number } {
  const valid = widgets.filter(isWidget);
  return { widgets: valid, dropped: widgets.length - valid.length };
}
