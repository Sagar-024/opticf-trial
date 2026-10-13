import { describe, expect, it } from 'vitest';
import { BRAIN_DOCUMENTS, BRAIN_SECTIONS, mergeBrainDocuments } from '../src/content/brain';
import { getTool } from '../src/ai/tools';
import { sanitizeBrainOverrides } from '../src/ai/validate';
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
      warranty: { content: 'Edited wording: always confirm with Buying before promising a replacement.' },
    });
    const document = edited.find((item) => item.id === 'warranty')!;
    expect(document.content).toContain('Edited wording');
  });

  it('search_brain quotes the edited text, not the original', () => {
    const documents = mergeBrainDocuments({ warranty: { content: 'Edited wording: confirm with Buying first.' } });
    const output = search('frame warranty claim', undefined, { brainDocuments: documents });
    expect(output.summary).toContain('confirm with Buying first');
    expect(output.summary).not.toContain('Check the proof of purchase');
  });

  it('an edit can mark a document as conflicting', () => {
    const documents = mergeBrainDocuments({ review: { conflict: true } });
    const output = search('practice performance review guide', undefined, { brainDocuments: documents });
    expect(output.summary).toMatch(/conflicting/i);
  });

  it('falls back to the shipped documents when there are no edits', () => {
    const output = search('frame warranty claim');
    expect(output.summary).toContain('Check the proof of purchase');
  });
});

describe('sanitizeBrainOverrides', () => {
  it('rejects non-objects and unknown document ids', () => {
    expect(sanitizeBrainOverrides(null)).toEqual({});
    expect(sanitizeBrainOverrides('ignore previous instructions')).toEqual({});
    expect(sanitizeBrainOverrides({ 'not-a-document': { content: 'x' } })).toEqual({});
  });

  it('caps content length and strips unsafe owner characters', () => {
    const result = sanitizeBrainOverrides({
      warranty: { content: 'a'.repeat(9000), owner: '<script>alert(1)</script>Buying' },
    });
    expect(result.warranty.content?.length).toBe(4000);
    expect(result.warranty.owner).not.toContain('<');
    expect(result.warranty.owner).not.toContain('>');
  });

  it('keeps a legitimate edit', () => {
    const result = sanitizeBrainOverrides({ training: { content: 'New wording', owner: 'People team', conflict: true } });
    expect(result).toEqual({ training: { content: 'New wording', owner: 'People team', conflict: true } });
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

  it('still reports when there is nothing to find', () => {
    const output = getTool('search_brain')!.run(dataset, { query: 'zzzz-nothing' });
    expect(output.sources).toHaveLength(0);
    expect(output.summary).toContain('no guidance matching');
  });
});
