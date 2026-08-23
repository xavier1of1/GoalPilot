# Local MVP entity relationships

```mermaid
erDiagram
  users ||--o{ sessions : owns
  users ||--o{ goals : owns
  goals ||--o{ plan_versions : snapshots
  goals ||--o| simulated_accounts : activates
  simulated_accounts ||--o{ ledger_entries : records
  simulated_accounts ||--o{ schedule_occurrences : deduplicates
  simulated_accounts ||--o{ interest_posting_periods : deduplicates
  vehicle_assumption_versions ||--|{ vehicle_assumptions : contains
  users ||--o{ idempotency_records : scopes
  users ||--o{ audit_events : produces
  users ||--o{ data_requests : requests
```

Money columns are `bigint` cents. Goals and every protected child carry an owner predicate. Ledger
entries are append-only by trigger; scheduled occurrences, interest periods, request keys, one active
goal, one account per goal, and plan version numbers are protected by database uniqueness.
