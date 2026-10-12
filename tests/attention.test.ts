import { describe, expect, it } from 'vitest';
import { rank_attention } from '../src/data/attention';
import { generateDataset } from '../src/seed/generate';
import { CL_BELOW_TARGET, NORTH_WEST_SHARP_DECLINE } from '../src/seed/config';
import { tinyDataset } from './fixtures';

describe('rank_attention', () => {
  it('scores the declining practice highest (known fixture)', () => {
    const rows = rank_attention(tinyDataset(), { asOf: '2026-10-12' });
    expect(rows[0].practiceId).toBe('P1');
    expect(rows[0].score).toBeGreaterThan(0);

    const codes = rows[0].signals.map((s) => s.code);
    expect(codes).toContain('revenue-decline');
    expect(codes).toContain('conversion-decline');
    expect(codes).toContain('cl-below-target');
    expect(codes).toContain('training-incomplete');
    expect(codes).toContain('training-overdue');
  });

  it('returns scores in descending order', () => {
    const rows = rank_attention(generateDataset());
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score);
    }
  });

  it('every signal carries formatted, non-empty evidence', () => {
    const rows = rank_attention(generateDataset());
    for (const row of rows) {
      expect(row.signals.length).toBeGreaterThan(0);
      for (const signal of row.signals) {
        expect(signal.evidence.length).toBeGreaterThan(0);
        expect(signal.evidence).toMatch(/[0-9]/); // contains a number
      }
    }
  });

  it('surfaces the planted stories in the top 5 (generated data)', () => {
    const rows = rank_attention(generateDataset(), { limit: 5 });
    const ids = rows.map((r) => r.practiceId);
    expect(ids).toContain('P001'); // Chorlton: revenue + conversion decline
    // All four sharp North West practices should rank highly.
    for (const id of NORTH_WEST_SHARP_DECLINE) {
      expect(ids).toContain(id);
    }
  });

  it('flags contact-lens under-performers with the right signal', () => {
    const rows = rank_attention(generateDataset());
    const clRows = rows.filter((r) => r.signals.some((s) => s.code === 'cl-below-target'));
    const flaggedIds = clRows.map((r) => r.practiceId);
    for (const id of CL_BELOW_TARGET) {
      expect(flaggedIds).toContain(id);
    }
  });

  it('respects the region filter', () => {
    const rows = rank_attention(generateDataset(), { regions: ['Scotland'] });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.region === 'Scotland')).toBe(true);
  });
});
