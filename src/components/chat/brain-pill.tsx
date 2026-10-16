'use client';

import { useMemo } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { brainStats } from '@/brain/graph';
import { useBrainDocuments } from '@/lib/brain-store';

/**
 * The live status pill in the chat's footer. The words say what the tap does
 * (open the Practice Brain), and the numbers come from the real documents, so
 * an edit here or in another tab moves them immediately. The pill never
 * truncates: the counts fold away first on narrow windows.
 */
export function BrainPill({ onOpen }: { onOpen: () => void }) {
  const documents = useBrainDocuments();
  // Memoised on the documents identity: useBrainDocuments keeps that stable
  // while nothing changed, so this never recomputes on an unrelated render.
  const stats = useMemo(() => brainStats(documents), [documents]);

  const documentsLabel = `${stats.documents} document${stats.documents === 1 ? '' : 's'}`;
  const reviewLabel = `${stats.reviewDue} review${stats.reviewDue === 1 ? '' : 's'} due`;
  const aria = `Open your Practice Brain. ${documentsLabel}${
    stats.reviewDue > 0 ? `, ${reviewLabel}` : ''
  }.`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={aria}
      title="Open your Practice Brain"
      className="group inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-[color:var(--line)] bg-card py-1 pl-2.5 pr-2.5 text-[11px] text-[color:var(--ink-2)] transition-colors hover:border-[color:var(--line-strong)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
    >
      {/* The live dot: coral, with a quiet halo so "connected" reads at a glance. */}
      <span aria-hidden className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--coral)] opacity-30 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-[var(--coral)]" />
      </span>
      <span>Open your Practice Brain</span>
      {/* tabular-nums: a count change never nudges the row. The counts fold
          away on narrow windows, the words never do. */}
      <span className="hidden tabular-nums text-[color:var(--ink-3)] min-[560px]:inline">
        {documentsLabel}
      </span>
      {stats.reviewDue > 0 ? (
        <span className="hidden tabular-nums text-[var(--accent-600)] min-[700px]:inline">{reviewLabel}</span>
      ) : null}
      <ArrowUpRight aria-hidden className="size-3 shrink-0 text-[var(--accent-600)]" />
    </button>
  );
}
