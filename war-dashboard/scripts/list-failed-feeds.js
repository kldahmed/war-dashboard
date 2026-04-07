require('dotenv').config({ path: '.env.local' });
const { query, pool } = require('../backend/lib/db');

(async () => {
  try {
    // First get table names
    const tabs = await query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    console.log('Available tables:', tabs.rows.map(r => r.table_name).join(', '));
    console.log('\n');
    
    // Query ingestion_feed_runs to get the latest failed feeds
    const res = await query(`
      SELECT 
        ifr.id as feed_run_id,
        ifr.status as feed_status,
        ifr.error_message,
        ifr.source_registry_id,
        ifr.feed_name,
        ifr.feed_endpoint
      FROM ingestion_feed_runs ifr
      WHERE ifr.job_id = (SELECT MAX(id) FROM ingestion_feed_runs)
      AND ifr.status IN ('failed', 'error')
      ORDER BY ifr.created_at DESC
    `);
    
    console.log('FAILED FEEDS FROM LATEST JOB:\n');
    console.log(`Total failed: ${res.rows.length}\n`);
    
    res.rows.forEach(row => {
      console.log(`${row.feed_name.padEnd(35)} [${row.source_registry_id}]`);
      console.log(`  Endpoint: ${row.feed_endpoint}`);
      console.log(`  Error: ${row.error_message}`);
      console.log();
    });

  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
