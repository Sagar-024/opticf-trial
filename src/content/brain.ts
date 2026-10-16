/**
 * The Brain: the group's written guidance.
 *
 * This is the knowledge layer the email describes, the part the AI can use
 * alongside the numbers. Documents are plain data so the chat can search them
 * and the UI can render, read and edit them.
 *
 * Everything here is fictional sample guidance for the demo.
 */

export interface BrainDocument {
  id: string;
  section: string;
  title: string;
  owner: string;
  /** ISO date of the last review. */
  reviewed: string;
  scope: string;
  content: string;
  /** Marks guidance that contradicts other guidance and needs clarification. */
  conflict?: boolean;
  /**
   * Practices this document is linked to. Group guidance leaves this empty;
   * practice context points at the practices it describes, which is what makes
   * the knowledge explorable from the map and usable by the chat for a specific
   * practice.
   */
  relatedPracticeIds?: string[];
  /** 'yours' marks a document the reader wrote themselves. Absent means shipped guidance. */
  origin?: 'yours';
}

/** A field edit over one shipped document. */
export interface BrainOverride {
  content?: string;
  owner?: string;
  conflict?: boolean;
  /** ISO date the reader recorded a fresh review on. */
  reviewed?: string;
}

/** Everything the reader has changed about the Brain, as one typed state. */
export interface BrainState {
  /** Field edits over shipped documents, keyed by document id. */
  overrides: Record<string, BrainOverride>;
  /** Documents the user wrote themselves. */
  created: BrainDocument[];
}

export const BRAIN_SECTIONS = [
  'Operations',
  'Finance & Claims',
  'People & Training',
  'Buying & Suppliers',
  'Marketing',
  'Practice context',
] as const;

export const BRAIN_DOCUMENTS: BrainDocument[] = [
  {
    id: 'warranty',
    section: 'Operations',
    title: 'Frame warranty procedure',
    owner: 'Practice Support',
    reviewed: '2026-10-07',
    scope: 'Group guidance',
    content:
      'Check the proof of purchase and the supplier warranty terms before promising anything. Record the fault and attach a clear photograph. Ask the Buying team to confirm eligibility. Raise a support request when the supplier terms are missing, and never promise a replacement before the terms are confirmed.',
  },
  {
    id: 'review',
    section: 'Operations',
    title: 'Practice performance review guide',
    owner: 'Practice Mentoring',
    reviewed: '2026-10-07',
    scope: 'Group guidance',
    content:
      'Compare like for like periods, then look at examination volume, conversion and product mix before proposing an action. Ask the practice manager about local context. Treat a change in staffing as a possible contributor, not a proven cause. Agree one action, one owner and a review date.',
  },
  {
    id: 'conversion',
    section: 'Operations',
    title: 'Investigating a fall in conversion',
    owner: 'Practice Mentoring',
    reviewed: '2026-10-05',
    scope: 'Group guidance',
    content:
      'Start by checking whether examination volume held up while conversion fell, which points at dispensing rather than demand. Then review peak hour dispensing cover, appointment capacity and product mix. Report the pattern, and say plainly that the data does not establish the reason.',
  },
  {
    id: 'claims',
    section: 'Finance & Claims',
    title: 'Outstanding claims follow-up',
    owner: 'Finance Support',
    reviewed: '2026-10-07',
    scope: 'Group guidance',
    content:
      'Review unpaid claims older than 30 days. Check the supporting records, the submission status and any missing information. Prepare a follow up for human review. A claim is not recovered revenue until payment is recorded.',
  },
  {
    id: 'refunds',
    section: 'Finance & Claims',
    title: 'Refunds and goodwill authority',
    owner: 'Finance Support',
    reviewed: '2026-10-02',
    scope: 'Group guidance',
    content:
      'Practice managers may authorise a goodwill gesture up to 50 pounds without approval. Anything above that needs the regional lead. Record the reason, the amount and the original order reference on the patient record.',
  },
  {
    id: 'targets',
    section: 'Finance & Claims',
    title: 'Setting and revising practice targets',
    owner: 'Finance Support',
    reviewed: '2026-03-18',
    scope: 'Group guidance',
    content:
      'Revenue, conversion and contact lens targets are set once a year as part of the plan and are not revised mid quarter without Finance approval. A shortfall against target is a prompt to investigate, not by itself evidence of poor performance. Seasonality and one off local events should be considered before conclusions are drawn.',
  },
  {
    id: 'training',
    section: 'People & Training',
    title: 'Required training and compliance',
    owner: 'People team',
    reviewed: '2026-10-06',
    scope: 'Group guidance',
    content:
      'Contact lens fitting, contact lens aftercare, data protection, clinical compliance and safeguarding are required for every practice. Modules outstanding at the due date are treated as overdue and should be completed within 14 days. Contact lens fitting is a prerequisite before a practice runs contact lens promotions.',
  },
  {
    id: 'cover',
    section: 'People & Training',
    title: 'Arranging a practice support review',
    owner: 'People team',
    reviewed: '2026-10-05',
    scope: 'Group guidance',
    content:
      'Discuss coverage gaps with the practice manager and the group mentor. Record agreed actions and a review date. Keep personal staffing details out of group wide reporting, and describe cover in terms of hours and roles rather than named individuals.',
  },
  {
    id: 'onboarding',
    section: 'People & Training',
    title: 'New practice manager onboarding',
    owner: 'People team',
    reviewed: '2026-09-30',
    scope: 'Group guidance',
    content:
      'In the first 30 days: confirm required training is booked, walk through the performance review guide, introduce the group mentor, and agree how the weekly numbers will be reviewed locally.',
  },
  {
    id: 'supplier',
    section: 'Buying & Suppliers',
    title: 'Frame supplier terms and local accounts',
    owner: 'Buying team',
    reviewed: '2026-10-06',
    scope: 'Chorlton only',
    relatedPracticeIds: ['P001'],
    content:
      'Chorlton uses a local frame supply account. The demonstration record has no current warranty term sheet attached. Buying must confirm the applicable terms before any replacement is promised.',
    conflict: true,
  },
  {
    id: 'cl-supply',
    section: 'Buying & Suppliers',
    title: 'Contact lens supply and trial stock',
    owner: 'Buying team',
    reviewed: '2026-10-03',
    scope: 'Group guidance',
    content:
      'Trial stock is held at practice level and reordered monthly. Fitting fees are set by the group and are not discounted locally. If trial stock runs short, record the shortfall so supply can be adjusted at the next review.',
  },
  {
    id: 'campaign',
    section: 'Marketing',
    title: 'Local campaign briefing',
    owner: 'Marketing Support',
    reviewed: '2026-10-04',
    scope: 'Group guidance',
    content:
      'Start with the practice objective, the intended audience, the available appointment capacity and the budget. Ask Marketing to review the brief before any campaign is launched. Do not run a contact lens campaign at a practice with outstanding contact lens fitting training.',
  },

  // ── Practice context ──
  // Knowledge about specific places. These link to practice ids, so the map's
  // practice sheet can show them and the chat can pull the right context when a
  // question names a practice. Wording is deliberately descriptive: context is
  // recorded, never presented as a measured cause.
  {
    id: 'ctx-chorlton',
    section: 'Practice context',
    title: 'Chorlton: refit, supply account and local cover',
    owner: 'Practice Mentoring',
    reviewed: '2026-10-09',
    scope: 'Chorlton',
    relatedPracticeIds: ['P001'],
    content:
      'Chorlton relocated its dispensing desk during an August refit and has been working around the works since. The practice runs a local frame supply account and uses an independent repair partner for rush jobs, which can lengthen replacement lead times. The refit is recorded as local context only: the performance data does not measure any effect it may have had on trading.',
  },
  {
    id: 'ctx-didsbury',
    section: 'Practice context',
    title: 'Didsbury: new practice manager and open review',
    owner: 'People team',
    reviewed: '2026-10-08',
    scope: 'Didsbury',
    relatedPracticeIds: ['P002'],
    content:
      'Tom Whitaker took over as practice manager in August. Onboarding follows the group checklist: required training is booked, the performance review guide has been walked through with mentor Alex Morgan, and one action with an owner and a review date is open. Trading has been uneven during the handover, and the handover is recorded as context rather than an explanation of any specific movement.',
  },
  {
    id: 'ctx-stockport',
    section: 'Practice context',
    title: 'Stockport: weekend cover and dispensing capacity',
    owner: 'Practice Mentoring',
    reviewed: '2026-10-07',
    scope: 'Stockport',
    relatedPracticeIds: ['P004'],
    content:
      'Stockport covers Saturdays with one dispenser on the floor. Holiday cover for the dispensing desk is arranged through Sale where the rota permits, and peak hour cover is the open topic with mentor Alex Morgan. Contact lens trial stock is counted monthly; the September count came back short and was noted for supply.',
  },
  {
    id: 'ctx-chester',
    section: 'Practice context',
    title: 'Chester: campaign readiness',
    owner: 'Marketing Support',
    reviewed: '2026-10-06',
    scope: 'Chester',
    relatedPracticeIds: ['P007'],
    content:
      'Chester opened in 2005 and has a long standing local patient base. A local campaign is being scoped for the new year. Required training is complete, so the contact lens promotion rule in the campaign briefing is satisfied; keep the campaign decisions with Marketing until the brief is reviewed.',
  },
  {
    id: 'ctx-warwick',
    section: 'Practice context',
    title: 'Warwick: contact lens coaching reference site',
    owner: 'Practice Mentoring',
    reviewed: '2026-10-05',
    scope: 'Warwick',
    relatedPracticeIds: ['P030'],
    content:
      'Warwick is used as the reference site for contact lens growth coaching. Required training is complete and mentor Priya Nair runs quarterly sessions here. The visits are descriptive: Warwick being a reference site does not make its figures a target for any other practice.',
  },
  {
    id: 'ctx-bristol',
    section: 'Practice context',
    title: 'Bristol: refit closure and reopening',
    owner: 'Practice Mentoring',
    reviewed: '2026-10-14',
    scope: 'Bristol',
    relatedPracticeIds: ['P020'],
    content:
      'Bristol closed the shop floor for a three week refit in October and reopened at the end of the month. Trading during the closure was limited to collections and repairs. The closure is recorded as local context only: the performance data does not measure how much of the October movement it explains.',
  },
  {
    id: 'ctx-whitefield',
    section: 'Practice context',
    title: 'Whitefield: divestment',
    owner: 'Finance Support',
    reviewed: '2026-09-02',
    scope: 'Whitefield',
    relatedPracticeIds: ['P042'],
    content:
      'Whitefield was sold at the end of August as part of the estate review. The practice stopped reporting from September; no further trading data is expected. Any month on month comparison for the North West should read the exit as a change in the estate, not as lost trading.',
  },
];

/** Documents keyed by id, with local edits applied. */
export function brainDocumentById(id: string): BrainDocument | undefined {
  return BRAIN_DOCUMENTS.find((document) => document.id === id);
}

export const BRAIN_REVIEW_DAYS = 90;
/** The demo clock, matching the training layer's default as-of date. */
export const BRAIN_AS_OF = '2026-10-12';

export const EMPTY_BRAIN_STATE: BrainState = { overrides: {}, created: [] };

/** A storage-safe id for a document the reader wrote. */
export function newBrainDocumentId(): string {
  return `own-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** True when a review is more than BRAIN_REVIEW_DAYS old at the demo clock.
    Exactly 90 days still counts as current. */
export function isReviewDue(reviewed: string, asOf: string = BRAIN_AS_OF): boolean {
  const reviewedMs = Date.parse(`${reviewed}T00:00:00Z`);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(reviewedMs) || !Number.isFinite(asOfMs)) return false;
  return asOfMs - reviewedMs > BRAIN_REVIEW_DAYS * 24 * 60 * 60 * 1000;
}

function normalizeOverride(value: unknown): BrainOverride | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const override: BrainOverride = {};
  if (typeof source.content === 'string') override.content = source.content;
  if (typeof source.owner === 'string') override.owner = source.owner;
  if (typeof source.conflict === 'boolean') override.conflict = source.conflict;
  if (typeof source.reviewed === 'string') override.reviewed = source.reviewed;
  return Object.keys(override).length > 0 ? override : null;
}

function normalizeCreatedDocument(value: unknown): BrainDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  for (const key of ['id', 'section', 'title', 'owner', 'reviewed', 'scope', 'content'] as const) {
    if (typeof source[key] !== 'string') return null;
  }
  const links = Array.isArray(source.relatedPracticeIds)
    ? source.relatedPracticeIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    id: source.id as string,
    section: source.section as string,
    title: source.title as string,
    owner: source.owner as string,
    reviewed: source.reviewed as string,
    scope: source.scope as string,
    content: source.content as string,
    ...(links.length > 0 ? { relatedPracticeIds: links } : {}),
    origin: 'yours',
  };
}

/**
 * Normalise either storage shape to v2. v1 was a flat overrides record keyed
 * by document id; v2 carries overrides plus the reader's own documents.
 */
export function normalizeBrainState(raw: unknown): BrainState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_BRAIN_STATE;
  const record = raw as Record<string, unknown>;
  const isV2 = 'overrides' in record || 'created' in record;

  const overrides: Record<string, BrainOverride> = {};
  const overrideSource = isV2 ? record.overrides : raw;
  if (overrideSource && typeof overrideSource === 'object' && !Array.isArray(overrideSource)) {
    for (const [id, value] of Object.entries(overrideSource as Record<string, unknown>)) {
      const override = normalizeOverride(value);
      if (override) overrides[id] = override;
    }
  }

  const created: BrainDocument[] = [];
  if (isV2 && Array.isArray(record.created)) {
    for (const value of record.created) {
      const document = normalizeCreatedDocument(value);
      if (document) created.push(document);
    }
  }

  return { overrides, created };
}

/**
 * Apply the reader's local edits over the shipped guidance, and append the
 * documents they wrote, so the AI answers from the current wording rather
 * than the original text.
 */
export function mergeBrainDocuments(state: BrainState): BrainDocument[] {
  const merged = BRAIN_DOCUMENTS.map((document) => {
    const override = state.overrides[document.id];
    if (!override) return document;
    return {
      ...document,
      content: override.content ?? document.content,
      owner: override.owner ?? document.owner,
      conflict: override.conflict ?? document.conflict,
      reviewed: override.reviewed ?? document.reviewed,
    };
  });
  return [...merged, ...state.created.map((document) => ({ ...document, origin: 'yours' as const }))];
}
