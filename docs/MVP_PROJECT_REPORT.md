# GoalPilot local MVP project report

**Date:** 2026-08-23  
**Release boundary:** local development only

## Outcome

GoalPilot is implemented as a local-first educational savings simulator. A user can preview a
zero-interest contribution baseline, compare four versioned illustrative vehicle models, sign in
with a secure local account, activate a Simulated Goal Plan, post or automate simulated
contributions and interest, inspect an append-only activity history, pause and resume, complete the
goal with a simulated purchase withdrawal, archive it, export data, and delete the local profile.

It does not connect a bank, move or custody money, scrape rates, present live offers, or deploy AWS
infrastructure.

## Architecture

```text
React/Vite browser (localhost:5173)
        |
Fastify API + local auth + simulator adapters (localhost:3000)
        |
PostgreSQL 17 in Docker (local + isolated test databases)
```

The financial domain uses integer cents at boundaries, Decimal arithmetic internally, explicit
calendar dates, half-even posting, versioned assumptions, a persisted application clock, daily
deposit accrual, and fixed-term maturity lots. Provider ports isolate authentication, rates, goal
accounts, contributions, interest, and the clock from route code.

## Product and safety decisions

- Plain cash is the structural baseline; HYSA yield is a buffer and does not lower its installment.
- CD and Treasury comparisons use 180-day and 91-day maturity terms respectively.
- Every displayed rate says “Illustrative rate, not a live offer.”
- Sessions are opaque and hash-stored; passwords use salted scrypt; protected mutations use Origin
  and CSRF checks.
- Ownership is enforced in repository predicates and composite PostgreSQL foreign keys.
- Plan versions, assumption versions, and ledger history are immutable; account balances derive
  from signed posted entries.
- Test commands reset only `goalpilot_test`, never the developer database.

## Delivery and future boundary

The repository includes pinned Node/pnpm versions, a Dev Container, Docker Compose PostgreSQL,
repeatable migrations and fixtures, unit/integration/component/security/browser tests, production
builds, CodeQL, dependency review, Dependabot, Gitleaks, dependency audit, and CycloneDX SBOM
generation.

The corrected M18 audit passed repeatable setup, an exact-version Dev Container image/runtime
probe, diagnostics, isolated-test reset and migration recovery, 67 automated tests, enforced
API/data/domain coverage thresholds, production builds, dependency and secret scans, SBOM
generation, and three Playwright/Axe browser journeys plus overflow checks at the required responsive
widths. A full
VS Code Dev Container editor attach was not executed and is not claimed.

AWS, Cognito, managed PostgreSQL, provider contracts, real authentication federation, money
movement, compliance approval, and production operations remain M19+ future work behind the local
release hard gate.

## Product-experience phase

The M18 checkpoint was independently re-proved and corrected in commit `1dbd3a4`. The new PX00–PX10
phase is additive and not yet covered by the M18 verification claim. It promotes the zero-interest
safe contribution to the primary commitment, introduces deterministic health/What-If/recovery and
immutable plan history, makes controlled time an owner-scoped product story, adds privacy-safe local
events, and includes a fixture-only Purchase Timing Lab behind a default-off flag.

The exact phase design is in `PRODUCT_EXPERIENCE_SPEC.md`, `PURCHASE_TIMING_LAB.md`, ADR 0003, and
`TASKS.md`. Its completion label is reserved until PX10 evidence exists. No usability result, local
release mode, premium feature, or new automated check is claimed merely because it is specified.
