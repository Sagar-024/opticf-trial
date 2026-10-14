'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Eye,
  FileText,
  Map,
  MapPin,
  RefreshCw,
  Sparkles,
  Square,
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ErrorBoundary } from '@/components/error-boundary';
import { WaveText } from '@/components/wave-text';
import { Logo } from '@/components/logo';
import { forceVisibleIfStuck } from '@/lib/anim';
import { getSession, migrateLegacy, newSessionId, setTurnFeedback, titleFromQuestion, upsertSession, type StoredTurn } from '@/lib/chat-store';
import { WidgetRenderer } from '@/components/widgets/widget-renderer';
import { cn } from '@/lib/utils';

/**
 * The four questions leadership actually opens with, shown as a tidy two by
 * two: the pulse check first, then who needs help, what moved, and how the
 * regions sit. Each one maps to real tools, so none of them is filler. The
 * first is the hero: the only chip that carries the orange.
 */
const SUGGESTIONS: Array<{ text: string; icon: LucideIcon; hero?: boolean }> = [
  { text: 'How is the group doing this month?', icon: Sparkles, hero: true },
  { text: 'Which practices need attention, and why?', icon: Eye },
  { text: 'Which practices dropped the most since last month?', icon: TrendingDown },
  { text: 'How do the regions compare?', icon: Map },
];

/** Shared easing so every chat animation feels like one system. */
const EASE = [0.22, 1, 0.36, 1] as const;

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
    flagged: stored.flagged,
    flagReason: stored.flagReason ?? null,
    withdrawn: stored.withdrawn,
    stopped: stored.stopped,
    interrupted: stored.interrupted,
    feedback: stored.feedback,
  };
}

/** Tool ids are for us; these phrases are for the person reading the answer. */
const TOOL_LABELS: Record<string, string> = {
  search_brain: 'searching the Brain',
  query_metrics: 'reading the numbers',
  compare: 'comparing periods',
  training_status: 'checking training',
  rank_attention: 'ranking attention',
  today_priorities: 'reading the priorities',
  get_practice: 'reading the practice',
  below_cl_target: 'checking contact lens targets',
  highlight_on_map: 'marking the map',
  build_dashboard: 'building the dashboard',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, ' ');
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
  /** The reader's verdict on this answer; kept in the browser for review. */
  feedback?: 'up' | 'down';
  /** What the assistant is doing right now: writing or working between steps. */
  phase?: 'working' | 'writing';
}

type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; malformed?: boolean }
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
      usage?: { inputTokens: number; outputTokens: number; estimatedCostUsd?: number };
    }
  | { type: 'error'; message: string; status?: number };

export function ChatView({
  onShowMap,
  onOpenBrain,
  pendingQuestion,
  onPendingHandled,
  sessionId,
  onSessionChange,
}: {
  onShowMap: (practiceIds: string[]) => void;
  onOpenBrain?: (documentTitle: string) => void;
  pendingQuestion?: string | null;
  onPendingHandled?: () => void;
  /** The conversation the rail has selected; null means a fresh, unsaved chat. */
  sessionId: string | null;
  onSessionChange?: (id: string | null) => void;
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
  }, [sessionId, hydrated]);

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

      const draft: Turn = { role: 'assistant', text: '', widgets: [], mapHighlight: [], sources: [], tools: [] };
      setTurns([...history, draft]);

      const messages = history.map((turn) => ({ role: turn.role, content: turn.text }));

      try {
        // Guidance edits live in this browser, so send them with the question.
        // The server validates them before they reach the model.
        let brainOverrides: unknown = {};
        try {
          const raw = localStorage.getItem('opticf-brain-v1');
          if (raw) brainOverrides = JSON.parse(raw);
        } catch {
          brainOverrides = {};
        }

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
              patch({ text: (draft.text += event.text), chunks: draft.chunks, phase: 'writing' });
            } else if (event.type === 'tool') {
              draft.tools = [...(draft.tools ?? []), event.name];
              patch({ tools: draft.tools, phase: 'working' });
            } else if (event.type === 'widgets') {
              draft.widgets = event.widgets;
              patch({ widgets: event.widgets, phase: 'working' });
            } else if (event.type === 'done') {
              contextRef.current = event.context;
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
                tools: draft.tools,
              });
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
    [patchLast, saveSession],
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
    <div className="flex h-full flex-col">
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
                    ) : loading && index === turns.length - 1 && turn.widgets.length === 0 ? (
                      <div className="space-y-3">
                        <WorkingIndicator label="Thinking about your data" />
                        <Skeleton className="h-16 w-full rounded-xl" />
                      </div>
                    ) : null}

                    {turn.stopped ? (
                      <p className="text-xs text-muted-foreground">Stopped before the answer was complete.</p>
                    ) : null}

                    {turn.interrupted ? (
                      <p className="text-xs text-muted-foreground">Interrupted before the answer finished. Regenerate to try again.</p>
                    ) : null}

                    <ErrorBoundary>
                      {turn.widgets.map((widget, widgetIndex) => (
                        <motion.div
                          key={widget.id}
                          data-anim
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.32, delay: Math.min(widgetIndex * 0.07, 0.28), ease: EASE }}
                        >
                          <WidgetRenderer widget={widget} />
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

                    {/* The working indicator lives at the end of whatever has
                        arrived: below text, below widgets, never at the top. */}
                    {loading && index === turns.length - 1 && turn.phase !== 'writing' && (Boolean(turn.text) || turn.widgets.length > 0) ? (
                      <WorkingIndicator
                        label={turn.tools && turn.tools.length > 0 ? toolLabel(turn.tools[turn.tools.length - 1]) : 'Thinking about your data'}
                      />
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
          <p className="mt-2 text-center text-xs text-[color:var(--ink-3)]">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
