INSERT INTO sources (name, domain, region, language, category, official_flag, trust_score, status)
VALUES
  ('Reuters World', 'reuters.com', 'global', 'en', 'general', FALSE, 82.00, 'active'),
  ('Al Jazeera Arabic', 'aljazeera.net', 'mena', 'ar', 'general', FALSE, 78.00, 'active'),
  ('US Department of State', 'state.gov', 'usa', 'en', 'official', TRUE, 88.00, 'active')
ON CONFLICT (domain) DO UPDATE
SET
  name = EXCLUDED.name,
  region = EXCLUDED.region,
  language = EXCLUDED.language,
  category = EXCLUDED.category,
  official_flag = EXCLUDED.official_flag,
  trust_score = EXCLUDED.trust_score,
  status = EXCLUDED.status,
  updated_at = NOW();

INSERT INTO source_feeds (source_id, feed_type, endpoint, polling_interval_sec, status)
SELECT s.id, 'rss', x.endpoint, x.polling_interval_sec, 'active'
FROM (
  VALUES
    ('reuters.com', 'https://www.reutersagency.com/feed/?best-topics=world&post_type=best', 300),
    ('aljazeera.net', 'https://www.aljazeera.net/aljazeerarss/ar.xml', 300),
    ('state.gov', 'https://www.state.gov/feed/', 600)
) AS x(domain, endpoint, polling_interval_sec)
JOIN sources s ON s.domain = x.domain
ON CONFLICT (source_id, endpoint) DO UPDATE
SET
  feed_type = EXCLUDED.feed_type,
  polling_interval_sec = EXCLUDED.polling_interval_sec,
  status = EXCLUDED.status,
  updated_at = NOW();
