'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, MapPin, Sparkles } from 'lucide-react';
import type { ChatContext, Widget } from '@/ai/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { WidgetRenderer } from '@/components/widgets/widget-renderer';

const SUGGESTIONS = [
  'Create a dashboard showing revenue and conversion across the group this month.',
  'Which practices have had the biggest revenue drop compared with last month?',
  'Compare the North West with the other regions.',
  'Show me contact lens sales by practice.',
  "Which practices haven't completed their training?",
  'Which practices need the most attention, and what in the data suggests that?',
  'Show those practices on the map.',
];

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  widgets: Widget[];
  mapHighlight: string[];
}

interface ChatApiResponse {
  text: string;
  widgets: Widget[];
  mapHighlight: string[];
  context: ChatContext;
  flagged: boolean;
  error?: string;
}

export function ChatView({ onShowMap }: { onShowMap: (practiceIds: string[]) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contextRef = useRef<ChatContext | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, loading]);

  async function send(question: string): Promise<void> {
    const text = question.trim();
    if (!text || loading) return;
    setError(null);
    const nextTurns: Turn[] = [...turns, { role: 'user', text, widgets: [], mapHighlight: [] }];
    setTurns(nextTurns);
    setInput('');
    setLoading(true);

    try {
      const messages = nextTurns.map((turn) => ({ role: turn.role, content: turn.text }));
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, context: contextRef.current }),
      });
      const data = (await response.json()) as ChatApiResponse;
      if (!response.ok) {
        setError(data.error ?? `Request failed (${response.status}).`);
        setLoading(false);
        return;
      }
      contextRef.current = data.context;
      setTurns((current) => [
        ...current,
        { role: 'assistant', text: data.text, widgets: data.widgets ?? [], mapHighlight: data.mapHighlight ?? [] },
      ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Request failed.');
    } finally {
      setLoading(false);
    }
  }

  const empty = turns.length === 0;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-6">
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 py-8">
          {empty ? (
            <>
              <p className="label-caps">Ask Optific</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">What needs your attention?</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Ask about your practices. Answers, numbers and charts all come from the loaded data.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => send(suggestion)}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-panel transition-colors hover:bg-rail-active hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-6">
              {turns.map((turn, index) => (
                <div key={index} className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {turn.role === 'user' ? (
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                      {turn.text}
                    </div>
                  ) : (
                    <div className="w-full space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="grid size-6 place-items-center rounded-full bg-rail-active">
                          <Sparkles className="size-3.5 text-coral" />
                        </span>
                        <span className="text-xs font-semibold">Optific</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{turn.text}</p>
                      {turn.widgets.map((widget) => (
                        <WidgetRenderer key={widget.id} widget={widget} />
                      ))}
                      {turn.mapHighlight.length > 0 ? (
                        <button
                          onClick={() => onShowMap(turn.mapHighlight)}
                          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-panel transition-colors hover:bg-rail-active"
                        >
                          <MapPin className="size-3.5 text-coral" />
                          Show {turn.mapHighlight.length} practices on the map
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
              {loading ? (
                <div className="w-full space-y-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Thinking about your data
                  </div>
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-40 w-full rounded-xl" />
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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
        className="sticky bottom-0 flex items-end gap-2 border-t border-border bg-background/90 py-4 backdrop-blur"
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
          placeholder="Ask your group a question..."
          rows={1}
          className="min-h-11 resize-none bg-card"
          disabled={loading}
        />
        <Button type="submit" size="icon" disabled={loading || !input.trim()} aria-label="Send question">
          {loading ? <Loader2 className="animate-spin" /> : <ArrowUp />}
        </Button>
      </form>
    </div>
  );
}
