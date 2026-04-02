'use strict';

const { query } = require('../../backend/lib/db');
const metrics = require('../../backend/lib/metrics');

module.exports = async function handler(_req, res) {
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
      runtime_metrics: metrics.snapshot(),
      runtime: 'vercel',
    });
  } catch (error) {
    return res.status(500).json({
      error: 'metrics_basic_failed',
      details: error.message,
      runtime: 'vercel',
    });
  }
};
