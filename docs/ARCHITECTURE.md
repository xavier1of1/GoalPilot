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
