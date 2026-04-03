CREATE TABLE IF NOT EXISTS intelligence_digests (
  id                 BIGSERIAL PRIMARY KEY,
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  escalation_level   TEXT        NOT NULL DEFAULT 'low',
  headline           TEXT        NOT NULL,
  situation_summary  TEXT        NOT NULL,
  key_actors         JSONB       NOT NULL DEFAULT '[]',
  active_fronts      JSONB       NOT NULL DEFAULT '[]',
  contradictions     JSONB       NOT NULL DEFAULT '[]',
  source_item_ids    JSONB       NOT NULL DEFAULT '[]',
  model              TEXT,
  latency_ms         INTEGER,
  correlation_id     TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intelligence_digests_generated
  ON intelligence_digests(generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_intelligence_digests_escalation
  ON intelligence_digests(escalation_level, generated_at DESC);
