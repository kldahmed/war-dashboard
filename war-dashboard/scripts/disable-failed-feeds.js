require('dotenv').config({ path: '.env.local' });
const { query, pool } = require('../backend/lib/db');

(async () => {
  try {
    // Get all failed feeds from Job 51
    const failedFeeds = await query(`
      SELECT DISTINCT source_registry_id, feed_name, feed_endpoint, error_message, COUNT(*) as fail_count
      FROM ingestion_feed_runs 
      WHERE job_id = 51 AND status IN ('failed', 'error')
      GROUP BY source_registry_id, feed_name, feed_endpoint, error_message
      ORDER BY fail_count DESC
    `);
    
    console.log('=== FAILED FEEDS IN JOB 51 ===\n');
    console.log(`Total unique failed feeds: ${failedFeeds.rows.length}\n`);
    
    const failedIds = [];
    failedFeeds.rows.forEach(row => {
      failedIds.push(row.source_registry_id);
      console.log(`${row.source_registry_id.padEnd(25)} (${row.fail_count}x)`);
      console.log(`  Error: ${row.error_message.substring(0, 80)}\n`);
    });
    
    // Now disable these feeds in the database
    console.log('=== DISABLING FAILED FEEDS ===\n');
    
    const updateResult = await query(`
      UPDATE source_feeds 
      SET status = 'inactive', updated_at = NOW()
      WHERE registry_feed_id = ANY($1::text[])
      RETURNING id, registry_feed_id, endpoint
    `, [failedIds]);
    
    console.log(`Disabled ${updateResult.rows.length} feeds:\n`);
    updateResult.rows.forEach(row => {
      console.log(`  ✓ ${row.registry_feed_id}: ${row.endpoint.substring(0, 60)}`);
    });

  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
