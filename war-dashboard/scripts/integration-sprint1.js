'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const BASE_URL = process.env.SPRINT1_BASE_URL || 'http://localhost:3001';
const SERVER_START_TIMEOUT_MS = 20000;

async function waitForHealth(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch (_err) {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not become healthy in time');
}

function startServer() {
  const proc = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  proc.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  proc.stderr.on('data', (chunk) => process.stderr.write(`[server-err] ${chunk}`));
  return proc;
}

async function run() {
  const server = startServer();
  try {
    await waitForHealth(SERVER_START_TIMEOUT_MS);

    const sourceCreateRes = await fetch(`${BASE_URL}/api/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Integration Test Source',
        domain: `integration-${Date.now()}.example.com`,
        region: 'global',
        language: 'en',
        category: 'general',
        official_flag: false,
        trust_score: 65,
        status: 'active',
      }),
    });
    assert.equal(sourceCreateRes.status, 201);
    const sourceBody = await sourceCreateRes.json();
    assert.ok(sourceBody.item?.id);

    const feedCreateRes = await fetch(`${BASE_URL}/api/source-feeds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_id: sourceBody.item.id,
        feed_type: 'rss',
        endpoint: 'https://invalid.invalid/feed.xml',
        polling_interval_sec: 300,
        status: 'active',
      }),
    });
    assert.equal(feedCreateRes.status, 201);

    const ingestRes = await fetch(`${BASE_URL}/api/ingestion/jobs/run`, { method: 'POST' });
    assert.equal(ingestRes.status, 202);
    const ingestBody = await ingestRes.json();
    assert.ok(ingestBody.summary?.jobId);

    const metricsRes = await fetch(`${BASE_URL}/api/health/metrics-basic`);
    assert.equal(metricsRes.status, 200);
    const metricsBody = await metricsRes.json();
    assert.ok(metricsBody.counters);

    const feedRes = await fetch(`${BASE_URL}/api/news/feed?limit=5`);
    assert.equal(feedRes.status, 200);
    const feedBody = await feedRes.json();
    assert.ok(Array.isArray(feedBody.items));

    const legacyRes = await fetch(`${BASE_URL}/api/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptType: 'news', category: 'all' }),
    });
    assert.ok([200, 502, 503, 504].includes(legacyRes.status));

    console.log('integration sprint1 passed');
  } finally {
    server.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('integration sprint1 failed:', err.message);
  process.exitCode = 1;
});
