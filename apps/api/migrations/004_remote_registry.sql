CREATE TABLE remotes (
  name text PRIMARY KEY,
  canary_url text,
  canary_percent integer NOT NULL DEFAULT 0 CHECK (canary_percent BETWEEN 0 AND 100),
  disabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO remotes (name) VALUES ('dashboard'), ('orders'), ('products')
ON CONFLICT DO NOTHING;
