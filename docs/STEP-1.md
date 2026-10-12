# Optific+ trial - Step 1

Data foundation only. No UI, no Next.js app yet. This document is the
"What exists / what's missing" read of the reference, the proposed structure,
and the data layer that will back Chat, BI, the Map and Today.

Reference: `Hakim Group.html` (Optific+ prototype) + Alex & Momin's email spec.

## 1. What exists vs what's missing (10 lines)

1. **Shell** - left rail (logo, org switcher, Workspace/Automations/People & logs, Brain, recent explorations, profile), top bar with Chat/Map tabs + breadcrumbs, responsive to mobile.
2. **Map** - canvas force-graph of 607 practices / 12 regions, zoom/pan, region filter, a "lens" selector (Region colours / People / Claims / Systems / Mentors), "Needs attention" toggle, legend and tooltip.
3. **Inspector** - practice search, group / region / practice / metric / entity detail views, paged directory, plus a local "create a review task" form and task list.
4. **Chat** - suggested-question chips, chat bubbles, source chips - but the "AI" is keyword/regex matching with **hard-coded** strings in the prose.
5. **Brain** - 5 sections (Operations, Finance & Claims, People & Training, Buying & Suppliers, Marketing), sample guidance docs, edit-guidance + source modals; state kept in `localStorage`.
6. **Automations / People & logs** - visual placeholders: workflow list, run history, editor modal; adoption cards, question/run log, CSV export.
7. **Visual identity** - warm cream canvas, coral/ink palette, `Inter`-style UI, a dark map variant and full responsive breakpoints. *(This is what we port, not redesign.)*
8. **Missing: Today tab** - no automatic "top 5 priorities"; the user must ask first.
9. **Missing: real BI** - no dashboards/charts computed from data, no conversation memory for follow-ups ("only show the North West", "break that down by practice"), and no LLM layer at all.
10. **Missing data underneath** - no contact-lens or training dataset, no map filters for either, chat→map highlighting is ad-hoc, and numbers are duplicated in prose with no single source of truth.

## 2. Proposed project structure

`[x]` built in Step 1 · `[ ]` planned (Next.js app comes later).

```
opticf-trial/
├─ data/                     [x]  generated CSVs (git-ignored, reproducible)
│  ├─ practices.csv
│  ├─ monthly_performance.csv
│  └─ training.csv
├─ src/
│  ├─ domain/
│  │  └─ types.ts            [x]  Practice, MonthlyPerformance, TrainingRecord, Dataset
│  ├─ lib/
│  │  ├─ csv.ts              [x]  pure CSV read/write
│  │  ├─ prng.ts             [x]  seeded RNG (deterministic data)
│  │  ├─ months.ts           [x]  YYYY-MM helpers (no clock access)
│  │  └─ format.ts           [x]  currency / percent formatters
│  ├─ data/                  [x]  THE data layer - all numbers come from here
│  │  ├─ dataset.ts              CSV <-> typed rows
│  │  ├─ load.ts                 the only fs boundary
│  │  ├─ metrics.ts              query_metrics()
│  │  ├─ compare.ts              compare()
│  │  ├─ training.ts             training_status()
│  │  ├─ attention.ts            rank_attention()
│  │  └─ index.ts                public surface
│  ├─ seed/
│  │  ├─ config.ts           [x]  40 practices, 5 regions, modules, planted stories
│  │  ├─ generate.ts         [x]  deterministic dataset generation
│  │  └─ index.ts            [x]  `npm run seed` CLI
│  ├─ scripts/
│  │  └─ demo.ts             [x]  `npm run demo` read-only report
│  └─ app/                   [ ]  Next.js App Router (Step 2)
│     ├─ (workspace)/            Map tab + inspector
│     ├─ chat/                   Chat + BI streaming answers
│     ├─ today/                  Today tab (top-5 priorities)
│     ├─ brain/                  Brain tab
│     └─ api/chat/route.ts       LLM route - calls the data layer, never maths
├─ tests/                    [x]  vitest - 32 tests
└─ package.json, tsconfig.json, vitest.config.ts
```

Planned app-side additions (Step 2+): `src/components/` (rail, topbar, map canvas,
inspector, chart primitives), `src/ai/` (tool definitions that wrap the data-layer
functions for the model), `src/state/` (map filters + conversation context).

## 3. The rule the architecture enforces

> The LLM never computes numbers. Every figure is produced by a pure function in
> `src/data/*` and is returned **with a pre-formatted display string**, so the
> model can only quote it.

- Pure: no `Date.now()`, no `Math.random()`, no I/O. "Current month" = latest month in the data.
- One seeded RNG → identical CSVs on every run.
- Same function powers a chart, a table and a chat answer, so they can never disagree.

### Function contracts

| Function | Question it answers |
|---|---|
| `query_metrics(dataset, query)` | "revenue & conversion across the group this month", dashboards, by region/practice |
| `compare(dataset, query)` | "biggest revenue drop vs last month", "North West vs other regions" |
| `training_status(dataset, query)` | "which practices haven't completed training?" |
| `rank_attention(dataset, options)` | "which practices need the most attention, and why?" → Today tab |

Each returns raw values (for charts) **and** formatted strings (for prose),
plus the evidence behind every signal.

### Planted stories (verified by tests)

- **North West decline** - revenue and conversion fall; every sharp NW practice appears in the top attention ranks (Chorlton first).
- **Contact lens below target** - 8 practices (Chorlton, Stockport, Chester, Plymouth, Oxford, Aberdeen, Bath, Worcester).
- **Incomplete training** - 9 practices, 4 with overdue modules.

### Dataset

- 40 practices · 5 regions (North West, South East, South West, Midlands, Scotland)
- 6 months: `2026-04` … `2026-09` (latest reported month = **Sep 2026**)
- 240 performance rows, 240 training rows

## 4. Commands

```bash
npm install
npm run seed       # generate data/*.csv
npm test           # 32 unit tests
npm run typecheck  # tsc --noEmit
npm run demo       # read-only report from the data layer
```
