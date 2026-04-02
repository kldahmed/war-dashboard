'use strict';

const assert = require('node:assert/strict');

const baseUrl = String(process.env.WAVE1_BASE_URL || '').trim();
if (!baseUrl) {
  console.error('WAVE1_BASE_URL is required, example: https://your-app.vercel.app');
  process.exit(1);
}

function joinPath(pathname) {
  return `${baseUrl.replace(/\/$/, '')}${pathname}`;
}

async function fetchJson(pathname) {
  const res = await fetch(joinPath(pathname));
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function run() {
  const health = await fetchJson('/api/health');
  assert.equal(health.res.status, 200, 'health endpoint status must be 200');
  assert.equal(health.body.status, 'ok', 'health status must be ok');
  assert.equal(health.body.runtime, 'vercel', 'health runtime must be vercel');

  const metrics = await fetchJson('/api/health/metrics-basic');
  assert.equal(metrics.res.status, 200, 'metrics endpoint status must be 200');
  assert.equal(metrics.body.runtime, 'vercel', 'metrics runtime must be vercel');
  assert.ok(metrics.body.counters && typeof metrics.body.counters === 'object', 'metrics counters must exist');

  const feed = await fetchJson('/api/news/feed?limit=5');
  assert.equal(feed.res.status, 200, 'feed endpoint status must be 200');
  assert.equal(feed.body.mode, 'stored', 'feed mode must be stored');
  assert.equal(feed.body.fallback_used, false, 'feed fallback_used must be false');
  assert.ok(Array.isArray(feed.body.items), 'feed items must be an array');
  assert.ok(feed.body.freshness && typeof feed.body.freshness === 'object', 'feed freshness must exist');
  assert.equal(typeof feed.body.item_count, 'number', 'feed item_count must be a number');
  assert.equal(feed.body.runtime, 'vercel', 'feed runtime must be vercel');

  console.log('wave1 vercel check passed');
  console.log(JSON.stringify({
    health: {
      mode: health.body.feed_mode,
      verify_mode: health.body.verify_mode,
      fallback_enabled: health.body.feed_fallback_enabled,
      correlation_id: health.body.correlation_id,
    },
    feed: {
      mode: feed.body.mode,
      fallback_used: feed.body.fallback_used,
      item_count: feed.body.item_count,
      freshness: feed.body.freshness,
      correlation_id: feed.body.correlation_id,
    },
  }, null, 2));
}

run().catch((err) => {
  console.error('wave1 vercel check failed:', err.message);
  process.exit(1);
});
