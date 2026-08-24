# GoalPilot execution plan

This is the authoritative local-first milestone order. A milestone is checked only after its
relevant implementation and automated evidence pass. AWS work is future work and is not authorized
before the hard gate.

| Status |     Milestone | Increment                                                      |
| ------ | ------------: | -------------------------------------------------------------- |
| [x]    |           M00 | Repository audit and local-first correction                    |
| [x]    |           M01 | Reproducible local environment                                 |
| [x]    |           M02 | CI and cybersecurity baseline                                  |
| [x]    |           M03 | PostgreSQL schema and migrations                               |
| [x]    |           M04 | Design system and frontend foundation                          |
| [x]    |           M05 | Financial primitives                                           |
| [x]    |           M06 | Vehicle and interest engine                                    |
| [x]    |           M07 | Fastify API and contracts                                      |
| [x]    |           M08 | Local authentication and ownership                             |
| [x]    |           M09 | Goal persistence and CRUD                                      |
| [x]    |           M10 | Planner and vehicle-comparison UX                              |
| [x]    |           M11 | Simulated Goal Account                                         |
| [x]    |           M12 | Recurring contributions and interest accrual                   |
| [x]    |           M13 | Dashboard and account activity                                 |
| [x]    |           M14 | Controlled Demo Autopilot                                      |
| [x]    |           M15 | Completion, export, and deletion                               |
| [x]    |           M16 | Local security hardening                                       |
| [x]    |           M17 | End-to-end, accessibility, performance, and recovery           |
| [x]    |           M18 | Local release audit                                            |
| [x]    | **HARD GATE** | **The complete local release audit must pass before AWS work** |
| [ ]    |           M19 | Future AWS architecture adaptation                             |
| [ ]    |           M20 | Future AWS staging                                             |
| [ ]    |           M21 | Future AWS security and observability                          |
| [ ]    |           M22 | Future cloud release audit                                     |

## M17 exit evidence

- Playwright covers anonymous preview and the authenticated create, activate, contribute,
  pause/resume, completion, export, and deletion journey.
- Axe checks critical pages; 360-pixel layout has no horizontal overflow.
- Loading, empty, validation, API/network error, stale-preview, paused, completed, and successful
  mutation states are represented.
- Database reset/recovery and repeated Autopilot processing pass.

## M18 local release gate

Run from a clean local database:

```bash
pnpm run setup
pnpm run doctor
pnpm verify
pnpm test:e2e
pnpm db:reset --yes
pnpm db:migrate
pnpm db:migrate
pnpm db:seed
pnpm db:verify
```

Record exact results in `docs/IMPLEMENTATION_STATUS.md`. Do not check M18 or the hard gate on source
presence alone.

## Evidence map

- M00: [initial audit and final evidence](IMPLEMENTATION_STATUS.md),
  [local-first ADR](DECISIONS/0001-local-first-development.md)
- M01: [README](../README.md), [local development](LOCAL_DEVELOPMENT.md),
  [cross-platform bootstrap](../scripts/bootstrap-local.ts), and the built
  [Dev Container](../.devcontainer/Dockerfile)
- M02 and M16: [security controls](SECURITY.md), [CI](../.github/workflows/ci.yml),
  [CodeQL](../.github/workflows/codeql.yml), and
  [security regressions](../tests/security/security-regressions.test.ts)
- M03: [versioned migrations](../packages/data-access/migrations/202608230004_relational_integrity.sql)
  and [database integration evidence](../packages/data-access/src/database.integration.test.ts)
- M04 and M10: [responsive planner](../apps/web/src/pages/BuilderPage.tsx) and
  [consumer-finance visual system](../apps/web/src/styles.css)
- M05 and M06: [calculation specification](domain/CALCULATION_SPEC.md),
  [financial engine](../packages/domain/src/projection.ts), and
  [golden vectors](../packages/domain/src/projection.test.ts)
- M07 through M09: [Fastify API](../apps/api/src/app.ts),
  [repository ownership boundary](../packages/data-access/src/repository.ts), and
  [API integration evidence](../apps/api/src/auth-goals.integration.test.ts)
- M11 through M15: [simulator adapters](../packages/provider-simulators/src/index.ts),
  [Autopilot evidence](../apps/api/src/demo-autopilot.integration.test.ts), and
  [dashboard/account lifecycle](../apps/web/src/pages/DashboardPage.tsx)
- M17 and M18: [browser/a11y journey](../tests/e2e/goalpilot.spec.ts),
  [testing evidence](TESTING.md), and [exact release results](IMPLEMENTATION_STATUS.md)
