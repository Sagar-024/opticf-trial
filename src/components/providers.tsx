'use client';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from './theme-provider';

/** App-wide client providers: theme and tooltips. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
