DROP TABLE IF EXISTS article_versions;
DROP TABLE IF EXISTS cluster_events;
DROP TABLE IF EXISTS story_clusters;

DROP INDEX IF EXISTS idx_normalized_items_time_bucket_30m;
DROP INDEX IF EXISTS idx_normalized_items_content_fingerprint;
DROP INDEX IF EXISTS idx_normalized_items_title_fingerprint;

ALTER TABLE normalized_items
  DROP COLUMN IF EXISTS time_bucket_30m,
  DROP COLUMN IF EXISTS content_fingerprint,
  DROP COLUMN IF EXISTS title_fingerprint;
