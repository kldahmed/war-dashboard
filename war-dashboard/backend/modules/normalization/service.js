'use strict';

const { createHash } = require('node:crypto');
const { query } = require('../../lib/db');
const { assignStoryCluster, recordArticleVersionIfNeeded } = require('./cluster-service');
const { translateNormalizedItem } = require('../translation/service');

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
            sf.source_id, s.language AS source_language
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

  const insert = await query(
    `INSERT INTO normalized_items (
      raw_item_id, source_id, canonical_title, canonical_body, language, published_at_source, source_url, normalized_hash,
      title_fingerprint, content_fingerprint, time_bucket_30m, category, original_title, original_summary, translation_status, status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ready')
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
      payload.category ? String(payload.category).toLowerCase() : null,
      title || 'Untitled',
      body || title || 'No content',
      initialTranslationStatus,
    ],
  );

  const normalizedItem = {
    id: insert.rows[0].id,
    canonical_title: title || 'Untitled',
    canonical_body: body || title || 'No content',
    title_fingerprint: titleFingerprint,
    content_fingerprint: contentFingerprint,
    normalized_hash: normalizedHash,
    category: payload.category ? String(payload.category).toLowerCase() : null,
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
