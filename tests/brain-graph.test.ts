import { describe, expect, it } from 'vitest';
import { BRAIN_DOCUMENTS, mergeBrainDocuments, type BrainDocument } from '../src/content/brain';
import {
  brainStats,
  buildBrainGraph,
  deriveBrainSuggestions,
  documentNodeId,
  ownerKeyOf,
  ownerNodeId,
  sectionNodeId,
  type BrainGraph,
} from '../src/brain/graph';

const docs = BRAIN_DOCUMENTS;

function nodeOf(graph: BrainGraph, id: string) {
  return graph.nodes.find((node) => node.id === id);
}

describe('buildBrainGraph', () => {
  it('builds the same graph twice from the same documents', () => {
    expect(buildBrainGraph(docs)).toEqual(buildBrainGraph(docs));
  });

  it('keeps every coordinate finite', () => {
    const graph = buildBrainGraph(docs);
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x), node.id).toBe(true);
      expect(Number.isFinite(node.y), node.id).toBe(true);
      expect(Number.isFinite(node.r), node.id).toBe(true);
    }
    for (const value of [graph.bounds.minX, graph.bounds.maxX, graph.bounds.minY, graph.bounds.maxY]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('has one node per document, plus the hub, sections and owners, with unique ids', () => {
    const graph = buildBrainGraph(docs);
    const ids = graph.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(nodeOf(graph, 'hub')?.role).toBe('hub');
    for (const document of docs) {
      const node = nodeOf(graph, documentNodeId(document.id));
      expect(node, document.id).toBeDefined();
      expect(node!.role).toBe('document');
      expect(node!.section).toBe(document.section);
    }
    expect(graph.nodes.filter((node) => node.role === 'section')).toHaveLength(6);
    expect(graph.nodes.filter((node) => node.role === 'owner').length).toBeGreaterThan(0);
    expect(graph.edges.some((edge) => edge.kind === 'structure')).toBe(true);
  });

  it('keeps every node inside the bounds', () => {
    const graph = buildBrainGraph(docs);
    for (const node of graph.nodes) {
      expect(node.x - node.r, node.id).toBeGreaterThanOrEqual(graph.bounds.minX - 1);
      expect(node.x + node.r, node.id).toBeLessThanOrEqual(graph.bounds.maxX + 1);
      expect(node.y - node.r, node.id).toBeGreaterThanOrEqual(graph.bounds.minY - 1);
      expect(node.y + node.r, node.id).toBeLessThanOrEqual(graph.bounds.maxY + 1);
    }
  });

  it('pins the shipped stats', () => {
    const graph = buildBrainGraph(docs);
    expect(graph.stats).toEqual(brainStats(docs));
    expect(graph.stats.documents).toBe(BRAIN_DOCUMENTS.length);
    expect(graph.stats.sections).toBe(6);
    expect(graph.stats.conflicts).toBe(1);
    expect(graph.stats.reviewDue).toBe(1);
    expect(graph.stats.yours).toBe(0);
  });

  it('flags the conflict, the overdue review and the practice links', () => {
    const graph = buildBrainGraph(docs);
    expect(nodeOf(graph, documentNodeId('supplier'))!.flags?.conflict).toBe(true);
    expect(nodeOf(graph, documentNodeId('targets'))!.flags?.reviewDue).toBe(true);
    expect(nodeOf(graph, documentNodeId('ctx-chorlton'))!.flags?.practiceLinks).toEqual(['P001']);
    expect(nodeOf(graph, documentNodeId('warranty'))!.flags?.conflict).toBeUndefined();
    expect(nodeOf(graph, documentNodeId('warranty'))!.flags?.reviewDue).toBeUndefined();
  });

  it('links documents that share a practice with a knowledge edge', () => {
    const graph = buildBrainGraph(docs);
    const linked = (a: string, b: string) =>
      graph.edges.some(
        (edge) =>
          edge.kind === 'knowledge' &&
          ((edge.a === documentNodeId(a) && edge.b === documentNodeId(b)) ||
            (edge.a === documentNodeId(b) && edge.b === documentNodeId(a))),
      );
    expect(linked('supplier', 'ctx-chorlton')).toBe(true);
    expect(linked('warranty', 'campaign')).toBe(false);
  });

  it('adds a conflict marked by an edit to the stats and the node', () => {
    const edited = mergeBrainDocuments({ overrides: { review: { conflict: true } }, created: [] });
    const graph = buildBrainGraph(edited);
    expect(graph.stats.conflicts).toBe(2);
    expect(nodeOf(graph, documentNodeId('review'))!.flags?.conflict).toBe(true);
  });

  it('shows a document the reader wrote, marked as theirs', () => {
    const edited = mergeBrainDocuments({
      overrides: {},
      created: [
        {
          id: 'own-1',
          section: 'Operations',
          title: 'Local opening hours',
          owner: 'Sara Kelly',
          reviewed: '2026-10-12',
          scope: 'Group guidance',
          content: 'The demo site opens at nine and closes at five.',
        },
      ],
    });
    const graph = buildBrainGraph(edited);
    const node = nodeOf(graph, documentNodeId('own-1'))!;
    expect(node).toBeDefined();
    expect(node.flags?.yours).toBe(true);
    expect(graph.stats.yours).toBe(1);
  });

  it('moves nothing that shares its id when only the content changes', () => {
    const before = buildBrainGraph(docs);
    const edited = mergeBrainDocuments({
      overrides: {
        warranty: {
          content:
            'A much longer replacement for the warranty procedure that keeps the same document id while changing the length of the body considerably.',
        },
      },
      created: [],
    });
    const after = buildBrainGraph(edited);
    const a = nodeOf(before, documentNodeId('warranty'))!;
    const b = nodeOf(after, documentNodeId('warranty'))!;
    expect(b.x).toBe(a.x);
    expect(b.y).toBe(a.y);
    expect(b.r).not.toBe(a.r);
  });

  it('folds owners past twelve into one node', () => {
    const owners = Array.from({ length: 13 }, (_, index) => `Team ${String.fromCharCode(65 + index)}`);
    // 13 owners over 14 documents, with Team A owning two so the kept twelve
    // and the folded remainder are pinned by the (count, key) order.
    const synthetic: BrainDocument[] = owners.map((owner, index) => ({
      id: `synthetic-${String(index).padStart(2, '0')}`,
      section: 'Operations',
      title: `Synthetic guidance ${index}`,
      owner,
      reviewed: '2026-10-12',
      scope: 'Group guidance',
      content: `Synthetic content ${index} for the owner fold test.`,
    }));
    synthetic.push({ ...synthetic[0], id: 'synthetic-extra' });

    const graph = buildBrainGraph(synthetic);
    const ownerNodes = graph.nodes.filter((node) => node.role === 'owner');
    expect(ownerNodes).toHaveLength(13);
    expect(nodeOf(graph, ownerNodeId('Team A'))!.sub).toBe('2 documents');
    expect(nodeOf(graph, ownerNodeId('Team M'))).toBeUndefined();
    expect(nodeOf(graph, ownerNodeId('Other owners'))!.sub).toBe('1 documents');
    expect(graph.stats.owners).toBe(13);
  });
});

describe('deriveBrainSuggestions', () => {
  it('is deterministic and starts from the real conflict', () => {
    const first = deriveBrainSuggestions(docs);
    expect(first).toEqual(deriveBrainSuggestions(docs));
    expect(first.map((suggestion) => suggestion.id)).toEqual([
      'conflict:supplier',
      'review',
      'context:ctx-bristol',
    ]);
    expect(first[0].question).toBe(
      'Why is the guidance on frame supplier terms and local accounts marked as conflicting?',
    );
    expect(first[1].question).toBe('Which guidance is overdue for review?');
  });

  it('mentions no conflict once the conflict is cleared', () => {
    const cleared = mergeBrainDocuments({ overrides: { supplier: { conflict: false } }, created: [] });
    const suggestions = deriveBrainSuggestions(cleared, 9);
    expect(suggestions.some((suggestion) => /conflicting/i.test(suggestion.question))).toBe(false);
    expect(suggestions.some((suggestion) => suggestion.question.includes('frame supplier terms'))).toBe(false);
  });

  it('carries no em or en dashes', () => {
    for (const suggestion of deriveBrainSuggestions(docs, 9)) {
      expect(/[\u2013\u2014]/.test(suggestion.question), suggestion.id).toBe(false);
    }
  });

  it('honours the limit and offers one question per section', () => {
    const all = deriveBrainSuggestions(docs, 9);
    expect(all).toHaveLength(9);
    expect(all[all.length - 1].question).toBe('What guidance do we have for practice context?');
    expect(all.some((suggestion) => suggestion.question === 'What guidance do we have for finance and claims?')).toBe(true);
    expect(deriveBrainSuggestions(docs)).toHaveLength(3);
    expect(deriveBrainSuggestions(docs, 1)).toHaveLength(1);
    expect(deriveBrainSuggestions(docs, 2).map((suggestion) => suggestion.id)).toEqual(all.slice(0, 2).map((suggestion) => suggestion.id));
  });
});

describe('owner keys and node ids', () => {
  it('trims owner names and folds empty ones to Unassigned', () => {
    expect(ownerKeyOf('  Buying team  ')).toBe('Buying team');
    expect(ownerKeyOf('')).toBe('Unassigned');
    expect(ownerKeyOf('   ')).toBe('Unassigned');
  });

  it('namespaces node ids so a citation, a node and an edge can never disagree', () => {
    expect(documentNodeId('warranty')).toBe('doc:warranty');
    expect(sectionNodeId('Operations')).toBe('sec:Operations');
    expect(ownerNodeId('Buying team')).toBe('own:Buying team');
  });
});
