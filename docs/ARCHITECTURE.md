# Architecture

GoalPilot uses a pnpm workspace with `apps/web` and `apps/api`, plus packages for contracts, pure
domain calculations, provider ports/simulators, data access, authentication, observability, UI, and
test support.

Dependency direction is browser → contracts, API → application adapters, adapters → provider ports
and repository, repository → PostgreSQL, and pure domain → contracts/Decimal only. Financial
functions receive normalized input, a versioned assumption, and an explicit date; they do not read
environment state or call providers.

The persisted model separates goals, immutable plan and assumption versions, simulated accounts,
an append-only monetary/activity ledger, schedule occurrences, idempotency records, sessions,
audit events, privacy requests, and a singleton application clock. Composite ownership foreign
keys prevent cross-user child rows; plan/goal, assumption/vehicle, account/reversal, and interest
period relations are also bound by composite keys. See [ERD](architecture/ERD.md).

Local adapters are `LocalAuthProvider`, `StaticRateProvider`, `SimulatedGoalAccountProvider`,
`SimulatedContributionProvider`, `SimulatedInterestProvider`, and `PersistedApplicationClock`.
The API obtains dates and catalogs through injected `Clock` and `RateProvider` ports, and simulator
adapters depend on a structural `SimulationStore` rather than the concrete data-access package.
Future providers must implement the same boundaries; no cloud adapter ships in this release.

## Approved PX architecture (implementation target)

PX00–PX10 extend the same dependency graph; they do not introduce a second database, distributed
queue, cloud service, external retail feed, or browser financial engine.

```text
React feature routes
  -> typed Fastify contracts
  -> application use cases
  -> pure plan-health / scenario / recovery / price-statistic domain functions
  -> owner-scoped repositories + provider ports
  -> PostgreSQL + deterministic simulator fixtures
```

Partial builder work belongs to an owner-scoped `goal_drafts` aggregate instead of weakening the
validated `goals` schema. Draft activation is transactional and produces goal, immutable plan v1,
simulated account, schedule, activity, and idempotency result. Scenario previews are stateless;
apply inserts immutable plan vN and changes only the current account pointer and future schedule.

Consumer demo controls require per-user application clocks and owner-filtered Autopilot queries.
The old singleton clock may support migration compatibility but cannot authorize a browser action.
Only a persisted seeded-fixture capability permits reset, and reset is scoped to that fixture user.

Product analytics use a constrained append-only `product_events` store separate from security
audit events. The Timing Lab adds `HistoricalPriceProvider` plus a fixture adapter, five owned
PostgreSQL concepts, pure versioned statistics, and an idempotent `runDuePriceChecks(clock, userId)`
use case. Disabled timing routes are 404 and do not instantiate a provider. Purchase timing reads
plan readiness but never mutates the plan.

Local release and demo modes serve production-built artifacts on distinct loopback ports. Demo
capabilities are server-reported and server-enforced; a frontend flag is not authorization. The
same application use cases remain portable to a future scheduler in M19+ without importing AWS.
