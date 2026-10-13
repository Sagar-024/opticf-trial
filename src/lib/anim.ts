/**
 * Safety net for entrance animations.
 *
 * Browsers freeze animation frames while a tab is in the background, and framer
 * motion (like any animation) needs frames to move an element from its initial
 * state to its final one. An element that starts at `opacity: 0` can therefore
 * be left invisible if the page loaded or rendered while hidden.
 *
 * This forces anything still hidden to its final state, so content is never
 * lost to a paused animation. Mark animated wrappers with `data-anim`. A
 * running CSS animation outranks inline styles, so it is cleared as well.
 */
export function forceVisibleIfStuck(root: ParentNode | null): number {
  if (!root) return 0;
  let fixed = 0;

  root.querySelectorAll<HTMLElement>('[data-anim]').forEach((element) => {
    const styles = getComputedStyle(element);
    if (Number(styles.opacity) < 0.9) {
      element.style.opacity = '1';
      element.style.transform = 'none';
      element.style.animation = 'none';
      element.style.filter = 'none';
      fixed += 1;
    }
  });

  return fixed;
}
