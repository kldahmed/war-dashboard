DROP INDEX IF EXISTS idx_stream_channels_playback_mode;
DROP INDEX IF EXISTS idx_stream_channels_status;
DROP TABLE IF EXISTS stream_channels;

DROP INDEX IF EXISTS idx_ingestion_feed_runs_status;
DROP INDEX IF EXISTS idx_ingestion_feed_runs_job;
DROP TABLE IF EXISTS ingestion_feed_runs;

DROP INDEX IF EXISTS idx_ingestion_runs_status;
DROP INDEX IF EXISTS idx_ingestion_runs_source;
DROP TABLE IF EXISTS ingestion_runs;

DROP INDEX IF EXISTS idx_normalized_items_news_category;

ALTER TABLE normalized_items
  DROP CONSTRAINT IF EXISTS fk_normalized_items_news_category;

DROP TABLE IF EXISTS news_categories;

DROP INDEX IF EXISTS idx_normalized_items_translation_status;

ALTER TABLE normalized_items
  DROP COLUMN IF EXISTS category_confidence_score,
  DROP COLUMN IF EXISTS news_category_id,
  DROP COLUMN IF EXISTS translation_error_message,
  DROP COLUMN IF EXISTS translation_updated_at,
  DROP COLUMN IF EXISTS translation_provider,
  DROP COLUMN IF EXISTS translation_status,
  DROP COLUMN IF EXISTS translated_summary_ar,
  DROP COLUMN IF EXISTS translated_title_ar,
  DROP COLUMN IF EXISTS original_summary,
  DROP COLUMN IF EXISTS original_title;

DROP INDEX IF EXISTS idx_source_feeds_registry_feed_id;

ALTER TABLE source_feeds
  DROP COLUMN IF EXISTS retry_limit,
  DROP COLUMN IF EXISTS registry_feed_id;

DROP INDEX IF EXISTS idx_sources_registry_id;

ALTER TABLE sources
  DROP COLUMN IF EXISTS source_group,
  DROP COLUMN IF EXISTS homepage_url,
  DROP COLUMN IF EXISTS registry_id;