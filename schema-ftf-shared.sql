CREATE TABLE IF NOT EXISTS ftf_dossiers (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ftf_dossiers_updated_at_idx
ON ftf_dossiers (updated_at DESC);

ALTER TABLE ftf_dossiers ENABLE ROW LEVEL SECURITY;
