/**
 * The Practice Brain as a graph: the central hub, the sections, the documents
 * and the teams that own them, placed deterministically for the canvas.
 *
 * Pure data in, pure geometry out. No React, no DOM, no storage: the canvas
 * and the status pill both read from here, and the same documents always
 * produce the same positions, so a node only moves when the guidance changed.
 */

import { hashSeed, mulberry32 } from '@/lib/prng';
import { BRAIN_AS_OF, BRAIN_SECTIONS, isReviewDue, type BrainDocument } from '@/content/brain';
import type { Bounds } from '@/map/layout';

export type BrainNodeRole = 'hub' | 'section' | 'document' | 'owner';

export interface BrainNodeFlags {
  /** Guidance that contradicts other guidance and needs clarification. */
  conflict?: boolean;
  /** The last review is past its due date at the demo clock. */
  reviewDue?: boolean;
  /** A document the reader wrote themselves. */
  yours?: boolean;
  /** Practice ids this document is linked to. */
  practiceLinks?: string[];
}

export interface BrainGraphNode {
  /** 'hub' | `sec:<section>` | `doc:<documentId>` | `own:<ownerKey>` */
  id: string;
  role: BrainNodeRole;
  label: string;
  /** Section document count, owner document count, or the hub's summary line. */
  sub?: string;
  x: number;
  y: number;
  r: number;
  section?: string;
  documentId?: string;
  ownerKey?: string;
  /** Two letters inside a large node, from the owner or section name. */
  initials?: string;
  flags?: BrainNodeFlags;
}

/** Solid lines are structure; dotted lines are connected knowledge. */
export type BrainEdgeKind = 'structure' | 'knowledge';

export interface BrainGraphEdge {
  a: string;
  b: string;
  kind: BrainEdgeKind;
}

export interface BrainStats {
  documents: number;
  sections: number;
  owners: number;
  reviewDue: number;
  conflicts: number;
  yours: number;
}

export interface BrainGraph {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
  stats: BrainStats;
  bounds: Bounds;
}

/** A starting question derived from the documents, never a hardcoded list. */
export interface BrainSuggestion {
  id: string;
  question: string;
}

export function documentNodeId(documentId: string): string {
  return `doc:${documentId}`;
}

export function sectionNodeId(section: string): string {
  return `sec:${section}`;
}

export function ownerNodeId(ownerKey: string): string {
  return `own:${ownerKey}`;
}

/** Trimmed owner name for grouping; an empty owner folds to just 'Unassigned'. */
export function ownerKeyOf(owner: string): string {
  const key = owner.trim();
  return key.length > 0 ? key : 'Unassigned';
}

/** First two letters of a name, mirroring the canvas ink helper. Duplicated on
    purpose: the graph module must not import from the component tree. */
function initialsOf(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, '');
  return letters.length >= 2 ? letters.slice(0, 2) : letters || '?';
}

/** First letters of the first two words, uppercased, for owner nodes. */
function ownerInitials(key: string): string {
  const words = key.split(/\s+/).filter((word) => word.length > 0);
  return words.slice(0, 2).map((word) => word[0]!.toUpperCase()).join('') || '?';
}

/** Stable signed jitter in [-amount, amount], seeded by name. */
function jitter(key: string, amount: number): number {
  return (mulberry32(hashSeed(key))() * 2 - 1) * amount;
}

/** Two stable signed offsets in [-amount, amount], seeded by name. */
function offsets(key: string, amount: number): [number, number] {
  const rand = mulberry32(hashSeed(key));
  return [(rand() * 2 - 1) * amount, (rand() * 2 - 1) * amount];
}

/** Round to half pixels and guarantee a finite number, like the map layout. */
function halfPx(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 2) / 2 : 0;
}

/** Sections in display order: known sections first, unknown ones alphabetically. */
function orderedSections(documents: readonly BrainDocument[]): string[] {
  const present = new Set(documents.map((document) => document.section));
  const known = BRAIN_SECTIONS.filter((section) => present.has(section));
  const unknown = [...present]
    .filter((section) => !(BRAIN_SECTIONS as readonly string[]).includes(section))
    .sort();
  return [...known, ...unknown];
}

/** Remove duplicate edges, keeping the first occurrence in stable order. */
function dedupeEdges(edges: readonly BrainGraphEdge[]): BrainGraphEdge[] {
  const seen = new Set<string>();
  const out: BrainGraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.kind}|${edge.a}|${edge.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

export function brainStats(documents: BrainDocument[], asOf?: string): BrainStats {
  const clock = asOf ?? BRAIN_AS_OF;
  const sections = new Set(documents.map((document) => document.section));
  const owners = new Set(documents.map((document) => ownerKeyOf(document.owner)));
  return {
    documents: documents.length,
    sections: sections.size,
    owners: owners.size,
    reviewDue: documents.filter((document) => isReviewDue(document.reviewed, clock)).length,
    conflicts: documents.filter((document) => document.conflict === true).length,
    yours: documents.filter((document) => document.origin === 'yours').length,
  };
}

/** The graph the canvas draws: hub at the origin, sections in a ring, each
    section's documents clustered beside it, owners on the outer ring. */
export function buildBrainGraph(documents: BrainDocument[], asOf?: string): BrainGraph {
  const clock = asOf ?? BRAIN_AS_OF;
  const stats = brainStats(documents, clock);
  const nodes: BrainGraphNode[] = [];
  const edges: BrainGraphEdge[] = [];

  nodes.push({
    id: 'hub',
    role: 'hub',
    label: 'Practice Brain',
    sub: `${documents.length} documents${stats.reviewDue > 0 ? ` · ${stats.reviewDue} review${stats.reviewDue === 1 ? '' : 's'} due` : ''}`,
    x: 0,
    y: 0,
    r: 26,
  });

  const sections = orderedSections(documents);
  const r1 = 330 + 12 * Math.sqrt(documents.length);

  interface SectionPlacement {
    angle: number;
    x: number;
    y: number;
    docRing: number;
  }
  const placements = new Map<string, SectionPlacement>();

  sections.forEach((name, index) => {
    const members = documents.filter((document) => document.section === name);
    const angle = -Math.PI / 2 + index * ((2 * Math.PI) / Math.max(1, sections.length)) + jitter(`brain:section:${name}`, 0.08);
    const x = Math.cos(angle) * r1;
    const y = Math.sin(angle) * r1;
    nodes.push({
      id: sectionNodeId(name),
      role: 'section',
      label: name,
      sub: `${members.length} documents`,
      x,
      y,
      r: 12 + 2.4 * Math.sqrt(members.length),
      section: name,
      initials: initialsOf(name),
    });
    edges.push({ a: 'hub', b: sectionNodeId(name), kind: 'structure' });
    placements.set(name, { angle, x, y, docRing: 96 + 16 * Math.sqrt(members.length) });
  });

  // Document radius scales with content length across the whole corpus.
  const lengths = documents.map((document) => document.content.length);
  const minLen = lengths.length > 0 ? Math.min(...lengths) : 0;
  const maxLen = lengths.length > 0 ? Math.max(...lengths) : 0;
  const span = maxLen - minLen || 1;

  for (const name of sections) {
    const placement = placements.get(name)!;
    const members = documents
      .filter((document) => document.section === name)
      .sort((a, b) => a.id.localeCompare(b.id));
    members.forEach((document, index) => {
      // A sunflower bouquet around the section: even angles, growing radius.
      const angle = index * 2.39996 + placement.angle + jitter(`brain:doc:angle:${document.id}`, 0.05);
      const distance = placement.docRing * Math.sqrt((index + 0.5) / members.length);
      const [dx, dy] = offsets(`brain:doc:xy:${document.id}`, 9);
      const flags: BrainNodeFlags = {};
      if (document.conflict) flags.conflict = true;
      if (isReviewDue(document.reviewed, clock)) flags.reviewDue = true;
      if (document.origin === 'yours') flags.yours = true;
      const links = document.relatedPracticeIds ?? [];
      if (links.length > 0) flags.practiceLinks = [...links];
      nodes.push({
        id: documentNodeId(document.id),
        role: 'document',
        label: document.title,
        x: placement.x + Math.cos(angle) * distance + dx,
        y: placement.y + Math.sin(angle) * distance + dy,
        r: 5 + 6.5 * Math.pow((document.content.length - minLen) / span, 0.75),
        section: name,
        documentId: document.id,
        ...(Object.keys(flags).length > 0 ? { flags } : {}),
      });
      edges.push({ a: sectionNodeId(name), b: documentNodeId(document.id), kind: 'structure' });
    });
  }

  interface OwnerGroup {
    key: string;
    count: number;
    sections: Set<string>;
  }
  const ownerIndex = new Map<string, { count: number; sections: Set<string> }>();
  for (const document of documents) {
    const key = ownerKeyOf(document.owner);
    const entry = ownerIndex.get(key) ?? { count: 0, sections: new Set<string>() };
    entry.count += 1;
    entry.sections.add(document.section);
    ownerIndex.set(key, entry);
  }

  // Owner nodes read best when the busiest sit first; the same order picks the
  // twelve kept when there are too many owners to show.
  const rankedOwners = [...ownerIndex.keys()].sort((a, b) => {
    const byCount = ownerIndex.get(b)!.count - ownerIndex.get(a)!.count;
    return byCount !== 0 ? byCount : a.localeCompare(b);
  });

  const groups: OwnerGroup[] = [];
  for (const key of rankedOwners.slice(0, 12)) {
    const entry = ownerIndex.get(key)!;
    groups.push({ key, count: entry.count, sections: new Set(entry.sections) });
  }
  if (rankedOwners.length > 12) {
    const folded = rankedOwners.slice(12);
    const count = folded.reduce((total, key) => total + ownerIndex.get(key)!.count, 0);
    const sectionsOfFolded = new Set(folded.flatMap((key) => [...ownerIndex.get(key)!.sections]));
    groups.push({ key: 'Other owners', count, sections: sectionsOfFolded });
  }

  const maxDocRing = sections.length > 0
    ? Math.max(...sections.map((name) => placements.get(name)!.docRing))
    : 0;
  const r3 = r1 + maxDocRing + 120 + 26 * Math.sqrt(groups.length);

  groups.forEach((group, index) => {
    const angle = -Math.PI / 2 + index * ((2 * Math.PI) / Math.max(1, groups.length)) + jitter(`brain:owner:${group.key}`, 0.15);
    nodes.push({
      id: ownerNodeId(group.key),
      role: 'owner',
      label: group.key,
      sub: `${group.count} documents`,
      x: Math.cos(angle) * r3,
      y: Math.sin(angle) * r3,
      r: Math.min(18, 12 + 2 * Math.log2(1 + group.count)),
      ownerKey: group.key,
      initials: ownerInitials(group.key),
    });
    for (const section of sections) {
      if (group.sections.has(section)) {
        edges.push({ a: ownerNodeId(group.key), b: sectionNodeId(section), kind: 'structure' });
      }
    }
  });

  // Documents that share a linked practice are connected knowledge.
  for (let i = 0; i < documents.length; i += 1) {
    const linksA = documents[i].relatedPracticeIds ?? [];
    if (linksA.length === 0) continue;
    for (let j = i + 1; j < documents.length; j += 1) {
      const linksB = documents[j].relatedPracticeIds ?? [];
      if (linksB.some((id) => linksA.includes(id))) {
        edges.push({ a: documentNodeId(documents[i].id), b: documentNodeId(documents[j].id), kind: 'knowledge' });
      }
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.r);
    maxX = Math.max(maxX, node.x + node.r);
    minY = Math.min(minY, node.y - node.r);
    maxY = Math.max(maxY, node.y + node.r);
  }

  return {
    nodes,
    edges: dedupeEdges(edges),
    stats,
    bounds: {
      minX: halfPx(minX),
      maxX: halfPx(maxX),
      minY: halfPx(minY),
      maxY: halfPx(maxY),
    },
  };
}

/** Up to `limit` real starting points: the conflicting document, an overdue
    review, recorded practice context, then one per section. */
export function deriveBrainSuggestions(documents: BrainDocument[], limit?: number): BrainSuggestion[] {
  const max = limit ?? 3;
  const suggestions: BrainSuggestion[] = [];

  const conflicting = documents
    .filter((document) => document.conflict === true)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (conflicting.length > 0) {
    const document = conflicting[0];
    suggestions.push({
      id: `conflict:${document.id}`,
      question: `Why is the guidance on ${document.title.toLowerCase()} marked as conflicting?`,
    });
  }

  if (documents.some((document) => isReviewDue(document.reviewed))) {
    suggestions.push({ id: 'review', question: 'Which guidance is overdue for review?' });
  }

  const context = documents
    .filter((document) => document.section === 'Practice context' && document.scope !== 'Group guidance')
    .sort((a, b) => a.id.localeCompare(b.id));
  if (context.length > 0) {
    const document = context[0];
    suggestions.push({
      id: `context:${document.id}`,
      question: `What does the Brain know about ${document.scope}?`,
    });
  }

  for (const section of orderedSections(documents)) {
    suggestions.push({
      id: `section:${section}`,
      question: `What guidance do we have for ${section.toLowerCase().replace(/&/g, 'and')}?`,
    });
  }

  return suggestions.slice(0, Math.max(0, max));
}
