CREATE TABLE user_application_clocks (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  initial_application_date date NOT NULL,
  application_date date NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (application_date >= initial_application_date),
  CHECK (updated_at >= created_at)
);

INSERT INTO user_application_clocks (
  user_id, initial_application_date, application_date
)
SELECT users.id, application_clock.application_date, application_clock.application_date
FROM users CROSS JOIN application_clock
WHERE application_clock.singleton = true
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE demo_fixture_users (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  fixture_key text NOT NULL UNIQUE CHECK (fixture_key = 'japan-trip'),
  fixture_version text NOT NULL CHECK (fixture_version ~ '^[a-z][a-z0-9-]{0,63}$'),
  reset_generation integer NOT NULL DEFAULT 0 CHECK (reset_generation >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (updated_at >= created_at)
);

CREATE OR REPLACE FUNCTION validate_demo_fixture_user_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'demo fixture capabilities are immutable outside owner deletion';
  END IF;
  IF NEW.user_id <> OLD.user_id
    OR NEW.fixture_key <> OLD.fixture_key
    OR NEW.fixture_version <> OLD.fixture_version
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'demo fixture identity and version are immutable';
  END IF;
  IF NEW.reset_generation <> OLD.reset_generation + 1 THEN
    RAISE EXCEPTION 'demo fixture reset generation must advance exactly once';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'demo fixture update time cannot move backward';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER demo_fixture_users_validate_mutation
  BEFORE UPDATE OR DELETE ON demo_fixture_users
  FOR EACH ROW EXECUTE FUNCTION validate_demo_fixture_user_mutation();

CREATE OR REPLACE FUNCTION validate_user_application_clock_update() RETURNS trigger AS $$
DECLARE
  reset_capable boolean;
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.initial_application_date <> OLD.initial_application_date
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'controlled clock ownership and initial date are immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'controlled clock version must advance exactly once';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'controlled clock update time cannot move backward';
  END IF;
  IF NEW.application_date < OLD.application_date THEN
    SELECT EXISTS(
      SELECT 1 FROM demo_fixture_users fixture WHERE fixture.user_id = OLD.user_id
    ) INTO reset_capable;
    IF NOT reset_capable OR NEW.application_date <> OLD.initial_application_date THEN
      RAISE EXCEPTION 'a controlled clock cannot move backward outside a seeded fixture reset';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_application_clocks_validate_update
  BEFORE UPDATE ON user_application_clocks
  FOR EACH ROW EXECUTE FUNCTION validate_user_application_clock_update();

CREATE OR REPLACE FUNCTION initialize_user_application_clock() RETURNS trigger AS $$
DECLARE
  seeded_date date;
BEGIN
  SELECT application_date INTO seeded_date FROM application_clock WHERE singleton = true;
  IF seeded_date IS NOT NULL THEN
    INSERT INTO user_application_clocks (
      user_id, initial_application_date, application_date
    ) VALUES (NEW.id, seeded_date, seeded_date)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_initialize_application_clock
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION initialize_user_application_clock();

CREATE OR REPLACE FUNCTION initialize_missing_user_application_clocks() RETURNS trigger AS $$
BEGIN
  INSERT INTO user_application_clocks (
    user_id, initial_application_date, application_date
  )
  SELECT users.id, NEW.application_date, NEW.application_date FROM users
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER application_clock_initialize_user_clocks
  AFTER INSERT ON application_clock
  FOR EACH ROW EXECUTE FUNCTION initialize_missing_user_application_clocks();

CREATE TABLE product_events (
  id text PRIMARY KEY CHECK (char_length(id) = 26),
  event_name text NOT NULL CHECK (event_name IN (
    'sample_goal_opened',
    'builder_started',
    'builder_step_completed',
    'safe_baseline_viewed',
    'plan_previewed',
    'vehicle_details_opened',
    'simulated_plan_activated',
    'what_if_previewed',
    'recovery_option_applied',
    'autopilot_advanced',
    'plan_paused',
    'plan_resumed',
    'plan_purchase_ready',
    'plan_completed',
    'plan_archived',
    'purchase_timing_viewed'
  )),
  occurred_at timestamptz NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('user', 'anonymous')),
  subject_hash char(64) NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  builder_step text CHECK (
    builder_step IS NULL OR builder_step IN ('goal', 'starting_point', 'budget_fit', 'access', 'review')
  ),
  vehicle_code text CHECK (
    vehicle_code IS NULL OR vehicle_code IN ('cash', 'hysa', 'cd_ladder', 'treasury_ladder')
  ),
  rejection_code text CHECK (
    rejection_code IS NULL OR rejection_code IN (
      'ASSUMPTION_DISABLED',
      'ASSUMPTION_NOT_EFFECTIVE',
      'ASSUMPTION_STALE',
      'LIQUIDITY_CONFLICT',
      'HORIZON_TOO_SHORT',
      'BELOW_MINIMUM'
    )
  ),
  changed_dimension text CHECK (
    changed_dimension IS NULL OR changed_dimension IN (
      'recurring_contribution', 'target_date', 'target_amount', 'missed_contribution'
    )
  ),
  is_demo boolean NOT NULL,
  application_version text NOT NULL CHECK (application_version = 'product-experience-v1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (event_name = 'builder_step_completed' AND builder_step IS NOT NULL)
    OR (event_name <> 'builder_step_completed' AND builder_step IS NULL)
  ),
  CHECK (
    (event_name IN ('vehicle_details_opened', 'simulated_plan_activated') AND vehicle_code IS NOT NULL)
    OR (event_name NOT IN ('vehicle_details_opened', 'simulated_plan_activated') AND vehicle_code IS NULL)
  ),
  CHECK (
    rejection_code IS NULL OR event_name = 'vehicle_details_opened'
  ),
  CHECK (
    (event_name IN ('what_if_previewed', 'recovery_option_applied') AND changed_dimension IS NOT NULL)
    OR (event_name NOT IN ('what_if_previewed', 'recovery_option_applied') AND changed_dimension IS NULL)
  ),
  CHECK (
    event_name <> 'recovery_option_applied'
    OR changed_dimension IN ('recurring_contribution', 'target_date', 'target_amount')
  )
);
CREATE INDEX product_events_funnel_idx ON product_events(event_name, occurred_at);
CREATE INDEX product_events_subject_idx ON product_events(subject_hash, occurred_at);

CREATE OR REPLACE FUNCTION prevent_product_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'product events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_events_immutable
  BEFORE UPDATE OR DELETE ON product_events
  FOR EACH ROW EXECUTE FUNCTION prevent_product_event_mutation();
