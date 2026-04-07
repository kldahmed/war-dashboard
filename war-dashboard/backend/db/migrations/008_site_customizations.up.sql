CREATE TABLE IF NOT EXISTS site_customizations (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_customizations_key
  ON site_customizations(key);