# The Practice Brain overlay: design rationale

The one-page rationale that ships with the scaffold, per the architect workflow. Read this before the code.

## Problem

The Brain holds the group's written guidance as flat documents. The chat can search it through `search_brain`, but there is no surface where a reader can see the whole knowledge layer at once, nor a way to ask the Brain directly without a general-purpose chat that also serves analytics. The user asked for three things: a live status pill in the chat's bottom-left corner, a full-page Brain view over the chat with a node graph of the real documents, and an ask bar above the graph that answers only from the Brain.

Constraints that shaped the design:

- The main chat pipeline (`/api/chat`, `runChatStream`) is the most safety-critical code in the app (grounding retry, number tracing, injection guards, caching, rate limits). It must not change behavior.
- The map canvas is the most intricate component in the app. Refactoring it to share infrastructure with a brain graph was on the table and was rejected (see Alternatives).
- Brain documents live in localStorage as `BrainState` (overrides plus the reader's own documents) and travel to the server as untrusted input. `sanitizeBrainOverrides` is the only door in.
- Vitest runs node-only over `tests/**/*.test.ts`, so every nontrivial rule (layout, retrieval, prompt building) must live in pure modules to be testable.
- House style: no em or en dashes anywhere, existing design tokens only, no new dependencies.

## Usage (caller's view)

The pill lives in the chat composer's footer row and is self-sufficient:

```tsx
<div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
  <BrainPill onOpen={() => setBrainOpen(true)} />
  <p className="text-xs text-[color:var(--ink-3)]">Enter to send · Shift+Enter for new line</p>
  <span aria-hidden />
</div>
```

The overlay is mounted by ChatView and hands off to the Brain tab only when the reader asks for it:

```tsx
{brainOpen ? (
  <BrainOverlay
    onClose={() => setBrainOpen(false)}
    practiceName={practiceName}                  // '(id) => name', from the workspace
    onOpenDocument={(title) => { setBrainOpen(false); onOpenBrain?.(title); }}
  />
) : null}
```

Asking is one fetch to the dedicated route; retrieval happens server-side:

```ts
const response = await fetch('/api/brain/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question, history: recentTurns, brainOverrides: readBrainState() }),
  signal: controller.signal,
});
```

## Shape

Data structures first, in `src/brain/`:

- `graph.ts` is the knowledge model as a graph. `buildBrainGraph(documents)` returns nodes, edges, stats and bounds; the hub sits at the origin, sections ring around it, each section's documents cluster beside it, owners sit on the outer ring. Placement is seeded and pure, so a node moves only when the data changed. `deriveBrainSuggestions(documents)` produces starting questions from real signals (the conflicting document, an overdue review, recorded practice context, then one per section). It is the only source of the chips.
- `retrieve.ts` is the one ranking path for the corpus. The chat's `search_brain` tool and the overlay both go through `rankDocuments` and `selectBrainDocuments`, so the same corpus can never rank two ways. `retrieve()` adds the ask-specific pieces: follow-up normalization, practice resolution, and the prompt budget (4 documents, 1200 characters each, 5000 total). `citedDocumentIds()` filters citation ids against what was retrieved, so an invented id can never become a chip.
- `ask.ts` is the ask surface's server side: the rules block (versioned `brain-ask-v1`), the message builder that places document text only between `<<<` and `>>>`, the canned no-match answer that costs no model call, and `answerFromBrain()`, one grounded generation with an injectable client. Numbers in the answer are traced against the quoted documents plus the question, secrets are redacted, and unsupported figures trigger one rewrite before the answer is withdrawn.
- `src/app/api/brain/ask/route.ts` is the transport: the chat route's guard order, its own rate-limit bucket (`caller:<ip>:brain`, 12/min), its own 10 minute cache keyed on prompt version, question, history and sanitized overrides, and NDJSON events `meta | delta | done | error`. `meta` always arrives first so the client can map citations to documents even on a cache hit.

The client side:

- `src/lib/brain-store.ts` grows one hook, `useBrainDocuments()`, built on `useSyncExternalStore`. `writeBrainState` notifies same-tab listeners; a lazily attached `storage` listener covers other tabs. The snapshot is memoized on the raw stored string so the identity is stable while nothing changed.
- `src/components/brain/brain-canvas.tsx` draws the graph: canvas 2D, DPR capped at 2, transform kept in a ref, rAF-coalesced repaints, drag to pan, wheel to zoom at the pointer, keyboard arrows and +/-, hover tooltips, a zoom cluster, a dotted world background, and a fly-to handle the overlay calls when a citation chip is clicked. It imports only `readPalette` from the map's palette module and two pure helpers from `src/components/canvas/ink.ts` (extracted from the map canvas with no behavior change).
- `src/components/brain/brain-overlay.tsx` is the page itself: Radix Dialog primitives for focus trap, Escape and restore; header with breadcrumb, title, subtitle and close; the ask bar and derived chips; the latest answer with citation chips that highlight and fly to the exact document nodes; the graph with its legend row; and a document detail panel that opens on a node click and offers "Ask about this" and "Open in the Brain".
- `src/components/chat/brain-pill.tsx` reads the live documents and shows "Connected to your Practice Brain" with the real count and review-due signal.

Invariants encoded in types: node ids are namespaced (`doc:`, `sec:`, `own:`, `hub`) so a citation, a node and an edge endpoint can never disagree; `BrainAskEvent` is the only wire shape; `BrainRetrieval` carries its own truncation count. Validation stays at the boundary (the route), the domain functions are pure, and the UI trusts them (`per boundary-discipline`).

The surface is deliberately deep and small: callers pass documents or a question and get a graph or an answer; nothing in the call sites coordinates retrieval, prompt building, streaming or citation mapping.

## Synthesis decision

Base: the retrieval-first candidate (dedicated route, deterministic retrieval, one grounded generation, citations by document id, no map refactor). Adapted from the reuse-first candidate: the ring layout with each section's documents clustered beside it and owners on the outer ring; the footer-row pill placement; the fly-to single-node zoom cap; the "Ask about this" prefill; the shared-budget test discipline. Rejected: reusing `/api/chat` with a scoped tool loop (touches the chat pipeline's tool gating, grounding retry, prompt and cache in seven files, and pays a tool round-trip per ask), and extracting the map canvas's viewport engine into a shared hook (the highest-risk change available, for a DRY gain the feature does not need).

## Tradeoffs accepted

- We accept a second prompt and a second route to maintain, in exchange for zero behavioral change to the chat pipeline and deterministic retrieval the tests can pin.
- We accept duplicated viewport plumbing (roughly 150 lines) inside the brain canvas in exchange for never touching the map canvas's draw loop.
- We accept lexical retrieval (no embeddings) because the corpus is 23 short documents and the scoring is already tested and injection-guarded; semantic retrieval is a later server-side upgrade.
- We accept owner nodes built from free-text owner fields (teams like "People team" read as nodes), folded above 12 nodes, because the alternative (a people registry) does not exist in the data.
- We accept single-turn display (the answer strip shows the latest answer; earlier turns only feed model context) so the graph stays the hero.
- We accept citation ids being stripped from the displayed text and rendered as chips, so readers never see `[warranty]` inline.

## Alternatives considered

- Reuse `/api/chat` with a brain scope flag. It hides less complexity than it looks: the caller gets the whole chat apparatus (widgets, map highlight, analytics context) and the maintainer must keep two behaviors apart inside one pipeline. It lost on interface depth and blast radius.
- Extract `useCanvasViewport` from the map canvas and share it. Deep in principle, but the extraction's blast radius includes every map interaction (drill, rings, focus mode, compare) with no DOM tests; it lost on risk, not on elegance.
- DOM/SVG nodes instead of canvas. Trivial hover and focus, but label collision still needs measured boxes per frame and pan/zoom re-transforms ~40 elements per frame; it lost on interaction fidelity against the map, which is the benchmark the user named.
- Render the tool's `search_brain` table widget in the overlay. It duplicates what the graph shows and drags widget state into a scoped surface; it lost on focus.

## Open questions and risks

- Owner strings are free text; a rename creates a new owner node. Acceptable at this scale, but is a canonical owner list wanted later?
- Citation scanning on the client re-scans the accumulating text on each delta. With 2 to 5 sentence answers this is free; flag it if answers grow.
- The ask route shares the model key with chat; the separate rate-limit bucket protects the key but the trial budget is shared. Is a lower ask budget wanted?
- Duplicate document titles would break any future title-keyed lookup (citations use ids precisely to avoid this). Should titles be unique?

## Next implementation step

Fill `src/brain/graph.ts` and `src/brain/retrieve.ts` (pure, tested), then `ask.ts` and the route, then the canvas, overlay and pill.
