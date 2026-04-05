'use strict';

const express = require('express');
const Parser = require('rss-parser');
const { asyncHandler } = require('../../lib/async-handler');

const router = express.Router();

const rssParser = new Parser({
  timeout: 12000,
  headers: {
    'User-Agent': 'WorldPulse-Dashboard/1.0 (Arabic News Aggregator)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
});

/* ─────────────────────────────────────────────────────────────────
   ALLOWED RSS FEEDS — only these may be proxied (prevents SSRF)
───────────────────────────────────────────────────────────────── */
const ALLOWED_RSS_URLS = new Set([
  'https://podcasts.files.bbci.co.uk/p00pgk7p.rss',
  'https://podcasts.files.bbci.co.uk/p02pc9qx.rss',
  'https://rss.dw.com/xml/podcast-arabic',
]);

/* ─────────────────────────────────────────────────────────────────
   PODCAST SOURCES CATALOGUE
───────────────────────────────────────────────────────────────── */
const PODCAST_SOURCES = [
  {
    id: 'bbc-arabic-daily',
    name: 'بي بي سي عربي — يومك',
    description: 'موجز أخبار صوتي يومي يشمل أبرز الأحداث العالمية والعربية',
    language: 'ar',
    category: 'news',
    rss: 'https://podcasts.files.bbci.co.uk/p00pgk7p.rss',
    type: 'rss',
    logo: null,
  },
  {
    id: 'bbc-arabic-press',
    name: 'نافذة على الصحافة — بي بي سي',
    description: 'قراءة تحليلية أسبوعية للصحافة العالمية والعربية',
    language: 'ar',
    category: 'analysis',
    rss: 'https://podcasts.files.bbci.co.uk/p02pc9qx.rss',
    type: 'rss',
    logo: null,
  },
  {
    id: 'dw-arabic',
    name: 'دويتشه فيله عربي',
    description: 'أخبار وتحليلات ووثائقيات صوتية من إذاعة ألمانيا الدولية',
    language: 'ar',
    category: 'news',
    rss: 'https://rss.dw.com/xml/podcast-arabic',
    type: 'rss',
    logo: null,
  },
  {
    id: 'abu-talal-external',
    name: 'أبو طلال الحمراني',
    description: 'محلل سياسي وعسكري — تحليلات في الشؤون الإقليمية والأمنية. المحتوى متاح عبر يوتيوب.',
    language: 'ar',
    category: 'analysis',
    rss: null,
    external_url: 'https://www.youtube.com/results?search_query=%D8%A3%D8%A8%D9%88+%D8%B7%D9%84%D8%A7%D9%84+%D8%A7%D9%84%D8%AD%D9%85%D8%B1%D8%A7%D9%86%D9%8A',
    type: 'external',
    logo: null,
  },
];

/* ─────────────────────────────────────────────────────────────────
   GET /api/podcasts/list
   Returns the curated podcast source list
───────────────────────────────────────────────────────────────── */
router.get('/podcasts/list', asyncHandler(async (_req, res) => {
  res.json({ sources: PODCAST_SOURCES });
}));

/* ─────────────────────────────────────────────────────────────────
   GET /api/podcasts/feed?url=<rss_url>
   Server-side RSS proxy — avoids browser CORS issues.
   Only fetches whitelisted URLs.
───────────────────────────────────────────────────────────────── */
router.get('/podcasts/feed', asyncHandler(async (req, res) => {
  const url = String(req.query.url || '').trim();

  if (!url) {
    return res.status(400).json({ error: 'missing_url', message: 'url query parameter is required' });
  }

  if (!ALLOWED_RSS_URLS.has(url)) {
    return res.status(403).json({ error: 'feed_not_allowed', message: 'This feed URL is not in the allowed list' });
  }

  const feed = await rssParser.parseURL(url);

  const episodes = (feed.items || []).slice(0, 40).map((item) => ({
    id: item.guid || item.link || `ep-${Date.now()}-${Math.random()}`,
    title: item.title || 'بدون عنوان',
    description: item.contentSnippet || item.content || item.summary || '',
    published_at: item.pubDate || item.isoDate || null,
    duration: item.itunes?.duration || null,
    audio_url: item.enclosure?.url || null,
    link: item.link || null,
    image: item.itunes?.image || feed.image?.url || null,
  }));

  res.json({
    feed_title: feed.title || '',
    feed_description: feed.description || '',
    image: feed.image?.url || null,
    episodes,
  });
}));

module.exports = router;
