'use strict';

const { query } = require('../../lib/db');
const { getStreamStatusSnapshot } = require('./stream-status');

function toIsoAge(isoValue) {
  if (!isoValue) return { iso: null, age_sec: null };
  const parsedMs = new Date(isoValue).getTime();
  if (Number.isNaN(parsedMs)) return { iso: null, age_sec: null };
  return {
    iso: new Date(parsedMs).toISOString(),
    age_sec: Math.max(0, Math.floor((Date.now() - parsedMs) / 1000)),
  };
}

function buildReadinessSummary({ staleSignals, failureCounts, streamSummary }) {
  const blocked = staleSignals.stale_ingestion
    || staleSignals.stale_feed
    || (failureCounts.failed_jobs_24h >= 5)
    || (streamSummary.down_streams > 0 && streamSummary.active_streams > 0);

  const degraded = !blocked && (
    streamSummary.degraded_streams > 0
    || failureCounts.failed_jobs_24h > 0
    || failureCounts.recent_failed_sources > 0
  );

  return {
    level: blocked ? 'blocked' : degraded ? 'degraded' : 'ready',
    operator_message: blocked
      ? 'توجد إشارات stale/failure تحتاج تدخل قبل live-news mode.'
      : degraded
        ? 'الحالة قابلة للتشغيل مع ملاحظات تشغيلية مفتوحة.'
        : 'الحالة التشغيلية مستقرة للمتابعة.',
  };
}

async function getNewsroomStatusSnapshot() {
  const [streamSnapshot, freshnessResult, failuresResult, sourceFailuresResult] = await Promise.all([
    getStreamStatusSnapshot(),
    query(
      `WITH latest_feed_item AS (
         SELECT MAX(COALESCE(published_at_source, created_at)) AS latest_item_at
         FROM normalized_items
         WHERE status = 'ready'
       ),
       latest_ingestion AS (
         SELECT MAX(COALESCE(ended_at, created_at)) AS latest_ingestion_at
         FROM processing_jobs
         WHERE job_type = 'rss_ingestion'
       )
       SELECT
         (SELECT latest_item_at FROM latest_feed_item) AS latest_item_at,
         (SELECT latest_ingestion_at FROM latest_ingestion) AS latest_ingestion_at`
    ),
    query(
      `WITH recent_failures AS (
         SELECT id, job_type, status, error_message, created_at, correlation_id
         FROM processing_jobs
         WHERE status = 'failed'
           AND created_at >= NOW() - INTERVAL '24 hours'
         ORDER BY created_at DESC
         LIMIT 5
       )
       SELECT json_build_object(
         'failed_jobs_24h', (SELECT COUNT(*)::int FROM processing_jobs WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours'),
         'failed_ingestion_jobs_24h', (SELECT COUNT(*)::int FROM processing_jobs WHERE status = 'failed' AND job_type = 'rss_ingestion' AND created_at >= NOW() - INTERVAL '24 hours'),
         'recent_failures', COALESCE((SELECT json_agg(recent_failures) FROM recent_failures), '[]'::json)
       ) AS payload`
    ),
    query(
      `WITH feed_source_health AS (
         SELECT
           s.id AS source_id,
           s.name AS source_name,
           COUNT(sf.id)::int AS feed_count,
           COUNT(*) FILTER (WHERE sf.status = 'active')::int AS active_feed_count,
           COUNT(*) FILTER (
             WHERE sf.status = 'active'
               AND (sf.last_success_at IS NULL OR (sf.last_error_at IS NOT NULL AND sf.last_error_at >= sf.last_success_at))
           )::int AS failing_feed_count,
           MAX(sf.last_error_at) AS latest_error_at,
           MAX(sf.last_error_message) FILTER (WHERE sf.last_error_at IS NOT NULL) AS latest_error_message
         FROM sources s
         JOIN source_feeds sf ON sf.source_id = s.id
         GROUP BY s.id, s.name
       )
       SELECT json_build_object(
         'sources_total', (SELECT COUNT(*)::int FROM sources),
         'sources_with_failures', (SELECT COUNT(*)::int FROM feed_source_health WHERE failing_feed_count > 0),
         'recent_failed_sources', (SELECT COUNT(*)::int FROM feed_source_health WHERE failing_feed_count > 0 AND latest_error_at >= NOW() - INTERVAL '24 hours'),
         'worst_sources', COALESCE((
           SELECT json_agg(row_to_json(fsh))
           FROM (
             SELECT source_id, source_name, feed_count, active_feed_count, failing_feed_count, latest_error_at, latest_error_message
             FROM feed_source_health
             WHERE failing_feed_count > 0
             ORDER BY failing_feed_count DESC, latest_error_at DESC NULLS LAST, source_id DESC
             LIMIT 5
           ) fsh
         ), '[]'::json)
       ) AS payload`
    ),
  ]);

  const freshnessRow = freshnessResult.rows[0] || {};
  const latestItem = toIsoAge(freshnessRow.latest_item_at);
  const latestIngestion = toIsoAge(freshnessRow.latest_ingestion_at);
  const failureCounts = failuresResult.rows[0]?.payload || {};
  const sourceFailureSummary = sourceFailuresResult.rows[0]?.payload || {};

  const alertThresholds = {
    feed_stale_after_sec: 6 * 3600,
    ingestion_stale_after_sec: 3 * 3600,
    failed_jobs_24h_warning: 1,
    failed_jobs_24h_critical: 5,
  };

  const staleSignals = {
    latest_feed_item_at: latestItem.iso,
    latest_feed_item_age_sec: latestItem.age_sec,
    stale_feed: latestItem.age_sec == null ? true : latestItem.age_sec > alertThresholds.feed_stale_after_sec,
    latest_ingestion_at: latestIngestion.iso,
    latest_ingestion_age_sec: latestIngestion.age_sec,
    stale_ingestion: latestIngestion.age_sec == null ? true : latestIngestion.age_sec > alertThresholds.ingestion_stale_after_sec,
  };

  const readiness = buildReadinessSummary({
    staleSignals,
    failureCounts,
    streamSummary: streamSnapshot.summary,
  });

  return {
    alert_thresholds: alertThresholds,
    stale_signals: staleSignals,
    recent_failures: failureCounts,
    source_failure_summary: sourceFailureSummary,
    readiness_summary: {
      ...readiness,
      active_streams: streamSnapshot.summary.active_streams,
      degraded_streams: streamSnapshot.summary.degraded_streams,
      down_streams: streamSnapshot.summary.down_streams,
      featured_stream_id: streamSnapshot.summary.featured_stream_id,
    },
  };
}

module.exports = {
  getNewsroomStatusSnapshot,
};