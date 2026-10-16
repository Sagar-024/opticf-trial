# The dataset, hardened

Review artifact for the data rewrite. Written 2026-10-16. The generator changes landed and the suite is green; the UI sweep is next.

## Why this pass exists

The trial data is soft. Every practice has all six months of history, clean short names, whole pound amounts and no missing fields. A real pharmacy group produces the opposite, and the demo needs to prove Chat, BI, the map and the Brain survive it. This pass makes the data real, then sweeps the product for every screen that handles it badly.

Nothing here is a new feature. Every condition is a shape a real group produces, and every one is tied to a question the demo can ask.

## What stays

- Five regions, four mentors, and every planted story. North West decline, contact lens below target, training gaps, Chorlton's refund spike, Plymouth's goodwill cluster, Liverpool's above authority gesture.
- The May to October 2026 window, the deterministic seed, and the CSV columns. No schema change.

## Roster, 40 becomes 42

| id | name | region | condition |
|----|------|--------|-----------|
| P041 | Leek | Midlands | Opened September 2026. Sep and Oct rows only, two of five required modules complete, refunds from Sep. |
| P042 | Whitefield | North West | Divested end of August 2026. May to Aug rows only, nothing after. |

## Conditions

| # | condition | in the data | what it stresses | demo question |
|---|-----------|-------------|------------------|---------------|
| 1 | New opening | P041 Leek, two months of history | two point trend, mid onboarding training, region sums with a partial practice | How is our newest practice doing? |
| 2 | Divestment | P042 Whitefield stops reporting after Aug | a practice that leaves, region month-on-month inflated by the exit, "connected" counting | What happened to Whitefield? |
| 3 | Missing month | Bournemouth has no July performance rows, a system migration. Refunds continue from the other system | charts that zero fill a gap, "last six months" headings with five points | How has Bournemouth been trending? |
| 4 | Collapse in the latest month | Bristol down about 13 percent in October, a three week refit closure. Kept below the North West region fall so the region story stays intact | biggest faller tables, attention scoring, map node sizes | Why is Bristol's revenue down? |
| 5 | Duplicate names | Lichfield and Perth are both named High Street | name matching in chat, indistinguishable chips and tables | How is High Street doing? |
| 6 | Long name | Salisbury becomes "Salisbury (Catherine Street) Practice" | table scroll, chip truncation, canvas labels | Open Salisbury |
| 7 | Unknown refund reason | lens-defect rows on a few practices | the parser currently relabels unknown reasons as goodwill, which is a lie | Show me refunds |
| 8 | Missing refund fields | empty order references on a few rows, no authoriser where no manager is recorded | blank cells that should read Not recorded | Show me refunds |
| 9 | Zero amount refund | one voided row exported with amount 0 | sums, medians, row display | Show me refunds |
| 10 | Zero refund practice | Lancaster records no refunds all period | "0.0 percent of revenue" wording for a practice with no data, trend bars at zero | Which practices have unusual refunds? |
| 11 | At target, flat month | Maidstone lands exactly on target in Oct, and Sep equals Oct | boundary wording at 100 percent, 0.0 percent change rendered as "up on last month" | Which practices are below target? |
| 12 | Training date lost | Inverness GDPR completed, no date recorded | blank date cells | Which practices haven't completed their training? |
| 13 | No manager recorded | Brighton has no manager | people chips, refund authoriser, task owners | Who runs Brighton? |
| 14 | Brain context for the new stories | two new documents, Bristol refit and Whitefield divestment | chat grounding for conditions 2 and 4 | Why is Bristol's revenue down? |

## Demo questions this must survive

The thirteen turns from `npm run chat:test`, plus:

- How is our newest practice doing?
- What happened to Whitefield?
- How has Bournemouth been trending?
- Why is Bristol's revenue down?
- How is High Street doing?

## What we expect to break

From the code map, in rough order of demo risk.

1. Missing months are zero filled in charts, so July reads as a real zero for Bournemouth.
2. A one or two point trend disappears, because charts need two points.
3. A 0.0 percent change renders as "up on last month" and green.
4. A practice that stopped reporting still counts as connected and colours as failing.
5. Attention reads a missing latest month as no decline, and missing training rows as 100 percent complete.
6. Name matching picks the first High Street silently.
7. The reason mix relabels lens-defect as goodwill.
8. Blank fields render as blank cells instead of Not recorded.
9. The refund rate reads "0.0 percent of revenue" for a practice with no refunds at all.
10. "At target" wording at exactly 100 percent of plan.
11. The training answer lists practice IDs instead of names. This is already visible in the soft data baseline.
12. Long names force horizontal scroll or vanish from the canvas.

## Verification

- Typecheck and the full test suite green after every unit.
- One invariant script over the dataset, run before and after. It checks for no NaN or Infinity in any engine, group sums equal the sum of practices, and every practice's displays resolve.
- The thirteen chat questions re run. Old answers against new answers.
- A browser pass over Today, a chat dashboard, the map and the Brain.
- `docs/DEMO.md`, `README.md` and the pinned tests updated to the new numbers.

## Blast radius

Ten test files pin dataset numbers (seed, refunds, today, attention, map, widgets, automations, automation history, compare, output guard), plus `docs/DEMO.md` and `README.md`. All updated in the same pass. Nothing is deleted to make tests pass.

## Decision log

- 2026-10-16. Baseline captured at commit `f990784`. The four CSVs, the `npm run demo` report and thirteen chat answers are saved outside git. On soft data every answer is correct and unflagged, so any failure on the new data is a real one.
- 2026-10-16. Dead code removed as subtraction. `src/components/charts/revenue-bar.tsx` (hardcoded region revenues, unreferenced) and `src/components/map/compare-page.tsx` (unreferenced). Typecheck and 230 tests green.
- 2026-10-16. Roster 40 to 42 proposed. Two practices carry the acquisition and the divestment. Open for veto.
- 2026-10-16. The generator changes landed. Every untouched practice is byte-identical to the baseline: performance and training verified practice by practice, refunds verified with the touched set exempt. Typecheck clean, 239 tests green. The stable per-practice number replaced the roster position, so inserting a practice can never reshuffle another practice's training rotation.
- 2026-10-16. Two real bugs surfaced and were fixed rather than pinned around. A practice with no latest-month row was flagged as a contact-lens failure by attention and the map lenses; now it is outside the reporting estate, muted on the map, with no signals. The refund reason mix silently dropped rows whose reason the app had never seen; now they are bucketed as Other, so the mix always accounts for every payment and every pound.
- 2026-10-16. The thirteen chat questions re-run on the hard data. Every answer landed, every number traced, nothing flagged, slowest 11.2s. Bristol tops the biggest-fall table and the answer quotes 41 reporting practices; the training answer points at the table instead of listing raw ids.
- 2026-10-16. The UI sweep (U4) takes the predicted-breakage list below as its checklist. Charts with a gap, the no-data wordings on Today, the map inspector and the Brain panels, and the pinned numbers in docs/DEMO.md are still open.
- 2026-10-16. The sweep landed. Charts render a missing month as a gap, never a zero. A 0.0% change reads "unchanged" in neutral grey, never "up" in green. A divested practice shows its last reported month with a notice in the inspector, its refund tile reads "no refunds recorded", the map mutes it, and the top bar counts "41 of 42 practices reporting". Two practices sharing a name now carry their town everywhere a reader sees the label, and asking about "High Street" lists both rather than guessing. An empty manager reads "No manager recorded". The invariant script (`npm run invariants`) runs every engine against the CSVs and holds. The browser pass on Today, the map, the Brain (19 documents) and the chat confirms the live behaviour, including the High Street disambiguation answer. docs/DEMO.md and README.md now carry the true numbers.
- 2026-10-16. The polish round. "Why" questions lead with the size of the move: the practice tool carries the month-on-month change and prompt rule 4b says to quote it (the Bristol answer now opens with the fall). A practice that left the group shows its last reported month in the chat too, never a month of zeros. The output limit was raised from 1400 to 2200 tokens, and a cut-off answer now says so plainly instead of stopping mid-sentence; a test pins it. Prompt v12 also bans "I'll build" narration. docs/AUTOMATIONS.md was rewritten to match the shipped page: no review inbox, results queue themselves, watch findings create tasks immediately, and your own questions are first class skills. 240 tests green.
- 2026-10-16. The Brain grew two features. You can write your own guidance: a New document dialog on the Brain page, or "Add context for this practice" from a practice with no notes. Created documents merge into the same list the chat searches, so the AI cites your own words, and the practice page reads the merged list too. Documents older than 90 days show a Review due badge and the header counts them (the targets document is seeded stale so the demo shows it). The client state is one typed BrainState with a v1 migration from the old flat record, and the server sanitiser whitelists every created field, caps every length, and filters practice links to the loaded dataset. 252 tests green, typecheck clean, invariants hold. The live pass verified the whole loop: the header read 20 documents and 1 needs review, a new document saved with its Yours badge, the chat quoted it first with its owner and review date, and a practice with no notes (Plymouth) showed the gap and opened the create dialog prefilled with its name.
- 2026-10-16. Chat polish. Prompt v13 bans raw practice ids in prose. The landing chips carry six questions now, including the Bristol collapse and a Brain question. Both verified live.
- 2026-10-16. A live bug found by the user, fixed at the root. Asking "What does the Brain know about Chorlton?" answered that no practice context existed, while Chorlton's note sat right there. Cause: the model sent the practice name where the tool expected an id, and the tool's practice filter then excluded the very document about that practice. The tool now resolves whatever arrives, ids, names, or display names, and also scans the question itself for practice names, so a question that names a practice can never lose its recorded context to a bad argument. Prompt v14 requires the id, never the name. Reproduced with the live model before the fix and confirmed correct after; two tests pin it. 254 tests green.
- 2026-10-16. The composer button alignment, found by the user from a screenshot. The send button followed the blank line under the text, so after Shift+Enter it sat one line lower than the words. Both composers (the chat and the practice page ask bar) now keep the button on the last line that has words, and it moves with the text as a new line is typed. Measured live in three states, within 1px of the last text line, where it was 21px low before.
