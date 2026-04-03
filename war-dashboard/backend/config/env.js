'use strict';

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const databaseUrl = process.env.DATABASE_URL || '';

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3001),
  databaseUrl,
  feedMode: process.env.FEED_MODE || 'stored',
  feedFallbackEnabled:
    String(process.env.FEED_FALLBACK_ENABLED || 'false').toLowerCase() === 'true',
  rssRequestTimeoutMs: toInt(process.env.RSS_REQUEST_TIMEOUT_MS, 15000),
  ingestionDefaultLimit: toInt(process.env.INGESTION_DEFAULT_LIMIT, 60),
  ingestionScheduleEnabled:
    String(process.env.INGESTION_SCHEDULE_ENABLED || 'true').toLowerCase() === 'true',
  ingestionScheduleMs: toInt(process.env.INGESTION_SCHEDULE_MS, 300000),
  newsFeedMaxLimit: toInt(process.env.NEWS_FEED_MAX_LIMIT, 400),
  translationTimeoutMs: toInt(process.env.TRANSLATION_TIMEOUT_MS, 12000),
  translationEnabled:
    String(process.env.NEWS_TRANSLATION_ENABLED || 'true').toLowerCase() === 'true',
  streamVerificationTimeoutMs: toInt(process.env.STREAM_VERIFICATION_TIMEOUT_MS, 8000),
};