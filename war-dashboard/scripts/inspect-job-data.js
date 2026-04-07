require('dotenv').config({ path: '.env.local' });
const { query, pool } = require('../backend/lib/db');

(async () => {
  try {
    // Get latest job info
    const latestJob = await query(`
      SELECT id, MAX(created_at) as latest_date FROM ingestion_feed_runs GROUP BY id ORDER BY id DESC LIMIT 1
    `);
    
    console.log('Latest job info:', latestJob.rows[0]);
    console.log('\n');
    
    // Get all statuses in ingestion_feed_runs
    const statuses = await query(`
      SELECT DISTINCT status, COUNT(*) as count FROM ingestion_feed_runs GROUP BY status ORDER BY count DESC
    `);
    
    console.log('Status distribution in ingestion_feed_runs:');
    statuses.rows.forEach(r => console.log(`  ${r.status}: ${r.count}`));
    
    console.log('\n');
    
    // Get latest feed runs 
    const latest = await query(`
      SELECT id, job_id, source_registry_id, feed_name, status, created_at 
      FROM ingestion_feed_runs 
      ORDER BY created_at DESC LIMIT 30
    `);
    
    console.log('Latest 30 feed runs:');
    latest.rows.forEach(r => {
      console.log(`  Job ${r.job_id}: ${r.source_registry_id.padEnd(25)} ${r.status.padEnd(12)} ${r.created_at}`);
    });

  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
