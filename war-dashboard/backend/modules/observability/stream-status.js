'use strict';

const { query } = require('../../lib/db');
const metrics = require('../../lib/metrics');

function getFreshnessScore(isoValue, horizonSec) {
  if (!isoValue) return 0;
  const parsedMs = new Date(isoValue).getTime();
  if (Number.isNaN(parsedMs)) return 0;
  const ageSec = Math.max(0, Math.floor((Date.now() - parsedMs) / 1000));
  return Math.max(0, 1 - (ageSec / horizonSec));
}

function computeStreamHealth(row) {
  if (row.feed_status !== 'active') {
    return {
      uptime_status: 'down',
      detail_status: 'inactive',
      health_reason: 'stream_inactive',
    };
  }

  const nowMs = Date.now();
  const pollingIntervalSec = Number(row.polling_interval_sec || 300);
  const lastSuccessMs = row.last_success_at ? new Date(row.last_success_at).getTime() : null;
  const lastErrorMs = row.last_error_at ? new Date(row.last_error_at).getTime() : null;
  const staleThresholdMs = pollingIntervalSec * 1000 * 4;
  const downThresholdMs = pollingIntervalSec * 1000 * 12;

  if (!lastSuccessMs) {
    if (lastErrorMs) {
      return {
        uptime_status: 'down',
        detail_status: 'pending',
        health_reason: 'no_success_recent_error',
      };
    }
    return {
      uptime_status: 'degraded',
      detail_status: 'pending',
      health_reason: 'awaiting_first_success',
    };
  }

  if (lastErrorMs && lastErrorMs >= lastSuccessMs) {
    return {
      uptime_status: 'degraded',
      detail_status: 'error_after_success',
      health_reason: 'recent_error_after_success',
    };
  }

  if ((nowMs - lastSuccessMs) > downThresholdMs) {
    return {
      uptime_status: 'down',
      detail_status: 'stale',
      health_reason: 'success_too_old',
    };
  }

  if ((nowMs - lastSuccessMs) > staleThresholdMs) {
    return {
      uptime_status: 'degraded',
      detail_status: 'stale',
      health_reason: 'success_aging',
    };
  }

  return {
    uptime_status: 'up',
    detail_status: 'healthy',
    health_reason: 'recent_success',
  };
}

function buildStreamLink(row) {
  if (!row.latest_normalized_id) return null;
  return {
    normalized_id: row.latest_normalized_id,
    cluster_id: row.latest_cluster_id,
    title: row.latest_story_title,
    published_at: row.latest_story_published_at,
    relevance_score: Number(row.latest_story_relevance_score || 0),
    corroboration_count: Number(row.latest_story_corroboration_count || 0),
  };
}

function computeStreamScore(row, health) {
  const trustScore = Math.max(0, Math.min(1, Number(row.trust_score || 0) / 100));
  const successFreshness = getFreshnessScore(row.last_success_at, Number(row.polling_interval_sec || 300) * 12);
  const storyFreshness = getFreshnessScore(row.latest_story_seen_at || row.latest_story_published_at, 86400 * 3);
  const storyVolume = Math.min(1, Number(row.story_count || 0) / 20);
  const clusterCoverage = Math.min(1, Number(row.linked_cluster_count || 0) / 10);
  const linkScore = Math.max(0, Math.min(1, Number(row.latest_story_relevance_score || 0)));
  const statusBase = health.uptime_status === 'up' ? 1 : health.uptime_status === 'degraded' ? 0.55 : 0.15;

  return Number((
    statusBase * 0.35
    + trustScore * 0.15
    + successFreshness * 0.2
    + storyFreshness * 0.12
    + storyVolume * 0.08
    + clusterCoverage * 0.05
    + linkScore * 0.05
  ).toFixed(4));
}

function pickFeaturedStream(streams) {
  return streams.find((stream) => stream.stream.featured)
    || streams.find((stream) => stream.stream.uptime_status === 'up')
    || streams[0]
    || null;
}

async function getStreamStatusSnapshot() {
  const runtimeMetrics = metrics.snapshot();
  const [streamsResult, recentEventsResult] = await Promise.all([
    query(
      `WITH stream_story_candidates AS (
         SELECT
           ri.source_feed_id,
           ni.id AS normalized_id,
           ce.cluster_id,
           ni.canonical_title,
           COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at) AS published_at,
           COALESCE(sc.item_count, 1) AS cluster_size,
           COALESCE(cluster_counts.corroboration_count, 0) AS corroboration_count,
           COALESCE(cluster_counts.article_version_count, 0) AS article_version_count,
           (
             LEAST(COALESCE(sc.item_count, 1), 6) / 6.0 * 0.3
             + LEAST(COALESCE(cluster_counts.corroboration_count, 0), 5) / 5.0 * 0.3
             + LEAST(COALESCE(cluster_counts.article_version_count, 0), 3) / 3.0 * 0.1
             + GREATEST(0, 1 - (EXTRACT(EPOCH FROM (NOW() - COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at))) / 86400.0) / 3.0) * 0.3
           ) AS story_relevance_score
         FROM raw_items ri
         JOIN normalized_items ni ON ni.raw_item_id = ri.id
         LEFT JOIN cluster_events ce ON ce.normalized_item_id = ni.id
         LEFT JOIN story_clusters sc ON sc.id = ce.cluster_id
         LEFT JOIN (
           SELECT
             ce.cluster_id,
             GREATEST(COUNT(*)::int - 1, 0) AS corroboration_count,
             COUNT(DISTINCT av.id)::int AS article_version_count
           FROM cluster_events ce
           LEFT JOIN article_versions av ON av.normalized_item_id = ce.normalized_item_id
           GROUP BY ce.cluster_id
         ) cluster_counts ON cluster_counts.cluster_id = ce.cluster_id
       ),
       latest_story_link AS (
         SELECT DISTINCT ON (source_feed_id)
           source_feed_id,
           normalized_id AS latest_normalized_id,
           cluster_id AS latest_cluster_id,
           canonical_title AS latest_story_title,
           published_at AS latest_story_published_at,
           story_relevance_score AS latest_story_relevance_score,
           corroboration_count AS latest_story_corroboration_count
         FROM stream_story_candidates
         ORDER BY source_feed_id, story_relevance_score DESC, published_at DESC, normalized_id DESC
       ),
       stream_story_counts AS (
         SELECT
           ri.source_feed_id,
           COUNT(DISTINCT ni.id)::int AS story_count,
           COUNT(DISTINCT ce.cluster_id)::int AS linked_cluster_count,
           MAX(COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at)) AS latest_story_seen_at
         FROM raw_items ri
         JOIN normalized_items ni ON ni.raw_item_id = ri.id
         LEFT JOIN cluster_events ce ON ce.normalized_item_id = ni.id
         GROUP BY ri.source_feed_id
       )
       SELECT
         sf.id AS stream_id,
         sf.source_id,
         sf.feed_type,
         sf.endpoint,
         sf.polling_interval_sec,
         sf.status AS feed_status,
         sf.last_success_at,
         sf.last_error_at,
         sf.last_error_message,
         s.name AS source_name,
         s.domain AS source_domain,
         s.category AS source_category,
         s.region AS source_region,
         s.language AS source_language,
         s.status AS source_status,
         s.trust_score,
         COALESCE(ssc.story_count, 0) AS story_count,
         COALESCE(ssc.linked_cluster_count, 0) AS linked_cluster_count,
         ssc.latest_story_seen_at,
         lsl.latest_normalized_id,
         lsl.latest_cluster_id,
         lsl.latest_story_title,
         lsl.latest_story_published_at,
         lsl.latest_story_relevance_score,
         lsl.latest_story_corroboration_count
       FROM source_feeds sf
       JOIN sources s ON s.id = sf.source_id
       LEFT JOIN stream_story_counts ssc ON ssc.source_feed_id = sf.id
       LEFT JOIN latest_story_link lsl ON lsl.source_feed_id = sf.id
       ORDER BY sf.id DESC`
    ),
    query(
      `SELECT
         COUNT(*)::int AS processing_jobs_24h,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_jobs_24h,
         COUNT(*) FILTER (WHERE job_type = 'ingestion_rss')::int AS ingestion_jobs_24h,
         MAX(created_at) AS latest_job_at
       FROM processing_jobs
       WHERE created_at >= NOW() - INTERVAL '24 hours'`
    ),
  ]);

  const streams = streamsResult.rows.map((row) => {
    const health = computeStreamHealth(row);
    const streamScore = computeStreamScore(row, health);

    return {
      stream_id: row.stream_id,
      source: {
        id: row.source_id,
        name: row.source_name,
        domain: row.source_domain,
        category: row.source_category,
        region: row.source_region,
        language: row.source_language,
        trust_score: Number(row.trust_score),
        status: row.source_status,
      },
      stream: {
        feed_type: row.feed_type,
        endpoint: row.endpoint,
        polling_interval_sec: row.polling_interval_sec,
        status: row.feed_status,
        uptime_status: health.uptime_status,
        detail_status: health.detail_status,
        health_reason: health.health_reason,
        last_success_at: row.last_success_at,
        last_error_at: row.last_error_at,
        last_error_message: row.last_error_message,
        score: streamScore,
        featured: false,
      },
      story_link: buildStreamLink(row),
      stats: {
        story_count: row.story_count,
        linked_cluster_count: row.linked_cluster_count,
        latest_story_seen_at: row.latest_story_seen_at,
        story_relevance_score: Number(row.latest_story_relevance_score || 0),
      },
    };
  }).sort((left, right) => {
    if (right.stream.score !== left.stream.score) return right.stream.score - left.stream.score;
    return String(right.stream.last_success_at || '').localeCompare(String(left.stream.last_success_at || ''));
  });

  const featuredStream = pickFeaturedStream(streams);
  if (featuredStream) {
    featuredStream.stream.featured = true;
  }

  const summary = streams.reduce((acc, stream) => {
    acc.total_streams += 1;
    if (stream.stream.status === 'active') acc.active_streams += 1;
    acc[`${stream.stream.uptime_status}_streams`] = (acc[`${stream.stream.uptime_status}_streams`] || 0) + 1;
    acc[`${stream.stream.detail_status}_streams`] = (acc[`${stream.stream.detail_status}_streams`] || 0) + 1;
    acc.linked_stories += stream.stats.story_count;
    acc.linked_clusters += stream.stats.linked_cluster_count;
    return acc;
  }, {
    total_streams: 0,
    active_streams: 0,
    up_streams: 0,
    degraded_streams: 0,
    down_streams: 0,
    healthy_streams: 0,
    stale_streams: 0,
    pending_streams: 0,
    inactive_streams: 0,
    error_after_success_streams: 0,
    linked_stories: 0,
    linked_clusters: 0,
  });

  return {
    summary: {
      ...summary,
      uptime_sec: runtimeMetrics.uptimeSec,
      request_count: runtimeMetrics.requestCount,
      request_error_count: runtimeMetrics.requestErrorCount,
      latest_job_at: recentEventsResult.rows[0]?.latest_job_at || null,
      processing_jobs_24h: recentEventsResult.rows[0]?.processing_jobs_24h || 0,
      failed_jobs_24h: recentEventsResult.rows[0]?.failed_jobs_24h || 0,
      ingestion_jobs_24h: recentEventsResult.rows[0]?.ingestion_jobs_24h || 0,
      featured_stream_id: featuredStream?.stream_id || null,
    },
    featured_stream: featuredStream,
    streams,
    runtime_metrics: runtimeMetrics,
  };
}

module.exports = {
  getStreamStatusSnapshot,
};