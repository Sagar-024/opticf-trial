/**
 * Chat sessions, saved in this browser.
 *
 * There is no backend for history yet, so sessions live in localStorage. The
 * shape is intentionally server-shaped: when a real API arrives, these functions
 * are replaced and every caller (the rail list, the chat view) stays the same.
 */

/** One entry of a run's live thinking trace, kept so the settled record can
 *  show the real reasoning and what each step found. */
export type StoredTraceEntry =
  | { kind: 'reasoning'; text: string }
  | { kind: 'step'; name: string; detail?: string; items?: string[] };

export interface StoredTurn {
  role: 'user' | 'assistant';
  text: string;
  widgets: unknown[];
  mapHighlight: string[];
  sources: string[];
  tools?: string[];
  /** The run's real thinking, so the settled trace can replay it after reload. */
  trace?: StoredTraceEntry[];
  /** How long the run worked before the first words; drives the settled trace summary. */
  thinkingMs?: number;
  flagged?: boolean;
  flagReason?: 'leak' | 'ungrounded' | 'numbers' | null;
  withdrawn?: boolean;
  stopped?: boolean;
  interrupted?: boolean;
  /** The reader's verdict on this answer: kept in the browser for review. */
  feedback?: 'up' | 'down';
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: StoredTurn[];
  /** The conversation context the server gave back for this thread. */
  context?: unknown;
  /** Pinned threads stay at the top of the rail, above the day groups. */
  pinned?: boolean;
  pinnedAt?: number;
}

const KEY = 'opticf-chats-v1';
/** The single-thread key this feature replaced; imported once, then removed. */
const LEGACY_KEY = 'opticf-chat-v1';
const MAX_SESSIONS = 30;

export const CHATS_CHANGED = 'opticf:chats-changed';

function readAll(): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatSession[]) : [];
  } catch {
    return [];
  }
}

function writeAll(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(sessions));
    window.dispatchEvent(new Event(CHATS_CHANGED));
  } catch {
    // Storage full or unavailable; history simply stops growing.
  }
}

/** Newest first. */
export function listSessions(): ChatSession[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id: string): ChatSession | null {
  return readAll().find((session) => session.id === id) ?? null;
}

export function upsertSession(session: ChatSession): void {
  const all = readAll().filter((s) => s.id !== session.id);
  all.push(session);
  writeAll(all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS));
}

export function newSessionId(): string {
  return 'chat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Rate one answer. Written onto the turn so the verdict survives reloads and
 * reaches the review inbox when the backend arrives. `null` clears it.
 */
export function setTurnFeedback(id: string, turnIndex: number, feedback: 'up' | 'down' | null): void {
  const session = getSession(id);
  if (!session) return;
  const turns = session.turns.map((turn, index) =>
    index === turnIndex ? { ...turn, feedback: feedback ?? undefined } : turn,
  );
  // updatedAt is deliberately untouched: rating an old answer must not bump
  // the thread back to the top of the rail.
  upsertSession({ ...session, turns });
}

/** Give a thread a human name. Empty titles are ignored. */
export function renameSession(id: string, title: string): void {
  const clean = title.trim();
  if (!clean) return;
  const session = getSession(id);
  if (!session) return;
  // updatedAt is untouched: naming a thread must not reorder the rail.
  upsertSession({ ...session, title: clean });
}

/** Pin or unpin a thread. Pins float to the top, newest pin first. */
export function setSessionPinned(id: string, pinned: boolean): void {
  const session = getSession(id);
  if (!session) return;
  upsertSession({ ...session, pinned, pinnedAt: pinned ? Date.now() : undefined });
}

/** Remove a thread for good. The caller may keep the object for an undo. */
export function deleteSession(id: string): void {
  writeAll(readAll().filter((session) => session.id !== id));
}

/** A readable title from the first question; long ones cut at a word. */
export function titleFromQuestion(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 46) return clean;
  const cut = clean.slice(0, 46);
  const space = cut.lastIndexOf(' ');
  return (space > 24 ? cut.slice(0, space) : cut).trim();
}

/** Bring an old single-thread save into the session list, exactly once. */
export function migrateLegacy(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { turns?: StoredTurn[]; context?: unknown };
    if (Array.isArray(parsed.turns) && parsed.turns.length > 0) {
      const firstUser = parsed.turns.find((turn) => turn?.role === 'user');
      const now = Date.now();
      const all = readAll();
      all.push({
        id: newSessionId(),
        title: firstUser ? titleFromQuestion(firstUser.text) : 'Earlier chat',
        createdAt: now,
        updatedAt: now,
        turns: parsed.turns,
        context: parsed.context ?? null,
      });
      writeAll(all);
    }
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Unreadable legacy data is left alone rather than crashed on.
  }
}

/** Fires on every save in this tab, and on saves from other tabs. */
export function subscribeToChats(onChange: () => void): () => void {
  const onLocal = () => onChange();
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) onChange();
  };
  window.addEventListener(CHATS_CHANGED, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHATS_CHANGED, onLocal);
    window.removeEventListener('storage', onStorage);
  };
}

/** The groups the rail shows, matching the reference layout. Pinned threads
 * come first, newest pin first; the rest fall into day buckets, with anything
 * older than yesterday kept reachable under "Earlier". */
export function groupSessions(sessions: ChatSession[]): {
  pinned: ChatSession[];
  today: ChatSession[];
  yesterday: ChatSession[];
  earlier: ChatSession[];
} {
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const todayStart = startOfDay(new Date());
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const pinned: ChatSession[] = [];
  const today: ChatSession[] = [];
  const yesterday: ChatSession[] = [];
  const earlier: ChatSession[] = [];
  for (const session of sessions) {
    if (session.pinned) pinned.push(session);
    else if (session.updatedAt >= todayStart) today.push(session);
    else if (session.updatedAt >= yesterdayStart) yesterday.push(session);
    else earlier.push(session);
  }
  pinned.sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  return { pinned, today, yesterday, earlier };
}
