ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_amount_policy_check CHECK (
  (entry_type = 'account_opened' AND principal_cents >= 0 AND interest_cents = 0)
  OR (entry_type = 'contribution_posted' AND principal_cents > 0 AND interest_cents = 0)
  OR (entry_type = 'interest_posted' AND interest_cents > 0 AND principal_cents = 0)
  OR (entry_type IN ('simulated_withdrawal', 'reversal') AND principal_cents + interest_cents < 0)
  OR (entry_type IN (
    'contribution_scheduled', 'contribution_failed', 'interest_accrued',
    'paused', 'resumed', 'goal_completed'
  ) AND principal_cents = 0 AND interest_cents = 0)
);

ALTER TABLE goals ADD CONSTRAINT goals_id_user_unique UNIQUE (id, user_id);
ALTER TABLE plan_versions ADD CONSTRAINT plan_versions_id_user_unique UNIQUE (id, user_id);
ALTER TABLE simulated_accounts ADD CONSTRAINT simulated_accounts_id_user_unique UNIQUE (id, user_id);

ALTER TABLE plan_versions ADD CONSTRAINT plan_versions_goal_owner_fkey
  FOREIGN KEY (goal_id, user_id) REFERENCES goals(id, user_id) ON DELETE CASCADE;
ALTER TABLE simulated_accounts ADD CONSTRAINT simulated_accounts_goal_owner_fkey
  FOREIGN KEY (goal_id, user_id) REFERENCES goals(id, user_id) ON DELETE CASCADE;
ALTER TABLE simulated_accounts ADD CONSTRAINT simulated_accounts_plan_owner_fkey
  FOREIGN KEY (plan_version_id, user_id) REFERENCES plan_versions(id, user_id) ON DELETE RESTRICT;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_account_owner_fkey
  FOREIGN KEY (account_id, user_id) REFERENCES simulated_accounts(id, user_id) ON DELETE CASCADE;
ALTER TABLE schedule_occurrences ADD CONSTRAINT schedule_occurrences_account_owner_fkey
  FOREIGN KEY (account_id, user_id) REFERENCES simulated_accounts(id, user_id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION prevent_assumption_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'illustrative assumption versions are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vehicle_assumption_versions_immutable ON vehicle_assumption_versions;
CREATE TRIGGER vehicle_assumption_versions_immutable BEFORE UPDATE OR DELETE
  ON vehicle_assumption_versions FOR EACH ROW EXECUTE FUNCTION prevent_assumption_mutation();
DROP TRIGGER IF EXISTS vehicle_assumptions_immutable ON vehicle_assumptions;
CREATE TRIGGER vehicle_assumptions_immutable BEFORE UPDATE OR DELETE
  ON vehicle_assumptions FOR EACH ROW EXECUTE FUNCTION prevent_assumption_mutation();

CREATE OR REPLACE FUNCTION prevent_plan_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'plan versions are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS plan_versions_immutable ON plan_versions;
CREATE TRIGGER plan_versions_immutable BEFORE UPDATE OR DELETE
  ON plan_versions FOR EACH ROW EXECUTE FUNCTION prevent_plan_mutation();
