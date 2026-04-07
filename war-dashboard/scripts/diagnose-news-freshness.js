'use strict';

require('dotenv').config({ path: '.env.local' });

const { query, pool } = require('../backend/lib/db');

function toPercent(part, total) {
  const p = Number(part || 0);
  const t = Number(total || 0);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return '0.00%';
  return `${((p / t) * 100).toFixed(2)}%`;
}

async function main() {
  const freshness = await query(
    `SELECT
       MAX(COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at)) AS latest_item_at,
       MIN(COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at)) AS oldest_item_at,
       COUNT(*)::int AS total_ready,
       COUNT(*) FILTER (
         WHERE COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at) > NOW() - INTERVAL '24 hours'
       )::int AS ready_24h
     FROM normalized_items ni
     JOIN raw_items ri ON ri.id = ni.raw_item_id
     WHERE ni.status = 'ready'`,
  );

  const ingestion = await query(
    `SELECT id, status, started_at, ended_at, created_at, latency_ms
     FROM processing_jobs
     WHERE job_type = 'rss_ingestion'
     ORDER BY created_at DESC
     LIMIT 10`,
  );

  const topFeed = await query(
    `SELECT
       ni.id,
       COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at) AS item_time,
       ni.canonical_title,
       s.name AS source_name
     FROM normalized_items ni
     JOIN raw_items ri ON ri.id = ni.raw_item_id
     JOIN sources s ON s.id = ni.source_id
     WHERE ni.status = 'ready'
       AND ni.canonical_title IS NOT NULL
       AND LENGTH(TRIM(ni.canonical_title)) > 0
     ORDER BY COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at) DESC NULLS LAST
     LIMIT 15`,
  );

  const duplicates24h = await query(
    `SELECT
       COUNT(*)::int AS duplicate_groups,
       COALESCE(SUM(group_count - 1), 0)::int AS duplicate_items
     FROM (
       SELECT ni.title_fingerprint, COUNT(*)::int AS group_count
       FROM normalized_items ni
       JOIN raw_items ri ON ri.id = ni.raw_item_id
       WHERE ni.status = 'ready'
         AND COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at) > NOW() - INTERVAL '24 hours'
       GROUP BY ni.title_fingerprint
       HAVING COUNT(*) > 1
     ) d`,
  );

  const translation24h = await query(
    `SELECT
       ni.translation_status,
       COUNT(*)::int AS count
     FROM normalized_items ni
     JOIN raw_items ri ON ri.id = ni.raw_item_id
     WHERE ni.status = 'ready'
       AND COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at) > NOW() - INTERVAL '24 hours'
     GROUP BY ni.translation_status
     ORDER BY count DESC`,
  );

  const freshnessRow = freshness.rows[0] || { total_ready: 0, ready_24h: 0 };
  const duplicateRow = duplicates24h.rows[0] || { duplicate_groups: 0, duplicate_items: 0 };
  const translatedRow = translation24h.rows.find((row) => row.translation_status === 'translated');

  const qualitySummary = {
    total_ready: freshnessRow.total_ready,
    ready_24h: freshnessRow.ready_24h,
    freshness_24h_ratio: toPercent(freshnessRow.ready_24h, freshnessRow.total_ready),
    duplicate_groups_24h: duplicateRow.duplicate_groups,
    duplicate_items_24h: duplicateRow.duplicate_items,
    duplicate_ratio_24h: toPercent(duplicateRow.duplicate_items, freshnessRow.ready_24h),
    translated_24h: translatedRow ? translatedRow.count : 0,
    translated_ratio_24h: toPercent(translatedRow ? translatedRow.count : 0, freshnessRow.ready_24h),
  };

  console.log('=== DB_FRESHNESS ===');
  console.log(JSON.stringify(freshness.rows[0], null, 2));

  console.log('\n=== INGESTION_LAST_10 ===');
  console.log(JSON.stringify(ingestion.rows, null, 2));

  console.log('\n=== LATEST_ITEMS_15 ===');
  console.log(JSON.stringify(topFeed.rows, null, 2));

  console.log('\n=== QUALITY_SUMMARY ===');
  console.log(JSON.stringify(qualitySummary, null, 2));

  console.log('\n=== TRANSLATION_24H_BREAKDOWN ===');
  console.log(JSON.stringify(translation24h.rows, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
