/**
 * Rail decoration from the reference: a soft glow in the top corner and large
 * flowing peach waves along the bottom. Purely decorative, clipped by the rail,
 * kept at low opacity so controls always read on top. Tune the opacities here.
 */
export function RailLeaves({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 0% 0%, oklch(var(--coral) / 0.08), transparent 55%)',
        }}
      />
      <svg
        viewBox="0 0 240 300"
        fill="none"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-x-0 bottom-0 h-72 w-full"
      >
        {/* Back wave, the quietest layer. */}
        <path
          d="M0 175 C 70 145, 150 132, 240 150 L 240 300 L 0 300 Z"
          className="fill-coral opacity-[0.10] dark:opacity-[0.07]"
        />
        {/* The big smooth petal sweeping up from the corner. */}
        <path
          d="M6 300 C 28 212, 88 150, 150 98 C 186 158, 206 240, 200 300 Z"
          className="fill-coral opacity-[0.12] dark:opacity-[0.08]"
        />
        {/* Mid wave. */}
        <path
          d="M0 238 C 62 204, 132 188, 240 206 L 240 300 L 0 300 Z"
          className="fill-coral opacity-[0.14] dark:opacity-[0.10]"
        />
        {/* Front wave, closest to the viewer. */}
        <path
          d="M0 276 C 82 246, 162 236, 240 252 L 240 300 L 0 300 Z"
          className="fill-coral opacity-[0.18] dark:opacity-[0.12]"
        />
      </svg>
    </div>
  );
}
