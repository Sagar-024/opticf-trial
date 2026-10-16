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

/** The shape of the prompt budget, so a caller may override single fields. */
export interface BrainRetrievalBudget {
  readonly limit: number;
  readonly contentChars: number;
  readonly totalChars: number;
}

/**
 * The prompt budget: four documents, capped each, capped in total. Deliberately
 * a plain typed object rather than an `as const` one: Partial over literal-typed
 * fields would only accept the exact same numbers, and callers must be able to
 * override a single field.
 */
export const BRAIN_RETRIEVAL_BUDGET: BrainRetrievalBudget = { limit: 4, contentChars: 1200, totalChars: 5000 };

/** Query terms: lowercased tokens longer than two characters, like the chat. */
function termsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2);
}

/** The search_brain score: title matches above section, scope and content. */
function scoreOf(document: BrainDocument, terms: readonly string[]): number {
  const title = document.title.toLowerCase();
  const section = document.section.toLowerCase();
  const scope = document.scope.toLowerCase();
  const content = document.content.toLowerCase();
  // Title matches matter most; body matches still count.
  return terms.reduce((total, term) => {
    let points = 0;
    if (title.includes(term)) points += 3;
    if (section.includes(term) || scope.includes(term)) points += 1;
    if (content.includes(term)) points += 1;
    return total + points;
  }, 0);
}

/** Word-bounded, case-insensitive presence, for practice ids and names. */
function mentionsWord(text: string, value: string): boolean {
  const needle = value.trim();
  if (needle.length === 0) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/** Which documents answer a query, in the order they should be shown. Scores
    title matches above section, scope and content matches; drops zero scores. */
export function rankDocuments(
  documents: readonly BrainDocument[],
  query: string,
  limit: number,
): BrainDocument[] {
  const terms = termsOf(query);
  return documents
    .map((document) => ({ document, score: scoreOf(document, terms) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.document.title.localeCompare(b.document.title))
    .slice(0, limit)
    .map((result) => result.document);
}

/** The full selection rule shared with search_brain: documents linked to a
    resolved practice first, then keyword matches, and a document scoped to a
    different practice never surfaces for this one. */
export function selectBrainDocuments(
  documents: readonly BrainDocument[],
  query: { text: string; practiceIds: readonly string[]; limit: number },
): BrainDocument[] {
  const { text, practiceIds, limit } = query;

  // Documents linked to the practice in question come first: when the model
  // asks about a specific practice, its recorded context outranks a generic
  // keyword hit. Keyword matches fill the remaining slots, but a document that
  // is scoped to other practices is never used to answer for this one.
  const linked = practiceIds.length > 0
    ? documents.filter((document) => (document.relatedPracticeIds ?? []).some((id) => practiceIds.includes(id)))
    : [];
  const matches = rankDocuments(documents, text, limit).filter((document) => {
    const links = document.relatedPracticeIds ?? [];
    if (links.length === 0) return true;
    if (practiceIds.length === 0) return true;
    return links.some((id) => practiceIds.includes(id));
  });

  const chosen: BrainDocument[] = [];
  for (const document of [...linked, ...matches]) {
    if (chosen.length >= limit) break;
    if (!chosen.some((existing) => existing.id === document.id)) chosen.push(document);
  }
  return chosen;
}

/** Practice ids named in the text, by id or by name, word-bounded. */
export function resolvePracticeIds(practices: readonly PracticeRef[], query: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const practice of practices) {
    if (seen.has(practice.id)) continue;
    if (mentionsWord(query, practice.id) || mentionsWord(query, practice.name)) {
      seen.add(practice.id);
      found.push(practice.id);
    }
  }
  return found;
}

/** A follow-up like "and Chorlton?" carries the previous question with it, so
    its practice names and terms still score. */
export function normalizeFollowUp(question: string, history: readonly AskHistoryTurn[]): string {
  const trimmed = question.trim();
  const lastUser = [...history].reverse().find((turn) => turn.role === 'user');
  const followUp = /^(and|what about|how about|those|them|it|that)\b/i.test(trimmed);
  if (lastUser && (trimmed.length < 24 || followUp)) {
    return `${lastUser.content.trim()} ${trimmed}`.trim();
  }
  return trimmed;
}

export function retrieve(
  documents: readonly BrainDocument[],
  question: string,
  history: readonly AskHistoryTurn[],
  practices: readonly PracticeRef[],
  budget?: Partial<typeof BRAIN_RETRIEVAL_BUDGET>,
): BrainRetrieval {
  const limit = budget?.limit ?? BRAIN_RETRIEVAL_BUDGET.limit;
  const contentChars = budget?.contentChars ?? BRAIN_RETRIEVAL_BUDGET.contentChars;
  const totalChars = budget?.totalChars ?? BRAIN_RETRIEVAL_BUDGET.totalChars;

  const query = normalizeFollowUp(question, history);
  // The question itself may name a practice even when the client forgets to.
  // Recent turns travel with it so a follow-up keeps the original scope.
  const lastUserTurns = history.filter((turn) => turn.role === 'user').slice(-2);
  const practiceIds = resolvePracticeIds(
    practices,
    [query, ...lastUserTurns.map((turn) => turn.content)].join('\n'),
  );
  const selection = selectBrainDocuments(documents, { text: query, practiceIds, limit });

  const terms = termsOf(query);
  let cut = 0;
  const results: RetrievedDocument[] = selection.map((document) => {
    if (document.content.length > contentChars) cut += 1;
    return {
      document,
      score: scoreOf(document, terms),
      promptContent: document.content.slice(0, contentChars),
    };
  });

  // Enforce the total by dropping the lowest ranked remaining document, over
  // and over, so the prompt can never outgrow its budget.
  let total = results.reduce((sum, result) => sum + result.promptContent.length, 0);
  let dropped = 0;
  while (total > totalChars && results.length > 0) {
    let lowest = results.length - 1;
    for (let index = results.length - 2; index >= 0; index -= 1) {
      if (results[index].score < results[lowest].score) lowest = index;
    }
    total -= results[lowest].promptContent.length;
    results.splice(lowest, 1);
    dropped += 1;
  }

  return { query, documents: results, practiceIds, truncated: dropped + cut };
}

/** Cited ids present in an answer, filtered against what retrieval returned,
    so an invented [id] can never become a chip. */
export function citedDocumentIds(text: string, knownIds: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[([a-z0-9][a-z0-9-]*)\]/gi)) {
    const id = match[1];
    if (seen.has(id) || !knownIds.has(id)) continue;
    seen.add(id);
    found.push(id);
  }
  return found;
}
