ALTER TABLE IF EXISTS raw_items DROP CONSTRAINT IF EXISTS fk_raw_items_ingest_job;

DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS ai_runs;
DROP TABLE IF EXISTS normalized_items;
DROP TABLE IF EXISTS raw_items;
DROP TABLE IF EXISTS source_feeds;
DROP TABLE IF EXISTS sources;
DROP TABLE IF EXISTS processing_jobs;
