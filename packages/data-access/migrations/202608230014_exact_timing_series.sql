-- Preserve the exact raw series used by each completed assessment. Provider
-- observation keys are stable within a source, but separate keyed observations
-- may legitimately share a calendar date.
DO $$
DECLARE
  constraint_to_drop text;
BEGIN
  FOR constraint_to_drop IN
    SELECT constraint_row.conname
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'price_observations'::regclass
      AND constraint_row.contype = 'u'
      AND constraint_row.conkey IN (
        ARRAY[
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'price_observations'::regclass
             AND attname = 'purchase_item_id'),
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'price_observations'::regclass
             AND attname = 'fixture_source_version'),
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'price_observations'::regclass
             AND attname = 'observed_on')
        ]::smallint[],
        ARRAY[
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'price_observations'::regclass
             AND attname = 'purchase_item_id'),
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'price_observations'::regclass
             AND attname = 'fixture_source_version'),
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'price_observations'::regclass
             AND attname = 'observation_key')
        ]::smallint[]
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE price_observations DROP CONSTRAINT %I',
      constraint_to_drop
    );
  END LOOP;
END $$;

-- Before this migration observations were shared globally by source/date. Copy
-- the historical prefix used by each immutable assessment into its own run so
-- upgraded databases retain the same assessment-to-series relationship.
ALTER TABLE price_observations DISABLE TRIGGER price_observations_validate_insert;

INSERT INTO price_observations (
  id, price_check_run_id, purchase_item_id, user_id, fixture_source_version,
  observation_key, observed_on, price_cents, currency, created_at
)
SELECT
  substr(md5(assessment.id || ':' || source.id) || md5(source.id || ':' || assessment.id), 1, 26),
  assessment.price_check_run_id, assessment.purchase_item_id, assessment.user_id,
  assessment.fixture_source_version, source.observation_key, source.observed_on,
  source.price_cents, source.currency, assessment.created_at
FROM purchase_timing_assessments assessment
JOIN price_observations source
  ON source.purchase_item_id = assessment.purchase_item_id
  AND source.user_id = assessment.user_id
  AND source.fixture_source_version = assessment.fixture_source_version
  AND source.observed_on >= assessment.as_of_date - 730
  AND source.observed_on <= assessment.as_of_date
WHERE NOT EXISTS (
  SELECT 1 FROM price_observations owned
  WHERE owned.price_check_run_id = assessment.price_check_run_id
    AND owned.observation_key = source.observation_key
);

ALTER TABLE price_observations ENABLE TRIGGER price_observations_validate_insert;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM purchase_timing_assessments assessment
    WHERE assessment.observation_count <> (
      SELECT COUNT(*)
      FROM price_observations observation
      WHERE observation.price_check_run_id = assessment.price_check_run_id
    )
  ) THEN
    RAISE EXCEPTION 'legacy timing assessment observation membership cannot be reconstructed';
  END IF;
END $$;

ALTER TABLE price_observations
  ADD CONSTRAINT price_observations_run_key_unique
  UNIQUE (price_check_run_id, observation_key);

CREATE INDEX price_observations_source_key_idx
  ON price_observations(
    user_id, purchase_item_id, fixture_source_version, observation_key
  );

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

  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.purchase_item_id || ':' || NEW.fixture_source_version || ':' || NEW.observation_key,
    0
  ));
  IF EXISTS (
    SELECT 1 FROM price_observations existing
    WHERE existing.purchase_item_id = NEW.purchase_item_id
      AND existing.user_id = NEW.user_id
      AND existing.fixture_source_version = NEW.fixture_source_version
      AND existing.observation_key = NEW.observation_key
      AND (
        existing.observed_on <> NEW.observed_on
        OR existing.price_cents <> NEW.price_cents
        OR existing.currency <> NEW.currency
      )
  ) THEN
    RAISE EXCEPTION 'a historical observation conflicts with stored data';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
