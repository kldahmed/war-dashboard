'use strict';

const { URL } = require('node:url');
const env = require('../../config/env');

function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

function normalizeCandidateChannel(channel = {}) {
  return {
    id: String(channel.id || '').trim() || null,
    name: String(channel.name || '').trim() || null,
    category: String(channel.category || 'other').trim().toLowerCase() || 'other',
    language: String(channel.language || 'ar').trim().toLowerCase() || 'ar',
    provider: String(channel.provider || 'hls').trim().toLowerCase() || 'hls',
    sourceDomain: String(channel.sourceDomain || channel.source_domain || '').trim() || null,
    officialPageUrl: safeHttpUrl(channel.officialPageUrl || channel.official_page_url),
    embedUrl: safeHttpUrl(channel.embedUrl || channel.embed_url),
    externalWatchUrl: safeHttpUrl(channel.externalWatchUrl || channel.external_watch_url),
  };
}

function absoluteUrl(baseUrl, ref) {
  try {
    return new URL(ref, baseUrl).toString();
  } catch (_error) {
    return null;
  }
}

async function fetchText(url, timeoutMs = env.streamVerificationTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'war-dashboard-stream-probe/1.0',
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

async function fetchHeadOrGet(url, timeoutMs = env.streamVerificationTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'war-dashboard-stream-probe/1.0',
      },
    });

    if (!response.ok || Number(response.status || 0) >= 400) {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'war-dashboard-stream-probe/1.0',
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

async function probeChannel(channel) {
  const normalized = normalizeCandidateChannel(channel);
  const result = {
    id: normalized.id,
    name: normalized.name,
    category: normalized.category,
    language: normalized.language,
    url: normalized.embedUrl,
    healthy: false,
    stage: 'validation',
    details: {},
    error: null,
  };

  if (!normalized.id || !normalized.name || normalized.provider !== 'hls' || !normalized.embedUrl) {
    result.error = 'invalid_candidate';
    return result;
  }

  try {
    const master = await fetchText(normalized.embedUrl);
    result.stage = 'master';
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
    const firstRef = entries[0] || null;
    if (!firstRef) {
      result.error = 'master_empty';
      return result;
    }

    const firstUrl = absoluteUrl(normalized.embedUrl, firstRef);
    if (!firstUrl) {
      result.error = 'master_bad_ref';
      return result;
    }

    const childLooksLikePlaylist = firstUrl.toLowerCase().includes('.m3u8') || firstRef.toLowerCase().includes('.m3u8');

    if (childLooksLikePlaylist) {
      const child = await fetchText(firstUrl);
      result.stage = 'child';
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
      const segRef = childEntries[0] || null;
      if (!segRef) {
        result.error = 'child_empty';
        return result;
      }

      const segUrl = absoluteUrl(firstUrl, segRef);
      if (!segUrl) {
        result.error = 'child_bad_ref';
        return result;
      }

      const seg = await fetchHeadOrGet(segUrl);
      result.stage = 'segment';
      result.details.segmentStatus = seg.status;
      result.details.segmentType = seg.type;
      if (!seg.ok) {
        result.error = `segment_http_${seg.status}`;
        return result;
      }
    } else {
      const seg = await fetchHeadOrGet(firstUrl);
      result.stage = 'segment';
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

async function probeChannels(channels, options = {}) {
  const list = Array.isArray(channels) ? channels : [];
  const arabicOnly = options.arabicOnly !== false;
  const directOnly = options.directOnly !== false;
  const normalized = list.map(normalizeCandidateChannel).filter((entry) => entry.id && entry.name && entry.provider === 'hls');

  const results = [];
  for (const channel of normalized) {
    if (arabicOnly && channel.language !== 'ar') {
      results.push({
        id: channel.id,
        name: channel.name,
        category: channel.category,
        language: channel.language,
        url: channel.embedUrl,
        healthy: false,
        stage: 'policy',
        details: {},
        error: 'non_arabic_candidate',
      });
      continue;
    }
    const probe = await probeChannel(channel);
    results.push(probe);
  }

  return {
    total: results.length,
    healthy: results.filter((row) => row.healthy).length,
    unhealthy: results.filter((row) => !row.healthy).length,
    approved: results.filter((row) => row.healthy && (!directOnly || row.stage === 'segment')),
    results,
  };
}

module.exports = {
  normalizeCandidateChannel,
  probeChannel,
  probeChannels,
  safeHttpUrl,
};
