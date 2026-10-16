import { describe, expect, it } from 'vitest';
import { compare, compare_latest_month } from '../src/data/compare';
import { query_metrics } from '../src/data/metrics';
import { generateDataset } from '../src/seed/generate';
import { NORTH_WEST_REGION } from '../src/seed/config';
import { tinyDataset } from './fixtures';

describe('compare', () => {
  it('computes a group delta for known fixtures', () => {
    const result = compare(tinyDataset(), {
      metric: 'revenue',
      groupBy: 'group',
      periodA: { from: '2026-09', to: '2026-09' },
      periodB: { from: '2026-08', to: '2026-08' },
    });
    const row = result.rows[0];
    expect(row.current).toBe(190000);
    expect(row.previous).toBe(200000);
    expect(row.delta).toBe(-10000);
    expect(row.deltaPct).toBeCloseTo(-5, 10);
    expect(row.direction).toBe('down');
  });

  it('conversion changes are measured in percentage points', () => {
    const result = compare(tinyDataset(), {
      metric: 'conversion',
      groupBy: 'practice',
      periodA: { from: '2026-09', to: '2026-09' },
      periodB: { from: '2026-08', to: '2026-08' },
      sort: 'key',
    });
    const alpha = result.rows.find((r) => r.label === 'Alpha')!;
    expect(alpha.current).toBeCloseTo(60, 10); // 600 / 1000
    expect(alpha.previous).toBeCloseTo(70, 10); // 700 / 1000
    expect(alpha.delta).toBeCloseTo(-10, 10);
    expect(alpha.deltaPct).toBeNull();
    expect(alpha.deltaDisplay).toBe('-10.0pp');
  });

  it('compare agrees with query_metrics for the same period', () => {
    const dataset = generateDataset();
    const current = query_metrics(dataset, { month: '2026-10' });
    const result = compare(dataset, {
      metric: 'revenue',
      groupBy: 'group',
      periodA: { from: '2026-10', to: '2026-10' },
      periodB: { from: '2026-09', to: '2026-09' },
    });
    expect(result.rows[0].current).toBe(current.revenue.actual);
  });

  it('ranks the North West as the biggest revenue faller (planted story)', () => {
    const dataset = generateDataset();
    const result = compare_latest_month(dataset, 'revenue', 'region', { sort: 'delta-asc' });
    expect(result.rows[0].label).toBe(NORTH_WEST_REGION);
    expect(result.rows[0].delta).toBeLessThan(0);
  });

  it('shows North West conversion declining while other regions rise', () => {
    const dataset = generateDataset();
    const result = compare_latest_month(dataset, 'conversion', 'region', { sort: 'delta-asc' });
    const northWest = result.rows.find((r) => r.label === NORTH_WEST_REGION)!;
    const others = result.rows.filter((r) => r.label !== NORTH_WEST_REGION);

    expect(northWest.delta).toBeLessThan(0);
    expect(result.rows[0].label).toBe(NORTH_WEST_REGION); // most negative
    // At least one other region is holding or improving.
    expect(others.some((r) => r.delta >= 0)).toBe(true);
  });

  it('the single biggest practice revenue drop is the planted Bristol collapse', () => {
    const dataset = generateDataset();
    const result = compare_latest_month(dataset, 'revenue', 'practice', { sort: 'delta-asc' });
    // Bristol closed for a refit in October; its recorded context lives in the
    // Brain. The North West remains the weakest region (see above); this is
    // the largest single practice movement.
    expect(result.rows[0].label).toBe('Bristol');
    expect(result.rows[0].region).toBe('South West');
  });
});
