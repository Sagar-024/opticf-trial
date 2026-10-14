# Automations

One page. What we build, why, and what is real versus labelled.

## The principle

Automation means: when something happens in the data, the system prepares the
work so a person does not have to keep checking. The app stops being a place
you go to and starts coming to you.

Every step after "understand" used to be manual: remember to look, assemble
the numbers, decide who needs them, chase the follow-up. A skill kills those
four taxes with one loop:

> **Detect → Compose → Review → Approve → Record** — on a cadence, without a
> human starting it.

Three hard rules, inherited from the product's trust architecture:

1. **Nothing is sent automatically.** Every output lands in a review inbox
   and a person approves it.
2. **Nothing acts alone.** No target changes, no refunds, no messages to
   patients. Notify and create tasks only. A wrong alert is annoying; a wrong
   action is an incident.
3. **Every figure is quoted, never computed.** Runs are composed from the
   same `today_priorities` and `rank_attention` the Today tab, the map and
   the chat use, so a run can never disagree with the app.

The one thing a prototype cannot do, actually delivering email or WhatsApp,
is labelled on screen, never faked.

## What "skills" means here

Our version of ChatGPT skills. A **skill** is a saved piece of recurring work:

**job + trigger + scope + recipients + on/off switch + visible run history.**

- **Jobs are real.** Five ship in the catalogue, each wired to a tested
  engine: the Monday brief (scheduled, from `today_priorities`), and four
  watches (triggered, from `rank_attention` signals): contact lens below 90%
  of target, conversion down 2pp month on month, revenue down 3% month on
  month, required training overdue.
- **Scope is real.** Watches can be narrowed to any set of the five regions;
  an empty scope means the whole group.
- **Recipients are real people.** Resolved from the seed directory: group
  leadership (Sara Kelly), the five region leads (Emma Lawson and the rest),
  the four mentors. A skill scoped to North West goes to Emma Lawson.
- **Results are checkable.** Every run is on the record, and each enabled
  watch shows a live "8 matching right now" the moment the tab opens.

## The page

1. **Skills** — one card per skill: the switch, the job sentence, where it
   looks, who it goes to, the last run, a live count, and Run now.
2. **New skill** — the builder: pick the job, name it, pick regions, pick
   recipient groups. No blank prompt boxes; every choice is a real one.
3. **Review inbox** — brief runs land as the five priorities with their real
   figures; watch runs land as per-practice hits, each with the evidence
   sentence from the attention engine and the headline figure. Approve,
   discard, or approve all. An individual hit can be asked about in chat or
   shown on the map without leaving the review.
4. **Tasks** — approving a hit creates one: the practice manager as owner, a
   review date (default +7 days, editable), a done box. One action, one
   owner, one review date. If a practice already has an open task for the
   same watch, the row says **Task open** instead of creating a duplicate.
5. **Activity** — the ledger: runs, approvals, tasks and dismissals, newest
   first. "Check results from your skills" is exactly this plus the inbox.

Runs, tasks, skills and the ledger live in this browser for now (like chat
history); a real run backend replaces the store, not the page.

## What is real versus labelled

**Real:** the conditions (evaluated server-side against the live dataset
through the same `rank_attention` as the map), every figure, the live counts,
the composition of the brief, the inbox, approve and discard, tasks with
owners and dates, the duplicate guard, on/off, the activity ledger, and the
state surviving a reload.

**Labelled:** the delivery itself. "Queued for … Sending connects when the
backend lands." No model runs inside a skill; every run is deterministic and
free, which is also why runs work with no LLM key configured.

## Acceptance (two minutes)

1. Open **Automations** on a clean browser. Three skills, all on. Contact
   lens watch reads **8 matching right now**, training **4** — the planted
   stories, live.
2. **Run now** on the Monday brief. The inbox shows five priorities with real
   figures. Approve: it reads Approved, "Queued for Sara Kelly". Reload: it
   is still there.
3. **Run now** on the Contact lens watch. Eight hits with evidence. Approve
   Chorlton: a task appears — owner Rachel Doyle, due a week out — the hit row
   reads "Task for Rachel Doyle", Tasks shows 1 open, the ledger has the line.
   Mark it done.
4. **New skill** → Revenue watch → Where: North West → Create. The card shows
   its own live count scoped to the region, and Goes to Emma Lawson.
5. Toggle any watch off: Paused, no runs. On again: it checks.
6. **All 177 tests pass** (`npm test`), including `tests/automations.test.ts`:
   the brief is the Today list verbatim, contact lens finds exactly 8,
   training overdue exactly 4, region scoping holds, and the route sanitiser
   rejects the brief, unknown jobs and malformed scopes.

## Where this goes next, in order

1. **Assistant-run skills.** A skill that asks the chat engine a saved
   question and lands the guarded answer plus its widgets in review. The
   pipeline (tools, number guard, trace) already exists; runs would be real,
   bounded and costed.
2. **Skills from chat.** After a good answer: "Run this every Monday" — the
   saved question becomes a skill with one tap, and chat becomes the place
   skills are born.
3. **Delivery, when the backend lands.** Email/Slack/WhatsApp per recipient,
   with per-recipient formatting. The routing is already modelled; only the
   pipe is missing.
4. **Admin tasks beyond alerts.** Recall campaigns, stock and order checks,
   holiday cover: anything with a cadence, a manager and a review date fits
   the same loop.
5. **Escalation.** A task that goes overdue nudges the region lead — one
   escalation, not a nag.
6. **Thursday's question.** Ask the managers: "What do you check every week,
   and what do you forget?" Their answer decides the next job in the
   catalogue, not our guesses.

## Files

| Path | What it is |
|---|---|
| `src/automations/types.ts` | Shared shapes (client-safe, types only) |
| `src/automations/catalog.ts` | Jobs, recipient directory, brief composer, labels |
| `src/automations/engine.ts` | Watch evaluation and request sanitiser (server-only) |
| `src/app/api/automations/run/route.ts` | POST: evaluate a watch; content type, size and rate guards |
| `src/lib/automations-store.ts` | This-browser persistence (skills, runs, tasks, ledger) |
| `src/components/automations/` | The view and the skill builder |
| `tests/automations.test.ts` | The planted stories, scoping and sanitising |
