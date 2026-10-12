import { describe, expect, it } from 'vitest';
import { getTool } from '../src/ai/tools';
import { query_metrics } from '../src/data/metrics';
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
});
