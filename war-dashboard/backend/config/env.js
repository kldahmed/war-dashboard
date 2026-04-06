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
  ingestionFeedTimeoutMs: toInt(process.env.INGESTION_FEED_TIMEOUT_MS, 120000),
  ingestionScheduleEnabled:
    String(process.env.INGESTION_SCHEDULE_ENABLED || 'true').toLowerCase() === 'true',
  ingestionScheduleMs: toInt(process.env.INGESTION_SCHEDULE_MS, 300000),
  newsFeedMaxLimit: toInt(process.env.NEWS_FEED_MAX_LIMIT, 400),
  translationTimeoutMs: toInt(process.env.TRANSLATION_TIMEOUT_MS, 12000),
  translationEnabled:
    String(process.env.NEWS_TRANSLATION_ENABLED || 'true').toLowerCase() === 'true',
  streamVerificationTimeoutMs: toInt(process.env.STREAM_VERIFICATION_TIMEOUT_MS, 8000),
  optimizerEnabled:
    String(process.env.OPTIMIZER_ENABLED || 'true').toLowerCase() === 'true',
  optimizerScheduleMs: toInt(process.env.OPTIMIZER_SCHEDULE_MS, 2 * 60 * 60 * 1000), // default 2h
  sitrepEnabled:
    String(process.env.SITREP_ENABLED || 'true').toLowerCase() === 'true',
  sitrepScheduleMs: toInt(process.env.SITREP_SCHEDULE_MS, 30 * 60 * 1000), // default 30min

  // Weather service
  weatherApiKey: process.env.WEATHER_API_KEY || '',
  weatherScheduleEnabled:
    String(process.env.WEATHER_SCHEDULE_ENABLED || 'true').toLowerCase() === 'true',
  weatherScheduleMs: toInt(process.env.WEATHER_SCHEDULE_MS, 60_000), // default 60s

  // Markets service (Alpha Vantage)
  alphaVantageApiKey: process.env.ALPHAVANTAGE_API_KEY || '',
  marketsScheduleEnabled:
    String(process.env.MARKETS_SCHEDULE_ENABLED || 'true').toLowerCase() === 'true',
  marketsGoldScheduleMs: toInt(process.env.MARKETS_GOLD_SCHEDULE_MS, 60_000),  // default 60s
  marketsOilScheduleMs:  toInt(process.env.MARKETS_OIL_SCHEDULE_MS, 3_600_000), // default 1h
};