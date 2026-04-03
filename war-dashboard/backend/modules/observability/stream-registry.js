'use strict';

const { URL } = require('node:url');
const { query, withTransaction } = require('../../lib/db');
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

const OFFICIAL_STREAM_REGISTRY = [
  { id: 'al-jazeera-live', name: 'Al Jazeera', language: 'ar', provider: 'native_web', sourceDomain: 'aljazeera.net', officialPageUrl: 'https://www.aljazeera.net/live', embedUrl: null, externalWatchUrl: 'https://www.aljazeera.net/live', embedSupported: false, sortOrder: 10, active: true },
  { id: 'al-jazeera-mubasher', name: 'Al Jazeera Mubasher', language: 'ar', provider: 'native_web', sourceDomain: 'aljazeera.net', officialPageUrl: 'https://mubasher.aljazeera.net', embedUrl: null, externalWatchUrl: 'https://mubasher.aljazeera.net', embedSupported: false, sortOrder: 20, active: true },
  { id: 'al-arabiya-live', name: 'Al Arabiya', language: 'ar', provider: 'native_web', sourceDomain: 'alarabiya.net', officialPageUrl: 'https://www.alarabiya.net/live-stream', embedUrl: null, externalWatchUrl: 'https://www.alarabiya.net/live-stream', embedSupported: false, sortOrder: 30, active: true },
  { id: 'al-hadath-live', name: 'Al Hadath', language: 'ar', provider: 'native_web', sourceDomain: 'alhadath.net', officialPageUrl: 'https://www.alhadath.net/live', embedUrl: null, externalWatchUrl: 'https://www.alhadath.net/live', embedSupported: false, sortOrder: 40, active: true },
  { id: 'sky-news-arabia-live', name: 'Sky News Arabia', language: 'ar', provider: 'native_web', sourceDomain: 'skynewsarabia.com', officialPageUrl: 'https://www.skynewsarabia.com/live', embedUrl: null, externalWatchUrl: 'https://www.skynewsarabia.com/live', embedSupported: false, sortOrder: 50, active: true },
  { id: 'bbc-arabic-live', name: 'BBC Arabic', language: 'ar', provider: 'native_web', sourceDomain: 'bbc.com', officialPageUrl: 'https://www.bbc.com/arabic', embedUrl: null, externalWatchUrl: 'https://www.bbc.com/arabic', embedSupported: false, sortOrder: 60, active: true },
  { id: 'france24-ar-live', name: 'France24 Arabic', language: 'ar', provider: 'youtube', sourceDomain: 'france24.com', officialPageUrl: 'https://www.france24.com/ar/direct', embedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCQfwfsi5VrQ8yKZ-UWmAEFg', externalWatchUrl: 'https://www.france24.com/ar/direct', embedSupported: true, sortOrder: 70, active: true },
  { id: 'dw-ar-live', name: 'DW Arabic', language: 'ar', provider: 'native_web', sourceDomain: 'dw.com', officialPageUrl: 'https://www.dw.com/ar/', embedUrl: null, externalWatchUrl: 'https://www.dw.com/ar/', embedSupported: false, sortOrder: 80, active: true },
  { id: 'rt-ar-live', name: 'RT Arabic', language: 'ar', provider: 'native_web', sourceDomain: 'arabic.rt.com', officialPageUrl: 'https://arabic.rt.com/live/', embedUrl: null, externalWatchUrl: 'https://arabic.rt.com/live/', embedSupported: false, sortOrder: 90, active: true },
  { id: 'trt-arabi-live', name: 'TRT Arabic', language: 'ar', provider: 'native_web', sourceDomain: 'trtarabi.com', officialPageUrl: 'https://www.trtarabi.com/live', embedUrl: null, externalWatchUrl: 'https://www.trtarabi.com/live', embedSupported: false, sortOrder: 100, active: true },
  { id: 'asharq-news-live', name: 'Asharq News', language: 'ar', provider: 'native_web', sourceDomain: 'asharq.com', officialPageUrl: 'https://asharq.com/live', embedUrl: null, externalWatchUrl: 'https://asharq.com/live', embedSupported: false, sortOrder: 110, active: true },
  { id: 'alhurra-live', name: 'Alhurra', language: 'ar', provider: 'native_web', sourceDomain: 'alhurra.com', officialPageUrl: 'https://www.alhurra.com/live', embedUrl: null, externalWatchUrl: 'https://www.alhurra.com/live', embedSupported: false, sortOrder: 115, active: true },
  { id: 'al-mayadeen-live', name: 'Al Mayadeen', language: 'ar', provider: 'native_web', sourceDomain: 'almayadeen.net', officialPageUrl: 'https://www.almayadeen.net/live', embedUrl: null, externalWatchUrl: 'https://www.almayadeen.net/live', embedSupported: false, sortOrder: 120, active: true },
  { id: 'al-manar-live', name: 'Al Manar', language: 'ar', provider: 'native_web', sourceDomain: 'almanar.com.lb', officialPageUrl: 'https://www.almanar.com.lb/live', embedUrl: null, externalWatchUrl: 'https://www.almanar.com.lb/live', embedSupported: false, sortOrder: 130, active: true },
  { id: 'alalam-live', name: 'Alalam', language: 'ar', provider: 'native_web', sourceDomain: 'alalam.ir', officialPageUrl: 'https://www.alalam.ir/live', embedUrl: null, externalWatchUrl: 'https://www.alalam.ir/live', embedSupported: false, sortOrder: 140, active: true },
  { id: 'cgtn-ar-live', name: 'CGTN Arabic', language: 'ar', provider: 'native_web', sourceDomain: 'arabic.cgtn.com', officialPageUrl: 'https://arabic.cgtn.com', embedUrl: null, externalWatchUrl: 'https://arabic.cgtn.com', embedSupported: false, sortOrder: 150, active: true },
  { id: 'euronews-ar-live', name: 'Euronews Arabic', language: 'ar', provider: 'native_web', sourceDomain: 'euronews.com', officialPageUrl: 'https://arabic.euronews.com/live', embedUrl: null, externalWatchUrl: 'https://arabic.euronews.com/live', embedSupported: false, sortOrder: 155, active: true },
  { id: 'cnn-live', name: 'CNN', language: 'en', provider: 'native_web', sourceDomain: 'cnn.com', officialPageUrl: 'https://edition.cnn.com/videos/live', embedUrl: null, externalWatchUrl: 'https://edition.cnn.com/videos/live', embedSupported: false, sortOrder: 160, active: true },
  { id: 'bbc-world-live', name: 'BBC World', language: 'en', provider: 'native_web', sourceDomain: 'bbc.com', officialPageUrl: 'https://www.bbc.com/news/live', embedUrl: null, externalWatchUrl: 'https://www.bbc.com/news/live', embedSupported: false, sortOrder: 170, active: true },
  { id: 'sky-news-live', name: 'Sky News', language: 'en', provider: 'native_web', sourceDomain: 'news.sky.com', officialPageUrl: 'https://news.sky.com/watch-live', embedUrl: null, externalWatchUrl: 'https://news.sky.com/watch-live', embedSupported: false, sortOrder: 180, active: true },
  { id: 'france24-en-live', name: 'France24 English', language: 'en', provider: 'youtube', sourceDomain: 'france24.com', officialPageUrl: 'https://www.france24.com/en/live', embedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCQfwfsi5VrQ8yKZ-UWmAEFg', externalWatchUrl: 'https://www.france24.com/en/live', embedSupported: true, sortOrder: 190, active: true },
  { id: 'bloomberg-tv-live', name: 'Bloomberg TV', language: 'en', provider: 'native_web', sourceDomain: 'bloomberg.com', officialPageUrl: 'https://www.bloomberg.com/live', embedUrl: null, externalWatchUrl: 'https://www.bloomberg.com/live', embedSupported: false, sortOrder: 200, active: true },
  { id: 'cnbc-live', name: 'CNBC', language: 'en', provider: 'native_web', sourceDomain: 'cnbc.com', officialPageUrl: 'https://www.cnbc.com/live-tv/', embedUrl: null, externalWatchUrl: 'https://www.cnbc.com/live-tv/', embedSupported: false, sortOrder: 210, active: true },
  { id: 'al-jazeera-en-live', name: 'Al Jazeera English', language: 'en', provider: 'native_web', sourceDomain: 'aljazeera.com', officialPageUrl: 'https://www.aljazeera.com/live/', embedUrl: null, externalWatchUrl: 'https://www.aljazeera.com/live/', embedSupported: false, sortOrder: 220, active: true },
  { id: 'dw-live', name: 'DW News', language: 'en', provider: 'youtube', sourceDomain: 'dw.com', officialPageUrl: 'https://www.dw.com/en/live-tv/s-100825', embedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCknLrEdhRCp1aegoMqRaCZg', externalWatchUrl: 'https://www.dw.com/en/live-tv/s-100825', embedSupported: true, sortOrder: 230, active: true },
  { id: 'reuters-live', name: 'Reuters Live', language: 'en', provider: 'youtube', sourceDomain: 'reuters.com', officialPageUrl: 'https://www.reuters.com/world/', embedUrl: 'https://www.youtube.com/embed/live_stream?channel=UChqUTb7kYRX8-EiaN3XFrSQ', externalWatchUrl: 'https://www.reuters.com/world/', embedSupported: true, sortOrder: 240, active: true },
  { id: 'trt-world-live', name: 'TRT World', language: 'en', provider: 'native_web', sourceDomain: 'trtworld.com', officialPageUrl: 'https://www.trtworld.com/live', embedUrl: null, externalWatchUrl: 'https://www.trtworld.com/live', embedSupported: false, sortOrder: 245, active: true },
  { id: 'abc-news-live', name: 'ABC News Live', language: 'en', provider: 'native_web', sourceDomain: 'abcnews.go.com', officialPageUrl: 'https://abcnews.go.com/Live', embedUrl: null, externalWatchUrl: 'https://abcnews.go.com/Live', embedSupported: false, sortOrder: 250, active: true },
  { id: 'nbc-news-now', name: 'NBC News NOW', language: 'en', provider: 'native_web', sourceDomain: 'nbcnews.com', officialPageUrl: 'https://www.nbcnews.com/now', embedUrl: null, externalWatchUrl: 'https://www.nbcnews.com/now', embedSupported: false, sortOrder: 260, active: true },
].map((entry) => ({
  ...entry,
  officialPageUrl: safeHttpUrl(entry.officialPageUrl),
  embedUrl: safeHttpUrl(entry.embedUrl),
  externalWatchUrl: safeHttpUrl(entry.externalWatchUrl),
})).filter((entry) => entry.officialPageUrl);

async function syncStreamRegistry() {
  return withTransaction(async (client) => {
    for (const channel of OFFICIAL_STREAM_REGISTRY) {
      await client.query(
        `INSERT INTO stream_channels (
          registry_id, name, language, provider, source_domain, official_page_url, embed_url, external_watch_url, embed_supported, playback_mode, status, sort_order
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (registry_id) DO UPDATE
        SET name = EXCLUDED.name,
            language = EXCLUDED.language,
            provider = EXCLUDED.provider,
            source_domain = EXCLUDED.source_domain,
            official_page_url = EXCLUDED.official_page_url,
            embed_url = EXCLUDED.embed_url,
            external_watch_url = EXCLUDED.external_watch_url,
            embed_supported = EXCLUDED.embed_supported,
            playback_mode = EXCLUDED.playback_mode,
            status = EXCLUDED.status,
            sort_order = EXCLUDED.sort_order,
            updated_at = NOW()`,
        [
          channel.id,
          channel.name,
          channel.language,
          channel.provider,
          channel.sourceDomain || null,
          channel.officialPageUrl,
          channel.embedUrl,
          channel.externalWatchUrl,
          Boolean(channel.embedSupported && channel.embedUrl),
          channel.embedSupported && channel.embedUrl ? 'playable' : 'external_only',
          channel.active ? 'active' : 'inactive',
          channel.sortOrder,
        ],
      );
    }

    return { totalChannelsConfigured: OFFICIAL_STREAM_REGISTRY.length };
  });
}

function detectBlockedEmbedding(headers) {
  const frameOptions = String(headers.get('x-frame-options') || '').toLowerCase();
  const contentSecurityPolicy = String(headers.get('content-security-policy') || '').toLowerCase();
  if (frameOptions.includes('deny') || frameOptions.includes('sameorigin')) return true;
  if (contentSecurityPolicy.includes('frame-ancestors') && !contentSecurityPolicy.includes("frame-ancestors *")) return true;
  return false;
}

async function probeWatchUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.streamVerificationTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'war-dashboard-stream-verifier/1.0',
      },
    });

    return {
      ok: response.ok,
      status: Number(response.status || 0),
      blocked: detectBlockedEmbedding(response.headers),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function verifySingleChannel(channel) {
  if (!channel.embed_url && !channel.external_watch_url && !channel.official_page_url) {
    await query(
      `UPDATE stream_channels
       SET status = 'inactive',
           embed_supported = FALSE,
           playback_mode = 'external_only',
           verification_checked_at = NOW(),
           last_verification_status = 'removed_unavailable',
           last_verification_error = 'stream_removed_no_valid_urls',
           updated_at = NOW()
       WHERE id = $1`,
      [channel.id],
    );
    return { id: channel.registry_id, embedSupported: false, verificationStatus: 'removed_unavailable', removed: true };
  }

  if (!channel.embed_url) {
    const watchUrl = channel.external_watch_url || channel.official_page_url;
    try {
      const probe = await probeWatchUrl(watchUrl);
      if ([404, 410, 451].includes(probe.status) || !probe.ok) {
        await query(
          `UPDATE stream_channels
           SET status = 'inactive',
               embed_supported = FALSE,
               playback_mode = 'external_only',
               verification_checked_at = NOW(),
               last_verification_status = 'removed_unavailable',
               last_verification_error = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [channel.id, `external_unavailable_${probe.status || 'unknown'}`],
        );
        return { id: channel.registry_id, embedSupported: false, verificationStatus: 'removed_unavailable', removed: true };
      }
    } catch (error) {
      await query(
        `UPDATE stream_channels
         SET status = 'inactive',
             embed_supported = FALSE,
             playback_mode = 'external_only',
             verification_checked_at = NOW(),
             last_verification_status = 'removed_unavailable',
             last_verification_error = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [channel.id, String(error.message || 'external_verification_failed').slice(0, 500)],
      );
      return { id: channel.registry_id, embedSupported: false, verificationStatus: 'removed_unavailable', removed: true };
    }

    await query(
      `UPDATE stream_channels
       SET embed_supported = FALSE,
           playback_mode = 'external_only',
           verification_checked_at = NOW(),
           last_verification_status = 'external_only',
           last_verification_error = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [channel.id],
    );
    return { id: channel.registry_id, embedSupported: false, verificationStatus: 'external_only' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.streamVerificationTimeoutMs);

  try {
    const response = await fetch(channel.embed_url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'war-dashboard-stream-verifier/1.0',
      },
    });
    const blocked = detectBlockedEmbedding(response.headers);
    const unavailable = [404, 410, 451].includes(Number(response.status || 0));

    if (unavailable) {
      await query(
        `UPDATE stream_channels
         SET status = 'inactive',
             embed_supported = FALSE,
             playback_mode = 'external_only',
             verification_checked_at = NOW(),
             last_verification_status = 'removed_unavailable',
             last_verification_error = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [channel.id, `embed_unavailable_${response.status}`],
      );
      return {
        id: channel.registry_id,
        embedSupported: false,
        verificationStatus: 'removed_unavailable',
        removed: true,
      };
    }

    const watchProbe = channel.external_watch_url || channel.official_page_url
      ? await probeWatchUrl(channel.external_watch_url || channel.official_page_url).catch(() => null)
      : null;
    const watchUnavailable = watchProbe && ([404, 410, 451].includes(watchProbe.status) || !watchProbe.ok);

    if (watchUnavailable && unavailable) {
      await query(
        `UPDATE stream_channels
         SET status = 'inactive',
             embed_supported = FALSE,
             playback_mode = 'external_only',
             verification_checked_at = NOW(),
             last_verification_status = 'removed_unavailable',
             last_verification_error = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [channel.id, `stream_removed_${response.status}_${watchProbe.status}`],
      );
      return {
        id: channel.registry_id,
        embedSupported: false,
        verificationStatus: 'removed_unavailable',
        removed: true,
      };
    }

    await query(
      `UPDATE stream_channels
       SET embed_supported = $2,
           playback_mode = $3,
           verification_checked_at = NOW(),
           last_verification_status = $4,
           last_verification_error = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [
        channel.id,
        !blocked && response.ok,
        !blocked && response.ok ? 'playable' : 'external_only',
        !blocked && response.ok ? 'embed_ok' : 'embed_blocked',
      ],
    );
    return {
      id: channel.registry_id,
      embedSupported: !blocked && response.ok,
      verificationStatus: !blocked && response.ok ? 'embed_ok' : 'embed_blocked',
    };
  } catch (error) {
    await query(
      `UPDATE stream_channels
       SET embed_supported = FALSE,
           playback_mode = 'external_only',
           verification_checked_at = NOW(),
           last_verification_status = 'verification_failed',
           last_verification_error = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [channel.id, String(error.message || 'verification_failed').slice(0, 500)],
    );
    return {
      id: channel.registry_id,
      embedSupported: false,
      verificationStatus: 'verification_failed',
      errorMessage: error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyStreamRegistry({ force = false } = {}) {
  const result = await query(
    `SELECT id, registry_id, embed_url, verification_checked_at
     FROM stream_channels
     WHERE status = 'active'
       AND ($1::boolean = TRUE OR verification_checked_at IS NULL OR verification_checked_at < NOW() - INTERVAL '6 hours')
     ORDER BY sort_order ASC, id ASC`,
    [force],
  );

  const summaries = [];
  for (const row of result.rows) {
    summaries.push(await verifySingleChannel(row));
  }
  return summaries;
}

module.exports = {
  OFFICIAL_STREAM_REGISTRY,
  syncStreamRegistry,
  verifyStreamRegistry,
};