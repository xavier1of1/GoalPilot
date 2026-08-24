# GoalPilot Plus: Purchase Timing Lab

**Status:** approved bounded local prototype<br>
**Feature flag:** off by default; on in explicit demo mode<br>
**Analysis policy:** `purchase-timing-v1`<br>
**Provider:** deterministic fixture only

## Purpose and non-goals

The Purchase Timing Lab answers two separate questions:

1. Is the latest demo price historically favorable relative to its versioned local history?
2. Is the user's Simulated Goal Plan purchase-ready under GoalPilot's access rules?

It describes history; it does not forecast a price. It does not scrape, call a retailer API, name a
real retailer/model, form an affiliate relationship, initiate a purchase, mutate a financial plan,
recommend debt, or tell an unfunded user to buy. Every view says “Historical demo data, not a live
retailer feed” and “Historical patterns do not predict future prices.”

Approved phrases include “Historically favorable price,” “Historically typical price,”
“Historically elevated price,” “Watch this price,” and “Price is favorable, but your simulated plan
is not purchase-ready.” Prohibited phrases include “guaranteed sale,” “best possible time,” “price
will fall,” “buy now,” and “guaranteed savings.”

## Provider boundary

`HistoricalPriceProvider` accepts an allowlisted fixture code and explicit `asOfDate`. It returns:

- product fixture identifier and display descriptor;
- ISO currency and the requested `asOfDate`;
- integer-cent observations with stable observation key and observation date;
- source version, checksum, and source type;
- `isDemoData=true`.

`FixtureHistoricalPriceProvider` is the only local implementation. It reads committed deterministic
fixtures and performs no network access. The application use case validates and normalizes the
port's data before passing it into the pure domain policy; the domain does not import the simulator
or persistence layer. A future approved external provider can implement the same port after
separate privacy, terms, security, commercial, and data-quality review; M19+ may schedule the same
application use case without changing the algorithm.

## Seeded item

The demo item is the synthetic **65-inch OLED television** associated with a seeded demo goal. It
uses the fictional code `synthetic_oled_65_v1`, USD cents, and deterministic source
`fixture-price-history-2026-08-23-v1` plus its checksum. The committed generator emits one keyed
daily point from 2024-08-23 through 2028-08-20 and filters at the requested `asOfDate`; the seeded
2026-08-23 assessment therefore receives 731 observations. It contains no URL or remote product
identifier. Synthetic values must never be described as facts about a real product or retailer.

## Persistence model

Only forward migrations are allowed.

### `purchase_items`

An item belongs to exactly one user and one goal through composite ownership constraints. It stores
an allowlisted fixture code, display name, currency, target price cents, optimistic version,
lifecycle, and timestamps. It stores no product URL.

### `price_watch_policies`

Immutable versions store item ownership, cadence, next due date, freshness limit,
`purchase-timing-v1`, enabled state, and creation date. A change inserts a new version.

### `price_check_runs`

Each owned policy/date pair has one logical run. It records fixture source version/checksum, safe
status/error code, attempt/completion timestamps, the controlled application date, and a
provider-worker token/expiry while claimed. A unique key makes concurrent or replayed routine work
collapse to one result. The token is a ULID with a ten-minute lease; terminal rows clear both
worker fields, and the attempt count is constrained to one through three.

### `price_observations`

Observations are append-only integer cents with currency, date, source version, stable key, and
owning run/item. `(run, observation key)` is unique, so every completed assessment retains the exact
raw series used by its own run. Separate keyed observations may legitimately share a calendar date.
The same logical `(item, source version, observation key)` may recur across run snapshots only with
identical date, price, and currency; an advisory-lock/insert trigger rejects a conflict. A date after
the run/application date is rejected. Triggers and composite keys enforce ownership, exact run
provenance, claimed-run insertion, source version, and currency consistency.

Current imports persist the provider's exact stable key. Migration 011 had to assign
`stored-YYYY-MM-DD` compatibility keys to observations created before that column existed; those
deterministic backfill keys are not the original provider key. Migration 014 copies the applicable
historical prefix into each legacy assessment's run and aborts unless run membership equals the
assessment's stored observation count.

### `purchase_timing_assessments`

Assessments are immutable and unique per completed run. They snapshot item/owner, applicable plan
version/lifecycle/readiness, policy/source versions, state, all required statistics, rationale
codes, and timestamps. Draft provenance has no plan version or health; active provenance requires
both; completed/archived provenance retains the plan version but stores health as null. An update or
direct delete is rejected except the documented owner-data cascade.
`HISTORICALLY_FAVORABLE_PLAN_READY` requires snapshotted `PURCHASE_READY`; a paused or
funded-but-locked plan is not ready.

## Valid observation set

For an assessment at controlled `asOfDate`:

1. Normalize and validate one currency and source version.
2. Reject nonpositive prices, invalid dates, and any observation after `asOfDate`.
3. Deduplicate only field-identical observations that share one logical key; reject a reused key
   whose date, price, currency, or source differs.
4. Sort by date, then the stable observation key.
5. Use observations from `asOfDate - 730 days` through `asOfDate`, both endpoints inclusive; this
   is a 730-day span and can contain 731 daily dates. If the source has less history, use all valid
   history.
6. Define `current` as the latest dated valid observation. Multiple observations on that date are
   ordered by stable key and the final one is current.

The dataset is insufficient unless it has at least 30 observations and `latestDate - earliestDate`
is at least 90 calendar days. Insufficiency precedes every other state.

## Statistics

Money remains integer cents. Sorting is ascending by price.

- **Minimum/maximum:** first and last sorted prices.
- **Median:** middle price for odd `n`; for even `n`, the arithmetic mean of the two middle cents,
  rounded half-even to a cent.
- **Current empirical percentile:**
  `(count(price < current) + 0.5 × count(price = current)) / n`, represented as basis points and
  rounded half-even. Lower percentiles mean lower historical prices.
- **Difference from median:** `currentCents - medianCents` (signed cents).
- **Difference from target:** `currentCents - targetPriceCents` (signed cents).
- **Observation count:** number of valid points in the window.
- **Data span:** calendar days from earliest through latest (`latest - earliest`).
- **Freshness:** calendar days from latest through `asOfDate` (`asOf - latest`).

Every output records policy and source versions. Arithmetic never uses binary floating-point money.

## State policy and precedence

`purchase-timing-v1` uses the following exact order:

1. `INSUFFICIENT_DATA` when count is below 30 or span is below 90 days.
2. `STALE_DATA` when freshness is greater than 14 calendar days.
3. A percentile at or below 2,500 basis points is historically favorable:
   - `HISTORICALLY_FAVORABLE_PLAN_READY` only when current plan health is `PURCHASE_READY`;
   - otherwise `HISTORICALLY_FAVORABLE_PLAN_NOT_READY`, with explicit paused/locked/not-funded
     rationale where applicable.
4. `HISTORICALLY_ELEVATED` when percentile is at or above 7,500 basis points.
5. `WATCH` when the price is neither favorable nor elevated and current price exceeds the user's
   target price.
6. `HISTORICALLY_TYPICAL` for the remaining sufficient, fresh cases.

These percentile bands are descriptive heuristics, not probabilities or predictive truth. Exact
boundary tests cover 2,500 and 7,500 basis points. Favorable history never changes or overrides
plan health. If the total plan is funded but locked, the UI says the modeled funds remain
unavailable under the maturity policy.

## Seasonal detail

No seasonal claim is produced unless the valid history spans at least 730 days and every one of the
12 displayed calendar months has at least three observations. When eligible, show each month's
observation count and half-even median only. Do not label the result a forecast, “best month,” or
expected discount. If any month fails, omit the entire seasonal panel rather than extrapolating.

## Routine job

`runDuePriceChecks(dependencies, { userId, applicationDate })` is an idempotent application use
case:

1. Load only the owner's latest enabled due policies.
2. Claim or replay the unique policy/application-date run. A fresh attempt owns a ten-minute
   generation token; an unexpired existing generation returns `in_progress` without provider work.
3. Call the fixture provider outside the claim transaction.
4. Validate the entire returned batch before writing any point.
5. after the provider returns, reload plan readiness from the owner-scoped authoritative
   plan/ledger at the same clock date, so a lifecycle change during the provider call is captured
   as assessment-time provenance rather than overwritten;
6. in one completion transaction, insert observations idempotently, store one immutable
   assessment, advance the watch-policy version, and mark the run completed;
7. except for transient `in_progress`, emit exactly one closed routine outcome—
   `purchase_timing_check_completed`, `purchase_timing_check_failed`,
   `purchase_timing_check_replayed`, or `purchase_timing_check_no_due`—from the validated summary;
8. return counts plus safe status codes.

A failed batch stores no partial observations or assessment. Failure or lease expiry reuses the
logical run with a new generation token and consumes the next attempt, capped at three total.
Completion/failure requires the matching current token and clears the worker fields; a completed
run replays. A late worker that has lost its generation cannot persist failure; it returns transient
`in_progress` for that watch without adding a failure count/code or itself causing a failure
outcome. `corepack pnpm price-watch:run` and the explicit authenticated due-run route invoke the
same use case locally. Current Story-Mode Autopilot advances the owner's clock and financial
simulation but does not automatically run Timing checks; the user or CLI invokes them explicitly
at the new date. No Kafka, Redis, SQS, distributed scheduler, or second database is introduced.

The Timing routine does not acquire the Story financial-run lease: it is plan/ledger read-only and
may overlap a lifecycle mutation. Its post-provider authoritative reload is the boundary, so an
archive completed while the fixture provider is delayed produces archived plan provenance with
retained plan version, null current health, and not-ready rationale rather than stale active health.
Its per-run provider-worker lease is also distinct from `application_command_claims`. The
authenticated HTTP due-run route uses an application-command claim for idempotent response
persistence around the use case. `scripts/price-watch-run.ts` invokes the use case directly and
relies on the per-run lease and idempotent database state; it has no HTTP response claim.

## API and feature gate

The exact current routes are:

```text
GET   /api/v1/timing-lab/purchase-items
POST  /api/v1/timing-lab/purchase-items
PATCH /api/v1/timing-lab/purchase-items/:itemId
POST  /api/v1/timing-lab/purchase-items/:itemId/archive
GET   /api/v1/timing-lab/purchase-items/:itemId/latest
POST  /api/v1/timing-lab/purchase-items/:itemId/watch-policies
POST  /api/v1/timing-lab/run-due-price-checks
```

The `latest` route returns the owned item, latest policy, latest assessment, and the assessment's
exact raw fixture series. There is no separate current policy-list or assessment-history route.
When `PURCHASE_TIMING_LAB_ENABLED=false`, the repository/provider are not instantiated and these
routes are not registered, so requests return 404. Mutations require authentication, ownership,
CSRF, Origin, rate limit, strict schemas, safe errors, correlation ID, and normalized request-hash
idempotency. Non-owner resources are indistinguishable 404s; bad CSRF/Origin is a non-resource 403.

No route accepts a URL, provider endpoint, arbitrary product identifier, uploaded data, free-form
metadata, plan health, assessment state, price statistic, or provider result from the browser.

## User interface

The current premium preview shows current demo price, user target, historical range and median,
empirical percentile, state, observation count/span, freshness, and plan-readiness status. When
seasonal detail is eligible it renders the 12 monthly medians as a visual bar chart plus a complete
12-row text table. A disclosure exposes fixture descriptor, source type/version, series date,
observation count, and replay checksum, followed by the demo-data and no-prediction language. It
does not render a separate full daily price chart/table or each raw rationale code; `/latest` still
returns the exact stored series and assessment provenance. Any future visualization requires an
equivalent text/table representation. A restrained “GoalPilot Plus” or “Premium preview” badge is
allowed.

The interface explicitly handles disabled, loading, empty, insufficient, stale, server/network
failure, historically favorable ready/not-ready, watch, typical, elevated, funded-but-locked, and
archived states. Price color never conveys state alone. It never renders raw provider or database
errors. A retained assessment labels the snapshotted lifecycle and assessed target; if the item's
current target differs, the interface marks that assessment stale instead of presenting it as the
current target comparison.

## Privacy boundary

`goalpilot-user-data-export-v2` includes the owner's Timing items, policy versions, check runs,
exact observations, and immutable assessments. Account deletion cascades all five owned Timing
tables through the user/goal relationships. Timing product events remain in the separate unlinked
pseudonymous aggregate and contain no item/goal ID, product text, price, URL, or arbitrary metadata.
Strict per-record export schemas exclude worker claim tokens/lease expiries and reject unexpected
operational fields.

## Required tests

- exact min/median/max, tie-aware empirical percentile, signed differences, count/span/freshness;
- 29 points and 30 points with 89/90-day spans;
- 14/15-day freshness and 2,500/7,500-basis-point thresholds;
- all seven states and readiness/paused/locked precedence;
- 23-month versus 24-month seasonal gate and per-month sample minimum;
- input-order invariance and deterministic policy/source versions;
- future point, nonpositive price, currency mismatch, conflicting duplicate, identical replay;
- cross-goal/owner database constraints and uniform API 404s;
- append-only observations/assessments, exact run-scoped series, same-date distinct keys, cross-run
  logical-key consistency, and concurrent run uniqueness;
- failed batch atomicity, active-worker `in_progress` without provider/event work, expired-token
  generation reclaim, matching-token completion/failure, stale-worker no-event behavior, bounded
  third-attempt exhaustion, and completed replay;
- a goal archived while the provider is delayed produces a completed Timing run with terminal plan
  provenance (retained plan version, archived lifecycle, null health, and not-ready rationale);
- favorable history cannot change a plan or produce ready while not ready;
- flag-off returns 404 and performs no provider call;
- the complete 731-observation fixture remains below the 5,000ms local regression ceiling;
- accessible chart/text parity and Journey D/E.

## Limitations and future path

The fixture history is synthetic and not evidence of a market pattern. Percentile thresholds are a
versioned product heuristic, not statistical inference. The analysis omits taxes, shipping,
inventory, financing, condition, model substitutions, retailer quality, and real-time changes. A
future external-data adapter requires separate authorization and review and must preserve this
provider boundary, validation, provenance, replay, privacy, readiness, and non-prediction policy.
The 5,000ms ceiling is a local deterministic regression limit, not a production SLA or capacity
claim; only an executed passing command and its measured output are release evidence.
