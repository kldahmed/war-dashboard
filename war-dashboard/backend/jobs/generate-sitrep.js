'use strict';

/**
 * One-shot CLI runner for SITREP generation.
 * Usage: node backend/jobs/generate-sitrep.js [--force]
 */

require('dotenv').config({ path: require('node:path').join(__dirname, '../../.env.local') });

const { generateSitrep } = require('../modules/intelligence/service');
const { pool }           = require('../lib/db');

const force = process.argv.includes('--force');

(async () => {
  try {
    const result = await generateSitrep({ force });
    if (result) {
      console.log('[sitrep] generated successfully:');
      console.log(`  ID:          ${result.id}`);
      console.log(`  Escalation:  ${result.escalation_level.toUpperCase()}`);
      console.log(`  Headline:    ${result.headline}`);
      console.log(`  Latency:     ${result.latencyMs}ms`);
    } else {
      console.log('[sitrep] skipped (cooldown or insufficient data). Use --force to override.');
    }
  } catch (err) {
    console.error('[sitrep] fatal:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
