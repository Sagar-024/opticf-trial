# Demo day

Everything in the brief is built. This is the checklist and the 5 minute walkthrough.

## 1. Before the call, 2 minutes

```bash
cd C:\Users\Sagar\OneDrive\Desktop\opticf-trial
npm run seed        # regenerate the sample data (deterministic)
npm run dev         # http://localhost:3000
```

The hosted copy for the call is **https://opticf-trial.vercel.app**. The walkthrough below works on either one;
keep the local server running as the backup. The hosted build generates its own data from the same seed.

Then in the browser:

1. Open http://localhost:3000 and **hard refresh** (`Ctrl+Shift+R`).
2. Confirm `.env.local` still has `LLM_BASE_URL`, `LLM_API_KEY`, `MODEL_NAME`, `LLM_SESSION`.
3. Optional: reset the demo to a clean state. Open DevTools console and run
   `localStorage.clear()` then reload. That clears the chat thread, any Brain edits and the theme choice.
4. Keep the browser window **visible and in the foreground**. Two things need real frames: the map's
   animations, and the Dither Kit chart bars (they paint on animation frames, so a background tab shows
   axes but no bars).

> **Never run `npm run build` while `npm run dev` is running.** They share the `.next` folder and the
> dev server breaks (unstyled page, 500s, missing CSS). If the page ever looks unstyled: stop the
> server, delete `.next` (`Remove-Item -Recurse -Force .next`), then `npm run dev` again.

Sanity check, one command that tells you the model is reachable and can call tools:

```bash
npm run llm:check
```

## 2. The 5 minute walkthrough

### Today (30 seconds)

1. The app opens on **Today**. Five priorities for Oct 2026, across 40 practices.
2. Point at the first card: North West, revenue and conversion both falling.
3. Click **Open region** on that card. You land on the map, region set to North West.
4. Go back to Today, click **Open practice** on the Chorlton card. Map opens with 1 highlighted.
5. Back to Today, click **Open dashboard** on a card. Chat opens and asks the question for you.

### Chat and BI (2 minutes)

6. Go to **Chat** and click the first suggestion: "Create a dashboard showing revenue and conversion across the group this month."
   - Expect: a KPI card, then dithered bar charts by region, then a table. Answers stream in.
   - Note the **Sources** chips under the answer.
7. Ask a follow-up without repeating yourself: type **Only show the North West**.
   - Expect: it keeps the same metric and just narrows the scope.
8. Then type **Break that down by practice**.
   - Expect: same region, now per practice.
9. Ask **Which practices have had the biggest revenue drop compared with last month?**
   - Expect: a ranked table, worst first, and a named worst practice.
10. Ask **Why did North West revenue drop?**
    - Expect: it shows the fall and then says the data does not explain why. It must not invent a cause.
11. Ask **Which practices need the most attention, and what in the data suggests that?**
    - Expect: ranked practices with the evidence behind each score.
12. Click **Show N practices on the map** on that answer.

### The map (2 minutes)

13. You arrive with the matches highlighted and everything else dimmed. The lens has auto-selected.
14. Click the **lens** dropdown and step through: Region, Sales, Contact lens, Training, Mentors.
    - Each one recolours, relabels the legend, and offers its own filters.
15. On **Contact lens**, click **Below 90% of target**. Expect **8 of 40 matching**.
16. On **Training**, click **Training incomplete**. Expect **9 of 40**. Overdue gives 4.
17. On **Mentors**, the strip becomes **Mentor portfolios**: four mentors, each with revenue, conversion
    change and how many practices grew. Click one to highlight their practices.
18. Click a single practice node to open the inspector: metrics, six month trend, the evidence behind its
    attention score, training gaps, context from the Brain, mentor, and buttons to ask about it or highlight it.
19. Press the **Focus** button in the bottom centre cluster. The shell animates away and the graph fills
    the screen. Press **Esc** or **Exit focus** to come back.
20. Try **Fit**, the **+ / -** buttons and the scroll wheel to zoom.

### The Brain (1 minute)

21. Go to **Brain**. Six sections, 17 documents, each with an owner, a review date and a scope.
22. Search **warranty** and open the procedure. Note it says guidance is cited in chat sources.
23. Click **Edit** on that document, change the wording, and **Save**. The card shows an **Edited** badge.
24. Go back to **Chat** and ask **How do we handle a frame warranty claim?**
    - Expect: it quotes **your edited wording**, and the source chip opens the document in the Brain.
    - That is the proof that guidance edits reach the AI.
25. Ask **What do we know about Chorlton?**
    - Expect: it searches the Brain, returns the **Practice context** documents and cites them.
    - This is the knowledge layer working alongside the numbers, for one specific practice.
26. Filter **Practice context** and open the Chorlton note. Click the **Chorlton** chip on the card: it
    jumps to the map with the practice highlighted. On the map, open Chorlton's sheet and the same
    document appears under **Context from the Brain**. Knowledge and place point at each other.
27. Mark a document as conflicting, ask about it, and it will say clarification is required.

### Light and dark (15 seconds)

28. Toggle the sun/moon in the top bar. Everything follows, including the map canvas and the charts.

## 3. If something goes wrong

| Symptom | Cause and fix |
|---|---|
| Chat says "LLM not configured" | `.env.local` missing or the dev server was started before it existed. Restart `npm run dev`. |
| Chat error 401 / 403 | Key is wrong or lacks access to the model. Check `MODEL_NAME` with `npm run llm:check`. |
| Chat error 429 | Rate limit. Say so in the call rather than retrying in a loop. |
| Blank or frozen map | Hard refresh. The canvas repaints on tab visibility, but a stale bundle can hold an old build. |
| Chart axes but no bars | The tab was in the background when it painted. Bring the window forward and hover the chart. |
| Numbers look wrong | Run `npm run demo`, which prints the same figures straight from the data layer with the consistency checks. |
| Slow first answer | The first model call includes tool rounds. Later answers are faster; timings are in `npm run chat:test`. |

## 4. Things to say proactively, they build trust

- All data is **synthetic and seeded**. Same seed, same numbers, every time.
- The **LLM never computes a number**. Every figure comes from a tested function in the data layer, and a
  guard checks the answer against the tool output. If a number cannot be traced, the answer is flagged.
- The product **refuses to invent causes**. It will say the data does not explain a change.
- The map and the chat use the **same functions**, so they cannot disagree. There is a test asserting it.
- Edits in the Brain are **used by the AI** on the next question.

## 5. Deploying to Vercel, if you want a URL for the call

1. Push the repo to GitHub.
2. Vercel, import the project, framework preset Next.js.
3. Add environment variables: `LLM_BASE_URL`, `LLM_API_KEY`, `MODEL_NAME`, and `LLM_SESSION` if you use
   OpenCode Go.
4. Deploy. The CSVs ship with the function through `outputFileTracingIncludes` in `next.config.ts`.

Note: the CSVs are git ignored. Either commit them or run `npm run seed` as part of the build.

## 6. Housekeeping, nice to have

- `recharts` is only used by an unused preview component and can be dropped.
- Both `motion` and `framer-motion` are installed; consolidating on one trims the bundle.
