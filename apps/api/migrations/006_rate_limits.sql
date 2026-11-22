-- Shared rate-limit counters (T51). Keys are hashed, never raw IPs; rows are pruned by the store.
CREATE TABLE rate_limits (
  key      text PRIMARY KEY,
  count    integer NOT NULL,
  reset_at timestamptz NOT NULL
);
