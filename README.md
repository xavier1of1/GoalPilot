# GoalPilot

GoalPilot is a local-first educational savings simulator. It compares a zero-interest baseline with
versioned illustrative cash, high-yield savings, CD-ladder, and Treasury-bill-ladder models, then
lets an authenticated local user operate an auditable simulated Goal Account.

> Educational simulation using illustrative assumptions. GoalPilot does not hold, transfer, or
> invest money. Rates and outcomes are not guaranteed.

## Prerequisites

- Docker Desktop with the Linux engine running
- VS Code with Dev Containers (recommended), or Node `24.19.0` and Corepack
- Git

## One-command setup

```bash
pnpm run setup
pnpm dev
```

Setup creates `.env.local` if missing, starts PostgreSQL, waits for readiness, applies migrations,
loads two deterministic local users plus illustrative assumptions, and runs diagnostics. It is safe
to run repeatedly on Windows, macOS, Linux, and inside the Dev Container. Unix environments may
also call `scripts/bootstrap-local.sh`, which delegates to the same cross-platform bootstrap.

Open:

- Web: <http://localhost:5173>
- API: <http://localhost:3000>
- API docs: <http://localhost:3000/docs>
- Database: `localhost:5432/goalpilot_local`

If another local service already owns port 5432, set `POSTGRES_PORT` and the matching port in
`DATABASE_URL` inside the ignored `.env.local`; the committed default remains 5432.

Local demo users are `alex@example.test` / `GoalPilot-Alex-2026!` and
`sam@example.test` / `GoalPilot-Sam-2026!`. These are synthetic development fixtures only.

## Commands

```bash
pnpm run doctor
pnpm verify
pnpm test
pnpm test:e2e
pnpm db:migrate
pnpm db:seed
pnpm db:reset
pnpm demo:advance --days 30
pnpm lint
pnpm typecheck
pnpm build
```

pnpm 11 reserves `setup` and `doctor` as native command names, so the GoalPilot bootstrap and
environment diagnostics use the explicit `pnpm run …` form.

`pnpm db:reset` destroys and recreates only a database whose URL resolves to localhost and whose
name contains `goalpilot_local` or `goalpilot_test`. It refuses all other targets.

See [local development](docs/LOCAL_DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md),
[security](docs/SECURITY.md), and [testing](docs/TESTING.md).
