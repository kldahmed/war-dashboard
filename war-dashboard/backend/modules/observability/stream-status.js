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
  if (row.channel_status !== 'active') {
    return {
      uptime_status: 'down',
      detail_status: 'inactive',
      health_reason: 'stream_inactive',
    };
  }

  if (row.playback_mode === 'playable' && row.last_verification_status === 'embed_ok') {
    return {
      uptime_status: 'up',
      detail_status: 'playable',
      health_reason: 'verified_embed_available',
    };
  }

  if (row.playback_mode === 'external_only') {
    return {
      uptime_status: 'degraded',
      detail_status: 'external_only',
      health_reason: row.last_verification_status || 'external_watch_only',
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
  return streams.find((stream) => stream.stream.playback_mode === 'playable' && stream.stream.uptime_status === 'up')
    || streams.find((stream) => stream.stream.featured)
    || streams.find((stream) => stream.stream.uptime_status === 'up')
    || streams[0]
    || null;
}

async function getStreamStatusSnapshot() {
  const runtimeMetrics = metrics.snapshot();
  const [streamsResult, recentEventsResult] = await Promise.all([
    query(
      `SELECT
         sc.id AS stream_id,
         sc.registry_id,
         matched_source.source_id,
         COALESCE(matched_source.feed_type, 'registry') AS feed_type,
         COALESCE(sc.external_watch_url, sc.official_page_url) AS endpoint,
         COALESCE(matched_source.polling_interval_sec, 300) AS polling_interval_sec,
         COALESCE(matched_source.feed_status, sc.status) AS feed_status,
         matched_source.last_success_at,
         matched_source.last_error_at,
         sc.provider,
         sc.official_page_url,
         sc.embed_url,
         sc.external_watch_url,
         sc.embed_supported,
         sc.playback_mode,
         sc.status AS channel_status,
         sc.verification_checked_at,
         sc.last_verification_status,
         sc.name AS source_name,
         sc.source_domain,
         COALESCE(matched_source.source_category, 'live') AS source_category,
         COALESCE(matched_source.source_region, 'global') AS source_region,
         sc.language AS source_language,
         sc.status AS source_status,
         COALESCE(matched_source.trust_score, 70) AS trust_score,
         COALESCE(stories.story_count, 0) AS story_count,
         COALESCE(stories.linked_cluster_count, 0) AS linked_cluster_count,
         stories.latest_story_seen_at,
         stories.latest_normalized_id,
         stories.latest_cluster_id,
         stories.latest_story_title,
         stories.latest_story_published_at,
         stories.latest_story_relevance_score,
         stories.latest_story_corroboration_count
       FROM stream_channels sc
       LEFT JOIN LATERAL (
         SELECT
           s.id AS source_id,
           s.category AS source_category,
           s.region AS source_region,
           s.trust_score,
           sf.feed_type,
           sf.polling_interval_sec,
           sf.status AS feed_status,
           sf.last_success_at,
           sf.last_error_at
         FROM sources s
         LEFT JOIN source_feeds sf ON sf.source_id = s.id AND sf.status = 'active'
         WHERE s.domain = sc.source_domain OR s.registry_id = sc.registry_id
         ORDER BY COALESCE(sf.last_success_at, sf.updated_at, s.updated_at) DESC NULLS LAST, s.trust_score DESC NULLS LAST, s.id ASC
         LIMIT 1
       ) matched_source ON true
       LEFT JOIN LATERAL (
         WITH cluster_counts AS (
           SELECT
             ce.cluster_id,
             GREATEST(COUNT(*)::int - 1, 0) AS corroboration_count,
             COUNT(DISTINCT av.id)::int AS article_version_count
           FROM cluster_events ce
           LEFT JOIN article_versions av ON av.normalized_item_id = ce.normalized_item_id
           GROUP BY ce.cluster_id
         ),
         ranked_stories AS (
           SELECT
             ni.id AS latest_normalized_id,
             ce.cluster_id AS latest_cluster_id,
             COALESCE(NULLIF(ni.translated_title_ar, ''), ni.canonical_title) AS latest_story_title,
             COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at) AS latest_story_published_at,
             (
               LEAST(COALESCE(sc2.item_count, 1), 6) / 6.0 * 0.3
               + LEAST(COALESCE(cluster_counts.corroboration_count, 0), 5) / 5.0 * 0.3
               + LEAST(COALESCE(cluster_counts.article_version_count, 0), 3) / 3.0 * 0.1
               + GREATEST(0, 1 - (EXTRACT(EPOCH FROM (NOW() - COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at))) / 86400.0) / 3.0) * 0.3
             ) AS latest_story_relevance_score,
             COALESCE(cluster_counts.corroboration_count, 0) AS latest_story_corroboration_count,
             ROW_NUMBER() OVER (
               ORDER BY
                 (
                   LEAST(COALESCE(sc2.item_count, 1), 6) / 6.0 * 0.3
                   + LEAST(COALESCE(cluster_counts.corroboration_count, 0), 5) / 5.0 * 0.3
                   + LEAST(COALESCE(cluster_counts.article_version_count, 0), 3) / 3.0 * 0.1
                   + GREATEST(0, 1 - (EXTRACT(EPOCH FROM (NOW() - COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at))) / 86400.0) / 3.0) * 0.3
                 ) DESC,
                 COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at) DESC,
                 ni.id DESC
             ) AS story_rank
           FROM normalized_items ni
           JOIN raw_items ri ON ri.id = ni.raw_item_id
           LEFT JOIN cluster_events ce ON ce.normalized_item_id = ni.id
           LEFT JOIN story_clusters sc2 ON sc2.id = ce.cluster_id
           LEFT JOIN cluster_counts ON cluster_counts.cluster_id = ce.cluster_id
           WHERE ni.source_id = matched_source.source_id
         )
         SELECT
           COUNT(*)::int AS story_count,
           COUNT(DISTINCT latest_cluster_id)::int AS linked_cluster_count,
           MAX(latest_story_published_at) AS latest_story_seen_at,
           MAX(latest_normalized_id) FILTER (WHERE story_rank = 1) AS latest_normalized_id,
           MAX(latest_cluster_id) FILTER (WHERE story_rank = 1) AS latest_cluster_id,
           MAX(latest_story_title) FILTER (WHERE story_rank = 1) AS latest_story_title,
           MAX(latest_story_published_at) FILTER (WHERE story_rank = 1) AS latest_story_published_at,
           MAX(latest_story_relevance_score) FILTER (WHERE story_rank = 1) AS latest_story_relevance_score,
           MAX(latest_story_corroboration_count) FILTER (WHERE story_rank = 1) AS latest_story_corroboration_count
         FROM ranked_stories
       ) stories ON matched_source.source_id IS NOT NULL
       ORDER BY sc.sort_order ASC, sc.id ASC`
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
        id: row.source_id || row.registry_id,
        name: row.source_name,
        domain: row.source_domain,
        category: row.source_category,
        region: row.source_region,
        language: row.source_language,
        trust_score: Number(row.trust_score),
        status: row.source_status,
      },
      stream: {
        registry_id: row.registry_id,
        provider: row.provider,
        feed_type: row.feed_type,
        endpoint: row.endpoint,
        polling_interval_sec: row.polling_interval_sec,
        status: row.feed_status,
        uptime_status: health.uptime_status,
        detail_status: health.detail_status,
        health_reason: health.health_reason,
        last_success_at: row.last_success_at,
        last_error_at: row.last_error_at,
        last_error_message: null,
        official_page_url: row.official_page_url,
        embed_url: row.embed_url,
        external_watch_url: row.external_watch_url,
        playback_mode: row.playback_mode,
        external_only: row.playback_mode === 'external_only',
        embed_supported: Boolean(row.embed_supported),
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
    if (stream.stream.playback_mode === 'playable') acc.playable_streams += 1;
    if (stream.stream.playback_mode === 'external_only') acc.external_only_streams += 1;
    acc[`${stream.stream.uptime_status}_streams`] = (acc[`${stream.stream.uptime_status}_streams`] || 0) + 1;
    acc[`${stream.stream.detail_status}_streams`] = (acc[`${stream.stream.detail_status}_streams`] || 0) + 1;
    acc.linked_stories += stream.stats.story_count;
    acc.linked_clusters += stream.stats.linked_cluster_count;
    return acc;
  }, {
    total_streams: 0,
    active_streams: 0,
    playable_streams: 0,
    external_only_streams: 0,
    up_streams: 0,
    degraded_streams: 0,
    down_streams: 0,
    healthy_streams: 0,
    stale_streams: 0,
    pending_streams: 0,
    inactive_streams: 0,
    external_only_streams: 0,
    playable_streams: 0,
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