# Security

## Current local threat model

GoalPilot's PX00–PX10 release assumes an untrusted browser, mutually isolated local users, a
loopback-only runtime, and no real financial credentials or money movement. The current identity
adapter is `LocalAuthProvider`; Cognito, OAuth, PKCE, MFA, AWS IAM, and cloud edge controls remain
future M19–M22 work and are not local security claims.

Current controls include strict TypeScript, strict Zod write schemas and data-bearing 2xx response
schemas, parameterized SQL, composite ownership foreign keys, salted scrypt password hashes,
random opaque sessions, a session-bound CSRF header token delivered through a readable SameSite
cookie and backed by a server-stored hash, exact Origin/CORS allowlists, Helmet headers, 64 KiB
payload limits, per-process rate limiting, safe error envelopes with request IDs, structured Pino
logs, and tested log redaction. Generated OpenAPI uses those route schemas; 204 responses are
bodyless.

Configuration fails closed:

- `AUTH_MODE` must be `local` and `FINANCIAL_PROVIDER_MODE` must be `simulated`;
- staging and production startup are rejected because no external auth adapter ships;
- web, API, and database URLs must resolve to loopback (or the documented Dev Container host
  bridge), and `0.0.0.0` binding is allowed only inside the Dev Container;
- demo and Timing flags default off;
- release scripts require `goalpilot_local`, while test reset requires the exact isolated
  `goalpilot_test` identity.

## Local session and cookie policy

Registration/login create a 32-byte random session token and 32-byte random CSRF token. PostgreSQL
stores only their SHA-256 hashes. Sessions have an eight-hour sliding idle expiry bounded by a
seven-day absolute expiry.

- `goalpilot_session`: `HttpOnly`, `SameSite=Lax`, path `/`, seven-day browser maximum.
- `goalpilot_csrf`: readable by the browser client, `SameSite=Lax`, path `/`, seven-day browser
  maximum; its hash is bound to the server-side session.
- Both cookies intentionally use `Secure=false` only in the current `local` and `test` HTTP modes.
  The current process refuses staging/production, so this exception cannot silently become a
  deployment policy. A future HTTPS adapter must use `Secure=true`.

Every `POST`, `PATCH`, `DELETE`, or `PUT` request must carry the exact configured `WEB_ORIGIN`.
Authenticated `/api/v1` mutations also require the CSRF header, except anonymous/local registration,
login, preview, and baseline operations. Logout requires CSRF. CORS allows credentials only from
the configured web origin.

## Authentication, ownership, and capability responses

The server derives the internal user from the hashed session; request bodies never supply an owner
as authorization proof. Owner-scoped SQL and composite keys enforce access to goals, drafts, plan
history, accounts, ledger entries, clocks, and Timing records.

The response distinction is intentional:

- A missing, foreign, disabled-feature, or otherwise non-addressable resource is 404. Cross-owner
  reads and writes, cross-owner Timing resources, reset attempts that do not match the owned seeded
  fixture, and demo/Timing routes that are not registered all use this indistinguishable response.
- 403 is reserved for non-resource policy denial. Examples are a bad Origin/CSRF boundary and
  `POST /api/v1/demo/advance` by an authenticated user who lacks the persisted seeded-demo
  capability. This capability denial happens before an owned goal can be advanced and does not
  disclose whether a submitted goal ID exists.
- Stale optimistic versions and idempotency-key/body conflicts return 409.

Origin validation runs before route resolution, so a bad Origin is 403 even if the submitted path
would otherwise be absent. With the allowed Origin, a disabled demo/Timing mutation is allowed to
fall through to the indistinguishable 404 without demanding CSRF; registered protected mutations
then apply the CSRF boundary before their owner-scoped lookup.

`GET /api/v1/capabilities` reports server-derived flags. UI visibility is never authorization.

## Financial and historical integrity

Ledger entries are append-only by trigger; corrections use constrained reversals. At most one
reversal may exactly negate an `account_opened`, `contribution_posted`, or `interest_posted` credit
in the same owned account; a reversal or non-credit activity cannot be reversed. Composite
account/owner references, amount/type checks, unique occurrence IDs, interest-period uniqueness,
reversal-aware fixed-term availability, and reconciliation queries protect financial history.
Reversal validation takes an owned account-row lock before it inspects the source, closing the
concurrent double-reversal validation window. Vehicle assumptions and plan versions are immutable.
Current-schema writes persist input, output, calculation context,
application/schedule dates, policy versions, and change provenance at the version boundary. The
deterministic migration-010 context on a pre-context row is a compatibility reconstruction with the
historical-accrual limitation documented in [ARCHITECTURE.md](ARCHITECTURE.md), not proof of
original capture. Goal archive state requires an archive timestamp and closed reason code.
Migration 011 may reconstruct those fields on a pre-provenance archived row from audit history or,
when none exists, `updated_at` plus `GOAL_COMPLETED`; current archive operations persist the actual
reason and time.

Draft activation and plan-version apply run transactionally with optimistic versions and
request-hash idempotency. Plan apply also compares the calculation's application date and complete
account/ledger financial revision inside the write transaction, so a contribution or accrual race
cannot persist a stale plan version. `idempotency_records` replays completed responses. Multi-step
application commands use leased `application_command_claims`; if work could have committed before
response persistence failed, the claim remains indeterminate and automatic retry is refused.

Story advance has a separate per-user ten-minute financial-run lease on the controlled-clock row.
Only one unexpired token may own the run; expiry permits bounded stale recovery, a stale token
cannot release a replacement, and existing-goal update, draft/legacy activation,
lifecycle/archive, manual contribution, and scenario/recovery apply reject with a conflict while
the lease is active. Seeded reset also refuses an active run. This is not a claim that draft CRUD,
stateless preview, Timing, or privacy deletion takes the financial lease. Lease acquisition and
release advance the clock's optimistic version, and a runner that loses release ownership fails
closed rather than reporting success.

HTTP reset additionally requires the expected goal version and exact confirmation literal
`RESET_SEEDED_STORY_DEMO`; the server still verifies the caller's persisted fixture capability and
owned fixture match rather than treating that literal as authorization.

HYSA accrual is additionally revision-checked under account/goal locks. The repository compares
processing-date ledger balance/count, accrual date/remainder, goal version/target, and current plan
pointer; the simulator reloads and recalculates after a conflict and stops after three conflicts.
Future-effective rows are excluded from earlier balance, plan, activity, and accrual calculations.
A persisted date ahead of the per-user clock becomes a Story recovery high-water date rather than
silently contaminating an earlier calculation.

The deterministic Timing provider accepts only `synthetic_oled_65_v1` and no URL, upload, retailer
endpoint, or arbitrary product identifier. The full batch is validated before persistence.
Observation keys and source provenance are exact; observations and assessments are immutable;
owned policy/date runs and run/key membership are unique. Cross-run reuse of a logical
item/source/key must preserve identical value/date/currency, and terminal/draft/active assessment
plan provenance is database-checked. Timing reads plan readiness but cannot mutate a plan.
That exact-key statement applies to current imports. Migration 011 assigns deterministic
`stored-YYYY-MM-DD` compatibility keys to older rows whose original provider key was never stored.

Provider execution has its own per-run ten-minute generation lease. Another caller observing an
unexpired token receives `in_progress` and does not call the provider; expiry can replace it only
through the next attempt on the same logical run, with three attempts maximum. Completion/failure
requires the matching current token and clears both worker fields. This confines stale-worker
effects and is separate from both HTTP `application_command_claims` and the owner financial lease.
A superseded worker that cannot persist failure contributes `in_progress` instead of a failure and
does not itself cause a failure event.

## Telemetry, logs, and errors

`product_events` is separate from security `audit_events` and append-only. The API accepts one of
the closed event schemas, derives the demo flag server-side, and persists only event name/time,
pseudonymous subject, allowed categorical fields, demo status, and application version. It rejects
money, dates entered by the user, names/notes, URLs, email, resource/account/session/request/CSRF
identifiers, secrets, and arbitrary metadata. Routine Timing outcomes are limited to:

- `purchase_timing_check_completed`;
- `purchase_timing_check_failed`;
- `purchase_timing_check_replayed`;
- `purchase_timing_check_no_due`.

An `in_progress` Timing summary is transient and intentionally records none of these events.

Routine request logs contain request ID, method, route template, status, and duration. They do not
contain request/response bodies, cookies, tokens, email, goal text, money, database URLs, or raw
exceptions. Unexpected errors are reduced to a safe type classification in logs and a generic
`INTERNAL_ERROR` client envelope; raw messages and stacks are not emitted.

## Privacy export and deletion

`POST /api/v1/data-exports` returns `goalpilot-user-data-export-v2` with explicit owner-filtered,
column-allowlisted data: profile, drafts, per-user clock, demo capability, goals, immutable plans,
simulated accounts, ledger entries, processed schedule occurrences, interest periods, and owned
Timing items/policies/runs/observations/assessments. It excludes password hashes, sessions, CSRF
hashes, idempotency responses, command claims, Timing worker tokens/lease expiries, audits, product
events, and privacy-request operations. Strict nested record schemas reject an unexpected
operational field rather than serializing it.

Account deletion cascades the local user and all directly owned rows, including drafts, clocks,
plans, account/ledger processing history, command state, and Timing records. Before deletion,
retained audit events are detached from the user, assigned a salted pseudonymous subject, and have
resource IDs and metadata cleared. Product-event aggregates have no user foreign key and remain
unlinked pseudonymous records; they are not represented as exported financial data.

## Verification and future boundary

Repository verification includes route-policy, ownership, relational integrity, append-only,
privacy, secret-scan, production-dependency audit, and SBOM checks. A configured control or a test
definition is not evidence by itself; a release claim requires the exact command to complete and
its output to be retained in release evidence.

Current workflow definitions cover Gitleaks, CodeQL, pull-request dependency review, the canonical
local verification command, and Chromium E2E. AWS/CDK checks remain future M19–M22 work and have no
current infrastructure package to exercise. Workflow definitions do not prove that AWS
infrastructure, Cognito, a public deployment, an external security review, or compliance
validation exists.
