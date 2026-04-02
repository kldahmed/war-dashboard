'use strict';

const { createHash } = require('node:crypto');
const { query } = require('../../lib/db');

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

function inferLanguage(raw) {
  const lang = String(raw?.payload?.isoLanguage || raw?.payload?.language || '').trim().toLowerCase();
  if (lang) return lang;
  return 'unknown';
}

async function normalizeRawItem(rawItemId) {
  const res = await query(
    `SELECT ri.id, ri.source_feed_id, ri.source_url, ri.title, ri.published_at_source, ri.raw_payload_json,
            sf.source_id
     FROM raw_items ri
     JOIN source_feeds sf ON sf.id = ri.source_feed_id
     WHERE ri.id = $1`,
    [rawItemId],
  );

  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  const payload = row.raw_payload_json || {};
  const title = normalizeUnicode(row.title || payload.title || 'Untitled');
  const body = normalizeUnicode(payload.contentSnippet || payload.content || payload.summary || payload.description || title);
  const language = inferLanguage({ payload });
  const sourceUrl = safeUrl(row.source_url || payload.link || '');
  const normalizedHash = hashNormalized(title, body, sourceUrl);

  const insert = await query(
    `INSERT INTO normalized_items (
      raw_item_id, source_id, canonical_title, canonical_body, language, published_at_source, source_url, normalized_hash, category, status
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready')
    ON CONFLICT (raw_item_id) DO UPDATE
    SET canonical_title = EXCLUDED.canonical_title,
        canonical_body = EXCLUDED.canonical_body,
        language = EXCLUDED.language,
        published_at_source = EXCLUDED.published_at_source,
        source_url = EXCLUDED.source_url,
        normalized_hash = EXCLUDED.normalized_hash,
        category = EXCLUDED.category,
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
      payload.category ? String(payload.category).toLowerCase() : null,
    ],
  );

  return insert.rows[0];
}

module.exports = {
  normalizeRawItem,
  normalizeUnicode,
};
