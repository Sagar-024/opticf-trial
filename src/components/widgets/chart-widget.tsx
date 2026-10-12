'use client';

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import type { ChartWidget as ChartWidgetType } from '@/ai/types';

/**
 * Renders a chart widget produced by a tool. The server supplies values and
 * pre-formatted display strings; this component only draws them, it never
 * computes a figure. The tooltip quotes the server's display string exactly.
 */

const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

interface TooltipEntry {
  dataKey?: string | number;
  value?: number | string;
  color?: string;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}

function compactAxis(value: number, valueType: ChartWidgetType['valueType']): string {
  if (valueType === 'percent') return `${Math.round(value)}%`;
  if (valueType === 'number') return value >= 1000 ? `${Math.round(value / 1000)}k` : String(Math.round(value));
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `£${Math.round(value / 1000)}k`;
  return `£${Math.round(value)}`;
}

export function ChartWidget({ widget }: { widget: ChartWidgetType }) {
  const labels = widget.series[0]?.points.map((point) => point.label) ?? [];

  // A chart needs at least two points to say anything. The server avoids
  // emitting these, but hide it defensively rather than draw one giant bar.
  if (labels.length < 2) return null;

  const keys = widget.series.map((_, index) => `s${index}`);

  const data = labels.map((label, pointIndex) => {
    const row: Record<string, string | number> = { label };
    widget.series.forEach((series, seriesIndex) => {
      row[keys[seriesIndex]] = series.points[pointIndex]?.value ?? 0;
    });
    return row;
  });

  // Server-formatted display strings, looked up per series and category.
  const display = new Map<string, string>();
  widget.series.forEach((series, seriesIndex) => {
    series.points.forEach((point) => display.set(`${seriesIndex}|${point.label}`, point.display));
  });

  const config: ChartConfig = {};
  widget.series.forEach((series, index) => {
    config[keys[index]] = { label: series.name, color: COLORS[index % COLORS.length] };
  });

  function TooltipCard({ active, payload, label }: TooltipProps) {
    if (!active || !payload || payload.length === 0) return null;
    return (
      <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-soft">
        <p className="mb-1 font-medium">{label}</p>
        {payload.map((entry) => {
          const seriesIndex = keys.indexOf(String(entry.dataKey));
          const value = display.get(`${seriesIndex}|${String(label)}`) ?? String(entry.value ?? '');
          return (
            <div key={String(entry.dataKey)} className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full" style={{ background: entry.color }} />
              <span className="text-muted-foreground">{widget.series[seriesIndex]?.name}</span>
              <span className="ml-auto font-medium">{value}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-panel">
      <p className="label-caps mb-3">{widget.title}</p>
      <ChartContainer config={config} className="h-60 w-full">
        <BarChart data={data} margin={{ left: 4, right: 8, top: 4 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 10 }}
            interval={0}
            angle={-18}
            textAnchor="end"
            height={54}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fontSize: 10 }}
            tickFormatter={(value: number) => compactAxis(value, widget.valueType)}
          />
          <Tooltip cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }} content={<TooltipCard />} />
          {widget.series.map((series, index) => (
            <Bar
              key={keys[index]}
              dataKey={keys[index]}
              fill={`var(--color-${keys[index]})`}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </div>
  );
}
