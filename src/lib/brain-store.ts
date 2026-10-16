/**
 * The Brain's local state, saved in this browser.
 *
 * One reader and one writer for the storage key, so the Brain view, the chat
 * and the practice panel all agree on the same shape. The key keeps its v1
 * name on purpose: normalizeBrainState upgrades an old flat overrides record
 * in place, so edits saved before this feature survive.
 */

import { EMPTY_BRAIN_STATE, normalizeBrainState, type BrainDocument, type BrainState } from '@/content/brain';
import { plainDashes } from './text';

const STORAGE_KEY = 'opticf-brain-v1';

/** Stored text can predate the no-dashes rule; clean it on the way out. */
function plainDocument(document: BrainDocument): BrainDocument {
  return {
    ...document,
    title: plainDashes(document.title),
    owner: plainDashes(document.owner),
    scope: plainDashes(document.scope),
    content: plainDashes(document.content),
  };
}

export function readBrainState(): BrainState {
  if (typeof window === 'undefined') return EMPTY_BRAIN_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_BRAIN_STATE;
    const state = normalizeBrainState(JSON.parse(raw));
    return {
      overrides: Object.fromEntries(
        Object.entries(state.overrides).map(([id, override]) => [
          id,
          {
            ...override,
            ...(override.content !== undefined ? { content: plainDashes(override.content) } : {}),
            ...(override.owner !== undefined ? { owner: plainDashes(override.owner) } : {}),
          },
        ]),
      ),
      created: state.created.map(plainDocument),
    };
  } catch {
    return EMPTY_BRAIN_STATE;
  }
}

export function writeBrainState(state: BrainState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable; the edit lasts this session only.
  }
}
