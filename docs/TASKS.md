# GoalPilot execution plan

This is the authoritative local-first milestone order. M00–M18 are the independently audited local
MVP foundation. PX00–PX10 are a separate pre-AWS product-experience phase. AWS milestones retain
their identifiers and remain unauthorized until the new hard gate passes.

| Status | Milestone     | Increment                                               |
| ------ | ------------- | ------------------------------------------------------- |
| [x]    | M00–M18       | Verified local-first MVP foundation                     |
| [x]    | MVP HARD GATE | Complete local MVP release audit                        |
| [x]    | PX00          | Audit checkpoint and documentation reconciliation       |
| [ ]    | PX01          | Progressive goal builder                                |
| [ ]    | PX02          | Safe plan summary and deterministic rationale           |
| [ ]    | PX03          | Vehicle-fit comparison                                  |
| [ ]    | PX04          | Plan health states                                      |
| [ ]    | PX05          | What-If and recovery                                    |
| [ ]    | PX06          | Drafts, plan history, and archived navigation           |
| [ ]    | PX07          | Story-mode Autopilot and seeded demo                    |
| [ ]    | PX08          | Privacy-safe local product events                       |
| [ ]    | PX09          | Purchase Timing Lab                                     |
| [ ]    | PX10          | Local release, usability package, and independent audit |
| [ ]    | **HARD GATE** | **GoalPilot local product experience must pass**        |
| [ ]    | M19           | Future AWS architecture adaptation                      |
| [ ]    | M20           | Future AWS staging                                      |
| [ ]    | M21           | Future AWS security and observability                   |
| [ ]    | M22           | Future cloud release audit                              |

## Completed foundation: M00–M18

The audited foundation includes a reproducible Node/PostgreSQL workspace, CI/security baseline,
reviewed migrations, deterministic financial engine, Fastify contracts, local authentication and
ownership, goal lifecycle, simulated providers, append-only ledger, controlled clock, account
activity, export/deletion, accessibility, end-to-end coverage, and the local release audit.
Evidence is in [implementation status](IMPLEMENTATION_STATUS.md) and the preserved
[release audit](RELEASE_AUDIT_2026-08-23.md).

## PX00 — Audit checkpoint and documentation reconciliation

- **Product outcome:** begin product iteration from a reproducible, independently audited base and
  one coherent authority chain.
- **Dependencies:** M18 and the MVP hard gate.
- **Tasks:** preserve audit reproductions; resolve actionable checkpoint defects; commit the safe
  checkpoint; add the release-authority note, ADR 0003, product specification, Timing Lab policy,
  demo runbook, validation package, and this phase plan.
- **Migration impact:** none; checkpoint migrations remain immutable.
- **Security requirements:** verify test/development database separation, loopback-only local
  controls, redaction, ownership, CSRF/Origin, idempotency, and append-only guarantees.
- **Required tests:** full checkpoint `verify`, integration suite, and stable-Chrome E2E from a
  clean isolated test database.
- **Evidence:** checkpoint commit, corrected audit disposition table, exact commands and results in
  `IMPLEMENTATION_STATUS.md`.
- **Exit gate:** no unresolved critical/high local-MVP defect and all current product rules are
  documented before visible financial behavior changes.
- **Documentation:** PRD, ADR 0002/0003, calculation and vehicle policy, PRODUCT_EXPERIENCE_SPEC,
  PURCHASE_TIMING_LAB, README, architecture, ERD, conventions, stack, security, testing, local
  development, decision queue, project report, demo and user-validation documents.

## PX01 — Progressive goal builder

- **Product outcome:** a user learns the requirement before declaring a budget and can save,
  resume, edit, review, or discard a draft.
- **Dependencies:** PX00.
- **Tasks:** implement Goal, Starting point, Budget fit, Access, and Review steps; call the API for
  baseline calculations; hide the single-value confidence field; add accessible validation and
  stale-response handling.
- **Migration impact:** add an owner-scoped, optimistic-versioned draft record without weakening
  the complete-goal constraints; activation validates and atomically promotes the draft.
- **Security requirements:** authenticated draft ownership; validated cents/dates/text; CSRF,
  Origin, rate limit, safe errors, and request-hashed idempotency for state changes.
- **Required tests:** baseline reveal ordering, lower/equal/higher affordability, first-use/loading/
  invalid/network/stale states, draft ownership, keyboard flow, focus, and 360–1440 widths.
- **Evidence:** domain/API/component tests and Journey A builder portion.
- **Exit gate:** the browser performs no financial calculation and cannot activate without review.
- **Documentation:** contracts/OpenAPI, PRODUCT_EXPERIENCE_SPEC, TESTING, implementation status.

## PX02 — Safe plan summary and deterministic rationale

- **Product outcome:** the first result says what to do and clearly separates personal savings from
  modeled interest.
- **Dependencies:** PX01 and ADR 0003.
- **Tasks:** expose the zero-interest safe amount, chosen amount, current-versus-projected
  breakdown, cushion/shortfall, readiness, immutable assumption details, and explanation-code
  rationale; use customer term “Simulated Goal Plan” and activation disclosure.
- **Migration impact:** add version/provenance fields only if the current immutable calculation
  snapshot cannot store policy and rationale versions.
- **Security requirements:** all numbers recomputed server-side; no arbitrary rationale content;
  no LLM; stale assumption/version failure is safe.
- **Required tests:** safe amount independent of APY, exact financial breakdown reconciliation,
  every rationale branch, disclosure presence, and API-to-UI number consistency.
- **Evidence:** golden vectors, contract tests, summary component tests, Journey A activation.
- **Exit gate:** modeled interest is never presented as permission to contribute less.
- **Documentation:** calculation spec, OpenAPI, rationale-code catalog, implementation status.

## PX03 — Vehicle-fit comparison

- **Product outcome:** one explained illustrated fit follows the user's plan, while cash, other
  eligible options, and every rejected option remain understandable.
- **Dependencies:** PX02.
- **Tasks:** implement ranking-v2 from ADR 0003; present fit, safe contribution, modeled benefit,
  readiness, access, maturity, rationale, trust detail, and exact rejection/change reason.
- **Migration impact:** persist ranking policy version in new plan snapshots; no mutable assumption
  edits.
- **Security requirements:** catalog is server-owned, versioned, non-live, and injection-safe;
  provider failures do not leak details.
- **Required tests:** eligibility before ranking, purchase-ready/access/liquidity/cushion/tie order,
  input-order invariance, all-ineligible state, fixed-term lock, and accessible text alternatives.
- **Evidence:** rank traces/golden tests, API/component coverage, Journey A comparison.
- **Exit gate:** yield cannot outrank a policy or access failure and cash is always visible.
- **Documentation:** vehicle policy, calculation spec, product spec, OpenAPI.

## PX04 — Plan health states

- **Product outcome:** every active plan has one explainable health state distinct from lifecycle.
- **Dependencies:** PX02–PX03.
- **Tasks:** implement ADR 0003 precedence for `PAUSED`, `PURCHASE_READY`,
  `FUNDED_BUT_LOCKED`, `ATTENTION_NEEDED`, `AHEAD`, and `ON_TRACK`; expose evidence codes and next
  event without an opaque score.
- **Migration impact:** health is derived; persist only a versioned snapshot when required for
  immutable plan history.
- **Security requirements:** authoritative ledger/clock inputs, ownership, and no client-selected
  health state.
- **Required tests:** every state, every precedence overlap, cadence-aware ahead boundary,
  unavailable fixed-term funds, impossible schedule, pause overlay, and UI non-color cues.
- **Evidence:** domain truth table, API tests, component state gallery.
- **Exit gate:** identical snapshot/date inputs always produce the same state and rationale.
- **Documentation:** ADR 0003, PRODUCT_EXPERIENCE_SPEC, contracts/OpenAPI.

## PX05 — What-If and recovery

- **Product outcome:** a user can compare one controllable change and repair an attention-needed
  plan without risk escalation.
- **Dependencies:** PX04.
- **Tasks:** stateless preview for contribution, deadline, target, or one missed contribution;
  before/after deltas; at most three recovery options; apply with current-version revalidation,
  immutable new plan version, append-only activity, and future-schedule reconciliation.
- **Migration impact:** additive plan-version provenance/change fields and constraints; old versions
  immutable.
- **Security requirements:** server recomputation, ownership, CSRF/Origin/rate limit, changed-body
  idempotency conflict, optimistic concurrency, bounded dates/amounts.
- **Required tests:** one-change schema, deltas, no preview writes, no risk/vehicle change, stale
  version 409, idempotent apply, immutable prior rows, ledger/schedule reconciliation, Journey B.
- **Evidence:** property tests, database immutability tests, API/component/E2E results.
- **Exit gate:** a scenario cannot mutate history or depend on modeled yield for recovery.
- **Documentation:** ADR 0003, ERD, OpenAPI, security/testing/status.

## PX06 — Drafts, plan history, and archived navigation

- **Product outcome:** incomplete work and historical goals are findable without an admin portal.
- **Dependencies:** PX01 and PX05.
- **Tasks:** grouped draft/active/completed/archived views, resume/edit/discard, read-only version
  comparison with change reason/calculation/assumption, archive reason, and easy active navigation.
- **Migration impact:** additive archive/change provenance if absent; preserve deletion/export policy.
- **Security requirements:** uniform 404 ownership denial for every history/draft/archive resource;
  safe archive/discard idempotency and retained ledger rules.
- **Required tests:** lifecycle grouping, cross-owner deny paths, immutable history, empty/error
  states, discard/archive repeat, export/deletion regression.
- **Evidence:** repository/API/component tests and plan-history portion of Journey B/C.
- **Exit gate:** every version is readable and no historical version is editable.
- **Documentation:** ERD, OpenAPI, security, product spec, status.

## PX07 — Story-mode Autopilot and seeded demo

- **Product outcome:** “Preview how your simulated plan changes over time” tells a deterministic
  Japan-trip story through bounded milestone controls.
- **Dependencies:** PX04–PX06.
- **Tasks:** advance to next contribution, month, six months, maturity, or target; show date, next
  events, health, timeline, and run summary; add seeded-only scoped reset and `demo:reset`; simulate
  one recoverable missed contribution.
- **Migration impact:** add per-user controlled clocks and demo fixture/run provenance; never let a
  consumer control mutate unrelated users or the operating-system clock.
- **Security requirements:** local/test/explicit-demo only, loopback, authentication, ownership,
  CSRF/Origin, rate limit, permitted milestones, idempotency, seeded-scope reset.
- **Required tests:** every control and explanation, replay/no-op/failure/retry, ownership, mode
  denial, bounded reset, six-month performance, Journey B/C.
- **Evidence:** integration/component/E2E results, demo runbook, executed reset proof.
- **Exit gate:** reset cannot affect non-seeded user data and production-like local mode has no demo
  mutations.
- **Documentation:** DEMO_RUNBOOK, LOCAL_DEVELOPMENT, SECURITY, TESTING, status.

## PX08 — Privacy-safe local product events

- **Product outcome:** local funnel behavior can be counted without storing financial or entered
  content.
- **Dependencies:** PX01–PX07 event vocabulary.
- **Tasks:** separate `product_events`, strict names/field enums, pseudonymous references, emitters,
  and `product-events:summary` aggregate command.
- **Migration impact:** additive constrained event table, indexes, and append-only protection.
- **Security requirements:** reject amounts, names, notes, emails, URLs, account IDs, secrets, CSRF,
  password material, and free metadata; never reuse security audit storage.
- **Required tests:** allowlist positive cases, every prohibited field, append-only DB behavior,
  cross-owner/privacy inspection, redacted logs, summary contains counts only.
- **Evidence:** schema/API/security tests and executed local summary output.
- **Exit gate:** no product-event row or summary can reconstruct a financial value or user content.
- **Documentation:** privacy/security model, ERD, event catalog, runbook/status.

## PX09 — Purchase Timing Lab

- **Product outcome:** a feature-flagged local premium prototype explains historical demo-price
  context and the independent simulated-plan readiness gate.
- **Dependencies:** core clarity/resilience focused tests through PX08.
- **Tasks:** fixture provider; owned purchase item; observations/watch/run/immutable assessment;
  `runDuePriceChecks(clock)` and `price-watch:run`; versioned statistics/state policy; accessible
  chart and text; no-prediction/demo disclosures.
- **Migration impact:** additive owned tables and composite FKs, unique observation/replay keys,
  currency/future-date checks, immutable assessment protection.
- **Security requirements:** explicit flag, fixtures only, no outbound network/scraping/URLs,
  ownership, validation, idempotency, CSRF/Origin/rate limits, timing never mutates goal plan.
- **Required tests:** 30/90 minimum, statistics/percentile/threshold edges, staleness, 24-month
  seasonal gate, future/duplicate/currency cases, readiness/lock gate, replay, cross-owner denial,
  feature disabled, complete price-history performance, Journey D/E.
- **Evidence:** domain golden vectors, migration/API/component/E2E tests, executed price-watch run.
- **Exit gate:** favorable history never becomes prediction or overrides plan readiness.
- **Documentation:** PURCHASE_TIMING_LAB, architecture/ERD, OpenAPI, demo/security/testing/status.

## PX10 — Local product release, usability package, and independent audit

- **Product outcome:** production-built local and demo experiences are reproducible and ready for
  real, explicitly recorded user validation.
- **Dependencies:** PX00–PX09.
- **Tasks:** `local:release`, `demo:local`, terminating `local:smoke`; seed/reset modes; validation
  plan/template; performance budgets; release evidence; seven independent reviews and corrections.
- **Migration impact:** prove upgrade from the M18 audited schema and clean replay; no destructive
  developer reset as a verification shortcut.
- **Security requirements:** loopback-only listeners, local PostgreSQL, demo controls off in local
  release, feature flag obeyed, no AWS/network dependency, clean termination/no leftover listener.
- **Required tests:** setup/doctor/reset/migrate/seed/verify, coverage, builds, Chrome E2E Journeys
  A–E with Axe/overflow, event/price commands, both release modes, smoke, performance and recovery.
- **Evidence:** `LOCAL_PRODUCT_RELEASE.md` with only executed commands/results, independent review
  dispositions, screenshots where executed, and blank validation-results template.
- **Exit gate:** every PX acceptance item passes and the exact label **GoalPilot Local Product
  Experience verified** is supported. This does not mean production-ready, compliant, or AWS-ready.
- **Documentation:** all current-release documents and handoff; never fabricate usability results.

## Product-experience hard gate

M19 remains blocked until PX10 proves the hard gate and the user separately authorizes AWS work.
Source presence, planned tests, or the earlier M18 gate do not satisfy this gate.

## Evidence map

- M00–M18: [implementation status](IMPLEMENTATION_STATUS.md),
  [release audit](RELEASE_AUDIT_2026-08-23.md)
- PX00: [ADR 0003](DECISIONS/0003-safe-contribution-and-plan-resilience.md),
  [product specification](PRODUCT_EXPERIENCE_SPEC.md)
- PX01–PX08: product specification, source/tests, and implementation status
- PX07: [demo runbook](DEMO_RUNBOOK.md)
- PX09: [Purchase Timing Lab specification](PURCHASE_TIMING_LAB.md)
- PX10: `LOCAL_PRODUCT_RELEASE.md`, [user-validation plan](USER_VALIDATION_PLAN.md), and unfilled
  [results template](USER_VALIDATION_RESULTS_TEMPLATE.md)
