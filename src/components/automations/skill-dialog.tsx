'use client';

import { useEffect, useState } from 'react';
import { Check, ListChecks, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { automationId } from '@/lib/automations-store';
import { ALL_REGIONS, JOBS, resolveRecipients } from '@/automations/catalog';
import { cn } from '@/lib/utils';
import type { JobKey, RecipientSet, Skill, SkillJob } from '@/automations/types';

/**
 * The skill builder: what it watches, where, and who it goes to.
 *
 * Every choice is a real one. Jobs come from the catalogue, regions come from
 * the dataset, and recipients are the actual leads and mentors in the seed
 * directory. Nothing here types into the model; a skill is a saved,
 * switchable piece of recurring work.
 */

const RECIPIENT_LABEL: Array<{
  key: keyof RecipientSet;
  title: string;
  note: (regions: string[]) => string;
}> = [
  {
    key: 'group',
    title: 'Group leadership',
    note: () => 'Sara Kelly · Group leadership',
  },
  {
    key: 'regionLeads',
    title: 'Region leads',
    note: (regions) =>
      namesLabel(resolveRecipients({ group: false, regionLeads: true, mentors: false }, regions).map((r) => r.name)),
  },
  {
    key: 'mentors',
    title: 'Mentors',
    note: (regions) =>
      namesLabel(resolveRecipients({ group: false, regionLeads: false, mentors: true }, regions).map((r) => r.name)),
  },
];

function namesLabel(names: string[]): string {
  if (names.length === 0) return 'No one in this scope';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const CADENCES = ['daily', 'weekly', 'monthly'] as const;

/** "Weekly · Mondays 08:00" for the card. */
export function scheduleLabel(cadence: 'daily' | 'weekly' | 'monthly', weekday: string, time: string): string {
  if (cadence === 'daily') return `Daily · ${time}`;
  if (cadence === 'monthly') return `Monthly · 1st at ${time}`;
  return `Weekly · ${weekday}s ${time}`;
}

/** "Every Monday at 08:00" for the one-sentence summary. */
function scheduleSentence(cadence: 'daily' | 'weekly' | 'monthly', weekday: string, time: string): string {
  if (cadence === 'daily') return `Every day at ${time}`;
  if (cadence === 'monthly') return `On the 1st of each month at ${time}`;
  return `Every ${weekday} at ${time}`;
}

const CHIP =
  'rounded-full border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--line-strong)]';
const CHIP_ON = 'border-[color:var(--accent-border)] bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]';
const CHIP_OFF = 'border-border text-muted-foreground hover:text-foreground';

function CheckRow({
  checked,
  onToggle,
  title,
  note,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  note: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--line-strong)]',
        checked
          ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)]'
          : 'border-border hover:bg-accent',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid size-4 shrink-0 place-items-center rounded border transition-colors',
          checked ? 'border-[color:var(--accent-600)] bg-[var(--accent-600)] text-white' : 'border-border',
        )}
      >
        {checked ? <Check className="size-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{note}</span>
      </span>
    </button>
  );
}

export function SkillDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (skill: Skill) => void;
}) {
  const [mode, setMode] = useState<'check' | 'question' | null>(null);
  const [job, setJob] = useState<JobKey | null>(null);
  const [question, setQuestion] = useState('');
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [weekday, setWeekday] = useState<string>('Monday');
  const [time, setTime] = useState('08:00');
  const [name, setName] = useState('');
  const [regions, setRegions] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<RecipientSet>({
    group: true,
    regionLeads: false,
    mentors: false,
  });

  // Every open starts clean: nothing chosen yet, so nothing wears the accent.
  useEffect(() => {
    if (!open) return;
    setMode(null);
    setJob(null);
    setQuestion('');
    setCadence('weekly');
    setWeekday('Monday');
    setTime('08:00');
    setName('');
    setRegions([]);
    setRecipients({ group: true, regionLeads: false, mentors: false });
  }, [open]);

  const isQuestion = mode === 'question';
  const selectedJob = mode === 'check' && job ? JOBS.find((def) => def.key === job)! : null;
  const scopeable = selectedJob?.scopeable ?? false;
  const hasRecipient = recipients.group || recipients.regionLeads || recipients.mentors;
  const canCreate = isQuestion
    ? question.trim().length > 0 && hasRecipient
    : Boolean(selectedJob) && hasRecipient;
  const defaultNames = new Set(JOBS.map((def) => def.name));
  const recipientNames = namesLabel(resolveRecipients(recipients, regions).map((person) => person.name));
  const scopeLabel =
    regions.length === 0 ? 'all five regions' : regions.length === 1 ? regions[0] : `${regions.length} regions`;
  const recipe = isQuestion
    ? `${scheduleSentence(cadence, weekday, time)}: ask ${question.trim() ? `"${question.trim()}"` : 'your question'} and queue the answer for ${recipientNames}.`
    : selectedJob
      ? job === 'brief'
        ? `Every Monday at 07:30: compose the five priorities for the whole group, then queue them for ${recipientNames}.`
        : `Whenever the data changes: check ${scopeLabel} and queue anything it finds for ${recipientNames}.`
      : '';

  function chooseJob(next: JobKey): void {
    const def = JOBS.find((entry) => entry.key === next)!;
    setMode('check');
    setJob(next);
    setQuestion('');
    // The name follows the recipe until the reader types their own.
    setName((current) =>
      current.trim() === '' || defaultNames.has(current.trim()) ? def.name : current,
    );
    // Recipients follow the job's defaults until the user changes them.
    setRecipients(def.defaultRecipients);
    if (!def.scopeable) setRegions([]);
  }

  function toggleRegion(region: string): void {
    setRegions((current) =>
      current.includes(region) ? current.filter((entry) => entry !== region) : [...current, region],
    );
  }

  function create(): void {
    if (!canCreate) return;
    if (isQuestion) {
      const fallback = question.trim().split(/\s+/).slice(0, 6).join(' ') || 'Custom question';
      onCreate({
        id: automationId('skill'),
        name: name.trim() || fallback,
        job: 'question',
        question: question.trim(),
        schedule: { cadence, time, ...(cadence === 'weekly' ? { weekday } : {}) },
        regions: [],
        recipients,
        enabled: true,
        createdAt: Date.now(),
      });
      onOpenChange(false);
      return;
    }
    if (!selectedJob) return;
    onCreate({
      id: automationId('skill'),
      name: name.trim() || selectedJob.name,
      job: selectedJob.key,
      regions: scopeable ? regions : [],
      recipients,
      enabled: true,
      createdAt: Date.now(),
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogHeader className="relative border-b border-border px-5 pb-4 pr-14 pt-5 text-left">
          <DialogTitle className="text-lg font-semibold tracking-tight">New skill</DialogTitle>
          <DialogDescription className="pt-1">
            Start from a proven check, or write your own question.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* Two doors, chosen first: a proven check, or your own question. */}
          <section>
            <div className="grid gap-1.5 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={mode === 'check'}
                onClick={() => setMode('check')}
                className={cn(
                  'rounded-lg border px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--line-strong)]',
                  mode === 'check' ? 'border-[color:var(--accent-line)] bg-[var(--accent-soft)]' : 'border-border hover:bg-accent',
                )}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <ListChecks className="size-3.5 text-[var(--accent-600)]" />
                  A proven check
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                  Six tested checks over the real data.
                </span>
              </button>
              <button
                type="button"
                aria-pressed={isQuestion}
                onClick={() => setMode('question')}
                className={cn(
                  'rounded-lg border px-3.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--line-strong)]',
                  isQuestion ? 'border-[color:var(--accent-line)] bg-[var(--accent-soft)]' : 'border-border hover:bg-accent',
                )}
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Sparkles className="size-3.5 text-[var(--accent-600)]" />
                  Your own question
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                  Answered by the assistant, into review.
                </span>
              </button>
            </div>
          </section>

          {mode === 'check' ? (
            <section>
              <div role="radiogroup" aria-label="Which check" className="space-y-1.5">
              {JOBS.map((def) => {
                const selected = def.key === job;
                return (
                  <button
                    key={def.key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => chooseJob(def.key)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--line-strong)]',
                      selected
                        ? 'border-[color:var(--accent-line)] bg-[var(--accent-soft)]'
                        : 'border-border hover:bg-accent',
                    )}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold">{def.name}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{def.cadence}</span>
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                      {def.sentence}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
          ) : null}

          {isQuestion ? (
            <section>
              <label className="label-caps block pb-2" htmlFor="skill-question">
                The question
              </label>
              <Textarea
                id="skill-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="e.g. Which practices missed their contact lens target this month, and by how much?"
                rows={3}
                className="text-sm"
              />
            </section>
          ) : null}
          {isQuestion ? (
            <section>
              <p className="label-caps pb-2">When it runs</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {CADENCES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={cadence === option}
                    onClick={() => setCadence(option)}
                    className={cn(CHIP, cadence === option ? CHIP_ON : CHIP_OFF)}
                  >
                    {option[0].toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
              {cadence === 'weekly' ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={weekday === day}
                      onClick={() => setWeekday(day)}
                      className={cn(CHIP, weekday === day ? CHIP_ON : CHIP_OFF)}
                    >
                      {day.slice(0, 3)}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="mt-2.5 flex items-center gap-2">
                <label htmlFor="skill-time" className="text-xs text-muted-foreground">
                  At
                </label>
                <input
                  id="skill-time"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:border-[color:var(--line-strong)]"
                />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Until the platform has a scheduler, it runs when this tab is open.
              </p>
            </section>
          ) : null}

          {selectedJob || isQuestion ? (
            <>
          {/* Name */}
          <section>
            <label className="label-caps block pb-2" htmlFor="skill-name">
              Name
            </label>
            <Input
              id="skill-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={selectedJob?.name ?? 'Name it'}
              autoComplete="off"
            />
          </section>

          {/* Scope, for watches */}
          {scopeable ? (
            <section>
              <p className="label-caps pb-2">Where</p>
              <div className="flex flex-wrap gap-1.5">
                {ALL_REGIONS.map((region) => {
                  const selected = regions.includes(region);
                  return (
                    <button
                      key={region}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleRegion(region)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--line-strong)]',
                        selected
                          ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)] font-medium text-[var(--accent-text)]'
                          : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {region}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {regions.length === 0 ? 'No region selected checks all five.' : 'Only the selected regions are checked.'}
              </p>
            </section>
          ) : isQuestion ? null : (
            <section>
              <p className="label-caps pb-2">Where</p>
              <p className="rounded-lg border border-border px-3.5 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                Whole group, always. The brief exists to compare the regions against each other, so
                its scope is fixed.
              </p>
            </section>
          )}

          {/* Recipients */}
          <section>
            <p className="label-caps pb-2">Who it goes to</p>
            <div className="space-y-1.5">
              {RECIPIENT_LABEL.map((entry) => (
                <CheckRow
                  key={entry.key}
                  checked={recipients[entry.key]}
                  onToggle={() =>
                    setRecipients((current) => ({ ...current, [entry.key]: !current[entry.key] }))
                  }
                  title={entry.title}
                  note={entry.note(regions)}
                />
              ))}
            </div>
          </section>

          {/* The payoff: the skill as one sentence, updating as choices change. */}
          <p className="rounded-lg border border-[color:var(--accent-line)] bg-[var(--accent-soft)] px-3.5 py-2.5 text-xs leading-relaxed text-foreground/90">
            {recipe}
          </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Pick a check, or write your own question, then make it yours.
            </p>
          )}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3.5 sm:justify-between">
          <p className="max-w-[320px] text-[11px] leading-relaxed text-muted-foreground">
            Sending connects when the backend lands. Until then, every result queues and is
            labelled.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={create} disabled={!canCreate}>
              Create skill
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
