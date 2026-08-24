# Local development

## Prerequisites

- Docker Desktop using Linux containers
- Node 24.19.0 through `fnm`, `nvm`, or the Dev Container
- Corepack and Git

Run:

```bash
corepack enable
corepack pnpm run setup
corepack pnpm run doctor
corepack pnpm dev
```

The setup script is repeatable: it installs the frozen lockfile, creates `.env.local` when absent,
starts PostgreSQL, waits for health, applies all 17 ordered migrations, seeds deterministic local
fixtures, and runs repository diagnostics. The package command is cross-platform;
`scripts/bootstrap-local.sh` is a thin Dev Container/Unix entry point to the same implementation.
Inside the Dev Container, local database URLs route through `host.docker.internal`, including a
custom `POSTGRES_PORT` from `.env.local`.

pnpm 11 reserves `setup` and `doctor` as native command names. Use `corepack pnpm run setup` and
`corepack pnpm run doctor` for GoalPilot's repository scripts. On the audited Windows host the
unrelated global `pnpm.ps1` is malformed, so Corepack is also the reliable way to select pinned pnpm
11.22.0.

Default development URLs are web `http://localhost:5173`, API `http://localhost:3000`, OpenAPI UI
`http://localhost:3000/docs`, and PostgreSQL `localhost:5432`. Change both `POSTGRES_PORT` and the
URLs in the ignored `.env.local` if 5432 is occupied.

## Data and clocks

`DATABASE_URL` must name `goalpilot_local`; `TEST_DATABASE_URL` must identify a different exact
`goalpilot_test` database. Test preparation creates/resets only the isolated test target.

The developer reset is deliberately explicit and destructive to the accepted local database:

```bash
corepack pnpm db:reset -- --yes
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm db:verify
```

The reset refuses a non-loopback host, an unexpected database name, or a development/test identity
collision. Do not use it as ordinary demo recovery; use the scoped fixture reset below.

The maintenance-only clock command advances persisted local simulation time without changing the
operating-system clock:

```bash
corepack pnpm demo:advance --days 30
corepack pnpm demo:advance --to 2026-12-31
```

It is disabled outside local/test use and is not exposed to consumer UI. Replaying the same `--to`
date creates no duplicate activity. Story-Mode Autopilot uses a separate authenticated,
owner-scoped use case with only the permitted milestones.

## Product commands

```bash
corepack pnpm demo:reset
corepack pnpm product-events:summary
corepack pnpm price-watch:run
corepack pnpm local:release
corepack pnpm demo:local
corepack pnpm local:smoke
```

- `demo:reset` restores only explicitly marked seeded fixture users. It refuses an unsafe target or
  mode and preserves non-fixture records.
- `product-events:summary` prints aggregate allowlisted event counts only—never amounts, entered
  names/notes, email addresses, URLs, account/session identifiers, or arbitrary metadata.
- `price-watch:run` uses deterministic in-repository price fixtures and the shared due-check use
  case. It performs no outbound request or scrape and is replay-safe for the same policy/date/source.
- `local:release` serves production-built web/API artifacts on loopback ports 5373/3200, uses local
  PostgreSQL, and forces Story Demo mutation and Purchase Timing Lab off.
- `demo:local` uses the same production-built boundary and ports with seeded Story Demo and Timing
  Lab fixtures enabled. It still has no live provider or AWS dependency.
- `local:smoke` owns temporary production-built demo processes, proves web, liveness/readiness,
  anonymous auth denial, demo capability, plan/What-If operations, and a fixture price assessment,
  then terminates the processes and proves both ports closed.

These commands are part of the final release procedure, but their results for the corrected frozen
tree are pending. Record the demo smoke, local-mode probe, feature-flag state, price assessment, and
closed-port checks in `LOCAL_PRODUCT_RELEASE.md` only after executing them.

## Verification

```bash
corepack pnpm verify
PLAYWRIGHT_CHANNEL=chrome corepack pnpm test:e2e
```

`verify` is the canonical static/unit/integration release gate: formatting, lint, typecheck, the
current coverage run, production builds, exact database verification, the repository security scan,
production dependency audit, and CycloneDX SBOM generation. E2E prepares only the test database and
uses dedicated ports 3100/5273, so normal development ports may remain occupied. The final release
must use the installed Chrome channel and record the current Journeys A–E result; no previous run is
evidence for the corrected frozen tree.

## Reproducibility boundary

Before release, rerun setup twice, doctor, explicit developer reset/migrate/seed/verify, clean test
replay, and the current migration-upgrade path through migration 017. Also record the Dev Container
image build and non-root Node/pnpm/workspace runtime probe. A full VS Code editor attach is a separate
claim and must remain unclaimed unless it is actually executed.

See [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) for the customer story and
[LOCAL_PRODUCT_RELEASE.md](LOCAL_PRODUCT_RELEASE.md) for exact release evidence and limitations.
