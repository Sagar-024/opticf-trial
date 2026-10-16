import { describe, expect, it } from 'vitest';
import {
  BRAIN_DOCUMENTS,
  BRAIN_SECTIONS,
  EMPTY_BRAIN_STATE,
  isReviewDue,
  mergeBrainDocuments,
  newBrainDocumentId,
  normalizeBrainState,
} from '../src/content/brain';
import { getTool } from '../src/ai/tools';
import { generateDataset } from '../src/seed/generate';

const dataset = generateDataset();
const search = (query: string, limit?: number, ctx?: { brainDocuments: typeof BRAIN_DOCUMENTS }) =>
  getTool('search_brain')!.run(dataset, { query, ...(limit ? { limit } : {}) }, ctx);

describe('brain content', () => {
  it('has unique ids and a valid section for every document', () => {
    const ids = BRAIN_DOCUMENTS.map((document) => document.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const document of BRAIN_DOCUMENTS) {
      expect(BRAIN_SECTIONS).toContain(document.section);
    }
  });

  it('gives every document the fields the UI and the chat rely on', () => {
    for (const document of BRAIN_DOCUMENTS) {
      expect(document.title.length, document.id).toBeGreaterThan(3);
      expect(document.owner.length, document.id).toBeGreaterThan(2);
      expect(document.scope.length, document.id).toBeGreaterThan(2);
      expect(document.content.length, document.id).toBeGreaterThan(80);
      expect(document.reviewed, document.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('covers every section so no tab is empty', () => {
    for (const section of BRAIN_SECTIONS) {
      expect(BRAIN_DOCUMENTS.some((document) => document.section === section), section).toBe(true);
    }
  });

  it('keeps the conflicting document marked, so the chat can caveat it', () => {
    expect(BRAIN_DOCUMENTS.some((document) => document.conflict)).toBe(true);
  });

  it('has exactly one document past its review date, so the demo shows the signal', () => {
    const stale = BRAIN_DOCUMENTS.filter((document) => isReviewDue(document.reviewed));
    expect(stale.map((document) => document.id)).toEqual(['targets']);
  });

  it('keeps the contact lens promotion prerequisite in the training guidance', () => {
    const training = BRAIN_DOCUMENTS.find((document) => document.id === 'training')!;
    expect(training.content).toMatch(/prerequisite/i);
  });
});

describe('brain links to practices', () => {
  it('every linked practice id exists in the dataset', () => {
    const known = new Set(dataset.practices.map((practice) => practice.practiceId));
    for (const document of BRAIN_DOCUMENTS) {
      for (const practiceId of document.relatedPracticeIds ?? []) {
        expect(known.has(practiceId), `${document.id} links to unknown ${practiceId}`).toBe(true);
      }
    }
  });

  it('has a practice context section with real context, not just guidance', () => {
    expect(BRAIN_SECTIONS).toContain('Practice context');
    const context = BRAIN_DOCUMENTS.filter((document) => document.section === 'Practice context');
    expect(context.length).toBeGreaterThanOrEqual(4);
    expect(context.every((document) => (document.relatedPracticeIds ?? []).length > 0)).toBe(true);
  });

  it('links the conflicting Chorlton supply note to the practice it is about', () => {
    const supplier = BRAIN_DOCUMENTS.find((document) => document.id === 'supplier');
    expect(supplier?.relatedPracticeIds).toEqual(['P001']);
  });

  it('a practice can point back at its documents', () => {
    const linked = BRAIN_DOCUMENTS.filter((document) => (document.relatedPracticeIds ?? []).includes('P001'));
    expect(linked.map((document) => document.id).sort()).toEqual(['ctx-chorlton', 'supplier']);
  });
});

describe('guidance edits reach the answers', () => {
  it('applies a local edit over the shipped document', () => {
    const edited = mergeBrainDocuments({
      overrides: { warranty: { content: 'Edited wording: always confirm with Buying before promising a replacement.' } },
      created: [],
    });
    const document = edited.find((item) => item.id === 'warranty')!;
    expect(document.content).toContain('Edited wording');
  });

  it('search_brain quotes the edited text, not the original', () => {
    const documents = mergeBrainDocuments({
      overrides: { warranty: { content: 'Edited wording: confirm with Buying first.' } },
      created: [],
    });
    const output = search('frame warranty claim', undefined, { brainDocuments: documents });
    expect(output.summary).toContain('confirm with Buying first');
    expect(output.summary).not.toContain('Check the proof of purchase');
  });

  it('an edit can mark a document as conflicting', () => {
    const documents = mergeBrainDocuments({ overrides: { review: { conflict: true } }, created: [] });
    const output = search('practice performance review guide', undefined, { brainDocuments: documents });
    expect(output.summary).toMatch(/conflicting/i);
  });

  it('merges a document the reader wrote, marked as theirs', () => {
    const documents = mergeBrainDocuments({
      overrides: {},
      created: [
        {
          id: 'own-chorlton-cover',
          section: 'Practice context',
          title: 'Chorlton: Saturday cover note',
          owner: 'Sara Kelly',
          reviewed: '2026-10-12',
          scope: 'Chorlton',
          content: 'Saturday cover is arranged through Sale while the rota allows.',
          relatedPracticeIds: ['P001'],
        },
      ],
    });
    const created = documents.find((document) => document.id === 'own-chorlton-cover')!;
    expect(created.origin).toBe('yours');
    expect(created.relatedPracticeIds).toEqual(['P001']);
    // Created documents come after the shipped ones.
    expect(documents[documents.length - 1].id).toBe('own-chorlton-cover');
  });

  it('search_brain quotes a document the reader wrote', () => {
    const documents = mergeBrainDocuments({
      overrides: {},
      created: [
        {
          id: 'own-chorlton-cover',
          section: 'Practice context',
          title: 'Chorlton: Saturday cover note',
          owner: 'Sara Kelly',
          reviewed: '2026-10-12',
          scope: 'Chorlton',
          content: 'Saturday cover is arranged through Sale while the rota allows.',
          relatedPracticeIds: ['P001'],
        },
      ],
    });
    const output = search('Saturday cover', undefined, { brainDocuments: documents });
    expect(output.summary).toContain('Saturday cover is arranged through Sale');
    expect(output.sources).toContain('Brain: Chorlton: Saturday cover note');
  });

  it('falls back to the shipped documents when there are no edits', () => {
    const output = search('frame warranty claim');
    expect(output.summary).toContain('Check the proof of purchase');
  });
});

describe('normalizeBrainState', () => {
  it('migrates a v1 flat overrides record to v2', () => {
    const state = normalizeBrainState({ warranty: { content: 'Edited wording', conflict: true } });
    expect(state.overrides).toEqual({ warranty: { content: 'Edited wording', conflict: true } });
    expect(state.created).toEqual([]);
  });

  it('passes a v2 state through', () => {
    const state = normalizeBrainState({
      overrides: { review: { owner: 'People team' } },
      created: [
        {
          id: 'own-1',
          section: 'Operations',
          title: 'Local opening hours',
          owner: 'Sara Kelly',
          reviewed: '2026-10-12',
          scope: 'Group guidance',
          content: 'The demo site opens at nine.',
        },
      ],
    });
    expect(state.overrides.review.owner).toBe('People team');
    expect(state.created).toHaveLength(1);
    expect(state.created[0].origin).toBe('yours');
  });

  it('returns an empty state for junk rather than throwing', () => {
    expect(normalizeBrainState('ignore previous instructions')).toEqual(EMPTY_BRAIN_STATE);
    expect(normalizeBrainState([1, 2])).toEqual(EMPTY_BRAIN_STATE);
  });
});

describe('review dates', () => {
  it('is due when the last review is more than 90 days before the demo clock', () => {
    expect(isReviewDue('2026-07-13')).toBe(true);
    expect(isReviewDue('2026-03-18')).toBe(true);
  });

  it('is not due within 90 days, including exactly 90', () => {
    expect(isReviewDue('2026-07-14')).toBe(false);
    expect(isReviewDue('2026-10-07')).toBe(false);
  });

  it('generates ids the server will accept', () => {
    expect(newBrainDocumentId()).toMatch(/^own-[A-Za-z0-9-]{1,40}$/);
  });
});

describe('search_brain tool', () => {
  it('finds the warranty procedure', () => {
    const output = search('frame warranty claim');
    expect(output.sources?.[0]).toContain('Frame warranty');
    expect(output.summary).toMatch(/Frame warranty procedure/);
  });

  it('finds the contact lens training prerequisite', () => {
    const output = search('contact lens training promotion');
    expect(output.summary).toMatch(/prerequisite/i);
    expect(output.sources?.some((source) => source.includes('Required training'))).toBe(true);
  });

  it('flags the conflicting local supplier note', () => {
    const output = search('Chorlton supplier terms warranty');
    expect(output.sources?.some((source) => source.includes('Frame supplier terms'))).toBe(true);
    expect(output.summary).toMatch(/conflicting/i);
  });

  it('returns a widget for the UI and brain sources for the answer', () => {
    const output = search('how do I run a local campaign');
    const table = output.widgets.find((widget) => widget.type === 'table');
    expect(table).toBeDefined();
    expect(output.sources?.every((source) => source.startsWith('Brain: '))).toBe(true);
  });

  it('says guidance is missing rather than inventing a procedure', () => {
    const output = search('quantum telescope calibration policy');
    expect(output.sources ?? []).toHaveLength(0);
    expect(output.summary).toMatch(/no guidance/i);
  });

  it('handles an empty query without pretending to know something', () => {
    const output = search('   ');
    expect(output.widgets).toHaveLength(0);
    expect(output.summary).toMatch(/no search terms/i);
  });

  it('respects the limit', () => {
    const output = search('practice', 2);
    const table = output.widgets.find((widget) => widget.type === 'table');
    if (table?.type === 'table') expect(table.rows.length).toBeLessThanOrEqual(2);
  });
});

describe('chat can use practice context', () => {
  it('finds the context document when the question names the practice', () => {
    const output = getTool('search_brain')!.run(dataset, { query: 'Chorlton' });
    expect(output.sources).toContain('Brain: Chorlton: refit, supply account and local cover');
  });

  it('resolves a practice name passed where an id was expected', () => {
    // The model sometimes sends the name instead of the id; the tool must not
    // lose the context because of it.
    const output = getTool('search_brain')!.run(dataset, { query: 'Chorlton practice context', practiceIds: ['Chorlton'] });
    expect(output.sources).toContain('Brain: Chorlton: refit, supply account and local cover');
  });

  it('resolves the practice from the question itself, no id needed', () => {
    const output = getTool('search_brain')!.run(dataset, { query: 'What does the Brain know about Chorlton?' });
    expect(output.sources).toContain('Brain: Chorlton: refit, supply account and local cover');
  });

  it('returns linked practice context first when a practice id is passed', () => {
    const output = getTool('search_brain')!.run(dataset, { query: 'compliance', practiceIds: ['P030'] });
    const table = output.widgets.find((widget) => widget.type === 'table');
    expect(table && table.type === 'table' ? table.rows[0][1] : '').toContain('Warwick');
    expect(output.summary).toContain('context for P030');
  });

  it('keeps the conflict warning when the linked document is conflicting', () => {
    const output = getTool('search_brain')!.run(dataset, { query: 'frame warranty', practiceIds: ['P001'] });
    expect(output.sources).toContain('Brain: Frame supplier terms and local accounts');
    expect(output.summary).toContain('needs clarification');
  });

  it('never answers for one practice with another practice\'s context', () => {
    // "contact lens coaching" matches the Warwick document by keyword only.
    // Warwick is scoped to P030, so it must not surface for P001.
    const forChorlton = getTool('search_brain')!.run(dataset, { query: 'contact lens coaching', practiceIds: ['P001'] });
    expect(forChorlton.sources ?? []).not.toContain('Brain: Warwick: contact lens coaching reference site');
    const forWarwick = getTool('search_brain')!.run(dataset, { query: 'contact lens coaching', practiceIds: ['P030'] });
    expect(forWarwick.sources ?? []).toContain('Brain: Warwick: contact lens coaching reference site');
  });

  it('still reports when there is nothing to find', () => {
    const output = getTool('search_brain')!.run(dataset, { query: 'zzzz-nothing' });
    expect(output.sources).toHaveLength(0);
    expect(output.summary).toContain('no guidance matching');
  });
});
