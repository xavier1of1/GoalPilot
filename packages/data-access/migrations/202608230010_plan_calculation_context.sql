ALTER TABLE plan_versions
  ADD COLUMN calculation_context jsonb;

ALTER TABLE plan_versions DISABLE TRIGGER plan_versions_immutable;

UPDATE plan_versions AS p
SET calculation_context = jsonb_build_object(
  'contextVersion', 'plan-calculation-context-v1',
  'personalPrincipalCents', COALESCE((p.normalized_input->>'currentSavedCents')::bigint, 0),
  'totalLedgerValueCents', COALESCE((p.normalized_input->>'currentSavedCents')::bigint, 0),
  'currentAvailableFundsCents', CASE
    WHEN p.vehicle_code IN ('cd_ladder', 'treasury_ladder') THEN 0
    ELSE COALESCE((p.normalized_input->>'currentSavedCents')::bigint, 0)
  END,
  -- Only the current HYSA version has an authoritative unposted remainder.
  -- Historical versions receive zero because their exact prior remainder is unknowable.
  'currentAccruedInterestMicros', CASE
    WHEN p.vehicle_code = 'hysa' THEN COALESCE((
      SELECT account.accrued_interest_micros
      FROM simulated_accounts AS account
      WHERE account.plan_version_id = p.id
        AND account.goal_id = p.goal_id
        AND account.user_id = p.user_id
      LIMIT 1
    ), 0)
    ELSE 0
  END,
  'applicationDate', to_char(p.application_date, 'YYYY-MM-DD'),
  'scheduleAnchorDate', to_char(p.schedule_anchor_date, 'YYYY-MM-DD'),
  'omittedContributionDates', to_jsonb(p.omitted_contribution_dates),
  'fixedTermLots', CASE
    WHEN p.vehicle_code IN ('cd_ladder', 'treasury_ladder')
      AND COALESCE((p.normalized_input->>'currentSavedCents')::bigint, 0) > 0
    THEN jsonb_build_array(jsonb_build_object(
      'personalPrincipalCents', (p.normalized_input->>'currentSavedCents')::bigint,
      'currentBalanceCents', (p.normalized_input->>'currentSavedCents')::bigint,
      'firstMaturityDate', to_char(p.application_date + va.lock_days, 'YYYY-MM-DD'),
      'nextMaturityDate', to_char(p.application_date + va.lock_days, 'YYYY-MM-DD'),
      'nextMaturityInterestEligible', p.application_date + va.lock_days <=
        (p.normalized_input->>'targetDate')::date
    ))
    ELSE '[]'::jsonb
  END
)
FROM vehicle_assumptions AS va
WHERE va.version = p.assumption_version
  AND va.vehicle_code = p.vehicle_code;

ALTER TABLE plan_versions ENABLE TRIGGER plan_versions_immutable;

ALTER TABLE plan_versions
  ALTER COLUMN calculation_context SET NOT NULL,
  ADD CONSTRAINT plan_versions_calculation_context_check CHECK (
    jsonb_typeof(calculation_context) = 'object'
    AND calculation_context->>'contextVersion' = 'plan-calculation-context-v1'
    AND jsonb_typeof(calculation_context->'personalPrincipalCents') = 'number'
    AND jsonb_typeof(calculation_context->'totalLedgerValueCents') = 'number'
    AND jsonb_typeof(calculation_context->'currentAvailableFundsCents') = 'number'
    AND jsonb_typeof(calculation_context->'currentAccruedInterestMicros') = 'number'
    AND jsonb_typeof(calculation_context->'applicationDate') = 'string'
    AND jsonb_typeof(calculation_context->'scheduleAnchorDate') = 'string'
    AND jsonb_typeof(calculation_context->'omittedContributionDates') = 'array'
    AND jsonb_typeof(calculation_context->'fixedTermLots') = 'array'
    AND (calculation_context->>'personalPrincipalCents')::numeric >= 0
    AND (calculation_context->>'totalLedgerValueCents')::numeric >=
      (calculation_context->>'personalPrincipalCents')::numeric
    AND (calculation_context->>'currentAvailableFundsCents')::numeric BETWEEN 0 AND
      (calculation_context->>'totalLedgerValueCents')::numeric
    AND calculation_context->>'currentAccruedInterestMicros' ~ '^[0-9]+$'
    AND (calculation_context->>'currentAccruedInterestMicros')::numeric
      BETWEEN 0 AND 9007199254740991
  );

CREATE FUNCTION populate_plan_calculation_context() RETURNS trigger AS $$
DECLARE
  resolved_application_date date;
  resolved_schedule_anchor date;
  resolved_personal_principal bigint;
  resolved_target_date date;
  resolved_lock_days integer;
BEGIN
  IF NEW.calculation_context IS NOT NULL THEN
    RETURN NEW;
  END IF;
  resolved_application_date := COALESCE(
    NEW.application_date,
    CASE
      WHEN NEW.calculation_output->>'asOfDate' ~ '^\d{4}-\d{2}-\d{2}$'
        AND pg_input_is_valid(NEW.calculation_output->>'asOfDate', 'date')
        THEN (NEW.calculation_output->>'asOfDate')::date
      ELSE CURRENT_DATE
    END
  );
  resolved_schedule_anchor := COALESCE(NEW.schedule_anchor_date, resolved_application_date);
  resolved_personal_principal := CASE
    WHEN NEW.normalized_input->>'currentSavedCents' ~ '^[0-9]+$'
      THEN (NEW.normalized_input->>'currentSavedCents')::bigint
    ELSE 0
  END;
  resolved_target_date := CASE
    WHEN NEW.normalized_input->>'targetDate' ~ '^\d{4}-\d{2}-\d{2}$'
      AND pg_input_is_valid(NEW.normalized_input->>'targetDate', 'date')
      THEN (NEW.normalized_input->>'targetDate')::date
    ELSE NULL
  END;
  SELECT lock_days INTO resolved_lock_days
  FROM vehicle_assumptions
  WHERE version = NEW.assumption_version AND vehicle_code = NEW.vehicle_code;
  resolved_lock_days := COALESCE(resolved_lock_days, 0);

  NEW.calculation_context := jsonb_build_object(
    'contextVersion', 'plan-calculation-context-v1',
    'personalPrincipalCents', resolved_personal_principal,
    'totalLedgerValueCents', resolved_personal_principal,
    'currentAvailableFundsCents', CASE
      WHEN NEW.vehicle_code IN ('cd_ladder', 'treasury_ladder') THEN 0
      ELSE resolved_personal_principal
    END,
    'currentAccruedInterestMicros', 0,
    'applicationDate', to_char(resolved_application_date, 'YYYY-MM-DD'),
    'scheduleAnchorDate', to_char(resolved_schedule_anchor, 'YYYY-MM-DD'),
    'omittedContributionDates', to_jsonb(COALESCE(NEW.omitted_contribution_dates, '{}'::date[])),
    'fixedTermLots', CASE
      WHEN NEW.vehicle_code IN ('cd_ladder', 'treasury_ladder')
        AND resolved_personal_principal > 0
      THEN jsonb_build_array(jsonb_build_object(
        'personalPrincipalCents', resolved_personal_principal,
        'currentBalanceCents', resolved_personal_principal,
        'firstMaturityDate', to_char(
          resolved_application_date + resolved_lock_days,
          'YYYY-MM-DD'
        ),
        'nextMaturityDate', to_char(
          resolved_application_date + resolved_lock_days,
          'YYYY-MM-DD'
        ),
        'nextMaturityInterestEligible', resolved_target_date IS NOT NULL
          AND resolved_application_date + resolved_lock_days <= resolved_target_date
      ))
      ELSE '[]'::jsonb
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER plan_versions_calculation_context_insert
  BEFORE INSERT ON plan_versions
  FOR EACH ROW EXECUTE FUNCTION populate_plan_calculation_context();

CREATE FUNCTION simulated_account_available_balance(
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
             source.principal_cents + COALESCE(SUM(maturity.interest_cents), 0)
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
    WHERE CASE
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
