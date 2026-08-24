# Implementation status

## Initial audit — 2026-08-23

- Existing: five approved planning documents under `docs/` and an empty Git repository.
- Working product code, tests, runtime, manifest, lockfile, migrations, containers, and workflows:
  none at audit time.
- Local-first conflict: AWS/Cognito work preceded the complete local product. `TASKS.md` and ADR
  0001 now put all AWS work behind the local hard gate.
- Initial highest-priority task: establish the pinned monorepo, Dev Container, local PostgreSQL,
  and compatibility proof, then build vertically in dependency order.

## Current milestone — M18 complete

M00 through M18 and the local hard gate passed on 2026-08-23. M19 through M22 remain future,
unauthorized AWS work. This is a verified local educational simulator, not a production financial
service.

The host has an unrelated PostgreSQL process on 5432, so the ignored workstation `.env.local`
uses port 55432. The committed clean-checkout default remains `localhost:5432`.

## Exact release evidence

| Command                                                                                   | Result                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm run setup` (run twice)                                                              | PASS; frozen install, Docker PostgreSQL, migrations, deterministic seed, and diagnostics all repeated safely  |
| `pnpm run doctor`                                                                         | PASS; Node 24.19.0, pnpm 11.22.0, Docker, environment, and database                                           |
| `docker build --file .devcontainer/Dockerfile --tag goalpilot-devcontainer-check:local .` | PASS                                                                                                          |
| Dev Container runtime probe                                                               | PASS; Node 24.19.0, pnpm 11.22.0, Git 2.39.5, PostgreSQL client 15.19                                         |
| `pnpm dev` plus HTTP probes                                                               | PASS; web 200, live/ready both healthy, API docs 200                                                          |
| non-destructive developer migrate twice, seed, verify                                     | PASS; 4 checksum-verified migrations, 15 public tables, and 4 reviewed assumptions                            |
| `pnpm demo:advance --days 30` then same-date replay                                       | PASS; 2026-08-23 to 2026-09-22, no failures, replay produced no work                                          |
| `pnpm verify`                                                                             | PASS; format, lint, types, 64 tests with coverage gates, builds, DB verification, scans/audit, CycloneDX SBOM |
| coverage inside `pnpm verify`                                                             | PASS; API 91.37%, data 94.58%, domain 95.94% lines; domain branches 86.60%                                    |
| `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`                                                 | PASS; 2/2 journeys; principal states checked with Axe and 360/768/1024/1440 overflow checks                   |

Production bundles built successfully: web JavaScript 409.27 kB (124.47 kB gzip), web CSS 21.58
kB (5.88 kB gzip), and compiled Fastify/package outputs. The production dependency audit reported
no known vulnerabilities. The SBOM is generated at ignored path `artifacts/sbom.cdx.json`.

## Review resolution

Independent architecture, financial, backend/database/security, and frontend/accessibility reviews
were completed. Actionable findings were resolved, including:

- anchored month-end schedules, contribution caps, cent-rounded fixed-term rollovers, maturity-only
  interest, pause behavior, and deterministic application-clock dates;
- request-hashed idempotency, PATCH parsing, safe Fastify 400/413/429 envelopes, active-plan edit
  restrictions, and test-database isolation;
- composite ownership constraints, immutable plan/assumption versions, append-only ledger tests,
  account-opening zero balance, purchase-ready transitions, and simulated purchase withdrawal;
- wired simulator ports, session idle refresh, loopback-only local configuration, export/deletion
  regressions, loading/network/error states, stale-preview invalidation, mobile navigation, focus,
  contrast, and chart alternatives;
- real Playwright/Axe journeys, local p95 performance assertions, repeatable setup/recovery, and CI
  pnpm initialization;
- strict stored-hash parsing, safe unexpected-error logging, normalized destructive database
  guards, complete relational provenance constraints, exact catalog verification, and coverage in
  the canonical release gate;
- fixed-term opening locks, policy-correct interest posting, exact four-vehicle vectors, dedicated
  E2E ports, accessible contribution failures, header contrast, and 360-pixel dashboard layout.

## Known boundaries and blockers

- No real money movement, provider credentials, bank connection, live rate feed, AWS resource, or
  production authentication adapter exists. This is intentional MVP policy.
- The MVP allows one running simulated goal per user; archived history remains available.
- Illustrative rates are a static versioned catalog and are not offers.
- The local Playwright browser download stalled on this workstation, so the release run used the
  installed stable Chrome channel. CI retains pinned Playwright Chromium installation.
- The host's unrelated global `%APPDATA%\npm\pnpm.ps1` is malformed. Verified host commands used
  the repository-pinned `corepack pnpm`; the Dev Container's pnpm installation is healthy.
- The Docker Dev Container image and runtime toolchain were executed successfully. A full VS Code
  Dev Container editor attach/open was not executed because the Dev Container CLI is unavailable
  on this workstation.
- Genuine code blockers: none for the audited local MVP. M19+ requires explicit authorization and
  remains outside this session.

## Next task

Preserve the hard gate. Continue with evidence-driven local product iteration—goal editing and plan
history, richer Autopilot controls, dashboard insights, additional component tests, and user
research—before considering M19. AWS architecture adaptation begins only after explicit separate
authorization.
