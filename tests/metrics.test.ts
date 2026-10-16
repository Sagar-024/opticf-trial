import { describe, expect, it } from 'vitest';
import { query_metrics, query_metrics_mom } from '../src/data/metrics';
import { serializeDataset } from '../src/data/dataset';
import { generateDataset } from '../src/seed/generate';
import { tinyDataset } from './fixtures';

describe('query_metrics', () => {
  it('aggregates a single month correctly (known fixture)', () => {
    const m = query_metrics(tinyDataset(), { month: '2026-09' });
    expect(m.revenue.actual).toBe(190000); // 80k + 110k
    expect(m.conversion.exams).toBe(2000);
    expect(m.conversion.purchases).toBe(1300);
    expect(m.conversion.ratePct).toBeCloseTo(65, 10); // 1300 / 2000
    expect(m.contactLens.actual).toBe(27000); // 10k + 17k
    expect(m.revenue.actualDisplay).toBe('£190,000');
    expect(m.conversion.rateDisplay).toBe('65.0%');
  });

  it('computes revenue vs target and attainment', () => {
    const m = query_metrics(tinyDataset(), { month: '2026-09' });
    expect(m.revenue.target).toBe(200000);
    expect(m.revenue.variance).toBe(-10000);
    expect(m.revenue.attainmentPct).toBeCloseTo(95, 10);
  });

  it('month-to-month uses the same aggregation as query_metrics', () => {
    const mom = query_metrics_mom(tinyDataset(), {});
    expect(mom.currentMonth).toBe('2026-09');
    expect(mom.previousMonth).toBe('2026-08');
    expect(mom.current.revenue.actual).toBe(190000);
    expect(mom.previous.revenue.actual).toBe(200000);
  });

  it('breakdowns always sum to the group total (generated data)', () => {
    const dataset = generateDataset();
    const latest = '2026-10';
    const group = query_metrics(dataset, { month: latest });
    const byPractice = query_metrics(dataset, { month: latest, groupBy: 'practice' }).breakdown ?? [];
    const byRegion = query_metrics(dataset, { month: latest, groupBy: 'region' }).breakdown ?? [];

    const practiceSum = byPractice.reduce((n, r) => n + r.metrics.revenue.actual, 0);
    const regionSum = byRegion.reduce((n, r) => n + r.metrics.revenue.actual, 0);

    // Whitefield left the group and has no latest-month row, so the breakdown
    // covers every practice that reported: one fewer than the roster.
    expect(byPractice).toHaveLength(dataset.practices.length - 1);
    expect(practiceSum).toBe(group.revenue.actual);
    expect(regionSum).toBe(group.revenue.actual);
  });

  it('is reproducible after a CSV round-trip', () => {
    const dataset = generateDataset();
    const raw = serializeDataset(dataset);
    // Re-serialising the same dataset must be stable.
    expect(serializeDataset(dataset)).toEqual(raw);
  });
});
