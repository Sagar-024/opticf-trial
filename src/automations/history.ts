import type { TodayPriorities } from '@/data';
import type { Task } from '@/lib/task-store';
import { composeBrief, jobDef, resolveRecipients } from './catalog';
import type {
  ActivityEvent,
  Skill,
  StoredBriefRun,
  StoredRun,
  StoredWatchRun,
  WatchHit,
  WatchJobKey,
} from './types';

/**
 * The history a fresh browser wakes up with.
 *
 * A tab that opens on "Last run: Never" looks like it was built this morning.
 * These runs are composed from the same live data every real run uses (the
 * brief from the priorities the page already has, the watches from the same
 * engine route a check uses), then stamped into the recent past, so the page
 * reads like a system that has been working for weeks.
 */

/** The most recent Monday at the given time, always in the past. */
export function lastMondayAt(hour: number, minute: number, now = Date.now()): number {
  const candidate = new Date(now);
  const daysSinceMonday = (candidate.getDay() + 6) % 7;
  candidate.setDate(candidate.getDate() - daysSinceMonday);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() > now) candidate.setDate(candidate.getDate() - 7);
  return candidate.getTime();
}

/** N days ago at the given time, never in the future. */
export function daysAgoAt(days: number, hour: number, minute: number, now = Date.now()): number {
  const candidate = new Date(now);
  candidate.setDate(candidate.getDate() - days);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() > now) candidate.setDate(candidate.getDate() - 1);
  return candidate.getTime();
}

/** ISO date `days` after a moment, for a task's review date. */
function isoAfter(at: number, days: number): string {
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10);
}

export interface SeededHistory {
  runs: StoredRun[];
  tasks: Task[];
  activity: ActivityEvent[];
}

export function buildSeededHistory(input: {
  skills: Skill[];
  today: TodayPriorities;
  /** Real hits per watch job, from the same route a live check uses. */
  hitsByJob: Partial<Record<WatchJobKey, WatchHit[]>>;
  now?: number;
}): SeededHistory {
  const now = input.now ?? Date.now();
  const runs: StoredRun[] = [];
  const tasks: Task[] = [];
  const activity: ActivityEvent[] = [];
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-seed-${(counter += 1).toString(36)}`;

  const byJob = (job: Skill['job']) => input.skills.find((skill) => skill.job === job);
  const recipientsOf = (skill: Skill) =>
    resolveRecipients(skill.recipients, skill.regions).map((person) => person.name);

  // Monday: the brief ran at 07:30 and was approved an hour later.
  const briefSkill = byJob('brief');
  if (briefSkill) {
    const at = lastMondayAt(7, 30, now);
    const items = composeBrief(input.today);
    const run: StoredBriefRun = {
      id: nextId('run'),
      kind: 'brief',
      skillId: briefSkill.id,
      skillName: briefSkill.name,
      at,
      status: 'approved',
      items,
      recipientNames: recipientsOf(briefSkill),
    };
    runs.push(run);
    activity.push(
      { id: nextId('evt'), at, text: `${briefSkill.name} ran — ${items.length} priorities in review` },
      {
        id: nextId('evt'),
        at: at + 3_600_000,
        text: `${briefSkill.name} approved — queued for ${run.recipientNames.join(', ')}`,
      },
    );
  }

  // Monday: the contact lens watch ran a minute later. Its first hit became a
  // task for the person who owns the fix; the rest were dismissed.
  const clSkill = byJob('watch-cl');
  const clHits = input.hitsByJob['watch-cl'];
  if (clSkill && clHits && clHits.length > 0) {
    const at = lastMondayAt(7, 31, now);
    const [first, ...rest] = clHits;
    if (first) {
      const owner = first.owner?.name ?? first.manager;
      const ownerRole = first.owner?.role ?? 'Practice manager';
      const dueAt = isoAfter(at, 7);
      const task: Task = {
        id: nextId('task'),
        title: `${jobDef('watch-cl').taskLabel} — ${first.name}`,
        assignee: owner,
        assigneeRole: ownerRole,
        due: dueAt,
        status: 'open',
        createdAt: at,
        createdBy: 'Sara Kelly',
        source: {
          label: first.name,
          practiceId: first.practiceId,
          region: first.region,
          finding: first.evidence,
          automationJob: 'watch-cl',
        },
      };
      tasks.push(task);
      const hits = [
        { ...first, status: 'task' as const, taskId: task.id },
        ...rest.map((hit) => ({ ...hit, status: 'discarded' as const })),
      ];
      runs.push({
        id: nextId('run'),
        kind: 'watch',
        skillId: clSkill.id,
        skillName: clSkill.name,
        job: 'watch-cl',
        at,
        hits,
        recipientNames: recipientsOf(clSkill),
      });
      activity.push(
        { id: nextId('evt'), at, text: `${clSkill.name} ran — ${clHits.length} to review` },
        { id: nextId('evt'), at: at + 30_000, text: `Task for ${owner}: ${task.title}, due ${dueAt}` },
      );
    }
  }

  // Midweek: the training watch ran; one hit still waits for a decision, so
  // the inbox opens with work in it.
  const trSkill = byJob('watch-training');
  const trHits = input.hitsByJob['watch-training'];
  if (trSkill && trHits && trHits.length > 0) {
    const at = daysAgoAt(3, 9, 15, now);
    const [first, ...rest] = trHits;
    if (first) {
      runs.push({
        id: nextId('run'),
        kind: 'watch',
        skillId: trSkill.id,
        skillName: trSkill.name,
        job: 'watch-training',
        at,
        hits: [
          { ...first, status: 'review' as const },
          ...rest.map((hit) => ({ ...hit, status: 'discarded' as const })),
        ],
        recipientNames: recipientsOf(trSkill),
      });
      activity.push({ id: nextId('evt'), at, text: `${trSkill.name} ran — ${trHits.length} to review` });
    }
  }

  // Last week: the refund watch ran and every hit was dismissed.
  const rfSkill = byJob('watch-refunds');
  const rfHits = input.hitsByJob['watch-refunds'];
  if (rfSkill && rfHits && rfHits.length > 0) {
    const at = daysAgoAt(5, 8, 0, now);
    runs.push({
      id: nextId('run'),
      kind: 'watch',
      skillId: rfSkill.id,
      skillName: rfSkill.name,
      job: 'watch-refunds',
      at,
      hits: rfHits.map((hit) => ({ ...hit, status: 'discarded' as const })),
      recipientNames: recipientsOf(rfSkill),
    });
    activity.push(
      { id: nextId('evt'), at, text: `${rfSkill.name} ran — ${rfHits.length} to review` },
      { id: nextId('evt'), at: at + 120_000, text: `${rfSkill.name} run dismissed` },
    );
  }

  runs.sort((a, b) => b.at - a.at);
  activity.sort((a, b) => b.at - a.at);
  return { runs, tasks, activity };
}
