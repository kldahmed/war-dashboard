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
  'https://podcasts.files.bbci.co.uk/p0h6d6nm.rss',
  'https://podcasts.files.bbci.co.uk/p02pc9qc.rss',
  'https://podcasts.files.bbci.co.uk/p086jpqy.rss',
  'https://feed.podbean.com/arabnews/feed.xml',
]);

/* ─────────────────────────────────────────────────────────────────
   PODCAST SOURCES CATALOGUE
───────────────────────────────────────────────────────────────── */
const PODCAST_SOURCES = [
  {
    id: 'bbc-noteworthy',
    name: 'يستحق الانتباه — بي بي سي',
    description: 'بودكاست عربي تحليلي من بي بي سي مع حلقات صوتية فعلية قابلة للتشغيل',
    language: 'ar',
    category: 'analysis',
    rss: 'https://podcasts.files.bbci.co.uk/p0h6d6nm.rss',
    type: 'rss',
    logo: null,
  },
  {
    id: 'bbc-extra',
    name: 'بي بي سي إكسترا',
    description: 'حلقات صوتية عربية متنوعة من شبكة بي بي سي العربية',
    language: 'ar',
    category: 'analysis',
    rss: 'https://podcasts.files.bbci.co.uk/p02pc9qc.rss',
    type: 'rss',
    logo: null,
  },
  {
    id: 'bbc-special-coverage',
    name: 'تغطية خاصة — بي بي سي',
    description: 'تغطيات خاصة وتقارير معمقة بحلقات صوتية عربية',
    language: 'ar',
    category: 'news',
    rss: 'https://podcasts.files.bbci.co.uk/p086jpqy.rss',
    type: 'rss',
    logo: null,
  },
  {
    id: 'arab-news',
    name: 'Arab News Podcast',
    description: 'بودكاست إخباري وتحليلي من Arab News مع ملفات صوتية فعلية',
    language: 'ar',
    category: 'news',
    rss: 'https://feed.podbean.com/arabnews/feed.xml',
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
