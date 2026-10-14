import { cn } from '@/lib/utils';

/**
 * Rail decoration from the reference: large flowing peach waves along the
 * bottom. Purely decorative, clipped by the rail, kept at low opacity so
 * controls always read on top. Light theme only: on black the corner stays
 * clean, so the waves disappear in dark. Tune the opacities here.
 */
export function RailLeaves({ className }: { className?: string }) {
  return (
    <div className={cn(className, 'dark:hidden')} aria-hidden="true">
      <svg
        viewBox="0 0 240 300"
        fill="none"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-x-0 bottom-0 h-72 w-full fill-[color:var(--rail-wave)]"
      >
        {/* Back wave, the quietest layer. */}
        <path
          d="M0 175 C 70 145, 150 132, 240 150 L 240 300 L 0 300 Z"
          className="opacity-[0.10]"
        />
        {/* The big smooth petal sweeping up from the corner. */}
        <path
          d="M6 300 C 28 212, 88 150, 150 98 C 186 158, 206 240, 200 300 Z"
          className="opacity-[0.12]"
        />
        {/* Mid wave. */}
        <path
          d="M0 238 C 62 204, 132 188, 240 206 L 240 300 L 0 300 Z"
          className="opacity-[0.14]"
        />
        {/* Front wave, closest to the viewer. */}
        <path
          d="M0 276 C 82 246, 162 236, 240 252 L 240 300 L 0 300 Z"
          className="opacity-[0.18]"
        />
      </svg>
    </div>
  );
}
