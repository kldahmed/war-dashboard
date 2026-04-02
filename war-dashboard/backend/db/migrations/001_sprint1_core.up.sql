CREATE TABLE IF NOT EXISTS sources (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  region TEXT NOT NULL,
  language TEXT NOT NULL,
  category TEXT NOT NULL,
  official_flag BOOLEAN NOT NULL DEFAULT FALSE,
  trust_score NUMERIC(5,2) NOT NULL DEFAULT 50.00,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(domain)
);

CREATE TABLE IF NOT EXISTS source_feeds (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  feed_type TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  polling_interval_sec INTEGER NOT NULL DEFAULT 300,
  status TEXT NOT NULL DEFAULT 'active',
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, endpoint)
);

CREATE TABLE IF NOT EXISTS raw_items (
  id BIGSERIAL PRIMARY KEY,
  source_feed_id BIGINT NOT NULL REFERENCES source_feeds(id) ON DELETE CASCADE,
  external_id TEXT,
  source_url TEXT,
  title TEXT,
  published_at_source TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload_json JSONB NOT NULL,
  content_hash_raw TEXT NOT NULL,
  ingest_job_id BIGINT,
  status TEXT NOT NULL DEFAULT 'ingested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_items_feed_external_unique
  ON raw_items(source_feed_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_items_feed_hash_unique
  ON raw_items(source_feed_id, content_hash_raw);

CREATE INDEX IF NOT EXISTS idx_raw_items_fetched_at ON raw_items(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_items_source_url ON raw_items(source_url);

CREATE TABLE IF NOT EXISTS normalized_items (
  id BIGSERIAL PRIMARY KEY,
  raw_item_id BIGINT NOT NULL REFERENCES raw_items(id) ON DELETE CASCADE,
  source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  canonical_title TEXT NOT NULL,
  canonical_body TEXT NOT NULL,
  language TEXT NOT NULL,
  published_at_source TIMESTAMPTZ,
  source_url TEXT,
  normalized_hash TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(raw_item_id)
);

CREATE INDEX IF NOT EXISTS idx_normalized_items_published ON normalized_items(published_at_source DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_normalized_items_hash ON normalized_items(normalized_hash);
CREATE INDEX IF NOT EXISTS idx_normalized_items_source ON normalized_items(source_id);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  latency_ms INTEGER,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  correlation_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_type_status ON processing_jobs(job_type, status);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_created ON processing_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS ai_runs (
  id BIGSERIAL PRIMARY KEY,
  service_type TEXT NOT NULL,
  model TEXT,
  input_ref TEXT,
  output_ref TEXT,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'completed',
  error_message TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_service_created ON ai_runs(service_type, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

ALTER TABLE raw_items
  ADD CONSTRAINT fk_raw_items_ingest_job
  FOREIGN KEY (ingest_job_id) REFERENCES processing_jobs(id) ON DELETE SET NULL;
