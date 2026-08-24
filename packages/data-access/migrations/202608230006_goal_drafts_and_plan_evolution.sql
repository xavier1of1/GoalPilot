CREATE TABLE goal_drafts (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schema_version text NOT NULL DEFAULT 'goal-draft-v1'
    CHECK (schema_version = 'goal-draft-v1'),
  draft_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_completed_step text CHECK (
    last_completed_step IS NULL
    OR last_completed_step IN ('goal', 'starting_point', 'budget_fit', 'access', 'review')
  ),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  CHECK (updated_at >= created_at),
  CHECK (jsonb_typeof(draft_data) = 'object'),
  CHECK (
    draft_data - ARRAY[
      'name', 'category', 'targetAmountCents', 'targetDate', 'firstContributionDate',
      'currentSavedCents',
      'safeContributionCents', 'budgetFit', 'recurringContributionCents',
      'contributionCadence', 'liquidityNeed', 'preservationPreference', 'confidence', 'notes'
    ]::text[] = '{}'::jsonb
  ),
  CHECK (
    NOT (draft_data ? 'firstContributionDate') OR (
      jsonb_typeof(draft_data->'firstContributionDate') = 'string'
      AND draft_data->>'firstContributionDate' ~ '^\d{4}-\d{2}-\d{2}$'
      AND pg_input_is_valid(draft_data->>'firstContributionDate', 'date')
    )
  ),
  CHECK (
    NOT (draft_data ? 'name') OR (
      jsonb_typeof(draft_data->'name') = 'string'
      AND char_length(draft_data->>'name') BETWEEN 1 AND 80
    )
  ),
  CHECK (
    NOT (draft_data ? 'category') OR (
      jsonb_typeof(draft_data->'category') = 'string'
      AND char_length(draft_data->>'category') <= 40
    )
  ),
  CHECK (
    NOT (draft_data ? 'targetAmountCents') OR (
      jsonb_typeof(draft_data->'targetAmountCents') = 'number'
      AND draft_data->>'targetAmountCents' ~ '^[0-9]+$'
      AND (draft_data->>'targetAmountCents')::numeric BETWEEN 50000 AND 100000000
    )
  ),
  CHECK (
    NOT (draft_data ? 'targetDate') OR (
      jsonb_typeof(draft_data->'targetDate') = 'string'
      AND draft_data->>'targetDate' ~ '^\d{4}-\d{2}-\d{2}$'
      AND pg_input_is_valid(draft_data->>'targetDate', 'date')
    )
  ),
  CHECK (
    NOT (draft_data ? 'currentSavedCents') OR (
      jsonb_typeof(draft_data->'currentSavedCents') = 'number'
      AND draft_data->>'currentSavedCents' ~ '^[0-9]+$'
      AND (draft_data->>'currentSavedCents')::numeric BETWEEN 0 AND 100000000
    )
  ),
  CHECK (
    NOT (draft_data ? 'safeContributionCents') OR (
      jsonb_typeof(draft_data->'safeContributionCents') = 'number'
      AND draft_data->>'safeContributionCents' ~ '^[0-9]+$'
      AND (draft_data->>'safeContributionCents')::numeric BETWEEN 0 AND 100000000
    )
  ),
  CHECK (
    NOT (draft_data ? 'budgetFit') OR (
      jsonb_typeof(draft_data->'budgetFit') = 'string'
      AND draft_data->>'budgetFit' IN ('equal', 'lower', 'higher')
    )
  ),
  CHECK (
    NOT (draft_data ? 'confidence') OR (
      jsonb_typeof(draft_data->'confidence') = 'string'
      AND draft_data->>'confidence' = 'expected'
    )
  ),
  CHECK (
    NOT (draft_data ? 'recurringContributionCents') OR (
      jsonb_typeof(draft_data->'recurringContributionCents') = 'number'
      AND draft_data->>'recurringContributionCents' ~ '^[0-9]+$'
      AND (draft_data->>'recurringContributionCents')::numeric BETWEEN 0 AND 100000000
    )
  ),
  CHECK (
    NOT (draft_data ? 'contributionCadence') OR (
      jsonb_typeof(draft_data->'contributionCadence') = 'string'
      AND draft_data->>'contributionCadence' IN ('weekly', 'biweekly', 'monthly')
    )
  ),
  CHECK (
    NOT (draft_data ? 'liquidityNeed') OR (
      jsonb_typeof(draft_data->'liquidityNeed') = 'string'
      AND draft_data->>'liquidityNeed' IN ('anytime', 'within_30_days', 'goal_date')
    )
  ),
  CHECK (
    NOT (draft_data ? 'preservationPreference') OR (
      jsonb_typeof(draft_data->'preservationPreference') = 'string'
      AND draft_data->>'preservationPreference' IN ('required', 'flexible')
    )
  ),
  CHECK (
    NOT (draft_data ? 'notes') OR (
      jsonb_typeof(draft_data->'notes') = 'string'
      AND char_length(draft_data->>'notes') <= 500
    )
  )
);
CREATE INDEX goal_drafts_owner_updated_idx
  ON goal_drafts(user_id, updated_at DESC, id);

CREATE OR REPLACE FUNCTION validate_goal_draft_update() RETURNS trigger AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id
    OR NEW.schema_version <> OLD.schema_version OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'goal draft ownership, schema, and creation provenance are immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'goal draft version must advance exactly once';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'goal draft update time cannot move backward';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER goal_drafts_validate_update
  BEFORE UPDATE ON goal_drafts
  FOR EACH ROW EXECUTE FUNCTION validate_goal_draft_update();

ALTER TABLE plan_versions DISABLE TRIGGER plan_versions_immutable;

ALTER TABLE plan_versions
  ADD COLUMN application_date date,
  ADD COLUMN schedule_anchor_date date,
  ADD COLUMN calculation_policy_version text NOT NULL DEFAULT 'legacy-calculation-v1',
  ADD COLUMN ranking_policy_version text NOT NULL DEFAULT 'vehicle-fit-v1',
  ADD COLUMN health_policy_version text NOT NULL DEFAULT 'legacy-account-status-v1',
  ADD COLUMN change_kind text NOT NULL DEFAULT 'initial_activation',
  ADD COLUMN changed_field text,
  ADD COLUMN change_reason_code text NOT NULL DEFAULT 'INITIAL_ACTIVATION',
  ADD COLUMN change_payload jsonb,
  ADD COLUMN omitted_contribution_dates date[] NOT NULL DEFAULT '{}'::date[],
  ADD COLUMN base_plan_version_id text;

UPDATE plan_versions
SET application_date = CASE
  WHEN calculation_output->>'asOfDate' ~ '^\d{4}-\d{2}-\d{2}$'
    AND pg_input_is_valid(calculation_output->>'asOfDate', 'date')
    THEN (calculation_output->>'asOfDate')::date
  ELSE created_at::date
END,
schedule_anchor_date = CASE
  WHEN calculation_output->>'asOfDate' ~ '^\d{4}-\d{2}-\d{2}$'
    AND pg_input_is_valid(calculation_output->>'asOfDate', 'date')
    THEN (calculation_output->>'asOfDate')::date
  ELSE created_at::date
END;

ALTER TABLE plan_versions
  ALTER COLUMN application_date SET NOT NULL,
  ALTER COLUMN schedule_anchor_date SET NOT NULL,
  ADD CONSTRAINT plan_versions_policy_version_check CHECK (
    calculation_policy_version ~ '^[a-z][a-z0-9-]{0,63}$'
    AND ranking_policy_version ~ '^[a-z][a-z0-9-]{0,63}$'
    AND health_policy_version ~ '^[a-z][a-z0-9-]{0,63}$'
  ),
  ADD CONSTRAINT plan_versions_change_kind_check CHECK (
    change_kind IN ('initial_activation', 'scenario_applied', 'recovery_applied')
  ),
  ADD CONSTRAINT plan_versions_changed_field_check CHECK (
    changed_field IS NULL OR changed_field IN (
      'recurring_contribution', 'target_date', 'target_amount', 'missed_contribution'
    )
  ),
  ADD CONSTRAINT plan_versions_change_reason_check CHECK (
    change_reason_code IN (
      'INITIAL_ACTIVATION',
      'USER_CONTRIBUTION_CHANGED',
      'USER_DEADLINE_CHANGED',
      'USER_TARGET_CHANGED',
      'USER_MISSED_CONTRIBUTION_PLANNED',
      'RECOVERY_CONTRIBUTION_INCREASED',
      'RECOVERY_DEADLINE_EXTENDED',
      'RECOVERY_TARGET_REDUCED'
    )
  ),
  ADD CONSTRAINT plan_versions_omitted_contribution_dates_check CHECK (
    cardinality(omitted_contribution_dates) <= 24
  ),
  ADD CONSTRAINT plan_versions_change_shape_check CHECK (
    (
      change_kind = 'initial_activation'
      AND version = 1
      AND changed_field IS NULL
      AND base_plan_version_id IS NULL
      AND change_reason_code = 'INITIAL_ACTIVATION'
      AND change_payload IS NULL
      AND cardinality(omitted_contribution_dates) = 0
    ) OR (
      change_kind = 'scenario_applied'
      AND version > 1
      AND changed_field IS NOT NULL
      AND base_plan_version_id IS NOT NULL
      AND change_payload IS NOT NULL
      AND (
        (changed_field = 'recurring_contribution' AND change_reason_code = 'USER_CONTRIBUTION_CHANGED')
        OR (changed_field = 'target_date' AND change_reason_code = 'USER_DEADLINE_CHANGED')
        OR (changed_field = 'target_amount' AND change_reason_code = 'USER_TARGET_CHANGED')
        OR (
          changed_field = 'missed_contribution'
          AND change_reason_code = 'USER_MISSED_CONTRIBUTION_PLANNED'
        )
      )
    ) OR (
      change_kind = 'recovery_applied'
      AND version > 1
      AND base_plan_version_id IS NOT NULL
      AND change_payload IS NOT NULL
      AND (
        (
          changed_field = 'recurring_contribution'
          AND change_reason_code = 'RECOVERY_CONTRIBUTION_INCREASED'
        ) OR (
          changed_field = 'target_date'
          AND change_reason_code = 'RECOVERY_DEADLINE_EXTENDED'
        ) OR (
          changed_field = 'target_amount'
          AND change_reason_code = 'RECOVERY_TARGET_REDUCED'
        )
      )
    )
  ),
  ADD CONSTRAINT plan_versions_change_payload_check CHECK (
    (changed_field IS NULL AND change_payload IS NULL)
    OR (
      changed_field = 'recurring_contribution'
      AND jsonb_typeof(change_payload) = 'object'
      AND change_payload ? 'recurringContributionCents'
      AND change_payload - 'recurringContributionCents' = '{}'::jsonb
      AND jsonb_typeof(change_payload->'recurringContributionCents') = 'number'
      AND change_payload->>'recurringContributionCents' ~ '^[0-9]+$'
      AND (change_payload->>'recurringContributionCents')::numeric BETWEEN 0 AND 100000000
    ) OR (
      changed_field = 'target_date'
      AND jsonb_typeof(change_payload) = 'object'
      AND change_payload ? 'targetDate'
      AND change_payload - 'targetDate' = '{}'::jsonb
      AND jsonb_typeof(change_payload->'targetDate') = 'string'
      AND change_payload->>'targetDate' ~ '^\d{4}-\d{2}-\d{2}$'
      AND pg_input_is_valid(change_payload->>'targetDate', 'date')
    ) OR (
      changed_field = 'target_amount'
      AND jsonb_typeof(change_payload) = 'object'
      AND change_payload ? 'targetAmountCents'
      AND change_payload - 'targetAmountCents' = '{}'::jsonb
      AND jsonb_typeof(change_payload->'targetAmountCents') = 'number'
      AND change_payload->>'targetAmountCents' ~ '^[0-9]+$'
      AND (change_payload->>'targetAmountCents')::numeric BETWEEN 50000 AND 100000000
    ) OR (
      changed_field = 'missed_contribution'
      AND jsonb_typeof(change_payload) = 'object'
      AND change_payload ? 'missedContributionDate'
      AND change_payload - 'missedContributionDate' = '{}'::jsonb
      AND jsonb_typeof(change_payload->'missedContributionDate') = 'string'
      AND change_payload->>'missedContributionDate' ~ '^\d{4}-\d{2}-\d{2}$'
      AND pg_input_is_valid(change_payload->>'missedContributionDate', 'date')
    )
  ),
  ADD CONSTRAINT plan_versions_base_same_goal_owner_fkey
    FOREIGN KEY (base_plan_version_id, goal_id, user_id)
    REFERENCES plan_versions(id, goal_id, user_id) ON DELETE CASCADE;

ALTER TABLE plan_versions ENABLE TRIGGER plan_versions_immutable;

CREATE OR REPLACE FUNCTION validate_plan_version_insert() RETURNS trigger AS $$
DECLARE
  base_version integer;
  base_schedule_anchor date;
  base_omitted_dates date[];
  missed_contribution_date date;
  expected_omitted_dates date[];
  fallback_date date;
BEGIN
  IF NEW.application_date IS NULL THEN
    IF NEW.calculation_output->>'asOfDate' ~ '^\d{4}-\d{2}-\d{2}$'
      AND pg_input_is_valid(NEW.calculation_output->>'asOfDate', 'date') THEN
      NEW.application_date := (NEW.calculation_output->>'asOfDate')::date;
    ELSE
      SELECT application_date INTO fallback_date FROM application_clock WHERE singleton = true;
      NEW.application_date := COALESCE(fallback_date, CURRENT_DATE);
    END IF;
  END IF;
  IF NEW.schedule_anchor_date IS NULL AND NEW.change_kind = 'initial_activation' THEN
    NEW.schedule_anchor_date := NEW.application_date;
  END IF;

  IF NEW.change_kind = 'initial_activation' THEN
    RETURN NEW;
  END IF;

  SELECT version, schedule_anchor_date, omitted_contribution_dates
  INTO base_version, base_schedule_anchor, base_omitted_dates
  FROM plan_versions
  WHERE id = NEW.base_plan_version_id
    AND goal_id = NEW.goal_id
    AND user_id = NEW.user_id;
  IF NOT FOUND OR base_version <> NEW.version - 1 THEN
    RAISE EXCEPTION 'a derived plan must reference the immediately prior owned goal version';
  END IF;
  IF NEW.schedule_anchor_date IS NULL THEN
    NEW.schedule_anchor_date := base_schedule_anchor;
  ELSIF NEW.schedule_anchor_date <> base_schedule_anchor THEN
    RAISE EXCEPTION 'derived plans must preserve the original contribution schedule anchor';
  END IF;
  IF NEW.changed_field = 'missed_contribution' THEN
    missed_contribution_date := (NEW.change_payload->>'missedContributionDate')::date;
    IF missed_contribution_date = ANY(base_omitted_dates) THEN
      RAISE EXCEPTION 'a missed contribution date can be omitted only once';
    END IF;
    expected_omitted_dates := array_append(base_omitted_dates, missed_contribution_date);
  ELSE
    expected_omitted_dates := base_omitted_dates;
  END IF;
  IF cardinality(NEW.omitted_contribution_dates) = 0 THEN
    NEW.omitted_contribution_dates := expected_omitted_dates;
  ELSIF NEW.omitted_contribution_dates <> expected_omitted_dates THEN
    RAISE EXCEPTION 'derived plans must preserve and append only approved omitted contribution dates';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plan_versions_validate_insert
  BEFORE INSERT ON plan_versions
  FOR EACH ROW EXECUTE FUNCTION validate_plan_version_insert();

CREATE OR REPLACE FUNCTION validate_account_plan_evolution() RETURNS trigger AS $$
DECLARE
  old_version integer;
  new_version integer;
  new_base_plan_id text;
BEGIN
  IF NEW.plan_version_id = OLD.plan_version_id THEN
    RETURN NEW;
  END IF;

  SELECT version INTO old_version
  FROM plan_versions
  WHERE id = OLD.plan_version_id AND goal_id = OLD.goal_id AND user_id = OLD.user_id;
  SELECT version, base_plan_version_id INTO new_version, new_base_plan_id
  FROM plan_versions
  WHERE id = NEW.plan_version_id AND goal_id = NEW.goal_id AND user_id = NEW.user_id;
  IF old_version IS NULL OR new_version IS NULL
    OR new_version <> old_version + 1 OR new_base_plan_id <> OLD.plan_version_id THEN
    RAISE EXCEPTION 'an account can advance only to the direct next immutable plan version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER simulated_accounts_validate_plan_evolution
  BEFORE UPDATE OF plan_version_id ON simulated_accounts
  FOR EACH ROW EXECUTE FUNCTION validate_account_plan_evolution();

ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (
  entry_type IN (
    'account_opened', 'contribution_scheduled', 'contribution_posted', 'contribution_failed',
    'interest_accrued', 'interest_posted', 'paused', 'resumed', 'goal_completed',
    'simulated_withdrawal', 'reversal', 'plan_changed'
  )
);
ALTER TABLE ledger_entries DROP CONSTRAINT ledger_amount_policy_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_amount_policy_check CHECK (
  (entry_type = 'account_opened' AND principal_cents >= 0 AND interest_cents = 0)
  OR (entry_type = 'contribution_posted' AND principal_cents > 0 AND interest_cents = 0)
  OR (entry_type = 'interest_posted' AND interest_cents > 0 AND principal_cents = 0)
  OR (entry_type IN ('simulated_withdrawal', 'reversal') AND principal_cents + interest_cents < 0)
  OR (entry_type IN (
    'contribution_scheduled', 'contribution_failed', 'interest_accrued',
    'paused', 'resumed', 'goal_completed', 'plan_changed'
  ) AND principal_cents = 0 AND interest_cents = 0)
);
