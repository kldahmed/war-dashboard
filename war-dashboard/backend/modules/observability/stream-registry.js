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
  {
    id: 'al-jazeera-live',
    name: 'الجزيرة',
    language: 'ar',
    provider: 'native_web',
    sourceDomain: 'aljazeera.net',
    officialPageUrl: 'https://www.aljazeera.net/live',
    embedUrl: null,
    externalWatchUrl: 'https://www.aljazeera.net/live',
    embedSupported: false,
    sortOrder: 10,
    active: true,
  },
  {
    id: 'al-arabiya-live',
    name: 'العربية',
    language: 'ar',
    provider: 'native_web',
    sourceDomain: 'alarabiya.net',
    officialPageUrl: 'https://www.alarabiya.net/live-stream',
    embedUrl: null,
    externalWatchUrl: 'https://www.alarabiya.net/live-stream',
    embedSupported: false,
    sortOrder: 20,
    active: true,
  },
  {
    id: 'sky-news-arabia-live',
    name: 'سكاي نيوز عربية',
    language: 'ar',
    provider: 'native_web',
    sourceDomain: 'skynewsarabia.com',
    officialPageUrl: 'https://www.skynewsarabia.com/live',
    embedUrl: null,
    externalWatchUrl: 'https://www.skynewsarabia.com/live',
    embedSupported: false,
    sortOrder: 30,
    active: true,
  },
  {
    id: 'bbc-arabic-live',
    name: 'BBC News عربي',
    language: 'ar',
    provider: 'native_web',
    sourceDomain: 'bbc.com',
    officialPageUrl: 'https://www.bbc.com/arabic',
    embedUrl: null,
    externalWatchUrl: 'https://www.bbc.com/arabic',
    embedSupported: false,
    sortOrder: 40,
    active: true,
  },
  {
    id: 'france24-ar-live',
    name: 'France 24 Arabic',
    language: 'ar',
    provider: 'native_web',
    sourceDomain: 'france24.com',
    officialPageUrl: 'https://www.france24.com/ar/direct',
    embedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCQfwfsi5VrQ8yKZ-UWmAEFg',
    externalWatchUrl: 'https://www.france24.com/ar/direct',
    embedSupported: true,
    sortOrder: 50,
    active: true,
  },
  {
    id: 'rt-ar-live',
    name: 'RT Arabic',
    language: 'ar',
    provider: 'native_web',
    sourceDomain: 'arabic.rt.com',
    officialPageUrl: 'https://arabic.rt.com/live/',
    embedUrl: null,
    externalWatchUrl: 'https://arabic.rt.com/live/',
    embedSupported: false,
    sortOrder: 60,
    active: true,
  },
  {
    id: 'trt-arabi-live',
    name: 'TRT عربي',
    language: 'ar',
    provider: 'native_web',
    sourceDomain: 'trtarabi.com',
    officialPageUrl: 'https://www.trtarabi.com/live',
    embedUrl: null,
    externalWatchUrl: 'https://www.trtarabi.com/live',
    embedSupported: false,
    sortOrder: 70,
    active: true,
  },
  {
    id: 'dw-live',
    name: 'DW News',
    language: 'en',
    provider: 'youtube',
    sourceDomain: 'dw.com',
    officialPageUrl: 'https://www.dw.com/en/live-tv/s-100825',
    embedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCknLrEdhRCp1aegoMqRaCZg',
    externalWatchUrl: 'https://www.dw.com/en/live-tv/s-100825',
    embedSupported: true,
    sortOrder: 80,
    active: true,
  },
  {
    id: 'reuters-live',
    name: 'Reuters Live',
    language: 'en',
    provider: 'youtube',
    sourceDomain: 'reuters.com',
    officialPageUrl: 'https://www.reuters.com/world/',
    embedUrl: 'https://www.youtube.com/embed/live_stream?channel=UChqUTb7kYRX8-EiaN3XFrSQ',
    externalWatchUrl: 'https://www.reuters.com/world/',
    embedSupported: true,
    sortOrder: 90,
    active: true,
  },
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

async function verifySingleChannel(channel) {
  if (!channel.embed_url) {
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