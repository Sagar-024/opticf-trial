import { describe, expect, it } from 'vitest';
import { generateDataset } from '../src/seed/generate';
import { DEFAULT_SEED, MODULES, MONTHS, PRACTICES, REGIONS } from '../src/seed/config';
import { parseDataset, serializeDataset } from '../src/data/dataset';

describe('seed generator', () => {
  it('produces the expected shape of data', () => {
    const dataset = generateDataset();
    expect(dataset.practices).toHaveLength(PRACTICES.length); // 42
    expect(new Set(dataset.practices.map((p) => p.region)).size).toBe(REGIONS.length); // 5
    // 42 practices x 6 months, minus Leek's 4 missing months (opened in Sep),
    // Whitefield's 2 (divested after Aug) and Bournemouth's July gap.
    expect(dataset.performance).toHaveLength(PRACTICES.length * MONTHS.length - 7); // 245
    expect(dataset.training).toHaveLength(PRACTICES.length * MODULES.length); // 252
    // Still a busy ledger: background rows plus the planted stories.
    expect(dataset.refunds.length).toBeGreaterThanOrEqual(300);
    for (const refund of dataset.refunds) {
      expect(refund.refundId).toMatch(/^R\d{5}$/);
      expect(refund.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(refund.amount).toBeGreaterThanOrEqual(0); // one voided row exports at zero
    }
  });

  it('is deterministic - the same seed gives identical CSVs', () => {
    const first = serializeDataset(generateDataset({ seed: DEFAULT_SEED }));
    const second = serializeDataset(generateDataset({ seed: DEFAULT_SEED }));
    expect(second).toEqual(first);
  });

  it('a different seed changes the data', () => {
    const a = serializeDataset(generateDataset({ seed: 1 }));
    const b = serializeDataset(generateDataset({ seed: 2 }));
    expect(b).not.toEqual(a);
  });

  it('survives a CSV round-trip: the parse boundary normalises, then the data is stable', () => {
    const dataset = generateDataset();
    const raw = serializeDataset(dataset);
    const parsed = parseDataset(raw);

    // Practices, performance and training are byte-identical across the trip.
    const once = serializeDataset(parsed);
    expect(once.practices).toEqual(raw.practices);
    expect(once.performance).toEqual(raw.performance);
    expect(once.training).toEqual(raw.training);

    // A second trip is a fixed point: normalisation happens once, at the edge.
    const twice = serializeDataset(parseDataset(once));
    expect(twice).toEqual(once);
  });

  it("pins Chorlton's conversion story (63% → 54%)", () => {
    const dataset = generateDataset();
    const chorlton = dataset.performance
      .filter((p) => p.practiceId === 'P001')
      .sort((a, b) => a.month.localeCompare(b.month));
    const first = (chorlton[0].purchases / chorlton[0].eyeExams) * 100;
    const last = (chorlton[chorlton.length - 1].purchases / chorlton[chorlton.length - 1].eyeExams) * 100;
    expect(first).toBeGreaterThan(62);
    expect(first).toBeLessThan(64);
    expect(last).toBeGreaterThan(53);
    expect(last).toBeLessThan(55);
    expect(last).toBeLessThan(first);
  });

  it('never records more purchases than examinations', () => {
    const dataset = generateDataset();
    for (const row of dataset.performance) {
      expect(row.purchases).toBeLessThanOrEqual(row.eyeExams);
    }
  });
});

describe('real-world conditions', () => {
  const dataset = generateDataset();
  const monthsFor = (id: string): string[] =>
    dataset.performance
      .filter((p) => p.practiceId === id)
      .map((p) => p.month)
      .sort();

  it('Leek opens mid window with two months and mid-onboarding training', () => {
    expect(monthsFor('P041')).toEqual(['2026-09', '2026-10']);
    const required = dataset.training.filter((t) => t.practiceId === 'P041' && t.required);
    expect(required.filter((t) => t.completed)).toHaveLength(2);
    const refunds = dataset.refunds.filter((r) => r.practiceId === 'P041');
    expect(refunds.length).toBeGreaterThan(0);
    expect(refunds.every((r) => r.date >= '2026-09-01')).toBe(true);
  });

  it('Whitefield stops reporting after August', () => {
    expect(monthsFor('P042')).toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);
    expect(dataset.refunds.some((r) => r.practiceId === 'P042' && r.date >= '2026-09-01')).toBe(false);
  });

  it('Bournemouth has a hole in the middle, while refunds carry on', () => {
    expect(monthsFor('P026')).toEqual(['2026-05', '2026-06', '2026-08', '2026-09', '2026-10']);
    // Refunds come from the other system and were not lost with the migration.
    expect(dataset.refunds.some((r) => r.practiceId === 'P026' && r.date.startsWith('2026-07'))).toBe(true);
  });

  it('Maidstone lands exactly on plan with a flat month', () => {
    const sep = dataset.performance.find((p) => p.practiceId === 'P018' && p.month === '2026-09')!;
    const oct = dataset.performance.find((p) => p.practiceId === 'P018' && p.month === '2026-10')!;
    expect(oct.revenue).toBe(oct.revenueTarget);
    expect(sep.revenue).toBe(oct.revenue);
  });

  it('Bristol collapses in the latest month (the refit)', () => {
    const rows = dataset.performance
      .filter((p) => p.practiceId === 'P020')
      .sort((a, b) => a.month.localeCompare(b.month));
    const sep = rows.find((r) => r.month === '2026-09')!;
    const oct = rows.find((r) => r.month === '2026-10')!;
    expect(oct.revenue).toBeLessThan(sep.revenue * 0.9);
    expect(oct.revenue).toBeGreaterThan(0);
  });

  it('carries the messy source rows', () => {
    expect(dataset.refunds.filter((r) => r.practiceId === 'P010')).toHaveLength(0);
    expect(dataset.refunds.filter((r) => r.amount === 0)).toHaveLength(1);
    expect(dataset.refunds.filter((r) => r.practiceId === 'P006' && r.orderRef === '')).toHaveLength(2);
    const brighton = dataset.refunds.filter((r) => r.practiceId === 'P012');
    expect(brighton.length).toBeGreaterThan(0);
    expect(brighton.every((r) => r.authorisedBy === '')).toBe(true);
    const gdpr = dataset.training.find((t) => t.practiceId === 'P040' && t.moduleId === 'GDPR')!;
    expect(gdpr.completed).toBe(true);
    expect(gdpr.completedDate).toBe('');
  });

  it('carries duplicate names, a long official name and no manager', () => {
    const highs = dataset.practices.filter((p) => p.name === 'High Street');
    expect(highs.map((p) => p.practiceId).sort()).toEqual(['P033', 'P039']);
    expect(dataset.practices.find((p) => p.practiceId === 'P025')!.name).toBe('Salisbury (Catherine Street) Practice');
    expect(dataset.practices.find((p) => p.practiceId === 'P012')!.manager).toBe('');
  });

  it('normalises an unknown refund reason to other at the parse boundary', () => {
    const raw = serializeDataset(dataset);
    // The export carries the source code the app has never seen.
    expect(raw.refunds).toContain('lens-defect');
    const parsed = parseDataset(raw);
    expect(parsed.refunds.some((r) => r.reason === 'other')).toBe(true);
    expect(parsed.refunds.some((r) => (r.reason as string) === 'lens-defect')).toBe(false);
    expect(parsed.refunds.every((r) => ['frame-fault', 'lens-fit', 'change-of-mind', 'goodwill', 'other'].includes(r.reason))).toBe(true);
  });
});
