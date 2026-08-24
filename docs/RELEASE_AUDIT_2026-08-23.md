# GoalPilot Local MVP Independent Release Audit

**Audit date:** 2026-08-23  
**Audited revision:** `e17753a` (`master`)  
**Scope:** approved local-first MVP only; M19 and AWS work excluded  
**Initial-audit state:** findings below were recorded before product source changes

## Verdict

The committed baseline is a substantial, working first-stage MVP, but the existing “Local MVP
verified” claim is not sufficient release evidence. The documented setup and most automated gates
pass, while several authentication, financial-model, database-integrity, provider-boundary, test-gate,
accessibility, and reproducibility defects remain actionable inside the approved local scope.

## Severity-ordered findings

### Critical

#### AUD-001 — malformed password hashes fail open

- **Evidence:** `packages/auth/src/index.ts:44` decodes an unchecked expected digest and derives a key
  using its decoded length. A malformed digest can make both buffers empty.
- **Reproduction:** calling
  `verifyPassword('anything', '$scrypt$16384$8$1$00$zz')` returned `true`.
- **Impact:** corrupted or malicious credential data can authenticate an arbitrary password, violating
  the local-auth and fail-closed security requirements.
- **Correction:** strictly validate the complete stored-hash grammar and parameter values before key
  derivation, return `false` for malformed input, and add malformed-hash regression vectors.

### High

#### AUD-002 — destructive test-database guard compares raw URL strings

- **Evidence:** `scripts/db-test-create.ts:10` rejects only `developmentUrl === testUrl`; the shared URL
  assertion in `scripts/runtime-config.ts` accepts database names by substring.
- **Reproduction:** use semantically identical development and test targets with `localhost` in one URL
  and `127.0.0.1` in the other. The equality guard does not fire.
- **Impact:** `db:reset:test` can reset the developer database despite the stated isolation guarantee.
- **Correction:** normalize loopback host, port, user, and exact database name; require distinct,
  role-specific database identities; unit-test equivalent-URL and wrong-name cases.

#### AUD-003 — fixed-term goals can complete before funds mature

- **Evidence:** `packages/domain/src/projection.ts:32` returns the application date for any already-funded
  goal, and activation in `packages/data-access/src/repository.ts` treats funding as immediately
  purchase-ready without regard to lock duration.
- **Reproduction:** project an already-funded CD or Treasury goal on 2026-08-23 with target date
  2027-08-23. Both reported completion on 2026-08-23 with no maturity event.
- **Impact:** completion and availability contradict the CD/Treasury maturity-only model and ADR 0002.
- **Correction:** keep fixed-term funds locked through the modeled maturity/target boundary and add both
  projection and Autopilot state-transition regressions.

#### AUD-004 — contribution target crossing posts interest at an undocumented boundary

- **Evidence:** `packages/domain/src/projection.ts:145` and the simulator post interest when a
  contribution merely causes balance to reach target. ADR 0002 defines month-end and target-date
  posting boundaries.
- **Reproduction:** target 100,000 cents, current savings 99,999 cents, one-cent weekly contribution,
  target 2026-12-31. The HYSA model posted 75 cents and completed 2026-08-30.
- **Impact:** projections and runtime ledger events diverge from the approved financial policy.
- **Correction:** accrue on the effective day but post only at month-end or target date; add a golden
  early-target-crossing vector and runtime ledger regression.

#### AUD-005 — same-owner relational mismatches remain possible

- **Evidence:** migrations constrain child rows independently by user, but do not bind an account's goal
  to its plan's goal, a plan's vehicle to its assumption vehicle, or a reversal to its own account.
  See `packages/data-access/migrations/202608230001_local_mvp.sql:69-151` and the partial ownership
  hardening in migration 003.
- **Reproduction:** for one user, create two goals and attach the first goal's account to the second
  goal's plan; the existing foreign keys accept the row. Equivalent cross-account reversal links and
  mismatched assumption versions are also accepted.
- **Impact:** ownership is preserved while financial provenance and append-only ledger integrity are not.
- **Correction:** add composite relational constraints in a new ordered migration and negative database
  tests for every mismatch.

#### AUD-006 — coverage thresholds are not part of `pnpm verify`

- **Evidence:** root `package.json:38` runs `pnpm test`, not `pnpm test:coverage`; CI delegates to that
  same command. Thresholds in `vitest.config.ts` run only when coverage is explicitly requested.
- **Reproduction:** compare the scripts, then run `pnpm verify`; no coverage report or threshold check is
  emitted. A separate `pnpm test:coverage` did pass.
- **Impact:** the main release gate can pass after coverage falls below the documented minimums.
- **Correction:** make coverage execution the test phase of `verify` and retain CI's single canonical gate.

### Medium

#### AUD-007 — unexpected-error logging can disclose secrets

- **Evidence:** the centralized handler in `apps/api/src/app.ts` logs the raw `Error`; logger path
  redaction does not sanitize `Error.message` or `Error.stack`.
- **Reproduction:** log `new Error('DATABASE_URL=postgres://user:password@localhost/private')`; captured
  output contained `password`.
- **Impact:** unexpected failures can persist credentials contrary to the redaction policy.
- **Correction:** log a safe error classification/correlation context, never raw unexpected exceptions,
  and add a captured-output regression.

#### AUD-008 — required simulator ports are not the runtime boundary

- **Evidence:** the API reads the application date and assumptions directly, while
  `packages/provider-simulators` imports the concrete data-access package despite the documented
  dependency direction.
- **Reproduction:** trace goal preview/activation from `apps/api/src/app.ts`; replacing `Clock` or
  `RateProvider` does not replace these calls.
- **Impact:** the provider abstraction is partly decorative and future provider replacement still
  requires API and simulator rewrites.
- **Correction:** inject clock/rate ports into the API and make simulator persistence a structural port
  rather than a concrete package dependency.

#### AUD-009 — E2E verification conflicts with the documented development ports

- **Evidence:** `playwright.config.ts` fixes API/web servers to ports 3000/5173 and disables reuse.
- **Reproduction:** with the documented development API running, `pnpm test:e2e` failed before test
  execution because port 3000 was occupied.
- **Impact:** the documented release command is not reproducible from a normal local development state.
- **Correction:** use dedicated E2E ports and environment-controlled Vite proxy/origin configuration.

#### AUD-010 — protected-route ownership matrix is incomplete

- **Evidence:** `apps/api/src/auth-goals.integration.test.ts` covers read/update/delete/ledger/contribution
  denial but omits activate, pause, resume, complete, and archive denial for a non-owner.
- **Impact:** route-level ownership regressions can pass the suite.
- **Correction:** add indistinguishable-not-found assertions for every protected mutation.

#### AUD-011 — contribution failure state is not accessible inside its dialog

- **Evidence:** `apps/web/src/pages/DashboardPage.tsx` surfaces mutation errors only in the page-level
  alert; client parsing errors have no associated field message or focus movement.
- **Reproduction:** open “Add contribution,” enter an invalid/zero amount, and submit.
- **Impact:** keyboard and screen-reader users may not discover or locate the failure.
- **Correction:** render an associated alert in the dialog, set `aria-invalid`/`aria-describedby`, focus
  the field, and cover the behavior in browser regression tests.

#### AUD-012 — UI test claims cover too few meaningful states

- **Evidence:** `apps/web/e2e/goalpilot.spec.ts` runs axe only on landing and a final dashboard state;
  required-width overflow checks cover only landing.
- **Impact:** auth, result cards, modal, error, and dashboard regressions can evade the claimed WCAG and
  responsive evidence.
- **Correction:** run axe and overflow checks across the principal journey states and required widths.

#### AUD-013 — exact golden-vector coverage is incomplete

- **Evidence:** domain tests assert an exact CD vector but only general properties for the four-vehicle
  comparison; exact Cash, HYSA, and Treasury outputs and rounding ties are not locked.
- **Impact:** subtle posting, compounding, or rounding regressions can still satisfy broad assertions.
- **Correction:** add exact golden outputs for all four vehicles plus half-even and maturity roll vectors.

#### AUD-014 — legacy export endpoint bypasses the request lifecycle

- **Evidence:** `apps/api/src/app.ts:522` exposes undocumented `GET /api/v1/data-export` beside the
  official `POST /api/v1/data-exports` request/audit flow.
- **Impact:** two behaviors exist for one operation, and the legacy path bypasses lifecycle evidence.
- **Correction:** remove the undocumented route and assert it remains unavailable.

#### AUD-015 — database verification proves too little

- **Evidence:** `scripts/db-verify.ts` checks only that at least one migration exists and that one table is
  present.
- **Impact:** omitted/tampered migration files or drift between seeded assumptions and code can still
  produce a passing release gate.
- **Correction:** verify exact ordered migration names/checksums, expected tables, and seeded assumption
  catalog consistency.

### Process and evidence limitations

- The repository's single feature commit was made directly on `master`, contrary to the documented
  branch/PR discipline. The audit will not rewrite project history.
- The Dev Container Docker image built successfully and reported Node 24.19.0, pnpm 11.22.0, Git
  2.39.5, and psql 15.19. A complete editor attach/open was **not executed** because the Dev Container
  CLI is unavailable; this is an explicit evidence limitation, not a claimed pass.
- The host's unrelated global `%APPDATA%\npm\pnpm.ps1` contains malformed non-script content.
  Commands were executed through the repository-pinned `corepack pnpm`; that global host file was
  not modified during the audit.
- Product-level edit/history expansion is useful next-stage work, but it is not being added during this
  release-correction phase because it would expand the approved MVP scope.

## Baseline commands actually executed

| Command                                        | Initial result                                               |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `corepack pnpm run setup`                      | PASS; safe idempotent setup completed                        |
| `corepack pnpm run doctor`                     | PASS; Node, pnpm, Docker, and PostgreSQL checks passed       |
| `corepack pnpm test:coverage`                  | PASS; 47 tests; API 88.85%, data 94.11%, domain 95.33% lines |
| `corepack pnpm verify`                         | PASS on the committed baseline, subject to AUD-006           |
| `corepack pnpm test:e2e`                       | NOT RUN; Playwright stopped on occupied API port (AUD-009)   |
| `docker build -f .devcontainer/Dockerfile ...` | PASS                                                         |
| Dev Container runtime tool-version probe       | PASS; this is not an editor attach/open claim                |
| `git diff --check`                             | PASS; initial worktree clean                                 |

## Correction and final-verification record

All actionable findings above were corrected inside the approved local scope:

| Finding | Resolution evidence                                                                 |
| ------- | ----------------------------------------------------------------------------------- |
| AUD-001 | strict scrypt grammar plus malformed/unsupported hash regressions                   |
| AUD-002 | normalized database identity, exact role names, and safety unit tests               |
| AUD-003 | fixed-term funded openings remain active/locked through the target boundary         |
| AUD-004 | deposit posting restricted to month-end/target date in projection and Autopilot     |
| AUD-005 | migration 004 plus cross-goal, assumption/vehicle, reversal, and period tests       |
| AUD-006 | `pnpm verify` now executes coverage and enforces thresholds                         |
| AUD-007 | raw unexpected exceptions removed from handler logs and logger regression added     |
| AUD-008 | API clock/rates injected; simulators depend on a structural store contract          |
| AUD-009 | Playwright API/web moved to dedicated 3100/5273 test ports                          |
| AUD-010 | every protected goal mutation has a non-owner 404 assertion                         |
| AUD-011 | dialog-local associated error, invalid state, focus movement, component/E2E tests   |
| AUD-012 | Axe and overflow checks extended across auth, results, dashboard, and dialog states |
| AUD-013 | exact Cash/HYSA/CD/Treasury, half-even, and maturity vectors added                  |
| AUD-014 | undocumented legacy export GET removed and regression-locked at 404                 |
| AUD-015 | exact filenames/checksums/tables/reviewed-catalog verification added                |

The expanded browser checks additionally discovered and corrected a 1.05:1 header sign-in contrast
failure and a 360-pixel dashboard overflow. The failed discovery runs are not represented as passes.

### Final commands actually executed

| Command                                                  | Final result                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `corepack pnpm run setup`                                | PASS; migration 004 applied non-destructively and diagnostics passed |
| `corepack pnpm run doctor`                               | PASS                                                                 |
| repeated `corepack pnpm db:migrate`                      | PASS; database already current                                       |
| `corepack pnpm db:verify`                                | PASS; 4 checksummed migrations, 15 tables, 4 assumptions             |
| `corepack pnpm verify`                                   | PASS; 13 files, 64 tests, coverage/build/security/SBOM gates passed  |
| coverage within `pnpm verify`                            | PASS; API 91.37%, data 94.58%, domain 95.94% lines                   |
| `PLAYWRIGHT_CHANNEL=chrome corepack pnpm test:e2e`       | PASS; 2/2 journeys                                                   |
| post-change Dev Container Docker build and runtime probe | PASS                                                                 |
| full VS Code Dev Container attach/open                   | NOT EXECUTED; CLI unavailable                                        |

The final E2E run reset only the exact isolated `goalpilot_test` target and ran its own servers on
3100/5273. The developer database was migrated/seeded non-destructively; it was not reset because
that would not have been safe with an existing development session.
