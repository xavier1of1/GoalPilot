# Implementation status

## Initial audit — 2026-08-23

> **Historical record:** this section describes the repository at the start of the M00–M18 audit.
> It must not be read as the current PX release state.

- Existing at audit start: five approved planning documents and an otherwise empty repository.
- Working product code, tests, runtime, manifest, lockfile, migrations, containers, and workflows:
  none at audit start.
- Local-first conflict: AWS/Cognito work preceded the complete local product. `TASKS.md` and ADR
  0001 put all AWS work behind the local hard gate.

## Verified foundation — M18 complete

M00 through M18 and the original local hard gate passed on 2026-08-23. The independent checkpoint
was re-proved and corrected in commit `1dbd3a4`. This is historical foundation evidence, not a
substitute for the later PX hard gate. M19 through M22 remain unauthorized AWS work.

### Historical M18 evidence — do not substitute for PX results

| Historical command or evidence        | 2026-08-23 result                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm run setup` twice                | PASS; frozen install, Docker PostgreSQL, migration, seed, and diagnostics repeated safely               |
| `pnpm run doctor`                     | PASS; Node 24.19.0, pnpm 11.22.0, Docker, environment, and database                                     |
| Dev Container image/runtime probe     | PASS; Node 24.19.0, pnpm 11.22.0, Git 2.39.5, PostgreSQL client 15.19                                   |
| Developer migrate twice, seed, verify | PASS; 5 checksummed migrations, 15 public tables, 4 assumptions                                         |
| `corepack pnpm verify`                | PASS; format, lint, types, 67 tests with coverage, builds, database verification, scans/audit, and SBOM |
| Historical coverage                   | PASS; API 91.34%, data 94.60%, domain 95.89% lines; domain branches 86.60%                              |
| Installed-Chrome E2E                  | PASS; 3/3 historical journeys with the historical Axe/overflow scope                                    |

Historical production bundles were web JavaScript 409.27 kB (124.47 kB gzip) and CSS 21.58 kB
(5.88 kB gzip). Those measurements remain historical and are not current PX evidence.

## Current milestone — PX00–PX10 source present; release gate not passed

The frozen local product-experience implementation is commit
`e024fc22385f560327a3459d471194da08b0e9a8`. Its canonical 192-file implementation manifest is
SHA-256 `4f8eb8dfe8262e7d9ae158a22a53397e389038a32875b193ae9b5efe3e9dcb8c`. The worktree was clean
before the evidence-only updates to this file and `LOCAL_PRODUCT_RELEASE.md`; those updates are now
one unpushed local documentation commit ahead of `origin/master`.

The source provides progressive baseline-first planning, saved drafts, deterministic plan and
vehicle calculations, plan health, What-If/recovery versions, history/archive views, owner-scoped
Story Mode, privacy-safe events, and fixture-only Purchase Timing Lab. That inventory does not prove
the complete product outcome: final Chrome execution and the independent requirement audit found
release-blocking defects and gaps.

The reserved label **GoalPilot Local Product Experience verified** is **WITHHELD**. The automated PX
hard gate is **NOT PASSED**.

Human validation remains an **OPEN external gate**. No participant session or usability outcome is
claimed. The application is not production-ready, financially compliant, AWS-ready/deployed, or a
live financial service.

## Frozen-tree verification result — 2026-08-24

| Gate                                                           | Final result                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source identity                                                | **PASS:** commit `e024fc22385f560327a3459d471194da08b0e9a8`; clean checkpoint; 192-file implementation manifest SHA-256 `4f8eb8dfe8262e7d9ae158a22a53397e389038a32875b193ae9b5efe3e9dcb8c`                                                                                                                                                     |
| Host/toolchain                                                 | **RECORDED:** Windows 11 Pro 10.0.26200 build 26200; Git 2.53; Node 24.19.0; pnpm 11.22.0; Docker client/server 27.5.1; Compose 2.32.4; PostgreSQL 17.11                                                                                                                                                                                       |
| `corepack pnpm run setup` twice and `corepack pnpm run doctor` | **PASS**                                                                                                                                                                                                                                                                                                                                       |
| Clean developer replay and schema verifier                     | **PASS:** deterministic reset/migrate/seed; 17 migrations, 25 tables, 135 columns, 162 constraints, 19 triggers, 17 functions, 10 indexes, 4 assumptions                                                                                                                                                                                       |
| Independent upgrade 005 → 017                                  | **PASS:** 1/1 test in 1.11 seconds                                                                                                                                                                                                                                                                                                             |
| Unit suite                                                     | **PASS:** 29 files / 222 tests                                                                                                                                                                                                                                                                                                                 |
| PostgreSQL integration suite                                   | **PASS:** 7 files / 48 tests                                                                                                                                                                                                                                                                                                                   |
| Coverage                                                       | **PASS:** 36 files / 270 tests; overall 75.98% lines / 69.85% branches / 75.45% functions / 73.95% statements; API 89.36% lines / 75.47% branches / 100% functions / 85.90% statements; data 90.95% lines / 75.20% branches / 95.65% functions / 87.89% statements; domain 97.24% lines / 92.69% branches / 100% functions / 95.49% statements |
| `corepack pnpm verify`                                         | **PASS:** complete canonical chain                                                                                                                                                                                                                                                                                                             |
| Production build                                               | **PASS:** 11 workspace projects; web 2,003 modules; JS 461.86 kB / 137.04 kB gzip; CSS 32.06 kB / 7.85 kB gzip                                                                                                                                                                                                                                 |
| Demo reset, product-event summary, and price watch             | **PASS:** reset and aggregate summary completed; first price run used 731 observations; a second same-date routine invocation safely returned `no_due`                                                                                                                                                                                         |
| Security scan and production registry audit                    | **PASS:** scan clean; audit reported no vulnerabilities                                                                                                                                                                                                                                                                                        |
| CycloneDX SBOM                                                 | **PASS:** version 1.5, 432 components, 619,053 bytes; SHA-256 `e4040572ff67633ebf3921b6709db5353d3a175cc455dfcc4d716277d56cf9e9`                                                                                                                                                                                                               |
| Production-built local smoke and local-mode flags              | **PASS:** smoke completed; `demoStory` and `purchaseTimingLab` capability flags false in local mode; owned ports closed                                                                                                                                                                                                                        |
| Installed Chrome Journeys A–E                                  | **FAIL:** Chrome 151.0.7922.170, 1/5 passed; Journey E passed, Journey B exposed an activity-contract HTTP 500, and A/C/D failed on navigation-abandoned tracker reports                                                                                                                                                                       |
| Accessibility and responsive browser gate                      | **NOT PASSED:** complete critical-state evidence is absent because the Chrome suite failed; the audit also found builder error-association gaps                                                                                                                                                                                                |
| Dev Container                                                  | **PARTIAL/FAIL:** Dockerfile build passed; network-disabled non-root probe failed when Corepack tried registry access for pnpm                                                                                                                                                                                                                 |
| Full VS Code editor attach                                     | **NOT EXECUTED:** optional evidence only                                                                                                                                                                                                                                                                                                       |

Exact commands, limits, failure interpretation, and the complete release record are in
[LOCAL_PRODUCT_RELEASE.md](LOCAL_PRODUCT_RELEASE.md).

## Current release-blocking findings

### High

- The seeded $1,500 65-inch OLED Timing item is attached to the unrelated $9,000 Japan-trip goal.
  Timing readiness consequently answers with the trip's Plan Health rather than readiness for the
  illustrated television purchase (`scripts/demo-fixture.ts`).
- Applying a What-If/recovery version creates a valid `plan_changed` ledger entry, but the normal
  activity response contract omits that type. Reading activity returns HTTP 500 and blocks Journey B
  (`packages/data-access/src/plan-experience-repository.ts`, `packages/contracts/src/index.ts`).

### Medium

- A deliberately omitted contribution is counted and explained as `ALREADY_PROCESSED`/duplicate;
  Story Mode lacks a distinct planned-missed outcome and Journey B never verifies that narrative.
- The plan result headlines the user's chosen $400.50 contribution before the zero-interest safe
  amount of $416.67, contrary to the binding safe-primary hierarchy.
- Vehicle comparison cards omit an explicit eligible-but-not-selected fit state and hide required
  common metrics for ineligible models.
- What-If comparison omits current/proposed deadline and target amount.
- Story Mode does not render next scheduled event or next maturity and does not wire the required
  contribution-failure and HTTP-replay explanations.
- Purchase Timing Lab does not render its deterministic rationale codes and does not model/display a
  target purchase date.
- Goal, amount, date, and current-savings builder errors lack complete accessible field association,
  multi-error summary, and first-invalid focus behavior.
- Decision-summary rationale branches and required rendered interface states lack exact direct test
  coverage despite the passing aggregate coverage threshold.

These static audit findings are separate from the executed-gate failures. File/line evidence,
impact, and required corrections are recorded in
[LOCAL_PRODUCT_RELEASE.md](LOCAL_PRODUCT_RELEASE.md#independent-requirement-audit--open-findings).

## Process and reproducibility blockers

- The `refs/remotes/origin/master` reflog records `update by push` to
  `e024fc22385f560327a3459d471194da08b0e9a8` at 2026-08-24 07:49:07 -0400 despite the mandate's
  explicit no-push instruction. Local evidence does not identify its actor or mechanism. Local
  `master` now contains one unpushed evidence-only documentation commit; no further push or history
  mutation was performed while recording this status.
- Chrome A/C/D cannot be counted as product passes until the background tracker distinguishes
  navigation-abandoned requests from application failures and the journeys pass on rerun.
- The Dev Container must make the pinned pnpm toolchain available to the non-root user without
  registry access before the offline runtime probe can pass.
- Human validation remains open; automated Axe and keyboard checks do not replace participant or
  assistive-technology sessions.

## Boundaries preserved

- No real money movement, provider credential, bank connection, live rate/price feed, external
  retailer integration, AWS resource, or production authentication adapter was added.
- Illustrative rates and price history remain static, versioned local fixtures and are not offers or
  predictions.
- Native pnpm command-name collisions still require `corepack pnpm run setup`, `run doctor`, and
  `run sbom` for repository scripts.
- AWS M19–M22 remains disabled, unimplemented, and unauthorized.

## Next task before AWS

Correct only the recorded frozen-tree release findings; add focused regression evidence; refreeze
the source; rerun the complete affected database/API/component suites, canonical `verify`, installed
Chrome Journeys A–E with Axe and 360/768/1024/1440 checks, local smoke, port cleanup, and the
network-disabled non-root Dev Container probe. Keep the reserved label withheld unless every gate
passes and no release-blocking in-scope finding remains. Do not begin M19 or any AWS work.
