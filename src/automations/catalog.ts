/**
 * The automation catalogue: the real jobs a skill can run, the recipient
 * directory (resolved from the seed so names have one source of truth), and
 * the client-side brief composer.
 *
 * This file is client-safe. It quotes only strings the data layer produced:
 * `composeBrief` copies fields out of a `TodayPriorities` object, it never
 * computes a figure. Watch evaluation lives in `engine.ts` (server only,
 * because it needs the dataset).
 */

import { MENTORS, REGIONS } from '../seed/config';
import type { TodayPriorities } from '../data/today';
import type {
  BriefRunItem,
  JobKey,
  RecipientSet,
  ResolvedRecipient,
  Skill,
  WatchJobKey,
} from './types';

export interface JobDef {
  key: JobKey;
  kind: 'schedule' | 'watch';
  /** Default skill name. */
  name: string;
  /** The job in one sentence; shown on the card and in the builder. */
  sentence: string;
  /** Human cadence label. */
  cadence: string;
  /** Task title prefix when a hit is approved. */
  taskLabel: string;
  /** Watches can be scoped to regions; the brief is group-wide. */
  scopeable: boolean;
  defaultRecipients: RecipientSet;
}

export const JOBS: JobDef[] = [
  {
    key: 'brief',
    kind: 'schedule',
    name: 'Monday brief',
    sentence:
      'Compose the five priorities for the group from the live practice data and put them up for review.',
    cadence: 'Weekly · Mondays 07:30',
    taskLabel: 'Priority review',
    scopeable: false,
    defaultRecipients: { group: true, regionLeads: false, mentors: false },
  },
  {
    key: 'watch-cl',
    kind: 'watch',
    name: 'Contact lens watch',
    sentence:
      'Check every practice against its contact lens target and flag any below 90%, with the evidence.',
    cadence: 'When it happens',
    taskLabel: 'Contact lens below target',
    scopeable: true,
    defaultRecipients: { group: false, regionLeads: true, mentors: false },
  },
  {
    key: 'watch-conversion',
    kind: 'watch',
    name: 'Conversion watch',
    sentence:
      'Flag any practice whose conversion has dropped 2 percentage points or more since last month.',
    cadence: 'When it happens',
    taskLabel: 'Conversion falling',
    scopeable: true,
    defaultRecipients: { group: false, regionLeads: true, mentors: false },
  },
  {
    key: 'watch-revenue',
    kind: 'watch',
    name: 'Revenue watch',
    sentence: 'Flag any practice whose revenue has fallen 3% or more since last month.',
    cadence: 'When it happens',
    taskLabel: 'Revenue falling',
    scopeable: true,
    defaultRecipients: { group: false, regionLeads: true, mentors: false },
  },
  {
    key: 'watch-refunds',
    kind: 'watch',
    name: 'Refund watch',
    sentence:
      'Flag any practice whose refunds jump above its usual level, whose refund rate passes 1% of revenue, or whose goodwill crosses the authority line without the regional lead recorded.',
    cadence: 'When it happens',
    taskLabel: 'Unusual refunds',
    scopeable: true,
    defaultRecipients: { group: false, regionLeads: true, mentors: false },
  },
  {
    key: 'watch-training',
    kind: 'watch',
    name: 'Training watch',
    sentence: 'Flag any practice with required training overdue, and name the modules past their due date.',
    cadence: 'When it happens',
    taskLabel: 'Training overdue',
    scopeable: true,
    defaultRecipients: { group: false, regionLeads: true, mentors: false },
  },
];

const JOBS_BY_KEY = new Map(JOBS.map((job) => [job.key, job]));

export function jobDef(key: JobKey): JobDef {
  const job = JOBS_BY_KEY.get(key);
  if (!job) throw new Error(`Unknown automation job: ${key}`);
  return job;
}

export function isWatchJob(key: JobKey): key is WatchJobKey {
  return key !== 'brief';
}

/** All region names, straight from the seed directory. */
export const ALL_REGIONS: string[] = REGIONS.map((region) => region.name);

export const GROUP_LEADERSHIP: ResolvedRecipient[] = [
  { id: 'group-leadership', name: 'Sara Kelly', role: 'Group leadership' },
];

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * Resolve a recipient set to real people for a scope. An empty scope means
 * the whole group; mentors are the ones covering the in-scope regions.
 */
export function resolveRecipients(recipients: RecipientSet, regions: string[]): ResolvedRecipient[] {
  const inScope = regions.length > 0 ? regions : ALL_REGIONS;
  const resolved: ResolvedRecipient[] = [];

  if (recipients.group) resolved.push(...GROUP_LEADERSHIP);

  if (recipients.regionLeads) {
    for (const region of REGIONS) {
      if (!inScope.includes(region.name)) continue;
      resolved.push({ id: `lead-${slug(region.name)}`, name: region.lead, role: `${region.name} lead` });
    }
  }

  if (recipients.mentors) {
    const mentorIds = new Set(
      REGIONS.filter((region) => inScope.includes(region.name)).map((region) => region.mentorId),
    );
    for (const mentor of MENTORS) {
      if (!mentorIds.has(mentor.mentorId)) continue;
      resolved.push({ id: `mentor-${slug(mentor.name)}`, name: mentor.name, role: 'Mentor' });
    }
  }

  return resolved;
}

export function recipientNames(recipients: RecipientSet, regions: string[]): string {
  return resolveRecipients(recipients, regions).map((person) => person.name).join(', ');
}

/** "Emma Lawson + 4 more" for tight spots. */
export function recipientSummary(recipients: RecipientSet, regions: string[]): string {
  const names = resolveRecipients(recipients, regions).map((person) => person.name);
  if (names.length === 0) return 'No one yet';
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} + ${names.length - 1} more`;
}

export function scopeLabel(regions: string[]): string {
  if (regions.length === 0) return 'All regions';
  if (regions.length <= 2) return regions.join(', ');
  return `${regions[0]} + ${regions.length - 1} more`;
}

/** The four skills the tab starts with, so the page is alive on first open. */
export function defaultSkills(): Skill[] {
  return [
    {
      id: 'skill-brief',
      name: 'Monday brief',
      job: 'brief',
      regions: [],
      recipients: { group: true, regionLeads: false, mentors: false },
      enabled: true,
      seeded: true,
      createdAt: 1,
    },
    {
      id: 'skill-watch-cl',
      name: 'Contact lens watch',
      job: 'watch-cl',
      regions: [],
      recipients: { group: false, regionLeads: true, mentors: false },
      enabled: true,
      seeded: true,
      createdAt: 2,
    },
    {
      id: 'skill-watch-training',
      name: 'Training watch',
      job: 'watch-training',
      regions: [],
      recipients: { group: false, regionLeads: true, mentors: false },
      enabled: true,
      seeded: true,
      createdAt: 3,
    },
    {
      id: 'skill-watch-refunds',
      name: 'Refund watch',
      job: 'watch-refunds',
      regions: [],
      recipients: { group: false, regionLeads: true, mentors: false },
      enabled: true,
      seeded: true,
      createdAt: 4,
    },
  ];
}

/** Copy the priorities into a run. No arithmetic: every string is quoted. */
const ISSUE_PHRASE: Record<TodayPriorities['items'][number]['issue'], string> = {
  'region-underperformance': 'region underperformance',
  'sales-decline': 'sales decline',
  refunds: 'unusual refunds',
  'cl-below-target': 'contact lens below target',
  training: 'training incomplete',
};

export function composeBrief(today: TodayPriorities): BriefRunItem[] {
  return today.items.map((item) => {
    const name = item.practiceId ? item.title.split(' - ')[0] : item.region ?? 'the group';
    return {
      id: item.id,
      title: item.title,
      summary: item.summary,
      metricLabel: item.metric.label,
      metricValue: item.metric.value,
      metricComparison: item.metric.comparison,
      practiceId: item.practiceId,
      region: item.region,
      question: `Why is ${name} flagged for ${ISSUE_PHRASE[item.issue]}? What should I look at first?`,
    };
  });
}

/** "Mon 19 Oct" for the next Monday, the brief's next scheduled run. */
export function nextMondayLabel(): string {
  const date = new Date();
  const day = date.getDay();
  const delta = (8 - day) % 7 || 7;
  date.setDate(date.getDate() + delta);
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** ISO date (`YYYY-MM-DD`) n days from now, for task review dates. */
export function dueDateAfter(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "14 Oct, 09:12" for run times and ledger lines. */
export function atLabel(at: number): string {
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "21 Oct" for a review date. */
export function dueLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
