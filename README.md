# GoalPilot

GoalPilot is a local-first educational savings simulator. It starts with a zero-interest safe
contribution, compares versioned illustrative cash, high-yield savings, CD-ladder, and
Treasury-bill-ladder models, and lets an authenticated local user operate an auditable **Simulated
Goal Plan**.

PX00–PX10 are implemented, but the final frozen-tree automated release gate is **pending**. The
reserved local product-experience release label is withheld until the current tree, its exact source
checkpoint, and every required command result are recorded in the release evidence. Human validation
remains open, AWS M19–M22 is not implemented or authorized, and this is not a production financial
service.

> Educational simulation using illustrative assumptions. GoalPilot does not hold, transfer, or
> invest money. Rates, price fixtures, and modeled outcomes are not live offers or guarantees.

## Product experience

- Build and resume a goal progressively; see the contribution-only baseline before choosing a budget.
- Compare four deterministic local models with explicit eligibility, access, maturity, and rationale.
- Activate a Simulated Goal Plan, inspect health, preview one bounded What-If change, and retain
  immutable plan history.
- Run the owner-scoped Japan Story Demo through permitted Autopilot milestones and fixture reset.
- Inspect privacy-safe aggregate product events without storing entered financial content.
- Optionally use the feature-flagged Purchase Timing Lab for historical fixture context, separate
  from plan readiness and without price prediction.

## Prerequisites

- Docker Desktop with the Linux engine running
- VS Code with Dev Containers (recommended), or Node `24.19.0` and Corepack
- Git

## One-command setup

```bash
corepack pnpm run setup
corepack pnpm dev
```

Setup creates `.env.local` if missing, starts PostgreSQL, waits for readiness, applies all 17
migrations, loads deterministic local users and reviewed fixtures, and runs diagnostics. It is safe
to run repeatedly on Windows, macOS, Linux, and inside the Dev Container. Unix environments may
also call `scripts/bootstrap-local.sh`, which delegates to the same cross-platform bootstrap.

Open:

- Web: <http://localhost:5173>
- API: <http://localhost:3000>
- API docs: <http://localhost:3000/docs>
- Database: `localhost:5432/goalpilot_local`

If another local service owns port 5432, set `POSTGRES_PORT` and the matching port in
`DATABASE_URL` inside the ignored `.env.local`; the committed default remains 5432.

Local fixture users include `alex@example.test` / `GoalPilot-Alex-2026!`,
`sam@example.test` / `GoalPilot-Sam-2026!`, and the Japan Story Demo credential presented by the
sign-in UI. They are synthetic local fixtures only.

## Commands

```bash
corepack pnpm run doctor
corepack pnpm verify
PLAYWRIGHT_CHANNEL=chrome corepack pnpm test:e2e
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm db:reset -- --yes
corepack pnpm demo:reset
corepack pnpm product-events:summary
corepack pnpm price-watch:run
corepack pnpm local:release
corepack pnpm demo:local
corepack pnpm local:smoke
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

pnpm 11 reserves `setup` and `doctor` as native command names, so GoalPilot's scripts require the
explicit `corepack pnpm run setup` and `corepack pnpm run doctor` forms.

The audited Windows host has an unrelated malformed global `%APPDATA%\npm\pnpm.ps1`; using Corepack
selects the repository-pinned pnpm 11.22.0. The Dev Container has a healthy pinned pnpm shim.

`db:reset` is destructive only to a URL that resolves to loopback and names exactly
`goalpilot_local` (or exactly `goalpilot_test` in test mode). It refuses all other targets and proves
that development and test database identities differ. Always include the explicit confirmation:
`corepack pnpm db:reset -- --yes`.

Playwright uses dedicated test ports 3100/5273, so E2E can run beside the normal 3000/5173
development servers. `local:release`, `demo:local`, and `local:smoke` bind loopback only and terminate
their owned processes cleanly; see the runbook for their mode differences.

## Evidence and documentation

The final release record is intentionally pending while the corrected frozen tree is reverified. It
must identify the exact source checkpoint and record current database, test/coverage,
installed-Chrome Journeys A–E, security/audit/SBOM, local/demo smoke, and Dev Container results before
the reserved label is applied. Earlier dated results are historical only; they do not verify the
current tree or claim a full editor attach or human validation.

See [local product release evidence](docs/LOCAL_PRODUCT_RELEASE.md),
[implementation status](docs/IMPLEMENTATION_STATUS.md),
[product-experience specification](docs/PRODUCT_EXPERIENCE_SPEC.md),
[Purchase Timing Lab policy](docs/PURCHASE_TIMING_LAB.md),
[local development](docs/LOCAL_DEVELOPMENT.md), [demo runbook](docs/DEMO_RUNBOOK.md),
[architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md),
[testing](docs/TESTING.md), and [execution plan](docs/TASKS.md).
