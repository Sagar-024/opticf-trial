'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import { ArrowLeft, X } from 'lucide-react';
import type { CompareView } from '@/compare/model';
import { CompareExplain, PracticeCompare } from '@/components/compare/practice-compare';
import { forceVisibleIfStuck } from '@/lib/anim';

/**
 * The comparison page.
 *
 * The same shape as the practice page: it opens over the graph, in place of
 * it, and the map waits exactly as it was one press away. The page uses the
 * width it is given, and keeps Explain in its own header, on the right, where
 * a page-level action belongs; the panel it opens still arrives under the
 * graphic inside the card.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** Calm entrance: the page eases in, then the card follows. */
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
};

/** The nudge while the first practice is waiting for its partner. */
export function CompareHint({ firstName, onCancel }: { firstName: string; onCancel: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-border bg-card/95 py-1.5 pl-4 pr-2 [box-shadow:var(--shadow-floating)] backdrop-blur">
        <span className="truncate text-xs text-muted-foreground">
          Pick a practice to compare with <span className="font-medium text-foreground">{firstName}</span>
        </span>
        <button
          onClick={onCancel}
          className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

export function ComparePanel({
  view,
  onRemove,
  onClose,
  onOpenBrain,
  onAsk,
}: {
  view: CompareView;
  /** Drop a practice from the comparison; under two the page closes. */
  onRemove: (practiceId: string) => void;
  /** Back to the map, with the set still lit. */
  onClose: () => void;
  onOpenBrain?: (documentTitle: string) => void;
  /** Hands the set to the assistant for the written explanation. */
  onAsk?: (practiceIds: string[]) => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);

  // Safety net for the entrance: if the tab was hidden while this mounted, the
  // page must never stay invisible. Same pattern as the practice page.
  useEffect(() => {
    const timer = window.setTimeout(() => forceVisibleIfStuck(panelRef.current), 700);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <motion.section
      ref={panelRef}
      data-anim
      initial={{ y: 14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.28, ease: EASE }}
      aria-label={`Compare ${view.sides.map((side) => side.name).join(', ')}`}
      className="flex min-h-0 flex-1 flex-col bg-card"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <motion.div variants={stagger} initial="hidden" animate="show" className="mx-auto w-full max-w-4xl px-8 py-6">
          {/* The page's own row: who, when, and the two page actions. */}
          <motion.div variants={fadeUp} data-anim className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Map
            </button>
            <h2 className="text-lg font-semibold tracking-tight">Compare practices</h2>
            <span className="text-xs text-muted-foreground">{view.monthLabel}</span>
            <button
              onClick={onClose}
              aria-label="Back to map"
              className="ml-auto grid size-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </motion.div>

          {/* The card is the graphic; Explain sits on its bottom edge and the
              explanation is its own block directly below. */}
          <motion.div
            variants={fadeUp}
            data-anim
            className="surface-3d mt-5 rounded-xl border border-border bg-card p-5"
          >
            <PracticeCompare view={view} onRemove={onRemove} />
          </motion.div>

          {/* The explanation is its own section: heading, oval control, block. */}
          <motion.div variants={fadeUp} data-anim className="mt-5">
            <CompareExplain
              view={view}
              open={explainOpen}
              onToggle={() => setExplainOpen((value) => !value)}
              onOpenBrain={onOpenBrain}
              onAsk={onAsk}
            />
          </motion.div>

          <motion.p variants={fadeUp} data-anim className="mt-3 text-[11px] text-muted-foreground">
            Tap practices on the map to add or remove them; pick which metrics sit under the lens above.
          </motion.p>
        </motion.div>
      </div>
    </motion.section>
  );
}
