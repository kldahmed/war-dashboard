'use strict';

const express = require('express');
const { query } = require('../../lib/db');
const metrics = require('../../lib/metrics');
const { asyncHandler } = require('../../lib/async-handler');

const router = express.Router();

router.get('/health', asyncHandler(async (_req, res) => {
  const db = await query('SELECT 1 AS ok');
  res.json({ status: 'ok', db: db.rows[0].ok === 1, time: new Date().toISOString() });
}));

router.get('/health/metrics-basic', asyncHandler(async (_req, res) => {
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

  res.json({
    counters: {
      sources: sources.rows[0].count,
      source_feeds: feeds.rows[0].count,
      raw_items: rawItems.rows[0].count,
      normalized_items: normalizedItems.rows[0].count,
    },
    last_job: lastJob.rowCount > 0 ? lastJob.rows[0] : null,
    runtime_metrics: metrics.snapshot(),
  });
}));

module.exports = router;
