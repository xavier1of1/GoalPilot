ALTER TABLE goals
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archive_reason text;

UPDATE goals AS goal
SET archived_at = COALESCE((
      SELECT MAX(event.created_at)
      FROM audit_events AS event
      WHERE event.user_id = goal.user_id
        AND event.resource_id = goal.id
        AND event.event_name = 'goal.archived'
    ), goal.updated_at),
    archive_reason = COALESCE((
      SELECT CASE
        WHEN event.metadata->>'reasonCode' IN (
          'USER_REQUESTED', 'GOAL_COMPLETED', 'NO_LONGER_PURSUED'
        ) THEN event.metadata->>'reasonCode'
        ELSE NULL
      END
      FROM audit_events AS event
      WHERE event.user_id = goal.user_id
        AND event.resource_id = goal.id
        AND event.event_name = 'goal.archived'
      ORDER BY event.created_at DESC, event.id DESC
      LIMIT 1
    ), 'GOAL_COMPLETED')
WHERE goal.status = 'archived';

ALTER TABLE goals
  ADD CONSTRAINT goals_archive_provenance_check CHECK (
    (
      status = 'archived'
      AND archived_at IS NOT NULL
      AND archive_reason IN ('USER_REQUESTED', 'GOAL_COMPLETED', 'NO_LONGER_PURSUED')
    ) OR (
      status <> 'archived'
      AND archived_at IS NULL
      AND archive_reason IS NULL
    )
  );

ALTER TABLE price_observations
  ADD COLUMN observation_key text;

-- Older deterministic rows did not persist the provider key. Preserve them with
-- a stable, collision-free key derived from the already-unique observation date.
ALTER TABLE price_observations DISABLE TRIGGER price_observations_immutable;

UPDATE price_observations
SET observation_key = 'stored-' || to_char(observed_on, 'YYYY-MM-DD');

ALTER TABLE price_observations ENABLE TRIGGER price_observations_immutable;

ALTER TABLE price_observations
  ALTER COLUMN observation_key SET NOT NULL,
  ADD CONSTRAINT price_observations_observation_key_check CHECK (
    observation_key ~ '^[a-z0-9_-]{1,40}$'
  ),
  ADD CONSTRAINT price_observations_source_key_unique UNIQUE (
    purchase_item_id, fixture_source_version, observation_key
  );
