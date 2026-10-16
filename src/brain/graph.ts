/**
 * The Practice Brain as a graph: the central hub, the sections, the documents
 * and the teams that own them, placed deterministically for the canvas.
 *
 * Pure data in, pure geometry out. No React, no DOM, no storage: the canvas
 * and the status pill both read from here, and the same documents always
 * produce the same positions, so a node only moves when the guidance changed.
 */

import type { BrainDocument } from '@/content/brain';
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

export function brainStats(documents: BrainDocument[], asOf?: string): BrainStats {
  throw new Error('not implemented');
}

/** The graph the canvas draws: hub at the origin, sections in a ring, each
    section's documents clustered beside it, owners on the outer ring. */
export function buildBrainGraph(documents: BrainDocument[], asOf?: string): BrainGraph {
  throw new Error('not implemented');
}

/** Up to `limit` real starting points: the conflicting document, an overdue
    review, recorded practice context, then one per section. */
export function deriveBrainSuggestions(documents: BrainDocument[], limit?: number): BrainSuggestion[] {
  throw new Error('not implemented');
}
