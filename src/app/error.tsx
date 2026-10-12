'use client';

import { Button } from '@/components/ui/button';

/** Route level error fallback. Keeps the shell usable if a page throws. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="label-caps">Something went wrong</p>
      <h1 className="text-xl font-semibold">This view could not be rendered</h1>
      <p className="text-sm text-muted-foreground">
        {error.message || 'An unexpected error occurred.'}
        {error.digest ? ` (${error.digest})` : ''}
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
