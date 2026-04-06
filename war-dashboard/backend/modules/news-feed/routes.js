'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const { query } = require('../../lib/db');
const { asyncHandler } = require('../../lib/async-handler');
const env = require('../../config/env');
const { runRssIngestion } = require('../ingestion/service');

const router = express.Router();
const KNOWN_CATEGORIES = new Set(['breaking', 'politics', 'economy', 'war', 'gulf', 'iran', 'israel', 'usa', 'world', 'energy', 'analysis', 'technology']);
const FEED_STALE_TRIGGER_SEC = 15 * 60;
const INGESTION_COOLDOWN_MS = 2 * 60 * 1000;
let autoIngestionInFlight = false;
let lastAutoIngestionAt = 0;

function safeIsoTime(value) {
  if (!value) return 'unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'unknown' : parsed.toISOString();
}

function normalizeCategorySlug(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized || normalized === 'all') return 'all';
  return KNOWN_CATEGORIES.has(normalized) ? normalized : 'all';
}

function inferUrgency(row) {
  const haystack = String([
    row.news_category_slug,
    row.display_title,
    row.display_summary,
    row.editorial_priority,
  ].filter(Boolean).join(' ')).toLowerCase();

  if (row.news_category_slug === 'breaking' || /(breaking|urgent|developing|عاجل|فوري)/.test(haystack)) return 'high';
  if (row.editorial_priority === 'high' || row.editorial_priority === 'review' || Number(row.corroboration_count || 0) >= 2) return 'medium';
  return 'low';
}

function mapToUiItem(row) {
  const category = row.news_category_slug || row.category || row.source_category || 'world';
  const published = row.published_at_source || row.fetched_at || row.created_at;
  return {
    id: row.normalized_id,
    title: row.display_title,
    summary: row.display_summary,
    category,
    urgency: inferUrgency(row),
    time: safeIsoTime(published),
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
      original_title: row.original_title || row.canonical_title || null,
      original_summary: row.original_summary || row.canonical_body || null,
      translation_status: row.translation_status || 'not_required',
      translation_provider: row.translation_provider || null,
      category_confidence: Number.isFinite(Number(row.category_confidence_score)) ? Number(row.category_confidence_score) : 0.35,
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
      editorial: {
        decision: row.editorial_decision || 'publish',
        priority: row.editorial_priority || 'normal',
        rank_score: Number.isFinite(row.rank_score) ? row.rank_score : 0.35,
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

function buildCategoryCounts(rows) {
  const counts = {
    all: Array.isArray(rows) ? rows.length : 0,
  };

  for (const slug of KNOWN_CATEGORIES) counts[slug] = 0;
  for (const row of rows || []) {
    const slug = normalizeCategorySlug(row.news_category_slug || row.category || row.source_category || 'world');
    if (slug !== 'all') counts[slug] += 1;
  }
  return counts;
}

function latestTimestampFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const latest = rows
    .map((row) => row.published_at_source || row.fetched_at || row.created_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value))
    .reduce((acc, cur) => Math.max(acc, cur), 0);
  return latest > 0 ? new Date(latest).toISOString() : null;
}

async function maybeTriggerAutoIngestion({ latestItemIso, reqCorrelationId, lastIngestionAt }) {
  if (!latestItemIso) return;

  const latestAgeSec = Math.max(0, Math.floor((Date.now() - new Date(latestItemIso).getTime()) / 1000));
  const ingestionAgeSec = lastIngestionAt
    ? Math.max(0, Math.floor((Date.now() - new Date(lastIngestionAt).getTime()) / 1000))
    : Number.POSITIVE_INFINITY;

  const cooldownPassed = (Date.now() - lastAutoIngestionAt) > INGESTION_COOLDOWN_MS;
  const shouldKick = latestAgeSec > FEED_STALE_TRIGGER_SEC && ingestionAgeSec > 10 * 60;

  if (!shouldKick || autoIngestionInFlight || !cooldownPassed) return;

  autoIngestionInFlight = true;
  lastAutoIngestionAt = Date.now();
  runRssIngestion({
    correlationId: reqCorrelationId || randomUUID(),
    triggeredBy: 'news_feed_stale_guard',
  })
    .catch(() => {})
    .finally(() => {
      autoIngestionInFlight = false;
    });
}

router.get('/news/feed', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');

  const limit = Math.min(env.newsFeedMaxLimit, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const category = normalizeCategorySlug(req.query.category);
  const categoryClause = '';
  const params = [limit];

  const [result, lastJob] = await Promise.all([
    query(
    `WITH cluster_signals AS (
       SELECT
         ce.cluster_id,
         GREATEST(COUNT(*)::int - 1, 0) AS corroboration_count,
         COUNT(DISTINCT ni.source_id)::int AS source_diversity,
         COUNT(DISTINCT av.id)::int AS article_version_count,
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
       LEFT JOIN article_versions av ON av.normalized_item_id = ni.id
       GROUP BY ce.cluster_id
     ),
     scored_items AS (
       SELECT
         ni.id AS normalized_id,
         ni.raw_item_id,
         ni.language,
         ni.canonical_title,
         ni.canonical_body,
         CASE
           WHEN LOWER(COALESCE(ni.language, '')) LIKE 'ar%' THEN ni.canonical_title
           ELSE COALESCE(NULLIF(ni.translated_title_ar, ''), ni.canonical_title)
         END AS display_title,
         CASE
           WHEN LOWER(COALESCE(ni.language, '')) LIKE 'ar%' THEN ni.canonical_body
           ELSE COALESCE(NULLIF(ni.translated_summary_ar, ''), ni.canonical_body)
         END AS display_summary,
         ni.category,
         nc.slug AS news_category_slug,
         ni.category_confidence_score,
         ni.original_title,
         ni.original_summary,
         ni.translation_status,
         ni.translation_provider,
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
         COALESCE(cs.article_version_count, 0) AS article_version_count,
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
         CASE
           WHEN COALESCE(cs.contradiction_flag, FALSE) THEN 'hold'
           WHEN COALESCE(cs.article_version_count, 0) > 0 AND COALESCE(cs.average_novelty, COALESCE(ce.novelty_hint, 0.5)) >= 0.12 THEN 'update'
           WHEN COALESCE(cs.corroboration_count, 0) > 0 AND COALESCE(cs.average_duplicate_risk, COALESCE(ce.duplicate_risk_hint, 0.35)) >= 0.82 THEN 'merge'
           ELSE 'publish'
         END AS editorial_decision,
         CASE
           WHEN COALESCE(cs.contradiction_flag, FALSE) THEN 'review'
           WHEN COALESCE(cs.source_diversity, 1) >= 3 OR COALESCE(cs.article_version_count, 0) > 0 THEN 'high'
           WHEN COALESCE(cs.corroboration_count, 0) > 0 THEN 'elevated'
           ELSE 'normal'
         END AS editorial_priority,
         CASE COALESCE(nc.slug, ni.category, s.category, 'world')
           WHEN 'breaking' THEN 1.00
           WHEN 'war' THEN 0.93
           WHEN 'iran' THEN 0.9
           WHEN 'israel' THEN 0.88
           WHEN 'gulf' THEN 0.86
           WHEN 'usa' THEN 0.82
           WHEN 'politics' THEN 0.79
           WHEN 'economy' THEN 0.77
           WHEN 'energy' THEN 0.75
           WHEN 'analysis' THEN 0.73
           WHEN 'technology' THEN 0.71
           ELSE 0.66
         END AS category_weight,
         GREATEST(
           0.05,
           LEAST(
             0.99,
             (
               GREATEST(
                 0,
                 1 - (EXTRACT(EPOCH FROM (NOW() - COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at))) / 86400.0) / 7.0
               ) * 0.3
             )
             + (
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
               ) * 0.3
             )
             + CASE WHEN COALESCE(nc.slug, ni.category, s.category, 'world') = 'breaking' THEN 0.14 ELSE 0 END
             + CASE WHEN COALESCE(nc.slug, ni.category, s.category, 'world') IN ('war', 'iran', 'israel') THEN 0.08 ELSE 0 END
             + CASE WHEN COALESCE(nc.slug, ni.category, s.category, 'world') IN ('gulf', 'usa', 'politics') THEN 0.05 ELSE 0 END
             + CASE COALESCE(nc.slug, ni.category, s.category, 'world')
                 WHEN 'breaking' THEN 1.00
                 WHEN 'war' THEN 0.93
                 WHEN 'iran' THEN 0.9
                 WHEN 'israel' THEN 0.88
                 WHEN 'gulf' THEN 0.86
                 WHEN 'usa' THEN 0.82
                 WHEN 'politics' THEN 0.79
                 WHEN 'economy' THEN 0.77
                 WHEN 'energy' THEN 0.75
                 WHEN 'analysis' THEN 0.73
                 WHEN 'technology' THEN 0.71
                 ELSE 0.66
               END * 0.12
             + LEAST(COALESCE(cs.corroboration_count, 0), 4) / 4.0 * 0.15
             + COALESCE(cs.average_novelty, COALESCE(ce.novelty_hint, 0.5)) * 0.15
             + (1 - COALESCE(cs.average_duplicate_risk, COALESCE(ce.duplicate_risk_hint, 0.35))) * 0.1
             - CASE WHEN COALESCE(cs.contradiction_flag, FALSE) THEN 0.2 ELSE 0 END
           )
         ) AS rank_score,
         sc.last_seen_at AS cluster_last_seen_at
       FROM normalized_items ni
       JOIN raw_items ri ON ri.id = ni.raw_item_id
       JOIN sources s ON s.id = ni.source_id
      LEFT JOIN news_categories nc ON nc.id = ni.news_category_id
       LEFT JOIN cluster_events ce ON ce.normalized_item_id = ni.id
       LEFT JOIN story_clusters sc ON sc.id = ce.cluster_id
       LEFT JOIN cluster_signals cs ON cs.cluster_id = ce.cluster_id
       WHERE ni.status = 'ready'
         AND ni.canonical_title IS NOT NULL
         AND LENGTH(TRIM(ni.canonical_title)) > 0
         AND ni.canonical_body IS NOT NULL
         AND LENGTH(TRIM(ni.canonical_body)) > 0
         ${categoryClause}
     ),
     ranked_items AS (
       SELECT
         scored_items.*,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(scored_items.cluster_id, -scored_items.normalized_id)
           ORDER BY scored_items.rank_score DESC,
                    COALESCE(scored_items.novelty_hint, 0) DESC,
                    COALESCE(scored_items.duplicate_risk_hint, 0) ASC,
                    scored_items.published_at_source DESC NULLS LAST,
                    scored_items.fetched_at DESC,
                    scored_items.normalized_id DESC
         ) AS cluster_rank
       FROM scored_items
     )
     SELECT
       normalized_id,
       raw_item_id,
       language,
       canonical_title,
       canonical_body,
       display_title,
       display_summary,
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
      article_version_count,
       contradiction_flag,
       news_category_slug,
       category_confidence_score,
       original_title,
       original_summary,
       translation_status,
       translation_provider,
       verification_state,
       confidence_score,
       editorial_decision,
       editorial_priority,
       rank_score,
       cluster_last_seen_at
     FROM ranked_items
     WHERE cluster_rank = 1
        ORDER BY COALESCE(cluster_last_seen_at, published_at_source, fetched_at) DESC NULLS LAST,
        rank_score DESC,
        fetched_at DESC
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
  const categoryCounts = buildCategoryCounts(result.rows);
  const filteredRows = category === 'all'
    ? result.rows
    : result.rows.filter((row) => normalizeCategorySlug(row.news_category_slug || row.category || row.source_category || 'world') === category);
  const selectedRows = filteredRows
    .slice()
    .sort((a, b) => {
      const aMs = new Date(a.cluster_last_seen_at || a.published_at_source || a.fetched_at || a.created_at || 0).getTime();
      const bMs = new Date(b.cluster_last_seen_at || b.published_at_source || b.fetched_at || b.created_at || 0).getTime();
      return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
    })
    .slice(0, limit);
  const latestItemIso = latestTimestampFromRows(filteredRows);

  await maybeTriggerAutoIngestion({
    latestItemIso,
    reqCorrelationId: req.correlationId,
    lastIngestionAt,
  });

  res.json({
    mode: 'stored',
    fallback_used: false,
    freshness: buildFreshness(selectedRows, lastIngestionAt),
    item_count: selectedRows.length,
    total_available_items: filteredRows.length,
    category_counts: categoryCounts,
    correlation_id: req.correlationId || null,
    error_reason: null,
    items: selectedRows.map(mapToUiItem),
  });
}));

module.exports = router;
