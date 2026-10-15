/**
 * Automations, saved in this browser.
 *
 * Skills, runs, tasks and the activity ledger live in localStorage while
 * there is no backend. The shape is intentionally server-shaped: when a real
 * API arrives these functions are replaced and the view stays the same.
 */

import { defaultSkills } from '@/automations/catalog';
import type { ActivityEvent, AutomationTask, Skill, StoredRun } from '@/automations/types';

export interface AutomationsState {
  skills: Skill[];
  runs: StoredRun[];
  tasks: AutomationTask[];
  activity: ActivityEvent[];
}

const KEY = 'opticf-automations-v1';
export const AUTOMATIONS_CHANGED = 'opticf:automations-changed';

const MAX_RUNS = 12;
const MAX_TASKS = 60;
const MAX_ACTIVITY = 40;

const EMPTY: AutomationsState = { skills: [], runs: [], tasks: [], activity: [] };

export function readState(): AutomationsState {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<AutomationsState>;
    return {
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      activity: Array.isArray(parsed.activity) ? parsed.activity : [],
    };
  } catch {
    return EMPTY;
  }
}

function writeState(state: AutomationsState): void {
  if (typeof window === 'undefined') return;
  try {
    const capped: AutomationsState = {
      ...state,
      runs: state.runs.slice(0, MAX_RUNS),
      tasks: state.tasks.slice(0, MAX_TASKS),
      activity: state.activity.slice(0, MAX_ACTIVITY),
    };
    window.localStorage.setItem(KEY, JSON.stringify(capped));
    window.dispatchEvent(new Event(AUTOMATIONS_CHANGED));
  } catch {
    // Storage full or unavailable; the page still works for this session.
  }
}

/** First open: write the three seeded skills so the tab is alive. */
export function ensureSeeded(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(KEY)) return;
    writeState({ ...EMPTY, skills: defaultSkills() });
  } catch {
    // Unavailable storage: the view falls back to nothing rather than crashing.
  }
}

/**
 * One atomic change: read, transform, write, announce. Compound actions
 * (approve a hit = patch the run + create the task + write a ledger line)
 * belong in one call so the page renders once.
 */
export function mutateState(updater: (state: AutomationsState) => AutomationsState): void {
  writeState(updater(readState()));
}

export function subscribeToAutomations(onChange: () => void): () => void {
  const onLocal = () => onChange();
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) onChange();
  };
  window.addEventListener(AUTOMATIONS_CHANGED, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(AUTOMATIONS_CHANGED, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}

/** Wipe the activity ledger; skills, runs and tasks stay. */
export function clearActivity(): void {
  mutateState((state) => ({ ...state, activity: [] }));
}

/**
 * Back to a clean slate: the shipped skills, all on, and nothing in the
 * review inbox, the tasks or the ledger. For a fresh demo run.
 */
export function resetAutomations(): void {
  mutateState(() => ({ ...EMPTY, skills: defaultSkills() }));
}

export function automationId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
