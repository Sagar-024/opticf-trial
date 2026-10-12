'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Theme provider. System default, manual override persisted by next-themes,
 * and `disableTransitionOnChange` so switching does not animate every colour.
 * The class is applied before paint, so there is no flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
