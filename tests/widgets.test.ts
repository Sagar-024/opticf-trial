import { describe, expect, it } from 'vitest';
import type { Widget } from '../src/ai/types';
import { getTool } from '../src/ai/tools';
import { query_metrics } from '../src/data/metrics';
import { DENSE_CHART_THRESHOLD, isDenseChart } from '../src/lib/widgets';
import { generateDataset } from '../src/seed/generate';

/**
 * Widget shape regression tests. A group-level dashboard used to emit a single
 * bar and a one-row table, which is useless. These tests lock in the fix.
 */
describe('dashboard widgets', () => {
  const dataset = generateDataset();
  const group = query_metrics(dataset, { month: '2026-10' });

  it('charts the region breakdown when the request is group level', () => {
    const tool = getTool('build_dashboard')!;
    const output = tool.run(dataset, { metrics: ['revenue', 'conversion'], group_by: 'group' });

    const charts = output.widgets.filter((w) => w.type === 'chart');
    expect(charts.length).toBe(2);

    for (const chart of charts) {
      if (chart.type !== 'chart') continue;
      const points = chart.series[0].points;
      expect(points.length).toBeGreaterThanOrEqual(2); // never a single bar
      expect(chart.title).toMatch(/by region/);
    }
  });

  it('keeps the KPI card at group level while the chart breaks down by region', () => {
    const tool = getTool('build_dashboard')!;
    const output = tool.run(dataset, { metrics: ['revenue'], group_by: 'group' });
    const kpi = output.widgets.find((w) => w.type === 'kpi');
    expect(kpi?.type).toBe('kpi');
    if (kpi?.type === 'kpi') {
      expect(kpi.items[0].value).toBe(group.revenue.actualDisplay);
    }
    const table = output.widgets.find((w) => w.type === 'table');
    if (table?.type === 'table') {
      expect(table.rows.length).toBe(5); // five regions
      expect(table.title).toMatch(/by region/);
    }
  });

  it('labels region groups with region names, not practice names', () => {
    const tool = getTool('build_dashboard')!;
    const output = tool.run(dataset, { metrics: ['revenue'], group_by: 'group' });
    const chart = output.widgets.find((w) => w.type === 'chart');
    if (chart?.type === 'chart') {
      const labels = chart.series[0].points.map((point) => point.label).sort();
      expect(labels).toEqual(['Midlands', 'North West', 'Scotland', 'South East', 'South West']);
    }
  });

  it('emits no chart for a single practice scope', () => {
    const tool = getTool('build_dashboard')!;
    const output = tool.run(dataset, { metrics: ['revenue'], group_by: 'group', filters: { practiceIds: ['P001'] } });
    expect(output.widgets.some((w) => w.type === 'chart')).toBe(false);
    expect(output.widgets.some((w) => w.type === 'kpi')).toBe(true);
  });

  it('breaks down by practice when a single region is selected', () => {
    const tool = getTool('build_dashboard')!;
    const output = tool.run(dataset, { metrics: ['revenue'], group_by: 'group', filters: { regions: ['North West'] } });
    const chart = output.widgets.find((w) => w.type === 'chart');
    if (chart?.type === 'chart') {
      expect(chart.series[0].points.length).toBe(10); // ten North West practices
      expect(chart.title).toMatch(/by practice/);
    }
  });

  it('names the scope on the KPI card, never "Group" over region figures', () => {
    const tool = getTool('query_metrics')!;

    const region = tool.run(dataset, { month: '2026-10', regions: ['North West'] });
    const regionKpi = region.widgets.find((w) => w.type === 'kpi');
    if (regionKpi?.type === 'kpi') expect(regionKpi.title).toBe('North West metrics - Oct 2026');

    const whole = tool.run(dataset, { month: '2026-10' });
    const wholeKpi = whole.widgets.find((w) => w.type === 'kpi');
    if (wholeKpi?.type === 'kpi') expect(wholeKpi.title).toBe('Group metrics - Oct 2026');

    const one = tool.run(dataset, { month: '2026-10', practiceIds: ['P001'] });
    const oneKpi = one.widgets.find((w) => w.type === 'kpi');
    if (oneKpi?.type === 'kpi') expect(oneKpi.title).toBe('Chorlton metrics - Oct 2026');
  });

  it('names the scope on the dashboard card too', () => {
    const tool = getTool('build_dashboard')!;
    const output = tool.run(dataset, {
      metrics: ['revenue'],
      group_by: 'group',
      filters: { regions: ['North West'] },
    });
    const kpi = output.widgets.find((w) => w.type === 'kpi');
    if (kpi?.type === 'kpi') expect(kpi.title).toBe('North West dashboard - Oct 2026');
  });
});

/**
 * A dense chart is one the side panel cannot show legibly, so the dashboard
 * opens over the chat instead. These tests pin the threshold and the shape
 * checks that decide it.
 */
describe('isDenseChart', () => {
  const points = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ label: `Practice ${index + 1}`, value: index, display: `${index}` }));

  const chart = (seriesLengths: number[]): Widget => ({
    type: 'chart',
    id: 'chart-1',
    title: 'Revenue by practice',
    chart: 'bar',
    valueType: 'currency',
    series: seriesLengths.map((count, index) => ({ name: `Series ${index + 1}`, points: points(count) })),
  });

  it('treats a chart with more than 24 points as dense, and 24 or fewer as not', () => {
    expect(isDenseChart(chart([DENSE_CHART_THRESHOLD + 1]))).toBe(true);
    expect(isDenseChart(chart([DENSE_CHART_THRESHOLD]))).toBe(false);
  });

  it('treats a chart with six points as not dense', () => {
    expect(isDenseChart(chart([6]))).toBe(false);
  });

  it('never treats a table as dense', () => {
    const table: Widget = {
      type: 'table',
      id: 'table-1',
      title: 'Revenue by practice',
      columns: ['Practice', 'Revenue'],
      rows: [['Chorlton', '1200']],
    };
    expect(isDenseChart(table)).toBe(false);
  });

  it('looks at the longest series when a chart carries more than one', () => {
    expect(isDenseChart(chart([4, 42]))).toBe(true);
  });
});
