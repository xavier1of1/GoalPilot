# Testing

## Current local commands

Run repository commands through the committed package-manager declaration:

```bash
corepack pnpm test:unit
corepack pnpm test:integration
corepack pnpm test:coverage
corepack pnpm test:e2e
corepack pnpm test:a11y
corepack pnpm verify
```

`test:integration`, `test:coverage`, `test:e2e`, and `test:a11y` first run `test:prepare`. That
command creates the isolated test database if needed, validates that the destructive target is
exactly `goalpilot_test`, resets it, applies every committed migration in lexical order, and loads
deterministic test/fixture data. These commands do not target `goalpilot_local`; final release
evidence records the exact migration/checksum inventory from that run.

`verify` runs formatting, zero-warning lint, strict type checking, the prepared full Vitest suite
with coverage, production builds, exact database verification, the repository secret scanner,
`pnpm audit --prod --audit-level high`, and CycloneDX 1.5 SBOM generation. It does **not** run
Playwright, production-built release modes, Dev Container probes, or a deployed/cloud check; PX10
release evidence runs those local gates separately.

## Configured coverage gate

The V8 coverage configuration includes application, contract, domain, data-access, simulator, API,
and top-level script source. Its explicit exclusions are `**/*.test.{ts,tsx}`,
`apps/api/src/server.ts`, and `packages/data-access/src/schema.ts`. No product path may be newly
excluded and no threshold may be lowered merely to make a release pass.

Test modules in both TypeScript forms are excluded from source coverage. There is still no
configured web numeric floor. Treat combined/web percentages as diagnostic until a deliberate web
floor is added; neither can substitute for the package floors below or browser behavior evidence.

The configured package floors are exact:

| Source group                  | Lines | Branches | Functions | Statements |
| ----------------------------- | ----: | -------: | --------: | ---------: |
| `apps/api/src/**`             |   85% |     none |       90% |        85% |
| `packages/data-access/src/**` |   85% |     none |       90% |        85% |
| `packages/domain/src/**`      |   90% |      90% |       90% |        90% |

“None” means Vitest has no branch threshold for that group; it is not a claim of branch quality.
The combined report also contains source groups without a configured numeric floor, so the total
percentage is diagnostic rather than a substitute for these package gates and behavior tests.

## Test layers and invariants

Pure/domain tests cover schedules and calendar edges, exact four-vehicle golden vectors,
zero-interest safe-contribution monotonicity and interest independence, cent/half-even posting
rules, fixed-term lot maturity, ranking, plan-health precedence, one-change scenarios, bounded
recovery, Timing statistics/thresholds/seasonality, and deterministic provider validation.

PostgreSQL and Fastify tests cover empty and prior-schema migrations, exact schema/checksum
verification, ownership/composite keys, immutable assumptions/plans/observations/assessments,
append-only ledger/events, exact single reversals and reversal-aware fixed-term balances,
request-hash replay, in-flight command claims, draft concurrency and atomic activation, financial
revision rejection when a contribution races scenario apply, plan history and archive provenance,
early-archive account presentation as archived with actual (not forced 100%) progress,
per-user clocks, owner financial-run active rejection/expiry reclaim/matching-token release, reset
isolation, processing-date ledger revision conflict and pending-date recovery, Autopilot
contribution/interest/maturity behavior, closed product-event storage, all four Timing routine
outcome branches (including a pure replay with no provider call), terminal assessment provenance
when an archive races a delayed provider, run-scoped exact series, same-date distinct keys,
cross-run logical-key consistency, Timing run concurrency/failure/replay, API errors, and the v2
export/deletion boundary.

API contract tests enumerate generated OpenAPI and require an application/json response schema for
every data-bearing 2xx operation (excluding bodyless 204), and an over-wide provider-catalog result
must fail closed without exposing the unexpected field. Timing worker tests define active
`in_progress` behavior with no provider/event call, expired-lease reclaim with a new generation
token, rejection of completion by a non-current token, and third-attempt expiry without an
unbounded fourth attempt. A stale-worker regression defines `in_progress`, no failure count/code,
and no outcome event after failure ownership is lost. The prior-schema migration test defines exact
ten-minute backfill for a claimed run and null worker fields for a terminal run. The strict v2
export contract rejects an injected worker token. An executed final suite, not the presence of
these definitions, is the passing evidence.

Simulator unit coverage exercises reload/recalculation after a repository revision conflict; the
PostgreSQL regression exercises the date-bounded stale/current revisions and proves a future row is
excluded from earlier summary/plan/activity reads while remaining visible as the pending recovery
date. These definitions become passing evidence only when the integration/coverage command actually
completes against the final migration inventory.

The prior-schema migration test proves the deterministic migration-010 context backfill shape. It
cannot prove the original value of context fields that the old schema never stored; in particular,
it is not historical evidence for a non-current version's unposted HYSA remainder.
The same limit applies to migration-011 fallbacks for missing archive provenance and provider
observation keys: the test proves the documented deterministic upgrade result, not an unknowable
original value.

React behavior tests cover builder sequencing and draft resume, blank partial-draft persistence,
server-owned result/rejection detail, field-error association and focus, disabled-feature copy,
What-If validation, history/archive provenance, exact recovery detail, contribution/network failure,
payload-bound retry keys, fresh lifecycle versions and state-appropriate terminal controls, grouped
goal navigation, explicit query-failure-versus-empty/disabled behavior, assessment-target staleness,
server-owned chart composition, export retry idempotency, telemetry failure isolation, and the
landing-page simulation boundary. The reset-dialog test covers initial focus, Tab containment,
Escape/cancel, and trigger-focus restoration. These tests do not individually prove every required
loading, empty, stale-response, conflict, or domain state; component tests also do not replace
end-to-end browser or human evidence.

## Chrome Journeys A–E

Playwright uses one worker, no retries, the isolated database, API port 3100, and web port 5273.
The default project uses pinned Chromium. For the release's stable-Chrome gate on Windows:

```powershell
$env:PLAYWRIGHT_CHANNEL='chrome'
corepack pnpm test:e2e
```

The current journey scope is:

- **A:** create a local profile, open the Japan sample, reveal the server safe baseline, review four
  vehicle models and an ineligibility reason, inspect assumption provenance, activate a Simulated
  Goal Plan, and reconcile displayed balance/plan detail.
- **B:** reset the seeded story, process a contribution, model one missed contribution, apply the
  What-If as v2, apply one bounded recovery as v3, and prove immutable history survives reload.
- **C:** reset, advance six months and then to the target date, prove purchase readiness and current
  availability agree, complete and archive with retained read-only history, and hide mutating
  controls for the archive.
- **D:** run the 731-observation Timing fixture, verify disclosures and chart/table seasonal parity,
  advance the per-user clock one month, create the next assessment, and replay the exact request
  with an identical response and `idempotency-replayed` header.
- **E:** use two browser contexts to prove goal/history/reset/Timing ownership responses, the
  intentional 403 seeded-capability denial for demo advance, an empty owner-filtered Timing
  collection, and content-free browser telemetry payloads.

Journeys A–D are tagged `@a11y`; Journey E is tagged `@security`. Axe and horizontal-overflow
audits run where `auditResponsiveState` is called, at 360, 768, 1024, and 1440 CSS pixels: Journey
A's sign-in, landing, plan-results, and newly activated workspace states; Journey B's active
workspace with immutable history; Journey C's pre-completion purchase-ready and post-archive
workspace states; and Journey D's populated Timing workspace. The seeded-demo sign-in path used by
Journeys B–D and Journey E's API/two-context security flow are not separately Axe/overflow-audited
by this spec. Journey A asserts reduced-motion timing; the Journey B/C reset helper asserts initial
focus, Tab containment, Escape/cancel, and trigger-focus restoration. This automated scope targets
WCAG 2.2 AA but is not a human accessibility certification.

## Performance regression ceilings

The test suite currently enforces these local-process ceilings:

| Measured case                            | Fixture/sample           |  Ceiling |
| ---------------------------------------- | ------------------------ | -------: |
| Stateless `/api/v1/previews` p95         | 20 Fastify injections    |  1,000ms |
| Authenticated `GET /api/v1/goals` p95    | 20 Fastify injections    |  1,000ms |
| One What-If preview                      | local PostgreSQL fixture |  1,000ms |
| Timing assessment                        | 731 observations         |  5,000ms |
| Owner-scoped six-month Autopilot advance | Japan story fixture      | 10,000ms |

These are deterministic regression ceilings on the local test machine, not production latency
SLOs, load tests, cold-start measurements, or cloud capacity evidence. A threshold in source is
not evidence that it passed. Release evidence may quote only the measured output from the exact
successful run; failures and later passing reruns must both be retained when relevant.

## Release-evidence semantics

The PX10 release procedure requires separate execution of setup/doctor, isolated
reset/migrate/seed/verify, coverage, canonical verify, build, stable-Chrome Journeys A–E, scoped
demo reset, product-event summary, price-watch CLI, production-built `local:release` and
`demo:local`, self-terminating `local:smoke`, Dev Container build/runtime probes,
dependency/security checks, and SBOM generation. Documentation must distinguish configured,
executed/passing, failed, and not executed; it must never infer a pass from a test file, an empty
template, an earlier artifact, or a different command.

AWS/CDK assertions, a deployed URL smoke test, Cognito behavior, real provider tests, external
security review, human accessibility review, and user-validation outcomes remain unexecuted future
or human gates unless separate evidence is later produced.
