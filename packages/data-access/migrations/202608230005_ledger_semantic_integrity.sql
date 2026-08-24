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

DROP TRIGGER IF EXISTS ledger_entries_validate_reversal ON ledger_entries;
CREATE TRIGGER ledger_entries_validate_reversal
  BEFORE INSERT OR UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION validate_ledger_reversal();

ALTER TABLE interest_posting_periods
  ADD CONSTRAINT interest_posting_periods_ledger_entry_unique UNIQUE (ledger_entry_id);

CREATE OR REPLACE FUNCTION validate_interest_posting_period() RETURNS trigger AS $$
DECLARE
  posting_entry ledger_entries%ROWTYPE;
BEGIN
  SELECT * INTO posting_entry
  FROM ledger_entries
  WHERE id = NEW.ledger_entry_id
    AND account_id = NEW.account_id
    AND user_id = NEW.user_id;

  IF NOT FOUND OR posting_entry.entry_type <> 'interest_posted' THEN
    RAISE EXCEPTION 'an interest posting period must reference an interest posting';
  END IF;
  IF posting_entry.effective_date <> NEW.period_end THEN
    RAISE EXCEPTION 'an interest posting period must match the posting effective date';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interest_posting_periods_validate_entry ON interest_posting_periods;
CREATE TRIGGER interest_posting_periods_validate_entry
  BEFORE INSERT OR UPDATE ON interest_posting_periods
  FOR EACH ROW EXECUTE FUNCTION validate_interest_posting_period();
