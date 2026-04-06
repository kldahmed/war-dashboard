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
const { runRssIngestion }  = require('./backend/modules/ingestion/service');
const { runAutoOptimizer } = require('./backend/modules/self-optimization/service');
const { generateSitrep }  = require('./backend/modules/intelligence/service');
const { refreshWeather }  = require('./backend/modules/weather/service');
const { refreshMarkets }  = require('./backend/modules/markets/service');
const sseHub = require('./backend/lib/sse-hub');
const { pool } = require('./backend/lib/db');

const app = createApp();

let ingestionTimer = null;
let ingestionInFlight = false;

let optimizerTimer = null;
let optimizerInFlight = false;

let sitrepTimer = null;
let sitrepInFlight = false;

let weatherTimer = null;
let weatherInFlight = false;

let marketsTimer = null;
let marketsInFlight = false;

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

function scheduleSitrep() {
  if (!env.sitrepEnabled) return;

  const runScheduledSitrep = async () => {
    if (sitrepInFlight) return;
    sitrepInFlight = true;
    try {
      await generateSitrep({ correlationId: randomUUID() });
    } catch (error) {
      console.error('[sitrep:schedule] failed', error.message);
    } finally {
      sitrepInFlight = false;
    }
  };

  // Run once at startup (after 60s to let ingestion settle), then on schedule
  setTimeout(runScheduledSitrep, 60_000);
  sitrepTimer = setInterval(runScheduledSitrep, env.sitrepScheduleMs);
}

function scheduleWeather() {
  if (!env.weatherScheduleEnabled || !env.weatherApiKey) return;

  const run = async () => {
    if (weatherInFlight) return;
    weatherInFlight = true;
    try { await refreshWeather(); }
    catch (err) { console.error('[weather:schedule] failed', err.message); }
    finally { weatherInFlight = false; }
  };

  // Run immediately at startup, then on schedule
  run();
  weatherTimer = setInterval(run, env.weatherScheduleMs);
}

function scheduleMarkets() {
  if (!env.marketsScheduleEnabled || !env.alphaVantageApiKey) return;

  const run = async () => {
    if (marketsInFlight) return;
    marketsInFlight = true;
    try { await refreshMarkets(); }
    catch (err) { console.error('[markets:schedule] failed', err.message); }
    finally { marketsInFlight = false; }
  };

  // Run immediately at startup, then on schedule
  run();
  marketsTimer = setInterval(run, env.marketsGoldScheduleMs);
}

app.listen(env.port, () => {
  sseHub.initDbListener().catch(() => {});
  const keySet = !!process.env.ANTHROPIC_API_KEY;
  console.log(`\n⚡ Dev API server → http://localhost:${env.port}`);
  console.log(`   ANTHROPIC_API_KEY: ${keySet ? '✅ loaded from .env.local' : '❌ NOT SET — add it to .env.local'}`);
  console.log(`   FEED_MODE: ${env.feedMode}`);
  console.log(`   FEED_FALLBACK_ENABLED: ${env.feedFallbackEnabled}`);
  console.log(`   DATABASE_URL configured: ${!!process.env.DATABASE_URL}`);
  console.log(`   INGESTION_SCHEDULE_ENABLED: ${env.ingestionScheduleEnabled}`);
  console.log(`   INGESTION_SCHEDULE_MS: ${env.ingestionScheduleMs}`);
  console.log(`   WEATHER_API_KEY: ${env.weatherApiKey ? '✅ set' : '⚠️  not set (weather panel disabled)'}`);
  console.log(`   ALPHAVANTAGE_API_KEY: ${env.alphaVantageApiKey ? '✅ set' : '⚠️  not set (markets panel disabled)'}`);
  if (!keySet) {
    console.warn('\n   ⚠️  Copy .env.example → .env.local and set your key.\n');
  }
  scheduleIngestion();
  scheduleOptimizer();
  scheduleSitrep();
  scheduleWeather();
  scheduleMarkets();
});

process.on('SIGINT', async () => {
  if (ingestionTimer) clearInterval(ingestionTimer);
  if (optimizerTimer) clearInterval(optimizerTimer);
  if (sitrepTimer)    clearInterval(sitrepTimer);
  if (weatherTimer)   clearInterval(weatherTimer);
  if (marketsTimer)   clearInterval(marketsTimer);
  await pool.end().catch(() => {});
  process.exit(0);
});
