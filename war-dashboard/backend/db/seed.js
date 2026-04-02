'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { query, pool } = require('../lib/db');

const SEEDS_DIR = path.join(__dirname, 'seeds');

async function run() {
  const entries = (await fs.readdir(SEEDS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of entries) {
    const sql = await fs.readFile(path.join(SEEDS_DIR, file), 'utf8');
    await query(sql);
    console.log(`[seed] executed ${file}`);
  }
}

run()
  .catch((err) => {
    console.error('[seed] failed', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
