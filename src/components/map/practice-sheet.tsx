'use client';

import { ArrowRight, GraduationCap, MessageSquare, TrendingDown, User } from 'lucide-react';
import type { MapPractice } from '@/data/map-model';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 30 - ((value - min) / span) * 26;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const falling = values[values.length - 1] < values[0];
  return (
    <svg viewBox="0 0 100 32" className="h-8 w-full" role="img" aria-label="Revenue over the last six months" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={falling ? 'var(--coral)' : 'oklch(var(--chart-3))'} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="surface-well rounded-lg bg-secondary/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function PracticeSheet({
  practice,
  open,
  onOpenChange,
  onAsk,
  onHighlight,
}: {
  practice: MapPractice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAsk: (question: string) => void;
  onHighlight: (practiceId: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {practice ? (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{practice.region}</Badge>
                <Badge variant={practice.attentionBand === 'high' ? 'destructive' : 'outline'}>
                  attention {practice.attentionScore}/100
                </Badge>
              </div>
              <SheetTitle className="mt-2">{practice.name}</SheetTitle>
              <SheetDescription>
                {practice.manager} · {practice.pmsSystem} · mentor {practice.mentorName}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <Metric label="Revenue" value={practice.revenueDisplay} sub={`${practice.revenueAttainmentDisplay} of ${practice.revenueTargetDisplay}`} />
              <Metric label="vs last month" value={practice.revenueMoMDisplay} sub="revenue" />
              <Metric label="Conversion" value={practice.conversionDisplay} sub={practice.conversionMoMDisplay} />
              <Metric label="Contact lens" value={practice.clAttainmentDisplay} sub={`${practice.clActualDisplay} of ${practice.clTargetDisplay}`} />
              <Metric label="Training" value={practice.trainingCompletionDisplay} sub={practice.trainingOverdue > 0 ? `${practice.trainingOverdue} overdue` : 'no overdue'} />
              <Metric label="Manager" value={practice.manager.split(' ')[0]} sub="practice manager" />
            </div>

            <div className="mt-5">
              <p className="label-caps mb-2">Revenue, last six months</p>
              <Sparkline values={practice.revenueTrend} />
            </div>

            {practice.attentionSignals.length > 0 ? (
              <div className="mt-5">
                <p className="label-caps mb-2">What the data shows</p>
                <ul className="space-y-1.5">
                  {practice.attentionSignals.map((signal, index) => (
                    <li key={`${index}-${signal.slice(0, 24)}`} className="flex gap-2 text-xs text-muted-foreground">
                      <TrendingDown className="mt-0.5 size-3.5 shrink-0 text-coral" />
                      <span>{signal}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-5 text-xs text-muted-foreground">No attention signals fired for this practice in the latest month.</p>
            )}

            {practice.trainingGaps.length > 0 ? (
              <div className="mt-5">
                <p className="label-caps mb-2">Training gaps</p>
                <ul className="space-y-1">
                  {practice.trainingGaps.map((gap) => (
                    <li key={gap} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <GraduationCap className="size-3.5 text-coral" /> {gap}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
              <User className="size-3.5" /> Supported by {practice.mentorName}
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <Button
                onClick={() =>
                  onAsk(
                    `Show me ${practice.name} performance this month and what changed compared with last month.`,
                  )
                }
              >
                <MessageSquare /> Ask about this practice
              </Button>
              <Button variant="outline" onClick={() => onHighlight(practice.practiceId)}>
                Highlight on the map <ArrowRight />
              </Button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
