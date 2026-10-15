import { describe, expect, it } from 'vitest';
import { generateDataset } from '../src/seed/generate';
import { refund_findings, refund_summary, REFUND_THRESHOLDS } from '../src/data/refunds';
import { getTool } from '../src/ai/tools';
import type { TableWidget } from '../src/ai/types';

/**
 * The refunds layer, asserting the same planted stories the rest of the suite
 * does: Chorlton's frame-fault spike, Plymouth's gestures under the authority
 * line, and Liverpool's gesture above it with no regional lead recorded.
 */

const dataset = generateDataset();
const findings = refund_findings(dataset);
const flagged = findings.filter((row) => row.findings.length > 0);

describe('refund findings', () => {
  it('flags exactly the three planted stories', () => {
    expect(flagged.map((row) => row.practiceId).sort()).toEqual(['P001', 'P008', 'P024']);
  });

  it('Chorlton: a spike and a high rate, with the money in the evidence', () => {
    const chorlton = findings.find((row) => row.practiceId === 'P001')!;
    const codes = chorlton.findings.map((finding) => finding.code);
    expect(codes).toContain('refund-spike');
    expect(codes).toContain('refund-rate-high');
    expect(chorlton.latestTotal).toBeGreaterThan(1500);
    expect(chorlton.ratePct).toBeGreaterThan(REFUND_THRESHOLDS.ratePct);
    expect(chorlton.findings[0].evidence).toContain('against a usual');
    expect(chorlton.findings[0].points).toBeGreaterThan(0);
  });

  it('Liverpool: a gesture above the line without the regional lead', () => {
    const liverpool = findings.find((row) => row.practiceId === 'P008')!;
    expect(liverpool.findings.map((finding) => finding.code)).toEqual(['goodwill-above-authority']);
    expect(liverpool.findings[0].evidence).toContain('regional lead');
    expect(liverpool.findings[0].evidence).toContain('£');
  });

  it('Plymouth: a cluster of gestures under the line', () => {
    const plymouth = findings.find((row) => row.practiceId === 'P024')!;
    expect(plymouth.findings.map((finding) => finding.code)).toEqual(['goodwill-near-threshold']);
    expect(plymouth.findings[0].evidence).toContain('under the approval line');
  });

  it('poses no false positives: unflagged practices sit under the review level', () => {
    for (const row of flagged) {
      expect(row.findings.length).toBeGreaterThan(0);
      expect(row.findings.every((finding) => finding.points > 0)).toBe(true);
    }
    for (const row of findings.filter((entry) => entry.findings.length === 0)) {
      expect(row.ratePct).toBeLessThan(REFUND_THRESHOLDS.ratePct);
    }
  });

  it('every finding carries formatted, non-empty evidence with a number', () => {
    for (const row of flagged) {
      for (const finding of row.findings) {
        expect(finding.evidence.length).toBeGreaterThan(0);
        expect(finding.evidence).toMatch(/[0-9]/);
      }
    }
  });
});

describe('refund summary', () => {
  const summary = refund_summary(dataset);

  it('defaults to the latest month, whole group, with the full trend', () => {
    expect(summary.monthLabel).toBe('Oct 2026');
    expect(summary.practiceCount).toBe(40);
    expect(summary.trend).toHaveLength(6);
    expect(summary.trend[summary.trend.length - 1].month).toBe('2026-10');
  });

  it('the rate is refunds over revenue and net revenue adds up', () => {
    expect(summary.ratePct).toBeCloseTo((summary.total / summary.revenue) * 100, 6);
    expect(summary.netRevenue).toBe(summary.revenue - summary.total);
  });

  it('the reason mix accounts for every payment and every pound', () => {
    expect(summary.byReason.reduce((n, row) => n + row.count, 0)).toBe(summary.count);
    expect(summary.byReason.reduce((n, row) => n + row.total, 0)).toBe(summary.total);
    for (const row of summary.byReason) {
      expect(row.shareDisplay).toMatch(/%$/);
    }
  });

  it('carries the policy checks from the planted stories', () => {
    expect(summary.aboveAuthority.map((entry) => entry.practiceId)).toContain('P008');
    expect(summary.nearThreshold.map((entry) => entry.practiceId)).toContain('P024');
    expect([...summary.flaggedPracticeIds].sort()).toEqual(['P001', 'P008', 'P024']);
  });

  it('a practice scope narrows everything and matches the group total', () => {
    const chorlton = refund_summary(dataset, { practiceIds: ['P001'] });
    expect(chorlton.practiceCount).toBe(1);
    expect(chorlton.total).toBeGreaterThan(1500);
    expect(chorlton.total).toBeLessThan(summary.total);
    expect(chorlton.previous.changeDisplay).toMatch(/^\+/);
  });

  it('a breakdown by practice sums back to the group', () => {
    const byPractice = refund_summary(dataset, { groupBy: 'practice' });
    const sum = (byPractice.breakdown ?? []).reduce((n, row) => n + row.total, 0);
    expect(sum).toBe(summary.total);
    const byRegion = refund_summary(dataset, { groupBy: 'region' });
    expect(byRegion.breakdown ?? []).toHaveLength(5);
  });
});

describe('the refunds chat tools', () => {
  it('query_refunds answers with figures, the trend and the flags', () => {
    const out = getTool('query_refunds')!.run(dataset, {});
    expect(out.summary).toMatch(/Refunds in Oct 2026: £[\d,]+ across [\d,]+ payments/);
    expect(out.summary).toContain('Net revenue');
    expect(out.summary).toContain('look unusual');
    expect(out.widgets.map((widget) => widget.type)).toContain('kpi');
    expect(out.widgets.map((widget) => widget.type)).toContain('chart');
    expect([...(out.mapHighlight ?? [])].sort()).toEqual(['P001', 'P008', 'P024']);
  });

  it('query_refunds can compare refunds by practice', () => {
    const out = getTool('query_refunds')!.run(dataset, { group_by: 'practice' });
    const table = out.widgets.find((widget) => widget.id === 'refunds-breakdown') as TableWidget;
    expect(table).toBeDefined();
    expect(table.columns).toContain('Rate');
    expect(table.rows.length).toBeGreaterThan(5);
    expect(out.summary).toContain('By practice');
  });

  it('refund_anomalies lists the three stories with the evidence quoted', () => {
    const out = getTool('refund_anomalies')!.run(dataset, {});
    expect([...(out.mapHighlight ?? [])].sort()).toEqual(['P001', 'P008', 'P024']);
    expect(out.summary).toContain('Chorlton');
    expect(out.summary).toContain('against a usual');
    expect(out.summary).toContain('regional lead');
    const table = out.widgets[0] as TableWidget;
    expect(table.type).toBe('table');
    expect(table.rows).toHaveLength(3);
  });

  it('get_practice carries the refunds line', () => {
    const out = getTool('get_practice')!.run(dataset, { practice_id: 'P001' });
    const table = out.widgets.find((widget) => widget.id === 'practice-table') as TableWidget;
    const row = table.rows.find((entry) => entry[0] === 'Refunds');
    expect(row?.[1]).toContain('£');
    expect(row?.[1]).toContain('of revenue');
  });
});
