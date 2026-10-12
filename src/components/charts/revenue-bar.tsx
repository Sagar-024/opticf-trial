'use client';

import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

const data = [
  { region: 'North West', revenue: 746430 },
  { region: 'South East', revenue: 715930 },
  { region: 'South West', revenue: 660400 },
  { region: 'Midlands', revenue: 587680 },
  { region: 'Scotland', revenue: 571670 },
];

const config = { revenue: { label: 'Revenue', color: 'hsl(var(--chart-1))' } } satisfies ChartConfig;

/** Recharts must live in a client component (RSC cannot render it server-side). */
export function RevenueBar() {
  return (
    <ChartContainer config={config} className="h-40 w-full">
      <BarChart data={data} margin={{ left: 12, right: 12 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="region" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  );
}
