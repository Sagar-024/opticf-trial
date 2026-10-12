'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Keeps one broken widget from taking down the whole chat. If a widget throws
 * during render we show a small inline notice instead of a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
            This part of the answer could not be displayed. The numbers above are unaffected.
          </div>
        )
      );
    }
    return this.props.children;
  }
}
