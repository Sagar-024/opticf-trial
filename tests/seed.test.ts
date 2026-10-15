import { describe, expect, it } from 'vitest';
import { generateDataset } from '../src/seed/generate';
import { DEFAULT_SEED, MODULES, MONTHS, PRACTICES, REGIONS } from '../src/seed/config';
import { parseDataset, serializeDataset } from '../src/data/dataset';

describe('seed generator', () => {
  it('produces the expected shape of data', () => {
    const dataset = generateDataset();
    expect(dataset.practices).toHaveLength(PRACTICES.length); // 40
    expect(new Set(dataset.practices.map((p) => p.region)).size).toBe(REGIONS.length); // 5
    expect(dataset.performance).toHaveLength(PRACTICES.length * MONTHS.length); // 240
    expect(dataset.training).toHaveLength(PRACTICES.length * MODULES.length); // 240
    // At least one refund per practice-month by construction.
    expect(dataset.refunds.length).toBeGreaterThanOrEqual(PRACTICES.length * MONTHS.length);
    for (const refund of dataset.refunds) {
      expect(refund.refundId).toMatch(/^R\d{5}$/);
      expect(refund.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(refund.amount).toBeGreaterThan(0);
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

  it('survives a CSV round-trip unchanged', () => {
    const dataset = generateDataset();
    const raw = serializeDataset(dataset);
    const roundTripped = serializeDataset(parseDataset(raw));
    expect(roundTripped).toEqual(raw);
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
