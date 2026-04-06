CREATE TABLE IF NOT EXISTS signal_snapshots (
  name TEXT PRIMARY KEY,
  payload_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_snapshots_updated_at
  ON signal_snapshots (updated_at DESC);
