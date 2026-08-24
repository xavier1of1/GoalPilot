# GoalPilot local product-experience release evidence

> **AUTOMATED HARD GATE NOT PASSED — 2026-08-24.** The PX00–PX10 source checkpoint completed most
> frozen-tree verification, including the canonical verification command. Installed-Chrome E2E,
> the network-disabled non-root Dev Container probe, and a requirement-by-requirement product audit
> did not pass. The reserved release label is therefore withheld.

This record covers a local educational simulator. It does not establish production readiness,
financial compliance, AWS readiness or deployment, or human-validation outcomes.

## Release identity

| Field                       | Frozen-tree evidence                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source checkpoint tested    | Commit `e024fc22385f560327a3459d471194da08b0e9a8` (`feat: implement GoalPilot PX00-PX10 local product experience`)                                                                                            |
| Implementation manifest     | SHA-256 `4f8eb8dfe8262e7d9ae158a22a53397e389038a32875b193ae9b5efe3e9dcb8c` over the canonical sorted path/content manifest of 192 implementation files; this file and `IMPLEMENTATION_STATUS.md` are excluded |
| Working-tree state          | Clean after a single unpushed evidence-only documentation commit; local `master` is one commit ahead of `origin/master`, and no source, feature, test, or AWS file changed while recording these results      |
| Product phase               | PX00–PX10, local only                                                                                                                                                                                         |
| Application version         | `0.1.0`                                                                                                                                                                                                       |
| Fixture and policy versions | `demo-2026-08-v1`, `product-experience-v1`, `vehicle-fit-v2`, `plan-health-v1`, and `purchase-timing-v1`                                                                                                      |
| Host                        | Windows 11 Pro 10.0.26200, build 26200                                                                                                                                                                        |
| Toolchain                   | Git 2.53; Node 24.19.0; pnpm 11.22.0; Docker client/server 27.5.1; Docker Compose 2.32.4; PostgreSQL 17.11                                                                                                    |
| Browser                     | Installed stable Chrome 151.0.7922.170                                                                                                                                                                        |
| Evidence owner              | Codex independent local-release audit                                                                                                                                                                         |

The phrase **GoalPilot Local Product Experience verified** is reserved. Do not apply it unless every
required automated gate passes against one frozen source identity and no release-blocking in-scope
finding remains.

The implementation manifest is reproducible from the current local checkout because the two
evidence documents are excluded. It frames each bytewise path-sorted entry as UTF-8 path, NUL,
ASCII byte length, NUL, lowercase Git-blob SHA-256, and LF:

```powershell
node -e "const cp=require('node:child_process');const c=require('node:crypto');const excluded=new Set(['docs/LOCAL_PRODUCT_RELEASE.md','docs/IMPLEMENTATION_STATUS.md']);const paths=cp.execFileSync('git',['ls-tree','-r','--name-only','-z','HEAD'],{encoding:'buffer',maxBuffer:67108864}).toString('utf8').split('\0').filter(Boolean).filter(p=>!excluded.has(p)).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));const h=c.createHash('sha256');for(const p of paths){const b=cp.execFileSync('git',['show','HEAD:'+p],{encoding:'buffer',maxBuffer:67108864});const bh=c.createHash('sha256').update(b).digest('hex');h.update(Buffer.from(p,'utf8'));h.update(Buffer.from([0]));h.update(Buffer.from(String(b.length),'ascii'));h.update(Buffer.from([0]));h.update(Buffer.from(bh,'ascii'));h.update(Buffer.from('\n','ascii'));}console.log('files='+paths.length);console.log('sha256='+h.digest('hex'));"
```

## Scope and intentional boundary

The application is a React/Vite browser client, Fastify API, and loopback PostgreSQL database.
Domain policy owns financial calculations; API routes validate and orchestrate; repositories enforce
ownership and persistence; provider ports isolate local authentication, clock, rate-catalog,
interest, and fixture-price behavior. The owner-scoped Story clock never changes the operating-system
clock.

- No real account is opened and no money is held, moved, invested, or used for a purchase.
- Rates and price history are reviewed illustrative local fixtures, not live offers or retailer data.
- Purchase Timing Lab is descriptive, non-predictive, and fixture-only.
- Human validation is a separate external gate and remains open.
- AWS M19–M22 and external providers remain unimplemented and unauthorized.

## Database inventory and replay evidence

The frozen source contains 17 ordered immutable migrations, ending with
`202608230017_price_check_worker_lease.sql`.

| Database gate                                 | Result   | Frozen-tree evidence                                                                                                             |
| --------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Development reset, migration replay, and seed | **PASS** | Clean guarded development replay and deterministic seed completed                                                                |
| Schema verifier                               | **PASS** | 17 migrations, 25 public tables, 135 columns, 162 constraints, 19 triggers, 17 functions, 10 indexes, and 4 reviewed assumptions |
| Previous-schema upgrade                       | **PASS** | Independent migration 005 → 017 upgrade suite: 1/1 test in 1.11 seconds                                                          |
| Test database preparation                     | **PASS** | Canonical coverage/verify flow created, reset, migrated, and seeded the isolated test database before execution                  |

## Final command record

All package commands used the repository-pinned package manager through Corepack.

| Required command or check                     | Status           | Frozen-tree evidence                                                                                                          |
| --------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Record exact source identity and diff state   | **PASS**         | Commit and 192-file manifest above; worktree clean before the evidence-doc update                                             |
| `corepack pnpm run setup` twice               | **PASS**         | Both complete setup runs passed                                                                                               |
| `corepack pnpm run doctor`                    | **PASS**         | Node, pnpm, Docker, environment, database, and local/simulated-provider diagnostics passed                                    |
| Development reset, migrate, seed, and verify  | **PASS**         | Clean replay and exact schema counts recorded above                                                                           |
| Independent upgrade through migration 017     | **PASS**         | 1/1 test passed in 1.11 seconds                                                                                               |
| `corepack pnpm test:unit`                     | **PASS**         | 29 files / 222 tests                                                                                                          |
| PostgreSQL integration suite                  | **PASS**         | 7 files / 48 tests                                                                                                            |
| `corepack pnpm test:coverage`                 | **PASS**         | 36 files / 270 tests; configured thresholds passed                                                                            |
| `corepack pnpm verify`                        | **PASS**         | Canonical format, lint, type, coverage, build, database verification, security scan, registry audit, and SBOM chain completed |
| `corepack pnpm build`                         | **PASS**         | 11 workspace projects; web 2,003 modules; JavaScript 461.86 kB / 137.04 kB gzip; CSS 32.06 kB / 7.85 kB gzip                  |
| `corepack pnpm demo:reset`                    | **PASS**         | Seeded development demo reset completed                                                                                       |
| `corepack pnpm product-events:summary`        | **PASS**         | Aggregate-only summary completed                                                                                              |
| `corepack pnpm price-watch:run`               | **PASS**         | First run completed over 731 observations; a second same-date routine invocation safely returned `no_due`                     |
| `corepack pnpm local:smoke`                   | **PASS**         | Production-built local smoke sequence completed                                                                               |
| Local-release mode flag probe                 | **PASS**         | The `demoStory` and `purchaseTimingLab` capability flags were both false in local mode                                        |
| Installed-Chrome `corepack pnpm test:e2e`     | **FAIL**         | 1/5 journeys passed; details below                                                                                            |
| `corepack pnpm security:scan`                 | **PASS**         | No potential secret patterns detected                                                                                         |
| `corepack pnpm audit:prod`                    | **PASS**         | Registry audit reported no vulnerabilities                                                                                    |
| `corepack pnpm run sbom`                      | **PASS**         | CycloneDX 1.5, 432 components, 619,053 bytes; SHA-256 `e4040572ff67633ebf3921b6709db5353d3a175cc455dfcc4d716277d56cf9e9`      |
| Dev Container image build                     | **PASS**         | Dockerfile image build completed with Docker client/server 27.5.1                                                             |
| Dev Container network-disabled non-root probe | **FAIL**         | Corepack attempted to reach the package registry for pnpm; the image did not prove offline non-root toolchain reproducibility |
| Owned-port cleanup                            | **PASS**         | GoalPilot release, demo, test, and browser listeners were closed after verification                                           |
| Full VS Code Dev Container editor attach      | **NOT EXECUTED** | Optional evidence; no claim is made                                                                                           |

## Test and coverage evidence

| Coverage group | Statements | Branches | Functions |  Lines | Result   |
| -------------- | ---------: | -------: | --------: | -----: | -------- |
| Overall        |     73.95% |   69.85% |    75.45% | 75.98% | **PASS** |
| API            |     85.90% |   75.47% |      100% | 89.36% | **PASS** |
| Data access    |     87.89% |   75.20% |    95.65% | 90.95% | **PASS** |
| Domain         |     95.49% |   92.69% |      100% | 97.24% | **PASS** |

The coverage run executed 36 files / 270 tests. The DB-free unit suite separately executed 29 files /
222 tests, and the PostgreSQL integration suite executed 7 files / 48 tests.

Passing aggregate coverage does not close the direct assertion and rendered-state gaps identified
by the requirement audit below.

## Browser, accessibility, and responsive evidence

The final installed-Chrome run used Chrome 151.0.7922.170 and finished **1/5 journeys passing**.

| Journey or check                              | Status         | Final evidence                                                                                                                                        |
| --------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — progressive plan and activation           | **FAIL**       | The harness timed out draining tracked requests; trace-based diagnosis attributes the retained entries to requests abandoned by deliberate navigation |
| B — disruption and recovery                   | **FAIL**       | A real `plan_changed` ledger row caused the ledger response to return HTTP 500 because the activity response contract omits that valid entry type     |
| C — Autopilot and completion                  | **FAIL**       | The harness timed out draining tracked requests; trace-based diagnosis attributes the retained entries to requests abandoned by deliberate reload     |
| D — Purchase Timing Lab                       | **FAIL**       | The harness timed out draining a tracked request; trace-based diagnosis attributes the retained entry to a request abandoned by deliberate reload     |
| E — ownership and privacy                     | **PASS**       | The ownership/privacy journey completed                                                                                                               |
| Axe, keyboard, focus, and responsive coverage | **NOT PASSED** | The suite did not complete all critical journeys; the static audit also found incomplete form-error semantics described below                         |
| Background-failure disposition                | **FAIL**       | A/C/D require a harness correction and clean rerun so intentionally abandoned navigation requests are distinguished from application failures         |

The A/C/D failures may originate in tracker classification, but a failed harness cannot prove the
underlying journey. Journey B exposed an application contract defect rather than a harness-only
failure. Automated Axe checks cannot substitute for participant or assistive-technology validation.

## Security, privacy, and supply-chain evidence

- The canonical verification chain, secret scan, production registry audit, and SBOM generation
  passed.
- The clean PostgreSQL suites and schema verifier passed ownership, relational-integrity,
  immutability, idempotency, controlled-clock, privacy, and fixture-boundary tests included in their
  executed scope.
- The installed-Chrome ownership/privacy journey passed.
- These results do not override the failed complete E2E gate or the open requirement-audit findings.

## Independent requirement audit — open findings

The read-only audit compared the source and rendered behavior requirements with implementation,
rather than treating green aggregate commands as proof of every product outcome. The earlier claim
that no in-scope High or Medium finding remained is superseded by this ledger.

### High — seeded Timing Lab readiness is tied to an unrelated goal

- **Evidence:** `scripts/demo-fixture.ts:38`, `scripts/demo-fixture.ts:44`, and
  `scripts/demo-fixture.ts:268`–`274` associate the $1,500 synthetic 65-inch OLED item with the
  $9,000 Japan-trip goal.
- **Impact:** Purchase Timing readiness is derived from that unrelated goal's Plan Health, so the
  primary seeded PX09 question does not truthfully answer whether the user is financially ready for
  the illustrated television purchase.
- **Required correction:** give the Timing item a semantically matching plan/readiness source, then
  rerun its database, API, UI, and Journey D evidence.

### High — valid plan history breaks the activity API and Journey B

- **Evidence:** scenario application writes a valid `plan_changed` ledger entry in
  `packages/data-access/src/plan-experience-repository.ts:683`, while
  `packages/contracts/src/index.ts:458`–`470` omits `plan_changed` from the normal activity response
  enum. Journey B receives HTTP 500 when it reads the true ledger.
- **Impact:** disruption/recovery cannot demonstrate immutable history through the required browser
  flow.
- **Required correction:** align the activity contract and UI with the valid ledger vocabulary and
  add a regression that reads activity after applying a plan change.

### Medium — an intentional missed contribution is reported as a duplicate

- **Evidence:** `packages/data-access/src/repository.ts:1411`–`1437` records an intentional omission
  as `posted: false`; `apps/api/src/demo-autopilot.ts:97`–`103` counts every such result as
  `skippedDuplicates`; `apps/api/src/app.ts:2053`–`2055` maps it to `ALREADY_PROCESSED`.
- **Impact:** Story Mode explains the planned disruption as replay/duplicate behavior, and Journey B
  does not advance through and verify the required missed-event narrative.
- **Required correction:** return and map a distinct planned-missed outcome, render its explanation,
  and cover first execution separately from replay.

### Medium — the result hierarchy does not keep the safe amount primary

- **Evidence:** `apps/web/src/pages/BuilderPage.tsx:924`–`930` headlines the chosen contribution;
  the zero-interest safe amount appears second at approximately line 958. The fixture chooses
  $400.50 while the safe amount is $416.67.
- **Impact:** the mandatory safe-primary policy can be read as recommending the below-safe chosen
  amount.
- **Required correction:** lead the decision-ready result with the zero-interest safe commitment and
  clearly subordinate the user's chosen amount and modeled-interest effects.

### Medium — required comparison information is incomplete

- **Evidence:** eligible non-selected cards have no explicit fit state in
  `apps/web/src/pages/BuilderPage.tsx:1001`–`1010`; the ineligible branch near lines 1015–1162 hides
  safe contribution, benefit-versus-cash, readiness, access, and maturity/lock metrics.
- **Impact:** PX03 does not let the user compare all four vehicles using the required common fields
  and rationale.
- **Required correction:** render a deterministic fit state and common comparison fields for every
  card, while retaining the exact rejection and required change.

### Medium — What-If comparison omits the changed deadline and target

- **Evidence:** `apps/web/src/components/PlanWorkspace.tsx:601`–`670` does not show current and
  proposed deadline or target amount.
- **Impact:** DEADLINE and TARGET scenarios do not fully expose the exact one-variable change
  required by PX05.
- **Required correction:** include both current/proposed values with their deltas and rationale.

### Medium — Story Mode omits required schedule and failure explanations

- **Evidence:** the Story panel in `apps/web/src/components/PlanWorkspace.tsx:793` onward does not
  render the next scheduled event or next maturity even though `nextEventDate` exists in the
  contract; contribution-specific failure and HTTP replay explanations are not wired to the UI.
- **Impact:** PX07 does not provide the required understandable simulation status and failure paths.
- **Required correction:** expose upcoming event/maturity state and distinct failed, planned-missed,
  replay, locked, and no-event explanations.

### Medium — Timing rationale and target purchase date are incomplete

- **Evidence:** assessment `rationaleCodes` exist in `packages/contracts/src/index.ts` around line
  1721, but `TimingLabPanel` does not render them; the Timing assessment/UI model has no target
  purchase date.
- **Impact:** PX09 does not fully explain the deterministic state or put price history in the
  requested purchase-date context.
- **Required correction:** model and render the target purchase date and allowlisted rationale copy,
  preserving the separate readiness gate and non-prediction language.

### Medium — critical builder errors lack complete accessible association

- **Evidence:** goal, target, date, and current-savings errors in
  `apps/web/src/pages/BuilderPage.tsx:674`–`738` lack the complete `aria-invalid`,
  `aria-describedby`, alert association, first-invalid focus, and multi-error summary used for the
  budget field.
- **Impact:** the PX01 critical path does not meet the mandate's error accessibility requirements.
- **Required correction:** implement and test consistent field associations, error summary, and
  first-invalid focus across builder steps.

### Medium — rationale and rendered-state tests are incomplete

- **Evidence:** decision-summary branches in `apps/api/src/app.ts:234`–`259` lack direct assertions
  for safe-relation, access/lock, modeled-interest cushion, and readiness rationale codes; required
  rendered interface states are not exhaustively covered.
- **Impact:** aggregate coverage can pass while mandatory deterministic explanations or failure
  states regress.
- **Required correction:** add exact branch assertions and component/E2E coverage for the missing
  states without weakening thresholds.

## Process and reproducibility deviations

- The reflog for `refs/remotes/origin/master` records `update by push` to
  `e024fc22385f560327a3459d471194da08b0e9a8` at 2026-08-24 07:49:07 -0400 despite the mandate's
  explicit **do not push** instruction. Local evidence does not identify the actor or mechanism.
  Local `master` now contains one additional unpushed evidence-only documentation commit; no further
  push, history rewrite, or remote mutation was performed while producing this record.
- The Dev Container image builds, but its required network-disabled non-root probe fails because
  Corepack attempts registry access for pnpm. A full editor attach remains optional and unexecuted.
- Browser A/C/D tracker failures must be corrected and rerun; they cannot be reclassified as passes
  from static inspection.
- Human validation remains an open external gate; no participant result is claimed.

## Release decision — withheld

- Product-experience automated hard gate: **NOT PASSED**.
- Reserved release label applied: **NO — WITHHELD**.
- Source checkpoint: `e024fc22385f560327a3459d471194da08b0e9a8` and canonical implementation
  manifest `4f8eb8dfe8262e7d9ae158a22a53397e389038a32875b193ae9b5efe3e9dcb8c`.
- Rationale: database, coverage, canonical verification, build, security, registry audit, SBOM,
  local smoke, and cleanup evidence passed. Chrome completed only 1/5 journeys; Journey B exposed a
  real response-contract defect; the independent audit found open High and Medium product and
  accessibility gaps; the offline non-root Dev Container probe failed; and the no-push mandate was
  breached.

The next in-scope task is to correct only these release findings, refreeze the source, and rerun the
complete affected tests, canonical verification, installed-Chrome Journeys A–E, accessibility and
viewport checks, local smoke, and offline non-root Dev Container probe. Do not begin AWS/M19 or add
external providers.
