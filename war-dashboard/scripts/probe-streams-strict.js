'use strict';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://probe:probe@127.0.0.1:5432/probe';
}

const { OFFICIAL_STREAM_REGISTRY } = require('../backend/modules/observability/stream-registry');

const TIMEOUT_MS = 12000;

function absoluteUrl(baseUrl, ref) {
  try {
    return new URL(ref, baseUrl).toString();
  } catch (_e) {
    return null;
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'war-dashboard-strict-probe/1.0',
        Accept: 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*',
      },
    });

    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      type: String(response.headers.get('content-type') || ''),
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHeadOrGet(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'war-dashboard-strict-probe/1.0',
      },
    });

    if (!response.ok || Number(response.status || 0) >= 400) {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'war-dashboard-strict-probe/1.0',
          Range: 'bytes=0-512',
        },
      });
    }

    return {
      ok: response.ok,
      status: response.status,
      type: String(response.headers.get('content-type') || ''),
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseM3uEntries(playlistBody) {
  return String(playlistBody || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function firstSegmentOrChild(entries) {
  if (!entries.length) return null;
  return entries[0];
}

async function probeChannel(channel) {
  const result = {
    id: channel.id,
    name: channel.name,
    category: channel.category,
    url: channel.embedUrl,
    healthy: false,
    stage: 'master',
    details: {},
    error: null,
  };

  try {
    const master = await fetchText(channel.embedUrl);
    result.details.masterStatus = master.status;
    result.details.masterType = master.type;

    if (!master.ok) {
      result.error = `master_http_${master.status}`;
      return result;
    }

    if (!master.body.includes('#EXTM3U')) {
      result.error = 'master_not_m3u8';
      return result;
    }

    const entries = parseM3uEntries(master.body);
    const firstRef = firstSegmentOrChild(entries);
    if (!firstRef) {
      result.error = 'master_empty';
      return result;
    }

    const firstUrl = absoluteUrl(channel.embedUrl, firstRef);
    if (!firstUrl) {
      result.error = 'master_bad_ref';
      return result;
    }

    result.stage = 'child';
    const childLooksLikePlaylist = firstUrl.toLowerCase().includes('.m3u8') || firstRef.toLowerCase().includes('.m3u8');

    if (childLooksLikePlaylist) {
      const child = await fetchText(firstUrl);
      result.details.childStatus = child.status;
      result.details.childType = child.type;

      if (!child.ok) {
        result.error = `child_http_${child.status}`;
        return result;
      }

      if (!child.body.includes('#EXTM3U')) {
        result.error = 'child_not_m3u8';
        return result;
      }

      const childEntries = parseM3uEntries(child.body);
      const segRef = firstSegmentOrChild(childEntries);
      if (!segRef) {
        result.error = 'child_empty';
        return result;
      }

      const segUrl = absoluteUrl(firstUrl, segRef);
      if (!segUrl) {
        result.error = 'child_bad_ref';
        return result;
      }

      result.stage = 'segment';
      const seg = await fetchHeadOrGet(segUrl);
      result.details.segmentStatus = seg.status;
      result.details.segmentType = seg.type;
      if (!seg.ok) {
        result.error = `segment_http_${seg.status}`;
        return result;
      }
    } else {
      result.stage = 'segment';
      const seg = await fetchHeadOrGet(firstUrl);
      result.details.segmentStatus = seg.status;
      result.details.segmentType = seg.type;
      if (!seg.ok) {
        result.error = `segment_http_${seg.status}`;
        return result;
      }
    }

    result.healthy = true;
    return result;
  } catch (error) {
    result.error = String(error && error.message ? error.message : error);
    return result;
  }
}

(async () => {
  const channels = OFFICIAL_STREAM_REGISTRY.filter((c) => c.provider === 'hls' && c.embedUrl);
  const rows = [];

  for (const c of channels) {
    rows.push(await probeChannel(c));
  }

  const healthy = rows.filter((r) => r.healthy);
  const unhealthy = rows.filter((r) => !r.healthy);

  const byCategory = rows.reduce((acc, r) => {
    const cat = r.category || 'other';
    if (!acc[cat]) acc[cat] = { total: 0, healthy: 0, unhealthy: 0 };
    acc[cat].total += 1;
    if (r.healthy) acc[cat].healthy += 1;
    else acc[cat].unhealthy += 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    summary: {
      total: rows.length,
      healthy: healthy.length,
      unhealthy: unhealthy.length,
      byCategory,
    },
    unhealthy,
  }, null, 2));
})();
