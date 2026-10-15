/**
 * Shared shapes for the Automations tab.
 *
 * Types only, so this file is safe to import from client components, the
 * server route and tests. The numbers inside runs are never computed here:
 * every figure is a pre-formatted string produced by the data layer.
 */

export type WatchJobKey = 'watch-cl' | 'watch-conversion' | 'watch-revenue' | 'watch-refunds' | 'watch-training';
export type JobKey = 'brief' | WatchJobKey;
/** A skill is one of the shipped checks, or a question the reader sets. */
export type SkillJob = JobKey | 'question';

/** Which recipient groups a skill delivers to. Resolved to real people at run time. */
export interface RecipientSet {
  /** Group leadership: Sara Kelly. */
  group: boolean;
  /** The lead of each in-scope region, from the seed directory. */
  regionLeads: boolean;
  /** Mentors covering the in-scope regions, from the seed directory. */
  mentors: boolean;
}

/** When a custom question skill runs, in the reader's terms. */
export interface SkillSchedule {
  cadence: 'daily' | 'weekly' | 'monthly';
  /** HH:MM, 24 hour. */
  time: string;
  /** For weekly cadences; a weekday name. */
  weekday?: string;
}

/** A skill: one piece of recurring work, switchable, with a real trigger. */
export interface Skill {
  id: string;
  name: string;
  job: SkillJob;
  /** Empty means the whole group (all regions). */
  regions: string[];
  recipients: RecipientSet;
  enabled: boolean;
  /** The three seeded skills; custom skills carry `undefined`. */
  seeded?: boolean;
  createdAt: number;
  /** For a custom skill: the question the assistant answers, in the reader's
      own words. Present only when `job` is 'question'. */
  question?: string;
  /** For a custom skill: the clock the reader set. The scheduler honours it
      when the platform lands; until then it runs when the tab is open. */
  schedule?: SkillSchedule;
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
  /**
   * Who owns the fix when it is not the practice manager, e.g. a gesture above
   * the authority line escalates to the regional lead. Optional so stored runs
   * from before routing existed still load; the UI falls back to the manager.
   */
  owner?: { name: string; role: string };
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

/** A custom skill's run: the assistant's answer, waiting for review. */
export interface StoredQuestionRun {
  id: string;
  kind: 'question';
  skillId: string;
  skillName: string;
  /** The question the skill asked, in the reader's words. */
  question: string;
  at: number;
  status: 'review' | 'approved';
  /** The answer, exactly as the assistant wrote it. */
  answer: string;
  /** Where the figures in the answer came from. */
  sources: string[];
  recipientNames: string[];
}

export type StoredRun = StoredBriefRun | StoredWatchRun | StoredQuestionRun;

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
