'use strict';

const { createHash } = require('node:crypto');
const { query } = require('../../lib/db');
const { assignStoryCluster, recordArticleVersionIfNeeded } = require('./cluster-service');
const { translateNormalizedItem } = require('../translation/service');

const CATEGORY_DEFINITIONS = [
  {
    slug: 'breaking',
    titleKeywords: ['breaking', 'urgent', 'developing', 'flash', 'alert', 'عاجل', 'فوري', 'هام'],
    summaryKeywords: ['live updates', 'just in', 'تطورات متسارعة', 'تحديثات مباشرة'],
    sourceKeywords: [],
    hintKeywords: ['breaking'],
  },
  {
    slug: 'war',
    titleKeywords: ['war', 'attack', 'strike', 'missile', 'drone', 'military', 'troops', 'raid', 'artillery', 'قتال', 'هجوم', 'ضربة', 'صاروخ', 'مسيرة', 'قصف'],
    summaryKeywords: ['frontline', 'defense', 'airstrike', 'navy', 'army', 'معارك', 'عسكري', 'جبهة'],
    sourceKeywords: ['defense', 'war', 'military'],
    hintKeywords: ['war', 'defense'],
  },
  {
    slug: 'iran',
    titleKeywords: ['iran', 'iranian', 'tehran', 'irgc', 'khamenei', 'إيران', 'إيراني', 'طهران', 'الحرس الثوري', 'خامنئي'],
    summaryKeywords: ['islamic republic', 'iran nuclear', 'iranian foreign ministry', 'البرنامج النووي الإيراني'],
    sourceKeywords: ['iran'],
    hintKeywords: ['iran', 'middle-east'],
  },
  {
    slug: 'israel',
    titleKeywords: ['israel', 'israeli', 'idf', 'netanyahu', 'tel aviv', 'إسرائيل', 'إسرائيلي', 'الجيش الإسرائيلي', 'نتنياهو', 'تل أبيب'],
    summaryKeywords: ['knesset', 'gaza border', 'occupation', 'الكنيست', 'غزة'],
    sourceKeywords: ['israel'],
    hintKeywords: ['israel', 'middle-east'],
  },
  {
    slug: 'gulf',
    titleKeywords: ['gulf', 'gcc', 'saudi', 'uae', 'emirates', 'qatar', 'kuwait', 'oman', 'bahrain', 'riyadh', 'dubai', 'abu dhabi', 'الخليج', 'السعودية', 'الإمارات', 'قطر', 'الكويت', 'عمان', 'البحرين', 'الرياض', 'أبوظبي', 'دبي'],
    summaryKeywords: ['crown prince', 'opec+', 'gulf states', 'مجلس التعاون', 'ولي العهد'],
    sourceKeywords: ['arabia', 'gulf', 'asharq'],
    hintKeywords: ['gulf', 'middle-east'],
  },
  {
    slug: 'usa',
    titleKeywords: ['us ', 'u.s.', 'usa', 'america', 'american', 'washington', 'white house', 'pentagon', 'state department', 'congress', 'trump', 'biden', 'أمريكا', 'الولايات المتحدة', 'واشنطن', 'البيت الأبيض', 'البنتاغون', 'الكونغرس'],
    summaryKeywords: ['federal reserve', 'homeland', 'u.s. election', 'انتخابات أمريكية'],
    sourceKeywords: ['reuters', 'politico', 'state', 'defense'],
    hintKeywords: ['usa', 'politics'],
  },
  {
    slug: 'politics',
    titleKeywords: ['election', 'government', 'minister', 'parliament', 'cabinet', 'policy', 'diplomacy', 'summit', 'انتخابات', 'حكومة', 'وزير', 'برلمان', 'قمة', 'دبلوماسية'],
    summaryKeywords: ['foreign minister', 'prime minister', 'president', 'diplomatic', 'رئيس الوزراء', 'الرئاسة'],
    sourceKeywords: ['politico', 'state'],
    hintKeywords: ['politics'],
  },
  {
    slug: 'economy',
    titleKeywords: ['economy', 'market', 'trade', 'inflation', 'bank', 'finance', 'stocks', 'bond', 'tariff', 'اقتصاد', 'أسواق', 'تضخم', 'بنك', 'تمويل'],
    summaryKeywords: ['shares', 'earnings', 'gdp', 'central bank', 'growth', 'أسهم', 'نمو اقتصادي'],
    sourceKeywords: ['bloomberg', 'business', 'markets'],
    hintKeywords: ['economy'],
  },
  {
    slug: 'energy',
    titleKeywords: ['oil', 'gas', 'energy', 'pipeline', 'opec', 'fuel', 'electricity', 'lng', 'نفط', 'غاز', 'طاقة', 'أوبك', 'وقود'],
    summaryKeywords: ['crude', 'refinery', 'barrel', 'power grid', 'خام', 'مصفاة', 'برميل'],
    sourceKeywords: ['oilprice', 'energy'],
    hintKeywords: ['energy', 'economy'],
  },
  {
    slug: 'analysis',
    titleKeywords: ['analysis', 'opinion', 'insight', 'assessment', 'explainer', 'what to know', 'تحليل', 'قراءة', 'تقدير', 'ماذا نعرف'],
    summaryKeywords: ['outlook', 'scenario', 'deep dive', 'backgrounder', 'سيناريو', 'خلفيات'],
    sourceKeywords: ['crisis', 'isw'],
    hintKeywords: ['analysis'],
  },
  {
    slug: 'technology',
    titleKeywords: ['technology', 'artificial intelligence', 'ai', 'cyber', 'software', 'chip', 'digital', 'satellite', 'تقنية', 'ذكاء اصطناعي', 'سيبراني', 'برمجيات', 'رقمي'],
    summaryKeywords: ['data center', 'cybersecurity', 'semiconductor', 'hack', 'أمن سيبراني', 'أشباه موصلات'],
    sourceKeywords: ['tech'],
    hintKeywords: ['technology'],
  },
  {
    slug: 'world',
    titleKeywords: ['world', 'global', 'international', 'un', 'united nations', 'summit', 'العالم', 'دولي', 'أمم متحدة'],
    summaryKeywords: ['international community', 'humanitarian', 'multilateral', 'مجتمع دولي', 'إنساني'],
    sourceKeywords: ['un', 'reuters', 'ap'],
    hintKeywords: ['world'],
  },
];

let newsCategoryCache = null;

async function getNewsCategoryMap() {
  if (newsCategoryCache) return newsCategoryCache;
  const result = await query('SELECT id, slug FROM news_categories WHERE status = $1', ['active']);
  newsCategoryCache = new Map(result.rows.map((row) => [row.slug, row.id]));
  return newsCategoryCache;
}

function countKeywordHits(text, keywords) {
  if (!text) return 0;
  return keywords.reduce((count, keyword) => {
    if (!keyword) return count;
    return text.includes(String(keyword).toLowerCase()) ? count + 1 : count;
  }, 0);
}

function buildKeywordPool(value) {
  if (Array.isArray(value)) return value.map((entry) => normalizeUnicode(entry).toLowerCase()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(/[|,\n]/).map((entry) => normalizeUnicode(entry).toLowerCase()).filter(Boolean);
}

function classifyNormalizedContent({ title, body, sourceName, sourceDomain, sourceCategory, payloadCategory, payloadKeywords }) {
  const normalizedTitle = normalizeUnicode(title).toLowerCase();
  const normalizedBody = normalizeUnicode(body).toLowerCase();
  const normalizedSource = normalizeUnicode(`${sourceName || ''} ${sourceDomain || ''} ${sourceCategory || ''}`).toLowerCase();
  const normalizedHints = buildKeywordPool(payloadKeywords).concat(buildKeywordPool(payloadCategory)).join(' ');

  const scoredCategories = CATEGORY_DEFINITIONS.map((definition) => {
    const titleHits = countKeywordHits(normalizedTitle, definition.titleKeywords);
    const bodyHits = countKeywordHits(normalizedBody, definition.summaryKeywords.concat(definition.titleKeywords));
    const sourceHits = countKeywordHits(normalizedSource, definition.sourceKeywords);
    const hintHits = countKeywordHits(normalizedHints, definition.hintKeywords);
    const hasStrongTitleSignal = titleHits > 0;

    let score = 0;
    score += Math.min(titleHits, 3) * 0.36;
    score += Math.min(bodyHits, 4) * 0.17;
    score += Math.min(sourceHits, 2) * 0.12;
    score += Math.min(hintHits, 2) * 0.08;

    if (definition.slug === 'breaking' && hasStrongTitleSignal) score += 0.18;
    if (definition.slug === 'world') score += 0.08;
    if ((definition.slug === 'iran' || definition.slug === 'israel' || definition.slug === 'gulf' || definition.slug === 'usa') && hasStrongTitleSignal) {
      score += 0.09;
    }

    return {
      slug: definition.slug,
      score: Number(score.toFixed(4)),
      hits: titleHits + bodyHits + sourceHits + hintHits,
    };
  }).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.hits - left.hits;
  });

  const best = scoredCategories[0] || { slug: 'world', score: 0.2 };
  const runnerUp = scoredCategories[1] || { score: 0 };
  const margin = Math.max(0, best.score - runnerUp.score);
  const confidence = Math.max(0.42, Math.min(0.99, 0.44 + best.score * 0.42 + margin * 0.35));

  return {
    slug: best.score >= 0.16 ? best.slug : 'world',
    confidence: Number(confidence.toFixed(4)),
  };
}

function sanitizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeUnicode(text) {
  return sanitizeWhitespace(String(text || '').normalize('NFKC'));
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.toString();
  } catch (_err) {
    return null;
  }
}

function hashNormalized(title, body, sourceUrl) {
  const base = `${title}\n${body}\n${sourceUrl || ''}`.toLowerCase();
  return createHash('sha256').update(base).digest('hex');
}

function hashFingerprint(text) {
  const normalized = normalizeUnicode(String(text || '').toLowerCase());
  return createHash('sha256').update(normalized).digest('hex');
}

function buildTimeBucket30m(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const bucketMs = 30 * 60 * 1000;
  const floored = Math.floor(date.getTime() / bucketMs) * bucketMs;
  return new Date(floored).toISOString();
}

function inferLanguage(raw, sourceLanguage = null) {
  const lang = String(raw?.payload?.isoLanguage || raw?.payload?.language || '').trim().toLowerCase();
  if (lang) return lang;
  if (typeof sourceLanguage === 'string' && sourceLanguage.trim()) return sourceLanguage.trim().toLowerCase();
  return 'unknown';
}

async function normalizeRawItem(rawItemId, { correlationId = null } = {}) {
  const res = await query(
    `SELECT ri.id, ri.source_feed_id, ri.source_url, ri.title, ri.published_at_source, ri.raw_payload_json,
            sf.source_id, s.language AS source_language, s.name AS source_name, s.domain AS source_domain, s.category AS source_category
     FROM raw_items ri
     JOIN source_feeds sf ON sf.id = ri.source_feed_id
     JOIN sources s ON s.id = sf.source_id
     WHERE ri.id = $1`,
    [rawItemId],
  );

  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  const previousNormalizedRes = await query(
    `SELECT id, canonical_title, canonical_body, title_fingerprint, content_fingerprint
     FROM normalized_items
     WHERE raw_item_id = $1
     LIMIT 1`,
    [rawItemId],
  );
  const previousNormalized = previousNormalizedRes.rowCount > 0 ? previousNormalizedRes.rows[0] : null;
  const payload = row.raw_payload_json || {};
  const title = normalizeUnicode(row.title || payload.title || 'Untitled');
  const body = normalizeUnicode(payload.contentSnippet || payload.content || payload.summary || payload.description || title);
  const language = inferLanguage({ payload }, row.source_language);
  const sourceUrl = safeUrl(row.source_url || payload.link || '');
  const normalizedHash = hashNormalized(title, body, sourceUrl);
  const titleFingerprint = hashFingerprint(title);
  const contentFingerprint = hashFingerprint(body);
  const timeBucket30m = buildTimeBucket30m(row.published_at_source || payload.isoDate || payload.pubDate || null);
  const initialTranslationStatus = language.startsWith('ar') ? 'not_required' : 'pending';
  const classifiedCategory = classifyNormalizedContent({
    title,
    body,
    sourceName: row.source_name,
    sourceDomain: row.source_domain,
    sourceCategory: row.source_category,
    payloadCategory: payload.category,
    payloadKeywords: payload.categories || payload.keywords || payload.tags || [],
  });
  const newsCategoryMap = await getNewsCategoryMap();
  const newsCategoryId = newsCategoryMap.get(classifiedCategory.slug) || null;

  const insert = await query(
    `INSERT INTO normalized_items (
      raw_item_id, source_id, canonical_title, canonical_body, language, published_at_source, source_url, normalized_hash,
      title_fingerprint, content_fingerprint, time_bucket_30m, category, original_title, original_summary, translation_status,
      news_category_id, category_confidence_score, status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'ready')
    ON CONFLICT (raw_item_id) DO UPDATE
    SET canonical_title = EXCLUDED.canonical_title,
        canonical_body = EXCLUDED.canonical_body,
        language = EXCLUDED.language,
        published_at_source = EXCLUDED.published_at_source,
        source_url = EXCLUDED.source_url,
        normalized_hash = EXCLUDED.normalized_hash,
        title_fingerprint = EXCLUDED.title_fingerprint,
        content_fingerprint = EXCLUDED.content_fingerprint,
        time_bucket_30m = EXCLUDED.time_bucket_30m,
        category = EXCLUDED.category,
        news_category_id = EXCLUDED.news_category_id,
        category_confidence_score = EXCLUDED.category_confidence_score,
        original_title = EXCLUDED.original_title,
        original_summary = EXCLUDED.original_summary,
        translation_status = CASE
          WHEN normalized_items.original_title IS DISTINCT FROM EXCLUDED.original_title
            OR normalized_items.original_summary IS DISTINCT FROM EXCLUDED.original_summary
          THEN EXCLUDED.translation_status
          ELSE normalized_items.translation_status
        END,
        translated_title_ar = CASE
          WHEN normalized_items.original_title IS DISTINCT FROM EXCLUDED.original_title
            OR normalized_items.original_summary IS DISTINCT FROM EXCLUDED.original_summary
          THEN NULL
          ELSE normalized_items.translated_title_ar
        END,
        translated_summary_ar = CASE
          WHEN normalized_items.original_title IS DISTINCT FROM EXCLUDED.original_title
            OR normalized_items.original_summary IS DISTINCT FROM EXCLUDED.original_summary
          THEN NULL
          ELSE normalized_items.translated_summary_ar
        END,
        translation_provider = CASE
          WHEN normalized_items.original_title IS DISTINCT FROM EXCLUDED.original_title
            OR normalized_items.original_summary IS DISTINCT FROM EXCLUDED.original_summary
          THEN NULL
          ELSE normalized_items.translation_provider
        END,
        translation_updated_at = CASE
          WHEN normalized_items.original_title IS DISTINCT FROM EXCLUDED.original_title
            OR normalized_items.original_summary IS DISTINCT FROM EXCLUDED.original_summary
          THEN NULL
          ELSE normalized_items.translation_updated_at
        END,
        translation_error_message = CASE
          WHEN normalized_items.original_title IS DISTINCT FROM EXCLUDED.original_title
            OR normalized_items.original_summary IS DISTINCT FROM EXCLUDED.original_summary
          THEN NULL
          ELSE normalized_items.translation_error_message
        END,
        updated_at = NOW()
    RETURNING id`,
    [
      row.id,
      row.source_id,
      title || 'Untitled',
      body || title || 'No content',
      language,
      row.published_at_source,
      sourceUrl,
      normalizedHash,
      titleFingerprint,
      contentFingerprint,
      timeBucket30m,
      classifiedCategory.slug,
      title || 'Untitled',
      body || title || 'No content',
      initialTranslationStatus,
      newsCategoryId,
      classifiedCategory.confidence,
    ],
  );

  const normalizedItem = {
    id: insert.rows[0].id,
    canonical_title: title || 'Untitled',
    canonical_body: body || title || 'No content',
    title_fingerprint: titleFingerprint,
    content_fingerprint: contentFingerprint,
    normalized_hash: normalizedHash,
    category: classifiedCategory.slug,
    news_category_id: newsCategoryId,
    category_confidence_score: classifiedCategory.confidence,
    published_at_source: row.published_at_source,
    time_bucket_30m: timeBucket30m,
    created_at: new Date().toISOString(),
  };

  await recordArticleVersionIfNeeded(previousNormalized, normalizedItem);
  await assignStoryCluster(normalizedItem);

  const translation = await translateNormalizedItem(insert.rows[0].id, { correlationId });

  return {
    id: insert.rows[0].id,
    translationStatus: translation.translationStatus,
    translated: Boolean(translation.translated),
  };
}

module.exports = {
  normalizeRawItem,
  normalizeUnicode,
};
