'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import { ArrowLeft, ChevronDown, X } from 'lucide-react';
import type { MapPractice } from '@/data/map-model';
import { Badge } from '@/components/ui/badge';
import { forceVisibleIfStuck } from '@/lib/anim';
import { cn } from '@/lib/utils';

/**
 * The compare page: a graphic-first comparison of any number of practices on
 * chosen metrics. The bars do the talking, the group median sits on every row
 * for context, and Explain opens the numbers behind a metric on demand.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.03 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE } },
};

interface CompareMetric {
  id: string;
  label: string;
  value: (practice: MapPractice) => number;
  format: (value: number) => string;
  spread: (value: number) => string;
  context: string;
}

const METRICS: CompareMetric[] = [
  {
    id: 'revenue',
    label: 'Revenue',
    value: (practice) => practice.revenue,
    format: (value) => `£${Math.round(value).toLocaleString('en-GB')}`,
    spread: (value) => `£${Math.round(value).toLocaleString('en-GB')}`,
    context: 'Total revenue for the latest month.',
  },
  {
    id: 'attainment',
    label: 'Revenue vs target',
    value: (practice) => practice.revenueAttainmentPct,
    format: (value) => `${value.toFixed(1)}%`,
    spread: (value) => `${value.toFixed(1)}pp`,
    context: '100% means the month revenue target was met.',
  },
  {
    id: 'change',
    label: 'Revenue change',
    value: (practice) => practice.revenueMoMPct,
    format: (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`,
    spread: (value) => `${value.toFixed(1)}pp`,
    context: 'Change against the previous month.',
  },
  {
    id: 'conversion',
    label: 'Conversion',
    value: (practice) => practice.conversionPct,
    format: (value) => `${value.toFixed(1)}%`,
    spread: (value) => `${value.toFixed(1)}pp`,
    context: 'Share of eye exams that led to a purchase.',
  },
  {
    id: 'contactLens',
    label: 'Contact lens vs target',
    value: (practice) => practice.clAttainmentPct,
    format: (value) => `${value.toFixed(1)}%`,
    spread: (value) => `${value.toFixed(1)}pp`,
    context: 'Contact lens revenue against its target.',
  },
  {
    id: 'training',
    label: 'Training',
    value: (practice) => practice.trainingCompletionPct,
    format: (value) => `${Math.round(value)}%`,
    spread: (value) => `${value.toFixed(1)}pp`,
    context: 'Required training modules complete.',
  },
];

const DEFAULT_METRICS = ['revenue', 'conversion', 'contactLens'];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function MetricRow({
  metric,
  chosen,
  all,
  open,
  onToggle,
}: {
  metric: CompareMetric;
  chosen: MapPractice[];
  all: MapPractice[];
  open: boolean;
  onToggle: () => void;
}) {
  const rows = useMemo(
    () =>
      chosen
        .map((practice) => ({ practice, value: metric.value(practice) }))
        .sort((a, b) => b.value - a.value),
    [chosen, metric],
  );
  const groupMedian = useMemo(() => median(all.map((practice) => metric.value(practice))), [all, metric]);

  const values = rows.map((row) => row.value);
  const lo = Math.min(0, ...values, groupMedian);
  const hi = Math.max(0, ...values, groupMedian);
  const span = hi - lo || 1;
  const zeroPct = ((0 - lo) / span) * 100;
  const hasNegative = values.some((value) => value < 0);
  const highest = rows[0];
  const lowest = rows[rows.length - 1];

  return (
    <motion.section variants={fadeUp} data-anim className="mt-6">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="label-caps">{metric.label}</p>
        <span className="text-[10px] text-muted-foreground">group median {metric.format(groupMedian)}</span>
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
          Explain
        </button>
      </div>

      <div className="mt-2 space-y-1.5">
        {rows.map((row) => {
          const leftPct = ((Math.min(row.value, 0) - lo) / span) * 100;
          const widthPct = (Math.abs(row.value) / span) * 100;
          return (
            <div key={row.practice.practiceId} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-xs text-foreground">{row.practice.name}</span>
              <div className="relative h-5 min-w-0 flex-1 overflow-hidden rounded bg-secondary/60">
                {hasNegative ? (
                  <span aria-hidden className="absolute inset-y-0 w-px bg-border" style={{ left: `${zeroPct}%` }} />
                ) : null}
                <span
                  className={cn('absolute inset-y-0.5 rounded-[4px]', row.value < 0 ? 'bg-[var(--bad)]' : 'bg-[var(--accent-500)]')}
                  style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-xs tabular-nums text-foreground">{metric.format(row.value)}</span>
            </div>
          );
        })}
      </div>

      {open ? (
        <motion.div
          data-anim
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="mt-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground"
        >
          <p>{metric.context}</p>
          {rows.length > 1 && highest && lowest ? (
            <p className="mt-1">
              Highest {highest.practice.name} {metric.format(highest.value)} · Lowest {lowest.practice.name}{' '}
              {metric.format(lowest.value)} · Spread {metric.spread(highest.value - lowest.value)} · Group median{' '}
              {metric.format(groupMedian)}
            </p>
          ) : (
            <p className="mt-1">Group median {metric.format(groupMedian)}.</p>
          )}
        </motion.div>
      ) : null}
    </motion.section>
  );
}

export function ComparePage({
  practices,
  selectedIds,
  onRemove,
  onBack,
}: {
  /** Every practice in the group, for the median on every row. */
  practices: MapPractice[];
  /** The chosen practices, in the order they were picked on the map. */
  selectedIds: string[];
  onRemove: (practiceId: string) => void;
  onBack: () => void;
}) {
  const [metricIds, setMetricIds] = useState<string[]>(DEFAULT_METRICS);
  const [explained, setExplained] = useState<string[]>([]);
  const panelRef = useRef<HTMLElement | null>(null);

  // Safety net for the entrance, same pattern as the practice page.
  useEffect(() => {
    const timer = window.setTimeout(() => forceVisibleIfStuck(panelRef.current), 700);
    return () => window.clearTimeout(timer);
  }, []);

  const chosen = useMemo(
    () =>
      selectedIds
        .map((id) => practices.find((practice) => practice.practiceId === id))
        .filter((practice): practice is MapPractice => Boolean(practice)),
    [practices, selectedIds],
  );

  function toggleMetric(id: string): void {
    setMetricIds((current) => (current.includes(id) ? current.filter((metric) => metric !== id) : [...current, id]));
  }

  function toggleExplain(id: string): void {
    setExplained((current) => (current.includes(id) ? current.filter((metric) => metric !== id) : [...current, id]));
  }

  const activeMetrics = METRICS.filter((metric) => metricIds.includes(metric.id));

  return (
    <motion.section
      ref={panelRef}
      data-anim
      initial={{ y: 14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.28, ease: EASE }}
      aria-label="Compare practices"
      className="flex min-h-0 flex-1 flex-col bg-card"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <motion.div variants={stagger} initial="hidden" animate="show" className="mx-auto w-full max-w-6xl px-8 py-6">
          <motion.div variants={fadeUp} data-anim className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Map
            </button>
            <h2 className="text-lg font-semibold tracking-tight">Compare practices</h2>
            <Badge variant="secondary">
              {chosen.length} selected
            </Badge>
            <button
              onClick={onBack}
              aria-label="Back to map"
              className="ml-auto grid size-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </motion.div>

          {/* Who is in the comparison, and the way to change the line-up. */}
          <motion.div variants={fadeUp} data-anim className="mt-4 flex flex-wrap items-center gap-1.5">
            {chosen.map((practice) => (
              <span
                key={practice.practiceId}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs"
              >
                {practice.name}
                <button
                  onClick={() => onRemove(practice.practiceId)}
                  aria-label={`Remove ${practice.name}`}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <button
              onClick={onBack}
              className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Add or change on the map
            </button>
          </motion.div>

          {/* Which metrics to put under the lens. */}
          <motion.div variants={fadeUp} data-anim className="mt-5 flex flex-wrap items-center gap-1.5">
            <span className="label-caps mr-1">Metrics</span>
            {METRICS.map((metric) => {
              const active = metricIds.includes(metric.id);
              return (
                <button
                  key={metric.id}
                  onClick={() => toggleMetric(metric.id)}
                  aria-pressed={active}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    active
                      ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {metric.label}
                </button>
              );
            })}
          </motion.div>

          {activeMetrics.length === 0 ? (
            <motion.p variants={fadeUp} data-anim className="mt-6 text-xs text-muted-foreground">
              Pick at least one metric to compare.
            </motion.p>
          ) : (
            activeMetrics.map((metric) => (
              <MetricRow
                key={metric.id}
                metric={metric}
                chosen={chosen}
                all={practices}
                open={explained.includes(metric.id)}
                onToggle={() => toggleExplain(metric.id)}
              />
            ))
          )}
        </motion.div>
      </div>
    </motion.section>
  );
}
