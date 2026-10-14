'use client';

import type { PaletteKey } from '@/map/lenses';

/**
 * Resolves the theme's CSS variables into concrete colours for the canvas.
 * Read once per theme change, never inside the draw loop.
 */
export interface Palette {
  colors: Record<PaletteKey, string>;
  background: string;
  border: string;
  hubSurface: string;
  hubRing: string;
  label: string;
  labelStrong: string;
  dimOpacity: number;
}

function oklch(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = styles.getPropertyValue(name).trim();
  return `oklch(${value || fallback})`;
}

/**
 * The CSS variable each palette key reads from. The legend and the canvas both
 * resolve through this, so a swatch can never disagree with the node it labels.
 */
const TOKEN_OF: Record<PaletteKey, string> = {
  coral: '--coral',
  amber: '--chart-4',
  green: '--chart-3',
  blue: '--chart-2',
  ink: '--foreground',
  muted: '--muted-foreground',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
};

/** `oklch(var(--chart-1))` and friends: valid in any CSS value slot. */
export function tokenVarFor(key: PaletteKey): string {
  return TOKEN_OF[key];
}

export function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement);

  const color = (name: string, fallback: string) => oklch(styles, name, fallback);

  return {
    colors: {
      coral: color('--coral', '0.69 0.13 35'),
      amber: color('--chart-4', '0.68 0.08 76'),
      green: color('--chart-3', '0.58 0.04 171'),
      blue: color('--chart-2', '0.68 0.03 257'),
      ink: color('--foreground', '0.26 0.04 264'),
      muted: color('--muted-foreground', '0.57 0.02 278'),
      chart1: color('--chart-1', '0.69 0.13 36'),
      chart2: color('--chart-2', '0.68 0.03 257'),
      chart3: color('--chart-3', '0.58 0.04 171'),
      chart4: color('--chart-4', '0.68 0.08 76'),
      chart5: color('--chart-5', '0.26 0.04 264'),
    },
    background: color('--background', '0.98 0.02 85'),
    border: color('--border', '0.91 0.02 79'),
    hubSurface: color('--card', '0.99 0.01 85'),
    hubRing: color('--muted-foreground', '0.57 0.02 278'),
    label: color('--muted-foreground', '0.57 0.02 278'),
    labelStrong: color('--foreground', '0.26 0.04 264'),
    dimOpacity: 0.14,
  };
}
