'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { ChartWidget as ChartWidgetType } from '@/ai/types';

/**
 * Renders a chart widget produced by a tool. The server supplies values and
 * display strings; this component only draws them. It never computes figures.
 */
const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

export function ChartWidget({ widget }: { widget: ChartWidgetType }) {
  const labels = widget.series[0]?.points.map((point) => point.label) ?? [];
  // Safe CSS var keys (series names can contain spaces).
  const keys = widget.series.map((_, index) => `s${index}`);

  const data = labels.map((label, pointIndex) => {
    const row: Record<string, string | number> = { label };
    widget.series.forEach((series, seriesIndex) => {
      row[keys[seriesIndex]] = series.points[pointIndex]?.value ?? 0;
    });
    return row;
  });

  const config: ChartConfig = {};
  widget.series.forEach((series, index) => {
    config[keys[index]] = { label: series.name, color: COLORS[index % COLORS.length] };
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-panel">
      <p className="label-caps mb-3">{widget.title}</p>
      <ChartContainer config={config} className="h-56 w-full">
        <BarChart data={data} margin={{ left: 4, right: 4 }}>
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
          <YAxis hide />
          <ChartTooltip content={<ChartTooltipContent />} />
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
