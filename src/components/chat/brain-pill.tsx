'use client';

import { useMemo } from 'react';
import { Brain } from 'lucide-react';
import { brainStats } from '@/brain/graph';
import { useBrainDocuments } from '@/lib/brain-store';

/**
 * The Brain entry in the composer bar, read at a glance: the icon says Brain
 * before the word does, and a review due shows in accent. The full status
 * (documents, reviews) lives in the label and title, so nothing is lost by
 * keeping the chip short.
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
      className="inline-flex h-10 w-[115px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-sm text-[color:var(--ink-2)] transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]"
    >
      <Brain aria-hidden className="size-4 shrink-0 text-[var(--coral)]" />
      <span>Brain</span>
    </button>
  );
}
