'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type FormEvent } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, FileText, RefreshCw, Square, TriangleAlert, X } from 'lucide-react';
import type { BrainAskEvent, BrainCitation } from '@/brain/ask';
import {
  buildBrainGraph,
  documentNodeId,
  type BrainGraphNode,
} from '@/brain/graph';
import { citedDocumentIds } from '@/brain/retrieve';
import { stripModelMarkup, trimTrailingPartialTag } from '@/ai/markup';
import type { BrainDocument } from '@/content/brain';
import { readBrainState, useBrainDocuments } from '@/lib/brain-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BrainCanvas, type BrainCanvasHandle } from '@/components/brain/brain-canvas';
import { tokenVarFor } from '@/components/map/palette';
import { cn } from '@/lib/utils';

/**
 * The Practice Brain page, over the chat.
 *
 * A full-page Radix Dialog: the ask bar and its derived chips, the latest
 * answer with citation chips that fly the graph to the exact document nodes,
 * the graph itself, and a document detail panel. Answers stream from
 * /api/brain/ask as NDJSON; done.text is authoritative and the streamed draft
 * is only ever a preview.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** The hub's mark, shared with the canvas: a crisp four point sparkle. */
function SparkleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12 1.8 Q13.2 10.8 22.2 12 Q13.2 13.2 12 22.2 Q10.8 13.2 1.8 12 Q10.8 10.8 12 1.8 Z" />
    </svg>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format an ISO review date the way a reader says it: "Reviewed 7 Oct 2026". */
function formatReviewed(iso: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return `Reviewed ${iso}`;
  const date = new Date(ms);
  return `Reviewed ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ''} ${date.getUTCFullYear()}`.replace('  ', ' ');
}

/** The quiet note under a flagged (but not withdrawn) answer. */
function flagNote(reason: 'leak' | 'ungrounded' | 'numbers' | null): string {
  if (reason === 'leak') return 'This answer was flagged during a safety check.';
  if (reason === 'ungrounded') return 'This answer could not be grounded in the Brain documents.';
  if (reason === 'numbers') return 'Some figures in this answer could not be verified against the documents.';
  return 'This answer was flagged for review.';
}

/** While streaming: drop any half arrived markup, then any complete markup. */
function cleanStream(text: string): string {
  return stripModelMarkup(trimTrailingPartialTag(text)).text;
}

/** At rest: done.text is authoritative, so strip markup from the full text. */
function cleanFinal(text: string): string {
  return stripModelMarkup(text).text;
}

/**
 * Remove `[id]` citation tokens from the displayed text, but only for ids the
 * retrieval actually returned: an invented [id] stays visible as plain text
 * instead of silently becoming machinery. Scans are per delta, which is free
 * at the 2 to 5 sentence answers this surface produces.
 */
function stripCitationTokens(text: string, ids: ReadonlySet<string>): string {
  if (ids.size === 0 || !text.includes('[')) return text;
  let replaced = false;
  const out = text.replace(/\[([A-Za-z0-9._-]{1,80})\]/g, (match, id: string) => {
    if (!ids.has(id)) return match;
    replaced = true;
    return '';
  });
  return replaced ? out.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,;:!?])/g, '$1') : out;
}

interface BrainTurn {
  question: string;
  /** The cleaned display text: streamed draft, then the authoritative done text. */
  draft: string;
  /** Documents the retrieval found, from meta. Citation titles resolve through it. */
  meta: BrainCitation[];
  citations: BrainCitation[];
  status: 'streaming' | 'done' | 'stopped' | 'error';
  error: string | null;
  flagged: boolean;
  flagReason: 'leak' | 'ungrounded' | 'numbers' | null;
  withdrawn: boolean;
}

/** The coral primary action, the same family as the chat's send button. */
function AccentButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-medium text-white transition-[filter] duration-150 [background:var(--send-gradient)] [box-shadow:var(--shadow-send)] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    />
  );
}

/** The document detail panel: right rail on md+, bottom sheet on small screens. */
function DocumentPanel({
  document,
  node,
  practiceName,
  onAskAbout,
  onOpen,
}: {
  document: BrainDocument;
  node: BrainGraphNode;
  practiceName?: (practiceId: string) => string;
  onAskAbout: () => void;
  onOpen: (() => void) | null;
}) {
  const flags = node.flags ?? {};
  const links = flags.practiceLinks ?? [];
  const chip = 'rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground';
  return (
    <aside
      aria-label="Document details"
      className="absolute inset-x-0 bottom-0 z-30 flex max-h-[70dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-card [box-shadow:var(--shadow-floating)] md:inset-x-auto md:inset-y-0 md:right-0 md:max-h-none md:w-[380px] md:rounded-none md:rounded-l-2xl md:border-y-0 md:border-r-0"
    >
      <div className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold leading-5">{document.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={chip}>{document.section}</span>
          <span className={chip}>{document.scope}</span>
          <span className={chip}>{document.owner}</span>
          <span className={chip}>{formatReviewed(document.reviewed)}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
        {flags.conflict || flags.reviewDue || flags.yours ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {flags.conflict ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-foreground">
                <TriangleAlert className="size-3 text-[oklch(var(--chart-4))]" />
                Needs clarification
              </span>
            ) : null}
            {flags.reviewDue ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-foreground">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{ background: `oklch(var(${tokenVarFor('amber')}))` }}
                />
                Review due
              </span>
            ) : null}
            {flags.yours ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-foreground">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{ background: `oklch(var(${tokenVarFor('coral')}))` }}
                />
                Yours
              </span>
            ) : null}
          </div>
        ) : null}

        {links.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {links.map((practiceId) => (
              <span key={practiceId} className={chip}>
                Linked to {practiceName?.(practiceId) ?? practiceId}
              </span>
            ))}
          </div>
        ) : null}

        <ScrollArea className="min-h-0 flex-1 rounded-xl border border-border bg-background/60">
          <p className="whitespace-pre-wrap p-3 pr-4 text-sm leading-6">{document.content}</p>
        </ScrollArea>

        <div className="flex shrink-0 items-center gap-2">
          <AccentButton type="button" className="h-8 rounded-lg px-3 text-xs" onClick={onAskAbout}>
            Ask about this
          </AccentButton>
          {onOpen ? (
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onOpen}>
              Open in the Brain
            </Button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export function BrainOverlay({
  onClose,
  practiceName,
  onOpenDocument,
}: {
  onClose: () => void;
  practiceName?: (practiceId: string) => string;
  onOpenDocument?: (documentTitle: string) => void;
}) {
  const documents = useBrainDocuments();
  const graph = useMemo(() => buildBrainGraph(documents), [documents]);
  const documentsById = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph]);

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  /** The sidebar conversation: every asked question with its answer. */
  const [turns, setTurns] = useState<BrainTurn[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  /** Focus mode: the graph owns the surface, chrome steps aside. */
  const [focused, setFocused] = useState(false);

  const canvasRef = useRef<BrainCanvasHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Earlier turns only feed model context; the strip shows one answer. */
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const reduceMotion = useReducedMotion();

  // Unmount must abort any in-flight ask.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  // An edit to the documents can remove the selected node; drop the stale one.
  useEffect(() => {
    if (selectedId && !nodeById.has(selectedId)) {
      setSelectedId(null);
      setHighlighted([]);
    }
  }, [nodeById, selectedId]);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    setHighlighted([]);
  }, []);

  /** Update the turn the answer is streaming into. */
  const patchLast = useCallback((patch: Partial<BrainTurn>) => {
    setTurns((list) => {
      if (list.length === 0) return list;
      return [...list.slice(0, -1), { ...list[list.length - 1], ...patch }];
    });
  }, []);

  const stopLast = useCallback(() => {
    setTurns((list) => {
      const last = list[list.length - 1];
      if (!last || last.status !== 'streaming') return list;
      return [...list.slice(0, -1), { ...last, status: 'stopped' }];
    });
  }, []);

  const clearTurns = useCallback(() => {
    setTurns([]);
    historyRef.current = [];
  }, []);

  // Escape peels layers before Radix can dismiss the whole page. The listener
  // sits on window capture, ahead of Radix's own document listener, and
  // consumes the event only when a layer actually closed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (focused) {
        event.preventDefault();
        event.stopPropagation();
        setFocused(false);
        return;
      }
      if (selectedId) {
        event.preventDefault();
        event.stopPropagation();
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [clearSelection, focused, selectedId]);

  /** A canvas node click: select it, highlight its knowledge, and fly to it. */
  const selectNode = useCallback(
    (nodeId: string | null) => {
      if (!nodeId) {
        clearSelection();
        return;
      }
      const node = nodeById.get(nodeId);
      if (!node) {
        clearSelection();
        return;
      }
      setSelectedId(nodeId);
      let focus: string[] = [];
      if (node.role === 'section' && node.section) {
        focus = graph.nodes
          .filter((candidate) => candidate.role === 'document' && candidate.section === node.section)
          .map((candidate) => candidate.id);
      } else if (node.role === 'owner' && node.ownerKey) {
        focus = graph.nodes
          .filter((candidate) => candidate.role === 'document' && candidate.ownerKey === node.ownerKey)
          .map((candidate) => candidate.id);
      } else if (node.role === 'document') {
        focus = [nodeId];
      }
      setHighlighted(focus);
      canvasRef.current?.flyToNodes(focus.length > 0 ? focus : [nodeId]);
    },
    [clearSelection, graph.nodes, nodeById],
  );

  /** A citation chip: light up exactly that document node and centre it. */
  const focusDocument = useCallback(
    (documentId: string) => {
      const nodeId = documentNodeId(documentId);
      if (!nodeById.has(nodeId)) return;
      setHighlighted([nodeId]);
      canvasRef.current?.flyToNodes([nodeId]);
    },
    [nodeById],
  );

  const stopAsk = useCallback(() => {
    stopLast();
    abortRef.current?.abort();
  }, [stopLast]);

  /** The graph's Focus toggle, from the cluster or the F key. */
  const toggleFocus = useCallback(() => {
    setFocused((value) => !value);
  }, []);

  // Leaving focus hands the caret back to the ask bar, so the next Escape is
  // heard inside the dialog and closes the page as expected.
  useEffect(() => {
    if (!focused) inputRef.current?.focus();
  }, [focused]);

  const askBrain = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || asking) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setAsking(true);
      setTurns((list) => [
        ...list,
        {
          question: text,
          draft: '',
          meta: [],
          citations: [],
          status: 'streaming',
          error: null,
          flagged: false,
          flagReason: null,
          withdrawn: false,
        },
      ]);

      const history = historyRef.current.slice(-6);

      try {
        // Guidance edits and the reader's own documents live in this browser,
        // so they travel with the question. The route sanitises them first.
        const response = await fetch('/api/brain/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: text, history, brainOverrides: readBrainState() }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          let message = `The Brain could not answer (request failed with ${response.status}).`;
          try {
            const payload = (await response.json()) as { error?: string };
            if (payload && typeof payload.error === 'string' && payload.error.trim()) message = payload.error;
          } catch {
            // Keep the status message.
          }
          patchLast({ status: 'error', error: message });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let rawText = '';
        let metaDocs: BrainCitation[] = [];

        const handleEvent = (event: BrainAskEvent): void => {
          if (event.type === 'meta') {
            metaDocs = event.docs;
            patchLast({ meta: event.docs });
            return;
          }
          if (event.type === 'delta') {
            rawText += event.text;
            const known = new Set(metaDocs.map((doc) => doc.id));
            const cited = citedDocumentIds(rawText, known);
            const display = stripCitationTokens(cleanStream(rawText), new Set(cited));
            patchLast({ draft: display });
            return;
          }
          if (event.type === 'done') {
            // done.text is authoritative: replace the streamed draft with it.
            const known = new Set(metaDocs.map((doc) => doc.id));
            const cited = new Set(citedDocumentIds(event.text, known));
            const display = stripCitationTokens(cleanFinal(event.text), cited);
            historyRef.current = [
              ...historyRef.current,
              { role: 'user' as const, content: text },
              { role: 'assistant' as const, content: display || event.text },
            ].slice(-6);
            patchLast({
              draft: display,
              meta: event.docs,
              citations: event.citations,
              status: 'done',
              flagged: event.flagged,
              flagReason: event.flagReason,
              withdrawn: event.withdrawn,
            });
            return;
          }
          if (event.type === 'error') {
            patchLast({ status: 'error', error: event.message });
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            let event: BrainAskEvent;
            try {
              event = JSON.parse(line) as BrainAskEvent;
            } catch {
              continue;
            }
            handleEvent(event);
          }
        }
        const tail = buffer.trim();
        if (tail) {
          try {
            handleEvent(JSON.parse(tail) as BrainAskEvent);
          } catch {
            // A torn final line is dropped.
          }
        }
        // A stream that ended without done is incomplete: offer the retry.
        stopLast();
      } catch (error) {
        if (controller.signal.aborted) {
          stopLast();
        } else {
          const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
          patchLast({ status: 'error', error: `The Brain could not be reached.${detail}` });
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setAsking(false);
      }
    },
    [asking, patchLast, stopLast],
  );

  const submitAsk = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (asking) return;
    const text = question;
    setQuestion('');
    void askBrain(text);
  };

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;
  const selectedDocument =
    selectedNode && selectedNode.role === 'document' && selectedNode.documentId
      ? documentsById.get(selectedNode.documentId) ?? null
      : null;

  /** The citation chips of one turn: id, title and section, deduped. */
  const chipsFor = (entry: BrainTurn): Array<{ id: string; title: string; section: string }> => {
    if (entry.citations.length === 0) return [];
    const seen = new Set<string>();
    return entry.citations
      .filter((citation) => {
        if (seen.has(citation.id)) return false;
        seen.add(citation.id);
        return true;
      })
      .map((citation) => {
        const meta = entry.meta.find((doc) => doc.id === citation.id);
        return {
          id: citation.id,
          title: meta?.title ?? citation.title,
          section: meta?.section ?? citation.section,
        };
      });
  };

  return (
    <DialogPrimitive.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Content
        className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-background outline-none"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        // A page, not a modal: the rail and the top bar stay usable, and only
        // Escape (or the close button) leaves. Outside interactions must not
        // dismiss it.
        onInteractOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
          <motion.div
            className="flex h-full min-h-0 flex-col overflow-y-auto"
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
          >
            {/* 1. Header (hidden in focus mode; Escape or the cluster brings it back) */}
            <header
              className={cn(
                'mx-auto flex w-full max-w-[1120px] shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-3 md:px-8 md:pt-4',
                focused && 'hidden',
              )}
            >
              <div className="min-w-0">
                <p className="text-[10px] leading-4 text-[color:var(--ink-3)]">Home / Behind your answers</p>
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0">
                  <DialogPrimitive.Title className="text-lg font-semibold leading-6 tracking-tight md:text-xl">
                    Your Practice Brain
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-xs leading-5 text-muted-foreground">
                    The people, knowledge and systems behind every answer.
                  </DialogPrimitive.Description>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close"
                className="mt-0.5 size-8 shrink-0 rounded-full"
                onClick={onClose}
              >
                <X className="size-4" />
              </Button>
            </header>

            {/* 2. The ask bar, always on top. The conversation opens beside
                the graph only after the first question is asked. */}
            <div
              className={cn(
                'mx-auto w-full max-w-[1120px] shrink-0 px-4 md:px-8',
                focused && 'hidden',
              )}
            >
              <form
                onSubmit={submitAsk}
                className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2 [box-shadow:var(--shadow-floating)]"
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-600)]"
                >
                  <SparkleMark className="size-4" />
                </span>
                <input
                  ref={inputRef}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask your Practice Brain..."
                  aria-label="Ask your Practice Brain"
                  className="h-9 min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-[color:var(--ink-3)]"
                />
                {asking ? (
                  <button
                    type="button"
                    onClick={stopAsk}
                    aria-label="Stop answering"
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-medium text-white transition-[filter,box-shadow] [background:var(--send-gradient)] [box-shadow:var(--shadow-send)] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
                  >
                    <Square className="size-3.5" /> Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={question.trim().length === 0}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-medium text-white transition-[filter,box-shadow] [background:var(--send-gradient)] [box-shadow:var(--shadow-send)] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)] disabled:opacity-85"
                  >
                    Ask the Brain <ArrowRight className="size-3.5" />
                  </button>
                )}
              </form>
            </div>

            {/* 3. The graph stays on the left; the conversation opens on the
                right once the first question has been asked. With no turns
                the graph owns the whole area, nothing else on screen. */}
            <div className="mt-3 flex min-h-0 flex-1 flex-col-reverse lg:flex-row-reverse">
              {turns.length > 0 && !focused ? (
                <aside
                  aria-label="Answers"
                  className="flex min-h-0 flex-col border-t border-border lg:w-[400px] lg:shrink-0 lg:border-l lg:border-t-0 xl:w-[440px]"
                >
                  <div className="flex shrink-0 items-center justify-between px-4 pt-3 md:px-6 lg:px-5">
                    <span className="text-[11px] uppercase tracking-wide text-[color:var(--ink-3)]">Answers</span>
                    <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-[11px]" onClick={clearTurns}>
                      Clear
                    </Button>
                  </div>

                <div className="max-h-[42dvh] min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-2 md:px-6 lg:max-h-none lg:px-5">
                  {turns.map((entry, index) => (
                    <section key={index} aria-label="Answer from the Practice Brain" className="space-y-1.5">
                      <p className="text-xs text-[color:var(--ink-3)]">{entry.question}</p>

                      {entry.withdrawn ? (
                        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs text-[color:var(--ink-2)]">
                          <TriangleAlert className="size-3.5 shrink-0 text-[oklch(var(--chart-4))]" />
                          This answer was withdrawn.
                        </div>
                      ) : (
                        <div className="rounded-xl border border-border bg-card px-3.5 py-3 [box-shadow:var(--shadow-raised)]">
                          <p className="whitespace-pre-wrap text-sm leading-6">
                            {entry.draft ||
                              (entry.status === 'streaming' ? (
                                <span className="text-[color:var(--ink-3)]">Reading the Brain...</span>
                              ) : (
                                ''
                              ))}
                          </p>
                        </div>
                      )}

                      {chipsFor(entry).length > 0 && !entry.withdrawn ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-[color:var(--ink-3)]">From the Brain</span>
                          {chipsFor(entry).map((chip) => (
                            <button
                              key={chip.id}
                              type="button"
                              title={chip.section ? `${chip.title} (${chip.section})` : chip.title}
                              onClick={() => focusDocument(chip.id)}
                              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-[color:var(--ink-2)] transition-colors hover:border-[color:var(--accent-border)] hover:text-[color:var(--accent-600)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
                            >
                              <FileText className="size-3 shrink-0" />
                              <span className="truncate">{chip.title}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {entry.status === 'done' && entry.flagged && !entry.withdrawn ? (
                        <p className="flex items-center gap-1.5 text-[11px] text-[color:var(--ink-3)]">
                          <TriangleAlert className="size-3 shrink-0 text-[oklch(var(--chart-4))]" />
                          {flagNote(entry.flagReason)}
                        </p>
                      ) : null}

                      {entry.status === 'stopped' ? (
                        <div className="flex items-center gap-3 text-[11px] text-[color:var(--ink-3)]">
                          <span>Stopped before the answer was complete.</span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 gap-1 px-2 text-[11px]"
                            onClick={() => void askBrain(entry.question)}
                          >
                            <RefreshCw className="size-3" /> Retry
                          </Button>
                        </div>
                      ) : null}

                      {entry.status === 'error' ? (
                        <div className="flex items-center gap-2 rounded-xl border border-destructive/40 px-3 py-2 text-xs text-destructive">
                          <Badge variant="destructive">Error</Badge>
                          <span className="min-w-0 flex-1">{entry.error}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                            onClick={() => void askBrain(entry.question)}
                          >
                            <RefreshCw className="size-3" /> Retry
                          </Button>
                        </div>
                      ) : null}
                    </section>
                  ))}
                </div>
              </aside>
              ) : null}

              {/* The graph, the hero, staying on the left. */}
              <div className="relative min-h-[300px] min-w-0 flex-1 lg:min-h-0">
                <BrainCanvas
                  ref={canvasRef}
                  graph={graph}
                  highlighted={highlighted}
                  selectedId={selectedId}
                  onSelectNode={selectNode}
                  practiceName={practiceName}
                  focus={focused}
                  onToggleFocus={toggleFocus}
                />
                {selectedDocument && selectedNode ? (
                  <DocumentPanel
                    document={selectedDocument}
                    node={selectedNode}
                    practiceName={practiceName}
                    onAskAbout={() => {
                      setQuestion(`What does the ${selectedDocument.title} say?`);
                      clearSelection();
                      inputRef.current?.focus();
                    }}
                    onOpen={onOpenDocument ? () => onOpenDocument(selectedDocument.title) : null}
                  />
                ) : null}
              </div>
            </div>
          </motion.div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}
