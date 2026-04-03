'use strict';

const { randomUUID } = require('node:crypto');
const { query } = require('../../lib/db');
const { writeAuditLog } = require('../../lib/audit');
const logger = require('../../lib/logger');

/* ── Tuning constants ─────────────────────────────────────────── */
const TRUST_FLOOR              = 40;
const TRUST_CEILING            = 90;
const TRUST_BOOST              = 2;        // points added when well-corroborated
const TRUST_DROP               = 3;        // points removed when poorly corroborated
const CORR_HIGH                = 0.40;     // corroboration rate → boost
const CORR_LOW                 = 0.10;     // corroboration rate → drop
const MIN_ITEMS_FOR_SCORING    = 5;        // ignore sources with too few items

const FEED_FAIL_THRESHOLD      = 5;        // consecutive failures → suspend
const FEED_REVIVE_COOLDOWN_H   = 4;        // hours before retrying a suspended feed

const RAW_RETENTION_DAYS       = 30;       // keep raw_items this long after normalization
const RAW_PRUNE_BATCH          = 1000;     // max rows deleted per cycle (avoid long locks)

const CLUSTER_ARCHIVE_AGE_H    = 72;       // hours before archiving a stale cluster

/* ── Strategy 1: trust score drift ────────────────────────────── */
async function adjustSourceTrustScores(correlationId) {
  // For each source with activity in last 7 days, compute corroboration rate
  // and nudge trust_score toward the evidence.
  const result = await query(`
    SELECT
      ni.source_id,
      COUNT(ni.id)::float                  AS total_items,
      COUNT(ce.id)::float                  AS corroborated_items,
      s.trust_score::float                 AS current_trust,
      s.name                               AS source_name
    FROM normalized_items ni
    JOIN sources s ON s.id = ni.source_id
    LEFT JOIN cluster_events ce ON ce.normalized_item_id = ni.id
    WHERE ni.created_at > NOW() - INTERVAL '7 days'
      AND s.status = 'active'
    GROUP BY ni.source_id, s.trust_score, s.name
    HAVING COUNT(ni.id) >= $1
  `, [MIN_ITEMS_FOR_SCORING]);

  const actions = [];

  for (const row of result.rows) {
    const rate    = row.corroborated_items / row.total_items;
    const current = parseFloat(row.current_trust);
    let delta     = 0;
    let reason    = null;

    if (rate > CORR_HIGH && current < TRUST_CEILING) {
      delta  = TRUST_BOOST;
      reason = `high_corroboration_rate:${(rate * 100).toFixed(0)}%`;
    } else if (rate < CORR_LOW && current > TRUST_FLOOR) {
      delta  = -TRUST_DROP;
      reason = `low_corroboration_rate:${(rate * 100).toFixed(0)}%`;
    }

    if (delta !== 0) {
      const newScore = Math.max(TRUST_FLOOR, Math.min(TRUST_CEILING, current + delta));
      await query(
        `UPDATE sources SET trust_score = $1, updated_at = NOW() WHERE id = $2`,
        [newScore.toFixed(2), row.source_id],
      );
      await writeAuditLog({
        actorType: 'system',
        actorId:   'auto_optimizer',
        action:    'trust_score_adjusted',
        targetType: 'source',
        targetId:   String(row.source_id),
        details:    { source_name: row.source_name, old: current, new: newScore, delta, reason },
        correlationId,
      });
      actions.push({ source_id: row.source_id, name: row.source_name, delta, new_score: newScore });
    }
  }

  return { strategy: 'adjust_trust_scores', actions_taken: actions.length, actions };
}

/* ── Strategy 2: suspend repeatedly-failing feeds ─────────────── */
async function suspendFailingFeeds(correlationId) {
  // Count failed ingestion runs per feed in the last 24h.
  // Any active feed with >= FEED_FAIL_THRESHOLD failures gets suspended.
  const failed = await query(`
    SELECT sf.id AS feed_id, COUNT(ifr.id)::int AS fail_count
    FROM source_feeds sf
    JOIN ingestion_feed_runs ifr ON ifr.source_feed_id = sf.id
    WHERE sf.status = 'active'
      AND ifr.status = 'failed'
      AND ifr.started_at > NOW() - INTERVAL '24 hours'
    GROUP BY sf.id
    HAVING COUNT(ifr.id) >= $1
  `, [FEED_FAIL_THRESHOLD]);

  const actions = [];

  for (const row of failed.rows) {
    await query(
      `UPDATE source_feeds SET status = 'suspended', updated_at = NOW() WHERE id = $1`,
      [row.feed_id],
    );
    await writeAuditLog({
      actorType:  'system',
      actorId:    'auto_optimizer',
      action:     'feed_suspended',
      targetType: 'source_feed',
      targetId:   String(row.feed_id),
      details:    { fail_count: row.fail_count, reason: 'consecutive_failures_24h' },
      correlationId,
    });
    actions.push({ feed_id: row.feed_id, fail_count: row.fail_count });
  }

  return { strategy: 'suspend_failing_feeds', actions_taken: actions.length, actions };
}

/* ── Strategy 3: revive feeds that have cooled down ───────────── */
async function reviveRecoveredFeeds(correlationId) {
  // Suspended feeds whose last_error_at is older than the cooldown window
  // get set back to 'active' to allow a fresh retry on the next ingestion cycle.
  const stale = await query(`
    SELECT id, last_error_at
    FROM source_feeds
    WHERE status = 'suspended'
      AND (
        last_error_at IS NULL
        OR last_error_at < NOW() - ($1 * INTERVAL '1 hour')
      )
  `, [FEED_REVIVE_COOLDOWN_H]);

  const actions = [];

  for (const row of stale.rows) {
    await query(
      `UPDATE source_feeds SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [row.id],
    );
    await writeAuditLog({
      actorType:  'system',
      actorId:    'auto_optimizer',
      action:     'feed_revived',
      targetType: 'source_feed',
      targetId:   String(row.id),
      details:    { last_error_at: row.last_error_at, reason: 'cooldown_expired' },
      correlationId,
    });
    actions.push({ feed_id: row.id });
  }

  return { strategy: 'revive_recovered_feeds', actions_taken: actions.length, actions };
}

/* ── Strategy 4: prune old raw_items ─────────────────────────── */
async function pruneStaleRawItems(correlationId) {
  // Delete raw_items that have already been normalized and are older than
  // RAW_RETENTION_DAYS. Batched to avoid long-running lock contention.
  const result = await query(`
    DELETE FROM raw_items
    WHERE id IN (
      SELECT ri.id
      FROM raw_items ri
      JOIN normalized_items ni ON ni.raw_item_id = ri.id
      WHERE ri.fetched_at < NOW() - ($1 * INTERVAL '1 day')
      ORDER BY ri.fetched_at ASC
      LIMIT $2
    )
  `, [RAW_RETENTION_DAYS, RAW_PRUNE_BATCH]);

  const pruned = result.rowCount ?? 0;

  if (pruned > 0) {
    await writeAuditLog({
      actorType:  'system',
      actorId:    'auto_optimizer',
      action:     'raw_items_pruned',
      targetType: 'raw_items',
      targetId:   'batch',
      details:    { pruned_count: pruned, retention_days: RAW_RETENTION_DAYS },
      correlationId,
    });
  }

  return { strategy: 'prune_stale_raw_items', actions_taken: pruned };
}

/* ── Strategy 5: archive stale story clusters ─────────────────── */
async function archiveStaleClusters(correlationId) {
  // Clusters that haven't received a new item in CLUSTER_ARCHIVE_AGE_H hours
  // are archived to keep queries on active clusters fast.
  const result = await query(`
    UPDATE story_clusters
    SET status = 'archived', updated_at = NOW()
    WHERE status = 'active'
      AND last_seen_at < NOW() - ($1 * INTERVAL '1 hour')
    RETURNING id
  `, [CLUSTER_ARCHIVE_AGE_H]);

  const archived = result.rowCount ?? 0;

  if (archived > 0) {
    await writeAuditLog({
      actorType:  'system',
      actorId:    'auto_optimizer',
      action:     'clusters_archived',
      targetType: 'story_clusters',
      targetId:   'batch',
      details:    { archived_count: archived, age_threshold_hours: CLUSTER_ARCHIVE_AGE_H },
      correlationId,
    });
  }

  return { strategy: 'archive_stale_clusters', actions_taken: archived };
}

/* ── Main entry point ─────────────────────────────────────────── */
async function runAutoOptimizer({ correlationId = randomUUID() } = {}) {
  const startedAt = Date.now();
  logger.info('auto_optimizer:start', { correlationId });

  const jobRes = await query(
    `INSERT INTO processing_jobs (job_type, status, payload_json, started_at, correlation_id)
     VALUES ('auto_optimizer', 'running', '{}'::jsonb, NOW(), $1)
     RETURNING id`,
    [correlationId],
  );
  const jobId = jobRes.rows[0].id;

  const strategies = [
    adjustSourceTrustScores,
    suspendFailingFeeds,
    reviveRecoveredFeeds,
    pruneStaleRawItems,
    archiveStaleClusters,
  ];

  const results = [];
  let status     = 'completed';

  for (const fn of strategies) {
    try {
      const r = await fn(correlationId);
      results.push(r);
      logger.info(`auto_optimizer:${r.strategy}`, { correlationId, actions_taken: r.actions_taken });
    } catch (err) {
      logger.error('auto_optimizer:strategy_error', { correlationId, strategy: fn.name, error: err.message });
      results.push({ strategy: fn.name, error: err.message, actions_taken: 0 });
      status = 'partial';
    }
  }

  const latencyMs = Date.now() - startedAt;

  await query(
    `UPDATE processing_jobs
     SET status = $1, ended_at = NOW(), latency_ms = $2, payload_json = $3::jsonb
     WHERE id = $4`,
    [status, latencyMs, JSON.stringify({ results }), jobId],
  );

  logger.info('auto_optimizer:done', { correlationId, latencyMs, status, strategies_run: results.length });
  return { correlationId, latencyMs, status, results };
}

module.exports = { runAutoOptimizer };
