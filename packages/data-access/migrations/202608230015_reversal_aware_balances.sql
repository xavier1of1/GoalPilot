CREATE OR REPLACE FUNCTION simulated_account_available_balance(
  requested_account_id text,
  requested_user_id text,
  requested_date date
) RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH account_context AS (
    SELECT account.id, account.user_id, plan.vehicle_code, goal.target_date, va.lock_days
    FROM simulated_accounts account
    JOIN goals goal ON goal.id = account.goal_id AND goal.user_id = account.user_id
    JOIN plan_versions plan ON plan.id = account.plan_version_id
      AND plan.goal_id = goal.id AND plan.user_id = goal.user_id
    JOIN vehicle_assumptions va ON va.version = plan.assumption_version
      AND va.vehicle_code = plan.vehicle_code
    WHERE account.id = requested_account_id AND account.user_id = requested_user_id
  ), ledger_total AS (
    SELECT COALESCE(SUM(entry.principal_cents + entry.interest_cents), 0)::bigint AS cents
    FROM account_context context
    LEFT JOIN ledger_entries entry ON entry.account_id = context.id
      AND entry.user_id = context.user_id
      AND entry.effective_date <= requested_date
  ), available_lots AS (
    SELECT source.id,
           (
             source.principal_cents + COALESCE(SUM(
               maturity.interest_cents + COALESCE(maturity_reversal.interest_cents, 0)
             ), 0)
           )::bigint AS cents
    FROM account_context context
    JOIN ledger_entries source ON source.account_id = context.id
      AND source.user_id = context.user_id
      AND source.entry_type IN ('account_opened', 'contribution_posted')
      AND source.principal_cents > 0
      AND source.effective_date <= requested_date
    LEFT JOIN ledger_entries maturity ON maturity.account_id = context.id
      AND maturity.user_id = context.user_id
      AND maturity.entry_type IN ('interest_posted', 'interest_accrued')
      AND maturity.occurrence_id LIKE 'maturity:' || source.id || ':%'
      AND maturity.effective_date <= requested_date
    LEFT JOIN ledger_entries maturity_reversal
      ON maturity_reversal.reverses_entry_id = maturity.id
      AND maturity_reversal.account_id = maturity.account_id
      AND maturity_reversal.user_id = maturity.user_id
      AND maturity_reversal.effective_date <= requested_date
    WHERE NOT EXISTS (
      SELECT 1 FROM ledger_entries source_reversal
      WHERE source_reversal.reverses_entry_id = source.id
        AND source_reversal.account_id = source.account_id
        AND source_reversal.user_id = source.user_id
        AND source_reversal.effective_date <= requested_date
    )
      AND CASE
        WHEN source.effective_date + context.lock_days <= context.target_date
          THEN context.target_date
        ELSE source.effective_date + context.lock_days
      END <= requested_date
    GROUP BY source.id, source.principal_cents
  )
  SELECT CASE
    WHEN context.vehicle_code NOT IN ('cd_ladder', 'treasury_ladder')
      THEN GREATEST(0, total.cents)
    ELSE GREATEST(
      0,
      LEAST(total.cents, COALESCE((SELECT SUM(cents) FROM available_lots), 0)::bigint)
    )
  END
  FROM account_context context
  CROSS JOIN ledger_total total;
$$;

CREATE OR REPLACE FUNCTION validate_ledger_reversal() RETURNS trigger AS $$
DECLARE
  source_entry ledger_entries%ROWTYPE;
BEGIN
  IF NEW.entry_type <> 'reversal' THEN
    RETURN NEW;
  END IF;

  IF NEW.reverses_entry_id = NEW.id THEN
    RAISE EXCEPTION 'a ledger entry cannot reverse itself';
  END IF;

  PERFORM 1 FROM simulated_accounts
  WHERE id = NEW.account_id AND user_id = NEW.user_id
  FOR UPDATE;

  SELECT * INTO source_entry
  FROM ledger_entries
  WHERE id = NEW.reverses_entry_id
    AND account_id = NEW.account_id
    AND user_id = NEW.user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'a reversal must reference an existing entry in the same account';
  END IF;
  IF source_entry.entry_type NOT IN ('account_opened', 'contribution_posted', 'interest_posted') THEN
    RAISE EXCEPTION 'a reversal cannot reverse another reversal or non-credit activity';
  END IF;
  IF NEW.principal_cents <> -source_entry.principal_cents
    OR NEW.interest_cents <> -source_entry.interest_cents THEN
    RAISE EXCEPTION 'a reversal must exactly negate the referenced entry';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
