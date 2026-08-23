CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash char(64) PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (absolute_expires_at >= expires_at)
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS goals (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  category text,
  target_amount_cents bigint NOT NULL CHECK (target_amount_cents BETWEEN 50000 AND 100000000),
  current_saved_cents bigint NOT NULL CHECK (current_saved_cents BETWEEN 0 AND 100000000),
  target_date date NOT NULL,
  recurring_contribution_cents bigint NOT NULL CHECK (recurring_contribution_cents BETWEEN 0 AND 100000000),
  contribution_cadence text NOT NULL CHECK (contribution_cadence IN ('weekly', 'biweekly', 'monthly')),
  liquidity_need text NOT NULL CHECK (liquidity_need IN ('anytime', 'within_30_days', 'goal_date')),
  preservation_preference text NOT NULL CHECK (preservation_preference IN ('required', 'flexible')),
  confidence text NOT NULL DEFAULT 'expected' CHECK (confidence = 'expected'),
  notes text CHECK (char_length(notes) <= 500),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'purchase_ready', 'completed', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS goals_user_status_idx ON goals(user_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS one_running_goal_per_user_idx
  ON goals(user_id) WHERE status IN ('active', 'paused', 'purchase_ready');

CREATE TABLE IF NOT EXISTS vehicle_assumption_versions (
  version text PRIMARY KEY,
  effective_date date NOT NULL,
  reviewed_date date NOT NULL,
  source_type text NOT NULL CHECK (source_type = 'reviewed_demo_assumption'),
  is_live boolean NOT NULL DEFAULT false CHECK (is_live = false),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_assumptions (
  version text NOT NULL REFERENCES vehicle_assumption_versions(version) ON DELETE RESTRICT,
  vehicle_code text NOT NULL CHECK (vehicle_code IN ('cash', 'hysa', 'cd_ladder', 'treasury_ladder')),
  display_name text NOT NULL,
  apy_basis_points integer NOT NULL CHECK (apy_basis_points BETWEEN 0 AND 10000),
  liquidity_days integer NOT NULL CHECK (liquidity_days >= 0),
  lock_days integer NOT NULL CHECK (lock_days >= 0),
  minimum_cents bigint NOT NULL CHECK (minimum_cents >= 0),
  source_label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (version, vehicle_code)
);

CREATE TABLE IF NOT EXISTS plan_versions (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  goal_id text NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  vehicle_code text NOT NULL CHECK (vehicle_code IN ('cash', 'hysa', 'cd_ladder', 'treasury_ladder')),
  assumption_version text NOT NULL REFERENCES vehicle_assumption_versions(version) ON DELETE RESTRICT,
  normalized_input jsonb NOT NULL,
  calculation_output jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (goal_id, version)
);
CREATE INDEX IF NOT EXISTS plan_versions_owner_idx ON plan_versions(user_id, goal_id, version DESC);

CREATE TABLE IF NOT EXISTS simulated_accounts (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  goal_id text NOT NULL UNIQUE REFERENCES goals(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_version_id text NOT NULL REFERENCES plan_versions(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'purchase_ready', 'completed')),
  next_contribution_date date,
  last_processed_date date NOT NULL,
  last_accrual_date date NOT NULL,
  accrued_interest_micros bigint NOT NULL DEFAULT 0 CHECK (accrued_interest_micros >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS simulated_accounts_due_idx ON simulated_accounts(status, next_contribution_date);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  account_id text NOT NULL REFERENCES simulated_accounts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN (
    'account_opened', 'contribution_scheduled', 'contribution_posted', 'contribution_failed',
    'interest_accrued', 'interest_posted', 'paused', 'resumed', 'goal_completed',
    'simulated_withdrawal', 'reversal'
  )),
  principal_cents bigint NOT NULL DEFAULT 0,
  interest_cents bigint NOT NULL DEFAULT 0,
  effective_date date NOT NULL,
  occurrence_id text,
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 160),
  reverses_entry_id text REFERENCES ledger_entries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (entry_type IN ('account_opened', 'contribution_posted') AND principal_cents > 0 AND interest_cents = 0)
    OR (entry_type = 'interest_posted' AND interest_cents > 0 AND principal_cents = 0)
    OR (entry_type IN ('simulated_withdrawal', 'reversal') AND principal_cents + interest_cents < 0)
    OR (entry_type IN ('contribution_scheduled', 'contribution_failed', 'interest_accrued', 'paused', 'resumed', 'goal_completed') AND principal_cents = 0 AND interest_cents = 0)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_occurrence_unique_idx
  ON ledger_entries(account_id, occurrence_id) WHERE occurrence_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_reversal_per_entry_idx
  ON ledger_entries(reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ledger_owner_account_idx ON ledger_entries(user_id, account_id, effective_date, created_at);

CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger entries are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ledger_entries_no_update ON ledger_entries;
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE TABLE IF NOT EXISTS schedule_occurrences (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES simulated_accounts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('posted', 'failed', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, due_date)
);

CREATE TABLE IF NOT EXISTS interest_posting_periods (
  account_id text NOT NULL REFERENCES simulated_accounts(id) ON DELETE CASCADE,
  period_end date NOT NULL,
  ledger_entry_id text NOT NULL REFERENCES ledger_entries(id) ON DELETE RESTRICT,
  PRIMARY KEY (account_id, period_end)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation text NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash char(64) NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation, key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  pseudonymous_subject_hash char(64),
  event_name text NOT NULL,
  resource_id text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR pseudonymous_subject_hash IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS audit_events_user_idx ON audit_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS data_requests (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('export', 'deletion')),
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS application_clock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  application_date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
