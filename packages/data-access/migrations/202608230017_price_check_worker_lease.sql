ALTER TABLE price_check_runs
  ADD COLUMN worker_claim_token text,
  ADD COLUMN worker_lease_expires_at timestamptz;

-- The existing immutable-state trigger intentionally rejects claimed-to-claimed
-- application updates. Disable only that known trigger for this one-time catalog
-- backfill, then restore it before adding the new invariant.
ALTER TABLE price_check_runs DISABLE TRIGGER price_check_runs_validate_mutation;

UPDATE price_check_runs
SET worker_claim_token = upper(substr(md5(id || ':price-check-worker-v1'), 1, 26)),
    worker_lease_expires_at = claimed_at + interval '10 minutes'
WHERE status = 'claimed';

ALTER TABLE price_check_runs ENABLE TRIGGER price_check_runs_validate_mutation;

ALTER TABLE price_check_runs
  ADD CONSTRAINT price_check_runs_worker_claim_shape_check CHECK (
    (
      status = 'claimed'
      AND worker_claim_token ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
      AND worker_lease_expires_at IS NOT NULL
    ) OR (
      status IN ('completed', 'failed')
      AND worker_claim_token IS NULL
      AND worker_lease_expires_at IS NULL
    )
  );
