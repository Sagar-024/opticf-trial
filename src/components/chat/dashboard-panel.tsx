'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Download, Mail, X } from 'lucide-react';
import type { Widget } from '@/ai/types';
import { Button } from '@/components/ui/button';
import { WidgetRenderer } from '@/components/widgets/widget-renderer';
import { forceVisibleIfStuck } from '@/lib/anim';
import { cn } from '@/lib/utils';

/**
 * The dashboard, on the side. The chat keeps its column, the BI opens beside
 * it, and the divider between them is draggable: hover the line and it shows
 * itself, drag it and the two columns trade space. The panel is the only thing
 * on the page when it is exported to PDF, buttons and notes included out.
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
}: {
  title: string;
  widgets: Widget[];
  /** Where the numbers come from; shown as a quiet line at the foot. */
  sources: string[];
  onClose: () => void;
}) {
  const [emailNote, setEmailNote] = useState(false);
  /** Shown after the first export: how to get a clean page out of the dialog. */
  const [printHint, setPrintHint] = useState(false);
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
      style={{ width: width ? `${width}px` : '44%' }}
      className="print-area relative flex h-full min-w-[360px] max-w-[760px] shrink-0 flex-col border-l border-border bg-card"
    >
      {/* The divider: quiet at rest, a line and a grip when you reach for it. */}
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
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => setEmailNote(true)}>
            <Mail className="size-3.5" />
            Email
          </Button>
          <button
            onClick={onClose}
            aria-label="Close dashboard"
            className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {emailNote ? (
        <p className="print-hide border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
          Email delivery connects when the email backend lands. Nothing is sent yet.
        </p>
      ) : null}

      {printHint ? (
        <p className="print-hide border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
          For a clean page, turn off Headers and footers in the print dialog. Chrome remembers it
          next time.
        </p>
      ) : null}

      <div className="print-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {widgets.map((widget) => (
          <WidgetRenderer
            key={widget.id}
            widget={widget}
            hideTitle={widget.type === 'kpi' && widget.title === title}
          />
        ))}
      </div>

      {sources.length > 0 ? (
        <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          From: {sources.join(' · ')}
        </p>
      ) : null}
    </motion.aside>
  );
}
