'use strict';

const { URL } = require('node:url');
const { query, withTransaction } = require('../../lib/db');
const env = require('../../config/env');

const LAST_VERIFIED_AT = '2026-04-03T00:00:00.000Z';

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
  { id: 'asharq-news-live', name: 'Asharq News', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'asharq.com', officialPageUrl: 'https://asharq.com/live', embedUrl: 'https://live-news.asharq.com/asharq.m3u8', externalWatchUrl: 'https://asharq.com/live', embedSupported: true, sortOrder: 10, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'rt-ar-live', name: 'RT Arabic', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'arabic.rt.com', officialPageUrl: 'https://arabic.rt.com/live/', embedUrl: 'https://rt-arb.rttv.com/dvr/rtarab/playlist.m3u8', externalWatchUrl: 'https://arabic.rt.com/live/', embedSupported: true, sortOrder: 20, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'palestine-today-live', name: 'Palestine Today', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'paltodaytv.com', officialPageUrl: 'https://www.paltodaytv.com/live', embedUrl: 'https://live.paltodaytv.com/paltv/live/playlist_sfm4s.m3u8', externalWatchUrl: 'https://www.paltodaytv.com/live', embedSupported: true, sortOrder: 30, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'asharq-documentary-live', name: 'Asharq Discovery', category: 'documentary', language: 'ar', provider: 'hls', sourceDomain: 'asharqdiscovery.com', officialPageUrl: 'https://asharqdiscovery.com/watch-live', embedUrl: 'https://clvod.itworkscdn.net/bloombergvod/smil:itwfcdn/bloomberg/1750749-E8Pdm651272qY28.smil/playlist.m3u8', externalWatchUrl: 'https://asharqdiscovery.com/watch-live', embedSupported: true, sortOrder: 40, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'al-jazeera-live', name: 'Al Jazeera', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'aljazeera.net', officialPageUrl: 'https://www.aljazeera.net/live', embedUrl: null, externalWatchUrl: 'https://www.aljazeera.net/live', embedSupported: true, sortOrder: 50, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'frame_blocked_verified' },
  { id: 'al-jazeera-mubasher', name: 'Al Jazeera Mubasher', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'mubasher.aljazeera.net', officialPageUrl: 'https://mubasher.aljazeera.net/live', embedUrl: null, externalWatchUrl: 'https://mubasher.aljazeera.net/live', embedSupported: true, sortOrder: 60, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_source_invalid_external_only' },
  { id: 'sky-news-arabia-live', name: 'Sky News Arabia', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'skynewsarabia.com', officialPageUrl: 'https://www.skynewsarabia.com/live', embedUrl: null, externalWatchUrl: 'https://www.skynewsarabia.com/live', embedSupported: true, sortOrder: 70, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'bbc-arabic-live', name: 'BBC News Arabic', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'bbc.com', officialPageUrl: 'https://www.bbc.com/arabic', embedUrl: null, externalWatchUrl: 'https://www.bbc.com/arabic', embedSupported: true, sortOrder: 80, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'frame_blocked_verified' },
  { id: 'dw-ar-live', name: 'DW Arabic', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'dw.com', officialPageUrl: 'https://www.dw.com/ar/', embedUrl: null, externalWatchUrl: 'https://www.dw.com/ar/', embedSupported: true, sortOrder: 90, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'frame_blocked_verified' },
  { id: 'trt-arabi-live', name: 'TRT Arabi', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'trtarabi.com', officialPageUrl: 'https://www.trtarabi.com/live', embedUrl: null, externalWatchUrl: 'https://www.trtarabi.com/live', embedSupported: true, sortOrder: 100, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'alhurra-live', name: 'Alhurra', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'alhurra.com', officialPageUrl: 'https://www.alhurra.com/', embedUrl: null, externalWatchUrl: 'https://www.alhurra.com/', embedSupported: true, sortOrder: 110, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'cgtn-ar-live', name: 'CGTN Arabic', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'arabic.cgtn.com', officialPageUrl: 'https://arabic.cgtn.com/live', embedUrl: null, externalWatchUrl: 'https://arabic.cgtn.com/live', embedSupported: true, sortOrder: 120, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'saudi-ekhbariya-live', name: 'Saudi Al Ekhbariya', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'alekhbariya.net', officialPageUrl: 'https://alekhbariya.net/', embedUrl: null, externalWatchUrl: 'https://alekhbariya.net/', embedSupported: true, sortOrder: 130, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'frame_blocked_verified' },
  { id: 'al-mamlaka-live', name: 'Al Mamlaka', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'almamlakatv.com', officialPageUrl: 'https://www.almamlakatv.com/', embedUrl: null, externalWatchUrl: 'https://www.almamlakatv.com/', embedSupported: true, sortOrder: 140, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'frame_blocked_verified' },
  { id: 'extra-news-live', name: 'Extra News', category: 'news', language: 'ar', provider: 'youtube_channel', sourceDomain: 'youtube.com', officialPageUrl: 'https://www.youtube.com/@eXtranews/live', embedUrl: null, externalWatchUrl: 'https://www.youtube.com/@eXtranews/live', embedSupported: true, sortOrder: 150, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'frame_blocked_verified' },
  { id: 'alaraby-tv-live', name: 'Alaraby TV', category: 'analysis', language: 'ar', provider: 'native_web', sourceDomain: 'alaraby.com', officialPageUrl: 'https://www.alaraby.com/live', embedUrl: null, externalWatchUrl: 'https://www.alaraby.com/live', embedSupported: true, sortOrder: 160, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'frame_blocked_verified' },
  { id: 'al-manar-live', name: 'Al Manar', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'almanar.com.lb', officialPageUrl: 'https://www.almanar.com.lb/live', embedUrl: null, externalWatchUrl: 'https://www.almanar.com.lb/live', embedSupported: true, sortOrder: 170, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'alalam-live', name: 'Al Alam', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'alalam.ir', officialPageUrl: 'https://www.alalam.ir/live', embedUrl: null, externalWatchUrl: 'https://www.alalam.ir/live', embedSupported: true, sortOrder: 180, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'frame_blocked_verified' },
  { id: 'almashhad-live', name: 'Al Mashhad', category: 'analysis', language: 'ar', provider: 'native_web', sourceDomain: 'almashhad.com', officialPageUrl: 'https://almashhad.com/live', embedUrl: null, externalWatchUrl: 'https://almashhad.com/live', embedSupported: true, sortOrder: 190, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'cnbc-arabia-live', name: 'CNBC Arabia', category: 'economy', language: 'ar', provider: 'native_web', sourceDomain: 'cnbcarabia.com', officialPageUrl: 'https://www.cnbcarabia.com/page/television', embedUrl: null, externalWatchUrl: 'https://www.cnbcarabia.com/page/television', embedSupported: true, sortOrder: 200, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'palestine-tv-live', name: 'Palestine TV', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'pbc.ps', officialPageUrl: 'https://www.pbc.ps/live', embedUrl: null, externalWatchUrl: 'https://www.pbc.ps/live', embedSupported: true, sortOrder: 210, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'yemen-tv-live', name: 'Yemen TV', category: 'general', language: 'ar', provider: 'native_web', sourceDomain: 'yementv.tv', officialPageUrl: 'https://yementv.tv/live', embedUrl: null, externalWatchUrl: 'https://yementv.tv/live', embedSupported: true, sortOrder: 220, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'alsumaria-live', name: 'Alsumaria', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'alsumaria.tv', officialPageUrl: 'https://www.alsumaria.tv/live', embedUrl: null, externalWatchUrl: 'https://www.alsumaria.tv/live', embedSupported: true, sortOrder: 230, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'tokenized_embed_external_only' },
  { id: 'roya-news-live', name: 'Roya News', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'royanews.tv', officialPageUrl: 'https://royanews.tv/', embedUrl: null, externalWatchUrl: 'https://royanews.tv/', embedSupported: true, sortOrder: 240, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'abu-dhabi-tv-live', name: 'Abu Dhabi TV', category: 'general', language: 'ar', provider: 'native_web', sourceDomain: 'adtv.ae', officialPageUrl: 'https://www.adtv.ae/live', embedUrl: null, externalWatchUrl: 'https://www.adtv.ae/live', embedSupported: true, sortOrder: 250, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'frame_blocked_verified' },
  { id: 'al-emarat-live', name: 'Al Emarat', category: 'general', language: 'ar', provider: 'native_web', sourceDomain: 'adtv.ae', officialPageUrl: 'https://www.adtv.ae/live/alemarat', embedUrl: null, externalWatchUrl: 'https://www.adtv.ae/live/alemarat', embedSupported: true, sortOrder: 260, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'frame_blocked_verified' },
  { id: 'dubai-tv-live', name: 'Dubai TV', category: 'general', language: 'ar', provider: 'native_web', sourceDomain: 'awaan.ae', officialPageUrl: 'https://www.awaan.ae/live/dubai-tv', embedUrl: null, externalWatchUrl: 'https://www.awaan.ae/live/dubai-tv', embedSupported: true, sortOrder: 270, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'sama-dubai-live', name: 'Sama Dubai', category: 'general', language: 'ar', provider: 'native_web', sourceDomain: 'awaan.ae', officialPageUrl: 'https://www.awaan.ae/live/sama-dubai', embedUrl: null, externalWatchUrl: 'https://www.awaan.ae/live/sama-dubai', embedSupported: true, sortOrder: 280, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'noor-dubai-live', name: 'Noor Dubai', category: 'general', language: 'ar', provider: 'native_web', sourceDomain: 'awaan.ae', officialPageUrl: 'https://www.awaan.ae/live/noor-dubai', embedUrl: null, externalWatchUrl: 'https://www.awaan.ae/live/noor-dubai', embedSupported: true, sortOrder: 290, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'dubai-zaman-live', name: 'Dubai Zaman', category: 'general', language: 'ar', provider: 'native_web', sourceDomain: 'awaan.ae', officialPageUrl: 'https://www.awaan.ae/live/dubai-zaman', embedUrl: null, externalWatchUrl: 'https://www.awaan.ae/live/dubai-zaman', embedSupported: true, sortOrder: 300, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'baynounah-live', name: 'Baynounah TV', category: 'general', language: 'ar', provider: 'native_web', sourceDomain: 'adtv.ae', officialPageUrl: 'https://www.adtv.ae/live/baynounah', embedUrl: null, externalWatchUrl: 'https://www.adtv.ae/live/baynounah', embedSupported: true, sortOrder: 310, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'frame_blocked_verified' },
  { id: 'bein-sports-news-live', name: 'beIN SPORTS News', category: 'sports', language: 'ar', provider: 'native_web', sourceDomain: 'beinsports.com', officialPageUrl: 'https://www.beinsports.com/ar/', embedUrl: null, externalWatchUrl: 'https://www.beinsports.com/ar/', embedSupported: true, sortOrder: 320, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'ssc-sa-live', name: 'SSC Sports', category: 'sports', language: 'ar', provider: 'native_web', sourceDomain: 'ssc.sa', officialPageUrl: 'https://www.ssc.sa/', embedUrl: null, externalWatchUrl: 'https://www.ssc.sa/', embedSupported: true, sortOrder: 330, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'ad-sports-live', name: 'Abu Dhabi Sports', category: 'sports', language: 'ar', provider: 'native_web', sourceDomain: 'adsports.ae', officialPageUrl: 'https://adsports.ae/live', embedUrl: null, externalWatchUrl: 'https://adsports.ae/live', embedSupported: true, sortOrder: 340, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'alkass-live', name: 'Alkass Sports', category: 'sports', language: 'ar', provider: 'native_web', sourceDomain: 'alkass.net', officialPageUrl: 'https://www.alkass.net/alkass/live.aspx', embedUrl: null, externalWatchUrl: 'https://www.alkass.net/alkass/live.aspx', embedSupported: true, sortOrder: 350, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'on-time-sports-live', name: 'ON Time Sports', category: 'sports', language: 'ar', provider: 'native_web', sourceDomain: 'ontime-sports.com', officialPageUrl: 'https://www.ontime-sports.com/', embedUrl: null, externalWatchUrl: 'https://www.ontime-sports.com/', embedSupported: true, sortOrder: 360, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'mbc-action-live', name: 'MBC Action', category: 'entertainment', language: 'ar', provider: 'native_web', sourceDomain: 'shahid.mbc.net', officialPageUrl: 'https://shahid.mbc.net/ar/channels', embedUrl: null, externalWatchUrl: 'https://shahid.mbc.net/ar/channels', embedSupported: true, sortOrder: 370, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'mbc-masr-live', name: 'MBC MASR', category: 'entertainment', language: 'ar', provider: 'native_web', sourceDomain: 'shahid.mbc.net', officialPageUrl: 'https://shahid.mbc.net/ar/channels', embedUrl: null, externalWatchUrl: 'https://shahid.mbc.net/ar/channels', embedSupported: true, sortOrder: 380, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'dubai-one-live', name: 'Dubai One', category: 'entertainment', language: 'en', provider: 'native_web', sourceDomain: 'awaan.ae', officialPageUrl: 'https://www.awaan.ae/live/dubai-one', embedUrl: null, externalWatchUrl: 'https://www.awaan.ae/live/dubai-one', embedSupported: true, sortOrder: 390, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'rotana-khalijia-live', name: 'Rotana Khalijia', category: 'entertainment', language: 'ar', provider: 'native_web', sourceDomain: 'rotana.net', officialPageUrl: 'https://rotana.net/live/', embedUrl: null, externalWatchUrl: 'https://rotana.net/live/', embedSupported: true, sortOrder: 400, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'mtv-lebanon-live', name: 'MTV Lebanon', category: 'entertainment', language: 'ar', provider: 'native_web', sourceDomain: 'mtv.com.lb', officialPageUrl: 'https://www.mtv.com.lb/Live', embedUrl: null, externalWatchUrl: 'https://www.mtv.com.lb/Live', embedSupported: true, sortOrder: 410, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'france24-ar-live', name: 'France 24 Arabic', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'france24.com', officialPageUrl: 'https://www.france24.com/ar/', embedUrl: null, externalWatchUrl: 'https://www.france24.com/ar/', embedSupported: true, sortOrder: 420, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'cnn-live', name: 'CNN', category: 'news', language: 'en', provider: 'native_web', sourceDomain: 'cnn.com', officialPageUrl: 'https://www.cnn.com/', embedUrl: null, externalWatchUrl: 'https://www.cnn.com/', embedSupported: true, sortOrder: 430, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'fox-news-live', name: 'Fox News', category: 'news', language: 'en', provider: 'native_web', sourceDomain: 'foxnews.com', officialPageUrl: 'https://www.foxnews.com/live', embedUrl: null, externalWatchUrl: 'https://www.foxnews.com/live', embedSupported: true, sortOrder: 440, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'bloomberg-tv-live', name: 'Bloomberg TV', category: 'economy', language: 'en', provider: 'native_web', sourceDomain: 'bloomberg.com', officialPageUrl: 'https://www.bloomberg.com/live', embedUrl: null, externalWatchUrl: 'https://www.bloomberg.com/live', embedSupported: true, sortOrder: 450, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'cnbc-live', name: 'CNBC', category: 'economy', language: 'en', provider: 'native_web', sourceDomain: 'cnbc.com', officialPageUrl: 'https://www.cnbc.com/live-tv/', embedUrl: null, externalWatchUrl: 'https://www.cnbc.com/live-tv/', embedSupported: true, sortOrder: 460, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'al-arabiya-live', name: 'Al Arabiya', category: 'news', language: 'ar', provider: 'native_web', sourceDomain: 'alarabiya.net', officialPageUrl: 'https://www.alarabiya.net/', embedUrl: null, externalWatchUrl: 'https://www.alarabiya.net/', embedSupported: true, sortOrder: 470, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'nat-geo-abu-dhabi-live', name: 'Nat Geo Abu Dhabi', category: 'documentary', language: 'ar', provider: 'native_web', sourceDomain: 'abudhabitv.ae', officialPageUrl: 'https://www.adtv.ae/live/nat-geo', embedUrl: null, externalWatchUrl: 'https://www.adtv.ae/live/nat-geo', embedSupported: true, sortOrder: 480, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'discovery-ar-live', name: 'Discovery Arabic', category: 'documentary', language: 'ar', provider: 'native_web', sourceDomain: 'discovery.com', officialPageUrl: 'https://www.discovery.com/', embedUrl: null, externalWatchUrl: 'https://www.discovery.com/', embedSupported: true, sortOrder: 490, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
  { id: 'cartoon-network-ar-live', name: 'Cartoon Network Arabic', category: 'entertainment', language: 'ar', provider: 'native_web', sourceDomain: 'cartoonnetworkmena.com', officialPageUrl: 'https://www.cartoonnetworkmena.com/', embedUrl: null, externalWatchUrl: 'https://www.cartoonnetworkmena.com/', embedSupported: true, sortOrder: 500, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'page_open_verified' },
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
          registry_id, name, language, provider, source_domain, official_page_url, embed_url, external_watch_url, embed_supported, playback_mode, status, sort_order, verification_checked_at, last_verification_status, last_verification_error
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
            verification_checked_at = EXCLUDED.verification_checked_at,
            last_verification_status = EXCLUDED.last_verification_status,
            last_verification_error = EXCLUDED.last_verification_error,
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
          Boolean(channel.embedSupported),
          channel.embedSupported ? 'playable' : 'external_only',
          channel.active ? 'active' : 'inactive',
          channel.sortOrder,
          channel.lastVerifiedAt || null,
          channel.verificationStatus || null,
          null,
        ],
      );
    }

    await client.query(
      `UPDATE stream_channels
       SET status = 'inactive',
           embed_supported = FALSE,
           playback_mode = 'external_only',
           last_verification_status = 'removed_from_registry',
           last_verification_error = 'stream_registry_removed',
           updated_at = NOW()
       WHERE registry_id <> ALL($1::text[])
         AND status = 'active'`,
      [OFFICIAL_STREAM_REGISTRY.map((channel) => channel.id)],
    );

    return { totalChannelsConfigured: OFFICIAL_STREAM_REGISTRY.length };
  });
}

function detectUnavailableEmbed(contentType, body) {
  const normalizedType = String(contentType || '').toLowerCase();
  const normalizedBody = String(body || '').toLowerCase();

  if (normalizedType.includes('mpegurl')) {
    return !normalizedBody.includes('#extm3u');
  }

  return [
    'video unavailable',
    'this video is unavailable',
    'file not found.',
    'player-error-div',
    'video player configuration error',
    'error 153',
    'unplayable',
    'playabilitystatus":{"status":"error"',
    'playabilitystatus":{"status":"unplayable"',
    'live stream offline',
  ].some((marker) => normalizedBody.includes(marker));
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
    return { id: channel.registry_id, embedSupported: true, verificationStatus: 'removed_unavailable', removed: true };
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
        return { id: channel.registry_id, embedSupported: true, verificationStatus: 'removed_unavailable', removed: true };
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
      return { id: channel.registry_id, embedSupported: true, verificationStatus: 'removed_unavailable', removed: true };
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
    return { id: channel.registry_id, embedSupported: true, verificationStatus: 'external_only' };
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
    const contentType = response.headers.get('content-type');
    const body = await response.text();
    const blocked = detectBlockedEmbedding(response.headers);
    const unavailable = [404, 410, 451].includes(Number(response.status || 0));
    const brokenEmbed = detectUnavailableEmbed(contentType, body);

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
        embedSupported: true,
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
        embedSupported: true,
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
        !blocked && !brokenEmbed && response.ok,
        !blocked && !brokenEmbed && response.ok ? 'playable' : 'external_only',
        !blocked && !brokenEmbed && response.ok ? 'embed_ok' : 'embed_blocked',
      ],
    );
    return {
      id: channel.registry_id,
      embedSupported: !blocked && !brokenEmbed && response.ok,
      verificationStatus: !blocked && !brokenEmbed && response.ok ? 'embed_ok' : 'embed_blocked',
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
      embedSupported: true,
      verificationStatus: 'verification_failed',
      errorMessage: error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyStreamRegistry({ force = false } = {}) {
  const result = await query(
    `SELECT id, registry_id, embed_url, external_watch_url, official_page_url, verification_checked_at
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