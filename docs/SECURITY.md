# Security

GoalPilot’s local threat model assumes untrusted browser input, two mutually isolated users, and no
real financial credentials or money movement.

Controls include strict TypeScript, Zod request validation, parameterized SQL, composite ownership
foreign keys, cross-user 404 behavior, salted scrypt password hashes, random opaque session and CSRF
tokens stored as hashes, HttpOnly/SameSite cookies, an Origin/CSRF boundary, CORS allowlisting,
Helmet headers, payload and rate limits, safe error envelopes with request IDs, and Pino redaction.
Local insecure cookies and simulator/auth modes are accepted only with loopback URLs; staging and
production startup is rejected.

Ledger, plan, and assumption mutation triggers protect financial history. Idempotency records use a
request hash and advisory transaction lock so a key cannot silently replay a different request.
Deletion cascades financial data and sessions while pseudonymizing retained security audit events.

CI runs the repository scanner, Gitleaks, CodeQL, dependency review, `pnpm audit --prod`, and a
CycloneDX SBOM. Never place secrets in `.env.example`; `.env.local` is ignored.
