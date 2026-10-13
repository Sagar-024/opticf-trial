'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ErrorBoundary } from '@/components/error-boundary';
import { DitherButton } from '@/components/dither-kit/button';
import { Logo } from '@/components/logo';
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

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  widgets: Widget[];
  mapHighlight: string[];
  sources: string[];
  flagged?: boolean;
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
              patchLast({ text: (draft.text += event.text) });
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
                widgets: event.widgets,
                mapHighlight: event.mapHighlight,
                sources: event.sources,
                flagged: event.flagged,
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
            <div className="flex min-h-[58vh] flex-col items-center justify-center py-14 text-center">
              <Logo className="size-12" />
              <h1 className="mt-4 text-2xl font-semibold tracking-tight">What needs your attention?</h1>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Ask about your practices. Answers, numbers and charts all come from the loaded data.
              </p>
              <div className="mt-7 flex max-w-2xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => send(suggestion)}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-panel transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6 py-8">
              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={clearThread} className="text-xs text-muted-foreground">
                  <Trash2 className="size-3.5" /> New chat
                </Button>
              </div>

              {turns.map((turn, index) =>
                turn.role === 'user' ? (
                  <div key={index} className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                      {turn.text}
                    </div>
                  </div>
                ) : (
                  <div key={index} className="w-full space-y-3">
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
                        {turn.text}
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
                      {turn.widgets.map((widget) => (
                        <WidgetRenderer key={widget.id} widget={widget} />
                      ))}
                    </ErrorBoundary>

                    {turn.flagged ? (
                      <div className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                        <TriangleAlert className="size-3.5" />
                        Some numbers could not be traced back to the data. Treat this answer with care.
                      </div>
                    ) : null}

                    {turn.sources.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
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
                      </div>
                    ) : null}

                    {turn.mapHighlight.length > 0 ? (
                      <button
                        onClick={() => onShowMap(turn.mapHighlight)}
                        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-panel transition-colors hover:bg-accent"
                      >
                        <MapPin className="size-3.5 text-coral" />
                        Show {turn.mapHighlight.length} practices on the map
                      </button>
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
                  </div>
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
          <p className="mb-1.5 text-center text-[10px] text-muted-foreground">
            Live AI, fictional data. Every number comes from the loaded data.
          </p>
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
              <DitherButton
                type={loading ? 'button' : 'submit'}
                color="burnt"
                variant="solid"
                bloom="aura"
                onClick={loading ? stop : undefined}
                disabled={!loading && !input.trim()}
                aria-label={loading ? 'Stop generating' : 'Send question'}
                /* White icon on the deeper orange, matching the brand reference
                   for the send control. */
                className="size-9 shrink-0 rounded-full p-0 text-white"
              >
                {loading ? <Square className="size-3.5" /> : <ArrowUp className="size-4" />}
              </DitherButton>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
