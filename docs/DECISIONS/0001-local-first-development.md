# ADR 0001: Local-first development and release gate

- Status: accepted
- Date: 2026-08-23

## Context

The approved product is a simulation-only MVP, while the earlier plan made Cognito, Lambda, API
Gateway, EventBridge, and hosted PostgreSQL prerequisites for core product flows. That ordering made
local product correctness depend on cloud credentials, cost, and external availability.

## Decision

Build and verify the complete product against React/Vite, Fastify, and PostgreSQL 17 locally. Use
provider ports for authentication, the application clock, simulated goal accounts, contributions,
interest, and illustrative rate assumptions. Local adapters must fail closed outside local/test.

AWS files may remain as future architecture documentation, but M19-M22 cannot begin until all local
product, security, quality, and documentation gates in M18 pass.

## Consequences

- Developers can reproduce every critical flow without credentials or paid services.
- Authorization and two-user isolation remain real and testable through local sessions.
- Scheduled processing becomes an explicit `demo:advance` command using a controlled clock.
- A later cloud adaptation replaces adapters and transports without changing the domain model.
