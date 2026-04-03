'use strict';

/**
 * One-shot CLI runner for the auto-optimizer.
 * Usage: node backend/jobs/auto-optimize.js
 * (also wired into server.js on a schedule automatically)
 */

require('dotenv').config({ path: '.env.local' });

const { runAutoOptimizer } = require('../modules/self-optimization/service');
const { pool }             = require('../lib/db');

(async () => {
  try {
    const report = await runAutoOptimizer();
    console.log('[auto-optimizer] completed:', JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('[auto-optimizer] fatal:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
