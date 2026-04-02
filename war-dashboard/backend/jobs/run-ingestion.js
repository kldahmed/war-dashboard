'use strict';

const { randomUUID } = require('node:crypto');
const { runRssIngestion } = require('../modules/ingestion/service');
const { pool } = require('../lib/db');

async function main() {
  const summary = await runRssIngestion({
    correlationId: randomUUID(),
    triggeredBy: 'manual_script',
  });
  console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

main()
  .catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
