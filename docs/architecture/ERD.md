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

## PX target additions

These entities are approved for forward migrations and are not release evidence until the migration
and database tests pass:

```mermaid
erDiagram
  users ||--o{ goal_drafts : owns
  users ||--|| user_application_clocks : controls
  users ||--o| demo_fixture_users : may_be_seeded
  goals ||--o{ plan_versions : preserves
  plan_versions o|--o{ plan_versions : derives_from
  users ||--o{ purchase_items : owns
  goals ||--o{ purchase_items : funds
  purchase_items ||--o{ price_watch_policies : configures
  price_watch_policies ||--o{ price_check_runs : schedules
  price_check_runs ||--o{ price_observations : imports
  price_check_runs ||--o| purchase_timing_assessments : produces
```

`product_events` deliberately has no goal/account/session identifier relationship; it stores only a
pseudonymous reference and closed categorical fields. New owned tables carry user IDs and composite
foreign keys so a child cannot combine resources from different owners. Draft versions use
optimistic concurrency. Plan, observation, event, policy, and assessment history is append-only or
immutable as specified; identical observation/run replay is unique and idempotent.
