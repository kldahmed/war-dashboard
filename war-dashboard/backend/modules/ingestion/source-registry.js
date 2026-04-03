'use strict';

const { URL } = require('node:url');
const { withTransaction } = require('../../lib/db');

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

function domainFromUrl(value) {
  const parsed = safeHttpUrl(value);
  if (!parsed) return null;
  return new URL(parsed).hostname.replace(/^www\./i, '').toLowerCase();
}

function buildSource(source) {
  const endpoint = safeHttpUrl(source.url);
  const homepageUrl = safeHttpUrl(source.homepageUrl || source.url);
  const domain = domainFromUrl(homepageUrl || endpoint);
  if (!endpoint || !homepageUrl || !domain) return null;

  return {
    id: source.id,
    name: source.name,
    language: source.language,
    transportType: source.transportType || 'rss',
    url: endpoint,
    homepageUrl,
    active: Boolean(source.active),
    trustScoreBaseline: Number(source.trustScoreBaseline || 65),
    region: source.region || 'global',
    category: source.category || 'general',
    sourceGroup: source.sourceGroup || 'specialist',
    officialFlag: source.officialFlag !== false,
    domain,
  };
}

const RAW_NEWS_SOURCE_REGISTRY = [
  { id: 'al-jazeera-ar', name: 'Al Jazeera', language: 'ar', url: 'https://www.aljazeera.net/aljazeerarss/ar.xml', homepageUrl: 'https://www.aljazeera.net', active: true, trustScoreBaseline: 78, region: 'mena', category: 'middle-east', sourceGroup: 'arabic', officialFlag: true },
  { id: 'al-arabiya', name: 'Al Arabiya', language: 'ar', url: 'https://www.alarabiya.net/tools/rss', homepageUrl: 'https://www.alarabiya.net', active: true, trustScoreBaseline: 76, region: 'gulf', category: 'middle-east', sourceGroup: 'arabic', officialFlag: true },
  { id: 'sky-news-arabia', name: 'Sky News Arabia', language: 'ar', url: 'https://www.skynewsarabia.com/web/rss', homepageUrl: 'https://www.skynewsarabia.com', active: true, trustScoreBaseline: 76, region: 'gulf', category: 'middle-east', sourceGroup: 'arabic', officialFlag: true },
  { id: 'bbc-arabic', name: 'BBC Arabic', language: 'ar', url: 'https://feeds.bbci.co.uk/arabic/rss.xml', homepageUrl: 'https://www.bbc.com/arabic', active: true, trustScoreBaseline: 84, region: 'global', category: 'world', sourceGroup: 'arabic', officialFlag: true },
  { id: 'france24-ar', name: 'France24 Arabic', language: 'ar', url: 'https://www.france24.com/ar/rss', homepageUrl: 'https://www.france24.com/ar/', active: true, trustScoreBaseline: 79, region: 'global', category: 'world', sourceGroup: 'arabic', officialFlag: true },
  { id: 'dw-ar', name: 'DW Arabic', language: 'ar', url: 'https://rss.dw.com/rdf/rss-ar-all', homepageUrl: 'https://www.dw.com/ar/', active: true, trustScoreBaseline: 79, region: 'global', category: 'world', sourceGroup: 'arabic', officialFlag: true },
  { id: 'rt-ar', name: 'RT Arabic', language: 'ar', url: 'https://arabic.rt.com/rss/', homepageUrl: 'https://arabic.rt.com/', active: true, trustScoreBaseline: 64, region: 'global', category: 'world', sourceGroup: 'arabic', officialFlag: true },
  { id: 'asharq-news', name: 'Asharq News', language: 'ar', url: 'https://asharq.com', homepageUrl: 'https://asharq.com', active: false, trustScoreBaseline: 72, region: 'gulf', category: 'middle-east', sourceGroup: 'arabic', officialFlag: true },
  { id: 'trt-arabic', name: 'TRT Arabic', language: 'ar', url: 'https://www.trtarabi.com', homepageUrl: 'https://www.trtarabi.com', active: false, trustScoreBaseline: 73, region: 'mena', category: 'middle-east', sourceGroup: 'arabic', officialFlag: true },
  { id: 'al-mayadeen', name: 'Al Mayadeen', language: 'ar', url: 'https://www.almayadeen.net', homepageUrl: 'https://www.almayadeen.net', active: false, trustScoreBaseline: 63, region: 'mena', category: 'middle-east', sourceGroup: 'arabic', officialFlag: true },
  { id: 'al-manar', name: 'Al Manar', language: 'ar', url: 'https://www.almanar.com.lb', homepageUrl: 'https://www.almanar.com.lb', active: false, trustScoreBaseline: 58, region: 'mena', category: 'middle-east', sourceGroup: 'arabic', officialFlag: true },
  { id: 'al-hadath', name: 'Al Hadath', language: 'ar', url: 'https://www.alhadath.net', homepageUrl: 'https://www.alhadath.net', active: false, trustScoreBaseline: 72, region: 'gulf', category: 'middle-east', sourceGroup: 'arabic', officialFlag: true },
  { id: 'cgtn-arabic', name: 'CGTN Arabic', language: 'ar', url: 'https://arabic.cgtn.com', homepageUrl: 'https://arabic.cgtn.com', active: false, trustScoreBaseline: 67, region: 'global', category: 'world', sourceGroup: 'arabic', officialFlag: true },
  { id: 'alalam', name: 'Alalam', language: 'ar', url: 'https://www.alalam.ir', homepageUrl: 'https://www.alalam.ir', active: false, trustScoreBaseline: 55, region: 'mena', category: 'middle-east', sourceGroup: 'arabic', officialFlag: true },
  { id: 'alhurra', name: 'Alhurra', language: 'ar', url: 'https://www.alhurra.com', homepageUrl: 'https://www.alhurra.com', active: false, trustScoreBaseline: 71, region: 'usa', category: 'middle-east', sourceGroup: 'arabic', officialFlag: true },
  { id: 'reuters-world', name: 'Reuters', language: 'en', url: 'https://www.reutersagency.com/feed/?best-topics=world&post_type=best', homepageUrl: 'https://www.reuters.com/world/', active: true, trustScoreBaseline: 82, region: 'global', category: 'world', sourceGroup: 'global', officialFlag: true },
  { id: 'reuters-middle-east', name: 'Reuters Middle East', language: 'en', url: 'https://www.reutersagency.com/feed/?best-topics=middle-east&post_type=best', homepageUrl: 'https://www.reuters.com/world/middle-east/', active: true, trustScoreBaseline: 82, region: 'mena', category: 'middle-east', sourceGroup: 'global', officialFlag: true },
  { id: 'reuters-business', name: 'Reuters Business', language: 'en', url: 'https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best', homepageUrl: 'https://www.reuters.com/business/', active: true, trustScoreBaseline: 82, region: 'global', category: 'economy', sourceGroup: 'global', officialFlag: true },
  { id: 'reuters-usa', name: 'Reuters United States', language: 'en', url: 'https://www.reutersagency.com/feed/?best-topics=united-states&post_type=best', homepageUrl: 'https://www.reuters.com/world/us/', active: true, trustScoreBaseline: 82, region: 'usa', category: 'politics', sourceGroup: 'global', officialFlag: true },
  { id: 'ap-top-news', name: 'Associated Press', language: 'en', url: 'https://apnews.com/hub/ap-top-news?output=rss', homepageUrl: 'https://apnews.com/', active: true, trustScoreBaseline: 84, region: 'global', category: 'world', sourceGroup: 'global', officialFlag: true },
  { id: 'ap-politics', name: 'AP Politics', language: 'en', url: 'https://apnews.com/hub/politics?output=rss', homepageUrl: 'https://apnews.com/hub/politics', active: true, trustScoreBaseline: 84, region: 'usa', category: 'politics', sourceGroup: 'global', officialFlag: true },
  { id: 'ap-business', name: 'AP Business', language: 'en', url: 'https://apnews.com/hub/business?output=rss', homepageUrl: 'https://apnews.com/hub/business', active: true, trustScoreBaseline: 84, region: 'global', category: 'economy', sourceGroup: 'global', officialFlag: true },
  { id: 'bloomberg', name: 'Bloomberg', language: 'en', url: 'https://www.bloomberg.com', homepageUrl: 'https://www.bloomberg.com', active: false, trustScoreBaseline: 81, region: 'global', category: 'economy', sourceGroup: 'global', officialFlag: true },
  { id: 'nyt-world', name: 'NYTimes', language: 'en', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', homepageUrl: 'https://www.nytimes.com/section/world', active: true, trustScoreBaseline: 79, region: 'global', category: 'world', sourceGroup: 'global', officialFlag: true },
  { id: 'guardian-world', name: 'Guardian', language: 'en', url: 'https://www.theguardian.com/world/rss', homepageUrl: 'https://www.theguardian.com/world', active: true, trustScoreBaseline: 77, region: 'global', category: 'world', sourceGroup: 'global', officialFlag: true },
  { id: 'politico', name: 'Politico', language: 'en', url: 'https://www.politico.com/rss/politicopicks.xml', homepageUrl: 'https://www.politico.com', active: true, trustScoreBaseline: 74, region: 'usa', category: 'politics', sourceGroup: 'global', officialFlag: true },
  { id: 'al-monitor', name: 'Al Monitor', language: 'en', url: 'https://www.al-monitor.com/rss', homepageUrl: 'https://www.al-monitor.com', active: true, trustScoreBaseline: 72, region: 'mena', category: 'middle-east', sourceGroup: 'global', officialFlag: true },
  { id: 'middle-east-eye', name: 'Middle East Eye', language: 'en', url: 'https://www.middleeasteye.net/rss', homepageUrl: 'https://www.middleeasteye.net', active: true, trustScoreBaseline: 68, region: 'mena', category: 'middle-east', sourceGroup: 'global', officialFlag: true },
  { id: 'financial-times', name: 'Financial Times', language: 'en', url: 'https://www.ft.com', homepageUrl: 'https://www.ft.com/world', active: false, trustScoreBaseline: 80, region: 'global', category: 'economy', sourceGroup: 'global', officialFlag: true },
  { id: 'washington-post-world', name: 'Washington Post', language: 'en', url: 'http://feeds.washingtonpost.com/rss/world', homepageUrl: 'https://www.washingtonpost.com/world/', active: true, trustScoreBaseline: 77, region: 'usa', category: 'world', sourceGroup: 'global', officialFlag: true },
  { id: 'economist-world', name: 'The Economist', language: 'en', url: 'https://www.economist.com', homepageUrl: 'https://www.economist.com', active: false, trustScoreBaseline: 80, region: 'global', category: 'analysis', sourceGroup: 'global', officialFlag: true },
  { id: 'cnn-world', name: 'CNN', language: 'en', url: 'http://rss.cnn.com/rss/edition_world.rss', homepageUrl: 'https://edition.cnn.com/world', active: true, trustScoreBaseline: 73, region: 'global', category: 'world', sourceGroup: 'global', officialFlag: true },
  { id: 'bbc-world', name: 'BBC World', language: 'en', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', homepageUrl: 'https://www.bbc.com/news/world', active: true, trustScoreBaseline: 84, region: 'global', category: 'world', sourceGroup: 'global', officialFlag: true },
  { id: 'bbc-business', name: 'BBC Business', language: 'en', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', homepageUrl: 'https://www.bbc.com/news/business', active: true, trustScoreBaseline: 84, region: 'global', category: 'economy', sourceGroup: 'global', officialFlag: true },
  { id: 'bbc-technology', name: 'BBC Technology', language: 'en', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', homepageUrl: 'https://www.bbc.com/news/technology', active: true, trustScoreBaseline: 84, region: 'global', category: 'technology', sourceGroup: 'global', officialFlag: true },
  { id: 'sky-news-world', name: 'Sky News', language: 'en', url: 'https://feeds.skynews.com/feeds/rss/world.xml', homepageUrl: 'https://news.sky.com/world', active: true, trustScoreBaseline: 74, region: 'global', category: 'world', sourceGroup: 'global', officialFlag: true },
  { id: 'france24-en', name: 'France24', language: 'en', url: 'https://www.france24.com/en/rss', homepageUrl: 'https://www.france24.com/en/', active: true, trustScoreBaseline: 79, region: 'global', category: 'world', sourceGroup: 'global', officialFlag: true },
  { id: 'defense-news', name: 'Defense News', language: 'en', url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml', homepageUrl: 'https://www.defensenews.com', active: true, trustScoreBaseline: 78, region: 'usa', category: 'war', sourceGroup: 'specialist', officialFlag: true },
  { id: 'war-zone', name: 'War Zone', language: 'en', url: 'https://www.twz.com', homepageUrl: 'https://www.twz.com', active: false, trustScoreBaseline: 71, region: 'usa', category: 'war', sourceGroup: 'specialist', officialFlag: true },
  { id: 'breaking-defense', name: 'Breaking Defense', language: 'en', url: 'https://breakingdefense.com/feed/', homepageUrl: 'https://breakingdefense.com', active: true, trustScoreBaseline: 77, region: 'usa', category: 'war', sourceGroup: 'specialist', officialFlag: true },
  { id: 'energy-intelligence', name: 'Energy Intelligence', language: 'en', url: 'https://www.energyintel.com', homepageUrl: 'https://www.energyintel.com', active: false, trustScoreBaseline: 76, region: 'global', category: 'energy', sourceGroup: 'specialist', officialFlag: true },
  { id: 'oilprice', name: 'OilPrice', language: 'en', url: 'https://oilprice.com/rss/main', homepageUrl: 'https://oilprice.com', active: true, trustScoreBaseline: 69, region: 'global', category: 'energy', sourceGroup: 'specialist', officialFlag: true },
  { id: 'al-jazeera-en', name: 'Al Jazeera English', language: 'en', url: 'https://www.aljazeera.com/xml/rss/all.xml', homepageUrl: 'https://www.aljazeera.com', active: true, trustScoreBaseline: 78, region: 'mena', category: 'middle-east', sourceGroup: 'specialist', officialFlag: true },
  { id: 'dw-en', name: 'DW English', language: 'en', url: 'https://rss.dw.com/rdf/rss-en-all', homepageUrl: 'https://www.dw.com/en/', active: true, trustScoreBaseline: 79, region: 'global', category: 'world', sourceGroup: 'specialist', officialFlag: true },
  { id: 'npr-world', name: 'NPR World', language: 'en', url: 'https://feeds.npr.org/1004/rss.xml', homepageUrl: 'https://www.npr.org/sections/world/', active: true, trustScoreBaseline: 80, region: 'usa', category: 'world', sourceGroup: 'specialist', officialFlag: true },
  { id: 'arab-news', name: 'Arab News', language: 'en', url: 'https://www.arabnews.com/rss.xml', homepageUrl: 'https://www.arabnews.com', active: true, trustScoreBaseline: 70, region: 'gulf', category: 'middle-east', sourceGroup: 'specialist', officialFlag: true },
  { id: 'us-state-gov', name: 'US Department of State', language: 'en', url: 'https://www.state.gov/feed/', homepageUrl: 'https://www.state.gov/', active: true, trustScoreBaseline: 88, region: 'usa', category: 'politics', sourceGroup: 'specialist', officialFlag: true },
  { id: 'us-defense-gov', name: 'US Department of Defense', language: 'en', url: 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?max=10&ContentType=1&Site=945&Category=1514', homepageUrl: 'https://www.defense.gov/', active: true, trustScoreBaseline: 87, region: 'usa', category: 'war', sourceGroup: 'specialist', officialFlag: true },
  { id: 'un-news-ar', name: 'UN News Arabic', language: 'ar', url: 'https://news.un.org/feed/subscribe/ar/news/all/rss.xml', homepageUrl: 'https://news.un.org/ar/', active: true, trustScoreBaseline: 88, region: 'global', category: 'world', sourceGroup: 'specialist', officialFlag: true },
  { id: 'un-news-en', name: 'UN News English', language: 'en', url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml', homepageUrl: 'https://news.un.org/en/', active: true, trustScoreBaseline: 88, region: 'global', category: 'world', sourceGroup: 'specialist', officialFlag: true },
  { id: 'un-news-middle-east', name: 'UN News Middle East', language: 'en', url: 'https://news.un.org/feed/subscribe/en/news/region/middle-east/feed/rss.xml', homepageUrl: 'https://news.un.org/en/news/region/middle-east', active: true, trustScoreBaseline: 88, region: 'mena', category: 'middle-east', sourceGroup: 'specialist', officialFlag: true },
  { id: 'isw', name: 'Institute for the Study of War', language: 'en', url: 'https://www.understandingwar.org/rss.xml', homepageUrl: 'https://www.understandingwar.org/', active: true, trustScoreBaseline: 73, region: 'global', category: 'analysis', sourceGroup: 'specialist', officialFlag: true },
  { id: 'crisis-group', name: 'International Crisis Group', language: 'en', url: 'https://www.crisisgroup.org/rss.xml', homepageUrl: 'https://www.crisisgroup.org/', active: true, trustScoreBaseline: 79, region: 'global', category: 'analysis', sourceGroup: 'specialist', officialFlag: true },
  { id: 'reliefweb', name: 'ReliefWeb', language: 'en', url: 'https://reliefweb.int/updates?format=rss', homepageUrl: 'https://reliefweb.int/', active: true, trustScoreBaseline: 82, region: 'global', category: 'world', sourceGroup: 'specialist', officialFlag: true },
  { id: 'ocha', name: 'UN OCHA', language: 'en', url: 'https://www.unocha.org/news.xml', homepageUrl: 'https://www.unocha.org/', active: true, trustScoreBaseline: 86, region: 'global', category: 'world', sourceGroup: 'specialist', officialFlag: true },
  { id: 'human-rights-watch', name: 'Human Rights Watch', language: 'en', url: 'https://www.hrw.org/rss/news', homepageUrl: 'https://www.hrw.org/', active: true, trustScoreBaseline: 72, region: 'global', category: 'analysis', sourceGroup: 'specialist', officialFlag: true },
  { id: 'sputnik-ar', name: 'Sputnik Arabic', language: 'ar', url: 'https://sputnikarabic.ae/export/rss2/archive/index.xml', homepageUrl: 'https://sputnikarabic.ae/', active: true, trustScoreBaseline: 61, region: 'global', category: 'world', sourceGroup: 'specialist', officialFlag: true },
  { id: 'bbc-middle-east', name: 'BBC Middle East', language: 'en', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', homepageUrl: 'https://www.bbc.com/news/world/middle_east', active: true, trustScoreBaseline: 84, region: 'mena', category: 'middle-east', sourceGroup: 'specialist', officialFlag: true },
  { id: 'guardian-middle-east', name: 'Guardian Middle East', language: 'en', url: 'https://www.theguardian.com/world/middleeast/rss', homepageUrl: 'https://www.theguardian.com/world/middleeast', active: true, trustScoreBaseline: 77, region: 'mena', category: 'middle-east', sourceGroup: 'specialist', officialFlag: true },
  { id: 'ap-world-news', name: 'AP World News', language: 'en', url: 'https://apnews.com/hub/world-news?output=rss', homepageUrl: 'https://apnews.com/hub/world-news', active: true, trustScoreBaseline: 84, region: 'global', category: 'world', sourceGroup: 'specialist', officialFlag: true },
];

const NEWS_SOURCE_REGISTRY = RAW_NEWS_SOURCE_REGISTRY.map(buildSource).filter(Boolean);

function getSourceRegistryStats() {
  return {
    totalSourcesConfigured: NEWS_SOURCE_REGISTRY.length,
    activeSourcesConfigured: NEWS_SOURCE_REGISTRY.filter((entry) => entry.active).length,
    arabicSources: NEWS_SOURCE_REGISTRY.filter((entry) => entry.sourceGroup === 'arabic').length,
    globalSources: NEWS_SOURCE_REGISTRY.filter((entry) => entry.sourceGroup === 'global').length,
    specialistSources: NEWS_SOURCE_REGISTRY.filter((entry) => entry.sourceGroup === 'specialist').length,
  };
}

async function syncSourceRegistry() {
  return withTransaction(async (client) => {
    for (const source of NEWS_SOURCE_REGISTRY) {
      const sourceResult = await client.query(
        `INSERT INTO sources (
          registry_id, name, domain, region, language, category, official_flag, trust_score, status, homepage_url, source_group
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (domain) DO UPDATE
        SET registry_id = EXCLUDED.registry_id,
            name = EXCLUDED.name,
            region = EXCLUDED.region,
            language = EXCLUDED.language,
            category = EXCLUDED.category,
            official_flag = EXCLUDED.official_flag,
            trust_score = EXCLUDED.trust_score,
            status = EXCLUDED.status,
            homepage_url = EXCLUDED.homepage_url,
            source_group = EXCLUDED.source_group,
            updated_at = NOW()
        RETURNING id`,
        [
          source.id,
          source.name,
          source.domain,
          source.region,
          source.language,
          source.category,
          Boolean(source.officialFlag),
          Number(source.trustScoreBaseline),
          source.active ? 'active' : 'inactive',
          source.homepageUrl,
          source.sourceGroup,
        ],
      );

      await client.query(
        `INSERT INTO source_feeds (
          source_id, registry_feed_id, feed_type, endpoint, polling_interval_sec, status, retry_limit
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (source_id, endpoint) DO UPDATE
        SET registry_feed_id = EXCLUDED.registry_feed_id,
            feed_type = EXCLUDED.feed_type,
            polling_interval_sec = EXCLUDED.polling_interval_sec,
            status = EXCLUDED.status,
            retry_limit = EXCLUDED.retry_limit,
            updated_at = NOW()`,
        [
          sourceResult.rows[0].id,
          source.id,
          source.transportType,
          source.url,
          300,
          source.active ? 'active' : 'inactive',
          3,
        ],
      );
    }

    return getSourceRegistryStats();
  });
}

module.exports = {
  NEWS_SOURCE_REGISTRY,
  getSourceRegistryStats,
  syncSourceRegistry,
};