/**
 * Local development API server — port 3001
 * Mirrors the Vercel /api/claude serverless function.
 *
 * Usage (handled by `npm run dev` automatically):
 *   node server.js
 *
 * Reads ANTHROPIC_API_KEY from .env.local
 */

require('dotenv').config({ path: '.env.local' });

const { randomUUID } = require('node:crypto');
const createApp = require('./backend/app/createApp');
const env = require('./backend/config/env');
const { runRssIngestion } = require('./backend/modules/ingestion/service');
const { runAutoOptimizer } = require('./backend/modules/self-optimization/service');
const { pool } = require('./backend/lib/db');

const app = createApp();

let ingestionTimer = null;
let ingestionInFlight = false;

let optimizerTimer = null;
let optimizerInFlight = false;

function scheduleIngestion() {
  if (!env.ingestionScheduleEnabled) return;

  const runScheduledIngestion = async () => {
    if (ingestionInFlight) return;
    ingestionInFlight = true;
    try {
      await runRssIngestion({
        correlationId: randomUUID(),
        triggeredBy: 'scheduled_server',
      });
    } catch (error) {
      console.error('[ingestion:schedule] failed', error.message);
    } finally {
      ingestionInFlight = false;
    }
  };

  ingestionTimer = setInterval(runScheduledIngestion, env.ingestionScheduleMs);
}

function scheduleOptimizer() {
  if (!env.optimizerEnabled) return;

  const runScheduledOptimizer = async () => {
    if (optimizerInFlight) return;
    optimizerInFlight = true;
    try {
      await runAutoOptimizer({ correlationId: randomUUID() });
    } catch (error) {
      console.error('[optimizer:schedule] failed', error.message);
    } finally {
      optimizerInFlight = false;
    }
  };

  optimizerTimer = setInterval(runScheduledOptimizer, env.optimizerScheduleMs);
}

app.listen(env.port, () => {
  const keySet = !!process.env.ANTHROPIC_API_KEY;
  console.log(`\n⚡ Dev API server → http://localhost:${env.port}`);
  console.log(`   ANTHROPIC_API_KEY: ${keySet ? '✅ loaded from .env.local' : '❌ NOT SET — add it to .env.local'}`);
  console.log(`   FEED_MODE: ${env.feedMode}`);
  console.log(`   FEED_FALLBACK_ENABLED: ${env.feedFallbackEnabled}`);
  console.log(`   DATABASE_URL configured: ${!!process.env.DATABASE_URL}`);
  console.log(`   INGESTION_SCHEDULE_ENABLED: ${env.ingestionScheduleEnabled}`);
  console.log(`   INGESTION_SCHEDULE_MS: ${env.ingestionScheduleMs}`);
  if (!keySet) {
    console.warn('\n   ⚠️  Copy .env.example → .env.local and set your key.\n');
  }
  scheduleIngestion();
  scheduleOptimizer();
});

process.on('SIGINT', async () => {
  if (ingestionTimer) clearInterval(ingestionTimer);
  if (optimizerTimer) clearInterval(optimizerTimer);
  await pool.end().catch(() => {});
  process.exit(0);
});
