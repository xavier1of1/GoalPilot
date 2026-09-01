# GoalPilot technology stack and architecture

**Status:** Current local-first MVP overview  
**Scope:** The active M00-M18 and PX00-PX10 local release. The AWS architecture described in
`STACK.md` is a future adaptation, not a deployed or current dependency.

## What GoalPilot is

GoalPilot is an authenticated, educational savings-planning simulator. A user defines a dated
purchase goal, compares a small set of illustrative interest-bearing vehicle models, activates a
simulated plan, records or simulates contributions, and monitors progress. It does not hold,
move, invest, or connect to real money. Rates and historical-price inputs are deterministic,
versioned fixtures rather than live provider data.

## Current stack

| Area | Technology | Role |
| --- | --- | --- |
| Language and workspace | TypeScript 6, ESM, pnpm workspaces | Shared types and strict boundaries across the monorepo. |
| Web application | React, Vite, Tailwind-based UI primitives | Single-page user experience and typed API client. |
| API | Fastify, Zod | HTTP routes, request validation, response serialization, and generated OpenAPI contracts. |
| Domain | Pure TypeScript, `decimal.js`, `date-fns` | Deterministic calculation, eligibility, schedule, recovery, and price-statistic policies. |
| Data | PostgreSQL 17 and ordered SQL migrations | Owner-scoped application data, immutable plan versions, ledger, audit history, and replay protection. |
| Authentication | Local opaque sessions with salted scrypt password hashes | Secure local registration, login, session lifecycle, CSRF, and Origin protection. |
| Provider integration | Provider ports with deterministic simulation adapters | Keeps the product independent from live financial, rate, clock, and historical-price providers. |
| Quality and security | Vitest, Playwright, Testing Library, axe, ESLint, Prettier, CodeQL, Gitleaks, SBOM | Unit through browser testing, accessibility checks, static analysis, secret scanning, and supply-chain evidence. |

The pinned runtime is Node.js 24.19.0 with pnpm 11.22.0. Direct dependency versions are exact and
the lockfile is committed for reproducible local and CI installs.

## Runtime topology

```text
Browser (React + Vite)
  -> typed API client + shared Zod contracts
  -> Fastify API
  -> application use cases and pure domain policies
  -> owner-scoped repositories and provider ports
  -> PostgreSQL 17 + deterministic local simulators
```

Development runs the web app on `http://localhost:5173`, the API on
`http://localhost:3000`, and PostgreSQL on `localhost:5432`. Production-built local release modes
use loopback-only ports. No AWS service, external financial provider, retailer feed, queue, or
distributed scheduler is part of the current release.

## Monorepo structure and dependency direction

The codebase separates user interface, transport, business rules, persistence, and integrations so
that changing one layer does not rewrite the others.

```text
apps/web
  -> packages/ui -> packages/contracts

apps/api
  -> packages/auth, data-access, provider-ports, provider-simulators,
     contracts, domain, observability

packages/domain -> packages/contracts
packages/provider-simulators -> provider-ports, contracts, domain
packages/data-access -> contracts, domain
```

`packages/domain` is deliberately pure: it cannot import React, Fastify, database code, environment
variables, provider SDKs, AWS SDKs, or AI libraries. Every financial calculation receives normalized
input, a versioned assumption, and an explicit calendar date. The browser renders API results but
does not duplicate financial calculations.

## Data and business integrity

PostgreSQL is the system of record. Key design choices include:

- Composite ownership keys and owner-scoped repository queries prevent cross-user data access.
- Plans, assumptions, and calculation context are immutable and versioned; a plan change creates a
  new version rather than changing history.
- Simulated account activity is recorded in an append-only ledger. Corrections are constrained,
  exact reversals instead of editable history.
- Integer cents, basis points/Decimal arithmetic, UTC timestamps, and explicit calendar dates avoid
  floating-point and implicit-clock errors.
- Unique keys, idempotency records, application-command claims, and schedule-occurrence records
  make retries and simulated scheduled work safe to replay.
- Optimistic versions and short-lived leases protect plan updates and financial-run processing from
  stale or concurrent writes.

The repository also keeps separate audit events, privacy-request workflows, and low-data product
telemetry. Product telemetry is pseudonymous and intentionally separate from customer records.

## Authentication and API boundary

The local `AuthProvider` verifies passwords against salted scrypt hashes. Session and CSRF token
values are random, while PostgreSQL stores only their SHA-256 hashes and expirations. The session
cookie is `HttpOnly`; state-changing operations require both an exact allowed Origin and a matching
CSRF token.

Fastify route schemas are shared with the typed client through Zod contracts. Requests are validated
at the API boundary and successful responses are serialized to their declared shapes, limiting
accidental leakage of persistence or provider fields. Routes return safe error envelopes and use
404 for inaccessible owned resources to avoid revealing another user's data.

## Simulation and provider boundaries

The current provider interfaces cover clocks, authentication, rates, goal accounts, contributions,
interest, and historical prices. Current adapters are local and deterministic:

- static, versioned rate assumptions;
- simulated account, contribution, and interest processing;
- persisted application clocks for controlled story/demo advancement; and
- a fixture-only historical-price provider for the Purchase Timing Lab.

This boundary allows a later, separately approved adapter to be introduced without coupling live
provider behavior to the calculation domain. It does not authorize real account access, money
movement, live rates, personalized financial advice, or provider credentials in the current MVP.

## Key product flows

1. A user creates a partial goal draft and activates it only after complete contract validation.
2. Activation creates the goal, immutable plan version, simulated account, opening ledger activity,
   audit event, and idempotency response in one transaction.
3. Manual or simulated scheduled contributions and illustrative interest update the simulated ledger.
4. A What-If preview is stateless; applying it rechecks the authoritative plan and account revision
   in a transaction, rejecting stale previews rather than persisting them.
5. The Purchase Timing Lab uses an allowlisted synthetic item and committed historical fixture,
   records the exact observed series and assessment, and does not modify the financial plan.

## Operations and validation

The project is designed to run locally and be verifiable end to end. Typical checks include:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:a11y
pnpm verify
```

`pnpm verify` combines formatting, linting, strict type checking, coverage, production builds,
database verification, security scanning, production dependency audit, and SBOM generation. Browser
tests exercise the local web/API experience, while API integration tests use Fastify injection and
PostgreSQL-backed state.

## Future adaptation, clearly separated

The architecture intentionally preserves a path to a future cloud deployment, potentially using
CloudFront/S3, API Gateway/Lambda, Cognito, hosted PostgreSQL, EventBridge, CDK, and GitHub OIDC.
Those services are planning material for M19-M22 only. They are not installed, synthesized,
deployed, or required for the current local release; any future adapter must preserve the existing
contracts, deterministic domain rules, ownership controls, and provider boundaries.

## Related documentation

- [Product requirements](PRD.md) - product scope, user experience, and non-goals.
- [Architecture](ARCHITECTURE.md) - detailed persistence, concurrency, provider, and privacy design.
- [Technology stack](STACK.md) - exact versions, rationale, testing, and future-cloud planning.
- [Current ERD](architecture/ERD.md) - database entities and relationships.
- [Coding conventions](CONVENTIONS.md) - dependency rules and implementation standards.
