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

## PX00–PX10 additions

All documented package commands use `corepack pnpm`. New product code remains inside coverage; no
exclusion or lowered threshold is permitted to protect a percentage. The product gate adds:

- safe-contribution monotonicity/interest-independence and ranking/health precedence truth tables;
- stateless one-change scenarios, immutable apply, concurrent conflict, and recovery no-risk
  invariants;
- draft optimistic concurrency, activation atomicity, lifecycle grouping, and cross-owner 404s;
- per-user Autopilot clock/reset isolation, every milestone/replay/failure explanation, and
  six-month measured performance;
- product-event allowlist/prohibited-field/append-only/privacy tests;
- price statistics, exact threshold edges, minimum history, staleness, seasonal minimum, provider
  validation, observation/assessment immutability, due-run concurrency, feature-off, ownership, and
  readiness-gate tests;
- focused React tests for every required state, accessible focus/errors, chart/table parity,
  keyboard/reduced-motion behavior, and current-versus-projected wording;
- Chrome Journeys A–E with Axe and overflow at 360, 768, 1024, and 1440 pixels.

PX10 executes setup, doctor, isolated reset/migrate/seed/verify, coverage, canonical verify, build,
E2E, demo reset, product-event summary, price-watch run, both production-built local modes, and the
self-terminating smoke sequence. Performance thresholds are chosen only after measuring the full
fixture. Failures and later passing reruns are both recorded; unexecuted checks are never claimed.
