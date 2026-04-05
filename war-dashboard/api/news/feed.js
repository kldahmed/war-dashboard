'use strict';

const { randomUUID } = require('node:crypto');
const { query } = require('../../backend/lib/db');

const KNOWN_CATEGORIES = new Set([
  'breaking', 'politics', 'economy', 'war', 'gulf', 'iran',
  'israel', 'usa', 'world', 'energy', 'analysis', 'technology',
]);

function safeIsoTime(value) {
  if (!value) return 'unknown';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'unknown' : parsed.toISOString();
}

function resolveCorrelationId(req) {
  const incoming = req.headers['x-correlation-id'];
  return typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
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
        corroboration_count: Number.isFinite(Number(row.corroboration_count)) ? Number(row.corroboration_count) : 0,
        source_diversity: Number.isFinite(Number(row.source_diversity)) ? Number(row.source_diversity) : 1,
        contradiction_flag: Boolean(row.contradiction_flag),
      },
      verification: {
        state: row.verification_state || 'single_source',
        confidence_score: Number.isFinite(Number(row.confidence_score)) ? Number(row.confidence_score) : 0.35,
      },
      editorial: {
        decision: row.editorial_decision || 'publish',
        priority: row.editorial_priority || 'normal',
        rank_score: Number.isFinite(Number(row.rank_score)) ? Number(row.rank_score) : 0.35,
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
  const counts = { all: Array.isArray(rows) ? rows.length : 0 };
  for (const slug of KNOWN_CATEGORIES) counts[slug] = 0;

  for (const row of rows || []) {
    const slug = normalizeCategorySlug(row.news_category_slug || row.category || row.source_category || 'world');
    if (slug !== 'all') counts[slug] += 1;
  }

  return counts;
}

function buildVerificationRadar(rows) {
  const radar = {
    corroborated: 0,
    partially_corroborated: 0,
    single_source: 0,
    needs_review: 0,
    average_confidence: 0,
  };

  if (!rows.length) return radar;

  let totalConfidence = 0;
  for (const row of rows) {
    const state = row.verification_state || 'single_source';
    radar[state] = (radar[state] || 0) + 1;
    totalConfidence += Number(row.confidence_score || 0);
  }
  radar.average_confidence = Number((totalConfidence / rows.length).toFixed(3));
  return radar;
}

function buildEditorialQueue(rows) {
  const queue = {
    hold: 0,
    update: 0,
    merge: 0,
    publish: 0,
    elevated_priority: 0,
    review_priority: 0,
  };

  for (const row of rows) {
    const decision = row.editorial_decision || 'publish';
    queue[decision] = (queue[decision] || 0) + 1;
    if (row.editorial_priority === 'elevated' || row.editorial_priority === 'high') queue.elevated_priority += 1;
    if (row.editorial_priority === 'review') queue.review_priority += 1;
  }

  return queue;
}

function buildBriefingEntry(row) {
  return {
    id: row.normalized_id,
    cluster_id: row.cluster_id || null,
    title: row.display_title,
    category: row.news_category_slug || row.category || row.source_category || 'world',
    source_name: row.source_name,
    published_at: safeIsoTime(row.published_at_source || row.fetched_at || row.created_at),
    verification_state: row.verification_state || 'single_source',
    confidence_score: Number(Number(row.confidence_score || 0).toFixed(3)),
    editorial_priority: row.editorial_priority || 'normal',
    editorial_decision: row.editorial_decision || 'publish',
    rank_score: Number(Number(row.rank_score || 0).toFixed(3)),
    corroboration_count: Number(row.corroboration_count || 0),
    source_diversity: Number(row.source_diversity || 1),
    contradiction_flag: Boolean(row.contradiction_flag),
  };
}

function buildBriefing(rows) {
  if (!rows.length) {
    return {
      lead_story: null,
      verification_radar: buildVerificationRadar([]),
      editorial_queue: buildEditorialQueue([]),
      disputed_stories: [],
      cluster_watch: [],
      momentum: { high_priority_count: 0, corroborated_count: 0, review_count: 0 },
    };
  }

  const sortedByRank = [...rows].sort((left, right) => Number(right.rank_score || 0) - Number(left.rank_score || 0));
  const disputedStories = sortedByRank
    .filter((row) => row.contradiction_flag || row.editorial_priority === 'review')
    .slice(0, 4)
    .map(buildBriefingEntry);
  const clusterWatch = sortedByRank
    .filter((row) => Number(row.corroboration_count || 0) > 0 || Number(row.source_diversity || 1) > 1)
    .sort((left, right) => {
      if (Number(right.corroboration_count || 0) !== Number(left.corroboration_count || 0)) {
        return Number(right.corroboration_count || 0) - Number(left.corroboration_count || 0);
      }
      return Number(right.rank_score || 0) - Number(left.rank_score || 0);
    })
    .slice(0, 5)
    .map(buildBriefingEntry);

  return {
    lead_story: buildBriefingEntry(sortedByRank[0]),
    verification_radar: buildVerificationRadar(rows),
    editorial_queue: buildEditorialQueue(rows),
    disputed_stories: disputedStories,
    cluster_watch: clusterWatch,
    momentum: {
      high_priority_count: rows.filter((row) => row.editorial_priority === 'high' || row.editorial_priority === 'review').length,
      corroborated_count: rows.filter((row) => row.verification_state === 'corroborated').length,
      review_count: rows.filter((row) => row.editorial_priority === 'review').length,
    },
  };
}

function buildBaseFeedQuery(filterSql) {
  return `WITH cluster_signals AS (
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
    WHERE ${filterSql}
  ),
  ranked_items AS (
    SELECT
      scored_items.*,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(scored_items.cluster_id, -scored_items.normalized_id)
        ORDER BY scored_items.rank_score DESC,
                 scored_items.published_at_source DESC NULLS LAST,
                 scored_items.fetched_at DESC,
                 scored_items.normalized_id DESC
      ) AS cluster_rank
    FROM scored_items
  )
  SELECT *
  FROM ranked_items
  WHERE cluster_rank = 1`;
}

module.exports = async function handler(req, res) {
  const correlationId = resolveCorrelationId(req);
  res.setHeader('X-Correlation-Id', correlationId);

  try {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 60));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const category = normalizeCategorySlug(req.query.category);
    const searchQ = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const filters = [
      "ni.status = 'ready'",
      'ni.canonical_title IS NOT NULL',
      "LENGTH(TRIM(ni.canonical_title)) > 0",
      'ni.canonical_body IS NOT NULL',
      "LENGTH(TRIM(ni.canonical_body)) > 0",
    ];
    const filterParams = [];

    if (category !== 'all') {
      filterParams.push(category);
      filters.push(`COALESCE(nc.slug, ni.category, s.category, 'world') = $${filterParams.length}`);
    }

    if (searchQ) {
      filterParams.push(`%${searchQ}%`);
      filters.push(`(
        ni.canonical_title ILIKE $${filterParams.length}
        OR ni.canonical_body ILIKE $${filterParams.length}
        OR COALESCE(ni.translated_title_ar, '') ILIKE $${filterParams.length}
        OR COALESCE(ni.translated_summary_ar, '') ILIKE $${filterParams.length}
        OR COALESCE(s.name, '') ILIKE $${filterParams.length}
      )`);
    }

    const baseQuery = buildBaseFeedQuery(filters.join(' AND '));
    const pagedParams = [...filterParams, limit, offset];
    const limitPlaceholder = `$${filterParams.length + 1}`;
    const offsetPlaceholder = `$${filterParams.length + 2}`;

    const [result, countResult, lastJob] = await Promise.all([
      query(
        `${baseQuery}
         ORDER BY rank_score DESC,
                  COALESCE(cluster_last_seen_at, published_at_source, fetched_at) DESC NULLS LAST,
                  fetched_at DESC
         LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
        pagedParams,
      ),
      query(
        `SELECT COUNT(*)::int AS total FROM (${baseQuery}) ranked_feed`,
        filterParams,
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

    return res.status(200).json({
      mode: 'stored',
      fallback_used: false,
      freshness: buildFreshness(result.rows, lastIngestionAt),
      item_count: result.rowCount,
      total_count: countResult.rows[0]?.total ?? result.rowCount,
      total_available_items: countResult.rows[0]?.total ?? result.rowCount,
      category_counts: buildCategoryCounts(result.rows),
      correlation_id: correlationId,
      error_reason: null,
      briefing: buildBriefing(result.rows),
      items: result.rows.map(mapToUiItem),
      runtime: 'vercel',
    });
  } catch (error) {
    return res.status(500).json({
      error: 'news_feed_failed',
      details: error.message,
      mode: 'stored',
      fallback_used: false,
      freshness: {
        latest_item_at: null,
        oldest_item_at: null,
        data_age_sec: null,
        last_ingestion_at: null,
      },
      item_count: 0,
      total_count: 0,
      total_available_items: 0,
      category_counts: buildCategoryCounts([]),
      correlation_id: correlationId,
      error_reason: error.message,
      briefing: buildBriefing([]),
      runtime: 'vercel',
    });
  }
};
