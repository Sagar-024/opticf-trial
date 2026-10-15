/**
 * House style: no em or en dashes anywhere a reader can see.
 *
 * Text saved before the rule can still carry them, so the stores pass their
 * strings through this on the way out, which also means the next write heals
 * the stored copy. The model's own answers are sanitised separately, in the
 * chat pipeline.
 */
export function plainDashes(text: string): string {
  return text.replace(/\s*[\u2013\u2014]\s*/g, ' - ');
}
