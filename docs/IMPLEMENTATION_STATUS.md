# Implementation status

## Initial audit — 2026-08-23

> **Historical record:** this section describes the repository at the start of the M00–M18 audit.
> It is retained verbatim in substance and must not be read as the 2026-08-24 PX state.

- Existing: five approved planning documents under `docs/` and an empty Git repository.
- Working product code, tests, runtime, manifest, lockfile, migrations, containers, and workflows:
  none at audit time.
- Local-first conflict: AWS/Cognito work preceded the complete local product. `TASKS.md` and ADR
  0001 put all AWS work behind the local hard gate.
- Initial highest-priority task: establish the pinned monorepo, Dev Container, local PostgreSQL,
  and compatibility proof, then build vertically in dependency order.

## Verified foundation — M18 complete

M00 through M18 and the original local hard gate passed on 2026-08-23. The independent checkpoint
was re-proved and corrected in commit `1dbd3a4`. This remains historical evidence for the foundation;
it is not a substitute for the later PX gate. M19 through M22 remain unauthorized AWS work.

### Historical M18 evidence — do not substitute for PX results

> The numbers in this table are intentionally preserved from 2026-08-23. The current source has 17
> migration files; final executed schema, suite, and browser results are pending in the next section.

| Historical command/evidence           | 2026-08-23 result                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm run setup` twice                | PASS; frozen install, Docker PostgreSQL, migration, seed, and diagnostics repeated safely         |
| `pnpm run doctor`                     | PASS; Node 24.19.0, pnpm 11.22.0, Docker, environment, and database                               |
| Dev Container image/runtime probe     | PASS; Node 24.19.0, pnpm 11.22.0, Git 2.39.5, PostgreSQL client 15.19                             |
| developer migrate twice, seed, verify | PASS; 5 checksummed migrations, 15 public tables, 4 assumptions                                   |
| `corepack pnpm verify`                | PASS; format, lint, types, 67 tests with coverage, builds, DB verification, scans/audit, and SBOM |
| historical coverage                   | PASS; API 91.34%, data 94.60%, domain 95.89% lines; domain branches 86.60%                        |
| installed-Chrome E2E                  | PASS; 3/3 journeys with the historical Axe/overflow scope                                         |

Historical production bundles were web JavaScript 409.27 kB (124.47 kB gzip) and CSS 21.58 kB
(5.88 kB gzip). Those bundle sizes are preserved as M18 evidence and are not presented as current
PX bundle measurements.

## Current milestone — PX00–PX10 implemented; final gate pending

The local product-experience phase is implemented, but its corrected frozen-tree automated hard
gate has not yet been executed and recorded. GoalPilot now
provides progressive baseline-first planning, deterministic safe-plan rationale and vehicle fit,
explainable health, stateless What-If previews and immutable recovery versions, draft/history/archive
navigation, owner-scoped Story-Mode Autopilot, privacy-safe local product events, and the
fixture-only feature-flagged Purchase Timing Lab.

The reserved narrow release label is **withheld** until every required final command passes against
one recorded source identity. The source identity and complete command record belong in
[LOCAL_PRODUCT_RELEASE.md](LOCAL_PRODUCT_RELEASE.md).

Human validation is still an **OPEN external gate**. No participant session or usability outcome is
claimed. The product is not production-ready, financially compliant, AWS-ready/deployed, or a live
financial service.

## Final PX release evidence — pending

The repository contains 17 migration files through
`202608230017_price_check_worker_lease.sql`. That is source inventory, not execution evidence. Do
not copy counts or timings from an earlier working tree into the final record.

| Gate                                                                 | Final frozen-tree result                                                                                                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact source and diff checkpoint                                     | **PASS (dirty):** base `c28865c`, reviewed 192-file manifest SHA-256 `52664405acb858188914f7c21354eda63bc41db6fee8cf9216d83adafba8fe00`; local commit blocked by `.git` approval |
| `corepack pnpm run setup` twice and `corepack pnpm run doctor`       | **PARTIAL/BLOCKED:** preflight passed twice; Docker engine access denied                                                                                                         |
| Developer reset, migrate, seed, and schema verifier                  | **BLOCKED/PARTIAL:** reset approval denied; test DB verifier passed 17 migrations/25 tables/135 columns/162 constraints/19 triggers/17 functions/10 indexes/4 assumptions        |
| Clean migration replay and independent upgrade through migration 017 | **BLOCKED:** guarded reset/create/drop approval unavailable                                                                                                                      |
| Format, lint, typecheck, production build, and canonical verify      | **PARTIAL:** format/lint/type/build passed; canonical verify blocked by reset and registry access                                                                                |
| Vitest and coverage                                                  | **PARTIAL:** 29 files/222 unit tests and 2 files/14 affected API integration tests passed; coverage blocked                                                                      |
| Installed-Chrome Journeys A–E                                        | **BLOCKED:** Chrome 151.0.7922.170 found; clean-reset/browser execution approval unavailable                                                                                     |
| Local performance samples                                            | **PASS:** preview p95 39.9 ms; What-If 69.7 ms; 731-observation Timing 410.6 ms; six-month Autopilot 2,922.6 ms                                                                  |
| Secret scan, production dependency audit, and CycloneDX SBOM         | **PARTIAL:** scan and 432-component CycloneDX 1.5 SBOM passed; registry audit blocked by `EACCES`                                                                                |
| Local/demo production-built smoke and owned-port cleanup             | **BLOCKED:** final development DB/runtime execution unavailable                                                                                                                  |
| Dev Container image and non-root runtime probe                       | **BLOCKED:** Docker engine pipe access denied                                                                                                                                    |
| Full VS Code Dev Container editor attach                             | **NOT EXECUTED**                                                                                                                                                                 |

The final suite must cover the controlled clock/Autopilot, financial golden vectors, ownership and
security matrices, append-only/immutability guarantees, fail-closed idempotency, Timing Lab replay,
routine-outcome telemetry, migration upgrade, and rich privacy export/deletion integration. Its
actual executed counts belong in the final release record.

## Review resolution

The PX audit treated prior verification text as untrusted and re-examined product hierarchy,
financial policy, data integrity, authentication/session/CSRF/Origin/ownership enforcement,
provider simulation boundaries, error/logging behavior, React failure/accessibility states, test
quality, and reproducibility. Source corrections and regression tests have been added; the final
full-suite execution against one frozen checkpoint is still pending. Notable corrections include:

- contribution-only safe amounts and explicit principal-versus-modeled-interest reporting;
- per-lot fixed-term maturity and purchase-readiness accounting;
- atomic scenario apply/replay/version checks and immutable provenance;
- fail-closed application-command idempotency and exact Timing observation keys;
- owner-scoped privacy export plus complete local-profile deletion with retained audit scrubbing;
- closed routine Timing event names and content-free product telemetry;
- focus trapping, Escape dismissal, focus restoration, reduced-motion proof, and responsive/Axe
  checks on the critical browser states;
- Windows-clean E2E termination and release/smoke process cleanup.

The original August 23 findings and their correction record remain historical in
[RELEASE_AUDIT_2026-08-23.md](RELEASE_AUDIT_2026-08-23.md); the dated counts there were not rewritten.

## Known boundaries and blockers

- No real money movement, provider credentials, bank connection, live rate/price feed, AWS resource,
  or production authentication adapter exists. This is intentional policy.
- Illustrative rates and price history are static, versioned local fixtures and are not offers.
- Final Chrome evidence must identify the exact installed build and record any background API 5xx or
  browser-page failure, not only the five journey exit statuses.
- The unrelated global `%APPDATA%\npm\pnpm.ps1` remains malformed. Final host commands must use the
  repository-pinned Corepack path.
- The sandbox exposes `.git` and Docker as read-only/denied. Its approval service rejected the
  requested local commit, clean database reset, Docker, and browser execution after exhausting its
  approval quota. Explicit approval when capacity is available is the smallest required human
  action; no workaround was used.
- `corepack pnpm audit:prod` could not reach the npm advisory endpoint (`EACCES`) after its standard
  retries, so no dependency-audit result is claimed.
- Native pnpm command-name collisions require `corepack pnpm run setup`, `run doctor`, and
  `run sbom` for the repository scripts.
- Current Dev Container image/runtime reproducibility evidence is pending. A full VS Code editor
  attach/open is not required and must remain `NOT EXECUTED` unless it is actually performed.
- Human validation is open; automated Axe and keyboard checks do not replace participant or
  assistive-technology sessions.
- AWS M19–M22 remains not implemented, disabled, and unauthorized.

## Next task

Freeze one source checkpoint, execute every final local gate, and replace the pending fields in
`LOCAL_PRODUCT_RELEASE.md` only with observed results. Apply the reserved label only if all required
gates pass. Then conduct and record the separate human-validation study if desired. Do not begin M19
or any AWS work without explicit, separate user authorization.
