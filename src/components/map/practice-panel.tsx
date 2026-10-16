'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ArrowLeft, ArrowLeftRight, ArrowUp, FileText, ListPlus, Plus, Square, TrendingDown, TriangleAlert, X } from 'lucide-react';
import type { Widget } from '@/ai/types';
import { containsModelMarkup, stripModelMarkup, trimTrailingPartialTag } from '@/ai/markup';
import type { MapPractice } from '@/data/map-model';
import { mergeBrainDocuments, type BrainDocument } from '@/content/brain';
import { AssignTaskDialog } from '@/components/tasks/assign-task-dialog';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Textarea } from '@/components/ui/textarea';
import { WidgetRenderer } from '@/components/widgets/widget-renderer';
import { forceVisibleIfStuck } from '@/lib/anim';
import { readBrainState } from '@/lib/brain-store';
import { toolLabel } from '@/lib/tool-labels';
import { cn } from '@/lib/utils';

/**
 * The practice page: the whole area, like a popup over the map. One centred
 * column reads top to bottom (who, the numbers, the trend and why, the
 * reference), and the ask bar stays anchored underneath. The map stays exactly
 * as it was, one press away.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** Calm entrance: the page eases in, then its three blocks follow in order. */
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'widgets'; widgets: Widget[] }
  | { type: 'done'; text: string; widgets: Widget[]; flagged?: boolean; withdrawn?: boolean }
  | { type: 'error'; message: string };

interface AskTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Streamed pieces, used only while the answer is arriving. */
  chunks?: string[];
  widgets?: Widget[];
  tools?: string[];
  flagged?: boolean;
  withdrawn?: boolean;
  /** The reader stopped the answer part way through. */
  stopped?: boolean;
}

/** The interface never shows raw model markup; same defence as the chat. */
const MARKUP_FALLBACK = 'Something went wrong while formatting that answer. Please try again.';

function cleanChunk(text: string): string {
  return stripModelMarkup(trimTrailingPartialTag(text)).text;
}

function cleanAnswer(text: string): string {
  const cleaned = cleanChunk(text);
  if (cleaned.trim().length === 0 && containsModelMarkup(text)) return MARKUP_FALLBACK;
  return cleaned;
}

/** Short month labels for the trend, ending at the dataset's latest month. */
function monthLabels(lastMonth: string, count: number): string[] {
  const [year, month] = lastMonth.split('-').map(Number);
  const labels: string[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    labels.push(date.toLocaleDateString('en-GB', { month: 'short' }));
  }
  return labels;
}

/** Round, evenly spaced axis steps, so the scale reads at a glance. */
function niceTicks(values: number[]): { domain: [number, number]; ticks: number[] } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || max * 0.1 || 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(span / 3)));
  const candidates = [1, 2, 5, 10].map((multiple) => multiple * magnitude);
  const step = candidates.find((candidate) => span / candidate <= 3.5) ?? candidates[candidates.length - 1];
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = lo; value <= hi + step / 2; value += step) ticks.push(value);
  return { domain: [lo, hi], ticks };
}

const revenueConfig = { revenue: { label: 'Revenue', color: 'oklch(var(--chart-1))' } } satisfies ChartConfig;

/** The six month revenue trend, with a real scale and a formatted tooltip. */
function RevenueChart({ values, month }: { values: Array<number | null>; month: string }) {
  // A month with no row is a gap, not a zero: the line simply does not exist there.
  const points = values.filter((value): value is number => value !== null);
  if (points.length < 2) return null;
  const months = monthLabels(month, values.length);
  const data = values.map((value, index) => ({ month: months[index], revenue: value }));
  const scale = niceTicks(points);
  return (
    <ChartContainer config={revenueConfig} className="h-[240px] w-full">
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10 }}
          width={44}
          domain={scale.domain}
          ticks={scale.ticks}
          tickFormatter={(value) => `£${Math.round(Number(value) / 1000)}k`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) =>
                value === null || value === undefined || !Number.isFinite(Number(value))
                  ? 'No data'
                  : `£${Number(value).toLocaleString('en-GB')}`
              }
            />
          }
        />
        <Area
          dataKey="revenue"
          type="monotone"
          stroke="var(--color-revenue)"
          fill="var(--color-revenue)"
          fillOpacity={0.12}
          strokeWidth={2}
          connectNulls={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
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

export function PracticePanel({
  practice,
  month,
  onClose,
  onOpenBrain,
  onCompare,
  onAddContext,
  backLabel = 'Map',
}: {
  practice: MapPractice;
  /** The dataset's latest month, so the trend chart can label itself. */
  month: string;
  onClose: () => void;
  onOpenBrain?: (documentTitle: string) => void;
  /** Hands this practice to the map's compare picker as the first side. */
  onCompare?: (practiceId: string) => void;
  /** Opens the Brain's create dialog prefilled for this practice. */
  onAddContext?: (practiceId: string) => void;
  /** Where the way back leads, when the panel was opened from somewhere else. */
  backLabel?: string;
}) {
  const [thread, setThread] = useState<AskTurn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The assign form, opened from the header. */
  const [assignOpen, setAssignOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);

  // Leaving the panel (or switching practice, which remounts it) stops any
  // answer still streaming.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Safety net for the entrance: if the tab was hidden while this mounted, the
  // page must never stay invisible. Same pattern as the shell's transitions.
  useEffect(() => {
    const timer = window.setTimeout(() => forceVisibleIfStuck(panelRef.current), 700);
    return () => window.clearTimeout(timer);
  }, []);

  // The newest content stays in view while an answer streams in. Never on
  // first mount: the metrics at the top must not scroll out of sight.
  useEffect(() => {
    if (!loading && thread.length === 0) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread, loading]);

  // The composer grows with the question, up to a few lines.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [input]);

  // The context list reads the merged documents, so a note the user writes
  // from this page appears here as soon as it is saved.
  const [contextDocuments, setContextDocuments] = useState<BrainDocument[]>([]);
  useEffect(() => {
    setContextDocuments(
      mergeBrainDocuments(readBrainState()).filter((document) =>
        (document.relatedPracticeIds ?? []).includes(practice.practiceId),
      ),
    );
  }, [practice.practiceId]);

  async function send(question: string): Promise<void> {
    const text = question.trim();
    if (!text || loading) return;
    setInput('');
    setError(null);
    stoppedRef.current = false;
    const history = thread;
    setThread([...history, { role: 'user', text }, { role: 'assistant', text: '', widgets: [], tools: [] }]);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    // The context object alone is a hint; this line makes the scope explicit on
    // every question, so even a vague one can never drift off the practice.
    const scope = `(Context: this question is about ${practice.name}, practice ${practice.practiceId}. Keep the answer about this practice.)`;
    const messages = [...history, { role: 'user' as const, text }].map((turn) => ({
      role: turn.role,
      content: turn.role === 'user' ? `${turn.text}\n\n${scope}` : turn.text,
    }));

    // Guidance edits and the reader's own documents live in this browser, so
    // send them with the question, exactly as the chat does. The server
    // validates them.
    const brainOverrides = readBrainState();

    const patch = (p: Partial<AskTurn>): void =>
      setThread((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { ...copy[copy.length - 1], ...p };
        return copy;
      });

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          // Every question is scoped to the practice that is open.
          context: { filters: { practiceIds: [practice.practiceId] }, period: {}, practiceIds: [practice.practiceId] },
          brainOverrides,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? `Request failed (${response.status}).`);
        patch({ text: 'The answer could not be started. Please try again.' });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acc = '';
      const chunks: string[] = [];
      const tools: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === 'delta') {
            acc += event.text;
            chunks.push(event.text);
            patch({ text: acc, chunks: [...chunks], tools: [...tools] });
          } else if (event.type === 'tool') {
            tools.push(event.name);
            patch({ tools: [...tools] });
          } else if (event.type === 'widgets') {
            patch({ widgets: event.widgets });
          } else if (event.type === 'done') {
            patch({
              text: event.text,
              chunks: undefined,
              widgets: event.widgets,
              flagged: event.flagged,
              withdrawn: event.withdrawn ?? false,
              tools: [...tools],
            });
          } else if (event.type === 'error') {
            setError(event.message);
          }
        }
      }
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === 'AbortError') {
        // Only a reader-pressed stop leaves a note; an unmount just goes quiet.
        if (stoppedRef.current) patch({ stopped: true });
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Request failed.');
        patch({ text: 'The answer was interrupted. Ask again.' });
      }
    } finally {
      setLoading(false);
    }
  }

  function stop(): void {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }

  const hasText = input.trim().length > 0;

  // The send button follows the text, not a blank line under it: while the
  // trailing line is empty the button stays on the last line that has words.
  // 20 is the textarea's line height; one step per blank trailing line.
  const trailingBlankLines = (() => {
    const lines = input.split('\n');
    let blank = 0;
    for (let i = lines.length - 1; i >= 0 && lines[i].trim() === ''; i -= 1) blank += 1;
    // The cap keeps the button inside the pill: it may never ride above the
    // second line from the top, or it would poke out of the rounded corner.
    return Math.min(blank, Math.max(0, lines.length - 2));
  })();
  const latestTool = thread[thread.length - 1]?.tools?.slice(-1)[0];

  return (
    <motion.section
      ref={panelRef}
      data-anim
      initial={{ y: 14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.28, ease: EASE }}
      aria-label={`${practice.name} practice details`}
      className="flex min-h-0 flex-1 flex-col bg-card"
    >
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="mx-auto w-full max-w-6xl px-8 py-6"
        >
          {/* Who: the way back, the name, the people. */}
          <motion.div variants={fadeUp} data-anim className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              onClick={onClose}
              aria-label={`Back to ${backLabel.toLowerCase()}`}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              {backLabel}
            </button>
            <h2 className="text-lg font-semibold tracking-tight">{practice.name}</h2>
            <Badge variant="secondary">{practice.region}</Badge>
            {onCompare ? (
              <button
                onClick={() => onCompare(practice.practiceId)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowLeftRight className="size-3" />
                Compare with another practice
              </button>
            ) : null}
            <button
              onClick={() => setAssignOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-text)] transition-colors hover:brightness-95"
            >
              <ListPlus className="size-3" />
              Assign task
            </button>
            <span className="text-xs text-muted-foreground">
              {practice.manager || 'No manager recorded'} · practice manager · supported by {practice.mentorName}
            </span>
            <button
              onClick={onClose}
              aria-label="Back to map"
              className="ml-auto grid size-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </motion.div>

          {/* The numbers, at a glance. */}
          {!practice.reported ? (
            <motion.div
              variants={fadeUp}
              data-anim
              className="mt-5 rounded-lg border border-[color:var(--line)] bg-secondary/50 px-3.5 py-2.5 text-xs text-muted-foreground"
            >
              {practice.name} stopped reporting after {practice.lastReportedLabel}. The figures below are its last
              reported month, and the map keeps it muted.
            </motion.div>
          ) : null}
          <motion.div variants={fadeUp} data-anim className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-6">
            <Metric label="Revenue" value={practice.revenueDisplay} sub={`${practice.revenueAttainmentDisplay} of ${practice.revenueTargetDisplay}`} />
            <Metric label="Revenue change" value={practice.revenueMoMDisplay} sub="vs last month" />
            <Metric label="Conversion" value={practice.conversionDisplay} sub={practice.conversionMoMDisplay} />
            <Metric label="Contact lens" value={practice.clAttainmentDisplay} sub={`${practice.clActualDisplay} of ${practice.clTargetDisplay}`} />
            <Metric
              label="Training"
              value={practice.trainingCompletionDisplay}
              sub={
                practice.trainingOverdue > 0
                  ? `${practice.trainingOverdue} overdue`
                  : practice.trainingGaps.length > 0
                    ? `${practice.trainingGaps.length} module${practice.trainingGaps.length === 1 ? '' : 's'} missing`
                    : 'all complete'
              }
            />
            <Metric
              label="Refunds"
              value={practice.refundLatestDisplay}
              sub={
                practice.refundCount === 0
                  ? 'no refunds recorded'
                  : practice.refundFlags.length > 0
                    ? `${practice.refundRateDisplay} of revenue, flagged`
                    : `${practice.refundRateDisplay} of revenue`
              }
            />
          </motion.div>

          {/* The trend, as the hero: full width, real scale. */}
          <motion.div variants={fadeUp} data-anim className="mt-6">
            <p className="label-caps mb-3">Revenue, last six months</p>
            <RevenueChart values={practice.revenueTrend} month={month} />
          </motion.div>

          {/* The why, then the reference material, side by side. */}
          <motion.div variants={fadeUp} data-anim className="mt-6 grid gap-6 md:grid-cols-2">
            <div>
              {practice.attentionSignals.length > 0 ? (
                <div>
                  <p className="label-caps mb-2">What the data shows</p>
                  <ul className="space-y-1.5">
                    {practice.attentionSignals.map((signal, index) => (
                      <li key={`${index}-${signal.slice(0, 24)}`} className="flex gap-2 text-xs text-muted-foreground">
                        <TrendingDown className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-600)]" />
                        <span>{signal}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div>
                  <p className="label-caps mb-2">What the data shows</p>
                  <p className="text-xs text-muted-foreground">Nothing flagged this month.</p>
                </div>
              )}
            </div>

            <div className="space-y-5">
              {contextDocuments.length > 0 ? (
                <div>
                  <p className="label-caps mb-2">Context from the Brain</p>
                  <div className="space-y-1.5">
                    {contextDocuments.map((document) => (
                      <button
                        key={document.id}
                        onClick={() => onOpenBrain?.(document.title)}
                        className="flex w-full items-start gap-2 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <FileText className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-600)]" />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium">{document.title}</span>
                          <span className="block text-[10px] text-muted-foreground">
                            {document.section} · {document.owner}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="label-caps mb-2">Context from the Brain</p>
                  <p className="text-xs text-muted-foreground">No context recorded yet.</p>
                  {onAddContext ? (
                    <button
                      onClick={() => onAddContext(practice.practiceId)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="size-3" />
                      Add context for this practice
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </motion.div>

          {/* The ask thread, in the same column width as the composer. */}
          {thread.length > 0 ? (
            <div className="mx-auto mt-6 w-full max-w-3xl space-y-4 border-t border-border pt-5">
              {thread.map((turn, index) =>
                turn.role === 'user' ? (
                  <div key={index} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-xs text-primary-foreground">
                      {turn.text}
                    </div>
                  </div>
                ) : (
                  <div key={index} className="space-y-2">
                    {turn.text && !turn.widgets?.some((widget) => widget.type === 'compare') ? (
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                        {turn.chunks && turn.chunks.length > 0
                          ? turn.chunks.map((chunk, chunkIndex) => <span key={chunkIndex}>{cleanChunk(chunk)}</span>)
                          : cleanAnswer(turn.text)}
                      </p>
                    ) : null}

                    {turn.stopped ? (
                      <p className="text-[11px] text-muted-foreground">Stopped before the answer was complete.</p>
                    ) : null}

                    {turn.widgets && turn.widgets.length > 0 ? (
                      <div className="space-y-2">
                        {turn.widgets.map((widget) => (
                          <WidgetRenderer
                            key={widget.id}
                            widget={widget}
                            notes={widget.type === 'compare' && turn.text ? [cleanAnswer(turn.text)] : undefined}
                            onOpenBrain={onOpenBrain}
                          />
                        ))}
                      </div>
                    ) : null}

                    {turn.flagged ? (
                      <div className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
                        <TriangleAlert className="size-3.5" />
                        {turn.withdrawn
                          ? 'A figure could not be traced to the data, so the answer was withdrawn.'
                          : 'Some numbers could not be traced to the data. Treat this with care.'}
                      </div>
                    ) : null}
                  </div>
                ),
              )}
              {loading ? (
                <p className="text-[11px] text-muted-foreground">
                  {latestTool ? toolLabel(latestTool) : 'Reading the numbers'}...
                </p>
              ) : null}
              {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
            </div>
          ) : error ? (
            <p className="mx-auto mt-6 w-full max-w-3xl text-[11px] text-destructive">{error}</p>
          ) : null}
        </motion.div>
      </div>

      {/* The ask bar: anchored under the page, same pill as the chat. */}
      <div className="shrink-0 border-t border-border px-8 py-4">
        <div className="mx-auto w-full max-w-3xl">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <div className="flex items-end gap-2 rounded-full border border-[color:var(--line)] bg-card py-[7px] pl-5 pr-2 [box-shadow:var(--shadow-floating)]">
              <Textarea
                ref={composerRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send(input);
                  }
                }}
                placeholder={`Ask about ${practice.name}...`}
                aria-label={`Ask a question about ${practice.name}`}
                rows={1}
                disabled={loading}
                className="max-h-[96px] min-h-[34px] flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-2 text-[13px] leading-[20px] caret-[var(--accent-600)] shadow-none placeholder:text-[color:var(--ink-3)] focus-visible:ring-0"
              />
              <motion.button
                type={loading ? 'button' : 'submit'}
                onClick={loading ? stop : undefined}
                disabled={!loading && !hasText}
                aria-label={loading ? 'Stop generating' : 'Ask'}
                whileTap={loading || hasText ? { scale: 0.96 } : undefined}
                transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                style={{ marginBottom: trailingBlankLines * 20 }}
                className={cn(
                  'inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-[color,filter,box-shadow] duration-[160ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] disabled:pointer-events-none',
                  loading || hasText
                    ? 'text-white [background:var(--send-gradient)] [box-shadow:var(--shadow-send)] hover:brightness-95'
                    : 'bg-[var(--accent-soft)] text-[var(--accent-600)]',
                )}
              >
                {loading ? <Square className="size-3.5" /> : <ArrowUp className="size-4" />}
              </motion.button>
            </div>
          </form>
        </div>
      </div>

      <AssignTaskDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        defaultTitle={`Follow up on ${practice.name}`}
        source={{
          label: practice.name,
          practiceId: practice.practiceId,
          region: practice.region,
          finding: practice.attentionSignals[0],
        }}
        assignees={[
          ...(practice.manager ? [{ name: practice.manager, role: 'practice manager' }] : []),
          { name: practice.mentorName, role: 'mentor' },
          { name: 'Sara Kelly', role: 'group leadership' },
        ]}
      />
    </motion.section>
  );
}
