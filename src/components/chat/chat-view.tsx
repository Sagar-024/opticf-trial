'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  ArrowLeftRight,
  ArrowUp,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  GraduationCap,
  LayoutDashboard,
  ListOrdered,
  ListPlus,
  Map,
  MapPin,
  PanelRight,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Target,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { ChatContext, Widget } from '@/ai/types';
import { containsModelMarkup, stripModelMarkup, trimTrailingPartialTag } from '@/ai/markup';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { ErrorBoundary } from '@/components/error-boundary';
import { DashboardPanel } from '@/components/chat/dashboard-panel';
import { AssignTaskDialog } from '@/components/tasks/assign-task-dialog';
import { BrainPill } from '@/components/chat/brain-pill';
import { BrainOverlay } from '@/components/brain/brain-overlay';
import { LEADERSHIP } from '@/lib/people';
import { WaveText } from '@/components/wave-text';
import { Logo } from '@/components/logo';
import { forceVisibleIfStuck } from '@/lib/anim';
import { readBrainState } from '@/lib/brain-store';
import { getSession, migrateLegacy, newSessionId, setTurnFeedback, titleFromQuestion, upsertSession, type StoredTraceEntry, type StoredTurn } from '@/lib/chat-store';
import { WidgetRenderer } from '@/components/widgets/widget-renderer';
import { cn } from '@/lib/utils';
import { sourcePhrase, toolLabel } from '@/lib/tool-labels';
import { isDenseChart } from '@/lib/widgets';

/**
 * The six questions leadership actually opens with, shown as a tidy grid: the
 * pulse check first, then who needs help, what moved, and how the regions sit.
 * The last two carry the new stories: a collapse with its recorded context,
 * and the knowledge layer. Each one maps to real tools, so none is filler.
 * The first is the hero: the only chip that carries the orange.
 */
const SUGGESTIONS: Array<{ text: string; icon: LucideIcon; hero?: boolean }> = [
  { text: 'How is the group doing this month?', icon: Sparkles, hero: true },
  { text: 'Which practices need attention, and why?', icon: Eye },
  { text: 'Which practices dropped the most since last month?', icon: TrendingDown },
  { text: 'How do the regions compare?', icon: Map },
  { text: "Why is Bristol's revenue down?", icon: TriangleAlert },
  { text: 'What does the Brain know about Chorlton?', icon: FileText },
];

/** Shared easing so every chat animation feels like one system. */
const EASE = [0.22, 1, 0.36, 1] as const;

/** Each step shows what it actually did; anything unknown falls back to the spark. */
const STEP_ICONS: Record<string, LucideIcon> = {
  search_brain: BookOpen,
  query_metrics: FileText,
  compare: ArrowLeftRight,
  compare_practices: ArrowLeftRight,
  get_practice: Search,
  rank_attention: ListOrdered,
  training_status: GraduationCap,
  below_cl_target: Target,
  today_priorities: CalendarDays,
  highlight_on_map: MapPin,
  build_dashboard: LayoutDashboard,
};

/**
 * The interface never shows raw model markup. The server strips it, and this is
 * the second line of defence for a stray chunk: trim a half arrived tag, drop
 * any complete block, and fall back to a plain message if nothing readable is
 * left.
 */
const MARKUP_FALLBACK = 'Something went wrong while formatting that answer. Please try again.';

function cleanChunk(text: string): string {
  return stripModelMarkup(trimTrailingPartialTag(text)).text;
}

function cleanAnswer(text: string): string {
  const cleaned = cleanChunk(text);
  if (cleaned.trim().length === 0 && containsModelMarkup(text)) return MARKUP_FALLBACK;
  return cleaned;
}

/** Persisted turns skip the transient streaming fields. */
function toStoredTurn(turn: Turn): StoredTurn {
  return {
    role: turn.role,
    text: turn.text,
    widgets: turn.widgets,
    mapHighlight: turn.mapHighlight,
    sources: turn.sources,
    tools: turn.tools,
    trace: turn.trace,
    thinkingMs: turn.thinkingMs,
    flagged: turn.flagged,
    flagReason: turn.flagReason ?? null,
    withdrawn: turn.withdrawn,
    stopped: turn.stopped,
    interrupted: turn.interrupted,
    feedback: turn.feedback,
  };
}

/** Stored turns come back as plain, settled turns. */
function toTurn(stored: StoredTurn): Turn {
  return {
    role: stored.role,
    text: stored.text,
    widgets: (stored.widgets as Widget[]) ?? [],
    mapHighlight: stored.mapHighlight ?? [],
    sources: stored.sources ?? [],
    tools: stored.tools,
    // Only renderable kinds come back, so a corrupted store cannot crash the view.
    trace: (stored.trace ?? []).filter((entry) => entry?.kind === 'reasoning' || entry?.kind === 'step'),
    thinkingMs: stored.thinkingMs,
    flagged: stored.flagged,
    flagReason: stored.flagReason ?? null,
    withdrawn: stored.withdrawn,
    stopped: stored.stopped,
    interrupted: stored.interrupted,
    feedback: stored.feedback,
  };
}

/** Charts, tables and KPIs are the dashboard material of any answer. */
function isCanvasWidget(widget: Widget): boolean {
  return widget.type === 'chart' || widget.type === 'table' || widget.type === 'kpi';
}

function canvasWidgets(widgets: Widget[]): Widget[] {
  return widgets.filter(isCanvasWidget);
}

/** The KPI card's title names the period; otherwise the first widget names it. */
function canvasTitle(widgets: Widget[]): string {
  const kpi = widgets.find((widget) => widget.type === 'kpi');
  return kpi?.title ?? widgets[0]?.title ?? 'Dashboard';
}

/** The question that produced this answer, for a task that starts from it. */
function questionBefore(list: Turn[], index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const turn = list[cursor];
    if (turn?.role === 'user') return turn.text.trim();
  }
  return '';
}

/** A task title from the question, capped so the board stays readable. */
function taskTitleFrom(question: string): string {
  if (!question) return 'Follow up on this answer';
  return question.length > 90 ? `${question.slice(0, 89)}…` : question;
}

/** The finding line a task carries: the first line of the answer, capped. */
function findingLine(text: string): string {
  const line = text
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) return '';
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/**
 * The working indicator: three ink dots that swell in sequence with a short
 * label. It always sits at the end of the content that has arrived, so it reads
 * as "more is coming" rather than something that was left behind at the top.
 */
function WorkingIndicator({ label }: { label: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      data-anim
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
      className="flex items-center gap-2 text-xs text-muted-foreground"
    >
      <span className="flex items-center gap-[3px]">
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            className="size-1 rounded-full bg-[var(--accent-500)]"
            animate={reduceMotion ? { opacity: 0.6 } : { opacity: [0.25, 1, 0.25] }}
            transition={reduceMotion ? { duration: 0 } : { duration: 1.1, repeat: Infinity, delay: index * 0.16, ease: 'easeInOut' }}
          />
        ))}
      </span>
      {label}
    </motion.div>
  );
}

/** The run's steps in plain words: repeats merged, first letter capitalised. */
function traceSteps(tools: string[]): string[] {
  return tools
    .filter((tool, index) => tool !== tools[index - 1])
    .map((tool) => {
      const label = toolLabel(tool);
      return label.charAt(0).toUpperCase() + label.slice(1);
    });
}

/**
 * The real steps of the run, streamed from the server, in a fixed-height window
 * so a long run never pushes the answer down. The reasoning and the tool steps
 * interleave in arrival order, live and settled alike; a settled run without a
 * stored trace falls back to plain step labels. While a run is live the window
 * streams open until the first words arrive, then folds to the header line,
 * which stays clickable; a click wins over the auto state from then on.
 */
function ThinkingTrace({ tools, startedAt, thinkingMs, active = false, hasText = false, trace }: {
  tools: string[];
  startedAt?: number;
  thinkingMs?: number;
  active?: boolean;
  /** True once any answer text has arrived, so a live run can auto collapse. */
  hasText?: boolean;
  trace?: StoredTraceEntry[];
}) {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [seconds, setSeconds] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // The clock ticks from the run's real start, not from when this mounted.
  useEffect(() => {
    if (!active) return;
    const tick = () => setSeconds(startedAt === undefined ? 0 : Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  // Open while the run works with no words yet; the first words fold it to the
  // header line until the reader clicks, and a click then sticks.
  const open = expanded ?? (active && !hasText);

  const steps = traceSteps(tools);
  const sources = sourcePhrase(tools);
  const rows = steps;
  // The ordered trace renders in both states; the plain rows are the
  // older-history fallback when a settled turn has no stored trace.
  const entries = trace ?? [];
  const lastEntry = entries[entries.length - 1];
  const lastReasoningLength = lastEntry?.kind === 'reasoning' ? lastEntry.text.length : 0;

  // The newest entry stays in view while the run streams, and when it opens.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tools.length, expanded, entries.length, lastReasoningLength]);

  const list = entries.length === 0 && rows.length === 0 ? null : (
    <div ref={listRef} className="mt-2.5 max-h-[150px] overflow-y-auto overscroll-contain">
      {entries.length > 0 ? (
        // The rail spans the rows behind the icons, from first to last centre.
        <div className="relative">
          <span aria-hidden className="absolute bottom-2 left-[7px] top-2 w-px bg-border" />
          <div className="space-y-2.5">
            {entries.map((entry, index) => {
              if (entry.kind === 'reasoning') {
                return (
                  <p key={index} className="mb-2 whitespace-pre-wrap pl-[22px] text-[13px] leading-5 text-muted-foreground">
                    {entry.text}
                  </p>
                );
              }
              // The step row names what it found; the plain label is the fallback.
              const label = entry.detail ?? toolLabel(entry.name);
              const text = label.charAt(0).toUpperCase() + label.slice(1);
              const StepIcon = STEP_ICONS[entry.name] ?? Sparkles;
              const running = active && index === entries.length - 1;
              return (
                <div key={index} className="flex items-start gap-2.5">
                  <span className="relative z-10 flex size-3.5 shrink-0 items-center justify-center bg-background">
                    {running ? (
                      <span
                        className={cn(
                          'block size-3 rounded-full border-2 border-[color:var(--accent-500)] border-t-transparent',
                          !reduceMotion && 'animate-spin',
                        )}
                      />
                    ) : (
                      <StepIcon className="size-3.5 text-muted-foreground" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <span className={cn('text-[13px] leading-5', running ? 'text-foreground' : 'text-muted-foreground')}>{text}</span>
                    {entry.items && entry.items.length > 0 ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {entry.items.slice(0, 3).map((item) => (
                          <span
                            key={item}
                            className="inline-flex items-center rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {item}
                          </span>
                        ))}
                        {entry.items.length > 3 ? (
                          <span className="text-[10px] text-muted-foreground">+{entry.items.length - 3} more</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <ol className="space-y-2.5">
          {rows.map((row, index) => {
            const current = active && index === rows.length - 1;
            return (
              <li key={index} className="flex items-start gap-2.5">
                <span className="mt-px flex size-3.5 shrink-0 items-center justify-center">
                  {current ? (
                    <span
                      className={cn(
                        'block size-3 rounded-full border-2 border-[color:var(--accent-500)] border-t-transparent',
                        !reduceMotion && 'animate-spin',
                      )}
                    />
                  ) : (
                    <Check className="size-3.5 text-[var(--accent-600)]" />
                  )}
                </span>
                <span className={cn('text-[13px] leading-5', current ? 'text-foreground' : 'text-muted-foreground')}>{row}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );

  // While the run is live, one calm line names what is happening, and the
  // window below it streams the reasoning and steps as they arrive.
  if (active) {
    return (
      <motion.div
        data-anim
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: EASE }}
      >
        <button
          onClick={() => setExpanded(!open)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <WorkingIndicator label={`${sources ? `Checking ${sources}` : 'Looking into it'} · ${seconds}s`} />
          <ChevronDown className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
        </button>
        {open ? list : null}
      </motion.div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Check className="size-3.5 text-[var(--accent-600)]" />
        {sources ? `From ${sources}` : `Worked through ${steps.length} step${steps.length === 1 ? '' : 's'}`}
        {thinkingMs !== undefined ? ` · ${Math.max(1, Math.round(thinkingMs / 1000))}s` : null}
        <ChevronDown className={cn('size-3.5 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open ? list : null}
    </div>
  );
}

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  /** Streamed pieces, used only while the answer is arriving. */
  chunks?: string[];
  /** The run's thinking trace, streamed live and kept in history for the settled view. */
  trace?: StoredTraceEntry[];
  widgets: Widget[];
  mapHighlight: string[];
  sources: string[];
  flagged?: boolean;
  flagReason?: 'leak' | 'ungrounded' | 'numbers' | null;
  withdrawn?: boolean;
  stopped?: boolean;
  /** The run broke mid-stream; the text is what had arrived before it did. */
  interrupted?: boolean;
  tools?: string[];
  /** Run timing for the trace: live seconds while streaming, a settled duration after. */
  startedAt?: number;
  thinkingMs?: number;
  /** The reader's verdict on this answer; kept in the browser for review. */
  feedback?: 'up' | 'down';
  /** What the assistant is doing right now: writing or working between steps. */
  phase?: 'working' | 'writing';
}

type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; name: string; malformed?: boolean; detail?: string; items?: string[] }
  | { type: 'widgets'; widgets: Widget[] }
  | {
      type: 'done';
      text: string;
      widgets: Widget[];
      mapHighlight: string[];
      context: ChatContext;
      sources: string[];
      flagged: boolean;
      flagReason?: 'leak' | 'ungrounded' | 'numbers' | null;
      withdrawn?: boolean;
      traceId?: string;
      promptVersion?: string;
      cached?: boolean;
      /** The run's full reasoning and steps; a cache hit replays them here. */
      trace?: StoredTraceEntry[];
      usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd?: number };
    }
  | { type: 'error'; message: string; status?: number };

export function ChatView({
  onShowMap,
  onOpenBrain,
  onCompareOnMap,
  pendingQuestion,
  onPendingHandled,
  sessionId,
  onSessionChange,
  practiceName,
}: {
  onShowMap: (practiceIds: string[]) => void;
  onOpenBrain?: (documentTitle: string) => void;
  /** Opens the two practices side by side on the map's compare dock. */
  onCompareOnMap?: (practiceIds: string[]) => void;
  pendingQuestion?: string | null;
  onPendingHandled?: () => void;
  /** The conversation the rail has selected; null means a fresh, unsaved chat. */
  sessionId: string | null;
  onSessionChange?: (id: string | null) => void;
  /** '(id) => name', for the Practice Brain overlay; from the workspace. */
  practiceName?: (practiceId: string) => string;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [copyFailed, setCopyFailed] = useState<number | null>(null);
  /** Which answer has its "how this was built" receipt open. */
  const [openReceipt, setOpenReceipt] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  /** The stored thread ends on a question whose answer never arrived. */
  const [dangling, setDangling] = useState(false);
  /** The dashboard, open beside the chat, built by the build_dashboard tool. */
  const [dashboard, setDashboard] = useState<{ title: string; widgets: Widget[]; sources: string[] } | null>(null);
  /** A dense chart opens that dashboard over the chat instead of beside it. */
  const [dashboardFull, setDashboardFull] = useState(false);
  /** The answer a task is being written from: title and finding prefilled. */
  const [assignTask, setAssignTask] = useState<{ title: string; note: string } | null>(null);
  /** The Practice Brain overlay, opened from the footer pill. */
  const [brainOpen, setBrainOpen] = useState(false);

  const contextRef = useRef<ChatContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** The composer, so it can grow with the question. */
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /** Synchronous single-flight guard, so one question can never start two streams. */
  const sendingRef = useRef(false);
  /** A handed over question is sent exactly once, even across effect double runs. */
  const handledPendingRef = useRef<string | null>(null);
  /** The live turn list, so settle-time saves never read a stale closure. */
  const turnsRef = useRef<Turn[]>([]);
  /** The session this view is showing, mirrored for use inside async work. */
  const sessionIdRef = useRef<string | null>(null);
  /** A session created by this view, so the loader does not wipe its first turn. */
  const createdRef = useRef<string | null>(null);

  /** One door for the BI panel: opening it also picks side or full view. */
  const showDashboard = useCallback(
    (next: { title: string; widgets: Widget[]; sources: string[] } | null): void => {
      setDashboard(next);
      setDashboardFull(next !== null && next.widgets.some(isDenseChart));
    },
    [],
  );

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  // Chat history lives in this browser. Import any old single-thread save, then
  // mark the view ready so the session loader below can run.
  useEffect(() => {
    migrateLegacy();
    setHydrated(true);
  }, []);

  // The rail selects a session; this view shows it. A session this view just
  // created is skipped, because its first turn is already on screen.
  useEffect(() => {
    sessionIdRef.current = sessionId;
    if (!hydrated) return;
    if (sessionId && sessionId === createdRef.current) {
      createdRef.current = null;
      return;
    }
    abortRef.current?.abort();
    showDashboard(null);
    if (!sessionId) {
      contextRef.current = null;
      setTurns([]);
      setError(null);
      return;
    }
    const session = getSession(sessionId);
    contextRef.current = (session?.context as ChatContext | null) ?? null;
    const loaded = session ? session.turns.map(toTurn) : [];
    setTurns(loaded);
    // A stored conversation can only end on a question if its answer was cut
    // off (a reload or a closed tab), so that question is flagged for retry.
    setDangling(loaded.length > 0 && loaded[loaded.length - 1].role === 'user');
    setError(null);
  }, [sessionId, hydrated, showDashboard]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    // If frames are frozen, do not leave a message or widget invisible.
    const timer = window.setTimeout(() => forceVisibleIfStuck(document.querySelector('main')), 900);
    return () => window.clearTimeout(timer);
  }, [turns, loading]);

  // The composer grows with the question, up to about five lines, then scrolls.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [input]);

  const patchLast = useCallback((patch: Partial<Turn>) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], ...patch };
      return next;
    });
  }, []);

  /** Save a snapshot of the conversation into this browser's history. */
  const saveSession = useCallback((id: string, snapshot: Turn[]): void => {
    if (snapshot.length === 0) return;
    const firstUser = snapshot.find((turn) => turn.role === 'user');
    const existing = getSession(id);
    upsertSession({
      id,
      title: existing?.title ?? (firstUser ? titleFromQuestion(firstUser.text) : 'New chat'),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      turns: snapshot.map(toStoredTurn),
      context: contextRef.current,
    });
  }, []);

  const runStream = useCallback(
    async (history: Turn[], runSessionId: string | null) => {
      setLoading(true);
      setError(null);
      setDangling(false);
      const controller = new AbortController();
      abortRef.current = controller;

      /** Stream patches apply only while this session is still on screen. */
      const patch = (p: Partial<Turn>) => {
        if (sessionIdRef.current === runSessionId) patchLast(p);
      };

      const draft: Turn = { role: 'assistant', text: '', widgets: [], mapHighlight: [], sources: [], tools: [], startedAt: Date.now() };
      setTurns([...history, draft]);

      const messages = history.map((turn) => ({ role: turn.role, content: turn.text }));

      try {
        // Guidance edits and the reader's own documents live in this browser,
        // so send them with the question. The server validates them first.
        const brainOverrides = readBrainState();

        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages, context: contextRef.current, brainOverrides }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(data?.error ?? `Request failed (${response.status}).`);
          patch({ text: '' });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

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
              draft.chunks = [...(draft.chunks ?? []), event.text];
              // The first words end the thinking phase; the trace keeps the time.
              if (draft.thinkingMs === undefined) draft.thinkingMs = Date.now() - (draft.startedAt ?? Date.now());
              patch({ text: (draft.text += event.text), chunks: draft.chunks, phase: 'writing', thinkingMs: draft.thinkingMs });
            } else if (event.type === 'reasoning') {
              // Reasoning chunks grow the last paragraph; each entry keeps only
              // its tail, so long runs stay bounded in memory and re-renders.
              const entries = draft.trace ?? [];
              const last = entries[entries.length - 1];
              draft.trace = last && last.kind === 'reasoning'
                ? [...entries.slice(0, -1), { kind: 'reasoning', text: (last.text + event.text).slice(-2000) }]
                : [...entries, { kind: 'reasoning', text: event.text.slice(-2000) }];
              patch({ trace: draft.trace, phase: 'working' });
            } else if (event.type === 'tool') {
              draft.tools = [...(draft.tools ?? []), event.name];
              // The step joins the ordered trace beside the reasoning around it.
              draft.trace = [
                ...(draft.trace ?? []),
                { kind: 'step', name: event.name, detail: event.detail, items: event.items },
              ];
              patch({ tools: draft.tools, trace: draft.trace, phase: 'working' });
            } else if (event.type === 'widgets') {
              draft.widgets = event.widgets;
              patch({ widgets: event.widgets, phase: 'working' });
              // The BI goes up as it is built; the chat keeps prose.
              const canvas = canvasWidgets(event.widgets);
              if (canvas.length > 0) showDashboard({ title: canvasTitle(canvas), widgets: canvas, sources: [] });
            } else if (event.type === 'done') {
              contextRef.current = event.context;
              // A run with no words still gets a duration for its summary.
              if (draft.thinkingMs === undefined) draft.thinkingMs = Date.now() - (draft.startedAt ?? Date.now());
              // A cache hit sends no tool events, so its step list comes from
              // the stored trace the server replays in the done event.
              const storedSteps = (event.trace ?? []).flatMap((entry) => (entry.kind === 'step' ? [entry.name] : []));
              patch({
                text: event.text,
                // Settled: drop the chunks so history renders as plain text.
                chunks: undefined,
                widgets: event.widgets,
                mapHighlight: event.mapHighlight,
                sources: event.sources,
                flagged: event.flagged,
                flagReason: event.flagReason ?? null,
                withdrawn: event.withdrawn ?? false,
                tools: draft.tools && draft.tools.length > 0 ? draft.tools : storedSteps,
                trace: event.trace ?? draft.trace,
                thinkingMs: draft.thinkingMs,
              });
              // The answer settles: the panel takes the final widgets and the
              // sources that back them.
              const canvas = canvasWidgets(event.widgets);
              if (canvas.length > 0) showDashboard({ title: canvasTitle(canvas), widgets: canvas, sources: event.sources });
            } else if (event.type === 'error') {
              setError(event.message);
            }
          }
        }
      } catch (requestError) {
        if (requestError instanceof Error && requestError.name === 'AbortError') {
          patch({ stopped: true, text: draft.text || 'Stopped.' });
        } else {
          setError(requestError instanceof Error ? requestError.message : 'Request failed.');
          patch({ text: draft.text, interrupted: true });
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
        // The settled thread is what history keeps. If the reader moved to a
        // different conversation mid answer, this run stays out of the way.
        if (runSessionId && sessionIdRef.current === runSessionId) {
          saveSession(runSessionId, turnsRef.current);
        }
      }
    },
    [patchLast, saveSession, showDashboard],
  );

  function send(question: string): void {
    const text = question.trim();
    // Single flight: a synchronous guard, because a handed over question can
    // arrive twice (React double effect) before the loading state settles, and
    // two streams into one turn produce exactly the "placeholder above the
    // answer" artefact this guard exists to prevent.
    if (!text || loading || sendingRef.current) return;
    sendingRef.current = true;
    setInput('');
    // A fresh chat becomes a saved session the moment its first question is
    // asked, so the rail can list it while the answer is still streaming.
    let activeId = sessionIdRef.current;
    if (!activeId) {
      activeId = newSessionId();
      createdRef.current = activeId;
      sessionIdRef.current = activeId;
      onSessionChange?.(activeId);
    }
    const history: Turn[] = [...turns, { role: 'user', text, widgets: [], mapHighlight: [], sources: [] }];
    saveSession(activeId, history);
    void runStream(history, activeId).finally(() => {
      sendingRef.current = false;
    });
  }

  function regenerate(): void {
    if (loading || sendingRef.current) return;
    const lastUser = [...turns].reverse().findIndex((turn) => turn.role === 'user');
    if (lastUser === -1) return;
    sendingRef.current = true;
    const cut = turns.length - lastUser;
    void runStream(turns.slice(0, cut), sessionIdRef.current).finally(() => {
      sendingRef.current = false;
    });
  }

  function stop(): void {
    abortRef.current?.abort();
  }

  /** Clipboard with a fallback for contexts that block the async API (embedded
      previews, older browsers): a selection-based copy still lands there. */
  async function writeClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to the selection path
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }

  async function copyTurn(index: number, text: string): Promise<void> {
    const ok = await writeClipboard(text);
    if (ok) {
      setCopyFailed(null);
      setCopied(index);
      window.setTimeout(() => setCopied(null), 1600);
    } else {
      setCopied(null);
      setCopyFailed(index);
      window.setTimeout(() => setCopyFailed(null), 2000);
    }
  }

  /**
   * The reader's verdict on the last answer. Toggles off when the same thumb is
   * pressed again; the verdict is written to the session so it survives reloads.
   */
  function rateTurn(index: number, feedback: 'up' | 'down'): void {
    const id = sessionIdRef.current;
    if (!id) return;
    const current = turnsRef.current[index]?.feedback;
    const next = current === feedback ? null : feedback;
    patchLast({ feedback: next ?? undefined });
    setTurnFeedback(id, index, next);
  }

  /** A settled data answer can be continued month over month, unless it
   * already was a comparison. */
  function canCompare(turn: Turn): boolean {
    return !turn.chunks && (turn.tools?.length ?? 0) > 0 && !turn.tools?.includes('compare');
  }

  const empty = turns.length === 0;
  const lastIsAssistant = turns.length > 0 && turns[turns.length - 1].role === 'assistant';
  const hasText = input.trim().length > 0;

  // The send button follows the text, not a blank line under it: while the
  // trailing line is empty the button stays on the last line that has words.
  // 22 is the textarea's line height; one step per blank trailing line. The
  // cap keeps the 40px button inside the pill: it may never ride above the
  // second line from the top, or it would poke out of the rounded corner.
  const trailingBlankLines = (() => {
    const lines = input.split('\n');
    let blank = 0;
    for (let i = lines.length - 1; i >= 0 && lines[i].trim() === ''; i -= 1) blank += 1;
    return Math.min(blank, Math.max(0, lines.length - 2));
  })();

  // A question handed over from the map or Today is sent once the thread has
  // restored, and exactly once per question.
  useEffect(() => {
    if (!hydrated || !pendingQuestion || loading) return;
    if (handledPendingRef.current === pendingQuestion) return;
    handledPendingRef.current = pendingQuestion;
    send(pendingQuestion);
    onPendingHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion, hydrated]);

  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      {/* The chat keeps its column; a dashboard opens beside it, or takes the
          whole area when a dense chart needs the room. */}
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', dashboardFull && 'hidden')}>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl px-6">
          {empty ? (
            <motion.div
              data-anim
              className="flex min-h-[58vh] flex-col items-center justify-center py-14 text-center"
              variants={stagger}
              initial="hidden"
              animate="show"
            >
              <motion.div variants={fadeUp}>
                <Logo className="size-12" />
              </motion.div>
              <h1 className="mt-4 text-balance text-[26px] font-semibold leading-[1.15] tracking-[-0.03em]">
                <WaveText text="What needs your attention?" delay={80} />
              </h1>
              <p className="mt-2 max-w-md text-pretty text-sm text-muted-foreground">
                <WaveText
                  text="Ask about your practices. Answers, numbers and charts all come from the loaded data."
                  delay={160}
                  step={10}
                />
              </p>
              <motion.div variants={fadeUp} className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map(({ text, icon: Icon, hero }) => (
                  <motion.button
                    key={text}
                    onClick={() => send(text)}
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    className={cn(
                      'lift flex min-h-[56px] items-center gap-2.5 rounded-full border px-4 py-3 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]',
                      hero
                        ? 'border-[color:var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)] [box-shadow:var(--hi),var(--shadow-hero)]'
                        : 'border-[color:var(--line)] bg-card text-muted-foreground [box-shadow:var(--hi),var(--shadow-raised)] hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="line-clamp-2">{text}</span>
                  </motion.button>
                ))}
              </motion.div>
            </motion.div>
          ) : (
            <div className="space-y-6 py-8">
              {turns.map((turn, index) =>
                turn.role === 'user' ? (
                  <motion.div
                    key={index}
                    data-anim
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="flex justify-end"
                  >
                    <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                      {turn.text}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={index}
                    data-anim
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className="w-full space-y-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="grid size-6 place-items-center rounded-full bg-rail-active">
                        <Logo className="size-4" />
                      </span>
                      <span className="text-xs font-semibold">Optific</span>
                      {/* Live narration while the answer is still arriving; the
                          settled receipt moves below the answer instead. */}
                      {turn.chunks && turn.tools && turn.tools.length > 0 ? (
                        <span className="text-[10px] text-muted-foreground">
                          {[...new Set(turn.tools)].map(toolLabel).join(' · ')}
                        </span>
                      ) : null}
                    </div>

                    {/* Settled, the real steps fold to one summary line that
                        opens the same rich timeline. */}
                    {turn.tools && turn.tools.length > 0 && (!loading || index !== turns.length - 1) ? (
                      <ThinkingTrace tools={turn.tools} thinkingMs={turn.thinkingMs} trace={turn.trace} />
                    ) : null}

                    {/* One live trace above the answer: it streams open while
                        the run works, then folds to its summary line as soon
                        as the words arrive, so reasoning and steps stay
                        visible and can be opened at any time. */}
                    {loading && index === turns.length - 1 ? (
                      <ThinkingTrace
                        tools={turn.tools ?? []}
                        startedAt={turn.startedAt}
                        active
                        hasText={Boolean(turn.text)}
                        trace={turn.trace}
                      />
                    ) : null}

                    {/* The written answer is always shown. A comparison card
                        used to hide it, which meant a question like "is this
                        hardcoded" appeared to get no answer at all. */}
                    {turn.text ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {/* While the answer streams, each arriving chunk settles in. */}
                        {turn.chunks && turn.chunks.length > 0
                          ? turn.chunks.map((chunk, chunkIndex) => (
                              <span key={chunkIndex} data-anim className="anim-ink">
                                {cleanChunk(chunk)}
                              </span>
                            ))
                          : cleanAnswer(turn.text)}
                        {loading && index === turns.length - 1 && turn.phase === 'writing' ? (
                          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-[var(--accent-500)] align-text-bottom" />
                        ) : null}
                      </p>
                    ) : null}

                    {turn.stopped ? (
                      <p className="text-xs text-muted-foreground">Stopped before the answer was complete.</p>
                    ) : null}

                    {turn.interrupted ? (
                      <p className="text-xs text-muted-foreground">Interrupted before the answer finished. Regenerate to try again.</p>
                    ) : null}

                    <ErrorBoundary>
                      {/* The BI goes up on the side; the chat keeps one card that
                          names it and brings it back. */}
                      {canvasWidgets(turn.widgets).length > 0 ? (
                        <motion.button
                          data-anim
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.32, ease: EASE }}
                          onClick={() => {
                            const canvas = canvasWidgets(turn.widgets);
                            showDashboard({ title: canvasTitle(canvas), widgets: canvas, sources: turn.sources });
                          }}
                          whileTap={{ scale: 0.99 }}
                          className="lift flex w-full items-center gap-2.5 rounded-xl border border-[color:var(--line)] bg-card px-4 py-3 text-left [box-shadow:var(--hi),var(--shadow-raised)] hover:bg-accent"
                        >
                          <PanelRight className="size-4 shrink-0 text-[var(--accent-600)]" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">
                              {canvasTitle(canvasWidgets(turn.widgets))}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {loading && index === turns.length - 1 ? 'Building on the side…' : 'Open on the side'}
                            </span>
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        </motion.button>
                      ) : null}

                      {/* Compare cards read in place: they carry the prose and
                          their own Explain toggle. */}
                      {turn.widgets.filter((widget) => !isCanvasWidget(widget)).map((widget, widgetIndex) => (
                        <motion.div
                          key={widget.id}
                          data-anim
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.32, delay: Math.min(widgetIndex * 0.07, 0.28), ease: EASE }}
                        >
                          <WidgetRenderer
                            widget={widget}
                            onOpenBrain={onOpenBrain}
                            onCompareOnMap={onCompareOnMap}
                          />
                        </motion.div>
                      ))}
                    </ErrorBoundary>

                    {turn.flagged ? (
                      <div className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                        <TriangleAlert className="size-3.5" />
                        {turn.withdrawn
                          ? 'The first draft contained a figure that could not be traced to the data, so it was withdrawn.'
                          : turn.flagReason === 'leak'
                            ? 'Internal instructions or credentials appeared in this answer, so it was withheld. Please ask again.'
                            : turn.flagReason === 'ungrounded'
                              ? 'This answer was not grounded in the group data. Treat it with care.'
                              : 'Some numbers could not be traced back to the data. Treat this answer with care.'}
                      </div>
                    ) : null}

                    {turn.sources.length > 0 ? (
                      <motion.div
                        data-anim
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, delay: 0.1 }}
                        className="flex flex-wrap items-center gap-1.5"
                      >
                        <span className="text-[10px] uppercase tracking-[1.3px] text-muted-foreground">Sources</span>
                        {turn.sources.map((source) => {
                          const isBrain = source.startsWith('Brain: ');
                          const title = isBrain ? source.slice('Brain: '.length) : source;
                          return isBrain && onOpenBrain ? (
                            <button
                              key={source}
                              onClick={() => onOpenBrain(title)}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-normal transition-colors hover:bg-accent"
                              title="Open this guidance in the Brain"
                            >
                              <FileText className="size-3 text-[var(--accent-600)]" />
                              {title}
                            </button>
                          ) : (
                            <Badge key={source} variant="secondary" className="text-[10px] font-normal">
                              {source}
                            </Badge>
                          );
                        })}
                      </motion.div>
                    ) : null}

                    {turn.mapHighlight.length > 0 || (!loading && index === turns.length - 1 && canCompare(turn)) ? (
                      <motion.div
                        data-anim
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.15, ease: EASE }}
                        className="flex flex-wrap items-center gap-2"
                      >
                        {turn.mapHighlight.length > 0 ? (
                          <motion.button
                            onClick={() => onShowMap(turn.mapHighlight)}
                            whileTap={{ scale: 0.98 }}
                            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                          >
                            <MapPin className="size-3.5 text-[var(--accent-600)]" />
                            Show {turn.mapHighlight.length} practices on the map
                          </motion.button>
                        ) : null}
                        {/* One natural next step for a settled data answer. */}
                        {!loading && index === turns.length - 1 && canCompare(turn) ? (
                          <motion.button
                            onClick={() => send('Compare with the previous month.')}
                            whileTap={{ scale: 0.98 }}
                            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <RefreshCw className="size-3.5" />
                            Compare with the previous month
                          </motion.button>
                        ) : null}
                      </motion.div>
                    ) : null}

                    {!loading && index === turns.length - 1 ? (
                      <div className="pt-1">
                        {/* One meta row per settled answer: the receipt, then
                            the actions, then the reader's verdict. */}
                        <div className="flex flex-wrap items-center gap-3">
                          {turn.tools && turn.tools.length > 0 ? (
                            <button
                              onClick={() => setOpenReceipt((open) => (open === index ? null : index))}
                              aria-expanded={openReceipt === index}
                              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <ChevronDown
                                className={cn(
                                  'size-3.5 transition-transform duration-200',
                                  openReceipt === index && 'rotate-180',
                                )}
                              />
                              How this answer was built
                            </button>
                          ) : null}
                          {/* The answer is where the work starts: a task can be
                              written from it, with the finding attached. */}
                          {turn.text || turn.widgets.length > 0 ? (
                            <button
                              onClick={() =>
                                setAssignTask({
                                  title: taskTitleFrom(questionBefore(turns, index)),
                                  note: findingLine(turn.text),
                                })
                              }
                              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <ListPlus className="size-3.5" /> Create task
                            </button>
                          ) : null}
                          <button
                            onClick={() => void copyTurn(index, turn.text)}
                            className={cn(
                              'inline-flex items-center gap-1.5 text-[11px] transition-colors hover:text-foreground',
                              copyFailed === index ? 'text-[var(--destructive)]' : 'text-muted-foreground',
                            )}
                          >
                            {copied === index ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                            {copied === index ? 'Copied' : copyFailed === index ? 'Copy failed' : 'Copy'}
                          </button>
                          <button
                            onClick={regenerate}
                            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <RefreshCw className="size-3.5" /> Regenerate
                          </button>
                          <button
                            onClick={() => rateTurn(index, 'up')}
                            aria-pressed={turn.feedback === 'up'}
                            aria-label="Good answer"
                            className={cn(
                              'inline-flex items-center transition-colors',
                              turn.feedback === 'up' ? 'text-[var(--accent-600)]' : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <ThumbsUp className="size-3.5" />
                          </button>
                          <button
                            onClick={() => rateTurn(index, 'down')}
                            aria-pressed={turn.feedback === 'down'}
                            aria-label="Flag this answer for review"
                            className={cn(
                              'inline-flex items-center transition-colors',
                              turn.feedback === 'down' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <ThumbsDown className="size-3.5" />
                          </button>
                          {turn.feedback === 'up' ? <span className="text-[11px] text-muted-foreground">Thanks</span> : null}
                          {turn.feedback === 'down' ? <span className="text-[11px] text-muted-foreground">Flagged for review</span> : null}
                        </div>
                        {openReceipt === index && turn.tools && turn.tools.length > 0 ? (
                          <div className="mt-2 space-y-1 border-l border-border pl-3 text-[11px] leading-relaxed text-muted-foreground">
                            <p>Ran: {[...new Set(turn.tools)].map(toolLabel).join(', ')}</p>
                            {turn.sources.length > 0 ? <p>From: {turn.sources.join(' · ')}</p> : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </motion.div>
                ),
              )}

              {dangling ? (
                <div role="status" className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                  <span>Answer interrupted before it finished.</span>
                  <button onClick={regenerate} className="font-medium text-[var(--accent-text)] hover:underline">
                    Ask again
                  </button>
                </div>
              ) : null}

              {error ? (
                <Card className="border-destructive/40">
                  <CardContent className="flex items-center gap-2 p-3 text-xs text-destructive">
                    <Badge variant="destructive">Error</Badge> {error}
                  </CardContent>
                </Card>
              ) : null}

              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Composer: a single floating pill that grows with the question. */}
      <div className="shrink-0 px-6 pb-7">
        <div className="mx-auto w-full max-w-[760px]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            {/* No focus highlight on purpose: the caret already shows where
                you are typing, and the orange focus ring was too loud here. */}
            <div className="flex items-end gap-2 rounded-full border border-[color:var(--line)] bg-card py-[7px] pl-5 pr-2 [box-shadow:var(--shadow-floating)]">
              <Textarea
                ref={composerRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    send(input);
                  }
                }}
                placeholder="Ask your group a question..."
                rows={1}
                className="max-h-[130px] min-h-[38px] flex-1 resize-none overflow-y-auto border-0 bg-transparent px-0 py-2 text-[15px] md:text-[15px] leading-[22px] caret-[var(--accent-600)] shadow-none placeholder:text-[color:var(--ink-3)] focus-visible:ring-0"
                disabled={loading}
              />
              {/* Empty input: the gradient gives way to a soft wash with a
                  visible orange arrow, still not clickable. With text: the
                  full gradient. While answering, the same button is the stop
                  control. */}
              <motion.button
                type={loading ? 'button' : 'submit'}
                onClick={loading ? stop : undefined}
                disabled={!loading && !hasText}
                aria-label={loading ? 'Stop generating' : 'Send question'}
                whileTap={loading || hasText ? { scale: 0.96 } : undefined}
                transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                style={{ marginBottom: trailingBlankLines * 22 }}
                className={cn(
                  'inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-[color,filter,box-shadow] duration-[160ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] disabled:pointer-events-none',
                  loading || hasText
                    ? 'text-white [background:var(--send-gradient)] [box-shadow:var(--shadow-send)] hover:brightness-95'
                    : 'bg-[var(--accent-soft)] text-[var(--accent-600)]',
                )}
              >
                {loading ? <Square className="size-3.5" /> : <ArrowUp className="size-4" />}
              </motion.button>
            </div>
          </form>
          {/* The pill row: the Brain entry point on the left, the key hint
              centred in the remaining space. Wrapping keeps both readable on
              narrow windows instead of squeezing either one. */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <BrainPill onOpen={() => setBrainOpen(true)} />
            <p className="mx-auto text-center text-xs text-[color:var(--ink-3)]">
              Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
      </div>

      {dashboard ? (
        <DashboardPanel
          title={dashboard.title}
          widgets={dashboard.widgets}
          sources={dashboard.sources}
          full={dashboardFull}
          onExitFull={() => setDashboardFull(false)}
          onEnterFull={() => setDashboardFull(true)}
          onClose={() => showDashboard(null)}
        />
      ) : null}

      {brainOpen ? (
        <BrainOverlay
          onClose={() => setBrainOpen(false)}
          practiceName={practiceName}
          onOpenDocument={(title) => {
            setBrainOpen(false);
            onOpenBrain?.(title);
          }}
        />
      ) : null}

      <AssignTaskDialog
        open={assignTask !== null}
        onOpenChange={(open) => {
          if (!open) setAssignTask(null);
        }}
        defaultTitle={assignTask?.title ?? ''}
        defaultNote={assignTask?.note}
        assignees={LEADERSHIP}
      />
    </div>
  );
}
