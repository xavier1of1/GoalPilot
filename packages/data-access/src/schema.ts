export const schemaTables = [
  'users',
  'sessions',
  'goals',
  'vehicle_assumption_versions',
  'vehicle_assumptions',
  'plan_versions',
  'simulated_accounts',
  'ledger_entries',
  'schedule_occurrences',
  'interest_posting_periods',
  'idempotency_records',
  'audit_events',
  'data_requests',
  'application_clock',
] as const;

export type SchemaTable = (typeof schemaTables)[number];
