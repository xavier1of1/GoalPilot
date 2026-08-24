# GoalPilot local product-experience release evidence

> **FINAL EVIDENCE PENDING — 2026-08-24.** PX00–PX10 implementation is present, but the corrected
> release procedure has not yet been completed against the exact manifest checkpoint recorded
> below. The reserved release label is withheld. Earlier results are historical only; see
> [RELEASE_AUDIT_2026-08-23.md](RELEASE_AUDIT_2026-08-23.md).

This record is for a local educational simulator. It cannot establish production readiness,
financial compliance, AWS readiness/deployment, or human-validation outcomes.

## Release identity — current blocked checkpoint

| Field                    | Final evidence                                                                                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source checkpoint tested | Base commit `c28865c`; SHA-256 `52664405acb858188914f7c21354eda63bc41db6fee8cf9216d83adafba8fe00` over the sorted path/content manifest of 192 non-ignored files, excluding this file and `IMPLEMENTATION_STATUS.md` |
| Working-tree/diff state  | Reviewed dirty checkpoint: 79 tracked changes and 57 untracked source/test/doc files; no conflicts; `git diff --check` passed                                                                                        |
| Documentation checkpoint | **PENDING:** `.git` is read-only in the sandbox and the required commit approval was unavailable                                                                                                                     |
| Verification time        | Partial evidence observed through 2026-08-24 06:06 EDT (`-04:00`)                                                                                                                                                    |
| Product phase            | PX00–PX10 local-only product-experience phase                                                                                                                                                                        |
| Application version      | `0.1.0`                                                                                                                                                                                                              |
| Fixture/catalog versions | Source/current test evidence: `demo-2026-08-v1`, `product-experience-v1`, `vehicle-fit-v2`, `plan-health-v1`, `purchase-timing-v1`; final clean seed observation remains pending                                     |
| Host toolchain           | Windows NT 10.0.26200.0; Node 24.19.0; pnpm 11.22.0; Git 2.53.0.windows.1; PowerShell 5.1.26100.9168; PostgreSQL 17.11; Docker client 27.5.1 / Compose 2.32.4 (engine access blocked)                                |
| Browser                  | Installed stable Chrome `151.0.7922.170`; final Playwright run not executed                                                                                                                                          |
| Evidence owner           | Codex independent local-release audit                                                                                                                                                                                |

The phrase **GoalPilot Local Product Experience verified** is a reserved label. Do not apply it
unless every required row below is current, passing, and tied to the same source checkpoint.

## Scope and intentional boundary

The target topology is a React/Vite browser talking to a Fastify API and loopback PostgreSQL.
Domain policy owns financial calculations; API routes validate and orchestrate; repositories enforce
ownership and persistence; provider ports isolate local authentication, clock, rate-catalog,
contribution, interest, and fixture-price simulators. The Story Demo clock is owner-scoped and never
changes the operating-system clock.

- No real account is opened and no money is held, moved, invested, or used for a purchase.
- Rates and price history are reviewed illustrative local fixtures, not live offers or retailer data.
- Purchase Timing Lab supplies descriptive historical context, not a forecast or recommendation.
- Human validation is a separate external gate and remains open.
- AWS M19–M22 is not implemented, deployed, or authorized.

## Source database inventory — not execution evidence

The current source tree contains 17 ordered migration files:

1. `202608230001_local_mvp.sql`
2. `202608230002_allow_ledger_cascade_purge.sql`
3. `202608230003_financial_integrity.sql`
4. `202608230004_relational_integrity.sql`
5. `202608230005_ledger_semantic_integrity.sql`
6. `202608230006_goal_drafts_and_plan_evolution.sql`
7. `202608230007_controlled_clocks_fixtures_and_product_events.sql`
8. `202608230008_purchase_timing_lab.sql`
9. `202608230009_application_command_claims.sql`
10. `202608230010_plan_calculation_context.sql`
11. `202608230011_response_provenance.sql`
12. `202608230012_purchase_timing_routine_events.sql`
13. `202608230013_terminal_timing_provenance.sql`
14. `202608230014_exact_timing_series.sql`
15. `202608230015_reversal_aware_balances.sql`
16. `202608230016_owner_financial_run_guard.sql`
17. `202608230017_price_check_worker_lease.sql`

This inventory does not prove successful replay, upgrade compatibility, checksum verification, or
the resulting object counts. Record those only from the final database commands.

## Final command record — partial and blocked

Use the repository-pinned package manager through Corepack because the unrelated global
`%APPDATA%\npm\pnpm.ps1` may be malformed. Replace each pending entry only with observed output from
the frozen checkpoint; do not reuse an earlier run's count or timing.

| Required command or check                                   | Status           | Final measured evidence or limitation                                                                                                                           |
| ----------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record exact source checkpoint and reviewed diff            | **PASS (dirty)** | Base `c28865c`, 192-file manifest SHA-256 above; 79 tracked/57 untracked reviewed; diff check passed                                                            |
| `corepack pnpm run setup` twice                             | **PARTIAL**      | `--preflight-only` passed twice with Node 24.19.0/pnpm 11.22.0; full Docker/DB setup blocked                                                                    |
| `corepack pnpm run doctor`                                  | **BLOCKED**      | Docker client is installed, but sandbox access to the Docker engine/config is denied                                                                            |
| `corepack pnpm db:reset -- --yes`                           | **BLOCKED**      | Required destructive approval for the guarded loopback target was unavailable                                                                                   |
| `corepack pnpm db:migrate` and `corepack pnpm db:seed`      | **BLOCKED**      | Development DB intentionally left untouched after reset approval was denied                                                                                     |
| Clean isolated-test replay                                  | **BLOCKED**      | Clean `goalpilot_test` reset approval was denied; no workaround was attempted                                                                                   |
| Independent prior-schema upgrade through migration 017      | **BLOCKED**      | Final runtime-config change requires rerun; guarded temporary DB create/drop approval unavailable                                                               |
| `corepack pnpm db:verify`                                   | **PASS (test)**  | 17 migrations, 25 tables, 135 columns, 162 constraints, 19 triggers, 17 functions, 10 indexes, 4 assumptions; development DB remains unverified/currently older |
| `corepack pnpm format:check`                                | **PASS**         | All matched files use Prettier style                                                                                                                            |
| `corepack pnpm lint`                                        | **PASS**         | Workspace ESLint completed with zero warnings                                                                                                                   |
| `corepack pnpm typecheck`                                   | **PASS**         | Root and 11 workspace project checks passed                                                                                                                     |
| `corepack pnpm test:unit`                                   | **PASS**         | 29 files / 222 tests                                                                                                                                            |
| Focused affected PostgreSQL API suites                      | **PASS**         | `auth-goals` 7/7 and `product-experience` 7/7 against the existing isolated test DB                                                                             |
| `corepack pnpm test:coverage`                               | **BLOCKED**      | Requires the clean test reset whose approval was denied; no final coverage claim                                                                                |
| `corepack pnpm build`                                       | **PASS**         | 11 workspace projects; web 2,003 modules, JS 461.86 kB/137.04 kB gzip                                                                                           |
| `corepack pnpm verify`                                      | **BLOCKED**      | Requires clean test reset and registry audit access; neither was available                                                                                      |
| Installed-Chrome `corepack pnpm test:e2e`                   | **BLOCKED**      | Chrome 151.0.7922.170 found; clean test reset/browser execution approval unavailable                                                                            |
| `corepack pnpm demo:reset`                                  | **BLOCKED**      | Development DB reset/migrate/seed gate did not run                                                                                                              |
| `corepack pnpm product-events:summary`                      | **PASS (test)**  | Aggregate-only output: builder started 4, builder step 1, Timing completed 5/failed 4/no-due 4; final development seed remains pending                          |
| `corepack pnpm price-watch:run`                             | **BLOCKED**      | Final seeded development database is unavailable                                                                                                                |
| `corepack pnpm local:release` mode probe                    | **BLOCKED**      | Development DB is older than the source schema; foreground runtime was not started                                                                              |
| `corepack pnpm demo:local` plus `corepack pnpm local:smoke` | **BLOCKED**      | Development DB/Docker approvals unavailable; no process was started                                                                                             |
| `corepack pnpm security:scan`                               | **PASS**         | No potential secret patterns detected                                                                                                                           |
| `corepack pnpm audit:prod`                                  | **BLOCKED**      | Registry POST failed with sandbox `EACCES` after documented retries                                                                                             |
| `corepack pnpm run sbom`                                    | **PASS**         | CycloneDX 1.5, 432 components, `artifacts/sbom.cdx.json`, SHA-256 `55bb1d19031e30e088655a07c358ff1042de199c382cc1b9f1df35c3f2106491`                            |
| Dev Container image build                                   | **BLOCKED**      | Docker engine pipe access denied by the sandbox                                                                                                                 |
| Dev Container non-root runtime probe                        | **BLOCKED**      | Docker engine pipe access denied by the sandbox                                                                                                                 |
| Full VS Code Dev Container editor attach                    | **NOT EXECUTED** | Optional evidence; not claimed                                                                                                                                  |

## Test and coverage evidence — partial

Record the executed current suite, not the prior tree's totals.

| Coverage group |  Statements |    Branches |   Functions |       Lines | Required floor          | Result      |
| -------------- | ----------: | ----------: | ----------: | ----------: | ----------------------- | ----------- |
| API            | **PENDING** | **PENDING** | **PENDING** | **PENDING** | Record configured floor | **PENDING** |
| Data access    | **PENDING** | **PENDING** | **PENDING** | **PENDING** | Record configured floor | **PENDING** |
| Domain         | **PENDING** | **PENDING** | **PENDING** | **PENDING** | Record configured floor | **PENDING** |

- Executed DB-free Vitest count: **29 files / 222 tests passed**.
- Executed affected PostgreSQL API count: **2 files / 14 tests passed** against the existing
  isolated test database; this is not a substitute for the blocked clean integration suite.
- Final coverage file/test count and percentages: **BLOCKED/PENDING**.
- Exclusions and threshold configuration reviewed against the manifest checkpoint: **PASS**;
  `**/*.test.{ts,tsx}` is excluded from source coverage, and the configured API/data/domain floors
  remain active (including 90% domain branches).
- Required financial, security/ownership, immutable ledger/plan, idempotency, controlled-clock,
  Autopilot, Timing provenance/replay, provider-boundary, privacy, and migration regressions present
  in source: **PASS by review**; complete clean execution: **BLOCKED/PENDING**.

## Browser, accessibility, and responsive evidence — blocked

| Journey or check                                | Status      | Final evidence                                                                |
| ----------------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| A — progressive plan and activation             | **BLOCKED** | Final installed-Chrome run requires the unavailable clean test reset approval |
| B — disruption, recovery, and immutable history | **BLOCKED** | Final installed-Chrome run requires the unavailable clean test reset approval |
| C — Autopilot, reset, completion, and archive   | **BLOCKED** | Final installed-Chrome run requires the unavailable clean test reset approval |
| D — Purchase Timing Lab and exact replay        | **BLOCKED** | Final installed-Chrome run requires the unavailable clean test reset approval |
| E — ownership and privacy-safe telemetry        | **BLOCKED** | Final installed-Chrome run requires the unavailable clean test reset approval |
| Axe on required customer states                 | **BLOCKED** | Final browser execution not authorized                                        |
| Horizontal overflow                             | **BLOCKED** | Final browser execution not authorized                                        |
| Keyboard and focus                              | **BLOCKED** | Component regressions passed; final browser execution not authorized          |
| Reduced motion                                  | **BLOCKED** | Component regressions passed; final browser execution not authorized          |
| Chart alternative                               | **BLOCKED** | Component regressions passed; final browser execution not authorized          |
| Background failures                             | **BLOCKED** | Cross-page collector exists; no final browser run is claimed                  |

Automated Axe checks cannot substitute for participant or assistive-technology validation.

## Performance evidence — focused checks executed

These are local regression budgets, not production service-level objectives.

| Operation                         | Measured result | Documented budget | Status   |
| --------------------------------- | --------------: | ----------------: | -------- |
| Stateless plan preview p95        |         39.9 ms |         <1,000 ms | **PASS** |
| What-If preview                   |         69.7 ms |         <1,000 ms | **PASS** |
| 731-observation Timing assessment |        410.6 ms |         <5,000 ms | **PASS** |
| Owner-scoped six-month Autopilot  |      2,922.6 ms |        <10,000 ms | **PASS** |

The plan-preview p95 used 20 sequential Fastify `inject` requests; an additional authenticated
goals-GET p95 measured 5.3 ms over 20 requests. The other values are one measured local integration
sample each, enforced by `app.test.ts`, `auth-goals.integration.test.ts`, and
`product-experience.integration.test.ts`; they are regression ceilings, not distribution/SLO claims.

## Security, privacy, and supply-chain evidence — partial

- Authentication, session, CSRF, Origin, rate-limit, validation, and idempotency regressions:
  **PASS in unit/focused API suites; full clean-suite proof is blocked**.
- Cross-owner draft, goal, plan/history/scenario, demo, and Timing denial matrix: **present and
  partly exercised; full clean-suite proof is blocked**.
- Append-only ledger, immutable plan/catalog/event/price/assessment, and reversal semantics:
  **schema verifier passed; final clean database suite is blocked**.
- Terminal-goal mutation guards and Timing/Autopilot provenance: **focused tests passed**.
- Product-event vocabulary, pseudonymization, field/value rejection, and aggregate-only reporting:
  **unit tests and aggregate-only test-database CLI output passed; final development output is
  blocked**.
- Safe error/logging correlation, redaction, and non-disclosure: **unit tests passed**.
- Privacy export/deletion, retained-audit pseudonymization, and owned Planning/Timing cleanup:
  **source/regressions reviewed; final clean database execution is blocked**.
- Secret scan: **PASS**. CycloneDX SBOM: **PASS**. Production dependency audit: **BLOCKED** by
  registry-network `EACCES`; no vulnerability result is claimed.

## Independent review disposition

The source audit covered product hierarchy, financial correctness, data integrity,
authentication/ownership/privacy, provider boundaries, API contracts and logging, React failure and
accessibility states, test false-positive risks, setup, and release reproducibility. Corrections and
regression tests are present in the working tree, but their final aggregate proof remains pending.
The last independent static pass found no remaining in-scope High or Medium product-code,
security, financial, or privacy defect. It closed final owner-wide Autopilot high-water and Timing
worker-row race findings before this checkpoint. This is a static disposition, not a substitute for
the blocked aggregate gates.
The historical discovery/correction narrative is preserved in
[RELEASE_AUDIT_2026-08-23.md](RELEASE_AUDIT_2026-08-23.md).

### Final finding ledger (ordered by severity)

#### High — release proof and local commits remain blocked (open)

- **Evidence/files:** this record and `docs/IMPLEMENTATION_STATUS.md` retain the hard gate and label
  as blocked/withheld.
- **Reproduction:** `corepack pnpm run doctor` passes Node, pnpm, environment, database, and provider
  checks but reports `Docker: engine unavailable`; `corepack pnpm audit:prod` fails registry access
  with `EACCES`; guarded reset and `git add` approvals are rejected by the exhausted approval
  service.
- **Requirement impact:** the mandatory clean replay, coverage/verify, installed-Chrome, smoke,
  Dev Container, dependency-audit, and small-local-commit evidence cannot be claimed.
- **Recommended correction:** explicitly authorize the scoped reset/browser/Docker/Git operations
  when approval capacity is available, permit registry advisory access, then execute the frozen-tree
  command sequence and update this record. No product-code workaround is acceptable.

#### Medium — owner-wide Story recovery high-water was goal-local (corrected)

- **File:** `packages/data-access/src/experience-repository.ts:817`.
- **Reproduction:** give one demo owner two accounts, leave a future financial row on a terminal
  sibling, then request a relative milestone for the other active goal. The earlier goal-local query
  could skip the pending day and overshoot.
- **Requirement impact:** PX07 controlled-clock recovery could expose financial state ahead of the
  owner clock.
- **Correction:** calculate the greatest financial high-water across every owner account while
  retaining requested-goal eligibility; add query-structure and terminal-sibling regressions.

#### Medium — expired Timing worker could report a fabricated failure (corrected)

- **File:** `packages/data-access/src/purchase-timing-repository.ts:639`.
- **Reproduction:** pause an expired-claim reader after selecting the row, complete it with the old
  worker, then resume the reader. Without a row lock its conditional transition could affect zero
  rows while returning `PROVIDER_FAILURE`.
- **Requirement impact:** PX09 routine status and privacy-safe outcome telemetry could contradict the
  immutable database result.
- **Correction:** lock the existing run before reading its lease/status and retain token-CAS
  transitions; add focused lock/reclaim coverage.

#### Medium — schema verifier rejected valid PostgreSQL catalog forms (corrected)

- **Files:** `scripts/db-verify.ts:239`, `scripts/db-verify.ts:644`, and
  `tests/db-verify.test.ts`.
- **Reproduction:** run the verifier against migration 017; PostgreSQL renders `IN (...)` as
  `= ANY (ARRAY[...])`, and obsolete pre-014 constraint expectations consumed/re-required replaced
  checks.
- **Requirement impact:** a correct 17-migration database failed the release gate, creating a false
  drift report.
- **Correction:** verify canonical catalog material, remove superseded duplicate requirements, and
  add normalized-catalog regressions. The verifier now passes with exact object counts.

#### Medium — Dev Container test/upgrade URLs bypassed the bridge policy (corrected)

- **Files:** `scripts/runtime-config.ts:25`, `scripts/db-test-create.ts:15`, and
  `tests/migration-upgrade.integration.test.ts:94`.
- **Reproduction:** set `GOALPILOT_DEVCONTAINER=true` with documented localhost URLs; runtime paths
  used `host.docker.internal`, while test creation/upgrade still attempted container loopback.
- **Requirement impact:** documented setup and isolated database proof were not reproducible inside
  the Dev Container.
- **Correction:** centralize the explicitly gated rewrite for both URLs, keep exact database-name and
  identity guards, reject the bridge outside container mode, and add DB-free safety tests.

#### Low — plan-preview p95 evidence omitted the measured value (corrected)

- **File:** `apps/api/src/app.test.ts:539`.
- **Reproduction:** run the test; the prior assertion enforced the ceiling but printed no observed
  p95 for release evidence.
- **Requirement impact:** the performance row could not be filled without inventing a value.
- **Correction:** emit the 20-sample p95 and ceiling; the latest measured value is recorded above.

## Known limitations and external gates

- Human validation is an **OPEN external gate**; no participant session or outcome is claimed.
- The platform approval service denied clean database reset, installed-Chrome/server execution,
  Docker-engine access, and `.git` index writes after its approval quota was exhausted. The smallest
  human action is to explicitly authorize those scoped operations when approval capacity is
  available; no workaround was attempted.
- The registry dependency audit failed with sandbox `EACCES` after its normal retries. It requires
  approved registry access; no audit result is inferred from the failure.
- The development database remains on its prior schema because the guarded reset/migrate/seed gate
  was not authorized. Only the existing isolated test database was read/used by focused tests.
- A recovered indeterminate Story command deliberately returns 409 after advancing only through the
  durable owner-wide pending high-water. The original key remains non-replayable; the user must
  refresh and intentionally start a new milestone. This favors no duplicate financial history over
  availability after a process crash.
- `pnpm` native command-name collisions require `corepack pnpm run setup`, `run doctor`, and
  `run sbom`; bare `pnpm setup`/`doctor`/`sbom` do not invoke repository scripts.
- A full VS Code editor attach is optional evidence and is not claimed unless executed.
- This remains a local educational simulator using deterministic fixture data.
- There is no real money movement, provider credential, live rate/price feed, personalized financial
  advice, compliance approval, production operation, public deployment, or AWS implementation.

## Release decision — blocked

- Product-experience automated hard gate: **BLOCKED / NOT PASSED**.
- Reserved release label applied: **NO — WITHHELD**.
- Decision checkpoint: dirty manifest checkpoint recorded above; local commit unavailable.
- Rationale: source review and every available non-destructive gate passed, but clean database,
  coverage/canonical verify, installed-Chrome, Docker, local smoke, dependency-audit, and commit
  evidence remain blocked. The reserved label therefore remains withheld.

After the final gates, fill the exact source/diff checkpoint, verification timestamp, observed
environment and Chrome build, all database/test/coverage counts, journey outcomes and durations,
background failure disposition, performance measurements, security/audit/SBOM results, smoke/port
cleanup, Dev Container results, and final decision. Do not change the decision or apply the reserved
label unless every required gate passes.
