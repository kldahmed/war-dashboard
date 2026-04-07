'use strict';

const express = require('express');
const { query } = require('../../lib/db');
const metrics = require('../../lib/metrics');
const { asyncHandler } = require('../../lib/async-handler');
const { requireAuth, requireRole } = require('../../lib/auth-middleware');
const { getStreamStatusSnapshot } = require('./stream-status');
const { getNewsroomStatusSnapshot } = require('./newsroom-status');
const { getProductKpiSnapshot } = require('./product-kpi');
const sseHub = require('../../lib/sse-hub');
const { getSignalsHealth } = require('../signals/service');

const router = express.Router();

router.get('/health', asyncHandler(async (_req, res) => {
  const db = await query('SELECT 1 AS ok');
  res.json({
    status: 'ok',
    db: db.rows[0].ok === 1,
    feed_mode: process.env.FEED_MODE || process.env.REACT_APP_FEED_MODE || 'legacy',
    feed_fallback_enabled: String(process.env.FEED_FALLBACK_ENABLED || process.env.REACT_APP_FEED_FALLBACK || 'true').toLowerCase() === 'true',
    verify_mode: String(process.env.REACT_APP_PRODUCTION_VERIFY_MODE || 'false').toLowerCase() === 'true',
    correlation_id: _req.correlationId || null,
    time: new Date().toISOString(),
  });
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
    feed_mode: process.env.FEED_MODE || process.env.REACT_APP_FEED_MODE || 'legacy',
    feed_fallback_enabled: String(process.env.FEED_FALLBACK_ENABLED || process.env.REACT_APP_FEED_FALLBACK || 'true').toLowerCase() === 'true',
    verify_mode: String(process.env.REACT_APP_PRODUCTION_VERIFY_MODE || 'false').toLowerCase() === 'true',
    correlation_id: _req.correlationId || null,
    runtime_metrics: metrics.snapshot(),
  });
}));

router.get('/health/streams', asyncHandler(async (req, res) => {
  const snapshot = await getStreamStatusSnapshot();

  res.json({
    ...snapshot,
    feed_mode: process.env.FEED_MODE || process.env.REACT_APP_FEED_MODE || 'legacy',
    feed_fallback_enabled: String(process.env.FEED_FALLBACK_ENABLED || process.env.REACT_APP_FEED_FALLBACK || 'true').toLowerCase() === 'true',
    verify_mode: String(process.env.REACT_APP_PRODUCTION_VERIFY_MODE || 'false').toLowerCase() === 'true',
    correlation_id: req.correlationId || null,
    time: new Date().toISOString(),
  });
}));

router.get('/health/newsroom', asyncHandler(async (req, res) => {
  const snapshot = await getNewsroomStatusSnapshot();

  res.json({
    ...snapshot,
    feed_mode: process.env.FEED_MODE || process.env.REACT_APP_FEED_MODE || 'legacy',
    feed_fallback_enabled: String(process.env.FEED_FALLBACK_ENABLED || process.env.REACT_APP_FEED_FALLBACK || 'true').toLowerCase() === 'true',
    verify_mode: String(process.env.REACT_APP_PRODUCTION_VERIFY_MODE || 'false').toLowerCase() === 'true',
    correlation_id: req.correlationId || null,
    time: new Date().toISOString(),
  });
}));

router.get('/health/signals', asyncHandler(async (req, res) => {
  const [signals] = await Promise.all([
    getSignalsHealth(),
  ]);

  res.json({
    ...signals,
    status: signals.overall_status === 'green' ? 'live' : signals.overall_status === 'yellow' ? 'degraded' : 'critical',
    hub: sseHub.stats(),
    correlation_id: req.correlationId || null,
    time: new Date().toISOString(),
  });
}));

router.get('/health/optimizer', asyncHandler(async (req, res) => {
  const [lastRuns, auditRecent, trustChanges] = await Promise.all([
    query(`
      SELECT id, status, started_at, ended_at, latency_ms, payload_json, correlation_id
      FROM processing_jobs
      WHERE job_type = 'auto_optimizer'
      ORDER BY created_at DESC
      LIMIT 5
    `),
    query(`
      SELECT action, target_type, target_id, details_json, created_at
      FROM audit_logs
      WHERE actor_id = 'auto_optimizer'
      ORDER BY created_at DESC
      LIMIT 20
    `),
    query(`
      SELECT COUNT(*)::int AS count
      FROM audit_logs
      WHERE actor_id = 'auto_optimizer'
        AND action = 'trust_score_adjusted'
        AND created_at > NOW() - INTERVAL '24 hours'
    `),
  ]);

  res.json({
    last_runs: lastRuns.rows,
    recent_actions: auditRecent.rows,
    trust_adjustments_24h: trustChanges.rows[0]?.count ?? 0,
    correlation_id: req.correlationId || null,
    time: new Date().toISOString(),
  });
}));

router.get('/health/product-kpi', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const snapshot = await getProductKpiSnapshot();

  res.json({
    ...snapshot,
    correlation_id: req.correlationId || null,
  });
}));

module.exports = router;
