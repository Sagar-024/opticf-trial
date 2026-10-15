import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearActivity,
  ensureSeeded,
  mutateState,
  readState,
  resetAutomations,
} from '../src/lib/automations-store';

/**
 * The store reads and writes window.localStorage and announces changes on the
 * window; the suite runs in node, so every test gets a fresh in-memory window.
 */
function stubWindow(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

beforeEach(stubWindow);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('automations clearing', () => {
  it('seeds the shipped skills, and Clear wipes only the ledger', () => {
    ensureSeeded();
    const seeded = readState();
    expect(seeded.skills.length).toBe(4);
    expect(seeded.skills.every((skill) => skill.seeded)).toBe(true);

    mutateState((state) => ({
      ...state,
      activity: [{ id: 'a1', at: 1, text: 'Monday brief ran' }],
      tasks: [
        {
          id: 't1',
          title: 'Contact lens below target - Chorlton',
          practiceId: 'P001',
          practiceName: 'Chorlton',
          region: 'North West',
          job: 'watch-cl',
          owner: 'Rachel Doyle',
          ownerRole: 'Practice manager',
          dueAt: '2026-10-22',
          createdAt: 1,
          done: false,
        },
      ],
    }));

    clearActivity();
    const after = readState();
    expect(after.activity).toEqual([]);
    expect(after.tasks.length).toBe(1);
    expect(after.skills.length).toBe(4);
  });

  it('resets to the shipped four, all on, with an empty inbox, tasks and ledger', () => {
    ensureSeeded();
    mutateState((state) => ({
      ...state,
      skills: [
        ...state.skills.map((skill) => ({ ...skill, enabled: false })),
        {
          id: 'skill-custom',
          name: 'Revenue watch',
          job: 'watch-revenue',
          regions: [],
          recipients: { group: false, regionLeads: true, mentors: false },
          enabled: true,
          createdAt: 2,
        },
      ],
      runs: [
        {
          id: 'r1',
          kind: 'brief',
          skillId: 'skill-brief',
          skillName: 'Monday brief',
          at: 1,
          status: 'review',
          items: [],
          recipientNames: ['Sara Kelly'],
        },
      ],
      activity: [{ id: 'a1', at: 1, text: 'Monday brief ran' }],
    }));

    resetAutomations();
    const after = readState();
    expect(after.skills.length).toBe(4);
    expect(after.skills.every((skill) => skill.enabled)).toBe(true);
    expect(after.runs).toEqual([]);
    expect(after.tasks).toEqual([]);
    expect(after.activity).toEqual([]);
  });
});
