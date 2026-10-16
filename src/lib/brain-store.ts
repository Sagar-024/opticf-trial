/**
 * The Brain's local state, saved in this browser.
 *
 * One reader and one writer for the storage key, so the Brain view, the chat
 * and the practice panel all agree on the same shape. The key keeps its v1
 * name on purpose: normalizeBrainState upgrades an old flat overrides record
 * in place, so edits saved before this feature survive.
 */

import { useSyncExternalStore } from 'react';
import { EMPTY_BRAIN_STATE, mergeBrainDocuments, normalizeBrainState, type BrainDocument, type BrainState } from '@/content/brain';
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
    // The same tab never fires a storage event, so the snapshot cache is
    // refreshed here and listeners are told by hand.
    cachedRaw = null;
    cachedState = null;
    cachedDocuments = null;
    notify();
  } catch {
    // Storage unavailable; the edit lasts this session only.
  }
}

/**
 * Live view of the stored Brain, for the pill and the overlay. The snapshot is
 * memoised on the raw stored string: useSyncExternalStore requires the same
 * object back while nothing changed, or it re-renders forever.
 */
const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedState: BrainState | null = null;
let cachedDocuments: BrainDocument[] | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function storageHandler(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  cachedRaw = null;
  cachedState = null;
  cachedDocuments = null;
  notify();
}

export function subscribeToBrain(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== 'undefined' && listeners.size === 1) {
    window.addEventListener('storage', storageHandler);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined' && listeners.size === 0) {
      window.removeEventListener('storage', storageHandler);
    }
  };
}

/** The stored state, re-read only when the raw string changed. */
export function getBrainSnapshot(): BrainState {
  if (typeof window === 'undefined') return EMPTY_BRAIN_STATE;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw && cachedState) return cachedState;
  cachedRaw = raw;
  cachedState = readBrainState();
  cachedDocuments = null;
  return cachedState;
}

/** The merged documents behind every Brain surface. */
export function getBrainDocuments(): BrainDocument[] {
  const state = getBrainSnapshot();
  if (!cachedDocuments) cachedDocuments = mergeBrainDocuments(state);
  return cachedDocuments;
}

/** Server render: the shipped guidance, so hydration matches. */
const SERVER_DOCUMENTS = mergeBrainDocuments(EMPTY_BRAIN_STATE);
function getServerDocuments(): BrainDocument[] {
  return SERVER_DOCUMENTS;
}

/** Live merged documents: re-renders on an edit here or in another tab. */
export function useBrainDocuments(): BrainDocument[] {
  return useSyncExternalStore(subscribeToBrain, getBrainDocuments, getServerDocuments);
}
