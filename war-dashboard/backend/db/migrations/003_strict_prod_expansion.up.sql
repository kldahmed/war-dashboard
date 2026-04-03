ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS registry_id TEXT,
  ADD COLUMN IF NOT EXISTS homepage_url TEXT,
  ADD COLUMN IF NOT EXISTS source_group TEXT NOT NULL DEFAULT 'optional_specialist';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_registry_id
  ON sources(registry_id)
  WHERE registry_id IS NOT NULL;

ALTER TABLE source_feeds
  ADD COLUMN IF NOT EXISTS registry_feed_id TEXT,
  ADD COLUMN IF NOT EXISTS retry_limit SMALLINT NOT NULL DEFAULT 2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_feeds_registry_feed_id
  ON source_feeds(registry_feed_id)
  WHERE registry_feed_id IS NOT NULL;

ALTER TABLE normalized_items
  ADD COLUMN IF NOT EXISTS original_title TEXT,
  ADD COLUMN IF NOT EXISTS original_summary TEXT,
  ADD COLUMN IF NOT EXISTS translated_title_ar TEXT,
  ADD COLUMN IF NOT EXISTS translated_summary_ar TEXT,
  ADD COLUMN IF NOT EXISTS translation_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS translation_provider TEXT,
  ADD COLUMN IF NOT EXISTS translation_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS translation_error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_normalized_items_translation_status
  ON normalized_items(translation_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_feed_runs (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT REFERENCES processing_jobs(id) ON DELETE CASCADE,
  source_feed_id BIGINT REFERENCES source_feeds(id) ON DELETE SET NULL,
  source_id BIGINT REFERENCES sources(id) ON DELETE SET NULL,
  source_registry_id TEXT,
  feed_name TEXT,
  feed_endpoint TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  raw_seen_count INTEGER NOT NULL DEFAULT 0,
  raw_inserted_count INTEGER NOT NULL DEFAULT 0,
  raw_updated_count INTEGER NOT NULL DEFAULT 0,
  normalized_count INTEGER NOT NULL DEFAULT 0,
  translated_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  latency_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_feed_runs_job
  ON ingestion_feed_runs(job_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_feed_runs_status
  ON ingestion_feed_runs(status, started_at DESC);

CREATE TABLE IF NOT EXISTS stream_channels (
  id BIGSERIAL PRIMARY KEY,
  registry_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ar',
  provider TEXT NOT NULL,
  source_domain TEXT,
  official_page_url TEXT NOT NULL,
  embed_url TEXT,
  external_watch_url TEXT,
  embed_supported BOOLEAN NOT NULL DEFAULT FALSE,
  playback_mode TEXT NOT NULL DEFAULT 'external_only',
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 100,
  verification_checked_at TIMESTAMPTZ,
  last_verification_status TEXT,
  last_verification_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_channels_status
  ON stream_channels(status, sort_order ASC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_stream_channels_playback_mode
  ON stream_channels(playback_mode, status, sort_order ASC);