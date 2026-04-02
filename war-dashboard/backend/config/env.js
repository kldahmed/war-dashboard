'use strict';

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 3001),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/war_dashboard',
  feedMode: process.env.FEED_MODE || 'legacy',
  feedFallbackEnabled: String(process.env.FEED_FALLBACK_ENABLED || 'true').toLowerCase() === 'true',
  rssRequestTimeoutMs: toInt(process.env.RSS_REQUEST_TIMEOUT_MS, 15000),
  ingestionDefaultLimit: toInt(process.env.INGESTION_DEFAULT_LIMIT, 20),
};
