'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Theme provider. Light is the default, so a first visit opens on the white
 * canvas; the toggle still switches to dark and next-themes persists the
 * choice. `disableTransitionOnChange` keeps switching from animating every
 * colour, and the class is applied before paint, so there is no flash of the
 * wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
