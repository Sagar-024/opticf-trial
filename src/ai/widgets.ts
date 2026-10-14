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

  // The comparison card renders whatever the builder produced, so the check is
  // about shape: at least two named sides, rows with one bar per side, and
  // readable strings.
  if (widget.type === 'compare') {
    const view = widget.view as Record<string, unknown> | undefined;
    if (!view || typeof view !== 'object') return false;
    if (typeof view.title !== 'string' || typeof view.monthLabel !== 'string') return false;
    if (!Array.isArray(view.sides) || view.sides.length < 2 || !view.sides.every(isSide)) return false;
    if (!Array.isArray(view.rows) || view.rows.length === 0) return false;
    if (!isStringArray(view.summary)) return false;
    const sideCount = view.sides.length;
    return (view.rows as unknown[]).every((row) => isCompareRow(row, sideCount));
  }

  return false;
}

function isSide(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const side = value as Record<string, unknown>;
  return typeof side.practiceId === 'string' && typeof side.name === 'string' && typeof side.region === 'string';
}

function isBar(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const bar = value as Record<string, unknown>;
  return typeof bar.fraction === 'number' && typeof bar.display === 'string' && typeof bar.origin === 'number';
}

function isCompareRow(value: unknown, sideCount: number): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.label !== 'string') return false;
  if (typeof row.lead !== 'number') return false;
  if (!Array.isArray(row.bars) || row.bars.length !== sideCount) return false;
  return (row.bars as unknown[]).every(isBar);
}

export function validateWidgets(widgets: Widget[]): { widgets: Widget[]; dropped: number } {
  const valid = widgets.filter(isWidget);
  return { widgets: valid, dropped: widgets.length - valid.length };
}
