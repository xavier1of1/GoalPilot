CREATE TABLE purchase_items (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id text NOT NULL,
  fixture_code text NOT NULL CHECK (fixture_code = 'synthetic_oled_65_v1'),
  display_name text NOT NULL CHECK (display_name = '65-inch OLED television'),
  currency text NOT NULL CHECK (currency = 'USD'),
  target_price_cents bigint NOT NULL CHECK (target_price_cents BETWEEN 1 AND 100000000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id),
  UNIQUE (id, goal_id, user_id),
  FOREIGN KEY (goal_id, user_id) REFERENCES goals(id, user_id) ON DELETE CASCADE,
  CHECK (updated_at >= created_at)
);
CREATE INDEX purchase_items_owner_lifecycle_idx
  ON purchase_items(user_id, lifecycle, updated_at DESC, id);

CREATE OR REPLACE FUNCTION validate_purchase_item_update() RETURNS trigger AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.goal_id <> OLD.goal_id
    OR NEW.fixture_code <> OLD.fixture_code OR NEW.display_name <> OLD.display_name
    OR NEW.currency <> OLD.currency OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'purchase item ownership and fixture identity are immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'purchase item version must advance exactly once';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'purchase item update time cannot move backward';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER purchase_items_validate_update
  BEFORE UPDATE ON purchase_items
  FOR EACH ROW EXECUTE FUNCTION validate_purchase_item_update();

CREATE TABLE price_watch_policies (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  purchase_item_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  cadence text NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
  next_due_date date NOT NULL,
  freshness_limit_days integer NOT NULL DEFAULT 14 CHECK (freshness_limit_days = 14),
  analysis_policy_version text NOT NULL DEFAULT 'purchase-timing-v1'
    CHECK (analysis_policy_version = 'purchase-timing-v1'),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_item_id, version),
  UNIQUE (id, purchase_item_id, user_id),
  FOREIGN KEY (purchase_item_id, user_id)
    REFERENCES purchase_items(id, user_id) ON DELETE CASCADE
);
CREATE INDEX price_watch_policies_due_idx
  ON price_watch_policies(user_id, enabled, next_due_date, purchase_item_id, version DESC);

CREATE OR REPLACE FUNCTION prevent_price_watch_policy_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'price watch policies are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER price_watch_policies_immutable
  BEFORE UPDATE OR DELETE ON price_watch_policies
  FOR EACH ROW EXECUTE FUNCTION prevent_price_watch_policy_mutation();

CREATE TABLE price_check_runs (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  price_watch_policy_id text NOT NULL,
  purchase_item_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_date date NOT NULL,
  fixture_source_version text
    CHECK (fixture_source_version IS NULL OR fixture_source_version ~ '^[a-z0-9._-]{1,80}$'),
  fixture_source_checksum char(64)
    CHECK (fixture_source_checksum IS NULL OR fixture_source_checksum ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'completed', 'failed')),
  error_code text CHECK (error_code IS NULL OR error_code IN (
    'PROVIDER_FAILURE', 'INVALID_PRICE_BATCH', 'CURRENCY_MISMATCH', 'FUTURE_OBSERVATION',
    'CONFLICTING_OBSERVATION', 'ASSESSMENT_FAILURE'
  )),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 3),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (price_watch_policy_id, application_date),
  UNIQUE (id, purchase_item_id, user_id),
  FOREIGN KEY (price_watch_policy_id, purchase_item_id, user_id)
    REFERENCES price_watch_policies(id, purchase_item_id, user_id) ON DELETE CASCADE,
  CHECK (
    (status = 'claimed' AND error_code IS NULL AND completed_at IS NULL)
    OR (status = 'completed' AND error_code IS NULL AND completed_at IS NOT NULL
      AND fixture_source_version IS NOT NULL AND fixture_source_checksum IS NOT NULL)
    OR (status = 'failed' AND error_code IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CHECK (
    (fixture_source_version IS NULL AND fixture_source_checksum IS NULL)
    OR (fixture_source_version IS NOT NULL AND fixture_source_checksum IS NOT NULL)
  )
);
CREATE INDEX price_check_runs_owner_status_idx
  ON price_check_runs(user_id, status, application_date DESC, id);

CREATE TABLE price_observations (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  price_check_run_id text NOT NULL,
  purchase_item_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fixture_source_version text NOT NULL CHECK (
    fixture_source_version ~ '^[a-z0-9._-]{1,80}$'
  ),
  observed_on date NOT NULL,
  price_cents bigint NOT NULL CHECK (price_cents BETWEEN 1 AND 100000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_item_id, fixture_source_version, observed_on),
  FOREIGN KEY (price_check_run_id, purchase_item_id, user_id)
    REFERENCES price_check_runs(id, purchase_item_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (purchase_item_id, user_id)
    REFERENCES purchase_items(id, user_id) ON DELETE CASCADE
);
CREATE INDEX price_observations_item_date_idx
  ON price_observations(user_id, purchase_item_id, observed_on, id);

CREATE OR REPLACE FUNCTION valid_purchase_timing_seasonal_summary(summary jsonb)
RETURNS boolean AS $$
DECLARE
  month_entry jsonb;
  month_number integer;
  seen_months integer[] := '{}'::integer[];
BEGIN
  IF jsonb_typeof(summary) <> 'object'
    OR summary - 'months' <> '{}'::jsonb
    OR jsonb_typeof(summary->'months') <> 'array'
    OR jsonb_array_length(summary->'months') <> 12 THEN
    RETURN false;
  END IF;
  FOR month_entry IN SELECT value FROM jsonb_array_elements(summary->'months') LOOP
    IF jsonb_typeof(month_entry) <> 'object'
      OR NOT (month_entry ?& ARRAY['month', 'observationCount', 'medianPriceCents'])
      OR month_entry - ARRAY['month', 'observationCount', 'medianPriceCents']::text[]
        <> '{}'::jsonb
      OR jsonb_typeof(month_entry->'month') IS DISTINCT FROM 'number'
      OR jsonb_typeof(month_entry->'observationCount') IS DISTINCT FROM 'number'
      OR jsonb_typeof(month_entry->'medianPriceCents') IS DISTINCT FROM 'number' THEN
      RETURN false;
    END IF;
    IF month_entry->>'month' !~ '^[0-9]+$'
      OR month_entry->>'observationCount' !~ '^[0-9]+$'
      OR month_entry->>'medianPriceCents' !~ '^[0-9]+$'
      THEN
      RETURN false;
    END IF;
    IF (month_entry->>'month')::numeric NOT BETWEEN 1 AND 12
      OR (month_entry->>'observationCount')::numeric < 3
      OR (month_entry->>'medianPriceCents')::numeric NOT BETWEEN 1 AND 100000000 THEN
      RETURN false;
    END IF;
    month_number := (month_entry->>'month')::integer;
    IF month_number = ANY(seen_months) THEN
      RETURN false;
    END IF;
    seen_months := array_append(seen_months, month_number);
  END LOOP;
  RETURN cardinality(seen_months) = 12;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;

CREATE TABLE purchase_timing_assessments (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  price_check_run_id text NOT NULL UNIQUE,
  purchase_item_id text NOT NULL,
  goal_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price_watch_policy_version integer NOT NULL CHECK (price_watch_policy_version > 0),
  plan_version_id text,
  plan_version_number integer CHECK (plan_version_number IS NULL OR plan_version_number > 0),
  plan_lifecycle text NOT NULL CHECK (plan_lifecycle IN ('draft', 'active', 'completed', 'archived')),
  plan_health text CHECK (plan_health IS NULL OR plan_health IN (
    'PAUSED', 'PURCHASE_READY', 'FUNDED_BUT_LOCKED',
    'ATTENTION_NEEDED', 'AHEAD', 'ON_TRACK'
  )),
  plan_health_policy_version text NOT NULL DEFAULT 'plan-health-v1'
    CHECK (plan_health_policy_version = 'plan-health-v1'),
  analysis_policy_version text NOT NULL DEFAULT 'purchase-timing-v1'
    CHECK (analysis_policy_version = 'purchase-timing-v1'),
  fixture_source_version text NOT NULL CHECK (
    fixture_source_version ~ '^[a-z0-9._-]{1,80}$'
  ),
  fixture_source_checksum char(64) NOT NULL CHECK (
    fixture_source_checksum ~ '^[0-9a-f]{64}$'
  ),
  as_of_date date NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  assessment_state text NOT NULL CHECK (assessment_state IN (
    'INSUFFICIENT_DATA',
    'STALE_DATA',
    'HISTORICALLY_FAVORABLE_PLAN_READY',
    'HISTORICALLY_FAVORABLE_PLAN_NOT_READY',
    'HISTORICALLY_ELEVATED',
    'WATCH',
    'HISTORICALLY_TYPICAL'
  )),
  rationale_codes text[] NOT NULL CHECK (
    cardinality(rationale_codes) BETWEEN 1 AND 3
    AND rationale_codes <@ ARRAY[
    'INSUFFICIENT_OBSERVATION_COUNT',
    'INSUFFICIENT_OBSERVATION_SPAN',
    'LATEST_OBSERVATION_STALE',
    'PRICE_AT_OR_BELOW_FAVORABLE_PERCENTILE',
    'PRICE_AT_OR_ABOVE_ELEVATED_PERCENTILE',
    'PRICE_ABOVE_TARGET',
    'PRICE_WITHIN_TYPICAL_RANGE',
    'PLAN_PURCHASE_READY',
    'PLAN_PAUSED',
    'PLAN_FUNDED_BUT_LOCKED',
    'PLAN_NOT_PURCHASE_READY'
    ]::text[]
  ),
  seasonal_summary jsonb,
  observation_count integer NOT NULL CHECK (observation_count > 0),
  earliest_observation_date date NOT NULL,
  latest_observation_date date NOT NULL,
  data_span_days integer NOT NULL CHECK (data_span_days >= 0),
  freshness_days integer NOT NULL CHECK (freshness_days >= 0),
  current_price_cents bigint NOT NULL CHECK (current_price_cents BETWEEN 1 AND 100000000),
  target_price_cents bigint NOT NULL CHECK (target_price_cents BETWEEN 1 AND 100000000),
  minimum_price_cents bigint NOT NULL CHECK (minimum_price_cents BETWEEN 1 AND 100000000),
  median_price_cents bigint NOT NULL CHECK (median_price_cents BETWEEN 1 AND 100000000),
  maximum_price_cents bigint NOT NULL CHECK (maximum_price_cents BETWEEN 1 AND 100000000),
  current_percentile_basis_points integer NOT NULL
    CHECK (current_percentile_basis_points BETWEEN 0 AND 10000),
  difference_from_median_cents bigint NOT NULL,
  difference_from_target_cents bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (price_check_run_id, purchase_item_id, user_id)
    REFERENCES price_check_runs(id, purchase_item_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (purchase_item_id, goal_id, user_id)
    REFERENCES purchase_items(id, goal_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id, goal_id, user_id)
    REFERENCES plan_versions(id, goal_id, user_id) ON DELETE CASCADE,
  CHECK (
    earliest_observation_date <= latest_observation_date
    AND latest_observation_date <= as_of_date
    AND data_span_days = latest_observation_date - earliest_observation_date
    AND freshness_days = as_of_date - latest_observation_date
    AND minimum_price_cents <= median_price_cents
    AND median_price_cents <= maximum_price_cents
    AND current_price_cents BETWEEN minimum_price_cents AND maximum_price_cents
    AND difference_from_median_cents = current_price_cents - median_price_cents
    AND difference_from_target_cents = current_price_cents - target_price_cents
  ),
  CHECK (
    seasonal_summary IS NULL
    OR (data_span_days >= 730 AND valid_purchase_timing_seasonal_summary(seasonal_summary))
  ),
  CHECK (
    (
      plan_version_id IS NULL
      AND plan_version_number IS NULL
      AND plan_health IS NULL
      AND plan_lifecycle = 'draft'
    ) OR (
      plan_version_id IS NOT NULL
      AND plan_version_number IS NOT NULL
      AND plan_health IS NOT NULL
      AND plan_lifecycle <> 'draft'
    )
  ),
  CHECK (
    (
      assessment_state = 'INSUFFICIENT_DATA'
      AND cardinality(rationale_codes) = 1
      AND (
        (
          rationale_codes @> ARRAY['INSUFFICIENT_OBSERVATION_COUNT']::text[]
          AND observation_count < 30
        )
        OR (
          rationale_codes @> ARRAY['INSUFFICIENT_OBSERVATION_SPAN']::text[]
          AND observation_count >= 30
          AND data_span_days < 90
        )
      )
    ) OR (
      assessment_state = 'STALE_DATA'
      AND cardinality(rationale_codes) = 1
      AND observation_count >= 30
      AND data_span_days >= 90
      AND freshness_days > 14
      AND rationale_codes @> ARRAY['LATEST_OBSERVATION_STALE']::text[]
    ) OR (
      assessment_state = 'HISTORICALLY_FAVORABLE_PLAN_READY'
      AND cardinality(rationale_codes) = 2
      AND observation_count >= 30
      AND data_span_days >= 90
      AND freshness_days <= 14
      AND current_percentile_basis_points <= 2500
      AND plan_health = 'PURCHASE_READY'
      AND rationale_codes @> ARRAY[
        'PRICE_AT_OR_BELOW_FAVORABLE_PERCENTILE', 'PLAN_PURCHASE_READY'
      ]::text[]
    ) OR (
      assessment_state = 'HISTORICALLY_FAVORABLE_PLAN_NOT_READY'
      AND cardinality(rationale_codes) = 2
      AND observation_count >= 30
      AND data_span_days >= 90
      AND freshness_days <= 14
      AND current_percentile_basis_points <= 2500
      AND plan_health IS DISTINCT FROM 'PURCHASE_READY'
      AND rationale_codes @> ARRAY['PRICE_AT_OR_BELOW_FAVORABLE_PERCENTILE']::text[]
      AND (
        (plan_health = 'PAUSED' AND rationale_codes @> ARRAY['PLAN_PAUSED']::text[])
        OR (
          plan_health = 'FUNDED_BUT_LOCKED'
          AND rationale_codes @> ARRAY['PLAN_FUNDED_BUT_LOCKED']::text[]
        )
        OR (
          plan_health IS NULL
          AND rationale_codes @> ARRAY['PLAN_NOT_PURCHASE_READY']::text[]
        )
        OR (
          plan_health NOT IN ('PAUSED', 'FUNDED_BUT_LOCKED', 'PURCHASE_READY')
          AND rationale_codes @> ARRAY['PLAN_NOT_PURCHASE_READY']::text[]
        )
      )
    ) OR (
      assessment_state = 'HISTORICALLY_ELEVATED'
      AND cardinality(rationale_codes) = 1
      AND observation_count >= 30
      AND data_span_days >= 90
      AND freshness_days <= 14
      AND current_percentile_basis_points >= 7500
      AND rationale_codes @> ARRAY['PRICE_AT_OR_ABOVE_ELEVATED_PERCENTILE']::text[]
    ) OR (
      assessment_state = 'WATCH'
      AND cardinality(rationale_codes) = 1
      AND observation_count >= 30
      AND data_span_days >= 90
      AND freshness_days <= 14
      AND current_percentile_basis_points > 2500
      AND current_percentile_basis_points < 7500
      AND current_price_cents > target_price_cents
      AND rationale_codes @> ARRAY['PRICE_ABOVE_TARGET']::text[]
    ) OR (
      assessment_state = 'HISTORICALLY_TYPICAL'
      AND cardinality(rationale_codes) = 1
      AND observation_count >= 30
      AND data_span_days >= 90
      AND freshness_days <= 14
      AND current_percentile_basis_points > 2500
      AND current_percentile_basis_points < 7500
      AND current_price_cents <= target_price_cents
      AND rationale_codes @> ARRAY['PRICE_WITHIN_TYPICAL_RANGE']::text[]
    )
  )
);
CREATE INDEX purchase_timing_assessments_item_date_idx
  ON purchase_timing_assessments(user_id, purchase_item_id, as_of_date DESC, id);

CREATE OR REPLACE FUNCTION validate_price_observation() RETURNS trigger AS $$
DECLARE
  run_date date;
  run_source_version text;
  run_status text;
  item_currency text;
BEGIN
  SELECT application_date, fixture_source_version, status
  INTO run_date, run_source_version, run_status
  FROM price_check_runs
  WHERE id = NEW.price_check_run_id
    AND purchase_item_id = NEW.purchase_item_id
    AND user_id = NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a price observation must belong to its owned check run';
  END IF;
  SELECT currency INTO item_currency
  FROM purchase_items
  WHERE id = NEW.purchase_item_id AND user_id = NEW.user_id;
  IF NEW.observed_on > run_date THEN
    RAISE EXCEPTION 'a price observation cannot be after its controlled application date';
  END IF;
  IF run_source_version IS NULL OR NEW.fixture_source_version <> run_source_version THEN
    RAISE EXCEPTION 'a price observation must match its check run source version';
  END IF;
  IF NEW.currency <> item_currency THEN
    RAISE EXCEPTION 'a price observation currency must match its purchase item';
  END IF;
  IF run_status <> 'claimed' THEN
    RAISE EXCEPTION 'only a claimed price check run can append observations';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER price_observations_validate_insert
  BEFORE INSERT ON price_observations
  FOR EACH ROW EXECUTE FUNCTION validate_price_observation();

CREATE OR REPLACE FUNCTION prevent_price_observation_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'price observations are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER price_observations_immutable
  BEFORE UPDATE OR DELETE ON price_observations
  FOR EACH ROW EXECUTE FUNCTION prevent_price_observation_mutation();

CREATE OR REPLACE FUNCTION validate_purchase_timing_assessment() RETURNS trigger AS $$
DECLARE
  run_record price_check_runs%ROWTYPE;
  item_record purchase_items%ROWTYPE;
  stored_plan_version integer;
  stored_policy_version integer;
BEGIN
  SELECT * INTO run_record
  FROM price_check_runs
  WHERE id = NEW.price_check_run_id
    AND purchase_item_id = NEW.purchase_item_id
    AND user_id = NEW.user_id;
  IF NOT FOUND OR run_record.status NOT IN ('claimed', 'completed') THEN
    RAISE EXCEPTION 'an assessment must belong to an active or completed owned check run';
  END IF;
  SELECT * INTO item_record
  FROM purchase_items
  WHERE id = NEW.purchase_item_id
    AND goal_id = NEW.goal_id
    AND user_id = NEW.user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'an assessment must belong to its owned purchase item and goal';
  END IF;
  IF NEW.plan_version_id IS NOT NULL THEN
    SELECT version INTO stored_plan_version
    FROM plan_versions
    WHERE id = NEW.plan_version_id
      AND goal_id = NEW.goal_id
      AND user_id = NEW.user_id;
    IF stored_plan_version IS NULL OR NEW.plan_version_number <> stored_plan_version THEN
      RAISE EXCEPTION 'an assessment plan version snapshot must match its owned immutable plan';
    END IF;
  END IF;
  SELECT version INTO stored_policy_version
  FROM price_watch_policies
  WHERE id = run_record.price_watch_policy_id
    AND purchase_item_id = NEW.purchase_item_id
    AND user_id = NEW.user_id;
  IF stored_policy_version IS NULL THEN
    RAISE EXCEPTION 'an assessment check run must reference an owned watch policy';
  END IF;
  IF NEW.price_watch_policy_version <> stored_policy_version THEN
    RAISE EXCEPTION 'an assessment watch policy version must match its immutable check run policy';
  END IF;
  IF NEW.as_of_date <> run_record.application_date
    OR NEW.fixture_source_version <> run_record.fixture_source_version
    OR NEW.fixture_source_checksum <> run_record.fixture_source_checksum THEN
    RAISE EXCEPTION 'an assessment must match its check run date and fixture provenance';
  END IF;
  IF NEW.currency <> item_record.currency
    OR NEW.target_price_cents <> item_record.target_price_cents THEN
    RAISE EXCEPTION 'an assessment must snapshot its purchase item currency and target';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER purchase_timing_assessments_validate_insert
  BEFORE INSERT ON purchase_timing_assessments
  FOR EACH ROW EXECUTE FUNCTION validate_purchase_timing_assessment();

CREATE OR REPLACE FUNCTION prevent_purchase_timing_assessment_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'purchase timing assessments are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER purchase_timing_assessments_immutable
  BEFORE UPDATE OR DELETE ON purchase_timing_assessments
  FOR EACH ROW EXECUTE FUNCTION prevent_purchase_timing_assessment_mutation();

CREATE OR REPLACE FUNCTION validate_price_check_run_mutation() RETURNS trigger AS $$
DECLARE
  observation_total bigint;
  assessment_total bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'claimed' THEN
      RAISE EXCEPTION 'a price check run must begin in the claimed state';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'price check runs cannot be deleted directly';
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.price_watch_policy_id <> OLD.price_watch_policy_id
    OR NEW.purchase_item_id <> OLD.purchase_item_id
    OR NEW.user_id <> OLD.user_id
    OR NEW.application_date <> OLD.application_date
    OR NEW.claimed_at <> OLD.claimed_at THEN
    RAISE EXCEPTION 'price check run ownership and claim provenance are immutable';
  END IF;
  IF OLD.fixture_source_version IS NOT NULL AND (
    NEW.fixture_source_version IS DISTINCT FROM OLD.fixture_source_version
    OR NEW.fixture_source_checksum IS DISTINCT FROM OLD.fixture_source_checksum
  ) THEN
    RAISE EXCEPTION 'price check run fixture provenance cannot change';
  END IF;
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'a completed price check run is immutable';
  END IF;

  IF OLD.status = 'claimed' AND NEW.status = 'claimed' THEN
    IF NEW.attempt_count <> OLD.attempt_count
      OR OLD.fixture_source_version IS NOT NULL
      OR NEW.fixture_source_version IS NULL
      OR NEW.error_code IS NOT NULL
      OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a claimed run may only attach its fixture provenance once';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'claimed' AND NEW.status IN ('completed', 'failed') THEN
    IF NEW.attempt_count <> OLD.attempt_count THEN
      RAISE EXCEPTION 'a run attempt count cannot change while completing an attempt';
    END IF;
    IF NEW.status = 'completed' THEN
      SELECT count(*) INTO assessment_total
      FROM purchase_timing_assessments WHERE price_check_run_id = OLD.id;
      IF assessment_total <> 1 THEN
        RAISE EXCEPTION 'a completed price check run requires exactly one assessment';
      END IF;
    ELSE
      SELECT count(*) INTO observation_total
      FROM price_observations WHERE price_check_run_id = OLD.id;
      SELECT count(*) INTO assessment_total
      FROM purchase_timing_assessments WHERE price_check_run_id = OLD.id;
      IF observation_total <> 0 OR assessment_total <> 0 THEN
        RAISE EXCEPTION 'a failed price check run cannot retain partial results';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'failed' AND NEW.status = 'claimed' THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1
      OR NEW.error_code IS NOT NULL OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a failed price check retry must advance one bounded attempt';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid price check run state transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER price_check_runs_validate_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON price_check_runs
  FOR EACH ROW EXECUTE FUNCTION validate_price_check_run_mutation();
