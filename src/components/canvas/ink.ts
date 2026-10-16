/**
 * Small ink helpers shared by the canvas renderers.
 *
 * Extracted from the map canvas with no behavior change: the initials that go
 * inside a large node, and a rough lightness read used to pick letter
 * contrast against a disc fill.
 */

/** First two letters of a name, for the mark inside a large node. */
export function initialsOf(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, '');
  return letters.length >= 2 ? letters.slice(0, 2) : letters || '?';
}

/** Rough lightness of an oklch() string, used to pick letter contrast. */
export function oklchLightness(color: string): number {
  const match = color.match(/oklch\(\s*([\d.]+)/);
  return match ? Number(match[1]) : 0.5;
}
