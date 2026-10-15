import { describe, expect, it } from 'vitest';
import { buildSeededHistory, daysAgoAt, lastMondayAt } from '../src/automations/history';
import { defaultSkills } from '../src/automations/catalog';
import { evaluateWatch } from '../src/automations/engine';
import { today_priorities } from '../src/data/today';
import { generateDataset } from '../src/seed/generate';

describe('seeded history', () => {
  const dataset = generateDataset();
  const today = today_priorities(dataset);
  const skills = defaultSkills();
  const now = Date.now();
  const seeded = buildSeededHistory({
    skills,
    today,
    hitsByJob: {
      'watch-cl': evaluateWatch(dataset, 'watch-cl', []),
      'watch-training': evaluateWatch(dataset, 'watch-training', []),
      'watch-refunds': evaluateWatch(dataset, 'watch-refunds', []),
    },
    now,
  });

  it('composes the brief from the same priorities the page shows', () => {
    const brief = seeded.runs.find((run) => run.kind === 'brief');
    expect(brief?.kind).toBe('brief');
    if (brief?.kind === 'brief') {
      expect(brief.items).toHaveLength(5);
      expect(brief.status).toBe('approved');
      expect(brief.recipientNames).toContain('Sara Kelly');
    }
  });

  it('stamps every run into the past, newest first', () => {
    expect(seeded.runs.length).toBeGreaterThanOrEqual(3);
    for (const run of seeded.runs) expect(run.at).toBeLessThan(now);
    const times = seeded.runs.map((run) => run.at);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    for (const line of seeded.activity) expect(line.at).toBeLessThan(now);
  });

  it('turns the worst contact lens hit into a task for its owner', () => {
    const run = seeded.runs.find((entry) => entry.kind === 'watch' && entry.job === 'watch-cl');
    expect(run?.kind).toBe('watch');
    if (run?.kind === 'watch') {
      const tasked = run.hits.filter((hit) => hit.status === 'task');
      expect(tasked).toHaveLength(1);
      const task = seeded.tasks[0];
      expect(task?.source?.practiceId).toBe(tasked[0]?.practiceId);
      expect(task?.assignee).toBe(tasked[0]?.owner?.name ?? tasked[0]?.manager);
      expect(task?.source?.automationJob).toBe('watch-cl');
      expect(task?.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((task?.due ?? '') >= new Date(now).toISOString().slice(0, 10)).toBe(true);
      expect(task?.status).toBe('open');
    }
  });

  it('gives the training watch its task too, so nothing waits for approval', () => {
    const run = seeded.runs.find((entry) => entry.kind === 'watch' && entry.job === 'watch-training');
    expect(run?.kind).toBe('watch');
    if (run?.kind === 'watch') {
      const tasked = run.hits.filter((hit) => hit.status === 'task');
      expect(tasked).toHaveLength(1);
      expect(run.hits.some((hit) => hit.status === 'discarded')).toBe(true);
      expect(seeded.tasks.some((task) => task.source?.automationJob === 'watch-training')).toBe(true);
    }
    // Nothing in the seeded history waits for a person any more.
    for (const entry of seeded.runs) {
      if (entry.kind === 'watch') expect(entry.hits.every((hit) => hit.status !== 'review')).toBe(true);
    }
  });

  it('keeps the ledger and ids honest', () => {
    const ids = [
      ...seeded.runs.map((run) => run.id),
      ...seeded.activity.map((line) => line.id),
      ...seeded.tasks.map((task) => task.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(seeded.activity.some((line) => line.text.includes('queued for'))).toBe(true);
    expect(seeded.activity.some((line) => line.text.startsWith('Task for'))).toBe(true);
    expect(seeded.activity.some((line) => line.text.includes('run dismissed'))).toBe(true);
  });

  it('lastMondayAt and daysAgoAt never land in the future', () => {
    const monday = lastMondayAt(7, 30, now);
    expect(monday).toBeLessThan(now);
    expect(new Date(monday).getDay()).toBe(1);
    expect(new Date(monday).getHours()).toBe(7);
    const fiveAgo = daysAgoAt(5, 8, 0, now);
    expect(fiveAgo).toBeLessThan(now);
  });
});
