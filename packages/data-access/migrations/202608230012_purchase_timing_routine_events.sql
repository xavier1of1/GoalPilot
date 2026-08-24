ALTER TABLE product_events
  DROP CONSTRAINT product_events_event_name_check;

ALTER TABLE product_events
  ADD CONSTRAINT product_events_event_name_check CHECK (event_name IN (
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
    'purchase_timing_viewed',
    'purchase_timing_check_completed',
    'purchase_timing_check_failed',
    'purchase_timing_check_replayed',
    'purchase_timing_check_no_due'
  ));
