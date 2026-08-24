# GoalPilot MVP Product Requirements Document

**Document owner:** Xavier Kubancik<br>
**Status:** Approved local product-experience baseline<br>
**Version:** 1.1<br>
**Baseline date:** 2026-08-23<br>
**Target release:** Local product-experience release for structured user validation

> **Current release authority:** Local M00–M18 acceptance and the subsequent product-experience
> phase are authoritative for the current release. AWS criteria remain future M19–M22 work.

Requirements in this document that mention Cognito, CDK, Lambda, CloudFront, a deployed URL, or
another AWS service describe the future M19–M22 adaptation unless the product-experience phase
explicitly says otherwise. They are not acceptance criteria for the current local release.

## 1. Purpose

This document defines the first buildable version of GoalPilot. It replaces the earlier
production-heavy architecture with a deliberately inexpensive local MVP that demonstrates the core
product thesis, full-stack engineering, cybersecurity discipline, and an extensible path to future
cloud/provider adapters. Cloud deployment is a future M19–M22 objective, not a claim about the
current release.

GoalPilot helps a user answer a concrete question:

> How much should I save, where could the money earn interest while I wait, and am I on pace to afford the purchase by my deadline?

The MVP does **not** hold, transfer, invest, or stake real customer funds. It creates a secure, authenticated planning and simulation experience that models recurring contributions and interest-bearing financial vehicles. The internal architecture must make later provider integration possible without rewriting the domain model or user experience.

## 2. Source basis and superseded assumptions

This PRD preserves the strongest requirements from the prior GoalPilot product and system design:

- feasibility before yield;
- policy eligibility before optimization;
- deterministic, reproducible financial calculations;
- every rejected option remains visible with a reason;
- no guaranteed outcomes;
- AI never owns a financial number;
- user-owned data access is enforced server-side;
- security, auditability, and versioned assumptions are first-class concerns.

It also preserves the security roadmap's emphasis on low-cost controls before expensive external audits: MFA, protected branches, secret scanning, data classification, threat modeling, least privilege, structured logs, dependency review, and an SBOM.

The following earlier assumptions are superseded for this MVP:

- The MVP will **not** deploy the fixed-cost ECS, ALB, private-subnet, NAT Gateway, WAF, and RDS topology.
- The MVP will **not** implement live money movement, account opening, Plaid, custody, brokerage execution, or real recurring ACH.
- The MVP will **not** use live financial rates unless a trustworthy source and approval workflow are added later.
- Documentation will **not** infer completion from this plan. Current behavior claims require
  repository implementation, and command-pass claims require exact executed evidence.

## 3. Product vision

### 3.1 Long-term vision

```text
Choose something to save for
→ choose the amount and deadline
→ authorize recurring installments
→ GoalPilot places each installment into an interest-earning account
→ GoalPilot monitors progress automatically
→ the user withdraws the money when the goal is reached
```

### 3.2 MVP expression of that vision

```text
Choose something to save for
→ choose the amount and deadline
→ compare eligible interest-bearing vehicle models
→ activate a simulated GoalPilot plan
→ record or simulate recurring contributions
→ apply versioned illustrative interest assumptions
→ monitor progress automatically
→ mark the goal purchase-ready
```

The distinction must be conspicuous throughout the product: the MVP simulates the experience and does not open or control a financial account.

## 4. Goals

The MVP must:

1. Give users a clear, polished goal-planning experience.
2. Calculate whether contributions alone can reach the goal.
3. Compare a narrow set of interest-bearing financial vehicles appropriate for dated purchases.
4. Estimate the recurring contribution required to reach the target under each eligible vehicle.
5. Show the contribution principal, modeled interest, ending balance, and projected completion date.
6. Allow an authenticated user to save a goal and activate a simulated plan.
7. Support manual simulated contributions and optional scheduled demo contributions.
8. Recalculate progress using an immutable vehicle-assumption version.
9. Demonstrate secure local full-stack design while preserving a path to a separately gated,
   low-cost AWS adaptation.
10. Preserve clean provider interfaces for later bank, funding, and rate integrations.

## 5. Non-goals

The MVP must not:

- accept, custody, pool, transfer, or withdraw real money;
- open a bank, brokerage, crypto, or custodial account;
- connect to a real bank through Plaid or another aggregator;
- collect routing numbers, account numbers, SSNs, identity documents, or bank credentials;
- execute ACH, cards, wires, securities trades, Treasury purchases, crypto trades, or staking;
- present personalized investment advice;
- scrape current APYs or claim a rate is currently available;
- guarantee interest, returns, principal protection, or goal completion;
- calculate individualized tax liability;
- include equities, options, leveraged products, or crypto in the MVP recommendation catalog;
- use an LLM to calculate, select, rank, or modify a financial result;
- implement social feeds, shared goals, merchant checkout, lending, or subscriptions.

## 6. Target users

### Primary user

A financially motivated young professional saving for a discretionary purchase of approximately $500 to $25,000 within 3 to 36 months, such as:

- travel;
- a vehicle down payment;
- a computer or electronics purchase;
- furniture or appliances;
- a wedding or event;
- hobby equipment;
- a home-improvement purchase.

### User needs

The user needs to know:

- whether the goal is feasible with no interest;
- the installment required at a chosen cadence;
- how much modeled interest could help;
- which products conflict with the deadline or liquidity need;
- how far ahead or behind the plan is;
- what controllable action will restore the plan when it falls behind.

## 7. Product principles

| Principle                              | Required behavior                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| Feasibility before yield               | Always calculate the zero-interest contribution baseline first.                            |
| Interest is a buffer                   | Never understate the installment solely because a variable rate may continue.              |
| Eligibility before ranking             | A product that violates horizon or liquidity rules cannot be recommended.                  |
| Transparent assumptions                | Every result displays rate, source type, effective date, version, and illustrative status. |
| Controllable levers first              | When behind, suggest contribution, deadline, or target changes before more risk.           |
| Deterministic core                     | Equal input plus equal assumption version produces equal output.                           |
| Every option visible                   | Rejected vehicles remain visible with stable reason codes.                                 |
| Simulation is explicit                 | No screen may imply that GoalPilot currently holds or invests money.                       |
| Security by default                    | Ownership, validation, logging redaction, and least privilege are not optional.            |
| Provider-ready, not provider-dependent | Domain interfaces support future real providers while the MVP uses simulations.            |

## 8. MVP scope

### 8.1 Vehicle catalog

The MVP supports four modeled vehicles:

1. **Plain cash**
   - 0% modeled APY.
   - Immediate liquidity.
   - Baseline comparator.

2. **High-yield savings model**
   - Variable illustrative APY.
   - Immediate or next-business-day modeled liquidity.
   - Principal-preservation-oriented deposit model.

3. **Certificate-of-deposit ladder model**
   - Fixed illustrative yield for defined terms.
   - Early-withdrawal or lock constraint.
   - Eligible only when the modeled ladder fits the deadline and liquidity requirement.

4. **Treasury-bill ladder model**
   - Illustrative yield and maturity schedule.
   - Modeled to maturity rather than relying on secondary-market sale.
   - Eligible only when maturities complete before the purchase date.

The catalog uses static, reviewed demo assumptions. The UI must display **Illustrative rate — not a live offer**.

### 8.2 Goal fields

Each goal contains:

- name;
- optional category;
- target amount in USD cents;
- current saved amount in USD cents;
- target date;
- recurring contribution amount in USD cents;
- contribution cadence: weekly, biweekly, or monthly;
- liquidity need: anytime, within 30 days, or only at goal date;
- capital-preservation preference: required or flexible;
- selected confidence setting for scenario display;
- optional notes;
- status: draft, active, paused, purchase_ready, completed, archived.

### 8.3 User-visible views and regions

The current React router exposes `/`, `/signin`, `/plan`, and `/dashboard`. Comparison, plan
detail, activity, and privacy controls are regions inside those pages rather than additional
routes.

1. **Public landing page**
   - Product promise.
   - Three-step explanation.
   - Security and simulation disclosure.
   - Call to action.

2. **Authentication**
   - Current local release: create a local profile, sign in, and sign out through hashed opaque
     server sessions.
   - Future M19–M22: Cognito sign-up/sign-in, email verification, password reset, and MFA.

3. **Dashboard**
   - Active goal card.
   - Amount saved, target, progress percentage, modeled interest, next contribution, and projected completion.
   - Empty, loading, error, and stale-assumption states.

4. **Goal builder**
   - Accessible multi-section form.
   - Immediate zero-interest feasibility feedback.
   - Clear explanation of every input.

5. **Vehicle comparison within the builder**
   - Eligible and rejected products.
   - Required contribution, modeled ending balance, modeled interest, access, and reason codes.
   - Recommended simulated fit based on deterministic policy.

6. **Plan detail workspace within the dashboard**
   - Principal contributed versus modeled interest.
   - Progress chart.
   - Next derived contribution date and processed simulated activity.
   - Assumption snapshot.
   - Pause, resume, archive, complete, and add simulated contribution actions. Goal metadata update
     exists in the compatibility API but is not a current dashboard editing control.

7. **Activity ledger within the dashboard**
   - Opening savings; scheduled/posted/failed contributions; accrued/posted interest; lifecycle and
     plan-change activity; simulated withdrawal and reversal records where present.

8. **Profile data controls within the dashboard**
   - Current profile context.
   - Data export request.
   - Account deletion request. There is no separate current settings route.

### 8.4 Explicit product language

Every projection or plan screen must include language equivalent to:

> Educational simulation using illustrative assumptions. GoalPilot does not hold, transfer, or invest money in this MVP. Rates and outcomes are not guaranteed.

## 9. Core user flows

### Flow A: Anonymous preview

1. User opens the landing page.
2. User enters goal amount, deadline, current savings, contribution, and cadence.
3. Client validates the shared schema.
4. API calculates a stateless preview.
5. User sees the no-interest baseline, vehicle comparison, and recommendation trace.
6. User is invited to create an account to save the plan.

### Flow B: Create and activate a simulated plan

1. Authenticated user saves an owner-scoped partial goal draft.
2. API verifies the local server session and validates each strict draft update.
3. User reveals the safe baseline, completes budget/access inputs, and selects an eligible
   simulated vehicle.
4. Activation revalidates the complete goal and atomically creates goal, immutable plan v1,
   simulated account, opening ledger activity, idempotency response, and audit event.
5. The API stores the schedule anchor and next derived contribution date, then removes the draft.
6. User sees the plan dashboard. Future schedule rows are not pre-created; processed due dates are
   recorded as Autopilot runs.

### Flow C: Add a simulated contribution

1. User selects **Add contribution**.
2. User enters the amount; the UI displays the server-provided current application date as a
   read-only effective date.
3. API validates ownership and amount.
4. API writes a ledger entry idempotently.
5. API recalculates the balance and projection.
6. UI displays the updated progress and audit-safe activity.

### Flow D: Demo autopilot

1. The marked local Japan-demo user chooses one allowed milestone.
2. The API checks the persisted fixture capability and claims one ten-minute financial-run lease
   on that user's application clock; an active owner run or guarded concurrent mutation conflicts.
3. The selected target is raised through any persisted financial high-water date left ahead of the
   clock by an interrupted run, so replay can complete it rather than use future state early.
4. The local Autopilot use case derives due contributions and creates one idempotent processed
   occurrence per account/date.
5. It accrues/posts modeled interest through the milestone using processing-date balances and
   bounded revision reload/recalculation, then evaluates purchase readiness.
6. It releases only its matching current lease token; ownership loss fails closed.
7. User sees the new application date, next event, contribution/interest counts and amount, health,
   and safe failure codes.
8. EventBridge or another scheduled cloud invocation remains future M19+ work.

### Flow E: Goal becomes purchase-ready

1. Available simulated balance reaches or exceeds target.
2. System stops future simulated contributions.
3. Goal state becomes `purchase_ready`.
4. User marks the goal completed or adjusts the target.
5. No real withdrawal is offered.

## 10. Functional requirements

### 10.1 Authentication and users

- **AUTH-L01 (current local):** Use `LocalAuthProvider`, salted scrypt password hashes, random
  opaque session/CSRF tokens stored only as hashes, and local profile registration/login.
- **AUTH-L02 (current local):** Require exact Origin on every mutation and CSRF on authenticated
  API mutations/logout; use `HttpOnly`/`SameSite=Lax` session cookies and a readable
  `SameSite=Lax` CSRF cookie. `Secure=false` is allowed only for current local/test HTTP.
- **AUTH-001 (future M19–M22):** Use Amazon Cognito for email-based sign-up and sign-in.
- **AUTH-002 (future M19–M22):** Verify JWT signature, issuer, client ID, token use, and expiration
  server-side.
- **AUTH-003:** Never trust a user ID supplied in request body, query, or URL as ownership proof.
- **AUTH-004:** Hide whether another user's goal exists; inaccessible resources return 404.
- **AUTH-005 (future M19–M22):** Support TOTP MFA configuration in infrastructure, optional for
  early cloud testers and mandatory before any real financial integration.

Current 403/404 semantics are deliberate: owner-filtered missing/foreign resources and unregistered
feature routes return 404; 403 is limited to non-resource policy denial such as Origin/CSRF failure
or demo advance by an authenticated user without the persisted seeded-fixture capability.

### 10.2 Goal management

- **GOAL-001:** Create, retrieve, update, pause, resume, complete, archive, and delete a user-owned
  goal.
  - Current implementation note: local PX exposes create/read/update/lifecycle/archive and
    account-wide deletion, but no per-goal hard-delete route. The route inventory therefore does
    not claim this last operation; archive is the consumer history behavior in PX00–PX10.
- **GOAL-002:** Use optimistic concurrency through a version number or ETag.
- **GOAL-003:** Use idempotency keys for goal creation and simulated contribution creation.
- **GOAL-004:** Store money as integer cents and dates as ISO calendar dates.
- **GOAL-005:** Limit the MVP to one active simulated goal per user while allowing archived history.

### 10.3 Calculation engine

- **CALC-001:** Produce a zero-interest contribution baseline.
- **CALC-002:** Generate weekly, biweekly, and monthly contribution dates.
- **CALC-003:** Model deposit interest using deterministic daily accrual and monthly posting.
- **CALC-004:** Model CDs and Treasury bills using maturity-aligned cash flows and explicit lock constraints.
- **CALC-005:** Calculate total principal, modeled interest, ending balance, shortfall or surplus, and completion date.
- **CALC-006:** Search for the required recurring contribution to the nearest cent.
- **CALC-007:** Reject stale, missing, malformed, or disabled assumptions.
- **CALC-008:** Return stable eligibility and rejection reason codes.
- **CALC-009:** Avoid floating-point storage for money; calculations must use integer cents and exact decimal or basis-point rules.

### 10.4 Vehicle policy

- **VEH-001:** Version the vehicle catalog.
- **VEH-002:** Plain cash is always available as a baseline.
- **VEH-003:** CD models are rejected when the liquidity requirement conflicts with lock or penalty assumptions.
- **VEH-004:** Treasury models are rejected when maturity falls after the goal date.
- **VEH-005:** Capital-preservation-required goals exclude any future market-value vehicle automatically.
- **VEH-006:** Ranking policy `vehicle-fit-v2` orders by eligibility, purchase readiness using the
  zero-interest safe contribution, declared access satisfaction, lower liquidity/lock conflict,
  higher modeled target-date cushion, then vehicle code. Return never overrides access or
  maturity.
- **VEH-007:** Compensation or affiliate status is not part of the ranking function.

### 10.5 Simulated account and ledger

- **SIM-001:** An active goal may have one simulated account tied to one assumption snapshot.
- **SIM-002:** Current persisted entry types are `account_opened`, `contribution_scheduled`,
  `contribution_posted`, `contribution_failed`, `interest_accrued`, `interest_posted`, `paused`,
  `resumed`, `goal_completed`, `simulated_withdrawal`, `reversal`, and `plan_changed`; amount/type
  checks constrain which may carry principal or interest.
- **SIM-003:** Ledger entries are append-only; a correction is the single exact same-account
  reversal of an `account_opened`, `contribution_posted`, or `interest_posted` credit and cannot
  reverse another reversal or non-credit activity.
- **SIM-004:** A scheduled contribution has a unique schedule occurrence ID.
- **SIM-005:** Re-running a scheduled job cannot duplicate a contribution or interest posting. The
  current Story route permits one unexpired ten-minute owner financial run, rejects guarded
  concurrent mutations, permits stale reclaim only after expiry, and requires matching-token
  release. Interest must reject a stale processing-date financial revision, reload/recalculate,
  and stop after three conflicts; future-effective ledger rows cannot affect an earlier date.
- **SIM-006:** Total balance is the signed ledger sum. Fixed-term availability must exclude reversed
  source lots and account for reversed maturity interest; any cache requires a reconciliation test.
- **SIM-007:** Changing the selected vehicle must create a new plan version and never rewrite prior
  history. Current What-If/Recovery intentionally keeps the vehicle fixed and exposes no vehicle
  change operation.
- **SIM-008:** Draft activation and plan changes persist a schedule anchor and next contribution
  date, but do not pre-create future `schedule_occurrences`; that table records processed dates
  only.

### 10.6 Assumptions

- **RATE-001:** Demo assumptions are stored in a versioned database record or reviewed seed file.
- **RATE-002:** Each assumption includes vehicle code, APY or yield, effective date, retrieval/review date, liquidity, lock, minimum, source label, and `illustrative=true`.
- **RATE-003:** The UI displays the exact version used by each saved plan.
- **RATE-004:** An administrator interface is not required; changing assumptions is a reviewed migration or seed update.
- **RATE-005:** The current `RateProvider` port must allow a future approved live adapter without
  changing calculation consumers.

### 10.7 Privacy and audit

- **PRIV-001:** Provide a machine-readable export of user, goal, plan, and ledger data. Current
  `goalpilot-user-data-export-v2` validates every record against its strict allowlist; Timing run
  attempts may be exported, but worker tokens/lease expiries and other command/idempotency
  internals do not cross the export boundary.
- **PRIV-002:** Provide an account-deletion workflow with a documented retention boundary.
- **AUDIT-001:** Append audit events for authentication-sensitive and goal-state-changing actions.
- **AUDIT-002:** Audit metadata must not contain secrets, JWTs, cookies, full request bodies, or unnecessary financial values.

## 11. Data model

The current ordered committed migrations create these records; executed release evidence records
the exact final migration/checksum inventory:

| Record                        | Current local purpose                                                      |
| ----------------------------- | -------------------------------------------------------------------------- |
| `users`                       | Local profile, email/display name, salted password hash.                   |
| `sessions`                    | Hashed opaque session/CSRF state and idle/absolute expiry.                 |
| `goal_drafts`                 | Owner-scoped strict partial builder JSON with optimistic version.          |
| `goals`                       | Complete user-owned goal, lifecycle/version, and archive provenance.       |
| `vehicle_assumption_versions` | Immutable illustrative catalog metadata.                                   |
| `vehicle_assumptions`         | Immutable parameters belonging to one catalog version.                     |
| `plan_versions`               | Immutable input/output/context, policy, schedule, and change provenance.   |
| `simulated_accounts`          | One simulated account and current-plan/next-date pointer per goal.         |
| `ledger_entries`              | Append-only simulated money and lifecycle/activity events.                 |
| `schedule_occurrences`        | Processed (not future) due dates, unique per account/date.                 |
| `interest_posting_periods`    | Interest-posting replay protection tied to exact ledger entries.           |
| `idempotency_records`         | Completed user/operation/key response replay.                              |
| `application_command_claims`  | Leased, fail-closed in-flight command claims.                              |
| `audit_events`                | Security-safe history retained pseudonymously after account deletion.      |
| `data_requests`               | Completed export request state; deletion completion is retained in audit.  |
| `application_clock`           | Singleton anonymous/default compatibility clock.                           |
| `user_application_clocks`     | Per-user date/version plus bounded Story financial-run token/expiry.       |
| `demo_fixture_users`          | Persisted capability and reset generation for the Japan fixture.           |
| `product_events`              | Unlinked append-only pseudonymous closed categorical events.               |
| `purchase_items`              | Owned allowlisted synthetic Timing item and target price.                  |
| `price_watch_policies`        | Immutable weekly/monthly watch-policy versions.                            |
| `price_check_runs`            | Unique owned policy/date result plus bounded provider-worker lease.        |
| `price_observations`          | Append-only exact fixture observations and provider keys.                  |
| `purchase_timing_assessments` | Immutable plan-readiness/statistics/provenance snapshot per completed run. |

Protected child relationships use composite owner keys. Future contribution dates are derived from
the immutable schedule anchor; only processed dates appear in `schedule_occurrences`.
Archiving closes the persisted simulated account with its existing terminal `completed` value and
clears the next contribution. For `USER_REQUESTED` or `NO_LONGER_PURSUED`, the API derives the
consumer account summary as `archived` from goal provenance and retains actual progress; it does
not mislabel an underfunded archive as completed or force it to 100%.

Current-schema writes capture plan context, archive reason/time, and provider observation keys at
the relevant boundary. Migrations 010/011 deterministically reconstruct fields missing from older
schemas; unavailable historical HYSA remainder, archive provenance without an audit event, and an
unstored provider key use the compatibility fallbacks documented in
[ARCHITECTURE.md](ARCHITECTURE.md). Those fallbacks are not exact original-source evidence.

Future provider records must be addable without changing the goal or plan identity:

- `financial_connections`;
- `partner_customers`;
- `partner_accounts`;
- `funding_sources`;
- `provider_transfers`;
- `provider_webhook_events`;
- `reconciliation_runs`.

## 12. API surface

Current health, anonymous-capable, authentication, and session routes:

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

Health, catalog, baseline, preview, registration, login, and session-status are anonymous-capable.
`/api/v1/me` and `/api/v1/capabilities` require authentication; logout requires session CSRF.
The loopback-only runtime also exposes generated operational documentation at `GET /docs/`,
`GET /docs/json`, and `GET /docs/yaml`; `GET /docs` redirects to the trailing-slash UI and
plugin-owned `/docs/static/*` assets are not product API routes.

Current authenticated draft/goal/plan/activity routes:

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

The progressive UI uses `goal-drafts`; direct goal create/activate remain compatibility routes.
There is no current `DELETE /api/v1/goals/:goalId` or
`GET /api/v1/goals/:goalId/plan-versions` route. Immutable history is at `/plan/history`.

Routes registered only when `DEMO_STORY_ENABLED=true`:

```text
POST /api/v1/demo/advance
POST /api/v1/demo/reset
```

Reset is limited to the caller's persisted seeded fixture and requires expected goal version plus
the exact confirmation literal `RESET_SEEDED_STORY_DEMO`; a non-matching owned fixture lookup is
404, not a capability 403.

Routes registered only when `PURCHASE_TIMING_LAB_ENABLED=true`:

```text
GET   /api/v1/timing-lab/purchase-items
POST  /api/v1/timing-lab/purchase-items
PATCH /api/v1/timing-lab/purchase-items/:itemId
POST  /api/v1/timing-lab/purchase-items/:itemId/archive
GET   /api/v1/timing-lab/purchase-items/:itemId/latest
POST  /api/v1/timing-lab/purchase-items/:itemId/watch-policies
POST  /api/v1/timing-lab/run-due-price-checks
```

`/latest` returns the item, latest policy, latest assessment, and exact stored series; no separate
policy-list or assessment-history route currently exists. All current background work is invoked
by a local authenticated route or CLI. A Lambda/EventBridge handler remains future M19+ work.

For each due policy/application date, provider work uses a separate ten-minute generation lease on
the one logical `price_check_runs` row. A second caller that observes an unexpired generation gets
`in_progress` without another provider call or routine event. Expiry permits the same row to move
to its next bounded attempt, up to three total; only the matching current generation token may
complete or fail it. A completed row replays without provider work. This worker lease is neither
the HTTP response-persistence claim nor the Story financial-run lease. If a worker loses its token
before recording a local failure, that watch contributes `in_progress` rather than a failure
count/code; an all-transient summary emits no outcome event.

## 13. Frontend design requirements

The visual system uses:

- British racing green as the primary brand color;
- warm ivory backgrounds;
- restrained muted-gold accents;
- high-contrast charcoal typography;
- generous whitespace;
- rounded but not cartoonish cards;
- one primary action per screen;
- clear financial-number hierarchy;
- subtle motion that respects `prefers-reduced-motion`.

The current frontend uses free, maintainable resources:

- Tailwind CSS for tokens and layout;
- source-owned React components and semantic native controls;
- Lucide icons;
- accessible semantic CSS charts with text/table equivalents;
- Figma Community references for inspiration only, never copied blindly.

Motion and Recharts are installed approved dependencies but current product states use CSS
transitions/charts and do not import them. shadcn/Radix source components remain approved options
when a future interaction requires them; the CLI/primitive packages are not current direct
dependencies and their presence is not an acceptance claim.

Requirements:

- WCAG 2.2 AA target for critical flows;
- complete keyboard navigation;
- visible focus states;
- semantic headings and landmarks;
- labels and instructions for every form control;
- error summaries plus field-level errors;
- color is never the sole status indicator;
- responsive support from 360px mobile width through desktop;
- no horizontal scrolling in ordinary flows;
- charts have text summaries and accessible labels.

## 14. Security requirements

The input, SQL, ownership, safe-error, redaction, CORS, header, dependency, and SBOM requirements
apply to the current local release. API Gateway, SSM, GitHub OIDC deployment, and CloudWatch bullets
below are future M19–M22 requirements and are not current controls.

- Validate every external input with shared runtime schemas.
- Parameterize all SQL; the current repositories use `postgres` tagged templates and reviewed SQL
  migrations rather than Drizzle.
- Apply the authenticated subject in every protected database predicate.
- Use generic error responses for unexpected failures.
- Redact authorization, cookies, tokens, emails, and financial amounts from routine logs.
- Use a strict CORS allowlist and security headers.
- Future M19–M22: add API Gateway throttling; current local mode uses supplemental in-process rate
  limits.
- Future M19–M22: store cloud secrets in SSM Parameter Store or deployment secrets. Current local
  secrets come from ignored environment configuration.
- Never commit `.env`, cloud credentials, database credentials, or JWTs.
- Future M19–M22: use GitHub OIDC for AWS deployment; no long-lived AWS keys in GitHub.
- Generate a CycloneDX SBOM in CI.
- Run CodeQL, Dependabot, dependency review, secret scanning, and production dependency audit.
- Future M19–M22: configure CloudWatch log retention explicitly.
- Maintain a lightweight threat model and data inventory before adding any financial provider.

## 15. Reliability and performance

MVP objectives:

| Objective                        | Target                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Stateless preview p95            | Under 1 second across 20 Fastify injections                                             |
| Authenticated goal-list GET p95  | Under 1 second across 20 Fastify injections                                             |
| One local What-If preview        | Under 1 second for the deterministic PostgreSQL fixture                                 |
| Timing full fixture              | Under 5 seconds for 731 deterministic observations                                      |
| Six-month local Autopilot        | Under 10 seconds for the owner-scoped Japan fixture                                     |
| Determinism                      | Equal normalized input and version produce equal output                                 |
| Duplicate simulated contribution | Zero                                                                                    |
| Cross-user data disclosure       | Zero                                                                                    |
| Availability target              | Best-effort MVP; architecture designed for 99.9% later                                  |
| Recovery                         | Current: exported migrations/data; future hosted-provider backups and restore rehearsal |

These are local regression ceilings, not production SLOs or load/capacity evidence. A configured
threshold is not a pass; release evidence requires the executed command and measured output.

The ordinary Fastify/application boundaries must remain adaptable to a future Lambda or ECS
transport, but no Lambda handler or ECS deployment ships in the current release.

## 16. Analytics and success metrics

Current local storage accepts only these event names:

```text
sample_goal_opened                 builder_started
builder_step_completed             safe_baseline_viewed
plan_previewed                     vehicle_details_opened
simulated_plan_activated           what_if_previewed
recovery_option_applied            autopilot_advanced
plan_paused                        plan_resumed
plan_purchase_ready                plan_completed
plan_archived                      purchase_timing_viewed
purchase_timing_check_completed    purchase_timing_check_failed
purchase_timing_check_replayed     purchase_timing_check_no_due
```

An observed active Timing worker returns the transient `in_progress` summary and emits no fifth
event. Terminal success/failure, completed replay, and no-due summaries map to the four closed
routine outcomes above.

The API stores only a salted pseudonymous subject, closed categorical fields, server-derived demo
status, application version, and event times/IDs. Do not store or send goal/product names, balances,
contribution/price amounts, dates entered by the user, notes, email, URLs, resource/session/request
identifiers, secrets, or arbitrary metadata. No third-party analytics adapter ships.

Success indicators:

- at least 70% of testers who start the builder complete a preview;
- at least 50% of authenticated testers activate a simulated plan;
- at least 50% of active-plan testers record or simulate three contributions;
- zero policy-gate bypasses;
- zero cross-user authorization failures;
- zero explanation or displayed-number mismatches;
- qualitative feedback indicates users understand principal versus modeled interest.

## 17. Provider-ready interfaces

The current local application defines provider-neutral ports for `Clock`, `AuthProvider`,
`RateProvider`, `GoalAccountProvider`, `ContributionProvider`, `InterestProvider`, and
`HistoricalPriceProvider`. Representative current signatures are:

```ts
interface RateProvider {
  getCatalog(asOfDate: string): Promise<readonly VehicleAssumption[]>;
}

interface GoalAccountProvider {
  open(input: OpenGoalAccountInput): Promise<{ accountId: string }>;
  summary(userId: string, goalId: string, asOfDate: string): Promise<AccountSummary | null>;
  getActivity(userId: string, goalId: string): Promise<readonly Activity[]>;
}

interface HistoricalPriceProvider {
  getHistory(input: { fixtureCode: string; asOfDate: string }): Promise<HistoricalPriceDataset>;
}
```

Current implementations:

- `StaticRateProvider`;
- `LocalAuthProvider`;
- `SimulatedGoalAccountProvider`;
- `SimulatedContributionProvider`;
- `SimulatedInterestProvider`;
- `PersistedApplicationClock` and `PersistedUserApplicationClock`;
- `FixtureHistoricalPriceProvider`.

A future `FundingProvider`, embedded-finance/sponsor-bank adapter, or external historical-data
adapter requires separate legal, security, privacy, commercial, and provider approval. It is not
present in PX00–PX10.

## 18. Historical cloud acceptance criteria (future M19–M22)

The future cloud release is releasable only when:

1. A clean clone installs from the committed lockfile.
2. Local bootstrap and database migration are documented and repeatable.
3. Public preview works end to end.
4. Cognito-authenticated goal CRUD works.
5. Cross-user authorization tests pass for every protected resource.
6. All four vehicle models have golden tests.
7. Contribution schedules pass date-boundary tests.
8. Simulated interest and ledger reconciliation tests pass.
9. Duplicate scheduled runs do not create duplicate entries.
10. Mobile and desktop critical flows pass Playwright tests.
11. Automated accessibility checks report no serious or critical finding in critical flows.
12. Strict TypeScript, formatting, and linting pass with zero warnings.
13. Production web and API builds pass.
14. CDK synthesis passes.
15. CodeQL, dependency audit, secret scan, and SBOM generation pass.
16. Deployment to a nonproduction AWS environment succeeds.
17. Smoke tests pass through the deployed CloudFront URL.
18. The UI consistently labels all money and rates as simulated or illustrative.
19. No real-money provider credential or integration exists in the release.
20. `TASKS.md` contains evidence links for completed milestones.

## 19. Future scale path

The local architecture should permit these later steps without redesigning the product core:

1. Replace static assumptions with an approved rate-ingestion adapter.
2. Add provider sandbox account opening behind `GoalAccountProvider`.
3. Add verified funding sources and recurring ACH behind `FundingProvider`.
4. Replace simulated ledger events with verified provider events while preserving the GoalPilot operational ledger.
5. Add webhook inbox, transactional outbox, and reconciliation records.
6. Introduce a paid database tier or AWS RDS when workload, recovery, or contract requirements justify it.
7. Add WAF before a broad public or financially connected beta.
8. Move Fastify from Lambda to ECS Fargate only if sustained load, connection behavior, or background processing justifies it.
9. Add Treasury or investment execution only under an approved regulated operating model.

The product is successful when it proves that users understand and value the set-and-forget goal
experience, not when it prematurely reproduces a bank.

## 20. Current local product-experience requirements

The current phase extends the M00–M18 local simulator baseline without changing its educational
scope.
Its customer-facing object is a **Simulated Goal Plan**. Activating one must state that no real
account is opened, no money is moved, all activity is simulated, rates are illustrative, and the
selected assumption version is fixed for reproducibility.

The phase must:

1. Reveal a zero-interest safe contribution before asking what the user can afford.
2. Keep the safe contribution primary; illustrative interest may only create modeled cushion or
   earlier readiness.
3. Rank vehicle fit by eligibility, purchase readiness using the safe contribution, declared
   access, liquidity conflict, modeled cushion, and finally vehicle code.
4. Keep cash visible and explain every ineligible vehicle.
5. Separate plan health (`AHEAD`, `ON_TRACK`, `ATTENTION_NEEDED`, `FUNDED_BUT_LOCKED`,
   `PURCHASE_READY`, `PAUSED`) from lifecycle state.
6. Provide stateless, one-dimension What-If previews and apply a selected scenario only as a new
   immutable plan version.
7. Offer at most three deterministic recovery choices—contribution, deadline, and target—without
   escalating product risk.
8. Make drafts, immutable plan history, completed goals, and archived goals navigable.
9. Present controlled-clock Autopilot as a bounded story with milestone controls and a scoped
   seeded-demo reset.
10. Record only allowlisted, privacy-safe local product events in storage separate from security
    audit events.
11. Include the feature-flagged **GoalPilot Plus: Purchase Timing Lab** using deterministic fixture
    history, with no retailer network call, scraping, prediction, purchase action, affiliate
    relationship, or financial-plan mutation.
12. Ship production-built local and demo modes plus a terminating local smoke check, without an
    AWS dependency.

The primary deterministic showcase is **Japan trip**, using an 18-month horizon. Its affordable
contribution is slightly below the safe baseline, modeled interest is visible but secondary, at
least one fixed-term model is rejected or subordinated for a clear policy reason, and one missed
contribution has a bounded recovery. Displayed results must be produced by the real domain engine.

Current PX persistence also requires `plan-calculation-context-v1`, exact archive provenance,
per-user clocks, the persisted Japan-fixture capability, fail-closed application command claims,
the distinct owner financial-run lease/revision boundary, bounded per-run Timing worker
generations, and the `goalpilot-user-data-export-v2` privacy boundary. `schedule_occurrences` is
processing history, not a table of projected future dates.

Current acceptance is defined by PX00–PX10 in `docs/TASKS.md` and the hard gate **GoalPilot local
product experience must pass**. User-validation plans and blank results templates are release
artifacts; usability outcomes may be claimed only after real sessions are executed and recorded.
