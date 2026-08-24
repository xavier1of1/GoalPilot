# Architecture

## Current local release

GoalPilot is a pnpm TypeScript workspace with `apps/web` and `apps/api`, plus packages for shared
contracts, pure domain calculations, provider ports and deterministic simulators, PostgreSQL data
access, local authentication, observability, UI primitives, and test support. The active release is
local PX00–PX10. It does not contain an AWS adapter, Cognito integration, CDK application, external
financial provider, retailer feed, queue, or distributed scheduler.

The runtime dependency direction is:

```text
React browser application
  -> shared Zod contracts and typed API client
  -> Fastify routes and application use cases
  -> pure financial, plan-health, scenario, recovery, and price-statistic policies
  -> owner-scoped repositories and provider ports
  -> PostgreSQL 17 and deterministic local simulators
```

Financial domain functions receive normalized input, a versioned assumption, and an explicit
calendar date. They do not read environment state, query PostgreSQL, or call providers. The browser
formats server results but does not reproduce financial calculations.

Fastify uses the shared Zod schemas for request validation and response serialization. Every
data-bearing 2xx route declares its response contract (204 is bodyless), and generated OpenAPI is
derived from those same route schemas. An over-wide server/provider value therefore fails closed
instead of leaking an undeclared field; safe error envelopes remain the separate global error
boundary.

## Persistence and aggregate boundaries

The current schema is the result of every committed SQL migration applied in lexical order. It
contains local users and sessions; partial goal drafts; goals; immutable vehicle assumptions and
plan versions; simulated accounts; an append-only ledger; processed schedule occurrences and
interest-posting periods; completed idempotency responses and in-flight application-command
claims; security audits and privacy requests; compatibility and per-user application clocks;
seeded-fixture capabilities; constrained product events; and the five Purchase Timing Lab tables.
See the [current ERD](architecture/ERD.md); release evidence records the exact final
migration/checksum inventory rather than this architecture narrative freezing a moving count.

Composite ownership foreign keys prevent a child row from combining resources belonging to
different users. Plan versions carry their immutable normalized input, calculation output,
`plan-calculation-context-v1` snapshot, application date, schedule anchor, omitted contribution
dates, policy versions, change provenance, and optional base-plan link. Goal archive provenance is
stored as `archived_at` plus one closed reason code.

Current-schema plan writers capture that context at the version boundary. Migration
`202608230010` deterministically backfills older rows that predate the context column, but it cannot
recreate facts the prior schema never stored: a non-current historical HYSA version receives zero
unposted accrual, while the current version can use the account's stored remainder, and fixed-term
opening context is reconstructed from the stored input/assumption. Such rows are immutable upgrade
compatibility snapshots, not evidence that the reconstructed context was captured at original
creation time.

Migration `202608230011` has analogous upgrade-only provenance fallbacks. For an already-archived
goal it uses the latest usable `goal.archived` audit event when present; otherwise it uses the
goal's `updated_at` and `GOAL_COMPLETED`. Older price observations, which had no provider key,
receive deterministic `stored-YYYY-MM-DD` keys. Current archive writes and newly imported
observations persist the actual reason/time and provider key respectively; the legacy fallbacks are
not original-source evidence.

The simulated-account table has no separate persisted `archived` lifecycle. Any goal archive
closes that simulator row with terminal `completed` storage and no next contribution. Read models
derive account-summary `archived` for `USER_REQUESTED` and `NO_LONGER_PURSUED` goals and preserve
their actual progress; `GOAL_COMPLETED` archives retain completed/100% presentation. Goal archive
provenance, rather than the closed simulator status alone, is therefore authoritative for the
consumer label.

Partial builder work belongs to the owner-scoped `goal_drafts` aggregate and is protected with an
optimistic version. Draft activation revalidates the complete contract and transactionally creates
the goal, immutable plan v1, simulated account, opening ledger activity, completed idempotency
response, and audit event, then removes the draft. It stores a schedule anchor and the account's
next contribution date. It does **not** persist rows for all future contributions:
`schedule_occurrences` records only occurrences processed by Autopilot, where its unique
account/date key provides replay protection.

Ledger corrections are constrained reversals: one reversal may reference an `account_opened`,
`contribution_posted`, or `interest_posted` credit in the same owned account; it may not reverse a
reversal or non-credit activity and must exactly negate principal and interest. The database's
available-balance function is reversal-aware for fixed-term source lots and maturity interest,
while the total ledger value remains the signed ledger sum. Reversal validation locks the owned
simulated-account row, so concurrent attempts cannot both validate against an unlocked source.

What-If preview is stateless. Apply reloads the current owned snapshot and, inside its transaction,
checks the application date, goal/plan versions, account lifecycle/dates/accrual remainder, signed
ledger value/count, personal principal, and current availability against the financial revision
used to calculate the preview. If any of that state changed, apply returns a conflict instead of
persisting a stale result. A successful apply inserts immutable plan vN, moves the simulated
account's current-plan pointer, updates the next due date from the preserved schedule anchor and
omitted dates, and appends `plan_changed` activity. Existing plan and processed schedule rows are
not rewritten.

## Clocks, capabilities, and idempotency

Authenticated calculations and mutations use `user_application_clocks`. Browser controls can
advance only `NEXT_CONTRIBUTION`, `ONE_MONTH`, `SIX_MONTHS`, `NEXT_MATURITY`, or `TARGET_DATE`.
`application_clock` remains for anonymous/default-clock compatibility and migration seeding; it is
not authority for an authenticated browser mutation.

Story advance first claims a per-user financial-run lease on that clock row. The lease stores a
ULID token and a ten-minute expiry, increments the clock version, rejects another claim while
active, permits reclaim only after expiry, and can be released only by the currently stored token.
Existing-goal update, draft/legacy activation, lifecycle/archive, manual contribution,
scenario/recovery apply, and seeded reset transactions lock or inspect the same owner clock and
reject while the lease is active. Draft CRUD, stateless previews, Timing item/provider work, and
privacy deletion are not described as financial-run-guarded operations. A lost/stale runner cannot
clear a replacement lease, and the HTTP command fails closed if it loses ownership before release.
This lease is local coordination, not an external scheduler or distributed-worker claim;
`application_command_claims` separately protects idempotent response persistence.

HYSA daily accrual reads ledger balance/count only through the processing date and compares that
revision, account accrual state, goal version/target, and current plan pointer again while the
account and goal are locked. A conflict causes the simulator to reload and recalculate from the
same processing date, with failure after three conflicts instead of posting from a stale snapshot.
If a prior interrupted run left the clock behind persisted ledger/account dates, milestone context
raises the next run through that pending financial high-water date so the normal idempotent loop can
finish recovery.

`demo_fixture_users` is the persisted capability for the Japan fixture. Demo routes are registered
only when `DEMO_STORY_ENABLED=true`, and reset is limited to the marked user/goal. A reset requires
the exact confirmation literal `RESET_SEEDED_STORY_DEMO`, expected goal version, CSRF token,
allowed Origin, and idempotency key.

Owned lookup failure—including a foreign ID or reset that does not match the caller's marked
fixture—is 404. `POST /api/v1/demo/advance` by an authenticated user who lacks the persisted
fixture capability is the intentional non-resource 403; CSRF/Origin policy failures are also 403.

Successful responses for atomic repository operations are stored in `idempotency_records`.
Commands whose work and response persistence span application steps first acquire a leased
`application_command_claims` row. If work may have committed but response persistence fails, the
claim remains indeterminate and retries fail closed; only work proven not to have committed may be
explicitly marked retryable.

## Provider boundaries

Current ports are `Clock`, `AuthProvider`, `RateProvider`, `GoalAccountProvider`,
`ContributionProvider`, `InterestProvider`, and `HistoricalPriceProvider`. Current adapters are
`LocalAuthProvider`, `StaticRateProvider`, `SimulatedGoalAccountProvider`,
`SimulatedContributionProvider`, `SimulatedInterestProvider`, `PersistedApplicationClock`,
`PersistedUserApplicationClock`, and `FixtureHistoricalPriceProvider`. Simulator adapters depend
on structural stores/ports rather than importing HTTP concerns.

The Timing Lab provider accepts only the allowlisted `synthetic_oled_65_v1` fixture code and an
explicit date. Its use case claims an owned due run, calls the fixture provider outside the claim
transaction, validates the full batch, persists one run-scoped exact series plus one immutable
assessment transactionally, and reads—but never mutates—the immutable financial-plan context.
Separate provider keys may share a date; a run/key is unique, while a conflicting reuse of the same
item/source/key across runs is rejected under an advisory lock. Draft, active, and
completed/archived assessments have database-checked plan-provenance shapes. When
`PURCHASE_TIMING_LAB_ENABLED=false`, its repository/provider are not constructed and its routes do
not exist, so requests receive 404.

The unique policy/application-date run owns a separate ten-minute provider-worker generation
token. A caller that finds an unexpired generation receives an `in_progress` summary without a
provider call or outcome event. An expired generation is failed and may be reclaimed on that same
row with a new token and incremented attempt, up to three total attempts. Completion and failure
are accepted only for the matching current generation and clear the worker token/expiry; completed
runs replay. This lease is not the `application_command_claims` response-persistence protocol and
is not the owner-wide Story financial lease. If a late worker can no longer update failure with its
token, that watch contributes `in_progress` rather than a failure count/code and does not itself
cause a stale failure event.

The Timing routine does not take the Story financial-run lease because it does not mutate the
plan/ledger. It reloads authoritative plan provenance after the provider returns; therefore an
archive that completes during the provider call is retained as archived assessment provenance
with its plan version and null current health.

## Telemetry and privacy

`product_events` is an append-only store separate from `audit_events`. It has no goal, item,
account, session, or user foreign key and contains only a salted pseudonymous subject plus closed
categorical columns. The Timing routine emits exactly one of
`purchase_timing_check_completed`, `purchase_timing_check_failed`,
`purchase_timing_check_replayed`, or `purchase_timing_check_no_due` for each terminal, replay, or
no-due use-case summary. A transient `in_progress` summary emits none.

The v2 user export selects owned product records explicitly, including drafts, the per-user clock,
fixture capability, immutable plans, account/ledger processing history, and Timing records. It
excludes password/session/CSRF material, command/idempotency internals (including Timing worker
tokens/expiries), audit events, product events, and privacy-request operations. Strict nested
schemas reject unexpected export fields. Account deletion cascades owned rows and pseudonymizes
and scrubs retained audit events; unlinked product-event aggregates remain pseudonymous.

## Future M19–M22 adaptation

CloudFront, S3, API Gateway, Lambda, Cognito, EventBridge, hosted PostgreSQL, CDK, and GitHub OIDC
deployment remain future M19–M22 decisions. They are neither implemented nor local acceptance
criteria. A future adapter must preserve the current contracts, deterministic domain, ownership
rules, provider ports, and application use cases; no current document may treat portability as
evidence that AWS is ready or deployed.
