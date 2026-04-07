require('dotenv').config({ path: '.env.local' });
const { query, pool } = require('../backend/lib/db');

(async () => {
  try {
    // Query ingestion_job_feed_status to get the latest failed feeds
    const res = await query(`
      SELECT 
        ijfs.feed_id,
        sf.endpoint,
        sf.status as feed_status,
        ijfs.status as job_feed_status,
        ijfs.error_message,
        s.name as source_name,
        s.registry_id
      FROM ingestion_job_feed_status ijfs
      JOIN source_feeds sf ON ijfs.feed_id = sf.id
      JOIN sources s ON sf.source_id = s.id
      WHERE ijfs.job_id = (SELECT id FROM ingestion_jobs ORDER BY created_at DESC LIMIT 1)
      AND ijfs.status IN ('failed', 'timeout', 'error')
      ORDER BY sf.endpoint
    `);
    
    console.log('\n=== FAILED FEEDS FROM LATEST JOB ===\n');
    console.log(`Total failed: ${res.rows.length}\n`);
    
    const failedByError = {};
    res.rows.forEach(row => {
      console.log(`${row.source_name.padEnd(30)} (${row.registry_id})`);
      console.log(`  Feed ID: ${row.feed_id}, Status: ${row.job_feed_status}`);
      console.log(`  Error: ${row.error_message}\n`);
      
      const errorMsg = row.error_message.slice(0, 40);
      failedByError[errorMsg] = (failedByError[errorMsg] || 0) + 1;
    });
    
    console.log('\n=== ERROR SUMMARY ===\n');
    Object.entries(failedByError).forEach(([err, count]) => {
      console.log(`${count}x ${err}...`);
    });

  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
