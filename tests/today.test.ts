import { describe, expect, it } from 'vitest';
import { today_priorities } from '../src/data/today';
import { generateDataset } from '../src/seed/generate';
import { NORTH_WEST_REGION } from '../src/seed/config';

describe('today_priorities', () => {
  const dataset = generateDataset();
  const today = today_priorities(dataset);

  it('returns exactly five items', () => {
    expect(today.items).toHaveLength(5);
  });

  it('defaults to the latest month in the data', () => {
    expect(today.month).toBe('2026-10');
  });

  it('leads with a single region-level item for the North West', () => {
    const regionItems = today.items.filter((i) => i.kind === 'region');
    expect(regionItems).toHaveLength(1);
    expect(regionItems[0].issue).toBe('region-underperformance');
    expect(regionItems[0].region).toBe(NORTH_WEST_REGION);
    expect(regionItems[0].title).toMatch(/revenue and conversion both falling/i);
  });

  it('is varied: at most two items per region and no repeated practice', () => {
    expect(today.items).toHaveLength(5);

    // No practice appears twice.
    const practiceIds = today.items.map((i) => i.practiceId).filter((id): id is string => Boolean(id));
    expect(new Set(practiceIds).size).toBe(practiceIds.length);

    // At most two items from the same region (the region item counts).
    const perRegion = new Map<string, number>();
    for (const item of today.items) {
      if (!item.region) continue;
      perRegion.set(item.region, (perRegion.get(item.region) ?? 0) + 1);
    }
    for (const [region, count] of perRegion) {
      expect(count, `${region} has ${count} items`).toBeLessThanOrEqual(2);
    }

    // More than one region is represented.
    expect(perRegion.size).toBeGreaterThanOrEqual(3);
  });

  it('covers the distinct practice issues (not all sales decline)', () => {
    const issues = new Set(today.items.map((i) => i.issue));
    expect(issues.has('sales-decline')).toBe(true);
    expect(issues.has('cl-below-target')).toBe(true);
    expect(issues.has('training')).toBe(true);
    // The four practice items are not all the same issue.
    const practiceIssues = today.items.filter((i) => i.kind === 'practice').map((i) => i.issue);
    expect(new Set(practiceIssues).size).toBeGreaterThanOrEqual(2);
  });

  it('every item is actionable: summary, evidence and link targets', () => {
    for (const item of today.items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.summary.length).toBeGreaterThan(0);
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.metric.value.length).toBeGreaterThan(0);
      expect(['performance', 'contactLens', 'training']).toContain(item.mapView.lens);
      expect(item.dashboardQuery.metrics.length).toBeGreaterThan(0);
      expect(item.dashboardQuery.period.month).toBe(today.month);
    }
  });
});
