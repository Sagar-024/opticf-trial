/**
 * Static configuration for the seeded sample data.
 *
 * Everything here is fictional. The lists at the bottom (`CL_BELOW_TARGET`,
 * `TRAINING_GAP_PRACTICES`, `NORTH_WEST_SHARP_DECLINE`) deliberately plant the
 * stories the demo needs to surface, so the narratives are reproducible and
 * testable rather than emerging by luck.
 *
 * The second half of the file carries the real-world conditions: a practice
 * that opens mid window, one that is divested, a missing month, a refit
 * closure, duplicate names, messy source rows. `docs/DATA.md` maps every one
 * of them to the demo question it exists to survive.
 */

/** The six months of trading history, oldest first. */
export const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'] as const;

export const DEFAULT_SEED = 20261012;

export const NORTH_WEST_REGION = 'North West';

/** Mild month-to-month seasonality applied to every practice. */
export const SEASONALITY = [1.0, 0.975, 1.015, 0.995, 1.03, 1.02];

/** Revenue plan is this multiple of the practice baseline. */
export const REVENUE_TARGET_UPLIFT = 1.06;
/** Contact-lens revenue plan is this share of the practice baseline. */
export const CL_TARGET_SHARE = 0.145;
/** Group conversion standard, in percent. */
export const CONVERSION_TARGET = 64;

export interface PracticeConfig {
  practiceId: string;
  name: string;
  region: string;
  town: string;
  postcode: string;
  manager: string;
  mentorId: string;
  openedYear: number;
  pmsSystem: string;
  /** Rough monthly revenue baseline in whole GBP. */
  monthlyBaseline: number;
}

export interface RegionConfig {
  name: string;
  lead: string;
  mentorId: string;
}

export interface ModuleConfig {
  moduleId: string;
  moduleName: string;
  required: boolean;
}

export interface MentorConfig {
  mentorId: string;
  name: string;
  focus: string;
}

export const MENTORS: MentorConfig[] = [
  { mentorId: 'M1', name: 'Alex Morgan', focus: 'Conversion and dispensing cover' },
  { mentorId: 'M2', name: 'Sam Ellis', focus: 'Recall follow-up and appointment capacity' },
  { mentorId: 'M3', name: 'Jordan Blake', focus: 'Stock availability and local marketing' },
  { mentorId: 'M4', name: 'Priya Nair', focus: 'Team development and contact lens growth' },
];

export const REGIONS: RegionConfig[] = [
  { name: 'North West', lead: 'Emma Lawson', mentorId: 'M1' },
  { name: 'South East', lead: 'James Bennett', mentorId: 'M2' },
  { name: 'South West', lead: 'Priya Shah', mentorId: 'M3' },
  { name: 'Midlands', lead: 'Oliver Walsh', mentorId: 'M4' },
  { name: 'Scotland', lead: 'Sophie Clarke', mentorId: 'M2' },
];

export const MODULES: ModuleConfig[] = [
  { moduleId: 'CL-FIT', moduleName: 'Contact lens fitting', required: true },
  { moduleId: 'CL-AFT', moduleName: 'Contact lens aftercare', required: true },
  { moduleId: 'GDPR', moduleName: 'Data protection & GDPR', required: true },
  { moduleId: 'CLIN', moduleName: 'Clinical compliance', required: true },
  { moduleId: 'SAFE', moduleName: 'Safeguarding', required: true },
  { moduleId: 'CUST', moduleName: 'Customer service standards', required: false },
];

/** All 42 practices across five regions. */
export const PRACTICES: PracticeConfig[] = [
  // North West (11) - the declining region.
  { practiceId: 'P001', name: 'Chorlton', region: 'North West', town: 'Manchester', postcode: 'M21 9', manager: 'Rachel Doyle', mentorId: 'M1', openedYear: 2009, pmsSystem: 'VisionCore', monthlyBaseline: 90000 },
  { practiceId: 'P002', name: 'Didsbury', region: 'North West', town: 'Manchester', postcode: 'M20 2', manager: 'Tom Whitaker', mentorId: 'M1', openedYear: 2012, pmsSystem: 'VisionCore', monthlyBaseline: 78000 },
  { practiceId: 'P003', name: 'Altrincham', region: 'North West', town: 'Altrincham', postcode: 'WA14 1', manager: 'Nina Patel', mentorId: 'M1', openedYear: 2007, pmsSystem: 'PracticeOne', monthlyBaseline: 82000 },
  { practiceId: 'P004', name: 'Stockport', region: 'North West', town: 'Stockport', postcode: 'SK1 3', manager: 'Gary Hughes', mentorId: 'M1', openedYear: 2015, pmsSystem: 'VisionCore', monthlyBaseline: 68000 },
  { practiceId: 'P005', name: 'Wilmslow', region: 'North West', town: 'Wilmslow', postcode: 'SK9 1', manager: 'Helen Marsh', mentorId: 'M1', openedYear: 2001, pmsSystem: 'VisionCore', monthlyBaseline: 96000 },
  { practiceId: 'P006', name: 'Sale', region: 'North West', town: 'Sale', postcode: 'M33 7', manager: 'David Nolan', mentorId: 'M1', openedYear: 2014, pmsSystem: 'VisionCore', monthlyBaseline: 72000 },
  { practiceId: 'P007', name: 'Chester', region: 'North West', town: 'Chester', postcode: 'CH1 2', manager: 'Aisha Khan', mentorId: 'M1', openedYear: 2005, pmsSystem: 'OpticalSuite', monthlyBaseline: 88000 },
  { practiceId: 'P008', name: 'Liverpool', region: 'North West', town: 'Liverpool', postcode: 'L1 4', manager: 'Mark Ellis', mentorId: 'M1', openedYear: 2010, pmsSystem: 'VisionCore', monthlyBaseline: 102000 },
  { practiceId: 'P009', name: 'Preston', region: 'North West', town: 'Preston', postcode: 'PR1 2', manager: 'Laura Fielding', mentorId: 'M1', openedYear: 2016, pmsSystem: 'PracticeOne', monthlyBaseline: 76000 },
  { practiceId: 'P010', name: 'Lancaster', region: 'North West', town: 'Lancaster', postcode: 'LA1 1', manager: 'Simon Reid', mentorId: 'M1', openedYear: 2018, pmsSystem: 'VisionCore', monthlyBaseline: 64000 },
  // P042 was divested at the end of August 2026: rows stop after 2026-08.
  { practiceId: 'P042', name: 'Whitefield', region: 'North West', town: 'Manchester', postcode: 'M45 7', manager: 'Dean Ashworth', mentorId: 'M1', openedYear: 1998, pmsSystem: 'VisionCore', monthlyBaseline: 64000 },

  // South East (8)
  { practiceId: 'P011', name: 'Guildford', region: 'South East', town: 'Guildford', postcode: 'GU1 3', manager: 'Charlotte Webb', mentorId: 'M2', openedYear: 2003, pmsSystem: 'VisionCore', monthlyBaseline: 104000 },
  { practiceId: 'P012', name: 'Brighton', region: 'South East', town: 'Brighton', postcode: 'BN1 1', manager: '', mentorId: 'M2', openedYear: 2008, pmsSystem: 'VisionCore', monthlyBaseline: 92000 },
  { practiceId: 'P013', name: 'Oxford', region: 'South East', town: 'Oxford', postcode: 'OX1 2', manager: 'Meera Nair', mentorId: 'M2', openedYear: 2011, pmsSystem: 'OpticalSuite', monthlyBaseline: 98000 },
  { practiceId: 'P014', name: 'Reading', region: 'South East', town: 'Reading', postcode: 'RG1 1', manager: 'Paul Garner', mentorId: 'M2', openedYear: 2013, pmsSystem: 'VisionCore', monthlyBaseline: 86000 },
  { practiceId: 'P015', name: 'Woking', region: 'South East', town: 'Woking', postcode: 'GU21 6', manager: 'Zoe Bennett', mentorId: 'M2', openedYear: 2017, pmsSystem: 'VisionCore', monthlyBaseline: 70000 },
  { practiceId: 'P016', name: 'Canterbury', region: 'South East', town: 'Canterbury', postcode: 'CT1 2', manager: 'Ruth Dennis', mentorId: 'M2', openedYear: 2006, pmsSystem: 'PracticeOne', monthlyBaseline: 74000 },
  { practiceId: 'P017', name: 'Windsor', region: 'South East', town: 'Windsor', postcode: 'SL4 1', manager: 'Alan Price', mentorId: 'M2', openedYear: 2004, pmsSystem: 'VisionCore', monthlyBaseline: 90000 },
  { practiceId: 'P018', name: 'Maidstone', region: 'South East', town: 'Maidstone', postcode: 'ME14 1', manager: 'Becky Lowe', mentorId: 'M2', openedYear: 2019, pmsSystem: 'VisionCore', monthlyBaseline: 66000 },

  // South West (8)
  { practiceId: 'P019', name: 'Bath', region: 'South West', town: 'Bath', postcode: 'BA1 1', manager: 'Fiona Grant', mentorId: 'M3', openedYear: 2002, pmsSystem: 'VisionCore', monthlyBaseline: 94000 },
  { practiceId: 'P020', name: 'Bristol', region: 'South West', town: 'Bristol', postcode: 'BS1 5', manager: 'Craig Morrison', mentorId: 'M3', openedYear: 2009, pmsSystem: 'VisionCore', monthlyBaseline: 108000 },
  { practiceId: 'P021', name: 'Exeter', region: 'South West', town: 'Exeter', postcode: 'EX1 1', manager: 'Nadia Rahman', mentorId: 'M3', openedYear: 2015, pmsSystem: 'PracticeOne', monthlyBaseline: 72000 },
  { practiceId: 'P022', name: 'Truro', region: 'South West', town: 'Truro', postcode: 'TR1 2', manager: 'Owen Blake', mentorId: 'M3', openedYear: 2016, pmsSystem: 'VisionCore', monthlyBaseline: 58000 },
  { practiceId: 'P023', name: 'Taunton', region: 'South West', town: 'Taunton', postcode: 'TA1 1', manager: 'Karen Shaw', mentorId: 'M3', openedYear: 2013, pmsSystem: 'VisionCore', monthlyBaseline: 62000 },
  { practiceId: 'P024', name: 'Plymouth', region: 'South West', town: 'Plymouth', postcode: 'PL1 1', manager: 'Steve Harper', mentorId: 'M3', openedYear: 2010, pmsSystem: 'OpticalSuite', monthlyBaseline: 80000 },
  { practiceId: 'P025', name: 'Salisbury (Catherine Street) Practice', region: 'South West', town: 'Salisbury', postcode: 'SP1 2', manager: 'Julia Frost', mentorId: 'M3', openedYear: 2012, pmsSystem: 'VisionCore', monthlyBaseline: 68000 },
  { practiceId: 'P026', name: 'Bournemouth', region: 'South West', town: 'Bournemouth', postcode: 'BH1 1', manager: 'Lee Chapman', mentorId: 'M3', openedYear: 2007, pmsSystem: 'VisionCore', monthlyBaseline: 84000 },

  // Midlands (8)
  { practiceId: 'P027', name: 'Birmingham', region: 'Midlands', town: 'Birmingham', postcode: 'B1 1', manager: 'Darren Wells', mentorId: 'M4', openedYear: 2005, pmsSystem: 'VisionCore', monthlyBaseline: 112000 },
  { practiceId: 'P028', name: 'Solihull', region: 'Midlands', town: 'Solihull', postcode: 'B91 3', manager: 'Priya Menon', mentorId: 'M4', openedYear: 2011, pmsSystem: 'VisionCore', monthlyBaseline: 96000 },
  { practiceId: 'P029', name: 'Coventry', region: 'Midlands', town: 'Coventry', postcode: 'CV1 1', manager: 'Neil Abbott', mentorId: 'M4', openedYear: 2014, pmsSystem: 'PracticeOne', monthlyBaseline: 78000 },
  { practiceId: 'P030', name: 'Warwick', region: 'Midlands', town: 'Warwick', postcode: 'CV34 4', manager: 'Sophie Dunn', mentorId: 'M4', openedYear: 2017, pmsSystem: 'VisionCore', monthlyBaseline: 74000 },
  { practiceId: 'P031', name: 'Worcester', region: 'Midlands', town: 'Worcester', postcode: 'WR1 2', manager: 'Ian Broadbent', mentorId: 'M4', openedYear: 2008, pmsSystem: 'OpticalSuite', monthlyBaseline: 66000 },
  { practiceId: 'P032', name: 'Shrewsbury', region: 'Midlands', town: 'Shrewsbury', postcode: 'SY1 1', manager: 'Marie Coles', mentorId: 'M4', openedYear: 2010, pmsSystem: 'VisionCore', monthlyBaseline: 70000 },
  { practiceId: 'P033', name: 'High Street', region: 'Midlands', town: 'Lichfield', postcode: 'WS13 6', manager: 'Rob Kendal', mentorId: 'M4', openedYear: 2016, pmsSystem: 'VisionCore', monthlyBaseline: 64000 },
  // P041 opened in September 2026: Sep and Oct rows only, mid onboarding.
  { practiceId: 'P041', name: 'Leek', region: 'Midlands', town: 'Leek', postcode: 'ST13 5', manager: 'Hannah Pryce', mentorId: 'M4', openedYear: 2026, pmsSystem: 'PracticeOne', monthlyBaseline: 52000 },

  // Scotland (7)
  { practiceId: 'P034', name: 'Edinburgh', region: 'Scotland', town: 'Edinburgh', postcode: 'EH1 1', manager: 'Callum Fraser', mentorId: 'M2', openedYear: 2003, pmsSystem: 'VisionCore', monthlyBaseline: 106000 },
  { practiceId: 'P035', name: 'Glasgow', region: 'Scotland', town: 'Glasgow', postcode: 'G1 2', manager: 'Isla Cameron', mentorId: 'M2', openedYear: 2006, pmsSystem: 'VisionCore', monthlyBaseline: 100000 },
  { practiceId: 'P036', name: 'Aberdeen', region: 'Scotland', town: 'Aberdeen', postcode: 'AB10 1', manager: 'Fiona Sinclair', mentorId: 'M2', openedYear: 2009, pmsSystem: 'OpticalSuite', monthlyBaseline: 82000 },
  { practiceId: 'P037', name: 'Dundee', region: 'Scotland', town: 'Dundee', postcode: 'DD1 1', manager: 'Andrew Baxter', mentorId: 'M2', openedYear: 2012, pmsSystem: 'VisionCore', monthlyBaseline: 70000 },
  { practiceId: 'P038', name: 'Stirling', region: 'Scotland', town: 'Stirling', postcode: 'FK8 1', manager: 'Mhairi Ross', mentorId: 'M2', openedYear: 2015, pmsSystem: 'PracticeOne', monthlyBaseline: 66000 },
  { practiceId: 'P039', name: 'High Street', region: 'Scotland', town: 'Perth', postcode: 'PH1 5', manager: 'Graham Muir', mentorId: 'M2', openedYear: 2018, pmsSystem: 'VisionCore', monthlyBaseline: 62000 },
  { practiceId: 'P040', name: 'Inverness', region: 'Scotland', town: 'Inverness', postcode: 'IV1 1', manager: 'Kirsty Douglas', mentorId: 'M2', openedYear: 2019, pmsSystem: 'VisionCore', monthlyBaseline: 60000 },
];

/**
 * Story 1 - the North West declines. These practices drop faster than the rest
 * of the region on both revenue and conversion.
 */
export const NORTH_WEST_SHARP_DECLINE = ['P001', 'P002', 'P004', 'P007'];

/**
 * Story 2 - practices whose contact-lens revenue sits clearly below target
 * regardless of their region's trend.
 */
export const CL_BELOW_TARGET = ['P001', 'P004', 'P007', 'P013', 'P019', 'P024', 'P031', 'P036'];

/**
 * Story 3 - practices with incomplete required training.
 */
export const TRAINING_GAP_PRACTICES = ['P002', 'P005', 'P009', 'P012', 'P017', 'P022', 'P028', 'P033', 'P038'];

/** Overrides that pin Chorlton's headline numbers to the reference prototype. */
export const CONVERSION_OVERRIDES: Record<string, { start: number; end: number }> = {
  P001: { start: 63, end: 54 },
};

// ── Refunds and goodwill ─────────────────────────────────────────────────────

/** Gestures above this need the regional lead (the Brain's policy). */
export const GOODWILL_AUTHORITY_LIMIT = 50;

/**
 * Story 4 - Chorlton's refunds: frame replacements climb sharply from August,
 * matching its recorded context (refit, local supply account, no warranty term
 * sheet attached). The timing is planted; the cause is context, never proof.
 */
export const REFUND_SPIKE_PRACTICES = ['P001'];

/**
 * Story 5 - Plymouth hands out many gestures just under the authority line
 * (£40-49), the pattern of staying below approval.
 */
export const GOODWILL_CLUSTER_PRACTICES = ['P024'];

/**
 * Story 6 - Liverpool records a goodwill gesture above £50 without the
 * regional lead's approval: the policy check firing on real rows.
 */
export const ABOVE_AUTHORITY_PRACTICES = ['P008'];

// ── The shape of the estate ──────────────────────────────────────────────────

/**
 * Story 7 - the group changes shape mid window. Leek opens in September with
 * two months of history; Whitefield is divested at the end of August and stops
 * reporting. Comparisons must read these as estate changes, not trading.
 */
export const OPENED_MID_WINDOW: Record<string, { fromMonth: string }> = {
  P041: { fromMonth: '2026-09' },
};
export const DIVESTED_AFTER: Record<string, { lastMonth: string }> = {
  P042: { lastMonth: '2026-08' },
};

/** A new practice is mid onboarding: only this many required modules are complete. */
export const NEW_PRACTICE_REQUIRED_COMPLETE: Record<string, number> = {
  P041: 2,
};

/**
 * Story 8 - Bournemouth's practice system was migrated in July and no
 * performance rows exist for that month. Refunds come from a separate system
 * and continue as normal.
 */
export const MISSING_PERFORMANCE_MONTHS: Record<string, string[]> = {
  P026: ['2026-07'],
};

/**
 * Story 9 - Bristol closed for a three week refit in October. The fall is
 * sized to stay below the North West region's fall, so the region story keeps
 * its shape. Recorded context lives in the Brain (`ctx-bristol`).
 */
export const COLLAPSE_MONTH: Record<string, { month: string; revenueFactor: number; examFactor: number }> = {
  P020: { month: '2026-10', revenueFactor: 0.87, examFactor: 0.9 },
};

/**
 * Story 10 - Maidstone lands exactly on plan in the latest month and was flat
 * the month before. Tests the boundary wording at 100 percent and the zero
 * change rendering.
 */
export const EXACT_TARGET_PRACTICES = ['P018'];

/**
 * Story 11 - messy source rows, exactly as an export produces them. An unknown
 * reason code the app has never seen, two lost order references, one voided
 * payment exported at zero, a completed module with no date recorded, and a
 * practice that records no refunds at all. The parser is the boundary that
 * must normalise the unknown code; nothing downstream may guess.
 */
export const UNKNOWN_REASON_PRACTICES = ['P014', 'P037'];
/** Deliberately not part of the app's vocabulary; the parser maps it to `other`. */
export const UNKNOWN_REASON_CODE: string = 'lens-defect';
export const MISSING_ORDER_REF_PRACTICES = ['P006'];
export const ZERO_AMOUNT_REFUND_PRACTICES = ['P032'];
export const NO_REFUND_PRACTICES = ['P010'];
export const TRAINING_DATE_MISSING: Record<string, string[]> = {
  P040: ['GDPR'],
};
