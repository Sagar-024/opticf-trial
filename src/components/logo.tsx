/**
 * The Optific+ mark: a speech bubble with a lens aperture inside it.
 * Colours come from theme tokens, so it stays legible in light and dark mode.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 38" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className={className}>
      <path
        d="M20 3.2C10.7 3.2 3.2 9.7 3.2 17.7c0 4.4 2.3 8.3 5.8 10.9-.3 2.6-1.3 5-2.8 6.6 2.9-.4 5.5-1.6 7.5-3.3 1.9.6 4.1.9 6.3.9 9.3 0 16.8-6.5 16.8-14.5S29.3 3.2 20 3.2Z"
        className="fill-card stroke-foreground"
        strokeWidth={2.1}
        strokeLinejoin="round"
      />
      <circle cx="20" cy="17.6" r="7.6" className="fill-coral stroke-foreground" strokeWidth={2.1} />
      <circle cx="20" cy="17.6" r="3.1" className="fill-card stroke-foreground" strokeWidth={2.1} />
    </svg>
  );
}
