'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, Maximize2, MoreHorizontal, Plus, Send, X } from 'lucide-react';
import type { Widget } from '@/ai/types';
import { AddToSheetDialog } from '@/components/chat/add-to-sheet-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WidgetRenderer } from '@/components/widgets/widget-renderer';
import { forceVisibleIfStuck } from '@/lib/anim';
import { LEADERSHIP } from '@/lib/people';
import { addSend, sentAtLabel, type SendRecord } from '@/lib/send-store';
import { cn } from '@/lib/utils';

/**
 * The dashboard, on the side. The chat keeps its column, the BI opens beside
 * it, and the divider between them is draggable: hover the line and it shows
 * itself, drag it and the two columns trade space. A dense chart is too cramped
 * for that column, so the panel takes the whole content area instead: the cross
 * and Escape return it to the side, exactly as it was. The panel is the only
 * thing on the page when it is exported to PDF, buttons and notes included out.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
/** The divider never squeezes either side past these. */
const PANEL_MIN = 360;
const PANEL_MAX = 760;
const CHAT_MIN = 360;

export function DashboardPanel({
  title,
  widgets,
  sources,
  onClose,
  full = false,
  onExitFull,
  onEnterFull,
}: {
  title: string;
  widgets: Widget[];
  /** Where the numbers come from; shown as a quiet line at the foot. */
  sources: string[];
  onClose: () => void;
  /** A dense chart opens the panel over the chat, filling the content area. */
  full?: boolean;
  /** The way back from full view: the cross and Escape both use it. */
  onExitFull?: () => void;
  /** The way in, for a reader who wants any dashboard full, dense or not. */
  onEnterFull?: () => void;
}) {
  const [sendOpen, setSendOpen] = useState(false);
  const [recipient, setRecipient] = useState(LEADERSHIP[0]?.name ?? '');
  const [receipt, setReceipt] = useState<SendRecord | null>(null);
  /** Shown after the first export: how to get a clean page out of the dialog. */
  const [printHint, setPrintHint] = useState(false);
  /** The chart singled out for export; while set, the panel prints it alone. */
  const [printWidget, setPrintWidget] = useState<Widget | null>(null);
  /** The chart being collected into a sheet, while its dialog is open. */
  const [sheetWidget, setSheetWidget] = useState<Widget | null>(null);
  /** A quiet line after a chart joins a sheet: "Added to Board pack". */
  const [sheetNote, setSheetNote] = useState<string | null>(null);
  /** Null means the default 44 percent; a number is a width the reader chose. */
  const [width, setWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ right: number; min: number; max: number } | null>(null);

  // Safety net for the entrance, same pattern as the rest of the app.
  useEffect(() => {
    const timer = window.setTimeout(() => forceVisibleIfStuck(panelRef.current), 700);
    return () => window.clearTimeout(timer);
  }, []);

  // A new answer is a new report: the last receipt belongs to the old one.
  useEffect(() => {
    setReceipt(null);
  }, [title]);

  // A single chart export prints after the chart is on the page: the state
  // alone would not have rendered by the time window.print() runs.
  useEffect(() => {
    if (!printWidget) return;
    let timer = 0;
    // The print render draws the chart fully on its first paint (no grow-in
    // wave), so a frame plus a beat is all the snapshot needs.
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        // Paper is light: flip a dark theme to light for the print, then restore.
        const root = document.documentElement;
        const wasDark = root.classList.contains('dark');
        if (wasDark) root.classList.remove('dark');
        window.print();
        if (wasDark) root.classList.add('dark');
        setPrintWidget(null);
      }, 150);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [printWidget]);

  // The sheet note is a moment, not a record: it clears itself.
  useEffect(() => {
    if (!sheetNote) return;
    const timer = window.setTimeout(() => setSheetNote(null), 5000);
    return () => window.clearTimeout(timer);
  }, [sheetNote]);

  // Escape leaves full view, the map's focus-mode pattern; a dialog on top
  // (Send) takes the key first and marks it handled.
  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onExitFull?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full, onExitFull]);

  function confirmSend(): void {
    const person = LEADERSHIP.find((candidate) => candidate.name === recipient) ?? LEADERSHIP[0];
    if (!person) return;
    setReceipt(addSend({ title, sources, recipient: person.name, recipientRole: person.role }));
    setSendOpen(false);
  }

  function exportPdf(): void {
    // Chrome's own header and footer (URL, date, page numbers) is a print
    // dialog setting, not something CSS can reach; the note below says how.
    setPrintHint(true);
    // Paper is light: flip a dark theme to light for the print, then restore.
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    if (wasDark) root.classList.remove('dark');
    window.print();
    if (wasDark) root.classList.add('dark');
  }

  /** Export one chart through the same print path as the whole panel. */
  function exportChart(widget: Widget): void {
    setPrintHint(true);
    setPrintWidget(widget);
  }

  /** The widest this panel may go before the chat hits its own floor. */
  function maxWidth(): number {
    const parent = panelRef.current?.parentElement;
    if (!parent) return PANEL_MAX;
    return Math.max(PANEL_MIN, Math.min(PANEL_MAX, parent.getBoundingClientRect().width - CHAT_MIN));
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = { right: rect.right, min: PANEL_MIN, max: maxWidth() };
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a nicety; dragging still works over the handle.
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const next = Math.min(drag.max, Math.max(drag.min, drag.right - event.clientX));
    setWidth(next);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>): void {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The capture was already released; nothing to undo.
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  function onHandleKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const base = width ?? panelRef.current?.getBoundingClientRect().width ?? PANEL_MIN;
    const next = event.key === 'ArrowLeft' ? base + 24 : base - 24;
    setWidth(Math.min(maxWidth(), Math.max(PANEL_MIN, next)));
  }

  return (
    <motion.aside
      ref={panelRef}
      data-anim
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.28, ease: EASE }}
      aria-label="Dashboard"
      style={full ? undefined : { width: width ? `${width}px` : '44%' }}
      className={cn(
        'print-area relative flex h-full flex-col bg-card',
        full ? 'min-w-0 flex-1' : 'min-w-[360px] max-w-[760px] shrink-0 border-l border-border',
      )}
    >
      {/* The divider: quiet at rest, a line and a grip when you reach for it.
          Full view has no chat column to trade space with. */}
      {full ? null : (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize dashboard"
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => setWidth(null)}
          onKeyDown={onHandleKey}
          className="group absolute inset-y-0 left-0 z-20 w-2 -translate-x-1/2 cursor-col-resize focus-visible:outline-none"
        >
          <span
            aria-hidden
            className={cn(
              'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors',
              dragging ? 'bg-[var(--accent-500)]' : 'bg-transparent group-hover:bg-[var(--accent-500)] group-focus-visible:bg-[var(--accent-500)]',
            )}
          />
          <span
            aria-hidden
            className={cn(
              'absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent-500)] transition-opacity',
              dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
            )}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <div className="print-hide ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-[11px]"
            onClick={exportPdf}
            title="For a clean page, turn off Headers and footers in the print dialog"
          >
            <Download className="size-3.5" />
            Export PDF
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => setSendOpen(true)}>
            <Send className="size-3.5" />
            Send
          </Button>
          {/* Full view swaps the close for a way back to the chat, where the
              panel waits on the side as it was. */}
          {full ? (
            <button
              onClick={onExitFull}
              aria-label="Back to chat"
              title="Back to chat (Esc)"
              className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : (
            <>
              <button
                onClick={onEnterFull}
                aria-label="Expand to full view"
                title="Expand to full view"
                className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                <Maximize2 className="size-4" />
              </button>
              <button
                onClick={onClose}
                aria-label="Close dashboard"
                className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {receipt ? (
        <p className="print-hide border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
          Queued for <span className="font-medium text-foreground">{receipt.recipient}</span> ·{' '}
          {receipt.recipientRole} · {sentAtLabel(receipt.at)}. Delivery connects when the platform
          has accounts; nothing is sent yet.
        </p>
      ) : null}

      {printHint ? (
        <p className="print-hide border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
          For a clean page, turn off Headers and footers in the print dialog. Chrome remembers it
          next time.
        </p>
      ) : null}

      {sheetNote ? (
        <p className="print-hide border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
          {sheetNote}
        </p>
      ) : null}

      <div className="print-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {printWidget ? (
          // The single-chart export: the one chart rides the panel's own
          // print container, so the path stays the same as Export PDF.
          <WidgetRenderer widget={printWidget} animateCharts={false} />
        ) : (
          widgets.map((widget) => (
            <div key={widget.id} className="group/chart relative">
              <WidgetRenderer
                widget={widget}
                hideTitle={widget.type === 'kpi' && widget.title === title}
              />
              {widget.type === 'chart' ? (
                <div className="print-hide absolute right-2 top-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label={`Options for ${widget.title}`}
                        className="grid size-7 cursor-pointer place-items-center rounded-md bg-card/90 text-muted-foreground transition-[opacity,color] hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="bottom" sideOffset={2}>
                      <DropdownMenuItem className="cursor-pointer" onSelect={() => exportChart(widget)}>
                        <Download />
                        Export this chart
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onSelect={() => {
                          // Open after the menu has fully closed: its scroll lock
                          // and the dialog's would otherwise interleave and leave
                          // the page untappable.
                          const chart = widget;
                          window.setTimeout(() => setSheetWidget(chart), 0);
                        }}
                      >
                        <Plus />
                        Add to task
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      {sources.length > 0 ? (
        <p
          className={cn(
            'border-t border-border px-4 py-2 text-[11px] text-muted-foreground',
            printWidget && 'print-hide',
          )}
        >
          From: {sources.join(' · ')}
        </p>
      ) : null}

      {/* Send: the finding, its sources and the date, put in a person's hands.
          The queue is real; the pipe connects when the platform has accounts. */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this report</DialogTitle>
            <DialogDescription>
              {title}
              {sources.length > 0 ? ` · From: ${sources.join(' · ')}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="label-caps mb-2 block">Send to</label>
              <Select value={recipient} onValueChange={setRecipient}>
                <SelectTrigger className="text-sm" aria-label="Send to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEADERSHIP.map((person) => (
                    <SelectItem key={person.name} value={person.name} className="text-xs">
                      {person.name} · {person.role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              The figures, their sources and today's date go with it. Delivery connects when the
              platform has accounts; nothing is sent yet.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setSendOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirmSend}>
              Queue for {recipient.split(' ')[0]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Collect one chart into a sheet; the note above says where it went. */}
      <AddToSheetDialog
        open={Boolean(sheetWidget)}
        onOpenChange={(open) => {
          if (!open) setSheetWidget(null);
        }}
        chart={sheetWidget ? { title: sheetWidget.title, widget: sheetWidget } : null}
        onAdded={(sheetName) => setSheetNote(`Added to ${sheetName}. Find it under Sheets in Tasks.`)}
      />
    </motion.aside>
  );
}
