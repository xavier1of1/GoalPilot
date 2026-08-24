# GoalPilot local product-experience specification

**Status:** approved implementation authority<br>
**Version:** `product-experience-v1`<br>
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
opening activity, completed idempotency result, and audit event; the transient draft is then
removed. Activation stores the immutable schedule anchor and the account's next contribution date.
It does not pre-create future `schedule_occurrences`; those rows represent due dates actually
processed by Autopilot.

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

Lifecycle (`draft`, `active`, `paused`, `purchase_ready`, `completed`, `archived`) is separate from
`PlanHealth`. `plan-health-v1` applies this precedence:

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

Applying a preview reloads the named immutable base snapshot, recomputes server-side, and checks
the current application date, goal/plan versions, account lifecycle/dates/accrual remainder,
ledger value/count, personal principal, and available balance inside the write transaction. It
rejects a no-op or concurrent financial change rather than storing a stale scenario. Success
creates version `n+1`, preserves all prior rows, records append-only activity, and updates the
account's current-plan pointer and next derived due date from the preserved schedule anchor and
omitted dates. Existing plan rows and processed schedule occurrences are not rewritten. The
response returns the version plus comparison. The idempotency key is user/operation scoped and
bound to the normalized request hash.

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
The persisted version also retains its normalized input, calculation output,
`plan-calculation-context-v1` (personal principal, total ledger value, current availability,
unposted HYSA micros, per-lot fixed-term maturity context), application date, schedule anchor,
omitted dates, ranking/health policy versions, and optional base version. Archive provenance is an
archive timestamp plus `USER_REQUESTED`, `GOAL_COMPLETED`, or `NO_LONGER_PURSUED`. This is consumer
navigation, not an administration portal.

Current-schema writes capture this context when each version is created. Context reconstructed for
pre-context rows by migration 010 remains immutable but carries the historical-accrual limitation
documented in [ARCHITECTURE.md](ARCHITECTURE.md); it is not represented as an exact
original-capture record.

Likewise, migration 011 may reconstruct a pre-provenance archive from its audit event or fall back
to `updated_at` and `GOAL_COMPLETED`. New archive actions persist the selected closed reason and
actual archive time; the fallback is upgrade compatibility, not a claim about the user's original
choice.

Completed and archived workspaces retain decision summary, immutable plan history, activity, and
Timing evidence where available. Completed work may still expose the explicit archive action, but
neither state renders What-If, recovery, Autopilot, contribution, pause, resume, or completion
controls; archived work renders no mutation controls. A successful lifecycle/archive mutation
refreshes detail, summary, health, recovery, history, activity, and Timing state before the
terminal view is treated as current.

Archive closes the underlying simulator account with its existing terminal `completed` storage and
no next contribution. For `USER_REQUESTED` and `NO_LONGER_PURSUED`, the owner-facing read model uses
the goal provenance to present account status **Archived** and keeps actual progress instead of
showing **Completed** or forcing 100%. A `GOAL_COMPLETED` archive remains completed/100% history.

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
requires the exact confirmation literal `RESET_SEEDED_STORY_DEMO` plus the expected goal version,
and is also exposed as `corepack pnpm demo:reset`.

Advance claims one ULID-token owner lease on the per-user clock for ten minutes. Another active
advance plus existing-goal update, draft/legacy activation, lifecycle/archive, manual contribution,
and What-If/recovery apply receive a retryable conflict; expiry is the only stale-reclaim boundary,
a stale token cannot release the replacement, and loss of ownership fails the command closed. Reset
refuses an active lease. Draft CRUD, stateless preview, Timing work, and privacy deletion are not
presented as taking this financial lease. This owner-run lease is distinct from the application
command claim that protects idempotent response persistence.

Interest uses only ledger rows effective through the day being processed and rechecks ledger
balance/count, accrual state, goal version/target, and plan pointer under lock. A conflict reloads
and recalculates from that day, stopping after three conflicts. If an interrupted run has already
persisted account/ledger state beyond the clock, the selected milestone is extended through that
financial high-water date; earlier dashboard/activity/plan results continue to exclude the future
row until the clock catches up.

Resource and capability failures are distinct. Missing/foreign goal or fixture matches—including a
reset that does not address the caller's marked fixture—return an indistinguishable 404. An
authenticated call to `POST /api/v1/demo/advance` by a user without the persisted seeded-fixture
capability is a non-resource policy denial and returns 403. Bad Origin or CSRF also returns 403.

## Seeded story

The primary fixture is **Japan trip**, with an 18-month horizon, and is generated through the
production domain engine. Its initially affordable amount is slightly below the safe baseline;
interest is visible but secondary; the illustrated fit meets the access need; at least one
fixed-term model is rejected or subordinated for an explicit reason; a deterministic missed
contribution creates an attention state; and one bounded recovery restores the plan. No displayed
result is separately hard-coded.

The seeded Timing Lab product is a clearly synthetic **65-inch OLED television**, associated with
an appropriate fixture goal and labeled “Historical demo data, not a live retailer feed.”

## Privacy-safe product events

Product events are separate from security audit events and validated against closed schemas.
Allowed event names are `sample_goal_opened`, `builder_started`, `builder_step_completed`,
`safe_baseline_viewed`, `plan_previewed`, `vehicle_details_opened`,
`simulated_plan_activated`, `what_if_previewed`, `recovery_option_applied`,
`autopilot_advanced`, `plan_paused`, `plan_resumed`, `plan_purchase_ready`, `plan_completed`,
`plan_archived`, and `purchase_timing_viewed`.

The Timing routine adds exactly four closed outcome names:
`purchase_timing_check_completed`, `purchase_timing_check_failed`,
`purchase_timing_check_replayed`, and `purchase_timing_check_no_due`.
An unexpired worker observed by a concurrent invocation returns `in_progress` and emits no fifth
event.

The authenticated API persists a generated event ID/time, salted pseudonymous user reference,
event name, builder-step enum, vehicle-code enum, rejection-code enum, changed-dimension enum,
server-derived demo boolean, and application version. Amounts, entered names/notes, dates, product
names/URLs, email, resource/account/session/request identifiers, arbitrary metadata,
session/CSRF/password material, and secrets are rejected. The local `product-events:summary`
command returns aggregate counts/progression only.

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

## Current local HTTP surface

The current routes are the source-backed local surface below. `/health/live`, `/health/ready`, the
catalog, baselines, previews, registration, login, and session-status are callable without an
authenticated user; authenticated previews/baselines use that user's controlled date. Logout is a
session mutation and requires the session CSRF token.

```text
GET  /health/live
GET  /health/ready
GET  /api/v1/vehicle-catalog
POST /api/v1/baselines
POST /api/v1/previews
POST /auth/register
POST /auth/login
POST /auth/logout
GET  /api/v1/session-status
GET  /api/v1/me
GET  /api/v1/capabilities
```

`GET /api/v1/me` and `GET /api/v1/capabilities` require authentication.
The current loopback-only Fastify process also exposes generated operational documentation at
`GET /docs/`, `GET /docs/json`, and `GET /docs/yaml`; `GET /docs` redirects to the
trailing-slash UI. Plugin-owned `/docs/static/*` assets are not product API routes and are not part
of the product contract below.

Authenticated goal, draft, plan, activity, telemetry, and privacy routes are:

```text
GET    /api/v1/goal-drafts
POST   /api/v1/goal-drafts
GET    /api/v1/goal-drafts/:draftId
PATCH  /api/v1/goal-drafts/:draftId
DELETE /api/v1/goal-drafts/:draftId
POST   /api/v1/goal-drafts/:draftId/activate

GET   /api/v1/goals
POST  /api/v1/goals
GET   /api/v1/goals/:goalId
PATCH /api/v1/goals/:goalId
POST  /api/v1/goals/:goalId/activate
POST  /api/v1/goals/:goalId/pause
POST  /api/v1/goals/:goalId/resume
POST  /api/v1/goals/:goalId/complete
POST  /api/v1/goals/:goalId/archive
GET   /api/v1/goals/:goalId/ledger
POST  /api/v1/goals/:goalId/contributions

GET  /api/v1/goals/:goalId/plan/summary
GET  /api/v1/goals/:goalId/plan/health
GET  /api/v1/goals/:goalId/plan/history
POST /api/v1/goals/:goalId/what-if/preview
POST /api/v1/goals/:goalId/what-if/apply
GET  /api/v1/goals/:goalId/recovery
POST /api/v1/goals/:goalId/recovery/apply

POST /api/v1/product-events
POST /api/v1/data-exports
POST /api/v1/account-deletion
```

`POST /api/v1/goals` and `POST /api/v1/goals/:goalId/activate` remain local compatibility routes;
the progressive consumer builder uses the `goal-drafts` activation flow. There is no current
per-goal hard-delete route. Archive retains goal/plan history, while account deletion is the
destructive privacy operation.

When `DEMO_STORY_ENABLED=true`, the API also registers:

```text
POST /api/v1/demo/advance
POST /api/v1/demo/reset
```

When `PURCHASE_TIMING_LAB_ENABLED=true`, it registers only:

```text
GET   /api/v1/timing-lab/purchase-items
POST  /api/v1/timing-lab/purchase-items
PATCH /api/v1/timing-lab/purchase-items/:itemId
POST  /api/v1/timing-lab/purchase-items/:itemId/archive
GET   /api/v1/timing-lab/purchase-items/:itemId/latest
POST  /api/v1/timing-lab/purchase-items/:itemId/watch-policies
POST  /api/v1/timing-lab/run-due-price-checks
```

The `latest` Timing response contains the owned item, latest policy, latest immutable assessment,
and its exact raw fixture series when an assessment exists. There is no separate current watch-list
or assessment-history route. Flag-off routes are absent and return 404.

Completed atomic mutations replay from `idempotency_records`. Goal update, demo advance/reset,
Timing due-run, and privacy export additionally use leased `application_command_claims` while work
and response persistence span application steps. A possibly committed command remains
indeterminate and fails closed; it is not made retryable automatically.

Inside a due-run, each unique policy/application-date row separately leases provider work for ten
minutes with a generation token. A second invocation that sees an unexpired generation returns
`in_progress` without calling the provider. Expiry permits a new generation on the same row and
increments its bounded attempt count, up to three; only the matching current generation may
complete or fail, and a completed run replays. This worker lease does not serialize plan mutations
and is not an HTTP response-persistence claim or Story financial-run lease. A superseded worker's
late local failure contributes `in_progress`, not a failure count/code, and does not itself cause a
stale failure outcome.

`goalpilot-user-data-export-v2` validates each nested record against a strict allowlist. It includes
the owner's documented Timing run history but excludes worker tokens/lease expiries and all other
command/idempotency internals; an unexpected operational field rejects the response contract.

The typed browser client keeps one payload-bound `Idempotency-Key` across a transport or ambiguous
failure for draft create/update/discard/activate, manual contribution, lifecycle/archive,
What-If/recovery apply, and due-price-check mutations. A payload change receives a new key, and a
successful response clears the retained key. Story advance keeps a key per selected milestone and
reset keeps one for the current confirmation payload until success.

## Logical application operations

- preview safe goal baseline and complete plan;
- create/edit/list/discard draft and activate Simulated Goal Plan;
- list immutable plan versions;
- preview one scenario and apply it as a new version;
- get current health and recovery options;
- advance to a permitted demo milestone and reset seeded demo;
- record an allowlisted product event;
- create/update/archive an owned purchase item, create a watch-policy version, get the latest
  item/policy/assessment/series aggregate, and run due price checks.

Protected state-changing HTTP operations use authentication, ownership, CSRF, Origin, runtime
validation, safe errors, correlation ID, rate limit, and request-hashed idempotency where replay can
duplicate financial or historical records. Registration/login and anonymous-capable preview/baseline
are the documented CSRF/ownership exceptions but still require exact Origin, strict validation, and
rate limits. Route handlers contain no SQL; financial arithmetic remains in tested domain functions
invoked with normalized data.

Capability, dashboard, health, activity, and other query failures remain retryable failure states;
the browser must not reinterpret them as a disabled feature, an unactivated account, or an empty
collection. A retained Timing assessment shows its assessment-time lifecycle and target, and warns
when the item's current target differs from that immutable assessed target.

## Local release acceptance

The release provides `local:release`, `demo:local`, and a self-terminating `local:smoke`. The first
serves production builds on documented loopback ports 3200/5373 with both demo mutations and the
Timing Lab off. Demo mode uses production artifacts where practical on the same default ports and
enables only fixture-backed story/reset/timing features. When it executes successfully, the smoke
command checks web, liveness/readiness, anonymous auth rejection, demo availability when enabled,
plan/scenario/price operations, absence of an AWS dependency, clean shutdown, and no unexpected
listener; the command's existence is not passing evidence.

PX10 additionally requires exact setup/database/coverage/build/security/Chrome-E2E evidence,
Journeys A–E, measured performance budgets, upgrade and reset safety, independent review
dispositions, a demo runbook, and an unfilled user-validation package. The only approved completion
label is **GoalPilot Local Product Experience verified**. It may be applied only after the frozen
tree's required commands execute successfully and their evidence is retained; this specification
does not itself apply the label. It does not mean production-ready, compliant, or AWS-ready.
