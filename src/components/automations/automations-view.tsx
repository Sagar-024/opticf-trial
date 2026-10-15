'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Banknote,
  Check,
  Glasses,
  GraduationCap,
  Mail,
  Plus,
  Receipt,
  Sparkles,
  Trash2,
  TrendingDown,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SkillDialog, scheduleLabel } from '@/components/automations/skill-dialog';
import { buildSeededHistory } from '@/automations/history';
import {
  atLabel,
  jobDef,
  nextMondayLabel,
  recipientSummary,
  resolveRecipients,
  scopeLabel,
} from '@/automations/catalog';
import {
  automationId,
  clearActivity,
  ensureSeeded,
  mutateState,
  readState,
  resetAutomations,
  subscribeToAutomations,
  type AutomationsState,
} from '@/lib/automations-store';
import {
  closeTask,
  deleteTask,
  importTasks,
  isOverdue,
  listTasks,
  reopenTask,
  setTaskDue,
  subscribeToTasks,
  type Task,
} from '@/lib/task-store';
import type { TodayPriorities } from '@/data';
import type {
  AutomationTask,
  JobKey,
  Skill,
  SkillJob,
  StoredQuestionRun,
  WatchHit,
  WatchJobKey,
} from '@/automations/types';
import { cn } from '@/lib/utils';

/**
 * The Automations view.
 *
 * Skills that watch the real data and prepare the work. Each skill is a job,
 * a trigger, a scope and real recipients; runs land in the review inbox, and
 * approving never sends anything on its own. A watch hit becomes a task with
 * one owner and one review date, and the activity ledger keeps the record.
 *
 * The brief is composed from the same `TodayPriorities` the page received
 * from the server, so the brief and Home can never disagree. Watch hits are
 * evaluated by `/api/automations/run` through the same `rank_attention` the
 * map uses. No number here is computed on the client.
 */

const EMPTY_STATE: AutomationsState = { skills: [], runs: [], tasks: [], activity: [] };

/** One recognisable mark per job, so a card is scannable before it is read. */
const JOB_ICONS: Record<SkillJob, LucideIcon> = {
  brief: Mail,
  'watch-cl': Glasses,
  'watch-conversion': TrendingDown,
  'watch-revenue': Banknote,
  'watch-refunds': Receipt,
  'watch-training': GraduationCap,
  question: Sparkles,
};

/** An automations task from before the one board, moved across on first open. */
function migratedTask(task: AutomationTask): Task {
  return {
    id: task.id,
    title: task.title,
    assignee: task.owner,
    assigneeRole: task.ownerRole,
    due: task.dueAt,
    status: task.done ? 'done' : 'open',
    createdAt: task.createdAt,
    createdBy: 'Sara Kelly',
    source: {
      label: task.practiceName,
      practiceId: task.practiceId,
      region: task.region,
      automationJob: task.job,
    },
  };
}

type CheckState =
  | { status: 'checking' }
  | { status: 'ok'; hits: WatchHit[]; at: number }
  | { status: 'error' };

/* ── Small shared pieces ─────────────────────────────────────────────────── */

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'done' }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'accent' && 'bg-[var(--accent-soft)] text-[var(--accent-text)]',
        tone === 'done' && 'border border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]',
        tone === 'neutral' && 'border border-border text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="py-1 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

function namesLine(names: string[]): string {
  if (names.length === 0) return 'the recipients';
  if (names.length <= 2) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} + ${names.length - 2} more`;
}

/* ── The switch ──────────────────────────────────────────────────────────── */

function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
        checked ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)]' : 'border-border bg-transparent',
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full transition-all duration-200',
          checked ? 'left-[18px] bg-[var(--accent-600)]' : 'left-[2px] bg-muted-foreground/40',
        )}
      />
    </button>
  );
}

/* ── The skill card ──────────────────────────────────────────────────────── */

function liveStatus(skill: Skill, check: CheckState | undefined): { text: string; tone: 'quiet' | 'warm' | 'bad' } {
  if (!skill.enabled) return { text: 'Paused', tone: 'quiet' };
  if (skill.job === 'brief') return { text: `Next run ${nextMondayLabel()}`, tone: 'quiet' };
  if (skill.job === 'question') {
    return { text: 'Runs when this tab is open, until the scheduler lands', tone: 'quiet' };
  }
  if (!check || check.status === 'checking') return { text: 'Checking now…', tone: 'quiet' };
  if (check.status === 'error') return { text: 'Check unavailable just now', tone: 'bad' };
  if (check.hits.length === 0) return { text: 'Nothing matching right now', tone: 'quiet' };
  return { text: `${check.hits.length} matching right now`, tone: 'warm' };
}

function SkillCard({
  skill,
  check,
  lastRunAt,
  onToggle,
  onRemove,
}: {
  skill: Skill;
  check: CheckState | undefined;
  lastRunAt: number | null;
  onToggle: (skill: Skill) => void;
  onRemove: (skill: Skill) => void;
}) {
  const def = skill.job === 'question' ? null : jobDef(skill.job);
  const JobIcon = JOB_ICONS[skill.job];
  const isWatch = skill.job !== 'brief' && skill.job !== 'question';
  const scoped = skill.job !== 'brief';
  const status = liveStatus(skill, check);

  return (
    <article
      data-skill-id={skill.id}
      className={cn(
        'surface-3d flex flex-col rounded-xl border border-[color:var(--line-strong)] bg-card p-5 transition-opacity',
        !skill.enabled && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <JobIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <h3 className="truncate text-[15px] font-semibold">{skill.name}</h3>
          </div>
          {/* Only a clock schedule needs saying. A watch is always watching,
              and the live count below is what proves it. */}
          {skill.job === 'brief' && def ? (
            <p className="mt-0.5 pl-[22px] text-xs text-muted-foreground">{def.cadence}</p>
          ) : null}
          {skill.job === 'question' ? (
            <p className="mt-0.5 pl-[22px] text-xs text-muted-foreground">
              {skill.schedule
                ? scheduleLabel(skill.schedule.cadence, skill.schedule.weekday ?? 'Monday', skill.schedule.time)
                : 'Weekly'}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Every skill can go, shipped or custom. Reset brings the shipped
              four back, so deleting one is never a dead end. */}
          <IconAction label={`Remove ${skill.name}`} onClick={() => onRemove(skill)}>
            <Trash2 className="size-3.5" />
          </IconAction>
          <Switch
            checked={skill.enabled}
            onChange={() => onToggle(skill)}
            label={`Turn ${skill.name} ${skill.enabled ? 'off' : 'on'}`}
          />
        </div>
      </div>

      <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-foreground/75">
        {def ? def.sentence : skill.question}
      </p>

      <dl className="mt-4 space-y-2 text-[13px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">Where</dt>
          <dd className="truncate text-foreground">{scoped ? scopeLabel(skill.regions) : 'Whole group'}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">Goes to</dt>
          <dd className="truncate text-foreground" title={resolveRecipients(skill.recipients, skill.regions).map((p) => `${p.name} · ${p.role}`).join('\n')}>
            {recipientSummary(skill.recipients, skill.regions)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">Last run</dt>
          <dd className="truncate tabular-nums text-foreground">{lastRunAt ? atLabel(lastRunAt) : 'Never'}</dd>
        </div>
      </dl>

      <div className="mt-auto pt-4">
        <div className="border-t border-border pt-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[13px]',
              status.tone === 'quiet' && 'text-muted-foreground',
              status.tone === 'warm' && 'font-medium text-[var(--accent-text)]',
              status.tone === 'bad' && 'text-[var(--bad)]',
            )}
          >
            {status.tone === 'warm' ? <span className="size-1.5 rounded-full bg-[var(--accent-600)]" /> : null}
            {status.text}
          </span>
        </div>
      </div>
    </article>
  );
}

/* ── The page ────────────────────────────────────────────────────────────── */

export function AutomationsView({
  today,
  onAskAbout,
  onOpenPractice,
  onOpenRegion,
}: {
  today: TodayPriorities;
  onAskAbout?: (question: string) => void;
  onOpenPractice?: (practiceId: string) => void;
  onOpenRegion?: (region: string) => void;
}) {
  const [state, setState] = useState<AutomationsState>(EMPTY_STATE);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  /** The one task board: every task, including the ones a skill created. */
  const [boardTasks, setBoardTasks] = useState<Task[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const inFlight = useRef(new Set<string>());
  const checksRef = useRef(checks);
  /** The seeded history is attempted once per mount, never twice. */
  const seededRef = useRef(false);

  useEffect(() => {
    checksRef.current = checks;
  }, [checks]);

  // Hydrate from this browser, then follow every change (including other tabs).
  useEffect(() => {
    ensureSeeded();
    const initial = readState();
    setState(initial);
    setBoardTasks(listTasks());

    // One-time migration: tasks that used to live in the automations store
    // move to the one task board, then leave the old store.
    if (initial.tasks.length > 0) {
      importTasks(initial.tasks.map(migratedTask));
      mutateState((current) => ({ ...current, tasks: [] }));
    }

    // A fresh browser wakes up with the history a running system would have.
    if (!seededRef.current && initial.runs.length === 0 && initial.skills.length > 0) {
      seededRef.current = true;
      void seedHistory(initial.skills);
    }

    const unsubAutomations = subscribeToAutomations(() => setState(readState()));
    const unsubTasks = subscribeToTasks(() => setBoardTasks(listTasks()));
    return () => {
      unsubAutomations();
      unsubTasks();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = onAskAbout ?? (() => undefined);
  const openPractice = onOpenPractice ?? (() => undefined);
  const openRegion = onOpenRegion ?? (() => undefined);

  /* ── Live checks for enabled watches ───────────────────────────────────── */

  async function checkSkill(skill: Skill): Promise<WatchHit[] | null> {
    if (inFlight.current.has(skill.id)) return null;
    inFlight.current.add(skill.id);
    setChecks((current) => ({ ...current, [skill.id]: { status: 'checking' } }));
    try {
      const response = await fetch('/api/automations/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: skill.job, regions: skill.regions }),
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { hits?: unknown };
      if (!Array.isArray(data.hits)) throw new Error('bad payload');
      const hits = data.hits as WatchHit[];
      setChecks((current) => ({ ...current, [skill.id]: { status: 'ok', hits, at: Date.now() } }));
      return hits;
    } catch {
      setChecks((current) => ({ ...current, [skill.id]: { status: 'error' } }));
      return null;
    } finally {
      inFlight.current.delete(skill.id);
    }
  }

  /**
   * A custom skill: the assistant answers the saved question through the same
   * pipeline the Chat tab uses, and the answer queues for the skill's people.
   * This is a real run; only the schedule waits for the platform.
   */
  async function runQuestion(skill: Skill): Promise<void> {
    if (!skill.question || inFlight.current.has(skill.id)) return;
    inFlight.current.add(skill.id);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: skill.question }] }),
      });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done: { text?: string; sources?: string[] } | null = null;
      while (true) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const payload = JSON.parse(line) as { type?: string; text?: string; sources?: string[] };
            if (payload.type === 'done') done = payload;
          } catch {
            // A partial line; the next chunk completes it.
          }
        }
      }
      if (!done?.text) return;
      const run: StoredQuestionRun = {
        id: automationId('run'),
        kind: 'question',
        skillId: skill.id,
        skillName: skill.name,
        question: skill.question,
        at: Date.now(),
        // The answer is delivered: it queues for the skill's people the moment
        // it lands, and the ledger keeps the line.
        status: 'approved',
        answer: done.text,
        sources: done.sources ?? [],
        recipientNames: resolveRecipients(skill.recipients, skill.regions).map((person) => person.name),
      };
      mutateState((current) => ({
        ...current,
        runs: [run, ...current.runs],
        activity: [event(`${skill.name} answered, queued for ${namesLine(run.recipientNames)}`), ...current.activity],
      }));
    } catch {
      // The run simply does not land; the card stays as it was.
    } finally {
      inFlight.current.delete(skill.id);
    }
  }

  const skillsKey = state.skills.map((skill) => `${skill.id}:${skill.enabled ? 1 : 0}:${skill.regions.join('|')}`).join(',');

  /**
   * One watch evaluation from the engine route, used only by the seed. It
   * deliberately does not share the live-check in-flight set: a seed that
   * waited on the checks would miss whatever they were already fetching.
   */
  async function fetchHits(job: WatchJobKey, regions: string[]): Promise<WatchHit[] | null> {
    try {
      const response = await fetch('/api/automations/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job, regions }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { hits?: unknown };
      return Array.isArray(data.hits) ? (data.hits as WatchHit[]) : null;
    } catch {
      return null;
    }
  }

  /**
   * First open: fill the tab with the history a running system would have.
   * The runs come from the same live data every real run uses (the brief from
   * the priorities the page already has, the watches from the engine route),
   * stamped into the recent past, so nothing here can disagree with the app.
   */
  async function seedHistory(skills: Skill[]): Promise<void> {
    const hitsByJob: Partial<Record<WatchJobKey, WatchHit[]>> = {};
    for (const skill of skills) {
      if (skill.job === 'brief' || skill.job === 'question') continue;
      const hits = await fetchHits(skill.job, skill.regions);
      if (hits) hitsByJob[skill.job] = hits;
    }
    const seeded = buildSeededHistory({ skills, today, hitsByJob });
    importTasks(seeded.tasks);
    mutateState((current) =>
      current.runs.length > 0
        ? current
        : { ...current, runs: seeded.runs, activity: seeded.activity },
    );
  }

  // Check every enabled watch once, when the tab opens or the roster changes.
  // A question skill that has never run gets its first answer the same way.
  useEffect(() => {
    for (const skill of state.skills) {
      if (skill.job === 'brief' || !skill.enabled) continue;
      if (skill.job === 'question') {
        const answered = readState().runs.some((run) => run.kind === 'question' && run.skillId === skill.id);
        if (!answered && !inFlight.current.has(skill.id)) void runQuestion(skill);
        continue;
      }
      if (checksRef.current[skill.id]) continue;
      if (inFlight.current.has(skill.id)) continue;
      void checkSkill(skill);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillsKey]);

  /* ── Store actions ─────────────────────────────────────────────────────── */

  function event(text: string) {
    return { id: automationId('evt'), at: Date.now(), text };
  }

  function toggleSkill(skill: Skill): void {
    const enabling = !skill.enabled;
    // Toggling is not work. The ledger keeps runs, approvals and tasks only,
    // so it reads as a record of what happened, not a log of UI fiddling.
    mutateState((current) => ({
      ...current,
      skills: current.skills.map((entry) =>
        entry.id === skill.id ? { ...entry, enabled: enabling } : entry,
      ),
    }));
    if (enabling) {
      setChecks((current) => {
        const next = { ...current };
        delete next[skill.id];
        return next;
      });
    }
  }

  function removeSkill(skill: Skill): void {
    // Removing is admin, not work; it stays out of the ledger too.
    mutateState((current) => ({
      ...current,
      skills: current.skills.filter((entry) => entry.id !== skill.id),
    }));
    setChecks((current) => {
      const next = { ...current };
      delete next[skill.id];
      return next;
    });
  }

  function createSkill(skill: Skill): void {
    mutateState((current) => ({
      ...current,
      // Newest first: the skill you just made is the one you look for.
      skills: [skill, ...current.skills],
      activity: [event(`Skill created: ${skill.name}`), ...current.activity],
    }));
    // A question skill answers once straight away, so its first result is real
    // and visible; the weekly schedule is what the platform adds later.
    if (skill.job === 'question') void runQuestion(skill);
    // The new skill is the thing to look at: bring it into view.
    window.setTimeout(() => {
      document.querySelector(`[data-skill-id="${skill.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
  }

  function resetDemo(): void {
    resetAutomations();
    const skills = readState().skills;
    if (skills.length > 0) void seedHistory(skills);
  }

  /* ── Task actions ──────────────────────────────────────────────────────── */

  function toggleTask(task: Task): void {
    const done = task.status === 'done';
    if (done) reopenTask(task.id);
    else closeTask(task.id);
    mutateState((current) => ({
      ...current,
      activity: [event(done ? `Reopened: ${task.title}` : `Done: ${task.title}`), ...current.activity],
    }));
  }

  function removeTask(task: Task): void {
    deleteTask(task.id);
    mutateState((current) => ({
      ...current,
      activity: [event(`Task removed: ${task.title}`), ...current.activity],
    }));
  }

  /* ── Derived ───────────────────────────────────────────────────────────── */

  const lastRunBySkill = useMemo(() => {
    const map = new Map<string, number>();
    for (const run of state.runs) {
      const current = map.get(run.skillId) ?? 0;
      if (run.at > current) map.set(run.skillId, run.at);
    }
    return map;
  }, [state.runs]);

  const shippedSkills = state.skills.filter((skill) => skill.seeded);
  const customSkills = state.skills
    .filter((skill) => !skill.seeded)
    .sort((a, b) => b.createdAt - a.createdAt);
  const enabledCount = shippedSkills.filter((skill) => skill.enabled).length;
  const customOn = customSkills.filter((skill) => skill.enabled).length;
  /** Tasks that came from a skill: they live on the one board, shown here too. */
  const automationTasks = boardTasks.filter((task) => Boolean(task.source?.automationJob));
  const openTaskCount = automationTasks.filter((task) => task.status === 'open').length;
  const sortedTasks = useMemo(
    () =>
      [...automationTasks].sort(
        (a, b) =>
          Number(a.status === 'done') - Number(b.status === 'done') ||
          (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
          b.createdAt - a.createdAt,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardTasks],
  );

  return (
    <div className="h-full overflow-y-auto">
      <SkillDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreate={createSkill} />
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Automations</h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Skills that watch the real data and prepare the work. Results queue for the right
              people, and every run is on the record.
            </p>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-3.5" />
            New skill
          </Button>
        </header>

        <Section
          title="Skills"
          aside={
            <>
              <Pill tone="neutral">
                {enabledCount} of {shippedSkills.length} on
              </Pill>
              {/* Shipped skills pause; custom ones have their own bin. Reset
                  restores the demo state: the shipped four, on, with the
                  recent run history a running system would show. */}
              <button
                onClick={resetDemo}
                title="Back to the demo state: the four shipped skills, all on, with recent run history"
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Reset
              </button>
            </>
          }
        >
          {shippedSkills.length === 0 ? (
            <EmptyNote>
              No shipped checks right now. Reset brings the four back.
            </EmptyNote>
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
              {shippedSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  check={checks[skill.id]}
                  lastRunAt={lastRunBySkill.get(skill.id) ?? null}
                  onToggle={toggleSkill}
                  onRemove={removeSkill}
                />
              ))}
            </div>
          )}
        </Section>

        {/* Your own skills, apart from the shipped ones: what you asked for,
            on the clock you set. */}
        <Section
          title="Your skills"
          aside={
            customSkills.length > 0 ? (
              <Pill tone="neutral">
                {customOn} of {customSkills.length} on
              </Pill>
            ) : undefined
          }
        >
          {customSkills.length === 0 ? (
            <EmptyNote>
              Nothing of your own yet. New skill lets you write a question in your own words, or
              start from a check.
            </EmptyNote>
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))]">
              {customSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  check={checks[skill.id]}
                  lastRunAt={lastRunBySkill.get(skill.id) ?? null}
                  onToggle={toggleSkill}
                  onRemove={removeSkill}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Tasks" aside={openTaskCount > 0 ? <Pill tone="accent">{openTaskCount} open</Pill> : null}>
          {automationTasks.length === 0 ? (
            <EmptyNote>
              No tasks yet. Approving a hit creates one with the right owner (the practice manager,
              or the regional lead when the guidance requires it) and a review date.
            </EmptyNote>
          ) : (
            <ul className="surface-3d divide-y divide-border overflow-hidden rounded-xl border border-[color:var(--line-strong)] bg-card">
              {sortedTasks.map((task) => {
                const done = task.status === 'done';
                const overdue = isOverdue(task);
                return (
                  <li key={task.id} className="flex items-center gap-3 px-5 py-2.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      aria-label={`Mark ${task.title} ${done ? 'not done' : 'done'}`}
                      onClick={() => toggleTask(task)}
                      className={cn(
                        'grid size-4 shrink-0 place-items-center rounded-full border transition-colors',
                        done
                          ? 'border-[color:var(--accent-600)] bg-[var(--accent-600)] text-white'
                          : 'border-border hover:border-[color:var(--accent-border)]',
                      )}
                    >
                      {done ? <Check className="size-2.5" /> : null}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'truncate text-xs font-medium',
                          done && 'text-muted-foreground line-through',
                        )}
                      >
                        {task.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {task.assignee} · {task.assigneeRole}
                        {task.source?.region ? ` · ${task.source.region}` : ''}
                      </p>
                    </div>
                    <input
                      type="date"
                      value={task.due ?? ''}
                      onChange={(event) => setTaskDue(task.id, event.target.value)}
                      disabled={done}
                      aria-label={`Review date for ${task.title}`}
                      className={cn(
                        'h-7 shrink-0 rounded-md bg-transparent px-1 text-xs tabular-nums outline-none transition-colors hover:bg-accent focus:bg-accent disabled:opacity-50',
                        overdue ? 'font-medium text-[var(--bad)]' : 'text-muted-foreground',
                      )}
                    />
                    <button
                      type="button"
                      aria-label={`Delete task ${task.title}`}
                      onClick={() => removeTask(task)}
                      className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          title="Activity"
          aside={
            state.activity.length > 0 ? (
              <button
                onClick={clearActivity}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear
              </button>
            ) : undefined
          }
        >
          {state.activity.length === 0 ? (
            <EmptyNote>Runs, approvals and tasks are logged here as they happen.</EmptyNote>
          ) : (
            <ul className="surface-3d divide-y divide-border overflow-hidden rounded-xl border border-[color:var(--line-strong)] bg-card">
              {state.activity.slice(0, 10).map((entry) => (
                <li key={entry.id} className="flex items-baseline gap-3 px-5 py-2.5 text-xs">
                  <span className="w-[92px] shrink-0 text-xs tabular-nums text-muted-foreground">
                    {atLabel(entry.at)}
                  </span>
                  <span className="min-w-0 flex-1 text-foreground/80">{entry.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
