# Local development

## Prerequisites

- Docker Desktop using Linux containers
- Node 24.19.0 through `fnm`, `nvm`, or the Dev Container
- Corepack

Run:

```bash
corepack enable
corepack pnpm run setup
corepack pnpm dev
```

The setup script is repeatable: it installs the frozen lockfile, creates `.env.local` when absent,
starts PostgreSQL, waits for health, migrates, seeds, and runs repository diagnostics.
The package command is cross-platform; `scripts/bootstrap-local.sh` is a thin Dev Container/Unix
entry point to the same implementation.
Inside the Dev Container, local database URLs are automatically routed through
`host.docker.internal`, including a custom `POSTGRES_PORT` from `.env.local`.

pnpm 11 reserves `setup` and `doctor` as built-in commands. Use `corepack pnpm run setup` and
`corepack pnpm run doctor` for GoalPilot’s repository scripts; native `pnpm doctor` remains useful for the
package-manager installation itself.

Default URLs are web `http://localhost:5173`, API `http://localhost:3000`, OpenAPI UI
`http://localhost:3000/docs`, and PostgreSQL `localhost:5432`. Change both `POSTGRES_PORT` and the
URLs in the ignored `.env.local` if 5432 is occupied.

## Data and clocks

`DATABASE_URL` names `goalpilot_local`; `TEST_DATABASE_URL` must name a different
`goalpilot_test`. `corepack pnpm test` creates and resets only the test database. `corepack pnpm db:reset --yes`
destroys the developer database and refuses non-loopback or unexpected database names.

Advance the persisted demonstration clock without changing the operating-system clock:

```bash
corepack pnpm demo:advance --days 30
corepack pnpm demo:advance --to 2026-12-31
```

The command is disabled outside local/test mode and replaying the same `--to` date does not create
new activity.

## PX release-mode targets

The product phase will add these commands; do not treat them as available or verified until their
scripts and PX10 evidence exist:

```bash
corepack pnpm demo:reset
corepack pnpm product-events:summary
corepack pnpm price-watch:run
corepack pnpm local:release
corepack pnpm demo:local
corepack pnpm local:smoke
```

`local:release` serves production-built web/API artifacts on dedicated documented loopback ports,
uses local PostgreSQL, disables demo reset/clock controls, and honors the default-off Timing Lab
flag. `demo:local` uses production artifacts where practical, seeded fixture data, per-user story
time, scoped reset, and Timing Lab disclosures. `local:smoke` starts only what it owns, verifies web,
live/ready, anonymous auth rejection, mode capabilities, baseline/scenario/price operations, and no
AWS dependency, then terminates cleanly and checks that no unexpected listener remains.

Consumer demo controls must never call the existing arbitrary `demo:advance` maintenance command.
They resolve only permitted milestones through an authenticated owner-scoped use case. See the
[demo runbook](DEMO_RUNBOOK.md).
