import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addSend, listSends, sentAtLabel, subscribeToSends } from '../src/lib/send-store';

/**
 * The store reads and writes window.localStorage; the suite runs in node, so
 * every test gets a fresh in-memory window.
 */
function stubWindow(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  });
}

const report = {
  title: 'North West performance',
  sources: ['Monthly performance, Oct 2026'],
  recipient: 'Emma Lawson',
  recipientRole: 'North West lead',
};

beforeEach(stubWindow);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('send store', () => {
  it('queues a send and lists it newest first', () => {
    const first = addSend(report);
    const second = addSend({ ...report, recipient: 'Sara Kelly', recipientRole: 'group leadership' });
    expect(first.id).toMatch(/^send-/);
    expect(typeof first.at).toBe('number');
    expect(listSends().map((send) => send.id)).toEqual([second.id, first.id]);
  });

  it('keeps the figures, their sources and the recipient on the record', () => {
    addSend(report);
    const [queued] = listSends();
    expect(queued.title).toBe('North West performance');
    expect(queued.sources).toEqual(['Monthly performance, Oct 2026']);
    expect(queued.recipient).toBe('Emma Lawson');
    expect(queued.recipientRole).toBe('North West lead');
  });

  it('notifies subscribers on every write', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToSends(() => seen.push(listSends().length));
    addSend(report);
    addSend(report);
    unsubscribe();
    expect(seen).toEqual([1, 2]);
  });

  it("labels the queue time in the reader's words", () => {
    expect(sentAtLabel(Date.now())).toMatch(/\d{1,2} \w{3}, \d{2}:\d{2}/);
  });
});
