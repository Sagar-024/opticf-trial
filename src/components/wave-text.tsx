'use client';

import { Fragment } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * Word wave: a line of text arrives as one wave of ink, each word rising out of
 * a soft blur a beat after the one before it. Used for page headings and their
 * support lines, so every surface opens the same way.
 *
 * Delays stay under 800ms in total, because the freeze safety net sweeps at
 * 800ms and must never catch a healthy animation mid flight. Reduced motion
 * renders the text plainly, and `data-anim` lets the safety net rescue words if
 * frames stop.
 */
export function WaveText({
  text,
  className,
  delay = 0,
  step = 24,
}: {
  text: string;
  className?: string;
  delay?: number;
  step?: number;
}) {
  const reduceMotion = useReducedMotion();
  const words = text.split(' ');
  if (reduceMotion) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {words.map((word, index) => (
        <Fragment key={`${index}-${word}`}>
          {index > 0 ? ' ' : null}
          <span data-anim className="wave-word" style={{ animationDelay: `${delay + index * step}ms` }}>
            {word}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
