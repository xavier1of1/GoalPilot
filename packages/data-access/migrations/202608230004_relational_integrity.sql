ALTER TABLE plan_versions
  ADD CONSTRAINT plan_versions_id_goal_user_unique UNIQUE (id, goal_id, user_id);
ALTER TABLE plan_versions
  ADD CONSTRAINT plan_versions_assumption_vehicle_fkey
  FOREIGN KEY (assumption_version, vehicle_code)
  REFERENCES vehicle_assumptions(version, vehicle_code) ON DELETE RESTRICT;

ALTER TABLE simulated_accounts
  DROP CONSTRAINT simulated_accounts_plan_owner_fkey;
ALTER TABLE simulated_accounts
  ADD CONSTRAINT simulated_accounts_plan_goal_owner_fkey
  FOREIGN KEY (plan_version_id, goal_id, user_id)
  REFERENCES plan_versions(id, goal_id, user_id) ON DELETE RESTRICT;

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_id_account_user_unique UNIQUE (id, account_id, user_id);
ALTER TABLE ledger_entries
  DROP CONSTRAINT ledger_entries_reverses_entry_id_fkey;
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_reversal_account_owner_fkey
  FOREIGN KEY (reverses_entry_id, account_id, user_id)
  REFERENCES ledger_entries(id, account_id, user_id) ON DELETE RESTRICT;
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_reversal_reference_policy_check CHECK (
    (entry_type = 'reversal' AND reverses_entry_id IS NOT NULL)
    OR (entry_type <> 'reversal' AND reverses_entry_id IS NULL)
  );

ALTER TABLE interest_posting_periods ADD COLUMN user_id text;
UPDATE interest_posting_periods period
SET user_id = account.user_id
FROM simulated_accounts account
WHERE account.id = period.account_id;
ALTER TABLE interest_posting_periods ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE interest_posting_periods
  DROP CONSTRAINT interest_posting_periods_account_id_fkey;
ALTER TABLE interest_posting_periods
  DROP CONSTRAINT interest_posting_periods_ledger_entry_id_fkey;
ALTER TABLE interest_posting_periods
  ADD CONSTRAINT interest_posting_periods_account_owner_fkey
  FOREIGN KEY (account_id, user_id)
  REFERENCES simulated_accounts(id, user_id) ON DELETE CASCADE;
ALTER TABLE interest_posting_periods
  ADD CONSTRAINT interest_posting_periods_ledger_account_owner_fkey
  FOREIGN KEY (ledger_entry_id, account_id, user_id)
  REFERENCES ledger_entries(id, account_id, user_id) ON DELETE CASCADE;
