/**
 * Retrieval for the Practice Brain: which documents answer a question, in
 * order, as data.
 *
 * The chat's search_brain tool and the overlay's ask surface both rank through
 * here, so the same corpus can never rank two ways. Pure and client-safe: the
 * overlay imports citedDocumentIds to map citations back to nodes.
 */

import type { BrainDocument } from '@/content/brain';

export interface PracticeRef {
  id: string;
  name: string;
}

export interface AskHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface RetrievedDocument {
  document: BrainDocument;
  score: number;
  /** The capped text that goes into the prompt, never the whole document. */
  promptContent: string;
}

export interface BrainRetrieval {
  /** The normalized query that was actually scored. */
  query: string;
  documents: RetrievedDocument[];
  /** Practice ids the question resolved to, from ids or from names. */
  practiceIds: string[];
  /** Documents dropped or shortened to stay inside the prompt budget. */
  truncated: number;
}

/** The prompt budget: four documents, capped each, capped in total. */
export const BRAIN_RETRIEVAL_BUDGET = { limit: 4, contentChars: 1200, totalChars: 5000 } as const;

/** Which documents answer a query, in the order they should be shown. Scores
    title matches above section, scope and content matches; drops zero scores. */
export function rankDocuments(
  documents: readonly BrainDocument[],
  query: string,
  limit: number,
): BrainDocument[] {
  throw new Error('not implemented');
}

/** The full selection rule shared with search_brain: documents linked to a
    resolved practice first, then keyword matches, and a document scoped to a
    different practice never surfaces for this one. */
export function selectBrainDocuments(
  documents: readonly BrainDocument[],
  query: { text: string; practiceIds: readonly string[]; limit: number },
): BrainDocument[] {
  throw new Error('not implemented');
}

/** Practice ids named in the text, by id or by name, word-bounded. */
export function resolvePracticeIds(practices: readonly PracticeRef[], query: string): string[] {
  throw new Error('not implemented');
}

/** A follow-up like "and Chorlton?" carries the previous question with it, so
    its practice names and terms still score. */
export function normalizeFollowUp(question: string, history: readonly AskHistoryTurn[]): string {
  throw new Error('not implemented');
}

export function retrieve(
  documents: readonly BrainDocument[],
  question: string,
  history: readonly AskHistoryTurn[],
  practices: readonly PracticeRef[],
  budget?: Partial<typeof BRAIN_RETRIEVAL_BUDGET>,
): BrainRetrieval {
  throw new Error('not implemented');
}

/** Cited ids present in an answer, filtered against what retrieval returned,
    so an invented [id] can never become a chip. */
export function citedDocumentIds(text: string, knownIds: ReadonlySet<string>): string[] {
  throw new Error('not implemented');
}
