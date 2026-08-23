# Local development

## Prerequisites

- Docker Desktop using Linux containers
- Node 24.19.0 through `fnm`, `nvm`, or the Dev Container
- Corepack

Run:

```bash
corepack enable
pnpm run setup
pnpm dev
```

The setup script is repeatable: it installs the frozen lockfile, creates `.env.local` when absent,
starts PostgreSQL, waits for health, migrates, seeds, and runs repository diagnostics.
The package command is cross-platform; `scripts/bootstrap-local.sh` is a thin Dev Container/Unix
entry point to the same implementation.
Inside the Dev Container, local database URLs are automatically routed through
`host.docker.internal`, including a custom `POSTGRES_PORT` from `.env.local`.

pnpm 11 reserves `setup` and `doctor` as built-in commands. Use `pnpm run setup` and
`pnpm run doctor` for GoalPilot’s repository scripts; native `pnpm doctor` remains useful for the
package-manager installation itself.

Default URLs are web `http://localhost:5173`, API `http://localhost:3000`, OpenAPI UI
`http://localhost:3000/docs`, and PostgreSQL `localhost:5432`. Change both `POSTGRES_PORT` and the
URLs in the ignored `.env.local` if 5432 is occupied.

## Data and clocks

`DATABASE_URL` names `goalpilot_local`; `TEST_DATABASE_URL` must name a different
`goalpilot_test`. `pnpm test` creates and resets only the test database. `pnpm db:reset --yes`
destroys the developer database and refuses non-loopback or unexpected database names.

Advance the persisted demonstration clock without changing the operating-system clock:

```bash
pnpm demo:advance --days 30
pnpm demo:advance --to 2026-12-31
```

The command is disabled outside local/test mode and replaying the same `--to` date does not create
new activity.
