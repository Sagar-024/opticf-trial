'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import {
  ArrowUp,
  Check,
  Copy,
  FileText,
  Loader2,
  MapPin,
  RefreshCw,
  Square,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { ChatContext, Widget } from '@/ai/types';
import { containsModelMarkup, stripModelMarkup, trimTrailingPartialTag } from '@/ai/markup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ErrorBoundary } from '@/components/error-boundary';
import { PALETTE, rgb } from '@/components/dither-kit/palette';
import { WaveText } from '@/components/wave-text';
import { Logo } from '@/components/logo';
import { forceVisibleIfStuck } from '@/lib/anim';
import { WidgetRenderer } from '@/components/widgets/widget-renderer';
import { cn } from '@/lib/utils';

const SUGGESTIONS = [
  'Create a dashboard showing revenue and conversion across the group this month.',
  'Which practices have had the biggest revenue drop compared with last month?',
  'Compare the North West with the other regions.',
  'Show me contact lens sales by practice.',
  "Which practices haven't completed their training?",
  'Which practices need the most attention, and what in the data suggests that?',
  'Show those practices on the map.',
];

  const STORAGE_KEY = 'opticf-chat-v1';

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

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

/**
 * The Dither Kit fill is only ~82% opaque by design, so on a pale page it
 * blends to a wash. Painting the same colour underneath keeps the button a
 * true, solid orange while the dither texture and bloom sit on top.
 */
const sendFill = rgb(PALETTE.brand.fill);


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
  tools?: string[];
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
}: {
  onShowMap: (practiceIds: string[]) => void;
  onOpenBrain?: (documentTitle: string) => void;
  pendingQuestion?: string | null;
  onPendingHandled?: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const contextRef = useRef<ChatContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Restore the thread.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { turns?: Turn[]; context?: ChatContext | null };
        if (Array.isArray(parsed.turns)) setTurns(parsed.turns);
        if (parsed.context) contextRef.current = parsed.context;
      }
    } catch {
      // ignore unreadable storage
    }
    setHydrated(true);
  }, []);

  // Persist the thread, but only after the restore above has run.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ turns, context: contextRef.current }));
    } catch {
      // storage full or unavailable
    }
  }, [turns, hydrated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    // If frames are frozen, do not leave a message or widget invisible.
    const timer = window.setTimeout(() => forceVisibleIfStuck(document.querySelector('main')), 900);
    return () => window.clearTimeout(timer);
  }, [turns, loading]);

  const patchLast = useCallback((patch: Partial<Turn>) => {
    setTurns((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], ...patch };
      return next;
    });
  }, []);

  const runStream = useCallback(
    async (history: Turn[]) => {
      setLoading(true);
      setError(null);
      const controller = new AbortController();
      abortRef.current = controller;

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
          patchLast({ text: '' });
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
              patchLast({ text: (draft.text += event.text), chunks: draft.chunks });
            } else if (event.type === 'tool') {
              draft.tools = [...(draft.tools ?? []), event.name];
              patchLast({ tools: draft.tools });
            } else if (event.type === 'widgets') {
              draft.widgets = event.widgets;
              patchLast({ widgets: event.widgets });
            } else if (event.type === 'done') {
              contextRef.current = event.context;
              patchLast({
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
          patchLast({ stopped: true, text: draft.text || 'Stopped.' });
        } else {
          setError(requestError instanceof Error ? requestError.message : 'Request failed.');
          patchLast({ text: draft.text });
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [patchLast],
  );

  function send(question: string): void {
    const text = question.trim();
    if (!text || loading) return;
    setInput('');
    const history: Turn[] = [...turns, { role: 'user', text, widgets: [], mapHighlight: [], sources: [] }];
    void runStream(history);
  }

  function regenerate(): void {
    if (loading) return;
    const lastUser = [...turns].reverse().findIndex((turn) => turn.role === 'user');
    if (lastUser === -1) return;
    const cut = turns.length - lastUser;
    void runStream(turns.slice(0, cut));
  }

  function stop(): void {
    abortRef.current?.abort();
  }

  async function copyTurn(index: number, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // clipboard unavailable
    }
  }

  function clearThread(): void {
    abortRef.current?.abort();
    contextRef.current = null;
    setTurns([]);
    setError(null);
  }

  const empty = turns.length === 0;
  const lastIsAssistant = turns.length > 0 && turns[turns.length - 1].role === 'assistant';

  // A question handed over from the map is sent once the thread has restored.
  useEffect(() => {
    if (!hydrated || !pendingQuestion || loading) return;
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
              <h1 className="mt-4 text-balance text-2xl font-semibold tracking-tight">
                <WaveText text="What needs your attention?" delay={80} />
              </h1>
              <p className="mt-2 max-w-md text-pretty text-sm text-muted-foreground">
                <WaveText
                  text="Ask about your practices. Answers, numbers and charts all come from the loaded data."
                  delay={160}
                  step={10}
                />
              </p>
              <motion.div variants={fadeUp} className="mt-7 flex max-w-2xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <motion.button
                    key={suggestion}
                    onClick={() => send(suggestion)}
                    whileTap={{ scale: 0.97 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {suggestion}
                  </motion.button>
                ))}
              </motion.div>
            </motion.div>
          ) : (
            <div className="space-y-6 py-8">
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={clearThread} className="text-xs text-muted-foreground">
                  <Trash2 className="size-3.5" /> New chat
                </Button>
              </div>

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
                      {turn.tools && turn.tools.length > 0 ? (
                        <span className="text-[10px] text-muted-foreground">
                          {[...new Set(turn.tools)].join(', ')}
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
                        {loading && index === turns.length - 1 ? (
                          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-coral align-text-bottom" />
                        ) : null}
                      </p>
                    ) : loading && index === turns.length - 1 ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" /> Thinking about your data
                        </div>
                        <Skeleton className="h-16 w-full rounded-xl" />
                      </div>
                    ) : null}

                    {turn.stopped ? (
                      <p className="text-xs text-muted-foreground">Stopped before the answer was complete.</p>
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
                              <FileText className="size-3 text-coral" />
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

                    {turn.mapHighlight.length > 0 ? (
                      <motion.button
                        onClick={() => onShowMap(turn.mapHighlight)}
                        data-anim
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.15, ease: EASE }}
                        whileTap={{ scale: 0.98 }}
                        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                      >
                        <MapPin className="size-3.5 text-coral" />
                        Show {turn.mapHighlight.length} practices on the map
                      </motion.button>
                    ) : null}

                    {!loading && index === turns.length - 1 ? (
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <button
                          onClick={() => void copyTurn(index, turn.text)}
                          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {copied === index ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                          {copied === index ? 'Copied' : 'Copy'}
                        </button>
                        <button
                          onClick={regenerate}
                          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <RefreshCw className="size-3.5" /> Regenerate
                        </button>
                      </div>
                    ) : null}
                  </motion.div>
                ),
              )}

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

      {/* Composer: a single floating pill so the conversation keeps the space. */}
      <div className="shrink-0 px-6 pb-4">
        <div className="mx-auto w-full max-w-3xl">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <div className="flex items-end gap-2 rounded-full border border-border bg-card py-1.5 pl-4 pr-1.5 shadow-soft transition-shadow focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/25">
              <Textarea
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
                className="max-h-32 min-h-8 flex-1 resize-none border-0 bg-transparent px-0 py-1.5 text-sm shadow-none focus-visible:ring-0"
                disabled={loading}
              />
              {/* Plain filled button, no dither and no disabled fade, so the
                  colour is exactly the brand orange at all times. Empty input
                  is ignored by send() rather than dimming the control. */}
              <motion.button
                type={loading ? 'button' : 'submit'}
                onClick={loading ? stop : undefined}
                aria-label={loading ? 'Stop generating' : 'Send question'}
                style={{ backgroundColor: sendFill }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-white shadow-soft transition-[filter] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                {loading ? <Square className="size-3.5" /> : <ArrowUp className="size-4" />}
              </motion.button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
