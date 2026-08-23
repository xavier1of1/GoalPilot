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

| Command                                                                                   | Result                                                                                                                     |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run setup` (run twice)                                                              | PASS; frozen install, Docker PostgreSQL, migrations, deterministic seed, and diagnostics all repeated safely               |
| `pnpm run doctor`                                                                         | PASS; Node 24.19.0, pnpm 11.22.0, Docker, environment, and database                                                        |
| `docker build --file .devcontainer/Dockerfile --tag goalpilot-devcontainer-check:local .` | PASS                                                                                                                       |
| Dev Container runtime probe                                                               | PASS; Node 24.19.0, pnpm 11.22.0, Git 2.39.5, PostgreSQL client 15.19                                                      |
| `pnpm dev` plus HTTP probes                                                               | PASS; web 200, live/ready both healthy, API docs 200                                                                       |
| `pnpm db:reset --yes` then migrate twice, seed, verify                                    | PASS; 3 ordered migrations and 15 public tables                                                                            |
| `pnpm demo:advance --days 30` then same-date replay                                       | PASS; 2026-08-23 to 2026-09-22, no failures, replay produced no work                                                       |
| `pnpm verify`                                                                             | PASS; format, zero-warning lint, strict types, 47 tests, builds, migrations, secret scan, production audit, CycloneDX SBOM |
| `pnpm test:coverage`                                                                      | PASS; API 88.85%, data 94.11%, and domain 95.33% line coverage; domain branches 85.84%                                     |
| `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`                                                 | PASS; 2/2 journeys, 360/768/1024/1440 widths, no Axe violations                                                            |

Production bundles built successfully: web JavaScript 408.53 kB (124.30 kB gzip), web CSS 21.45
kB (5.85 kB gzip), and compiled Fastify/package outputs. The production dependency audit reported
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
  pnpm initialization.

## Known boundaries and blockers

- No real money movement, provider credentials, bank connection, live rate feed, AWS resource, or
  production authentication adapter exists. This is intentional MVP policy.
- The MVP allows one running simulated goal per user; archived history remains available.
- Illustrative rates are a static versioned catalog and are not offers.
- The local Playwright browser download stalled on this workstation, so the release run used the
  installed stable Chrome channel. CI retains pinned Playwright Chromium installation.
- Genuine blockers: none for the local MVP. M19+ requires explicit authorization and is outside
  this session.

## Next task

No required local milestone remains. Preserve the hard gate and begin M19 architecture adaptation
only after explicit authorization; broader UX research and additional component-level tests are
optional local follow-up, not release blockers.
