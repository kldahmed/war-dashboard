'use strict';

const { randomUUID } = require('node:crypto');
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

function resolveCorrelationId(req) {
  const incoming = req.headers['x-correlation-id'];
  const correlationId = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
  return correlationId;
}

function buildFreshness(rows, lastIngestionAt) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      latest_item_at: null,
      oldest_item_at: null,
      data_age_sec: null,
      last_ingestion_at: lastIngestionAt,
    };
  }

  const timestamps = rows
    .map((row) => row.published_at_source || row.fetched_at || row.created_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));

  if (timestamps.length === 0) {
    return {
      latest_item_at: null,
      oldest_item_at: null,
      data_age_sec: null,
      last_ingestion_at: lastIngestionAt,
    };
  }

  const latestMs = Math.max(...timestamps);
  const oldestMs = Math.min(...timestamps);

  return {
    latest_item_at: new Date(latestMs).toISOString(),
    oldest_item_at: new Date(oldestMs).toISOString(),
    data_age_sec: Math.max(0, Math.floor((Date.now() - latestMs) / 1000)),
    last_ingestion_at: lastIngestionAt,
  };
}

module.exports = async function handler(req, res) {
  const correlationId = resolveCorrelationId(req);
  res.setHeader('X-Correlation-Id', correlationId);

  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const category = typeof req.query.category === 'string' ? req.query.category.toLowerCase() : null;
    const searchQ = typeof req.query.q === 'string' ? req.query.q.trim() : null;

    const whereClauses = [
      "ni.status = 'ready'",
      'ni.canonical_title IS NOT NULL',
      "LENGTH(TRIM(ni.canonical_title)) > 0",
      'ni.canonical_body IS NOT NULL',
      "LENGTH(TRIM(ni.canonical_body)) > 0",
    ];
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      whereClauses.push(`COALESCE(ni.category, s.category) = $${params.length}`);
    }
    if (searchQ) {
      params.push(`%${searchQ}%`);
      whereClauses.push(`(ni.canonical_title ILIKE $${params.length} OR ni.canonical_body ILIKE $${params.length})`);
    }

    const whereStr = whereClauses.map(c => `(${c})`).join(' AND ');

    params.push(limit);
    const limitPlaceholder = `$${params.length}`;
    params.push(offset);
    const offsetPlaceholder = `$${params.length}`;

    const [result, countResult, lastJob] = await Promise.all([
      query(
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
       WHERE ${whereStr}
       ORDER BY ni.published_at_source DESC NULLS LAST, ri.fetched_at DESC
       LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      params,
      ),
      query(
      `SELECT COUNT(*)::int AS total
       FROM normalized_items ni
       JOIN raw_items ri ON ri.id = ni.raw_item_id
       JOIN sources s ON s.id = ni.source_id
       WHERE ${whereStr}`,
      params.slice(0, params.length - 2),
      ),
      query(
        `SELECT ended_at
         FROM processing_jobs
         WHERE job_type = 'rss_ingestion'
           AND status IN ('completed', 'completed_with_errors')
         ORDER BY created_at DESC
         LIMIT 1`,
      ),
    ]);

    const lastIngestionAt = lastJob.rowCount > 0 && lastJob.rows[0].ended_at
      ? new Date(lastJob.rows[0].ended_at).toISOString()
      : null;

    return res.status(200).json({
      mode: 'stored',
      fallback_used: false,
      freshness: buildFreshness(result.rows, lastIngestionAt),
      item_count: result.rowCount,
      total_count: countResult.rows[0]?.total ?? result.rowCount,
      correlation_id: correlationId,
      error_reason: null,
      items: result.rows.map(mapToUiItem),
      runtime: 'vercel',
    });
  } catch (error) {
    return res.status(500).json({
      error: 'news_feed_failed',
      details: error.message,
      mode: 'stored',
      fallback_used: false,
      freshness: {
        latest_item_at: null,
        oldest_item_at: null,
        data_age_sec: null,
        last_ingestion_at: null,
      },
      item_count: 0,
      correlation_id: correlationId,
      error_reason: error.message,
      runtime: 'vercel',
    });
  }
};
