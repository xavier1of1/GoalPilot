CREATE TABLE application_command_claims (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (char_length(operation) BETWEEN 1 AND 100),
  key text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('claimed', 'retryable')),
  claim_token text CHECK (claim_token IS NULL OR char_length(claim_token) = 26),
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation, key),
  CHECK (updated_at >= created_at),
  CHECK (
    (state = 'claimed' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state = 'retryable' AND claim_token IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX application_command_claims_lease_idx
  ON application_command_claims(state, lease_expires_at)
  WHERE state = 'claimed';
