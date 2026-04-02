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
      cluster: {
        id: row.cluster_id || null,
        corroboration_count: Number.isFinite(row.corroboration_count) ? row.corroboration_count : 0,
        source_diversity: Number.isFinite(row.source_diversity) ? row.source_diversity : 1,
        contradiction_flag: Boolean(row.contradiction_flag),
      },
      verification: {
        state: row.verification_state || 'single_source',
        confidence_score: Number.isFinite(row.confidence_score) ? row.confidence_score : 0.35,
      },
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
    `WITH cluster_signals AS (
       SELECT
         ce.cluster_id,
         GREATEST(COUNT(*)::int - 1, 0) AS corroboration_count,
         COUNT(DISTINCT ni.source_id)::int AS source_diversity,
         BOOL_OR(
           LOWER(COALESCE(ni.canonical_title, '') || ' ' || COALESCE(ni.canonical_body, ''))
             ~ '(^|[^a-z])(deny|denies|denied|reject|rejects|rejected|dispute|disputes|disputed|contradict|contradicts|contradicted|false|fake|hoax)([^a-z]|$)'
         )
         AND
         BOOL_OR(
           LOWER(COALESCE(ni.canonical_title, '') || ' ' || COALESCE(ni.canonical_body, ''))
             ~ '(^|[^a-z])(confirm|confirms|confirmed|verify|verified|corroborate|corroborated|evidence|admit|admits|admitted)([^a-z]|$)'
         ) AS contradiction_flag,
         ROUND(AVG(COALESCE(ce.duplicate_risk_hint, 0.35))::numeric, 4) AS average_duplicate_risk,
         ROUND(AVG(COALESCE(ce.novelty_hint, 0.5))::numeric, 4) AS average_novelty
       FROM cluster_events ce
       JOIN normalized_items ni ON ni.id = ce.normalized_item_id
       GROUP BY ce.cluster_id
     ),
     ranked_items AS (
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
         ce.duplicate_risk_hint,
         ce.novelty_hint,
         COALESCE(cs.corroboration_count, 0) AS corroboration_count,
         COALESCE(cs.source_diversity, 1) AS source_diversity,
         COALESCE(cs.contradiction_flag, FALSE) AS contradiction_flag,
         CASE
           WHEN COALESCE(cs.contradiction_flag, FALSE) THEN 'needs_review'
           WHEN COALESCE(cs.source_diversity, 1) >= 3 AND COALESCE(cs.corroboration_count, 0) >= 2 THEN 'corroborated'
           WHEN COALESCE(cs.source_diversity, 1) >= 2 THEN 'partially_corroborated'
           ELSE 'single_source'
         END AS verification_state,
         GREATEST(
           0.05,
           LEAST(
             0.99,
             COALESCE(s.trust_score / 100.0, 0.5) * 0.35
             + COALESCE(cs.average_duplicate_risk, COALESCE(ce.duplicate_risk_hint, 0.35)) * 0.3
             + (LEAST(COALESCE(cs.source_diversity, 1), 4) / 4.0) * 0.2
             + (1 - COALESCE(cs.average_novelty, COALESCE(ce.novelty_hint, 0.5))) * 0.15
             - CASE WHEN COALESCE(cs.contradiction_flag, FALSE) THEN 0.25 ELSE 0 END
           )
         ) AS confidence_score,
         sc.last_seen_at AS cluster_last_seen_at,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(ce.cluster_id, -ni.id)
           ORDER BY COALESCE(ce.novelty_hint, 0) DESC,
                    COALESCE(ce.duplicate_risk_hint, 0) ASC,
                    ni.published_at_source DESC NULLS LAST,
                    ri.fetched_at DESC,
                    ni.id DESC
         ) AS cluster_rank
       FROM normalized_items ni
       JOIN raw_items ri ON ri.id = ni.raw_item_id
       JOIN sources s ON s.id = ni.source_id
       LEFT JOIN cluster_events ce ON ce.normalized_item_id = ni.id
       LEFT JOIN story_clusters sc ON sc.id = ce.cluster_id
       LEFT JOIN cluster_signals cs ON cs.cluster_id = ce.cluster_id
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
       trust_score,
       cluster_id,
       corroboration_count,
       source_diversity,
       contradiction_flag,
       verification_state,
       confidence_score,
       cluster_last_seen_at
     FROM ranked_items
     WHERE cluster_rank = 1
     ORDER BY COALESCE(cluster_last_seen_at, published_at_source, fetched_at) DESC NULLS LAST, fetched_at DESC
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
