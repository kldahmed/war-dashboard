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
  { id: 'al-jazeera-ar-live', name: 'Al Jazeera Arabic', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'aljazeera.net', officialPageUrl: 'https://www.aljazeera.net/live', embedUrl: 'https://live-hls-web-aja.getaj.net/AJA/index.m3u8', externalWatchUrl: 'https://www.aljazeera.net/live', embedSupported: true, sortOrder: 10, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'al-jazeera-mubasher', name: 'Al Jazeera Mubasher', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'mubasher.aljazeera.net', officialPageUrl: 'https://mubasher.aljazeera.net/live', embedUrl: 'https://live-hls-web-ajm.getaj.net/AJM/index.m3u8', externalWatchUrl: 'https://mubasher.aljazeera.net/live', embedSupported: true, sortOrder: 20, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'al-hadath-live', name: 'Al Hadath', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'alhadath.alarabiya.net', officialPageUrl: 'https://alhadath.alarabiya.net/', embedUrl: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-hadath/2ff87ec4c2f3ede35295a20637d9f8fd/index.m3u8', externalWatchUrl: 'https://alhadath.alarabiya.net/', embedSupported: true, sortOrder: 40, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'sky-news-arabia-live', name: 'Sky News Arabia', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'skynewsarabia.com', officialPageUrl: 'https://www.skynewsarabia.com/live', embedUrl: 'https://live-stream.skynewsarabia.com/c-horizontal-channel/horizontal-stream/index.m3u8', externalWatchUrl: 'https://www.skynewsarabia.com/live', embedSupported: true, sortOrder: 50, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'saudi-ekhbariya-live', name: 'Saudi Al Ekhbariya', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'alekhbariya.net', officialPageUrl: 'https://alekhbariya.net/', embedUrl: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-al-ekhbaria/297b3ef1cd0633ad9cfba7473a686a06/index.m3u8', externalWatchUrl: 'https://alekhbariya.net/', embedSupported: true, sortOrder: 60, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'al-mayadeen-live', name: 'Al Mayadeen', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'almayadeen.net', officialPageUrl: 'https://www.almayadeen.net/live', embedUrl: 'https://mdnlv.cdn.octivid.com/almdn/smil:mpegts.stream.smil/playlist.m3u8', externalWatchUrl: 'https://www.almayadeen.net/live', embedSupported: true, sortOrder: 70, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'alaraby-tv-live', name: 'Alaraby TV', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'alaraby.com', officialPageUrl: 'https://www.alaraby.com/live', embedUrl: 'https://live.kwikmotion.com/alaraby1live/alaraby_abr/playlist.m3u8', externalWatchUrl: 'https://www.alaraby.com/live', embedSupported: true, sortOrder: 80, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'asharq-news-live', name: 'Asharq News', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'asharq.com', officialPageUrl: 'https://asharq.com/live', embedUrl: 'https://live-news.asharq.com/asharq.m3u8', externalWatchUrl: 'https://asharq.com/live', embedSupported: true, sortOrder: 90, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'al-manar-live', name: 'Al Manar', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'almanar.com.lb', officialPageUrl: 'https://www.almanar.com.lb/live', embedUrl: 'https://edge.fastpublish.me/live/index.m3u8', externalWatchUrl: 'https://www.almanar.com.lb/live', embedSupported: true, sortOrder: 100, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'palestine-today-live', name: 'Palestine Today', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'paltodaytv.com', officialPageUrl: 'https://www.paltodaytv.com/live', embedUrl: 'https://live.paltodaytv.com/paltv/live/playlist_sfm4s.m3u8', externalWatchUrl: 'https://www.paltodaytv.com/live', embedSupported: true, sortOrder: 110, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'rt-ar-live', name: 'RT Arabic', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'arabic.rt.com', officialPageUrl: 'https://arabic.rt.com/live/', embedUrl: 'https://rt-arb.rttv.com/dvr/rtarab/playlist.m3u8', externalWatchUrl: 'https://arabic.rt.com/live/', embedSupported: true, sortOrder: 120, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'al-sharqiya-live', name: 'Al Sharqiya Iraq', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'alsharqiya.com', officialPageUrl: 'https://www.alsharqiya.com/live', embedUrl: 'https://5d94523502c2d.streamlock.net/home/mystream/playlist.m3u8', externalWatchUrl: 'https://www.alsharqiya.com/live', embedSupported: true, sortOrder: 130, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'al-sharqiya-news-live', name: 'Al Sharqiya News', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'alsharqiya.com', officialPageUrl: 'https://www.alsharqiya.com/live', embedUrl: 'https://5d94523502c2d.streamlock.net/alsharqiyalive/mystream/playlist.m3u8', externalWatchUrl: 'https://www.alsharqiya.com/live', embedSupported: true, sortOrder: 140, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'qatar-tv-live', name: 'Qatar TV', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'qatartv.qa', officialPageUrl: 'https://www.qatartv.qa/live', embedUrl: 'https://qatartv.akamaized.net/hls/live/2026573/qtv1/master.m3u8', externalWatchUrl: 'https://www.qatartv.qa/live', embedSupported: true, sortOrder: 150, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'france24-ar-live', name: 'France 24 Arabic', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'france24.com', officialPageUrl: 'https://www.france24.com/ar/', embedUrl: 'https://live.france24.com/hls/live/2037222-b/F24_AR_HI_HLS/master_5000.m3u8', externalWatchUrl: 'https://www.france24.com/ar/', embedSupported: true, sortOrder: 160, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'dw-ar-live', name: 'DW Arabic', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'dw.com', officialPageUrl: 'https://www.dw.com/ar/', embedUrl: 'https://dwamdstream103.akamaized.net/hls/live/2015526/dwstream103/master.m3u8', externalWatchUrl: 'https://www.dw.com/ar/', embedSupported: true, sortOrder: 170, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'trt-arabi-live', name: 'TRT Arabi', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'trtarabi.com', officialPageUrl: 'https://www.trtarabi.com/live', embedUrl: 'https://tv-trtarabi.medya.trt.com.tr/master.m3u8', externalWatchUrl: 'https://www.trtarabi.com/live', embedSupported: true, sortOrder: 180, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'kurdistan24-live', name: 'Kurdistan 24', category: 'news', language: 'ar', provider: 'hls', sourceDomain: 'kurdistan24.net', officialPageUrl: 'https://www.kurdistan24.net/ar', embedUrl: 'https://d1x82nydcxndze.cloudfront.net/live/index.m3u8', externalWatchUrl: 'https://www.kurdistan24.net/ar', embedSupported: true, sortOrder: 210, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'alkass-one-live', name: 'Alkass One', category: 'sports', language: 'ar', provider: 'hls', sourceDomain: 'alkass.net', officialPageUrl: 'https://www.alkass.net/alkass/live.aspx', embedUrl: 'https://liveeu-gcp.alkassdigital.net/alkass1-p/main.m3u8', externalWatchUrl: 'https://www.alkass.net/alkass/live.aspx', embedSupported: true, sortOrder: 220, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'alkass-two-live', name: 'Alkass Two', category: 'sports', language: 'ar', provider: 'hls', sourceDomain: 'alkass.net', officialPageUrl: 'https://www.alkass.net/alkass/live.aspx', embedUrl: 'https://liveeu-gcp.alkassdigital.net/alkass2-p/main.m3u8', externalWatchUrl: 'https://www.alkass.net/alkass/live.aspx', embedSupported: true, sortOrder: 230, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'alkass-three-live', name: 'Alkass Three', category: 'sports', language: 'ar', provider: 'hls', sourceDomain: 'alkass.net', officialPageUrl: 'https://www.alkass.net/alkass/live.aspx', embedUrl: 'https://liveeu-gcp.alkassdigital.net/alkass3-p/main.m3u8', externalWatchUrl: 'https://www.alkass.net/alkass/live.aspx', embedSupported: true, sortOrder: 240, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'alkass-four-live', name: 'Alkass Four', category: 'sports', language: 'ar', provider: 'hls', sourceDomain: 'alkass.net', officialPageUrl: 'https://www.alkass.net/alkass/live.aspx', embedUrl: 'https://liveeu-gcp.alkassdigital.net/alkass4-p/main.m3u8', externalWatchUrl: 'https://www.alkass.net/alkass/live.aspx', embedSupported: true, sortOrder: 250, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'alkass-five-live', name: 'Alkass Five', category: 'sports', language: 'ar', provider: 'hls', sourceDomain: 'alkass.net', officialPageUrl: 'https://www.alkass.net/alkass/live.aspx', embedUrl: 'https://liveeu-gcp.alkassdigital.net/alkass5-p/main.m3u8', externalWatchUrl: 'https://www.alkass.net/alkass/live.aspx', embedSupported: true, sortOrder: 260, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'alkass-six-live', name: 'Alkass Six', category: 'sports', language: 'ar', provider: 'hls', sourceDomain: 'alkass.net', officialPageUrl: 'https://www.alkass.net/alkass/live.aspx', embedUrl: 'https://liveeu-gcp.alkassdigital.net/alkass6-p/main.m3u8', externalWatchUrl: 'https://www.alkass.net/alkass/live.aspx', embedSupported: true, sortOrder: 265, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'alkass-seven-live', name: 'Alkass Seven', category: 'sports', language: 'ar', provider: 'hls', sourceDomain: 'alkass.net', officialPageUrl: 'https://www.alkass.net/alkass/live.aspx', embedUrl: 'https://liveeu-gcp.alkassdigital.net/alkass7-p/main.m3u8', externalWatchUrl: 'https://www.alkass.net/alkass/live.aspx', embedSupported: true, sortOrder: 266, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'alkass-shoof-live', name: 'Alkass SHOOF', category: 'sports', language: 'ar', provider: 'hls', sourceDomain: 'alkass.net', officialPageUrl: 'https://www.alkass.net/alkass/live.aspx', embedUrl: 'https://liveeu-gcp.alkassdigital.net/shooflive/main.m3u8', externalWatchUrl: 'https://www.alkass.net/alkass/live.aspx', embedSupported: true, sortOrder: 270, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'mbc1-live', name: 'MBC 1', category: 'entertainment', language: 'ar', provider: 'hls', sourceDomain: 'mbc.net', officialPageUrl: 'https://www.mbc.net/ar/mbc1/live', embedUrl: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-1/15cf99af5de54063fdabfefe66adc075/index.m3u8', externalWatchUrl: 'https://www.mbc.net/ar/mbc1/live', embedSupported: true, sortOrder: 280, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'mbc4-live', name: 'MBC 4', category: 'entertainment', language: 'ar', provider: 'hls', sourceDomain: 'mbc.net', officialPageUrl: 'https://www.mbc.net/ar/mbc4/live', embedUrl: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-4/24f134f1cd63db9346439e96b86ca6ed/index.m3u8', externalWatchUrl: 'https://www.mbc.net/ar/mbc4/live', embedSupported: true, sortOrder: 290, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'mbc5-live', name: 'MBC 5', category: 'entertainment', language: 'ar', provider: 'hls', sourceDomain: 'mbc.net', officialPageUrl: 'https://www.mbc.net/ar/mbc5/live', embedUrl: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-5/ee6b000cee0629411b666ab26cb13e9b/index.m3u8', externalWatchUrl: 'https://www.mbc.net/ar/mbc5/live', embedSupported: true, sortOrder: 300, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'mbc-drama-live', name: 'MBC Drama', category: 'entertainment', language: 'ar', provider: 'hls', sourceDomain: 'mbc.net', officialPageUrl: 'https://www.mbc.net/ar/mbcdrama/live', embedUrl: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-drama/2c28a458e2f3253e678b07ac7d13fe71/index.m3u8', externalWatchUrl: 'https://www.mbc.net/ar/mbcdrama/live', embedSupported: true, sortOrder: 310, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'mbc-masr-live', name: 'MBC Masr', category: 'entertainment', language: 'ar', provider: 'hls', sourceDomain: 'mbc.net', officialPageUrl: 'https://www.mbc.net/ar/mbcmasr/live', embedUrl: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-masr/956eac069c78a35d47245db6cdbb1575/index.m3u8', externalWatchUrl: 'https://www.mbc.net/ar/mbcmasr/live', embedSupported: true, sortOrder: 320, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'mbc-masr2-live', name: 'MBC Masr 2', category: 'entertainment', language: 'ar', provider: 'hls', sourceDomain: 'mbc.net', officialPageUrl: 'https://www.mbc.net/ar/mbcmasr2/live', embedUrl: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-masr-2/754931856515075b0aabf0e583495c68/index.m3u8', externalWatchUrl: 'https://www.mbc.net/ar/mbcmasr2/live', embedSupported: true, sortOrder: 330, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'mbc-iraq-live', name: 'MBC Iraq', category: 'entertainment', language: 'ar', provider: 'hls', sourceDomain: 'mbc.net', officialPageUrl: 'https://www.mbc.net/ar/mbciraq/live', embedUrl: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-iraq/e38c44b1b43474e1c39cb5b90203691e/index.m3u8', externalWatchUrl: 'https://www.mbc.net/ar/mbciraq/live', embedSupported: true, sortOrder: 340, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'mtv-lebanon-live', name: 'MTV Lebanon', category: 'entertainment', language: 'ar', provider: 'hls', sourceDomain: 'mtv.com.lb', officialPageUrl: 'https://www.mtv.com.lb/Live', embedUrl: 'https://hms.pfs.gdn/v1/broadcast/mtv/playlist.m3u8', externalWatchUrl: 'https://www.mtv.com.lb/Live', embedSupported: true, sortOrder: 350, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'spacetoon-ar-live', name: 'Spacetoon Arabic', category: 'entertainment', language: 'ar', provider: 'hls', sourceDomain: 'spacetoon.com', officialPageUrl: 'https://www.spacetoon.com/', embedUrl: 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-spacetoon/d8382fb9ab4b2307058f12c7ea90db54/index.m3u8', externalWatchUrl: 'https://www.spacetoon.com/', embedSupported: true, sortOrder: 360, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'cnbc-arabia-live', name: 'CNBC Arabia', category: 'economy', language: 'ar', provider: 'hls', sourceDomain: 'cnbcarabia.com', officialPageUrl: 'https://www.cnbcarabia.com/page/television', embedUrl: 'https://cnbc-live.akamaized.net/cnbc/master.m3u8', externalWatchUrl: 'https://www.cnbcarabia.com/page/television', embedSupported: true, sortOrder: 370, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'asharq-documentary-live', name: 'Asharq Discovery', category: 'documentary', language: 'ar', provider: 'hls', sourceDomain: 'asharqdiscovery.com', officialPageUrl: 'https://asharqdiscovery.com/watch-live', embedUrl: 'https://svs.itworkscdn.net/asharqdiscoverylive/asharqd.smil/playlist_dvr.m3u8', externalWatchUrl: 'https://asharqdiscovery.com/watch-live', embedSupported: true, sortOrder: 380, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'embed_ok' },
  { id: 'ad-sports-live', name: 'Abu Dhabi Sports', category: 'sports', language: 'ar', provider: 'web', sourceDomain: 'adsports.ae', officialPageUrl: 'https://adsports.ae/live', embedUrl: null, externalWatchUrl: 'https://adsports.ae/live', embedSupported: false, sortOrder: 390, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'on-time-sports-live', name: 'ON Time Sports', category: 'sports', language: 'ar', provider: 'web', sourceDomain: 'ontime-sports.com', officialPageUrl: 'https://www.ontime-sports.com/', embedUrl: null, externalWatchUrl: 'https://www.ontime-sports.com/', embedSupported: false, sortOrder: 400, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'dubai-one-live', name: 'Dubai One', category: 'entertainment', language: 'ar', provider: 'web', sourceDomain: 'awaan.ae', officialPageUrl: 'https://www.awaan.ae/live/dubai-one', embedUrl: null, externalWatchUrl: 'https://www.awaan.ae/live/dubai-one', embedSupported: false, sortOrder: 410, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'al-mamlaka-live', name: 'Al Mamlaka', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'almamlakatv.com', officialPageUrl: 'https://www.almamlakatv.com/', embedUrl: null, externalWatchUrl: 'https://www.almamlakatv.com/', embedSupported: false, sortOrder: 420, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'alsumaria-live', name: 'Alsumaria', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'alsumaria.tv', officialPageUrl: 'https://www.alsumaria.tv/live', embedUrl: null, externalWatchUrl: 'https://www.alsumaria.tv/live', embedSupported: false, sortOrder: 430, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'roya-news-live', name: 'Roya News', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'royanews.tv', officialPageUrl: 'https://royanews.tv/', embedUrl: null, externalWatchUrl: 'https://royanews.tv/', embedSupported: false, sortOrder: 440, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'abu-dhabi-tv-live', name: 'Abu Dhabi TV', category: 'entertainment', language: 'ar', provider: 'web', sourceDomain: 'adtv.ae', officialPageUrl: 'https://www.adtv.ae/live', embedUrl: null, externalWatchUrl: 'https://www.adtv.ae/live', embedSupported: false, sortOrder: 450, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'alhurra-live', name: 'Alhurra', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'alhurra.com', officialPageUrl: 'https://www.alhurra.com/', embedUrl: null, externalWatchUrl: 'https://www.alhurra.com/', embedSupported: false, sortOrder: 460, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'extra-news-live', name: 'Extra News', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'youtube.com', officialPageUrl: 'https://www.youtube.com/@eXtranews/live', embedUrl: null, externalWatchUrl: 'https://www.youtube.com/@eXtranews/live', embedSupported: false, sortOrder: 470, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'baynounah-live', name: 'Baynounah TV', category: 'entertainment', language: 'ar', provider: 'web', sourceDomain: 'adtv.ae', officialPageUrl: 'https://www.adtv.ae/live/baynounah', embedUrl: null, externalWatchUrl: 'https://www.adtv.ae/live/baynounah', embedSupported: false, sortOrder: 480, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'bein-sports-news-live', name: 'beIN SPORTS News', category: 'sports', language: 'ar', provider: 'web', sourceDomain: 'beinsports.com', officialPageUrl: 'https://www.beinsports.com/ar/', embedUrl: null, externalWatchUrl: 'https://www.beinsports.com/ar/', embedSupported: false, sortOrder: 490, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'nat-geo-abu-dhabi-live', name: 'Nat Geo Abu Dhabi', category: 'documentary', language: 'ar', provider: 'web', sourceDomain: 'abudhabitv.ae', officialPageUrl: 'https://www.adtv.ae/live/nat-geo', embedUrl: null, externalWatchUrl: 'https://www.adtv.ae/live/nat-geo', embedSupported: false, sortOrder: 500, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'al-emarat-live', name: 'Al Emarat', category: 'entertainment', language: 'ar', provider: 'web', sourceDomain: 'adtv.ae', officialPageUrl: 'https://www.adtv.ae/live/alemarat', embedUrl: null, externalWatchUrl: 'https://www.adtv.ae/live/alemarat', embedSupported: false, sortOrder: 510, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'dubai-tv-live', name: 'Dubai TV', category: 'entertainment', language: 'ar', provider: 'web', sourceDomain: 'awaan.ae', officialPageUrl: 'https://www.awaan.ae/live/dubai-tv', embedUrl: null, externalWatchUrl: 'https://www.awaan.ae/live/dubai-tv', embedSupported: false, sortOrder: 520, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'sama-dubai-live', name: 'Sama Dubai', category: 'entertainment', language: 'ar', provider: 'web', sourceDomain: 'awaan.ae', officialPageUrl: 'https://www.awaan.ae/live/sama-dubai', embedUrl: null, externalWatchUrl: 'https://www.awaan.ae/live/sama-dubai', embedSupported: false, sortOrder: 530, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'noor-dubai-live', name: 'Noor Dubai', category: 'entertainment', language: 'ar', provider: 'web', sourceDomain: 'awaan.ae', officialPageUrl: 'https://www.awaan.ae/live/noor-dubai', embedUrl: null, externalWatchUrl: 'https://www.awaan.ae/live/noor-dubai', embedSupported: false, sortOrder: 540, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'dubai-zaman-live', name: 'Dubai Zaman', category: 'entertainment', language: 'ar', provider: 'web', sourceDomain: 'awaan.ae', officialPageUrl: 'https://www.awaan.ae/live/dubai-zaman', embedUrl: null, externalWatchUrl: 'https://www.awaan.ae/live/dubai-zaman', embedSupported: false, sortOrder: 550, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'cgtn-ar-live', name: 'CGTN Arabic', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'arabic.cgtn.com', officialPageUrl: 'https://arabic.cgtn.com/live', embedUrl: null, externalWatchUrl: 'https://arabic.cgtn.com/live', embedSupported: false, sortOrder: 560, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'almashhad-live', name: 'Al Mashhad', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'almashhad.com', officialPageUrl: 'https://almashhad.com/live', embedUrl: null, externalWatchUrl: 'https://almashhad.com/live', embedSupported: false, sortOrder: 570, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'palestine-tv-live', name: 'Palestine TV', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'pbc.ps', officialPageUrl: 'https://www.pbc.ps/live', embedUrl: null, externalWatchUrl: 'https://www.pbc.ps/live', embedSupported: false, sortOrder: 580, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'yemen-tv-live', name: 'Yemen TV', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'yementv.tv', officialPageUrl: 'https://yementv.tv/live', embedUrl: null, externalWatchUrl: 'https://yementv.tv/live', embedSupported: false, sortOrder: 590, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'euronews-ar-live', name: 'Euronews Arabic', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'euronews.com', officialPageUrl: 'https://arabic.euronews.com/live', embedUrl: null, externalWatchUrl: 'https://arabic.euronews.com/live', embedSupported: false, sortOrder: 600, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'fox-news-live', name: 'Fox News', category: 'news', language: 'en', provider: 'web', sourceDomain: 'foxnews.com', officialPageUrl: 'https://www.foxnews.com/live', embedUrl: null, externalWatchUrl: 'https://www.foxnews.com/live', embedSupported: false, sortOrder: 610, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'discovery-ar-live', name: 'Discovery Arabic', category: 'documentary', language: 'ar', provider: 'web', sourceDomain: 'discovery.com', officialPageUrl: 'https://www.discovery.com/', embedUrl: null, externalWatchUrl: 'https://www.discovery.com/', embedSupported: false, sortOrder: 620, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'al-jazeera-live', name: 'Al Jazeera', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'aljazeera.net', officialPageUrl: 'https://www.aljazeera.net/live', embedUrl: null, externalWatchUrl: 'https://www.aljazeera.net/live', embedSupported: false, sortOrder: 630, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'bbc-arabic-live', name: 'BBC News Arabic', category: 'news', language: 'ar', provider: 'web', sourceDomain: 'bbc.com', officialPageUrl: 'https://www.bbc.com/arabic', embedUrl: null, externalWatchUrl: 'https://www.bbc.com/arabic', embedSupported: false, sortOrder: 640, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'cnn-live', name: 'CNN', category: 'news', language: 'en', provider: 'web', sourceDomain: 'cnn.com', officialPageUrl: 'https://www.cnn.com/', embedUrl: null, externalWatchUrl: 'https://www.cnn.com/', embedSupported: false, sortOrder: 650, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'cnbc-live', name: 'CNBC', category: 'economy', language: 'en', provider: 'web', sourceDomain: 'cnbc.com', officialPageUrl: 'https://www.cnbc.com/live-tv/', embedUrl: null, externalWatchUrl: 'https://www.cnbc.com/live-tv/', embedSupported: false, sortOrder: 660, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'france24-en-live', name: 'France24 English', category: 'news', language: 'en', provider: 'web', sourceDomain: 'france24.com', officialPageUrl: 'https://www.france24.com/en/live', embedUrl: null, externalWatchUrl: 'https://www.france24.com/en/live', embedSupported: false, sortOrder: 670, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'dw-live', name: 'DW News', category: 'news', language: 'en', provider: 'web', sourceDomain: 'dw.com', officialPageUrl: 'https://www.dw.com/en/live-tv/s-100825', embedUrl: null, externalWatchUrl: 'https://www.dw.com/en/live-tv/s-100825', embedSupported: false, sortOrder: 680, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'nbc-news-now', name: 'NBC News NOW', category: 'news', language: 'en', provider: 'web', sourceDomain: 'nbcnews.com', officialPageUrl: 'https://www.nbcnews.com/now', embedUrl: null, externalWatchUrl: 'https://www.nbcnews.com/now', embedSupported: false, sortOrder: 690, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'abc-news-live', name: 'ABC News Live', category: 'news', language: 'en', provider: 'web', sourceDomain: 'abcnews.go.com', officialPageUrl: 'https://abcnews.go.com/Live', embedUrl: null, externalWatchUrl: 'https://abcnews.go.com/Live', embedSupported: false, sortOrder: 700, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'trt-world-live', name: 'TRT World', category: 'news', language: 'en', provider: 'web', sourceDomain: 'trtworld.com', officialPageUrl: 'https://www.trtworld.com/live', embedUrl: null, externalWatchUrl: 'https://www.trtworld.com/live', embedSupported: false, sortOrder: 710, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'al-jazeera-en-live', name: 'Al Jazeera English', category: 'news', language: 'en', provider: 'web', sourceDomain: 'aljazeera.com', officialPageUrl: 'https://www.aljazeera.com/live/', embedUrl: null, externalWatchUrl: 'https://www.aljazeera.com/live/', embedSupported: false, sortOrder: 720, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
  { id: 'sky-news-live', name: 'Sky News', category: 'news', language: 'en', provider: 'web', sourceDomain: 'news.sky.com', officialPageUrl: 'https://news.sky.com/watch-live', embedUrl: null, externalWatchUrl: 'https://news.sky.com/watch-live', embedSupported: false, sortOrder: 730, active: true, lastVerifiedAt: LAST_VERIFIED_AT, verificationStatus: 'external_only' },
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