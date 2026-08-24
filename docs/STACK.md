# GoalPilot MVP Technology Stack

**Status:** Approved stack baseline for Codex<br>
**Version:** 1.0<br>
**Pinned on:** 2026-08-23<br>
**Decision goal:** Lowest practical MVP cost while preserving security, full-stack depth,
PostgreSQL portability, and clean paths to future AWS and financial-provider integrations.

> **Current authority:** M00–M18 and PX00–PX10 are the active local release. Every AWS service and
> package in this document remains future M19–M22 work unless a section explicitly says current.

## 1. Architecture decision

GoalPilot currently uses a TypeScript monorepo containing a React single-page application, a
Fastify modular API, a pure calculation domain, PostgreSQL persistence, and provider ports with
deterministic simulation adapters. AWS serverless hosting is a future M19–M22 adaptation and is not
installed, synthesized, or deployed in the local release.

### 1.1 Current local-first release topology

The local MVP is the only active release target. It runs without AWS credentials or services:

```text
Browser at http://localhost:5173
  -> React + Vite
  -> Fastify at http://localhost:3000
  -> PostgreSQL 17 at localhost:5432
```

Production-built local release commands use dedicated loopback ports:

```text
local:release or demo:local
  -> web preview at http://127.0.0.1:5373
  -> Fastify at http://127.0.0.1:3200
  -> goalpilot_local on loopback PostgreSQL
```

`local:release` forces both demo and Timing capabilities off. `demo:local` forces both on, restores
only the marked Japan fixture, and still uses simulated/local adapters. Neither mode accepts an
AWS dependency or non-loopback listener.

Local authentication uses opaque, hashed, server-side sessions behind `AuthProvider`. Financial
activity is implemented only by deterministic simulation adapters. `AUTH_MODE=local` and
`FINANCIAL_PROVIDER_MODE=simulated` are rejected when `ENVIRONMENT` is not `local` or `test`.
The AWS topology below is a future adaptation and is not built or deployed before the local release
gate in `TASKS.md` passes.

```text
Browser
  → CloudFront
     → private S3 origin for React assets
     → /api and /auth to API Gateway HTTP API
        → Lambda running Fastify
           → Neon PostgreSQL
           → Cognito OAuth endpoints
           → scheduled simulation handler
```

Future M19–M22 scheduled demo activity:

```text
EventBridge Scheduler
  → simulation Lambda handler
     → PostgreSQL ledger and schedule records
```

This replaces the earlier fixed-cost beta topology of ECS Fargate, an Application Load Balancer, NAT Gateway, WAF, and RDS. Fastify remains transport-portable so the API can move to ECS later without rewriting routes or domain code.

## 2. Future M19–M22 cost posture

The table in this section is planning material for a separately approved cloud adaptation. It is
not a list of current services, a quote, or evidence of an AWS account/deployment.

### Target at MVP volume

| Item                                    |                                 MVP target | Notes                                                                                |
| --------------------------------------- | -----------------------------------------: | ------------------------------------------------------------------------------------ |
| React hosting through S3 and CloudFront |                                $0–$2/month | Usually within low-traffic/free allowances; usage dependent.                         |
| API Gateway HTTP API and Lambda         |                                $0–$2/month | Scales to zero; usage and free-tier status vary by account.                          |
| Cognito                                 |                    $0 at small test volume | Confirm current MAU pricing before public release.                                   |
| EventBridge Scheduler                   |                           Approximately $0 | One low-frequency schedule.                                                          |
| CloudWatch                              |                                $0–$2/month | Structured, low-volume logs with short retention.                                    |
| SSM Parameter Store standard parameters |                                  $0 target | Avoid Secrets Manager's per-secret fixed charge for MVP.                             |
| Neon PostgreSQL                         |                                  $0 target | Free plan; storage, compute, sleep, backup, and connection limits must be monitored. |
| GitHub Actions                          |                                  $0 target | Private-repository allowances depend on the account plan.                            |
| Domain                                  | Optional, roughly annual registration cost | CloudFront URL works before a domain is purchased.                                   |
| **Expected tiny-MVP infrastructure**    |  **Approximately $0–$6/month plus domain** | A target, not a guarantee. Set AWS budgets before deployment.                        |

Cost can increase because of traffic, logs, database usage, free-tier expiration, custom domains, build minutes, data transfer, or provider-plan changes. Codex must not describe the MVP as permanently free.

## 3. Runtime and package management

| Tool           |             Exact baseline | Decision                                                                         |
| -------------- | -------------------------: | -------------------------------------------------------------------------------- |
| Node.js        |              `24.19.0` LTS | Current local/CI/Dev Container runtime; revalidate for future Lambda.            |
| pnpm           |                  `11.22.0` | Workspace management and deterministic lockfile.                                 |
| TypeScript     |                    `6.0.3` | Chosen instead of the newer TypeScript 7 line for broader tooling compatibility. |
| Module format  |                        ESM | `"type": "module"` in all packages.                                              |
| Package policy |      Exact direct versions | Do not use `^`, `~`, `latest`, or wildcard versions.                             |
| Lockfile       | `pnpm-lock.yaml` committed | CI uses `pnpm install --frozen-lockfile`.                                        |

The committed manifests/lockfile are authoritative for current installed versions. Compatibility
evidence type-checks and builds the workspace web/API/packages. There is no current infra package;
future M19 dependencies require a fresh compatibility spike and a recorded stack update.

## 4. Repository structure

```text
goalpilot/
├── docs/
│   ├── PRD.md
│   ├── STACK.md
│   ├── CONVENTIONS.md
│   ├── TASKS.md
│   └── architecture/
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docker-compose.local.yml
├── .devcontainer/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── contracts/
│   ├── domain/
│   ├── data-access/
│   ├── auth/
│   ├── observability/
│   ├── provider-ports/
│   ├── provider-simulators/
│   ├── test-support/
│   └── ui/
├── tests/
│   ├── e2e/
│   └── *.test.ts
├── scripts/
└── .github/
    └── workflows/
```

There is no current `infra/cdk` package. It may be added only after the M19 hard gate.

### 4.1 Current setup and Dev Container contract

`corepack pnpm run setup` first enforces Node 24.19.0 and pnpm 11.22.0, verifies Docker, performs a
frozen install, copies `.env.example` to ignored `.env.local` only when missing, starts the
digest-pinned PostgreSQL service, applies migrations/seeds, and runs `doctor`. It does not contact
AWS.

The Dev Container bind-mounts the workspace, uses isolated volume-backed `node_modules` and pnpm
store paths, enables Docker-outside-of-Docker, sets `GOALPILOT_DEVCONTAINER=true`, performs a frozen
post-create install, and forwards development ports 3000/5173 plus release ports 3200/5373. Inside
that explicit container mode, loopback database URLs are translated to
`host.docker.internal`; this bridge is not accepted as a general remote host.

## 5. Frontend stack

### 5.1 Core

| Package                 | Exact version | Purpose                                 |
| ----------------------- | ------------: | --------------------------------------- |
| `react`                 |      `19.2.8` | UI runtime.                             |
| `react-dom`             |      `19.2.8` | DOM renderer.                           |
| `vite`                  |       `8.2.1` | Development and production build.       |
| `@vitejs/plugin-react`  |       `6.1.0` | React Fast Refresh and JSX integration. |
| `react-router`          |       `8.3.0` | Client routing.                         |
| `@tanstack/react-query` |     `5.101.4` | Server-state cache and mutations.       |
| `react-hook-form`       |      `7.85.0` | Accessible, performant form state.      |
| `@hookform/resolvers`   |       `5.9.1` | Zod form integration.                   |
| `zod`                   |       `4.4.3` | Shared runtime schemas.                 |

### 5.2 Design system and visualization

| Package/resource           | Exact version | Use                                                                                              |
| -------------------------- | ------------: | ------------------------------------------------------------------------------------------------ |
| `tailwindcss`              |       `4.3.3` | Design tokens and utility styling.                                                               |
| `@tailwindcss/vite`        |       `4.3.3` | Tailwind Vite integration.                                                                       |
| `shadcn` CLI               |      `4.19.0` | Approved one-time generator if needed; not a current direct dependency.                          |
| `class-variance-authority` |       `0.7.1` | Component variants.                                                                              |
| `clsx`                     |       `2.1.1` | Conditional class names.                                                                         |
| `tailwind-merge`           |       `3.6.0` | Resolve Tailwind class conflicts.                                                                |
| `lucide-react`             |      `1.33.0` | Open-source icons.                                                                               |
| `recharts`                 |      `3.10.1` | Approved for future complex charts; the local MVP uses semantic CSS bars with text alternatives. |
| `motion`                   |      `13.1.1` | Installed approved option; current source does not import it.                                    |
| `date-fns`                 |       `4.1.0` | Calendar calculations and presentation; domain date rules remain separately tested.              |

Use only the shadcn/ui components needed for the MVP: button, card, input, label, select, radio group, checkbox, dialog, alert dialog, tooltip, progress, tabs, table, skeleton, toast, dropdown menu, sheet, and form helpers. Do not install a second component system.

### 5.3 Free design resources

These are permitted references or dependencies:

- shadcn/ui component source;
- Radix primitives installed by selected shadcn components;
- Lucide icons;
- Tailwind CSS;
- Recharts;
- Motion's free MIT-licensed APIs;
- Figma Community wireframes and finance-dashboard examples for inspiration only;
- Google Fonts or system fonts only when licensing and performance are documented.

Do not paste an entire community template into the product. Build a GoalPilot-specific system with:

- British racing green primary;
- warm ivory surfaces;
- muted gold accent;
- charcoal body text;
- AA contrast;
- responsive components;
- reduced-motion support.

## 6. Backend stack

Current installed backend/runtime packages are:

| Package                     | Exact version | Current purpose                                                    |
| --------------------------- | ------------: | ------------------------------------------------------------------ |
| `fastify`                   |      `5.11.3` | Local HTTP application framework.                                  |
| `@fastify/cookie`           |      `11.1.2` | Opaque session and CSRF cookies.                                   |
| `@fastify/cors`             |      `11.3.0` | Exact local web-origin allowlist.                                  |
| `@fastify/helmet`           |      `13.1.1` | Security response headers/CSP.                                     |
| `@fastify/rate-limit`       |      `11.2.0` | Current per-process local rate limit.                              |
| `@fastify/swagger`          |       `9.8.1` | OpenAPI generation from route schemas.                             |
| `@fastify/swagger-ui`       |       `6.1.1` | Loopback-only `/docs` reference in the current local process.      |
| `@fastify/sensible`         |       `6.0.5` | Narrow HTTP utility set.                                           |
| `fastify-type-provider-zod` |       `7.0.0` | Zod request/response schema integration.                           |
| `zod`                       |       `4.4.3` | Domain, contract, request, response, and configuration validation. |
| `postgres`                  |       `3.4.9` | Parameterized direct-TCP PostgreSQL driver.                        |
| `decimal.js`                |      `10.6.0` | Explicit exact financial arithmetic; money remains integer cents.  |
| `ulid`                      |       `3.0.2` | Sortable opaque application identifiers.                           |
| `pino`                      |      `10.3.1` | Structured JSON logging with redaction.                            |

The current API has one ordinary Node/Fastify server entry point plus exported local application
use cases. `@fastify/aws-lambda`, `aws-jwt-verify`, and `@neondatabase/serverless` are not installed.
They are future M19–M22 candidates only; business logic must remain free of Lambda event types.

## 7. Database

| Choice           | Baseline                                                                               |
| ---------------- | -------------------------------------------------------------------------------------- |
| Engine           | PostgreSQL major version 17                                                            |
| Development      | Digest-pinned `postgres:17-alpine` from `docker-compose.local.yml` and CI              |
| Current release  | Loopback PostgreSQL only (`goalpilot_local`; isolated `goalpilot_test` for tests)      |
| Future M19–M22   | Neon or another approved hosted PostgreSQL provider; not currently configured          |
| Query layer      | Parameterized `postgres` `3.4.9` tagged templates                                      |
| Migration tool   | Repository-owned ordered SQL runner                                                    |
| Migration format | Reviewed SQL committed to `packages/data-access/migrations`                            |
| Identifier       | ULID text with check constraints or PostgreSQL UUID where a provider requires UUID     |
| Money            | `bigint` cents, never PostgreSQL floating point                                        |
| Rates            | integer basis points where possible; exact numeric/decimal for fractional calculations |
| Time             | `timestamptz` in UTC                                                                   |
| Calendar dates   | PostgreSQL `date`                                                                      |

The runner applies filenames in lexical order and records filename/checksum/application time in
`schema_migrations`. It rejects an edited checksum for an already-applied filename; schema repair
therefore uses a new forward migration rather than rewriting history.

Future hosted-database rationale (not current implementation):

- zero-idle-cost target for the MVP;
- PostgreSQL-compatible relational model;
- serverless driver suitable for Lambda;
- avoids an always-on RDS instance before product validation.

Tradeoffs:

- free plans can sleep, throttle, cap storage, or change;
- cold database compute can add latency;
- cross-provider network latency exists;
- production financial integrations may require a paid plan, stronger retention, private networking, or migration to RDS/Aurora.

Portability requirements:

- no Neon-specific SQL in domain repositories unless isolated;
- all schema changes are normal PostgreSQL migrations;
- backups and data export are documented;
- migration to RDS must not require a domain rewrite.

Compatibility note (2026-08-23): the originally pinned Drizzle `0.45.2` declaration files do not
pass the approved TypeScript `6.0.3` configuration with `skipLibCheck=false`, including errors in
optional non-PostgreSQL drivers. The local MVP therefore uses the conventions-approved explicit
parameterized-query option and reviewed SQL migrations instead of weakening type checking.

### Current product-experience persistence

PX uses the same PostgreSQL database and ordered SQL runner. The committed PX migrations add
owner-scoped drafts; immutable plan change and calculation provenance; per-user clocks;
seeded-fixture capability; constrained product/routine events; the five Timing tables; in-flight
application-command claims; goal/archive/terminal-Timing provenance; exact run-scoped price series;
reversal-aware balance integrity; the per-user Story financial-run token/expiry; and per-run
Timing-provider worker tokens/expiries. JSON is used for the strict versioned partial-draft payload
and immutable plan input/output/context/change snapshots. Telemetry uses fixed columns and no
arbitrary metadata. Executed release evidence records the exact final migration/checksum inventory.

Draft activation persists a schedule anchor and next contribution date, not projected future rows.
`schedule_occurrences` is populated only when a due contribution is processed. Composite owner
keys, integer cents, date checks, unique replay keys, and immutable/append-only triggers enforce the
current boundary. The complete current table/relationship inventory is in
[`architecture/ERD.md`](architecture/ERD.md).

Current Timing observations are run-scoped: `(run, observation key)` identifies the exact series
used by one assessment, while an advisory-lock trigger rejects conflicting reuse of an
item/source/key across runs and permits distinct keys on the same date. Terminal Timing
assessments retain their plan version with null current health. Ledger reversal constraints require
a single exact same-account negation of an `account_opened`, `contribution_posted`, or
`interest_posted` credit, and fixed-term availability excludes reversed source lots and reversed
maturity interest. Reversal validation is serialized by an owned account-row lock.

Each unique Timing policy/application-date row also carries a ten-minute provider-work generation
lease while its status is `claimed`. An unexpired generation is surfaced as `in_progress` without
another provider call; an expired generation may be reclaimed on the same logical run with a new
token and incremented attempt, capped at three. Only the matching current token can complete or
fail provider work, and terminal rows clear both worker fields. A superseded worker's late failure
is counted `in_progress`, not failed, and does not itself cause a failure outcome. This lease is
distinct from both `application_command_claims` and the owner-wide Story lease below.

Story advance claims one ten-minute owner lease on `user_application_clocks`; current matching-token
release, active-run mutation guards, expiry-only reclaim, and clock versioning distinguish it from
the leased `application_command_claims` response-persistence protocol. HYSA processing also uses a
date-bounded financial revision (ledger balance/count, accrual state, goal version/target, and plan
pointer), reloads and recalculates after a conflict, and fails after three conflicts. Earlier reads
exclude future-effective ledger rows, while milestone context exposes a persisted date ahead of the
clock as a recovery high-water mark.

Migration `202608230010` backfills `plan-calculation-context-v1` for rows created by an older
schema. The backfill is deterministic but cannot recreate an unstored historical HYSA remainder:
it uses the stored account remainder only for the current version and zero for other historical
versions, and reconstructs fixed-term opening context from stored input and assumptions. New
current-schema writes capture context at creation; backfilled contexts are compatibility snapshots,
not original-capture evidence.

Migration `202608230011` similarly reconstructs missing archive provenance from the latest usable
archive audit event, or falls back to `updated_at` and `GOAL_COMPLETED`, and assigns
`stored-YYYY-MM-DD` compatibility keys to old price observations. Current writes store the actual
archive reason/time and provider observation key; upgrade fallbacks must not be presented as exact
original provenance.

The Timing Lab adds no database, queue, cache, scraper, retailer client, or statistical/AI package.
Its small exact algorithm uses TypeScript integer/Decimal primitives and deterministic committed
fixtures behind `HistoricalPriceProvider`.

## 8. Authentication and session design

### 8.1 Current local flow

```text
POST /auth/register or /auth/login
-> LocalAuthProvider verifies a salted scrypt password hash
-> API creates random session and CSRF tokens
-> PostgreSQL stores only SHA-256 token hashes and expiry
-> browser receives goalpilot_session and goalpilot_csrf cookies
```

The session cookie is `HttpOnly`, both cookies are `SameSite=Lax` with path `/`, and the CSRF cookie
is readable so the typed API client can return it in `X-CSRF-Token`. Sessions have an eight-hour
sliding idle expiry bounded by seven days. `Secure=false` is intentional only for current
loopback-HTTP `local` and `test` modes; the process rejects staging/production entirely. Every
mutation validates exact Origin, and authenticated API mutations/logout validate CSRF.

`AUTH_MODE=local` is the only shipped adapter. `AUTH_MODE=external`, non-loopback origins, live
financial-provider mode, and staging/production startup fail closed.

### 8.2 Future M19–M22 identity design

After the M19 gate, an approved Cognito adapter may use hosted authorization-code flow with PKCE,
state, nonce, server-side token exchange, encrypted refresh-token material, and `Secure` cookies.
Future requirements are:

- refresh tokens never enter JavaScript-accessible storage;
- state-changing routes require CSRF protection and Origin validation;
- sign-out revokes or invalidates session state;
- TOTP MFA is supported in infrastructure;
- cloud deployment rejects `AUTH_MODE=local` and uses an independently reviewed external adapter.

## 9. Calculation implementation

`packages/domain` is pure TypeScript. Its current runtime dependencies are
`@goalpilot/contracts`, `decimal.js`, and `date-fns`; the current source uses shared contract types,
explicit Decimal arithmetic, and local date utilities. Zod boundary schemas live in
`packages/contracts` rather than as a direct domain dependency.

The domain may depend only on:

- provider-neutral types and constants from `@goalpilot/contracts`;
- `decimal.js`;
- selected `date-fns` pure helpers, wrapped behind local date utilities;
- no additional runtime package without an authority-document and manifest update.

It may not import:

- Fastify;
- React;
- Drizzle;
- AWS SDKs;
- environment variables;
- databases;
- provider SDKs;
- AI libraries.

Money is represented as branded integer cents. Rate calculations use explicit conventions and rounding modes. Every calculation takes an `asOfDate` and assumption version; it never reads the system clock internally.

Current provider ports are `Clock`, `AuthProvider`, `RateProvider`, `GoalAccountProvider`,
`ContributionProvider`, `InterestProvider`, and `HistoricalPriceProvider`. Current adapters are
`LocalAuthProvider`, `StaticRateProvider`, `SimulatedGoalAccountProvider`,
`SimulatedContributionProvider`, `SimulatedInterestProvider`, `PersistedApplicationClock`,
`PersistedUserApplicationClock`, and `FixtureHistoricalPriceProvider`. No current adapter performs
an external network call or accepts a provider credential.

## 10. Future M19–M22 AWS services

No service in this section is implemented, configured, or required for current local acceptance.
The candidate cloud adaptation is:

| Service                    | Purpose                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| S3                         | Private React build origin.                                                   |
| CloudFront                 | HTTPS delivery, caching, SPA fallback, and single public hostname.            |
| ACM                        | Certificate when a custom domain is introduced.                               |
| API Gateway HTTP API       | Low-cost `/api` and `/auth` ingress, CORS and throttling.                     |
| Lambda                     | Fastify API and scheduled simulation processing.                              |
| Cognito User Pools         | Registration, authentication, password reset and optional MFA.                |
| EventBridge Scheduler      | Low-frequency simulated contribution processing.                              |
| CloudWatch Logs and alarms | Structured logs, errors, invocation metrics and alarms.                       |
| SSM Parameter Store        | Standard SecureString configuration for database URL and OAuth client secret. |
| AWS Budgets                | Cost notifications before deployment usage grows.                             |
| CDK and CloudFormation     | Repeatable infrastructure.                                                    |
| IAM and STS                | Least-privilege roles and GitHub OIDC deployment.                             |

### Explicitly omitted from the candidate first cloud adaptation

- ECS Fargate;
- Application Load Balancer;
- NAT Gateway;
- RDS or Aurora;
- ElastiCache or Redis;
- OpenSearch;
- DynamoDB;
- RDS Proxy;
- Step Functions;
- paid VPC interface endpoints;
- Bedrock;
- WAF;
- multi-region deployment.

WAF becomes mandatory before broad public access or any real financial-provider integration. It is deferred only to avoid a fixed cost during the simulation MVP.

## 11. Future M19–M22 infrastructure as code

There is no current `infra/cdk` package and the following packages are not current direct
dependencies. Versions remain planning pins to re-validate when M19 is authorized.

| Package       | Exact version |
| ------------- | ------------: |
| `aws-cdk-lib` |     `2.266.0` |
| `constructs`  |      `10.8.0` |
| CDK CLI       |    `2.1135.1` |
| `esbuild`     |      `0.28.2` |

Proposed CDK stacks:

1. `GoalPilotEdgeStack`
   - S3, CloudFront, optional ACM integration and security headers.
2. `GoalPilotIdentityStack`
   - Cognito pool, clients and hosted-domain configuration.
3. `GoalPilotApiStack`
   - HTTP API, Lambda functions, schedules, log groups, alarms, parameters and permissions.
4. `GoalPilotDeploymentStack` or deployment construct
   - optional GitHub OIDC role and artifact permissions.

Stateful resources receive explicit retention and removal policies. Development and production configurations are separate. Production deletion protection is enabled where supported.

## 12. Testing stack

| Package                     | Exact version | Purpose                             |
| --------------------------- | ------------: | ----------------------------------- |
| `vitest`                    |      `4.1.10` | Unit and integration test runner.   |
| `@playwright/test`          |      `1.62.1` | Browser end-to-end testing.         |
| `@testing-library/react`    |      `16.3.0` | React behavior tests.               |
| `@testing-library/jest-dom` |       `6.9.1` | Accessible DOM assertions.          |
| `jsdom`                     |      `27.0.1` | Component-test browser environment. |
| `@axe-core/playwright`      |      `4.10.2` | Automated accessibility checks.     |

Test environments:

- pure unit tests without services;
- PostgreSQL integration tests using Docker;
- API tests through Fastify `inject`;
- browser tests against local web/API;
- production-built loopback local/demo modes and terminating local smoke;
- future M19–M22 only: CDK assertions/synthesis and deployed smoke against a nonproduction URL.

Do not mock the calculation engine in API integration tests. Do not mock the API in the critical end-to-end journey.

## 13. Developer tooling

Current root direct development dependencies include:

| Package             | Exact version |
| ------------------- | ------------: |
| `eslint`            |      `10.8.1` |
| `@eslint/js`        |      `10.0.1` |
| `typescript-eslint` |      `8.67.0` |
| `prettier`          |       `3.6.2` |
| `tsx`               |     `4.23.12` |

The approved shadcn CLI pin is not installed as a direct dependency; source-owned UI utilities use
`class-variance-authority`, `clsx`, and `tailwind-merge` through `packages/ui`.

Repository tooling:

- EditorConfig;
- ESLint flat configuration;
- Prettier;
- TypeScript project references;
- Husky is intentionally omitted; CI is authoritative and optional local Git hooks can be documented without becoming a required dependency;
- Changesets is omitted until packages are published;
- Turborepo or Nx is omitted; pnpm workspaces and TypeScript references are enough at this scale.

## 14. TypeScript configuration

Base requirements:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": false
  }
}
```

Web configuration may use `moduleResolution: "Bundler"` as required by Vite, but shared/backend packages use NodeNext. Every package has its own `tsconfig.json` extending the base.

## 15. CI and security tooling

The current `ci.yml` workflow installs from the frozen lockfile, migrates/seeds PostgreSQL, runs
`corepack pnpm verify`, installs pinned Chromium, runs Playwright, and uploads available
artifacts/reports. `verify` contains formatting, zero-warning lint, strict type checking, prepared
Vitest coverage, production builds, exact database verification, the repository scanner,
`pnpm audit --prod`, and CycloneDX SBOM generation. Separate current workflows run CodeQL,
Gitleaks, and pull-request dependency review.

PX10 release evidence must additionally cover stable Chrome, scoped demo/Timing CLIs,
production-built `local:release` and `demo:local`, the self-terminating local smoke, and Dev
Container probes. Those commands are not silently implied by `verify` or by the current CI
workflow.

CDK tests/synthesis, deployment, and a deployed-URL smoke test are future M19–M22 gates. Future
deployment must use GitHub OIDC to assume a repository/branch/environment-restricted AWS role; no
AWS access key may be stored in GitHub. The existence of workflow definitions is not evidence that
a check ran—release evidence must identify the exact successful execution.

## 16. Scaling path

### Stage A: current local simulation MVP

- loopback React/Fastify/PostgreSQL;
- per-user controlled-clock story controls, bounded owner financial-run and per-run Timing-worker
  leases, and local CLI jobs;
- static illustrative assumptions and deterministic historical-price fixture;
- local opaque-session authentication;
- no AWS service, external scheduler, or provider credential.

### Stage B: future M19–M22 cloud portfolio adaptation

- candidate Lambda/API Gateway and hosted PostgreSQL topology;
- Cognito adapter and scheduled cloud invocation after their hard gates;
- CDK, GitHub OIDC, budgets, alarms, and deployed smoke evidence;
- no real provider credentials.

### Stage C: future public portfolio release

- paid Neon tier if required;
- WAF;
- stronger alarms and backups;
- custom domain;
- penetration testing appropriate to public exposure.

### Stage D: future provider sandbox

- provider adapters;
- webhook inbox;
- transactional outbox;
- provider operation records;
- reconciliation;
- SQS FIFO for financial commands;
- legal and vendor review.

### Stage E: future live financial beta

- selected sponsor-bank or custodian program;
- production KYC and funding;
- paid database with verified recovery objectives;
- WAF and threat monitoring;
- independent security validation;
- human operational review;
- compliance-approved language and procedures.

### Stage F: future sustained scale

Move API or workers to ECS only when measured evidence supports it. Migrate PostgreSQL to RDS/Aurora only when contracts, networking, workload, recovery, or cost justify it. Domain, contracts and repositories remain unchanged.

## 17. Version update policy

- Exact direct versions are committed.
- Dependabot may open patch and minor updates weekly.
- No automatic merge for production dependencies.
- Every update runs the complete compatibility suite.
- Major upgrades require an ADR and migration notes.
- Security fixes take priority over version freeze.
- `STACK.md` and the lockfile must agree.
- Codex must never replace a library because it prefers a different tool without explicit approval.

## 18. Final stack rationale

This stack demonstrates:

- a polished React and TypeScript application;
- a production-structured Node/Fastify backend;
- PostgreSQL schema design and migrations;
- deterministic financial-domain engineering;
- authentication and tenant isolation;
- boundaries designed for a future serverless AWS adaptation;
- a documented, but not implemented, infrastructure-as-code plan;
- owner-scoped local scheduled simulation use cases;
- observability, CI/CD and security controls;
- a provider-adapter path to the long-term product.

It avoids paying for mature-platform infrastructure before GoalPilot proves that users value the simulated set-and-forget goal experience.
