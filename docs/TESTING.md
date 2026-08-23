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
impossible goals, stale assumptions, four vehicles, fixed-term posting, exact rounding, and
determinism. Local performance regressions assert both stateless preview and ordinary authenticated
API p95 remain below one second. PostgreSQL/API tests cover ordered empty migrations, bigint money,
composite ownership,
immutable assumptions, local auth, cross-user denial, CSRF, goal CRUD, activation, failed and
idempotent contributions, completion, safe client errors, export, and deletion. Autopilot tests cover
deposit interest, maturity interest, pause/resume, catch-up, and same-date replay.

Playwright owns `tests/e2e`, uses one worker against the isolated test database, starts API/web
itself, and covers the consumer journey plus Axe and 360-pixel overflow. It deliberately resets
`goalpilot_test`; it never targets `goalpilot_local`.

The default project uses Playwright's pinned Chromium. If a local browser download is unavailable
but stable Chrome is installed, run `PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e` (PowerShell:
`$env:PLAYWRIGHT_CHANNEL='chrome'; pnpm test:e2e`). CI always installs pinned Chromium.

`pnpm verify` runs formatting, lint, strict type checking, all Vitest layers, production builds,
migration verification, secret scanning, production dependency audit, and SBOM generation. The M18
release audit additionally runs Playwright and a developer-database reset/migrate/seed proof.
