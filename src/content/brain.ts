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
}

export const BRAIN_SECTIONS = [
  'Operations',
  'Finance & Claims',
  'People & Training',
  'Buying & Suppliers',
  'Marketing',
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
    reviewed: '2026-09-28',
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
];

/** Documents keyed by id, with local edits applied. */
export function brainDocumentById(id: string): BrainDocument | undefined {
  return BRAIN_DOCUMENTS.find((document) => document.id === id);
}
