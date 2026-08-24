# GoalPilot local product-experience specification

**Status:** approved implementation authority  
**Version:** `product-experience-v1`  
**Release boundary:** local PX00–PX10; AWS remains M19–M22

## Product promise and boundary

GoalPilot helps a person make a dated purchase goal concrete, see the contribution needed without
depending on interest, compare illustrative places the simulated funds could sit, and recover after
a small disruption. The customer-facing object is a **Simulated Goal Plan**.

GoalPilot does not open an account, hold or move money, use live rates, predict returns or prices,
give individualized investment advice, or make a purchase. Activation must say all activity is
simulated, rates are illustrative, and the selected assumption version is fixed for reproducibility.
No LLM calculates, ranks, explains, recommends, or changes a financial value.

## Information hierarchy

The product presents information in this order:

1. the goal and zero-interest safe contribution;
2. whether that commitment fits the user's budget;
3. one illustrated vehicle fit and purchase-readiness date;
4. cash, other eligible models, then explained ineligible models;
5. current and projected financial detail;
6. assumption and calculation trace.

The user-facing builder does not show a confidence control while `expected` is the only supported
value.

## Progressive builder

### Step 1 — Goal

Collect the goal name, target amount, and target date.

### Step 2 — Starting point

Collect current savings, call the server baseline operation, and immediately show: “To reach this
goal without relying on modeled interest, you would need to save approximately $X per cadence.”

### Step 3 — Budget fit

Only after the baseline is visible, ask whether it fits. The user can accept it, enter a lower
affordable amount and see the shortfall, or enter a higher amount and see earlier readiness. The
browser formats the response but never calculates the baseline.

### Step 4 — Access

Ask, “Might you need this money before the goal date?” and map the answer to the existing liquidity
policy without unnecessary jargon.

### Step 5 — Review

Show the goal, target, deadline, saved amount, safe amount, chosen amount, access requirement, and
simulation disclosure before preview or activation.

An authenticated user can save, list, resume, edit, review, and discard incomplete drafts. Drafts
are owner-scoped and optimistic-versioned. Draft edits do not create active-plan history. Activation
validates a complete contract and atomically creates goal, plan version 1, simulated account,
schedule, activity, and idempotency result; the transient draft is then removed.

Validation includes field errors, a concise summary when useful, focus on the first invalid field,
consistent browser/API rules, stale-response handling, and safe server/network failure states.

## Decision-ready plan summary

The first result leads with:

```text
Your plan
Save $X each cadence through Month Year
Illustrated fit: [vehicle model]
Projected purchase readiness: Month Year
```

It then reconciles:

```text
Current savings
+ planned personal contributions
+ modeled interest
= projected target-date balance
```

Safe amount, chosen amount, and cushion or shortfall are separate. The safe amount is labeled “Does
not depend on modeled interest.” Current simulated balance separates opening savings, posted
contributions, and posted interest. Projected target-date balance separately adds future
contributions and future modeled interest.

Rationale is generated from closed, versioned explanation codes. It explains fit, access,
maturity/lock consequences, the modeled-interest contribution, and why the safe commitment does
not depend on that interest. Every branch has a test and no free-form model generates copy.

## Vehicle-fit comparison

All four models remain visible. Presentation order is the user's plan, illustrated recommended fit,
cash baseline, other eligible options, then ineligible options. Four equal cards must not precede
the plan explanation.

Each model shows fit, safe contribution, modeled benefit versus cash, readiness date, fund access,
maturity/lock rule, and one-sentence rationale. Expanded detail shows illustrative rate, assumption
version, effective/reviewed date, principal, interest, ending balance, exact maturity, protection
classification, calculation note, and “not a live offer.”

Ranking policy `vehicle-fit-v2` is:

1. eligibility under every policy rule;
2. purchase-ready by target using the safe contribution;
3. declared access requirement satisfied;
4. lower liquidity/lockup conflict;
5. higher modeled target-date cushion;
6. vehicle code.

Ineligible options have no rank and state the reason, conflicting constraint, and policy-valid
change that would make them eligible. Return never overrides access or maturity. State is expressed
in text and not color alone; every chart/table has a text equivalent.

## Lifecycle, readiness, and health

Lifecycle (`draft`, `active`, `completed`, `archived`) is separate from `PlanHealth`.
`plan-health-v1` applies this precedence:

1. `PAUSED`: the active plan is paused; underlying projection may be secondary.
2. `PURCHASE_READY`: available modeled funds meet target and every access/maturity rule is met.
3. `FUNDED_BUT_LOCKED`: total modeled value meets target but available funds do not.
4. `ATTENTION_NEEDED`: readiness is after target or no feasible purchase-ready date exists.
5. `AHEAD`: readiness is earlier than target by at least one full contribution interval.
6. `ON_TRACK`: readiness is on/before target but does not meet `AHEAD`.

Health returns evidence/rationale codes, not an unexplained score. The controlled application date,
immutable plan/assumption snapshot, ledger, and access policy are authoritative.

## What-If Studio

The primary flow changes exactly one dimension:

- recurring contribution;
- deadline;
- target amount;
- one planned missed or paused contribution.

It never exposes an APY, risk, or assumption-version control. A preview compares current plan and
proposed scenario: contribution, deadline, target, readiness, personal contributions, modeled
interest, cushion/shortfall, access consequence, and health. Preview is stateless; product telemetry
may record only the changed-dimension enum, never the scenario values.

Applying a preview reloads the named immutable base snapshot, checks current goal/plan versions,
recomputes server-side, rejects a no-op or concurrent change, creates version `n+1`, preserves all
prior rows, records append-only activity, reconciles only future schedule items, and returns the
version plus comparison. The idempotency key is user/operation scoped and bound to the normalized
request hash.

## Recovery Planner

Only an `ATTENTION_NEEDED` plan receives recovery options. Return no more than three, in this stable
order:

1. increase contribution to the smallest zero-interest amount that restores readiness;
2. extend the deadline to the earliest cadence-aligned policy-valid date;
3. reduce target to the highest attainable policy-valid amount.

Each changes one dimension and includes the exact change, readiness date, resulting health,
personal-contribution change, interest change, and rationale code. It cannot switch the vehicle,
raise risk, suggest debt/credit, violate access policy, or claim a guarantee. Searches are bounded;
an unavailable option returns a stable reason instead of fabricated advice.

## Drafts, history, completed, and archived goals

Navigation groups incomplete drafts, active plans, completed goals, and archived goals. A user can
resume or discard a draft, return quickly to active work, open read-only history, and see why a goal
was archived. Each plan version shows activation date, changed inputs, change reason, calculation
policy, assumption version, and whether it came from recovery. Historical versions are immutable.
This is consumer navigation, not an administration portal.

## Story-Mode Autopilot

User-facing purpose: **Preview how your simulated plan changes over time.** Permitted controls are:

- advance to next contribution;
- advance one month;
- advance six months;
- advance to next maturity;
- advance to target date;
- reset demonstration.

The UI does not expose an arbitrary date. It shows the current application date, next event,
upcoming contribution, next maturity, health, event timeline, and a summary of the last advance.
It explains failed contribution, pause, replay, already-processed event, locked maturity, and no
event due without raw errors.

Controls require authentication, ownership, CSRF, Origin, rate limit, permitted-milestone
validation, and idempotency. They exist only in local/test/explicit-demo modes, use a per-user
controlled clock, never change the OS clock, and cannot process another user's accounts. Reset is
allowed only for marked fixtures, restores those fixtures transactionally, preserves non-demo data,
and is also exposed as `corepack pnpm demo:reset`.

## Seeded story

The primary fixture is **Japan trip in 18 months** and is generated through the production domain
engine. Its initially affordable amount is slightly below the safe baseline; interest is visible but
secondary; the illustrated fit meets the access need; at least one fixed-term model is rejected or
subordinated for an explicit reason; a deterministic missed contribution creates an attention state;
and one bounded recovery restores the plan. No displayed result is separately hard-coded.

The seeded Timing Lab product is a clearly synthetic **65-inch OLED television**, associated with
an appropriate fixture goal and labeled “Historical demo data, not a live retailer feed.”

## Privacy-safe product events

Product events are separate from security audit events and validated against closed schemas.
Allowed event names are `sample_goal_opened`, `builder_started`, `builder_step_completed`,
`safe_baseline_viewed`, `plan_previewed`, `vehicle_details_opened`,
`simulated_plan_activated`, `what_if_previewed`, `recovery_option_applied`,
`autopilot_advanced`, `plan_paused`, `plan_resumed`, `plan_purchase_ready`, `plan_completed`,
`plan_archived`, and `purchase_timing_viewed`.

Allowed payload fields are event ID/name/time, pseudonymous user or session reference, builder-step
enum, vehicle-code enum, rejection-code enum, changed-dimension enum, demo boolean, and application
version. Amounts, entered names/notes, product names/URLs, email, account identifiers, arbitrary
metadata, session/CSRF/password material, and secrets are rejected. The local
`product-events:summary` command returns aggregate counts/progression only.

## Purchase Timing Lab

**GoalPilot Plus: Purchase Timing Lab** is feature-flagged and uses only a
`FixtureHistoricalPriceProvider`. It answers whether the current demo price is historically
favorable under a versioned heuristic and whether the Simulated Goal Plan is financially ready.
It cannot mutate the plan. Full policy, entities, algorithm, states, routine behavior, UI language,
and tests are in [PURCHASE_TIMING_LAB.md](PURCHASE_TIMING_LAB.md).

## Required interface states

Affected views explicitly handle first use, loading, empty, validation failure, server failure,
network failure, stale response, concurrent-plan conflict, no eligible vehicle, paused,
attention-needed, funded-but-locked, purchase-ready, archived, insufficient price data, stale price
data, and feature disabled. No view leaves dead controls, unexplained blank space, raw JSON, or
developer terminology.

Critical flows target WCAG 2.2 AA, visible focus, semantic HTML, keyboard operation, 44-pixel touch
targets where practical, reduced motion, text equivalents, focusable error summaries, and no
horizontal overflow at 360, 768, 1024, or 1440 CSS pixels.

## Logical application operations

- preview safe goal baseline and complete plan;
- create/edit/list/discard draft and activate Simulated Goal Plan;
- list immutable plan versions;
- preview one scenario and apply it as a new version;
- get current health and recovery options;
- advance to a permitted demo milestone and reset seeded demo;
- record an allowlisted product event;
- create/update an owned purchase item, get its assessment, and run due price checks.

Every state-changing HTTP operation uses authentication, ownership, CSRF, Origin, runtime
validation, safe errors, correlation ID, rate limit, and request-hashed idempotency where replay can
duplicate financial or historical records. Route handlers contain neither SQL nor financial logic.

## Local release acceptance

The release provides `local:release`, `demo:local`, and a self-terminating `local:smoke`. The first
serves production builds on documented loopback ports with demo mutations off and the Timing Lab
flag honored. Demo mode uses production artifacts where practical and enables only fixture-backed
story/reset/timing features. Smoke proves web, liveness/readiness, anonymous auth rejection, demo
availability when enabled, plan/scenario/price operations, no AWS dependency, clean shutdown, and
no unexpected listener.

PX10 additionally requires exact setup/database/coverage/build/security/Chrome-E2E evidence,
Journeys A–E, measured performance budgets, upgrade and reset safety, independent review
dispositions, a demo runbook, and an unfilled user-validation package. The only approved completion
label is **GoalPilot Local Product Experience verified**. It does not mean production-ready,
compliant, or AWS-ready.
