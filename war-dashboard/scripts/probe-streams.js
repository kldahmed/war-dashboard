'use strict';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://probe:probe@127.0.0.1:5432/probe';
}

const { OFFICIAL_STREAM_REGISTRY } = require('../backend/modules/observability/stream-registry');

const TIMEOUT_MS = 10000;

function withTimeout(promise, ms, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    done: promise(controller.signal).finally(() => clearTimeout(timer)).catch((error) => {
      throw new Error(`${label}: ${error.message}`);
    }),
  };
}

async function probeHls(url) {
  const request = withTimeout(
    (signal) => fetch(url, {
      method: 'GET',
      signal,
      headers: {
        'User-Agent': 'war-dashboard-probe/1.0',
        'Accept': 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*',
      },
    }),
    TIMEOUT_MS,
    'timeout',
  );

  const response = await request.done;
  const body = await response.text();
  const hasExtM3u = body.includes('#EXTM3U');

  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    hasExtM3u,
  };
}

function pickCategories(channels) {
  const grouped = new Map();
  for (const channel of channels) {
    const key = channel.category || 'other';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(channel);
  }
  return grouped;
}

(async () => {
  const channels = OFFICIAL_STREAM_REGISTRY.filter((c) => c.embedUrl && c.provider === 'hls');
  const byCategory = pickCategories(channels);

  const results = [];
  for (const channel of channels) {
    try {
      const probe = await probeHls(channel.embedUrl);
      const healthy = probe.ok && probe.hasExtM3u;
      results.push({
        id: channel.id,
        name: channel.name,
        category: channel.category,
        url: channel.embedUrl,
        healthy,
        ...probe,
        error: null,
      });
    } catch (error) {
      results.push({
        id: channel.id,
        name: channel.name,
        category: channel.category,
        url: channel.embedUrl,
        healthy: false,
        ok: false,
        status: 0,
        contentType: '',
        hasExtM3u: false,
        error: String(error.message || error),
      });
    }
  }

  const healthy = results.filter((r) => r.healthy);
  const unhealthy = results.filter((r) => !r.healthy);

  const summary = {
    total: results.length,
    healthy: healthy.length,
    unhealthy: unhealthy.length,
    byCategory: [...byCategory.keys()].sort().reduce((acc, cat) => {
      const catRows = results.filter((r) => r.category === cat);
      acc[cat] = {
        total: catRows.length,
        healthy: catRows.filter((r) => r.healthy).length,
      };
      return acc;
    }, {}),
  };

  console.log(JSON.stringify({ summary, unhealthy, sampleHealthy: healthy.slice(0, 8) }, null, 2));
})();
