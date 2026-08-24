# GoalPilot Plus: Purchase Timing Lab

**Status:** approved bounded local prototype  
**Feature flag:** off by default; on in explicit demo mode  
**Analysis policy:** `purchase-timing-v1`  
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
- ISO currency;
- integer-cent observations with observation date;
- source version and source type;
- freshness metadata and `isDemoData=true`.

`FixtureHistoricalPriceProvider` is the only local implementation. It reads committed deterministic
fixtures and performs no network access. Domain code imports the port's normalized value types, not
the simulator or persistence layer. A future approved external provider can implement the same port
after separate privacy, terms, security, commercial, and data-quality review; M19+ may schedule the
same application use case without changing the algorithm.

## Seeded item

The demo item is the synthetic **65-inch OLED television** associated with a seeded demo goal. It
uses a fictional fixture code, USD cents, deterministic source version/checksum, at least 30 points
spanning 90 days, and no URL or remote product identifier. Synthetic values must never be described
as facts about a real product or retailer.

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
status/error code, attempt/completion timestamps, and the controlled application date. A unique key
makes concurrent or replayed routine work collapse to one result.

### `price_observations`

Observations are append-only integer cents with currency, date, source version, and owning run/item.
`(item, source version, observation date)` is unique. Identical replay is idempotent; a different
price for that logical key is an integrity conflict. A date after the run/application date is
rejected. Triggers/constraints enforce item ownership and currency consistency.

### `purchase_timing_assessments`

Assessments are immutable and unique per completed run. They snapshot item/owner, current plan
version and readiness/health, policy/source versions, state, all required statistics, rationale
codes, and timestamps. An update or direct delete is rejected except the documented owner-data
cascade. `HISTORICALLY_FAVORABLE_PLAN_READY` requires snapshotted `PURCHASE_READY`; a paused or
funded-but-locked plan is not ready.

## Valid observation set

For an assessment at controlled `asOfDate`:

1. Normalize and validate one currency and source version.
2. Reject nonpositive prices, invalid dates, and any observation after `asOfDate`.
3. Deduplicate only byte-equivalent logical observations.
4. Sort by date, then the stable observation key.
5. Use observations from the trailing 730 calendar days ending at `asOfDate`; if the source has less
   history, use all valid history.
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

`runDuePriceChecks(clock, userId)` is an idempotent application use case:

1. Load only the owner's latest enabled due policies.
2. Claim or replay the unique policy/application-date run.
3. Call the fixture provider outside the claim transaction.
4. Validate the entire returned batch before writing any point.
5. Insert new observations idempotently in one transaction.
6. derive plan readiness from the owner-scoped authoritative plan/ledger at the same clock date;
7. calculate and store one immutable assessment;
8. emit only the allowlisted `purchase_timing_viewed`/routine outcome telemetry;
9. complete the run and return counts plus safe status codes.

A failed batch stores no partial observations or assessment. A retry reuses the logical run and can
complete it once. `corepack pnpm price-watch:run` invokes this use case locally; Story-Mode
Autopilot may invoke it after advancing the same user's clock. No Kafka, Redis, SQS, distributed
scheduler, or second database is introduced.

## API and feature gate

Routes are under `/api/v1/timing-lab` and support owned purchase-item create/update/archive, watch
policy create/list, assessment history/latest, and explicit local due-run invocation. When the flag
is off, routes return 404 and the provider is not instantiated. Mutations require authentication,
ownership, CSRF, Origin, rate limit, strict schemas, safe errors, correlation ID, and normalized
request-hash idempotency. Non-owner resources are indistinguishable 404s.

No route accepts a URL, provider endpoint, arbitrary product identifier, uploaded data, free-form
metadata, plan health, assessment state, price statistic, or provider result from the browser.

## User interface

The premium preview shows current demo price, user target, historical range, empirical percentile,
state, observation count/span, freshness, plan-readiness status, deterministic rationale, an
accessible price chart and complete text table, demo-data disclosure, and no-prediction disclosure.
A restrained “GoalPilot Plus” or “Premium preview” badge is allowed.

The interface explicitly handles disabled, loading, empty, insufficient, stale, server/network
failure, historically favorable ready/not-ready, watch, typical, elevated, funded-but-locked, and
archived states. Price color never conveys state alone. It never renders raw provider or database
errors.

## Required tests

- exact min/median/max, tie-aware empirical percentile, signed differences, count/span/freshness;
- 29 points and 30 points with 89/90-day spans;
- 14/15-day freshness and 2,500/7,500-basis-point thresholds;
- all seven states and readiness/paused/locked precedence;
- 23-month versus 24-month seasonal gate and per-month sample minimum;
- input-order invariance and deterministic policy/source versions;
- future point, nonpositive price, currency mismatch, conflicting duplicate, identical replay;
- cross-goal/owner database constraints and uniform API 404s;
- append-only observations/assessments and concurrent run uniqueness;
- failed batch atomicity and successful retry;
- favorable history cannot change a plan or produce ready while not ready;
- flag-off returns 404 and performs no provider call;
- complete fixture performance baseline;
- accessible chart/text parity and Journey D/E.

## Limitations and future path

The fixture history is synthetic and not evidence of a market pattern. Percentile thresholds are a
versioned product heuristic, not statistical inference. The analysis omits taxes, shipping,
inventory, financing, condition, model substitutions, retailer quality, and real-time changes. A
future external-data adapter requires separate authorization and review and must preserve this
provider boundary, validation, provenance, replay, privacy, readiness, and non-prediction policy.
