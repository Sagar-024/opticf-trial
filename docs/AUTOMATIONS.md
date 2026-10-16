# Automations

One page. What we build, why, and what is real versus labelled.

## The principle

Automation means: when something happens in the data, the system prepares the
work so a person does not have to keep checking. The app stops being a place
you go to and starts coming to you.

Every step after "understand" used to be manual: remember to look, assemble
the numbers, decide who needs them, chase the follow-up. A skill kills those
four taxes with one loop:

> **Detect → Compose → Queue → Record** — on a cadence, without a human
> starting it.

Three hard rules, inherited from the product's trust architecture:

1. **Results queue themselves.** A run composes for the right people and is on
   the record the moment it lands. Nothing needs approving by hand, and watch
   findings also create the follow-up task straight away. The delivery pipe
   itself is labelled on screen until the backend lands.
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

Two kinds live on the page:

- **The shipped checks.** Six jobs, each wired to a tested engine: the Monday
  brief (scheduled, from `today_priorities`), and five watches (triggered,
  from `rank_attention` signals): contact lens below 90% of target, conversion
  down 2pp month on month, revenue down 3% month on month, refunds out of the
  ordinary (a spike against the practice's own level, a rate past 1% of
  revenue, or goodwill across the authority line), and required training
  overdue.
- **Your own questions.** A saved question in your own words runs through the
  same assistant the chat uses, on the clock you choose (daily, weekly,
  monthly and a time), and its answer queues for the recipients. This is the
  part the CEO asked for: users create their own skills, not just pick ours.

Scope is real. Watches can be narrowed to any set of the five regions; an
empty scope means the whole group. Recipients are real people, resolved from
the seed directory: group leadership (Sara Kelly), the five region leads
(Emma Lawson and the rest), the four mentors. A skill scoped to North West
goes to Emma Lawson. Results are checkable: every run is on the record, and
each enabled watch shows a live "8 matching right now" the moment the tab
opens.

## The page

1. **Skills** — one card per skill: the switch, the job sentence, where it
   looks, who it goes to, the last run, the next run, a live count, and
   delete.
2. **Your skills** — your own saved questions, newest first. A new one runs
   its first answer immediately and queues it for the recipients.
3. **New skill** — two doors. Start from a proven check, or write your own
   question. No blank prompt boxes; every choice is a real one.
4. **Tasks** — a watch finding creates its task immediately: the right owner
   (the practice manager, or the regional lead when the guidance says so), a
   due date, and the source it came from. One board, closed with an outcome.
5. **Activity** — the ledger: runs, queues, tasks and dismissals, newest
   first. **Reset** restores the demo state and re-seeds the history.

Runs, tasks, skills and the ledger live in this browser for now (like chat
history); a real run backend replaces the store, not the page.

## What is real versus labelled

**Real:** the conditions (evaluated server-side against the live dataset
through the same `rank_attention` as the map), every figure, the live counts,
the composition of the brief, the question runs through the live assistant,
the queueing, tasks with owners and dates, on/off, the activity ledger, and
the state surviving a reload.

**Labelled:** the delivery itself and the clock. "Queued for … Sending
connects when the backend lands", and schedules run while this tab is open
until the scheduler lands. The shipped checks are deterministic and free, so
they work with no LLM key configured; only your own questions use the model.

## Acceptance (two minutes)

1. Open **Automations** on a clean browser. Four skills, all on, each with its
   last run and next run. The live counts read **8** (contact lens), **4**
   (training overdue) and **3** (refunds), the planted stories, live.
2. The ledger already shows the seeded history: the Monday brief queued for
   Sara Kelly, the watches with their flagged counts, and two tasks created
   from findings.
3. Open **Tasks** on the rail: the watch findings are there with owners and
   due dates. Close one with an outcome and it leaves the open count.
4. **New skill** → **Your own question** → ask something like "Which
   practices are below their contact lens target?" → it runs once, the answer
   queues for the recipients, and the skill appears first under **Your
   skills**.
5. **Reset** restores the demo state and re-seeds the history.
6. **All 239 tests pass** (`npm test`), including `tests/automations.test.ts`:
   the brief is the Today list verbatim, contact lens finds exactly 8,
   training overdue exactly 4, the refund watch finds exactly 3 and routes
   Liverpool's hit to the regional lead, region scoping holds, and the route
   sanitiser rejects unknown jobs and malformed scopes.

## Where this goes next, in order

1. **Skills from chat.** After a good answer: "Run this every Monday" — the
   saved question becomes a skill with one tap, and chat becomes the place
   skills are born.
2. **Delivery, when the backend lands.** Email/Slack/WhatsApp per recipient,
   with per-recipient formatting. The routing is already modelled; only the
   pipe is missing.
3. **Admin tasks beyond alerts.** Recall campaigns, stock and order checks,
   holiday cover: anything with a cadence, a manager and a review date fits
   the same loop.
4. **Escalation.** A task that goes overdue nudges the region lead — one
   escalation, not a nag.
5. **Thursday's question.** Ask the managers: "What do you check every week,
   and what do you forget?" Their answer decides the next job in the
   catalogue, not our guesses.

## Files

| Path | What it is |
|---|---|
| `src/automations/types.ts` | Shared shapes (client-safe, types only) |
| `src/automations/catalog.ts` | Jobs, recipient directory, brief composer, labels |
| `src/automations/history.ts` | The seeded run history, composed from the same live data as real runs |
| `src/automations/engine.ts` | Watch evaluation and request sanitiser (server-only) |
| `src/app/api/automations/run/route.ts` | POST: evaluate a watch; content type, size and rate guards |
| `src/lib/automations-store.ts` | This-browser persistence (skills, runs, tasks, ledger) |
| `src/components/automations/` | The view and the skill builder |
| `tests/automations.test.ts` | The planted stories, scoping and sanitising |
