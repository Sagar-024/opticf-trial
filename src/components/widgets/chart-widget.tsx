'use client';

import { useMemo } from 'react';
import type { ChartWidget as ChartWidgetType } from '@/ai/types';
import { Bar } from '@/components/dither-kit/bar';
import { BarChart } from '@/components/dither-kit/bar-chart';
import { Legend } from '@/components/dither-kit/legend';
import type { DitherColor } from '@/components/dither-kit/palette';
import { Tooltip } from '@/components/dither-kit/tooltip';
import { XAxis } from '@/components/dither-kit/x-axis';
import { YAxis } from '@/components/dither-kit/y-axis';

/**
 * Renders a chart widget with Dither Kit.
 *
 * The server supplies values and pre-formatted display strings. The axis and
 * the tooltip both quote those strings, so a chart can never show a figure the
 * rest of the product disagrees with.
 */

const SERIES_COLORS: DitherColor[] = ['orange', 'blue', 'purple', 'green', 'pink'];

export function ChartWidget({ widget }: { widget: ChartWidgetType }) {
  const keys = useMemo(() => widget.series.map((_, index) => `s${index}`), [widget.series]);
  const labels = widget.series[0]?.points.map((point) => point.label) ?? [];

  const prepared = useMemo(() => {
    const data = labels.map((label, pointIndex) => {
      const row: Record<string, string | number> = { label };
      widget.series.forEach((series, seriesIndex) => {
        row[keys[seriesIndex]] = series.points[pointIndex]?.value ?? 0;
      });
      return row;
    });

    const config: Record<string, { label: string; color: DitherColor }> = {};
    const displayByKey = new Map<string, Map<number, string>>();

    widget.series.forEach((series, seriesIndex) => {
      const key = keys[seriesIndex];
      config[key] = { label: series.name, color: SERIES_COLORS[seriesIndex % SERIES_COLORS.length] };
      const byValue = new Map<number, string>();
      for (const point of series.points) byValue.set(point.value, point.display);
      displayByKey.set(key, byValue);
    });

    return { data, config, displayByKey };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget, keys]);

  // A chart needs at least two points to say anything.
  if (labels.length < 2) return null;

  const compactAxis = (value: number): string => {
    if (widget.valueType === 'percent') return `${Math.round(value)}%`;
    if (widget.valueType === 'number') {
      return Math.abs(value) >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value));
    }
    if (Math.abs(value) >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}m`;
    if (Math.abs(value) >= 1000) return `£${Math.round(value / 1000)}k`;
    return `£${Math.round(value)}`;
  };

  const formatValue = (value: number, name: string): string => {
    for (const key of keys) {
      if (prepared.config[key]?.label === name) {
        return prepared.displayByKey.get(key)?.get(value) ?? String(value);
      }
    }
    return String(value);
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-panel">
      <p className="label-caps mb-3">{widget.title}</p>
      <div className="h-60 w-full">
        <BarChart data={prepared.data} config={prepared.config} bloom="aura" bloomOnHover>
          <XAxis dataKey="label" maxTicks={6} />
          <YAxis tickFormatter={compactAxis} />
          {widget.series.map((series, index) => (
            <Bar key={keys[index]} dataKey={keys[index]} variant="gradient" />
          ))}
          <Legend isClickable />
          <Tooltip labelKey="label" valueFormatter={formatValue} />
        </BarChart>
      </div>
    </div>
  );
}
