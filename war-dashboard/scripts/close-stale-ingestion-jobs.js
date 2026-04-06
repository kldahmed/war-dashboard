'use strict';

require('dotenv').config({ path: '.env.local' });

const { query, pool } = require('../backend/lib/db');

async function main() {
  const result = await query(
    `UPDATE processing_jobs
     SET status = 'failed',
         ended_at = NOW(),
         latency_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000))::int,
         error_message = COALESCE(error_message, 'manual_stale_close'),
         updated_at = NOW()
     WHERE job_type = 'rss_ingestion'
       AND status = 'running'
       AND started_at < NOW() - INTERVAL '45 minutes'
     RETURNING id`,
  );

  console.log(JSON.stringify({ closed_running_jobs: result.rowCount, ids: result.rows.map((r) => r.id) }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
