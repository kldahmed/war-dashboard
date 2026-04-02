'use strict';

const { randomUUID } = require('node:crypto');
const { query } = require('../../backend/lib/db');
const metrics = require('../../backend/lib/metrics');

function resolveCorrelationId(req) {
  const incoming = req.headers['x-correlation-id'];
  return typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
}

module.exports = async function handler(req, res) {
  const correlationId = resolveCorrelationId(req);
  res.setHeader('X-Correlation-Id', correlationId);

  try {
    const [sources, feeds, rawItems, normalizedItems, lastJob] = await Promise.all([
      query('SELECT COUNT(*)::int AS count FROM sources'),
      query('SELECT COUNT(*)::int AS count FROM source_feeds'),
      query('SELECT COUNT(*)::int AS count FROM raw_items'),
      query('SELECT COUNT(*)::int AS count FROM normalized_items'),
      query(`SELECT id, job_type, status, started_at, ended_at, latency_ms, created_at
             FROM processing_jobs
             ORDER BY created_at DESC
             LIMIT 1`),
    ]);

    return res.status(200).json({
      counters: {
        sources: sources.rows[0].count,
        source_feeds: feeds.rows[0].count,
        raw_items: rawItems.rows[0].count,
        normalized_items: normalizedItems.rows[0].count,
      },
      last_job: lastJob.rowCount > 0 ? lastJob.rows[0] : null,
      feed_mode: process.env.FEED_MODE || process.env.REACT_APP_FEED_MODE || 'legacy',
      feed_fallback_enabled: String(process.env.FEED_FALLBACK_ENABLED || process.env.REACT_APP_FEED_FALLBACK || 'true').toLowerCase() === 'true',
      verify_mode: String(process.env.REACT_APP_PRODUCTION_VERIFY_MODE || 'false').toLowerCase() === 'true',
      correlation_id: correlationId,
      runtime_metrics: metrics.snapshot(),
      runtime: 'vercel',
    });
  } catch (error) {
    return res.status(500).json({
      error: 'metrics_basic_failed',
      details: error.message,
      feed_mode: process.env.FEED_MODE || process.env.REACT_APP_FEED_MODE || 'legacy',
      feed_fallback_enabled: String(process.env.FEED_FALLBACK_ENABLED || process.env.REACT_APP_FEED_FALLBACK || 'true').toLowerCase() === 'true',
      verify_mode: String(process.env.REACT_APP_PRODUCTION_VERIFY_MODE || 'false').toLowerCase() === 'true',
      correlation_id: correlationId,
      runtime: 'vercel',
    });
  }
};
