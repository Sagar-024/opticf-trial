/**
 * Queued sends: a finding put in a person's hands, kept as the record.
 *
 * Kept in this browser for the trial, like the tasks. The queue is real; the
 * pipe is the only missing piece, and it connects the day the platform has
 * accounts. The store mirrors the task store so both move server-side the
 * same way.
 */

export interface SendRecord {
  id: string;
  /** The dashboard's title, e.g. "North West performance". */
  title: string;
  /** The provenance line the figures arrived with. */
  sources: string[];
  recipient: string;
  recipientRole: string;
  /** When it was queued. */
  at: number;
}

const SENDS_KEY = 'opticf-sends-v1';
const listeners = new Set<() => void>();

export function listSends(): SendRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SENDS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return (parsed as SendRecord[]).slice().sort((a, b) => b.at - a.at);
  } catch {
    return [];
  }
}

function write(sends: SendRecord[]): void {
  try {
    window.localStorage.setItem(SENDS_KEY, JSON.stringify(sends.slice(0, 200)));
  } catch {
    // Storage unavailable; the record simply stops growing.
  }
  listeners.forEach((listener) => listener());
}

export function addSend(send: Omit<SendRecord, 'id' | 'at'>): SendRecord {
  const full: SendRecord = {
    ...send,
    id: `send-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
  };
  write([full, ...listSends()]);
  return full;
}

export function subscribeToSends(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** "15 Oct, 14:32" for the receipt line. */
export function sentAtLabel(at: number): string {
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
