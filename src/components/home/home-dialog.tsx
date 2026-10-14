'use client';

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowUp, ArrowUpRight, MapPin, MoreHorizontal, Sparkles, X } from 'lucide-react';
import type { TodayPriorities, TodayPriority } from '@/data';
import type { MapPractice } from '@/data/map-model';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const EASE = [0.22, 1, 0.36, 1] as const;

/** The Ask button with a real press response; the ghost styling stays in place. */
const MotionAsk = motion.create(Button);

const ISSUE_LABEL: Record<TodayPriority['issue'], string> = {
  'region-underperformance': 'Region underperformance',
  'sales-decline': 'Sales decline',
  'cl-below-target': 'Contact lens below target',
  training: 'Training incomplete',
};

/** Time-of-day greeting so the header is honest whatever the hour. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}

/** 72.5 stays 72.5, 40 stays 40. */
function pctLabel(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Pull the signed percentage out of a pre-formatted comparison so it can be a
 * coloured figure; whatever remains ("vs Sep 2026") stays as quiet text.
 */
function splitDelta(comparison: string): { delta: string; down: boolean; rest: string } | null {
  const match = comparison.match(/\(?([+-]\d+(?:\.\d+)?)%\)?/);
  if (!match) return null;
  return {
    delta: `${Math.abs(Number(match[1]))}%`,
    down: match[1].startsWith('-'),
    rest: comparison.replace(match[0], ' ').replace(/\s{2,}/g, ' ').trim(),
  };
}

/** Evidence with the falling figures in the data red, everything else quiet. */
function EvidenceParts({ text }: { text: string }) {
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

/**
 * One priority. The same quiet anatomy for every row, no matter the issue:
 * who and why on the left, the headline number and its movement on the right.
 * Colour appears only on the figures, where it means something.
 */
function PriorityRow({
  item,
  index,
  resolvePracticeName,
  resolvePractice,
  onOpenPractice,
  onAskAbout,
  onShowOnMap,
  onDismiss,
}: {
  item: TodayPriority;
  index: number;
  resolvePracticeName: (practiceId: string) => string;
  resolvePractice: (practiceId: string) => MapPractice | undefined;
  onOpenPractice: (practiceId: string) => void;
  onAskAbout: (question: string) => void;
  onShowOnMap: (item: TodayPriority) => void;
  onDismiss: (id: string) => void;
}) {
  const practiceId = item.practiceId;
  const name = practiceId ? resolvePracticeName(practiceId) : item.region ?? 'Group';
  const practice = practiceId ? resolvePractice(practiceId) : undefined;
  const reduceMotion = useReducedMotion();
  const money = item.issue === 'region-underperformance' || item.issue === 'sales-decline';
  const delta = splitDelta(item.metric.comparison);

  // The headline number: the money for falling rows, the attainment for target
  // and training rows.
  const headline = money
    ? item.metric.value
    : practice
      ? `${pctLabel(item.issue === 'cl-below-target' ? practice.clAttainmentPct : practice.trainingCompletionPct)}%`
      : item.metric.value;
  const caption = item.issue === 'cl-below-target' ? 'of target' : 'complete';

  // The question one tap would have typed: practice-name first, so the
  // practice tool has everything it needs.
  const issue = ISSUE_LABEL[item.issue].toLowerCase();
  const askAbout = practiceId
    ? `Why is ${name} flagged for ${issue}? What should I look at first?`
    : `Why is ${item.region ?? 'the group'} flagged for ${issue}? What should I look at first?`;

  return (
    <motion.li
      data-anim
      layout="position"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: {
          duration: reduceMotion ? 0 : 0.28,
          delay: reduceMotion ? 0 : 0.04 + index * 0.04,
          ease: EASE,
        },
      }}
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: 0 } }
          : { opacity: 0, x: 28, transition: { duration: 0.2, ease: EASE } }
      }
      transition={{ layout: { type: 'spring', stiffness: 480, damping: 42 } }}
      onClick={practiceId ? () => onOpenPractice(practiceId) : undefined}
      className={cn(
        'flex items-center gap-6 px-[15px] py-3 transition-colors hover:bg-accent',
        practiceId && 'cursor-pointer',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {name}
          {/* The category rides the title line, which has room; the data line
              below stays whole instead of truncating mid-sentence. */}
          <span className="font-normal text-muted-foreground"> · {ISSUE_LABEL[item.issue]}</span>
          {practiceId && item.region ? (
            <span className="font-normal text-muted-foreground"> · {item.region}</span>
          ) : null}
        </p>
        <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground">
          {/* The second signal, not the headline metric again: conversion when
              revenue is the number, missing modules when training is. */}
          <EvidenceParts text={item.evidence[1] ?? item.evidence[0] ?? ''} />
        </p>
      </div>

      {/* A fixed column, so every number stacks on the same right edge. */}
      <div className="hidden w-[150px] shrink-0 text-right sm:block">
        <p className="text-lg font-semibold leading-tight tabular-nums">{headline}</p>
        {money && delta ? (
          <p className="mt-0.5 text-xs tabular-nums">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                delta.down ? 'text-[var(--bad)]' : 'text-[var(--good)]',
              )}
            >
              {delta.down ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />}
              {delta.delta}
            </span>
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">{money ? item.metric.comparison : caption}</p>
        )}
      </div>

      {/* Actions last, where every dashboard puts them: the copy reads, the
          number answers, the buttons wait. Quiet by design: grey until you
          reach for them, so no row shouts. */}
      <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
        <MotionAsk
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          whileTap={{ scale: 0.96 }}
          onClick={() => onAskAbout(askAbout)}
        >
          <Sparkles />
          Ask
        </MotionAsk>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              aria-label={`Options for ${name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
            {practiceId ? (
              <DropdownMenuItem onSelect={() => onOpenPractice(practiceId)}>
                <ArrowUpRight />
                Open practice
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => onShowOnMap(item)}>
              <MapPin />
              Show on map
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onDismiss(item.id)}
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <X />
              Dismiss
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

    </motion.li>
  );
}

export function HomeDialog({
  open,
  onOpenChange,
  today,
  practiceName,
  practiceOf,
  onOpenPractice,
  onAskAbout,
  onShowOnMap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: TodayPriorities;
  practiceName: (practiceId: string) => string;
  practiceOf: (practiceId: string) => MapPractice | undefined;
  onOpenPractice: (practiceId: string) => void;
  onAskAbout: (question: string) => void;
  onShowOnMap: (item: TodayPriority) => void;
}) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const priorities = today.items.slice(0, 5);
  const visible = priorities.filter((item) => !dismissedIds.includes(item.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="relative mx-[5px] border-b border-border px-[19px] pb-4 pr-14 pt-5 text-left">
          <DialogTitle className="text-lg font-semibold tracking-tight">What needs attention today</DialogTitle>
          <DialogDescription className="pt-1">
            {greeting()}, Sara · {priorities.length} priorities for {today.monthLabel}
          </DialogDescription>
        </DialogHeader>

        {visible.length > 0 ? (
          <ul className="mx-[5px] max-h-[60vh] divide-y divide-border overflow-y-auto">
            {/* Rows cascade in on open and leave gracefully on dismiss, while
                the rest slide up to fill the space. */}
            <AnimatePresence>
              {visible.map((item, index) => (
                <PriorityRow
                  key={item.id}
                  item={item}
                  index={index}
                  resolvePracticeName={practiceName}
                  resolvePractice={practiceOf}
                  onOpenPractice={onOpenPractice}
                  onAskAbout={onAskAbout}
                  onShowOnMap={onShowOnMap}
                  onDismiss={(id) => setDismissedIds((ids) => [...ids, id])}
                />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="px-6 py-10 text-center text-sm text-muted-foreground"
          >
            Every priority is dismissed. Reopen Home any time from the sidebar.
          </motion.p>
        )}
      </DialogContent>
    </Dialog>
  );
}
