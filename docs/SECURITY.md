# Security

GoalPilot’s local threat model assumes untrusted browser input, two mutually isolated users, and no
real financial credentials or money movement.

Controls include strict TypeScript, Zod request validation, parameterized SQL, composite ownership
foreign keys, cross-user 404 behavior, salted scrypt password hashes, random opaque session and CSRF
tokens stored as hashes, HttpOnly/SameSite cookies, an Origin/CSRF boundary, CORS allowlisting,
Helmet headers, payload and rate limits, safe error envelopes with request IDs, and Pino redaction.
Local insecure cookies and simulator/auth modes are accepted only with loopback URLs; staging and
production startup is rejected.

Stored scrypt hashes use a strict fixed grammar and fail closed before key derivation if corrupt or
unsupported. Unexpected exceptions are reduced to a safe type classification; raw exception
messages and stacks are not logged. Destructive database scripts require exact role-specific local
database names and compare normalized target identities before a test reset.

Ledger, plan, and assumption mutation triggers protect financial history. Idempotency records use a
request hash and advisory transaction lock so a key cannot silently replay a different request.
Deletion cascades financial data and sessions while pseudonymizing retained security audit events.

CI runs the repository scanner, Gitleaks, CodeQL, dependency review, `pnpm audit --prod`, and a
CycloneDX SBOM. Never place secrets in `.env.example`; `.env.local` is ignored.

## PX trust boundaries

- Partial drafts are authenticated, owner-scoped, strict-schema records with optimistic versions;
  activation revalidates the complete financial contract transactionally.
- Every scenario result is recomputed from an immutable server snapshot. Apply checks goal/current
  plan versions, ledger state, request hash, and owner before adding a version.
- Consumer clock controls are owner-filtered and milestone-only. A singleton/global clock may not
  back a browser mutation. Reset authority is a persisted seeded-fixture capability, never an email
  convention or client flag.
- Server capability flags gate demo and Timing Lab routes. Disabled routes are 404; the provider is
  not constructed. Local/demo listeners and database URLs remain loopback-only.
- `product_events` accepts only closed categorical fields and is separate from audit logging. It
  rejects money, entered text, product names/URLs, email, resource/account/session/request/CSRF IDs,
  secrets, and arbitrary metadata.
- Timing Lab accepts allowlisted fixture codes, never URLs/uploads/endpoints. Composite ownership,
  currency/date checks, append-only observations, immutable assessments, and run uniqueness protect
  provenance. A timing result cannot mutate a financial plan.
- Export/deletion must be extended for drafts, user clocks, plan history, and owned timing records.
  Unlinked product-event aggregates are not treated as user financial data.

A route-inventory regression must prove authentication, CSRF, Origin, rate limit, ownership, and
idempotency policy for every mutation. Non-owner access remains an indistinguishable 404. New IDs
use the strict repository identifier grammar, not length-only validation. Provider/internal errors
and request bodies never enter client envelopes, product events, or routine logs.
