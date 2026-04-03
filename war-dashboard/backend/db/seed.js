'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { query, pool } = require('../lib/db');
const { syncSourceRegistry } = require('../modules/ingestion/source-registry');
const { syncStreamRegistry, verifyStreamRegistry } = require('../modules/observability/stream-registry');

const SEEDS_DIR = path.join(__dirname, 'seeds');

async function run() {
  const entries = (await fs.readdir(SEEDS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of entries) {
    const sql = await fs.readFile(path.join(SEEDS_DIR, file), 'utf8');
    await query(sql);
    console.log(`[seed] executed ${file}`);
  }

  const sourceSummary = await syncSourceRegistry();
  console.log(`[seed] synced source registry (${sourceSummary.totalSourcesConfigured} configured)`);

  const streamSummary = await syncStreamRegistry();
  console.log(`[seed] synced stream registry (${streamSummary.totalChannelsConfigured} configured)`);

  await verifyStreamRegistry({ force: true });
  console.log('[seed] verified stream registry');
}

run()
  .catch((err) => {
    console.error('[seed] failed', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
