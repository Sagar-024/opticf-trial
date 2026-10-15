'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, MapPin, MoreHorizontal, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SkillDialog } from '@/components/automations/skill-dialog';
import {
  atLabel,
  composeBrief,
  dueDateAfter,
  dueLabel,
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
import type { TodayPriorities } from '@/data';
import type {
  AutomationTask,
  Skill,
  StoredBriefRun,
  StoredWatchHit,
  StoredWatchRun,
  WatchHit,
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

const EASE = [0.22, 1, 0.36, 1] as const;

const EMPTY_STATE: AutomationsState = { skills: [], runs: [], tasks: [], activity: [] };

type CheckState =
  | { status: 'checking' }
  | { status: 'ok'; hits: WatchHit[]; at: number }
  | { status: 'error' };

/* ── Small shared pieces ─────────────────────────────────────────────────── */

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'done' }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-medium',
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
    <section className="mt-8">
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
    <p className="rounded-xl border border-border px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground">
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

/** Signed figures in evidence keep the data red for falls, everything else quiet. */
function EvidenceText({ text }: { text: string }) {
  const parts = text.split(/([+-]£[\d,]+(?:\.\d+)?|[+-]\d+(?:\.\d+)?(?:pp|%))/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('-') ? (
          <span key={index} className="font-medium text-[var(--bad)]">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
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
  if (!check || check.status === 'checking') return { text: 'Checking now…', tone: 'quiet' };
  if (check.status === 'error') return { text: 'Check unavailable just now', tone: 'bad' };
  if (check.hits.length === 0) return { text: 'Nothing matching right now', tone: 'quiet' };
  return { text: `${check.hits.length} matching right now`, tone: 'warm' };
}

function SkillCard({
  skill,
  check,
  lastRunAt,
  busy,
  onToggle,
  onRun,
  onRemove,
}: {
  skill: Skill;
  check: CheckState | undefined;
  lastRunAt: number | null;
  busy: boolean;
  onToggle: (skill: Skill) => void;
  onRun: (skill: Skill) => void;
  onRemove: (skill: Skill) => void;
}) {
  const def = jobDef(skill.job);
  const isWatch = skill.job !== 'brief';
  const status = liveStatus(skill, check);
  const runDisabled = !skill.enabled || busy || (isWatch && check?.status === 'checking');

  return (
    <article
      className={cn(
        'flex flex-col rounded-xl border border-border bg-card p-4 transition-opacity',
        !skill.enabled && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{skill.name}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{def.cadence}</p>
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

      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{def.sentence}</p>

      <dl className="mt-3 space-y-1.5 text-[11px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">Where</dt>
          <dd className="truncate text-foreground/80">{isWatch ? scopeLabel(skill.regions) : 'Whole group'}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">Goes to</dt>
          <dd className="truncate text-foreground/80" title={resolveRecipients(skill.recipients, skill.regions).map((p) => `${p.name} · ${p.role}`).join('\n')}>
            {recipientSummary(skill.recipients, skill.regions)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">Last run</dt>
          <dd className="truncate tabular-nums text-foreground/80">{lastRunAt ? atLabel(lastRunAt) : 'Never'}</dd>
        </div>
      </dl>

      <div className="mt-auto pt-3">
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[11px]',
              status.tone === 'quiet' && 'text-muted-foreground',
              status.tone === 'warm' && 'font-medium text-[var(--accent-text)]',
              status.tone === 'bad' && 'text-[var(--bad)]',
            )}
          >
            {status.tone === 'warm' ? <span className="size-1.5 rounded-full bg-[var(--accent-600)]" /> : null}
            {status.text}
          </span>
          <Button variant="outline" size="sm" onClick={() => onRun(skill)} disabled={runDisabled}>
            {busy ? 'Running…' : 'Run now'}
          </Button>
        </div>
      </div>
    </article>
  );
}

/* ── Inbox: brief run ────────────────────────────────────────────────────── */

function BriefRunCard({
  run,
  onApprove,
  onDiscard,
  onAsk,
  onOpenPractice,
  onOpenRegion,
}: {
  run: StoredBriefRun;
  onApprove: (run: StoredBriefRun) => void;
  onDiscard: (run: StoredBriefRun) => void;
  onAsk: (question: string) => void;
  onOpenPractice: (practiceId: string) => void;
  onOpenRegion: (region: string) => void;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(run.status === 'review');

  return (
    <motion.article
      data-anim
      layout="position"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE } }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, transition: { duration: 0.18, ease: EASE } }}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5">
        <span className="text-xs font-semibold">{run.skillName}</span>
        <span className="text-[11px] text-muted-foreground">ran {atLabel(run.at)}</span>
        {run.status === 'approved' ? <Pill tone="done">Approved</Pill> : <Pill tone="accent">In review</Pill>}
        <div className="ml-auto flex items-center gap-1.5">
          {run.status === 'review' ? (
            <>
              <Button size="sm" onClick={() => onApprove(run)}>
                Approve
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDiscard(run)}>
                Discard
              </Button>
            </>
          ) : (
            <button
              onClick={() => setOpen((value) => !value)}
              className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {open ? 'Hide' : 'View'}
            </button>
          )}
        </div>
      </header>

      {open ? (
        <div className="border-t border-border">
          <ol className="divide-y divide-border">
            {run.items.map((item, index) => (
              <li key={item.id} className="flex items-center gap-4 px-4 py-2.5">
                <span className="w-3.5 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{item.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-muted-foreground">
                    <EvidenceText text={item.summary} />
                  </p>
                </div>
                <div className="hidden w-[128px] shrink-0 text-right sm:block">
                  <p className="text-sm font-semibold tabular-nums">{item.metricValue}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{item.metricComparison}</p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconAction label={`Ask about ${item.title}`} onClick={() => onAsk(item.question)}>
                    <Sparkles className="size-3.5" />
                  </IconAction>
                  {item.practiceId || item.region ? (
                    <IconAction
                      label={`Show on the map`}
                      onClick={() => {
                        if (item.practiceId) onOpenPractice(item.practiceId);
                        else if (item.region) onOpenRegion(item.region);
                      }}
                    >
                      <MapPin className="size-3.5" />
                    </IconAction>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {run.status === 'approved' ? (
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              Queued for {namesLine(run.recipientNames)}. Sending connects when the backend lands.
            </p>
          ) : null}
        </div>
      ) : null}
    </motion.article>
  );
}

/* ── Inbox: watch run ────────────────────────────────────────────────────── */

function ReviewHitRow({
  hit,
  taskOpen,
  onApprove,
  onDismiss,
  onAsk,
  onShowMap,
}: {
  hit: StoredWatchHit;
  taskOpen: boolean;
  onApprove: (hit: StoredWatchHit) => void;
  onDismiss: (hit: StoredWatchHit) => void;
  onAsk: (hit: StoredWatchHit) => void;
  onShowMap: (hit: StoredWatchHit) => void;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      data-anim
      layout="position"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE } }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 24, transition: { duration: 0.18, ease: EASE } }}
      className="flex items-center gap-4 px-4 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {hit.name}
          <span className="font-normal text-muted-foreground"> · {hit.region}</span>
        </p>
        <p className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-muted-foreground">
          <EvidenceText text={hit.evidence} />
        </p>
      </div>
      <div className="hidden w-[96px] shrink-0 text-right sm:block">
        <p className="text-sm font-semibold tabular-nums">{hit.headline}</p>
        <p className="truncate text-[11px] text-muted-foreground">{hit.caption}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {taskOpen ? (
          <span className="text-[11px] text-muted-foreground">Task open</span>
        ) : (
          <Button size="sm" onClick={() => onApprove(hit)}>
            Approve
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label={`Options for ${hit.name}`}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
            <DropdownMenuItem onSelect={() => onAsk(hit)}>
              <Sparkles />
              Ask about this
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onShowMap(hit)}>
              <MapPin />
              Show on map
            </DropdownMenuItem>
            {!taskOpen ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => onDismiss(hit)}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <X />
                  Dismiss
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.li>
  );
}

function TaskedHitRow({ hit, task }: { hit: StoredWatchHit; task: AutomationTask | undefined }) {
  return (
    <motion.li
      data-anim
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.22, ease: EASE } }}
      className="flex items-center gap-4 px-4 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {hit.name}
          <span className="font-normal text-muted-foreground"> · {hit.region}</span>
        </p>
        <p className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-muted-foreground">
          <EvidenceText text={hit.evidence} />
        </p>
      </div>
      <p className="shrink-0 text-[11px] text-muted-foreground">
        Task for {hit.owner?.name ?? hit.manager} · {task?.done ? 'done' : task ? `due ${dueLabel(task.dueAt)}` : 'created'}
      </p>
    </motion.li>
  );
}

function WatchRunCard({
  run,
  tasks,
  hasOpenTask,
  onApproveHit,
  onDismissHit,
  onApproveAll,
  onDiscardAll,
  onAsk,
  onShowMap,
}: {
  run: StoredWatchRun;
  tasks: AutomationTask[];
  hasOpenTask: (job: StoredWatchRun['job'], practiceId: string) => boolean;
  onApproveHit: (run: StoredWatchRun, hit: StoredWatchHit) => void;
  onDismissHit: (run: StoredWatchRun, hit: StoredWatchHit) => void;
  onApproveAll: (run: StoredWatchRun) => void;
  onDiscardAll: (run: StoredWatchRun) => void;
  onAsk: (hit: StoredWatchHit) => void;
  onShowMap: (hit: StoredWatchHit) => void;
}) {
  const reduce = useReducedMotion();
  const reviewHits = run.hits.filter((hit) => hit.status === 'review');
  const taskedHits = run.hits.filter((hit) => hit.status === 'task');
  const visibleHits = run.hits.filter((hit) => hit.status !== 'discarded');
  const [open, setOpen] = useState(reviewHits.length > 0);
  const handled = reviewHits.length === 0;

  return (
    <motion.article
      data-anim
      layout="position"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE } }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, transition: { duration: 0.18, ease: EASE } }}
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5">
        <span className="text-xs font-semibold">{run.skillName}</span>
        <span className="text-[11px] text-muted-foreground">ran {atLabel(run.at)}</span>
        {handled ? (
          <Pill tone="done">
            {taskedHits.length > 0 ? `${taskedHits.length} task${taskedHits.length === 1 ? '' : 's'}` : 'Dismissed'}
          </Pill>
        ) : (
          <Pill tone="accent">{reviewHits.length} to review</Pill>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {!handled ? (
            <>
              <Button size="sm" onClick={() => onApproveAll(run)}>
                Approve all
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    aria-label={`Options for the ${run.skillName} run`}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
                  <DropdownMenuItem
                    onSelect={() => onDiscardAll(run)}
                    className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  >
                    <X />
                    Dismiss the rest
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <button
              onClick={() => setOpen((value) => !value)}
              className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {open ? 'Hide' : 'View'}
            </button>
          )}
        </div>
      </header>

      {open ? (
        <div className="border-t border-border">
          {visibleHits.length === 0 ? (
            <p className="px-4 py-3 text-[11px] text-muted-foreground">
              Every hit was dismissed. Nothing was kept from this run.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              <AnimatePresence initial={false}>
                {visibleHits.map((hit) =>
                  hit.status === 'review' ? (
                    <ReviewHitRow
                      key={hit.practiceId}
                      hit={hit}
                      taskOpen={hasOpenTask(run.job, hit.practiceId)}
                      onApprove={(entry) => onApproveHit(run, entry)}
                      onDismiss={(entry) => onDismissHit(run, entry)}
                      onAsk={onAsk}
                      onShowMap={onShowMap}
                    />
                  ) : (
                    <TaskedHitRow
                      key={hit.practiceId}
                      hit={hit}
                      task={hit.taskId ? tasks.find((task) => task.id === hit.taskId) : undefined}
                    />
                  ),
                )}
              </AnimatePresence>
            </ul>
          )}
          {taskedHits.length > 0 ? (
            <p className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              Notifications to {namesLine(run.recipientNames)} queue when sending connects.
            </p>
          ) : null}
        </div>
      ) : null}
    </motion.article>
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
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const inFlight = useRef(new Set<string>());
  const checksRef = useRef(checks);

  useEffect(() => {
    checksRef.current = checks;
  }, [checks]);

  // Hydrate from this browser, then follow every change (including other tabs).
  useEffect(() => {
    ensureSeeded();
    setState(readState());
    return subscribeToAutomations(() => setState(readState()));
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

  const skillsKey = state.skills.map((skill) => `${skill.id}:${skill.enabled ? 1 : 0}:${skill.regions.join('|')}`).join(',');

  // Check every enabled watch once, when the tab opens or the roster changes.
  useEffect(() => {
    for (const skill of state.skills) {
      if (skill.job === 'brief' || !skill.enabled) continue;
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
      skills: [...current.skills, skill],
      activity: [event(`Skill created: ${skill.name}`), ...current.activity],
    }));
  }

  function runBrief(skill: Skill): void {
    const items = composeBrief(today);
    const run: StoredBriefRun = {
      id: automationId('run'),
      kind: 'brief',
      skillId: skill.id,
      skillName: skill.name,
      at: Date.now(),
      status: 'review',
      items,
      recipientNames: resolveRecipients(skill.recipients, skill.regions).map((person) => person.name),
    };
    mutateState((current) => ({
      ...current,
      runs: [run, ...current.runs],
      activity: [event(`${skill.name} ran — ${items.length} priorities in review`), ...current.activity],
    }));
  }

  async function runWatch(skill: Skill): Promise<void> {
    if (busy[skill.id]) return;
    setBusy((current) => ({ ...current, [skill.id]: true }));
    try {
      const cached = checksRef.current[skill.id];
      const fresh = cached && cached.status === 'ok' && Date.now() - cached.at < 60_000;
      const hits = fresh && cached.status === 'ok' ? cached.hits : await checkSkill(skill);
      if (!hits) return;

      if (hits.length === 0) {
        mutateState((current) => ({
          ...current,
          activity: [event(`${skill.name} checked — nothing flagged`), ...current.activity],
        }));
        return;
      }

      const run: StoredWatchRun = {
        id: automationId('run'),
        kind: 'watch',
        skillId: skill.id,
        skillName: skill.name,
        job: skill.job === 'brief' ? 'watch-cl' : skill.job,
        at: Date.now(),
        hits: hits.map((hit) => ({ ...hit, status: 'review' as const })),
        recipientNames: resolveRecipients(skill.recipients, skill.regions).map((person) => person.name),
      };
      mutateState((current) => ({
        ...current,
        runs: [run, ...current.runs],
        activity: [event(`${skill.name} ran — ${hits.length} to review`), ...current.activity],
      }));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[skill.id];
        return next;
      });
    }
  }

  function runSkill(skill: Skill): void {
    if (skill.job === 'brief') runBrief(skill);
    else void runWatch(skill);
  }

  /* ── Review actions ────────────────────────────────────────────────────── */

  function approveBrief(run: StoredBriefRun): void {
    mutateState((current) => ({
      ...current,
      runs: current.runs.map((entry) =>
        entry.id === run.id && entry.kind === 'brief' ? { ...entry, status: 'approved' as const } : entry,
      ),
      activity: [event(`${run.skillName} approved — queued for ${namesLine(run.recipientNames)}`), ...current.activity],
    }));
  }

  function discardBrief(run: StoredBriefRun): void {
    mutateState((current) => ({
      ...current,
      runs: current.runs.filter((entry) => entry.id !== run.id),
      activity: [event(`${run.skillName} discarded`), ...current.activity],
    }));
  }

  function hasOpenTask(job: StoredWatchRun['job'], practiceId: string): boolean {
    return state.tasks.some((task) => !task.done && task.job === job && task.practiceId === practiceId);
  }

  function taskFor(run: StoredWatchRun, hit: StoredWatchHit): AutomationTask {
    return {
      id: automationId('task'),
      title: `${jobDef(run.job).taskLabel} — ${hit.name}`,
      practiceId: hit.practiceId,
      practiceName: hit.name,
      region: hit.region,
      job: run.job,
      owner: hit.owner?.name ?? hit.manager,
      ownerRole: hit.owner?.role ?? 'Practice manager',
      dueAt: dueDateAfter(7),
      createdAt: Date.now(),
      done: false,
    };
  }

  function approveHit(run: StoredWatchRun, hit: StoredWatchHit): void {
    const task = taskFor(run, hit);
    mutateState((current) => ({
      ...current,
      runs: current.runs.map((entry) =>
        entry.id === run.id && entry.kind === 'watch'
          ? {
              ...entry,
              hits: entry.hits.map((h) =>
                h.practiceId === hit.practiceId && h.status === 'review'
                  ? { ...h, status: 'task' as const, taskId: task.id }
                  : h,
              ),
            }
          : entry,
      ),
      tasks: [task, ...current.tasks],
      activity: [
        event(`Task for ${task.owner}: ${task.title}, due ${dueLabel(task.dueAt)}`),
        ...current.activity,
      ],
    }));
  }

  function dismissHit(run: StoredWatchRun, hit: StoredWatchHit): void {
    mutateState((current) => ({
      ...current,
      runs: current.runs.map((entry) =>
        entry.id === run.id && entry.kind === 'watch'
          ? {
              ...entry,
              hits: entry.hits.map((h) =>
                h.practiceId === hit.practiceId && h.status === 'review'
                  ? { ...h, status: 'discarded' as const }
                  : h,
              ),
            }
          : entry,
      ),
      activity: [event(`${hit.name} dismissed from ${run.skillName}`), ...current.activity],
    }));
  }

  function approveAll(run: StoredWatchRun): void {
    const candidates = run.hits.filter((hit) => hit.status === 'review' && !hasOpenTask(run.job, hit.practiceId));
    if (candidates.length === 0) return;
    const tasks = candidates.map((hit) => taskFor(run, hit));
    const taskByPractice = new Map(tasks.map((task) => [task.practiceId, task]));
    mutateState((current) => ({
      ...current,
      runs: current.runs.map((entry) =>
        entry.id === run.id && entry.kind === 'watch'
          ? {
              ...entry,
              hits: entry.hits.map((h) => {
                const task = taskByPractice.get(h.practiceId);
                return h.status === 'review' && task ? { ...h, status: 'task' as const, taskId: task.id } : h;
              }),
            }
          : entry,
      ),
      tasks: [...tasks, ...current.tasks],
      activity: [
        event(`${tasks.length} task${tasks.length === 1 ? '' : 's'} created from ${run.skillName}`),
        ...current.activity,
      ],
    }));
  }

  function discardAll(run: StoredWatchRun): void {
    mutateState((current) => ({
      ...current,
      runs: current.runs.map((entry) =>
        entry.id === run.id && entry.kind === 'watch'
          ? { ...entry, hits: entry.hits.map((h) => (h.status === 'review' ? { ...h, status: 'discarded' as const } : h)) }
          : entry,
      ),
      activity: [event(`${run.skillName} run dismissed`), ...current.activity],
    }));
  }

  /* ── Task actions ──────────────────────────────────────────────────────── */

  function toggleTask(task: AutomationTask): void {
    mutateState((current) => ({
      ...current,
      tasks: current.tasks.map((entry) => (entry.id === task.id ? { ...entry, done: !entry.done } : entry)),
      activity: [event(task.done ? `Reopened: ${task.title}` : `Done: ${task.title}`), ...current.activity],
    }));
  }

  function setTaskDue(task: AutomationTask, dueAt: string): void {
    if (!dueAt) return;
    mutateState((current) => ({
      ...current,
      tasks: current.tasks.map((entry) => (entry.id === task.id ? { ...entry, dueAt } : entry)),
    }));
  }

  function removeTask(task: AutomationTask): void {
    mutateState((current) => ({
      ...current,
      tasks: current.tasks.filter((entry) => entry.id !== task.id),
      activity: [event(`Task removed: ${task.title}`), ...current.activity],
    }));
  }

  /* ── Derived ───────────────────────────────────────────────────────────── */

  const awaitingReview = useMemo(
    () =>
      state.runs.reduce((count, run) => {
        if (run.kind === 'brief') return count + (run.status === 'review' ? 1 : 0);
        return count + run.hits.filter((hit) => hit.status === 'review').length;
      }, 0),
    [state.runs],
  );

  const lastRunBySkill = useMemo(() => {
    const map = new Map<string, number>();
    for (const run of state.runs) {
      const current = map.get(run.skillId) ?? 0;
      if (run.at > current) map.set(run.skillId, run.at);
    }
    return map;
  }, [state.runs]);

  const enabledCount = state.skills.filter((skill) => skill.enabled).length;
  const openTaskCount = state.tasks.filter((task) => !task.done).length;
  const todayIso = new Date().toISOString().slice(0, 10);
  const sortedTasks = useMemo(
    () =>
      [...state.tasks].sort(
        (a, b) => Number(a.done) - Number(b.done) || a.dueAt.localeCompare(b.dueAt) || b.createdAt - a.createdAt,
      ),
    [state.tasks],
  );

  return (
    <div className="h-full overflow-y-auto">
      <SkillDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreate={createSkill} />
      <div className="mx-auto max-w-4xl px-6 py-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Automations</h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Skills that watch the real data and prepare the work. Nothing is sent automatically;
              every run lands in review, and every approval is on the record.
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
                {enabledCount} of {state.skills.length} on
              </Pill>
              {/* Shipped skills pause; custom ones have their own bin. Reset
                  is the clean slate: the shipped four, on, empty inbox. */}
              <button
                onClick={resetAutomations}
                title="Back to the four shipped skills, all on, with an empty inbox, tasks and ledger"
                className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Reset
              </button>
            </>
          }
        >
          {state.skills.length === 0 ? (
            <EmptyNote>
              No skills. Reset brings the four shipped ones back, or build your own with New skill.
            </EmptyNote>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {state.skills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  check={checks[skill.id]}
                  lastRunAt={lastRunBySkill.get(skill.id) ?? null}
                  busy={Boolean(busy[skill.id])}
                  onToggle={toggleSkill}
                  onRun={runSkill}
                  onRemove={removeSkill}
                />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Review inbox"
          aside={awaitingReview > 0 ? <Pill tone="accent">{awaitingReview} awaiting review</Pill> : null}
        >
          {state.runs.length === 0 ? (
            <EmptyNote>
              Nothing waiting. Run a skill and its output lands here with the real figures, for a
              person to approve.
            </EmptyNote>
          ) : (
            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {state.runs.map((run) =>
                  run.kind === 'brief' ? (
                    <BriefRunCard
                      key={run.id}
                      run={run}
                      onApprove={approveBrief}
                      onDiscard={discardBrief}
                      onAsk={ask}
                      onOpenPractice={openPractice}
                      onOpenRegion={openRegion}
                    />
                  ) : (
                    <WatchRunCard
                      key={run.id}
                      run={run}
                      tasks={state.tasks}
                      hasOpenTask={hasOpenTask}
                      onApproveHit={approveHit}
                      onDismissHit={dismissHit}
                      onApproveAll={approveAll}
                      onDiscardAll={discardAll}
                      onAsk={(hit) => ask(`Why is ${hit.name} flagged for ${jobDef(run.job).taskLabel.toLowerCase()}? What should I look at first?`)}
                      onShowMap={(hit) => openPractice(hit.practiceId)}
                    />
                  ),
                )}
              </AnimatePresence>
            </div>
          )}
        </Section>

        <Section title="Tasks" aside={openTaskCount > 0 ? <Pill tone="accent">{openTaskCount} open</Pill> : null}>
          {state.tasks.length === 0 ? (
            <EmptyNote>
              No tasks yet. Approving a hit creates one with the right owner (the practice manager,
              or the regional lead when the guidance requires it) and a review date.
            </EmptyNote>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {sortedTasks.map((task) => {
                const overdue = !task.done && task.dueAt < todayIso;
                return (
                  <li key={task.id} className="flex items-center gap-3 px-4 py-2.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={task.done}
                      aria-label={`Mark ${task.title} ${task.done ? 'not done' : 'done'}`}
                      onClick={() => toggleTask(task)}
                      className={cn(
                        'grid size-4 shrink-0 place-items-center rounded-full border transition-colors',
                        task.done
                          ? 'border-[color:var(--accent-600)] bg-[var(--accent-600)] text-white'
                          : 'border-border hover:border-[color:var(--accent-border)]',
                      )}
                    >
                      {task.done ? <Check className="size-2.5" /> : null}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'truncate text-xs font-medium',
                          task.done && 'text-muted-foreground line-through',
                        )}
                      >
                        {task.title}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {task.owner} · {task.ownerRole} · {task.region}
                      </p>
                    </div>
                    <input
                      type="date"
                      value={task.dueAt}
                      onChange={(event) => setTaskDue(task, event.target.value)}
                      disabled={task.done}
                      aria-label={`Review date for ${task.title}`}
                      className={cn(
                        'h-7 shrink-0 rounded-md bg-transparent px-1 text-[11px] tabular-nums outline-none transition-colors hover:bg-accent focus:bg-accent disabled:opacity-50',
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
                className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Clear
              </button>
            ) : undefined
          }
        >
          {state.activity.length === 0 ? (
            <EmptyNote>Runs, approvals and tasks are logged here as they happen.</EmptyNote>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {state.activity.slice(0, 10).map((entry) => (
                <li key={entry.id} className="flex items-baseline gap-3 px-4 py-2 text-xs">
                  <span className="w-[92px] shrink-0 text-[11px] tabular-nums text-muted-foreground">
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
