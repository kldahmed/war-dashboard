'use strict';

require('dotenv').config({ path: '.env.local' });

const { query, pool } = require('../backend/lib/db');

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

  console.log('=== DB_FRESHNESS ===');
  console.log(JSON.stringify(freshness.rows[0], null, 2));

  console.log('\n=== INGESTION_LAST_10 ===');
  console.log(JSON.stringify(ingestion.rows, null, 2));

  console.log('\n=== LATEST_ITEMS_15 ===');
  console.log(JSON.stringify(topFeed.rows, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
