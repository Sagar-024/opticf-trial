'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import type { TodayPriorities, TodayPriority } from '@/data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const EASE = [0.22, 1, 0.36, 1] as const;

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

function PriorityCard({
  item,
  index,
  resolvePracticeName,
  onOpenPractice,
  onAskAbout,
  onShowOnMap,
  onDismiss,
}: {
  item: TodayPriority;
  index: number;
  resolvePracticeName: (practiceId: string) => string;
  onOpenPractice: (practiceId: string) => void;
  onAskAbout: (question: string) => void;
  onShowOnMap: (item: TodayPriority) => void;
  onDismiss: (id: string) => void;
}) {
  const practiceId = item.practiceId;
  const heading = practiceId
    ? `${resolvePracticeName(practiceId)}, ${item.region}`
    : item.region ?? 'Group';
  // The question one tap would have typed: practice-name first, so the
  // practice tool has everything it needs.
  const issue = ISSUE_LABEL[item.issue].toLowerCase();
  const askAbout = practiceId
    ? `Why is ${resolvePracticeName(practiceId)} flagged for ${issue}? What should I look at first?`
    : `Why is ${item.region ?? 'the group'} flagged for ${issue}? What should I look at first?`;

  return (
    <motion.li
      data-anim
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, delay: 0.05 + index * 0.045, ease: EASE }}
      className="surface-card rounded-2xl border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold">{heading}</p>
        <Badge variant="outline" className="shrink-0 text-[10px] font-medium text-muted-foreground">
          {ISSUE_LABEL[item.issue]}
        </Badge>
      </div>

      <div className="surface-well mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg bg-secondary/60 px-3 py-2">
        <span className="label-caps">{item.metric.label}</span>
        <span className="text-base font-semibold tabular-nums">{item.metric.value}</span>
        <span className="text-xs text-muted-foreground">{item.metric.comparison}</span>
      </div>

      <ul className="mt-2.5 space-y-1">
        {item.evidence.slice(0, 2).map((line, lineIndex) => (
          <li key={`${item.id}-evidence-${lineIndex}`} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <span className="mt-[6px] size-1 shrink-0 rounded-full bg-[var(--accent-500)]" />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {practiceId ? (
          <Button size="sm" onClick={() => onOpenPractice(practiceId)}>
            Open Practice
            <ArrowRight />
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => onAskAbout(askAbout)}>
          <Sparkles className="text-[var(--accent-600)]" />
          Ask about this
        </Button>
        <Button size="sm" variant="outline" onClick={() => onShowOnMap(item)}>
          Show on Map
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => onDismiss(item.id)}
        >
          Dismiss
        </Button>
      </div>
    </motion.li>
  );
}

export function HomeDialog({
  open,
  onOpenChange,
  today,
  practiceCount,
  regionCount,
  practiceName,
  onOpenPractice,
  onAskAbout,
  onShowOnMap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: TodayPriorities;
  practiceCount: number;
  regionCount: number;
  practiceName: (practiceId: string) => string;
  onOpenPractice: (practiceId: string) => void;
  onAskAbout: (question: string) => void;
  onShowOnMap: (item: TodayPriority) => void;
}) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const priorities = today.items.slice(0, 5);
  const visible = priorities.filter((item) => !dismissedIds.includes(item.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 pb-4 pr-14 pt-6 text-left">
          <DialogTitle className="text-balance text-xl font-semibold leading-snug tracking-tight">
            {greeting()}, Optific<span className="text-[var(--accent-600)]">+</span>. Here are your top priorities for today.
          </DialogTitle>
          <DialogDescription className="text-pretty pt-1">
            {priorities.length} priorities for {today.monthLabel}, across {practiceCount} practices and {regionCount} regions.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[58vh] overflow-y-auto px-6 py-4">
          {visible.length > 0 ? (
            <ul className="space-y-3">
              {visible.map((item, index) => (
                <PriorityCard
                  key={item.id}
                  item={item}
                  index={index}
                  resolvePracticeName={practiceName}
                  onOpenPractice={onOpenPractice}
                  onAskAbout={onAskAbout}
                  onShowOnMap={onShowOnMap}
                  onDismiss={(id) => setDismissedIds((ids) => [...ids, id])}
                />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              Every priority is dismissed. Reopen Home any time from the sidebar.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-3">
          <p className="text-xs text-muted-foreground">{today.monthLabel}</p>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onOpenChange(false)}>
            Dismiss
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
