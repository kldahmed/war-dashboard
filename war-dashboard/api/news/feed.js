'use strict';

const { query } = require('../../backend/lib/db');

function mapToUiItem(row) {
  const category = row.category || row.source_category || 'all';
  const published = row.published_at_source || row.fetched_at || row.created_at;
  return {
    id: row.normalized_id,
    title: row.canonical_title,
    summary: row.canonical_body,
    category,
    urgency: 'medium',
    time: published ? new Date(published).toISOString() : 'unknown',
    source: {
      id: row.source_id,
      name: row.source_name,
      domain: row.source_domain,
      trust_score: row.trust_score,
    },
    provenance: {
      raw_item_id: row.raw_item_id,
      source_feed_id: row.source_feed_id,
      source_url: row.source_url,
      fetched_at: row.fetched_at,
      published_at_source: row.published_at_source,
      normalized_hash: row.normalized_hash,
    },
  };
}

module.exports = async function handler(req, res) {
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const category = typeof req.query.category === 'string' ? req.query.category.toLowerCase() : null;

    const params = [limit];
    const categoryClause = category && category !== 'all' ? 'AND COALESCE(ni.category, s.category) = $2' : '';
    if (categoryClause) params.push(category);

    const result = await query(
      `SELECT
        ni.id AS normalized_id,
        ni.raw_item_id,
        ni.canonical_title,
        ni.canonical_body,
        ni.category,
        ni.published_at_source,
        ni.normalized_hash,
        ni.created_at,
        ri.source_feed_id,
        ri.source_url,
        ri.fetched_at,
        s.id AS source_id,
        s.name AS source_name,
        s.domain AS source_domain,
        s.category AS source_category,
        s.trust_score
       FROM normalized_items ni
       JOIN raw_items ri ON ri.id = ni.raw_item_id
       JOIN sources s ON s.id = ni.source_id
       WHERE ni.status = 'ready'
         AND ni.canonical_title IS NOT NULL
         AND LENGTH(TRIM(ni.canonical_title)) > 0
         AND ni.canonical_body IS NOT NULL
         AND LENGTH(TRIM(ni.canonical_body)) > 0
         ${categoryClause}
       ORDER BY ni.published_at_source DESC NULLS LAST, ri.fetched_at DESC
       LIMIT $1`,
      params,
    );

    return res.status(200).json({
      mode: 'stored',
      count: result.rowCount,
      items: result.rows.map(mapToUiItem),
      runtime: 'vercel',
    });
  } catch (error) {
    return res.status(500).json({
      error: 'news_feed_failed',
      details: error.message,
      runtime: 'vercel',
    });
  }
};
