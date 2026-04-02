'use strict';

const express = require('express');
const { query } = require('../../lib/db');
const { asyncHandler } = require('../../lib/async-handler');

const router = express.Router();

function mapToUiItem(row) {
  const category = row.category || row.source_category || 'all';
  const published = row.published_at_source || row.fetched_at || row.created_at;
  return {
    id: row.normalized_id,
    title: row.canonical_title,
    summary: row.canonical_body,
    category,
    urgency: 'medium',
    time: published ? new Date(published).toISOString() : 'unknown',
    source: {
      id: row.source_id,
      name: row.source_name,
      domain: row.source_domain,
      trust_score: row.trust_score,
    },
    provenance: {
      raw_item_id: row.raw_item_id,
      source_feed_id: row.source_feed_id,
      source_url: row.source_url,
      fetched_at: row.fetched_at,
      published_at_source: row.published_at_source,
      normalized_hash: row.normalized_hash,
    },
  };
}

function buildFreshness(rows, lastIngestionAt) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      latest_item_at: null,
      oldest_item_at: null,
      data_age_sec: null,
      last_ingestion_at: lastIngestionAt,
    };
  }

  const timestamps = rows
    .map((row) => row.published_at_source || row.fetched_at || row.created_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));

  if (timestamps.length === 0) {
    return {
      latest_item_at: null,
      oldest_item_at: null,
      data_age_sec: null,
      last_ingestion_at: lastIngestionAt,
    };
  }

  const latestMs = Math.max(...timestamps);
  const oldestMs = Math.min(...timestamps);
  return {
    latest_item_at: new Date(latestMs).toISOString(),
    oldest_item_at: new Date(oldestMs).toISOString(),
    data_age_sec: Math.max(0, Math.floor((Date.now() - latestMs) / 1000)),
    last_ingestion_at: lastIngestionAt,
  };
}

router.get('/news/feed', asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const category = typeof req.query.category === 'string' ? req.query.category.toLowerCase() : null;

  const params = [limit];
  const categoryClause = category && category !== 'all' ? 'AND COALESCE(ni.category, s.category) = $2' : '';
  if (categoryClause) params.push(category);

  const [result, lastJob] = await Promise.all([
    query(
    `WITH ranked_items AS (
       SELECT
         ni.id AS normalized_id,
         ni.raw_item_id,
         ni.canonical_title,
         ni.canonical_body,
         ni.category,
         ni.published_at_source,
         ni.normalized_hash,
         ni.created_at,
         ri.source_feed_id,
         ri.source_url,
         ri.fetched_at,
         s.id AS source_id,
         s.name AS source_name,
         s.domain AS source_domain,
         s.category AS source_category,
         s.trust_score,
         ce.cluster_id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(ce.cluster_id, -ni.id)
           ORDER BY ni.published_at_source DESC NULLS LAST, ri.fetched_at DESC, ni.id DESC
         ) AS cluster_rank
       FROM normalized_items ni
       JOIN raw_items ri ON ri.id = ni.raw_item_id
       JOIN sources s ON s.id = ni.source_id
       LEFT JOIN cluster_events ce ON ce.normalized_item_id = ni.id
       WHERE ni.status = 'ready'
         AND ni.canonical_title IS NOT NULL
         AND LENGTH(TRIM(ni.canonical_title)) > 0
         AND ni.canonical_body IS NOT NULL
         AND LENGTH(TRIM(ni.canonical_body)) > 0
         ${categoryClause}
     )
     SELECT
       normalized_id,
       raw_item_id,
       canonical_title,
       canonical_body,
       category,
       published_at_source,
       normalized_hash,
       created_at,
       source_feed_id,
       source_url,
       fetched_at,
       source_id,
       source_name,
       source_domain,
       source_category,
       trust_score
     FROM ranked_items
     WHERE cluster_rank = 1
     ORDER BY published_at_source DESC NULLS LAST, fetched_at DESC
     LIMIT $1`,
    params,
    ),
    query(
      `SELECT ended_at
       FROM processing_jobs
       WHERE job_type = 'rss_ingestion'
         AND status IN ('completed', 'completed_with_errors')
       ORDER BY created_at DESC
       LIMIT 1`,
    ),
  ]);

  const lastIngestionAt = lastJob.rowCount > 0 && lastJob.rows[0].ended_at
    ? new Date(lastJob.rows[0].ended_at).toISOString()
    : null;

  res.json({
    mode: 'stored',
    fallback_used: false,
    freshness: buildFreshness(result.rows, lastIngestionAt),
    item_count: result.rowCount,
    correlation_id: req.correlationId || null,
    error_reason: null,
    items: result.rows.map(mapToUiItem),
  });
}));

module.exports = router;
