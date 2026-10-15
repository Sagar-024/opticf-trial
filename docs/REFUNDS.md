# Refunds: from blind spot to a closed loop

How we answer the CEO's note: refunds is super important to measure, it affects
the ICP's revenues, and the graph is the entry point, not the product.

The prompt from the screenshot:

> "show me refunds" -> no refunds figure exists, only the policy doc.

That answer was honest and correct. The group data covers revenue, conversion,
contact lens, examinations and training. Refund rows do not exist anywhere yet.
The gap is the data, not the logic.

## What was asked, and what "more than a graph" means

1. **Spot unusual patterns** - the system should notice refund anomalies for us.
2. **Investigate why** - one click from the anomaly to the evidence.
3. **Resolve / take action** - assign the fix, then check it worked.

A chart alone leaves all three to the person. The design below is the chart
**plus** the loop around it.

## Step 0 - What the graph looks like (the 30 second answer)

- **Refunds over time** and **refund rate** (refunds as a share of revenue).
  Rate matters because a large practice can refund more pounds without being
  unusual.
- **On a practice**: gross revenue -> refunds -> **net revenue**, so the money
  story is immediate.
- **Reason mix**: what the refunds were for (frame fault, fit issue, goodwill,
  change of mind), because the insight lives in the mix, not the total.
- **Every bar and point is a door.** Clicking it opens the investigation for
  that practice and month. The chart is the receipt; the loop is the product.

## Step 1 - Spot unusual patterns

Four checks, each a plain rule, no black box:

| Check | The rule | Catches |
|---|---|---|
| Refund spike | This month is well above the practice's **own usual level**, with a minimum floor so small numbers don't raise false alarms | A practice suddenly refunding far more than it normally does |
| High refund rate | Refund rate clearly above group peers | A practice whose refunds are disproportionate to its size |
| Above authority | A goodwill gesture over £50 with no regional lead recorded | The group's own policy (already written in the Brain) being broken |
| Near-threshold cluster | Many gestures landing just under £50 | The tell-tale pattern of avoiding the approval threshold |

Where they surface, using what already exists:

- **Today tab** - a refund anomaly can enter the priorities list.
- **Map** - a "Refunds" lens, same visual language as Contact lens and Training.
- **Automations** - a "Refund watch" with a live "X matching right now" count,
  the same as the contact lens watch.
- **Chat** - "which practices have unusual refunds?" answers with the ranked
  list and the evidence sentence behind each one.

## Step 2 - Investigate why

- One click from any flag opens the practice's refunds view: trend, reason mix,
  amounts, and the policy checks (reason, amount and order reference recorded;
  above £50 escalated).
- **Ask in chat**: "why are Chorlton's refunds up?" pulls the numbers from the
  data layer, the policy from the Brain, and any recorded practice context, then
  answers in the house style: here is the pattern, the data does **not** invent
  a cause, and here is the one question to put to the manager.
- The question is one tap: "Ask Rachel Doyle why refunds rose". The answer gets
  recorded, so the next person inherits the context instead of re-investigating.

## Step 3 - Resolve / take action

- Approving a flag creates a **task: one action, one owner, one review date**.
- **The owner is routed by reason** - the policy decides who owns the fix:
  - Normal goodwill -> the practice manager
  - Above £50 -> the regional lead
  - Supplier or product fault -> the Buying team
- **Nothing acts alone.** No automatic refunds, no messages to patients.
  Notify and create tasks only, the same rule as every other automation.
- **The loop closes.** At the review date the watch re-checks: refunds down
  means the task closes with evidence; still elevated means it escalates one
  step. This "did it work?" step is what every BI tool skips.

## The 60 second demo story (already set up in the sample data)

Chorlton carries a spike: refunds mostly **frame replacements**. The Brain's
context notes the recent refit and a local supply account, and the supplier
document says **no warranty term sheet is attached**. So the flow runs end to
end on day one:

> spike -> reason mix says frame replacements -> context surfaces -> task asks
> Buying to confirm the supplier terms -> the watch re-checks next month.

Pattern, context, action, proof. That is the whole company pitch in one flow.

## Real data and syncing (the honest answer)

- The demo runs on seeded sample data, identical every time, on purpose.
- In production, refunds would be **exported from each practice's system
  (PMS / accounting) and synced on a schedule**, with reason codes standardised
  at the source. That connector is a separate build, not part of this demo.
- The screens do not change when real data arrives. The checks are plain rules
  over the tool's own numbers, so they behave identically on real data. We swap
  the pipe, not the room.

## What is new, what is reused

| Reused (already built) | New |
|---|---|
| The attention engine that scores and ranks practices | Refund records in the dataset |
| Watches, review inbox, tasks, activity ledger | A refund summary: totals, rate, trend, reason mix |
| The map lens system and its filters | The four pattern checks above |
| Chat tools, the number guard, guidance search | A "Refunds" map lens and a "Refund watch" job |
| The Brain policy document (already written) | A refunds view in chat and on the practice panel |

## Guardrails we keep

- The AI never computes a number and never invents a cause. Same rules as today.
- No named-staff league tables. Refunds are attributed to practices and roles,
  never to individuals in group-wide views.
- The checks mirror the **published policy**, so the product holds the group to
  its own rulebook rather than an invented standard.

## One small polish item spotted in the screenshot

The `<<<` and `>>>` markers around the quoted policy are internal quoting
helpers; they should never appear on screen. They currently leak into the
answer (visible in the screenshot). Quick fix, bundled with this work.
