'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
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
import { automationId } from '@/lib/automations-store';
import { ALL_REGIONS, JOBS, resolveRecipients } from '@/automations/catalog';
import { cn } from '@/lib/utils';
import type { JobKey, RecipientSet, Skill } from '@/automations/types';

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
        'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
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
  const [job, setJob] = useState<JobKey>('brief');
  const [name, setName] = useState('');
  const [regions, setRegions] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<RecipientSet>({
    group: true,
    regionLeads: false,
    mentors: false,
  });

  // Every open starts clean, with the brief as the default job.
  useEffect(() => {
    if (!open) return;
    setJob('brief');
    setName('');
    setRegions([]);
    setRecipients({ group: true, regionLeads: false, mentors: false });
  }, [open]);

  const selectedJob = JOBS.find((def) => def.key === job)!;
  const scopeable = selectedJob.scopeable;
  const hasRecipient = recipients.group || recipients.regionLeads || recipients.mentors;
  const canCreate = hasRecipient;

  function chooseJob(next: JobKey): void {
    const def = JOBS.find((entry) => entry.key === next)!;
    setJob(next);
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
    onCreate({
      id: automationId('skill'),
      name: name.trim() || selectedJob.name,
      job,
      regions: scopeable ? regions : [],
      recipients,
      enabled: true,
      createdAt: Date.now(),
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        <DialogHeader className="relative border-b border-border px-5 pb-4 pr-14 pt-5 text-left">
          <DialogTitle className="text-lg font-semibold tracking-tight">New skill</DialogTitle>
          <DialogDescription className="pt-1">
            Choose what it watches, where, and who it goes to. Every run lands in review before
            anything moves.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
          {/* What it does */}
          <section>
            <p className="label-caps pb-2">What it does</p>
            <div role="radiogroup" aria-label="What the skill does" className="space-y-1.5">
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
                      'w-full rounded-lg border px-3.5 py-2.5 text-left transition-colors',
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

          {/* Name */}
          <section>
            <label className="label-caps block pb-2" htmlFor="skill-name">
              Name
            </label>
            <Input
              id="skill-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={selectedJob.name}
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
                        'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
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
          ) : (
            <section>
              <p className="label-caps pb-2">Where</p>
              <p className="text-[11px] text-muted-foreground">
                The brief always covers the whole group; that is what makes it five priorities.
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
        </div>

        <DialogFooter className="border-t border-border px-5 py-3.5 sm:justify-between">
          <p className="max-w-[260px] text-[11px] leading-relaxed text-muted-foreground">
            Nothing is sent automatically. Approving a run queues it; sending connects when the
            backend lands.
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
