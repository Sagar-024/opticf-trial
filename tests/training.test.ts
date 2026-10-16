import { describe, expect, it } from 'vitest';
import { training_status } from '../src/data/training';
import { generateDataset } from '../src/seed/generate';
import { TRAINING_GAP_PRACTICES } from '../src/seed/config';
import { tinyDataset } from './fixtures';

describe('training_status', () => {
  it('reports a gap and an overdue module (known fixture)', () => {
    const result = training_status(tinyDataset(), { asOf: '2026-10-12' });
    const alpha = result.byPractice.find((p) => p.practiceId === 'P1')!;
    const beta = result.byPractice.find((p) => p.practiceId === 'P2')!;

    expect(alpha.compliant).toBe(false);
    expect(alpha.status).toBe('overdue');
    expect(alpha.completionPct).toBe(50);
    expect(alpha.gaps.map((g) => g.moduleId)).toEqual(['GDPR']);
    expect(alpha.gaps[0].overdue).toBe(true);

    expect(beta.compliant).toBe(true);
    expect(beta.completionPct).toBe(100);

    expect(result.summary.practicesWithGaps).toBe(1);
    expect(result.summary.practicesOverdue).toBe(1);
  });

  it('every planted training-gap practice shows up, and only those', () => {
    const dataset = generateDataset();
    const result = training_status(dataset);

    // The planted gaps, plus Leek: a new practice mid onboarding with three
    // required modules still to complete.
    expect(result.summary.practicesWithGaps).toBe(TRAINING_GAP_PRACTICES.length + 1);

    for (const id of TRAINING_GAP_PRACTICES) {
      const row = result.byPractice.find((p) => p.practiceId === id)!;
      expect(row, `expected ${id} to be present`).toBeDefined();
      expect(row.compliant, `expected ${id} to have a gap`).toBe(false);
      expect(row.gaps.length).toBeGreaterThan(0);
    }

    const flagged = new Set(result.byPractice.filter((p) => !p.compliant).map((p) => p.practiceId));
    expect([...flagged].sort()).toEqual([...TRAINING_GAP_PRACTICES, 'P041'].sort());
  });

  it('completion percentage is consistent with module counts', () => {
    const result = training_status(generateDataset());
    const { requiredModulesAssigned, requiredModulesCompleted, completionPct } = result.summary;
    expect(requiredModulesCompleted).toBeLessThanOrEqual(requiredModulesAssigned);
    expect(completionPct).toBeCloseTo((requiredModulesCompleted / requiredModulesAssigned) * 100, 10);
  });

  it('onlyIncomplete filters out compliant practices', () => {
    const result = training_status(generateDataset(), { onlyIncomplete: true });
    expect(result.byPractice.every((p) => !p.compliant)).toBe(true);
  });
});
