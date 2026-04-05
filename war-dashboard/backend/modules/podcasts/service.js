'use strict';

const Parser = require('rss-parser');

const rssParser = new Parser({
  timeout: 12000,
  headers: {
    'User-Agent': 'WorldPulse-Dashboard/1.0 (Arabic News Aggregator)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
});

const ALLOWED_RSS_URLS = new Set([
  'https://podcasts.files.bbci.co.uk/p0h6d6nm.rss',
  'https://podcasts.files.bbci.co.uk/p02pc9qc.rss',
  'https://podcasts.files.bbci.co.uk/p086jpqy.rss',
  'https://feed.podbean.com/arabnews/feed.xml',
  'https://media.podeo.co/rss/MTU2NzI',
]);

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
    description: 'سوالف طريق — حلقات صوتية قابلة للتشغيل مباشرة من داخل الموقع عبر RSS موثوق.',
    language: 'ar',
    category: 'analysis',
    rss: 'https://media.podeo.co/rss/MTU2NzI',
    external_url: 'https://media.podeo.co/rss/MTU2NzI',
    type: 'rss',
    logo: null,
  },
];

function listPodcastSources() {
  return PODCAST_SOURCES;
}

async function getPodcastFeed(url) {
  const normalizedUrl = String(url || '').trim();

  if (!normalizedUrl) {
    const error = new Error('url query parameter is required');
    error.statusCode = 400;
    error.code = 'missing_url';
    throw error;
  }

  if (!ALLOWED_RSS_URLS.has(normalizedUrl)) {
    const error = new Error('This feed URL is not in the allowed list');
    error.statusCode = 403;
    error.code = 'feed_not_allowed';
    throw error;
  }

  const feed = await rssParser.parseURL(normalizedUrl);
  const episodes = (feed.items || []).slice(0, 40).map((item, index) => ({
    id: item.guid || item.link || `${normalizedUrl}#${index}`,
    title: item.title || 'بدون عنوان',
    description: item.contentSnippet || item.content || item.summary || '',
    published_at: item.pubDate || item.isoDate || null,
    duration: item.itunes?.duration || null,
    audio_url: item.enclosure?.url || null,
    link: item.link || null,
    image: item.itunes?.image || feed.image?.url || null,
  }));

  return {
    feed_title: feed.title || '',
    feed_description: feed.description || '',
    image: feed.image?.url || null,
    episodes,
  };
}

module.exports = {
  listPodcastSources,
  getPodcastFeed,
  PODCAST_SOURCES,
  ALLOWED_RSS_URLS,
};