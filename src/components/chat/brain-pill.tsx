'use client';

import { useMemo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { brainStats } from '@/brain/graph';
import { useBrainDocuments } from '@/lib/brain-store';

/**
 * The live status pill in the chat's footer: the Brain is connected, and the
 * numbers come from the real documents. Reads the same store as the overlay,
 * so an edit (here or in another tab) moves the count immediately.
 */
export function BrainPill({ onOpen }: { onOpen: () => void }) {
  const documents = useBrainDocuments();
  // Memoised on the documents identity: useBrainDocuments keeps that stable
  // while nothing changed, so this never recomputes on an unrelated render.
  const stats = useMemo(() => brainStats(documents), [documents]);

  const aria = `Connected to your Practice Brain. ${stats.documents} document${
    stats.documents === 1 ? '' : 's'
  }${stats.reviewDue > 0 ? `, ${stats.reviewDue} review${stats.reviewDue === 1 ? '' : 's'} due` : ''}. Open the Practice Brain.`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={aria}
      title="Open your Practice Brain"
      className="group inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-[color:var(--line)] bg-card py-1 pl-2.5 pr-2 text-[11px] text-[color:var(--ink-2)] transition-colors hover:border-[color:var(--line-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
    >
      {/* The live dot: coral, with a quiet halo so "connected" reads at a glance. */}
      <span aria-hidden className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--coral)] opacity-30 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-[var(--coral)]" />
      </span>
      <span className="min-w-0 truncate whitespace-nowrap">
        <span className="hidden min-[420px]:inline">Connected to your </span>Practice Brain
      </span>
      {/* tabular-nums: a count change never nudges the row. Under ~420px the
          counts fold away with the long text, so the row can never overflow. */}
      <span className="hidden whitespace-nowrap tabular-nums text-[color:var(--ink-3)] min-[420px]:inline">
        {stats.documents} documents
      </span>
      {stats.reviewDue > 0 ? (
        <span className="hidden whitespace-nowrap tabular-nums text-[color:var(--accent-600)] min-[480px]:inline">
          {stats.reviewDue} review due
        </span>
      ) : null}
      <ArrowUpRight aria-hidden className="size-3 shrink-0 text-[color:var(--accent-600)]" />
    </button>
  );
}
