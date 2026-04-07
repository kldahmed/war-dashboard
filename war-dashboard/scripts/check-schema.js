require('dotenv').config({ path: '.env.local' });
const { query, pool } = require('../backend/lib/db');

(async () => {
  try {
    // Get column info for ingestion_feed_runs and ingestion_runs
    const feedRunCols = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'ingestion_feed_runs' 
      ORDER BY ordinal_position
    `);
    
    const runCols = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'ingestion_runs' 
      ORDER BY ordinal_position
    `);
    
    console.log('ingestion_feed_runs columns:');
    feedRunCols.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));
    
    console.log('\ningestion_runs columns:');
    runCols.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));

  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
