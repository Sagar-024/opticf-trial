'use client';

import { motion } from 'framer-motion';
import { Map, MessageSquare, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Chat and Map are one feature with two faces: the conversation, and the
 * practice map it talks about. This segmented control sits in the centre of
 * the top bar while either face is open, so switching is one click and never
 * hidden behind a menu.
 *
 * The look follows the reference: a recessed track, and a raised card holding
 * the active face. The card slides between segments with the same spring as
 * the rail, so the whole app moves in one language.
 */

export type SwitcherView = 'chat' | 'map';

const VIEWS: Array<{ key: SwitcherView; label: string; icon: LucideIcon }> = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'map', label: 'Map', icon: Map },
];

export function ViewSwitcher({
  view,
  onChange,
}: {
  view: SwitcherView;
  onChange: (view: SwitcherView) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Switch between chat and map"
      className="inline-flex items-center gap-1 rounded-full border border-[color:var(--line)] bg-secondary p-1"
    >
      {VIEWS.map(({ key, label, icon: Icon }) => {
        const active = view === key;
        return (
          <motion.button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(key)}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            className={cn(
              'relative inline-flex h-7 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent-ring)]',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {/* One thumb slides between the two faces: fill and a single lit
                edge, no border of its own. */}
            {active ? (
              <motion.span
                layoutId="view-switcher-pill"
                className="absolute inset-0 rounded-full bg-[var(--thumb)] [box-shadow:var(--thumb-depth)]"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            ) : null}
            <Icon
              strokeWidth={active ? 1.75 : 1.5}
              className={cn('relative size-3.5 shrink-0', active && 'text-[var(--accent-text)]')}
            />
            <span className="relative">{label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
