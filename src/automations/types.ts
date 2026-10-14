/**
 * Shared shapes for the Automations tab.
 *
 * Types only, so this file is safe to import from client components, the
 * server route and tests. The numbers inside runs are never computed here:
 * every figure is a pre-formatted string produced by the data layer.
 */

export type WatchJobKey = 'watch-cl' | 'watch-conversion' | 'watch-revenue' | 'watch-training';
export type JobKey = 'brief' | WatchJobKey;

/** Which recipient groups a skill delivers to. Resolved to real people at run time. */
export interface RecipientSet {
  /** Group leadership: Sara Kelly. */
  group: boolean;
  /** The lead of each in-scope region, from the seed directory. */
  regionLeads: boolean;
  /** Mentors covering the in-scope regions, from the seed directory. */
  mentors: boolean;
}

/** A skill: one piece of recurring work, switchable, with a real trigger. */
export interface Skill {
  id: string;
  name: string;
  job: JobKey;
  /** Empty means the whole group (all regions). */
  regions: string[];
  recipients: RecipientSet;
  enabled: boolean;
  /** The three seeded skills; custom skills carry `undefined`. */
  seeded?: boolean;
  createdAt: number;
}

/** A person a run would reach, resolved from the seed directory. */
export interface ResolvedRecipient {
  id: string;
  name: string;
  role: string;
}

/** One practice a watch flagged, quoting the attention signal that caught it. */
export interface WatchHit {
  practiceId: string;
  name: string;
  region: string;
  /** The practice manager: the person who owns the fix. */
  manager: string;
  /** The evidence sentence from the data layer, already formatted. */
  evidence: string;
  /** The headline figure for this condition, already formatted. */
  headline: string;
  /** What the headline is, e.g. "of target". */
  caption: string;
}

/** One priority inside an approved brief. */
export interface BriefRunItem {
  id: string;
  title: string;
  summary: string;
  metricLabel: string;
  metricValue: string;
  metricComparison: string;
  /** Where the item points, for the Ask and Show-on-map actions. */
  practiceId?: string;
  region?: string;
  /** The one-tap follow-up question, phrased like Home's Ask. */
  question: string;
}

export interface StoredBriefRun {
  id: string;
  kind: 'brief';
  skillId: string;
  skillName: string;
  at: number;
  status: 'review' | 'approved';
  items: BriefRunItem[];
  recipientNames: string[];
}

export interface StoredWatchHit extends WatchHit {
  status: 'review' | 'task' | 'discarded';
  taskId?: string;
}

export interface StoredWatchRun {
  id: string;
  kind: 'watch';
  skillId: string;
  skillName: string;
  job: WatchJobKey;
  at: number;
  hits: StoredWatchHit[];
  recipientNames: string[];
}

export type StoredRun = StoredBriefRun | StoredWatchRun;

/** A commitment: one action, one owner, one review date. */
export interface AutomationTask {
  id: string;
  title: string;
  practiceId: string;
  practiceName: string;
  region: string;
  job: WatchJobKey;
  /** The practice manager. */
  owner: string;
  ownerRole: string;
  /** ISO date (`YYYY-MM-DD`). */
  dueAt: string;
  createdAt: number;
  done: boolean;
}

/** One line in the activity ledger. */
export interface ActivityEvent {
  id: string;
  at: number;
  text: string;
}
