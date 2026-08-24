ALTER TABLE user_application_clocks
  ADD COLUMN financial_run_token text,
  ADD COLUMN financial_run_expires_at timestamptz,
  ADD CONSTRAINT user_application_clocks_financial_run_token_check CHECK (
    (financial_run_token IS NULL AND financial_run_expires_at IS NULL)
    OR (
      financial_run_token ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
      AND financial_run_expires_at IS NOT NULL
    )
  );

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
  IF NEW.effective_date < source_entry.effective_date THEN
    RAISE EXCEPTION 'a reversal cannot precede the entry it corrects';
  END IF;
  IF NEW.principal_cents <> -source_entry.principal_cents
    OR NEW.interest_cents <> -source_entry.interest_cents THEN
    RAISE EXCEPTION 'a reversal must exactly negate the referenced entry';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
