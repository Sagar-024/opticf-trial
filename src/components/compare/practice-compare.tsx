'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, FileText, MapPin, X } from 'lucide-react';
import { COMPARE_METRIC_IDS, type CompareBar, type CompareRow, type CompareRowId, type CompareSide, type CompareView } from '@/compare/model';
import { BRAIN_DOCUMENTS } from '@/content/brain';
import { cn } from '@/lib/utils';

/**
 * The comparison, in two pieces.
 *
 * `PracticeCompare` is the graphic: any number of practices, one simple line
 * per metric, the metric picker, and last month in one quiet line.
 *
 * `CompareExplain` is the explanation, deliberately its own block: it renders
 * under the graphic, so the card stays a chart and the words live where words
 * belong.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The sides wear the map's own data colours, cycled: orange, blue, teal,
 * amber, violet. Same palette the regions and mentors use, so a comparison
 * always looks like it belongs to this product.
 */
const SIDE_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'] as const;

function sideToken(index: number): string {
  return SIDE_TOKENS[index % SIDE_TOKENS.length];
}

function ink(token: string): string {
  return `oklch(var(${token}))`;
}

function SideChip({
  side,
  index,
  onRemove,
}: {
  side: CompareSide;
  index: number;
  onRemove?: (practiceId: string) => void;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-2 pr-2.5">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: ink(sideToken(index)) }} />
      <span className="truncate text-[11px] font-semibold">{side.name}</span>
      <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">{side.region}</span>
      {onRemove ? (
        <button
          onClick={() => onRemove(side.practiceId)}
          aria-label={`Remove ${side.name} from the comparison`}
          className="ml-0.5 grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

/** The one line verdict: who is ahead, and on how many rows. */
function verdict(view: CompareView): string {
  const best = Math.max(...view.wins);
  const total = view.rows.length;
  if (best === 0) return `Level on all ${total} rows`;
  const leaders = view.sides.filter((_, index) => view.wins[index] === best).map((side) => side.name);
  if (leaders.length === 1) return `${leaders[0]} ahead on ${best} of ${total} rows`;
  return `${leaders.join(' and ')} tie on ${best} of ${total} rows`;
}

/** One simple line: the track, the practice's share of it, the reading. */
function Bar({
  bar,
  token,
  emphasised,
  delay,
}: {
  bar: CompareBar;
  token: string;
  /** The side that leads the row keeps the stronger ink; the others are muted. */
  emphasised: boolean;
  delay: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-[6px] min-w-0 flex-1 rounded-full bg-secondary/70">
        {bar.targetAt !== undefined ? (
          <span
            aria-hidden
            className="absolute inset-y-[-3px] w-px bg-[color:var(--line-strong)]"
            style={{ left: `${bar.targetAt * 100}%` }}
          />
        ) : null}
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: ink(token) }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(bar.fraction * 100, 1)}%` }}
          transition={{ duration: 0.5, delay, ease: EASE }}
        />
      </div>
      <span
        title={bar.detail}
        className={cn(
          'w-[64px] shrink-0 text-right text-[11px] tabular-nums',
          emphasised ? 'font-semibold text-foreground' : 'text-muted-foreground',
        )}
      >
        {bar.display}
      </span>
    </div>
  );
}

function MetricRow({ row, index }: { row: CompareRow; index: number }) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="text-[11px] font-medium text-foreground">{row.label}</span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {row.lead < 0 ? 'level' : `${row.gap} apart`}
        </span>
      </div>
      <div className="mt-1.5 space-y-[3px]">
        {row.bars.map((bar, barIndex) => (
          <Bar
            key={barIndex}
            bar={bar}
            token={sideToken(barIndex)}
            emphasised={row.lead < 0 || row.lead === barIndex}
            delay={index * 0.05 + barIndex * 0.03}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The graphic: who is compared, the verdict, the metric picker, one line per
 * metric, and the month-on-month move as a single quiet line.
 */
export function PracticeCompare({
  view,
  onRemove,
  className,
}: {
  view: CompareView;
  /** Drop a practice from the comparison. */
  onRemove?: (practiceId: string) => void;
  className?: string;
}) {
  const changeRow = view.rows[view.rows.length - 1];
  const metricRows = view.rows.filter((row) => !row.signed);
  const [metricIds, setMetricIds] = useState<CompareRowId[]>(COMPARE_METRIC_IDS);
  const shown = metricRows.filter((row) => metricIds.includes(row.id));

  function toggleMetric(id: CompareRowId): void {
    setMetricIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  return (
    <div className={cn('text-foreground', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {view.sides.map((side, index) => (
          <SideChip key={side.practiceId} side={side} index={index} onRemove={onRemove} />
        ))}
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {verdict(view)} · {view.monthLabel}
      </p>

      {/* Which metrics are under the lens. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {metricRows.map((row) => {
          const on = metricIds.includes(row.id);
          return (
            <button
              key={row.id}
              onClick={() => toggleMetric(row.id)}
              aria-pressed={on}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                on
                  ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {row.label}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="mt-3.5 border-t border-border pt-3.5 text-xs text-muted-foreground">
          Pick at least one metric to compare.
        </p>
      ) : (
        <div className="mt-3.5 space-y-3.5 border-t border-border pt-3.5">
          {shown.map((row, index) => (
            <MetricRow key={row.id} row={row} index={index} />
          ))}
        </div>
      )}

      {/* Last month, in one quiet line: every change, no extra chart. */}
      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[11px] text-muted-foreground">
        <span>Revenue since last month</span>
        {view.sides.map((side, index) => (
          <span key={side.practiceId} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full" style={{ background: ink(sideToken(index)) }} />
            <span className={cn('tabular-nums font-medium', changeRow.bars[index].leftward ? 'text-[var(--bad)]' : 'text-[var(--good)]')}>
              {changeRow.bars[index].display}
            </span>
          </span>
        ))}
        <span className="ml-auto text-[10px]">
          {changeRow.lead < 0 ? 'level' : `${changeRow.gap} apart`}
        </span>
      </div>
    </div>
  );
}

function Watch({ name, lines, token }: { name: string; lines: string[]; token: string }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[1.3px] text-muted-foreground">
        <span aria-hidden className="size-2 rounded-full" style={{ background: ink(token) }} />
        {name}
      </p>
      <ul className="space-y-1.5">
        {lines.map((line, index) => (
          <li key={index} className="text-[13px] leading-relaxed text-foreground/75">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The explanation, as its own block. It mounts under the graphic when Explain
 * is pressed, scrolls itself into view, and unmounts when Explain is pressed
 * again. Nothing here is folded inside the card.
 */
export function CompareExplain({
  view,
  notes,
  open,
  onToggle,
  streaming,
  onOpenBrain,
  onCompareOnMap,
  className,
}: {
  view: CompareView;
  /** The answer's prose, when the comparison came from chat. */
  notes?: string[];
  open: boolean;
  onToggle: () => void;
  /** True while the answer's prose is still arriving. */
  streaming?: boolean;
  onOpenBrain?: (documentTitle: string) => void;
  onCompareOnMap?: (practiceIds: string[]) => void;
  className?: string;
}) {
  const blockRef = useRef<HTMLDivElement | null>(null);

  const brainDocuments = useMemo(() => {
    const ids = view.sides.map((side) => side.practiceId);
    return BRAIN_DOCUMENTS.filter((document) =>
      (document.relatedPracticeIds ?? []).some((id) => ids.includes(id)),
    ).slice(0, 3);
  }, [view.sides]);

  // Opening Explain must visibly do something: the block often arrives below
  // the fold, so it brings itself into view as it opens.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      blockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <div className={cn(className)}>
      {/* The section heading, with a hairline running to a balanced oval
          control on the right. The block below is its own div. */}
      <div className="flex items-center gap-3">
        <h3 className="label-caps">Explain</h3>
        <span aria-hidden className="h-px min-w-4 flex-1 bg-border" />
        <button
          onClick={onToggle}
          aria-expanded={open}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
        >
          {streaming ? (
            <span aria-hidden className="flex items-center gap-[3px]">
              {[0, 1, 2].map((dot) => (
                <motion.span
                  key={dot}
                  className="size-1 rounded-full bg-[var(--accent-500)]"
                  animate={{ opacity: [0.25, 1, 0.25] }}
                  transition={{ duration: 1.1, repeat: Infinity, delay: dot * 0.16, ease: 'easeInOut' }}
                />
              ))}
            </span>
          ) : null}
          {open ? 'Hide' : 'Show'}
          <ChevronDown className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
        </button>
      </div>

      {open ? (
        <motion.div
          ref={blockRef}
          data-anim
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, ease: EASE }}
          className="mt-3 space-y-3.5 rounded-xl border border-border bg-card p-5"
        >
          {notes && notes.length > 0 ? (
            <div className="space-y-2.5">
              {notes.map((note, index) => (
                <p key={index} className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {note}
                </p>
              ))}
            </div>
          ) : null}

          {view.summary.length > 0 ? (
            <div>
              <p className="label-caps mb-2">What the numbers show</p>
              <ul className="space-y-1.5">
                {view.summary.map((line, index) => (
                  <li key={index} className="text-[13px] leading-relaxed text-foreground/80">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Every figure the graphic stands for, with the target it is read against. */}
          <div>
            <p className="label-caps mb-2">The numbers behind the bars</p>
            <div className="space-y-2.5">
              {view.rows.map((row) => (
                <div key={row.id}>
                  <p className="text-xs font-medium text-foreground">{row.label}</p>
                  <div className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {row.bars.map((bar, index) => (
                      <p key={index} className="flex items-baseline gap-2 text-xs leading-relaxed text-foreground/75">
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: ink(sideToken(index)) }}
                        />
                        <span className="min-w-0 truncate font-medium text-foreground/90">
                          {view.sides[index].name}
                        </span>
                        <span className="font-medium tabular-nums text-foreground">{bar.display}</span>
                        <span className="min-w-0 truncate">{bar.detail}</span>
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {view.watch.length > 0 ? (
            <div>
              <p className="label-caps mb-2">Where each stands</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {view.watch.map((entry) => {
                  const index = view.sides.findIndex((side) => side.practiceId === entry.practiceId);
                  return (
                    <Watch
                      key={entry.practiceId}
                      name={entry.name}
                      lines={entry.lines}
                      token={sideToken(Math.max(0, index))}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}

          {brainDocuments.length > 0 ? (
            <div>
              <p className="label-caps mb-2">From the Brain</p>
              <div className="space-y-1.5">
                {brainDocuments.map((document) => (
                  <button
                    key={document.id}
                    onClick={() => onOpenBrain?.(document.title)}
                    disabled={!onOpenBrain}
                    className="flex w-full items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left transition-colors enabled:hover:bg-accent disabled:opacity-70"
                  >
                    <FileText className="mt-0.5 size-4 shrink-0 text-[var(--accent-600)]" />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">{document.title}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {document.section} · {document.owner}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Hairlines mark each practice&rsquo;s own target, so they can sit in different places on the track.
          </p>

          {onCompareOnMap ? (
            <button
              onClick={() => onCompareOnMap(view.sides.map((side) => side.practiceId))}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-accent"
            >
              <MapPin className="size-3.5 text-[var(--accent-600)]" />
              Compare on the map
            </button>
          ) : null}
        </motion.div>
      ) : null}
    </div>
  );
}
