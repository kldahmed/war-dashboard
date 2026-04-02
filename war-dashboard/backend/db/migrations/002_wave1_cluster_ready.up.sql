ALTER TABLE normalized_items
  ADD COLUMN IF NOT EXISTS title_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS content_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS time_bucket_30m TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_normalized_items_title_fingerprint
  ON normalized_items(title_fingerprint);

CREATE INDEX IF NOT EXISTS idx_normalized_items_content_fingerprint
  ON normalized_items(content_fingerprint);

CREATE INDEX IF NOT EXISTS idx_normalized_items_time_bucket_30m
  ON normalized_items(time_bucket_30m DESC);

CREATE TABLE IF NOT EXISTS story_clusters (
  id BIGSERIAL PRIMARY KEY,
  cluster_key TEXT NOT NULL,
  canonical_title TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cluster_key)
);

CREATE INDEX IF NOT EXISTS idx_story_clusters_last_seen
  ON story_clusters(last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_story_clusters_status
  ON story_clusters(status);

CREATE TABLE IF NOT EXISTS cluster_events (
  id BIGSERIAL PRIMARY KEY,
  cluster_id BIGINT NOT NULL REFERENCES story_clusters(id) ON DELETE CASCADE,
  normalized_item_id BIGINT NOT NULL REFERENCES normalized_items(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'linked',
  event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  novelty_hint NUMERIC(5,2),
  duplicate_risk_hint NUMERIC(5,2),
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(cluster_id, normalized_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_events_cluster_time
  ON cluster_events(cluster_id, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_cluster_events_normalized_item
  ON cluster_events(normalized_item_id);

CREATE TABLE IF NOT EXISTS article_versions (
  id BIGSERIAL PRIMARY KEY,
  normalized_item_id BIGINT NOT NULL REFERENCES normalized_items(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  title_fingerprint TEXT,
  content_fingerprint TEXT,
  change_reason TEXT NOT NULL DEFAULT 'ingestion_update',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(normalized_item_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_article_versions_item_version
  ON article_versions(normalized_item_id, version_no DESC);
