# Testing

Commands:

```bash
pnpm test:unit
pnpm test:integration
pnpm test:coverage
pnpm test:e2e
pnpm test:a11y
pnpm verify
```

Unit/domain tests cover schedules, leap and month-end boundaries, zero interest, already-funded and
impossible goals, stale assumptions, exact four-vehicle golden vectors, cent-rounded maturity rolls,
half-even ties, posting boundaries, and determinism. Local performance regressions assert both
stateless preview and ordinary authenticated API p95 remain below one second. PostgreSQL/API tests
cover exact migration checksums, bigint money, cross-owner and same-owner relational mismatches,
immutable assumptions, malformed password hashes, local auth, the complete cross-user mutation
matrix, CSRF, goal CRUD, activation, failed and idempotent contributions, completion, safe client
errors, export, and deletion. Autopilot tests cover deposit and maturity interest, early target
crossing, already-funded fixed terms, pause/resume, catch-up, and same-date replay.

Playwright owns `tests/e2e`, uses one worker against the isolated test database, starts API/web on
dedicated ports 3100/5273, and covers the consumer journey. Axe runs on sign-in, plan results,
dashboard, and contribution-dialog states; horizontal-overflow checks run at 360, 768, 1024, and
1440 pixels on the landing page, plan results, and dashboard. It deliberately resets
`goalpilot_test`; it never targets `goalpilot_local`.

The default project uses Playwright's pinned Chromium. If a local browser download is unavailable
but stable Chrome is installed, run `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e` (PowerShell:
`$env:PLAYWRIGHT_CHANNEL='chrome'; pnpm test:e2e`). CI always installs pinned Chromium.

`pnpm verify` runs formatting, lint, strict type checking, all Vitest layers with enforced
API/data/domain coverage thresholds, production builds, exact migration/table/catalog verification,
secret scanning, production dependency audit, and SBOM generation. The M18 release audit
additionally runs Playwright and a developer-database migrate/seed proof.
