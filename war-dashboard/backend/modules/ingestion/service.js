'use strict';

const { createHash, randomUUID } = require('node:crypto');
const Parser = require('rss-parser');
const { query } = require('../../lib/db');
const logger = require('../../lib/logger');
const metrics = require('../../lib/metrics');
const env = require('../../config/env');
const { normalizeRawItem } = require('../normalization/service');

function hashRawItem(item) {
  const base = `${item.link || ''}\n${item.guid || ''}\n${item.title || ''}\n${item.contentSnippet || item.content || ''}`;
  return createHash('sha256').update(base).digest('hex');
}

function toIsoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildParser(timeoutMs) {
  return new Parser({
    timeout: timeoutMs,
    requestOptions: {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'war-dashboard-ingestion/1.0' },
    },
  });
}

async function createJob(correlationId, payload = {}) {
  const res = await query(
    `INSERT INTO processing_jobs (job_type, status, payload_json, started_at, correlation_id)
     VALUES ('rss_ingestion', 'running', $1::jsonb, NOW(), $2)
     RETURNING id, started_at`,
    [JSON.stringify(payload), correlationId],
  );
  return res.rows[0];
}

async function finishJob(jobId, status, startedAt, errorMessage = null) {
  const endedAt = new Date();
  const latencyMs = Math.max(0, endedAt.getTime() - new Date(startedAt).getTime());
  await query(
    `UPDATE processing_jobs
     SET status = $1, ended_at = $2, latency_ms = $3, error_message = $4, updated_at = NOW()
     WHERE id = $5`,
    [status, endedAt.toISOString(), latencyMs, errorMessage, jobId],
  );

  metrics.recordJobRun({
    id: jobId,
    type: 'rss_ingestion',
    status,
    startedAt,
    endedAt: endedAt.toISOString(),
    latencyMs,
  });
}

async function listActiveRssFeeds() {
  const res = await query(
    `SELECT sf.id, sf.source_id, sf.endpoint, sf.polling_interval_sec, s.language, s.category
     FROM source_feeds sf
     JOIN sources s ON s.id = sf.source_id
     WHERE sf.status = 'active' AND sf.feed_type = 'rss'`,
  );
  return res.rows;
}

async function upsertRawItem(feedId, jobId, item) {
  const externalId = item.guid ? String(item.guid).trim() : null;
  const sourceUrl = item.link ? String(item.link).trim() : null;
  const title = item.title ? String(item.title) : null;
  const publishedAtSource = toIsoDate(item.isoDate || item.pubDate);
  const rawPayloadJson = JSON.stringify(item);
  const hash = hashRawItem(item);

  const params = [
    feedId,
    externalId,
    sourceUrl,
    title,
    publishedAtSource,
    rawPayloadJson,
    hash,
    jobId,
  ];

  const conflictClause = externalId
    ? `ON CONFLICT (source_feed_id, external_id) WHERE external_id IS NOT NULL`
    : `ON CONFLICT (source_feed_id, content_hash_raw)`;

  const result = await query(
    `INSERT INTO raw_items (
      source_feed_id, external_id, source_url, title, published_at_source,
      fetched_at, raw_payload_json, content_hash_raw, ingest_job_id, status
    )
    VALUES ($1,$2,$3,$4,$5,NOW(),$6::jsonb,$7,$8,'ingested')
    ${conflictClause}
    DO UPDATE SET
      source_url = EXCLUDED.source_url,
      title = EXCLUDED.title,
      published_at_source = EXCLUDED.published_at_source,
      fetched_at = NOW(),
      raw_payload_json = EXCLUDED.raw_payload_json,
      content_hash_raw = EXCLUDED.content_hash_raw,
      ingest_job_id = EXCLUDED.ingest_job_id,
      status = 'ingested',
      updated_at = NOW()
    RETURNING id, (xmax = 0) AS inserted`,
    params,
  );

  return {
    id: result.rows[0].id,
    inserted: result.rows[0].inserted,
  };
}

async function runRssIngestion({ correlationId = randomUUID(), triggeredBy = 'manual' } = {}) {
  const job = await createJob(correlationId, { triggeredBy });
  const parser = buildParser(env.rssRequestTimeoutMs);
  const feeds = await listActiveRssFeeds();
  const summary = {
    jobId: job.id,
    feedsTotal: feeds.length,
    feedsSucceeded: 0,
    feedsFailed: 0,
    rawInserted: 0,
    rawUpdated: 0,
    normalizedUpserted: 0,
    errors: [],
  };

  try {
    for (const feed of feeds) {
      try {
        const parsed = await parser.parseURL(feed.endpoint);
        const items = Array.isArray(parsed.items) ? parsed.items.slice(0, env.ingestionDefaultLimit) : [];

        for (const item of items) {
          const rawResult = await upsertRawItem(feed.id, job.id, item);
          if (rawResult.inserted) {
            summary.rawInserted += 1;
          } else {
            summary.rawUpdated += 1;
          }
          await normalizeRawItem(rawResult.id);
          summary.normalizedUpserted += 1;
        }

        await query(
          `UPDATE source_feeds
           SET last_success_at = NOW(), last_error_at = NULL, last_error_message = NULL, updated_at = NOW()
           WHERE id = $1`,
          [feed.id],
        );
        summary.feedsSucceeded += 1;
      } catch (feedErr) {
        summary.feedsFailed += 1;
        summary.errors.push({ feedId: feed.id, endpoint: feed.endpoint, message: feedErr.message });
        await query(
          `UPDATE source_feeds
           SET last_error_at = NOW(), last_error_message = $2, updated_at = NOW()
           WHERE id = $1`,
          [feed.id, String(feedErr.message || 'unknown_error').slice(0, 500)],
        );
      }
    }

    await finishJob(job.id, summary.feedsFailed > 0 ? 'completed_with_errors' : 'completed', job.started_at, null);
    logger.info('rss_ingestion_completed', { correlationId, summary });
    return summary;
  } catch (error) {
    await finishJob(job.id, 'failed', job.started_at, error.message);
    logger.error('rss_ingestion_failed', { correlationId, error: error.message });
    throw error;
  }
}

module.exports = {
  runRssIngestion,
};
