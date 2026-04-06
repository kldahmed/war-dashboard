'use strict';

const { createHash, randomUUID } = require('node:crypto');
const Parser = require('rss-parser');
const { query } = require('../../lib/db');
const logger = require('../../lib/logger');
const metrics = require('../../lib/metrics');
const env = require('../../config/env');
const { normalizeRawItem } = require('../normalization/service');
const { syncSourceRegistry, getSourceRegistryStats } = require('./source-registry');

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

function withTimeout(promise, timeoutMs, message = 'operation_timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(message));
      }, timeoutMs);
    }),
  ]);
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

async function createFeedRun(jobId, feed) {
  const res = await query(
    `INSERT INTO ingestion_feed_runs (
      job_id, source_feed_id, source_id, source_registry_id, feed_name, feed_endpoint, status, started_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,'running', NOW())
    RETURNING id, started_at`,
    [jobId, feed.id, feed.source_id, feed.source_registry_id || null, feed.source_name, feed.endpoint],
  );
  return res.rows[0];
}

async function createIngestionRun(jobId, feed) {
  const res = await query(
    `INSERT INTO ingestion_runs (
      source_id, source_feed_id, job_id, source_registry_id, status, items_fetched, items_stored, duration
    )
    VALUES ($1,$2,$3,$4,'running',0,0,NULL)
    RETURNING id, created_at`,
    [feed.source_id, feed.id, jobId, feed.source_registry_id || null],
  );
  return res.rows[0];
}

async function finishFeedRun(feedRunId, startedAt, details) {
  const endedAt = new Date();
  const latencyMs = Math.max(0, endedAt.getTime() - new Date(startedAt).getTime());
  await query(
    `UPDATE ingestion_feed_runs
     SET status = $2,
         attempt_count = $3,
         raw_seen_count = $4,
         raw_inserted_count = $5,
         raw_updated_count = $6,
         normalized_count = $7,
         translated_count = $8,
         ended_at = $9,
         latency_ms = $10,
         error_message = $11,
         updated_at = NOW()
     WHERE id = $1`,
    [
      feedRunId,
      details.status,
      details.attemptCount,
      details.rawSeenCount,
      details.rawInsertedCount,
      details.rawUpdatedCount,
      details.normalizedCount,
      details.translatedCount,
      endedAt.toISOString(),
      latencyMs,
      details.errorMessage || null,
    ],
  );
}

async function finishIngestionRun(runId, startedAt, details) {
  const endedAt = new Date();
  const duration = Math.max(0, endedAt.getTime() - new Date(startedAt).getTime());
  await query(
    `UPDATE ingestion_runs
     SET status = $2,
         items_fetched = $3,
         items_stored = $4,
         duration = $5,
         error_message = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [
      runId,
      details.status,
      details.rawSeenCount,
      details.normalizedCount,
      duration,
      details.errorMessage || null,
    ],
  );
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

async function cleanupStaleRunningJobs(maxAgeMinutes = 120) {
  const result = await query(
    `UPDATE processing_jobs
     SET status = 'failed',
         ended_at = NOW(),
         latency_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000))::int,
         error_message = COALESCE(error_message, 'stale_running_job_auto_closed'),
         updated_at = NOW()
     WHERE job_type = 'rss_ingestion'
       AND status = 'running'
       AND started_at < NOW() - ($1::int * INTERVAL '1 minute')
     RETURNING id`,
    [maxAgeMinutes],
  );

  if (result.rowCount > 0) {
    logger.warn('rss_ingestion_stale_jobs_closed', {
      count: result.rowCount,
      maxAgeMinutes,
      jobIds: result.rows.map((r) => r.id),
    });
  }
}

async function markSourceRuntimeState(sourceId, status) {
  await query(
    `UPDATE sources
     SET status = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [sourceId, status],
  );
}

async function listActiveRssFeeds() {
  const res = await query(
    `SELECT sf.id, sf.source_id, sf.registry_feed_id, sf.endpoint, sf.polling_interval_sec, sf.retry_limit,
            s.registry_id AS source_registry_id, s.name AS source_name, s.language, s.category
     FROM source_feeds sf
     JOIN sources s ON s.id = sf.source_id
     WHERE sf.status = 'active' AND sf.feed_type = 'rss'`,
  );
  return res.rows;
}

async function parseFeedWithRetry(parser, endpoint, retryLimit) {
  let lastError = null;
  const attempts = Math.max(1, Number.parseInt(String(retryLimit || 1), 10) || 1);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const parsed = await parser.parseURL(endpoint);
      return { parsed, attemptCount: attempt };
    } catch (error) {
      lastError = error;
    }
  }

  throw Object.assign(lastError || new Error('feed_parse_failed'), { attemptCount: attempts });
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

async function runRssIngestion({ correlationId = randomUUID(), triggeredBy = 'manual', onJobCreated = null } = {}) {
  const advisoryLockKey = 48201911;
  const lockRes = await query('SELECT pg_try_advisory_lock($1) AS locked', [advisoryLockKey]);
  const lockAcquired = Boolean(lockRes.rows?.[0]?.locked);

  if (!lockAcquired) {
    logger.warn('rss_ingestion_skipped_lock_busy', { correlationId, triggeredBy });
    return {
      skipped: true,
      reason: 'ingestion_already_running',
      correlationId,
    };
  }

  let job;
  try {
    await cleanupStaleRunningJobs(env.ingestionStaleJobMinutes);
    await syncSourceRegistry();
    job = await createJob(correlationId, { triggeredBy });
  } catch (setupError) {
    await query('SELECT pg_advisory_unlock($1)', [advisoryLockKey]).catch(() => {});
    throw setupError;
  }

  if (typeof onJobCreated === 'function') {
    onJobCreated(job.id);
  }
  const parser = buildParser(env.rssRequestTimeoutMs);
  const feeds = await listActiveRssFeeds();
  const ingestionConcurrency = Math.max(1, Number(env.ingestionConcurrency) || 1);
  const skipTranslation = Boolean(env.ingestionSkipTranslation);
  const registryStats = getSourceRegistryStats();
  const summary = {
    jobId: job.id,
    totalSourcesConfigured: registryStats.totalSourcesConfigured,
    activeSources: registryStats.activeSourcesConfigured,
    successfulSources: 0,
    failedSources: 0,
    totalRawItems: 0,
    totalStoredItems: 0,
    totalNormalizedItems: 0,
    totalTranslatedItems: 0,
    feedsTotal: feeds.length,
    feedsSucceeded: 0,
    feedsFailed: 0,
    rawInserted: 0,
    rawUpdated: 0,
    normalizedUpserted: 0,
    sourceGroups: {
      arabic: registryStats.arabicSources,
      global: registryStats.globalSources,
      specialist: registryStats.specialistSources,
    },
    errors: [],
  };

  async function processFeed(feed) {
      const feedRun = await createFeedRun(job.id, feed);
      const ingestionRun = await createIngestionRun(job.id, feed);
      const feedSummary = {
        status: 'completed',
        attemptCount: 1,
        rawSeenCount: 0,
        rawInsertedCount: 0,
        rawUpdatedCount: 0,
        normalizedCount: 0,
        translatedCount: 0,
        errorMessage: null,
      };

      try {
        await withTimeout((async () => {
          const { parsed, attemptCount } = await parseFeedWithRetry(parser, feed.endpoint, feed.retry_limit);
          feedSummary.attemptCount = attemptCount;
          const items = Array.isArray(parsed.items) ? parsed.items.slice(0, env.ingestionDefaultLimit) : [];
          feedSummary.rawSeenCount = items.length;
          summary.totalRawItems += items.length;

          for (const item of items) {
            try {
              const rawResult = await upsertRawItem(feed.id, job.id, item);
              if (rawResult.inserted) {
                summary.rawInserted += 1;
                feedSummary.rawInsertedCount += 1;
              } else {
                summary.rawUpdated += 1;
                feedSummary.rawUpdatedCount += 1;
              }

              const normalizedResult = await normalizeRawItem(rawResult.id, {
                correlationId,
                skipTranslation,
              });
              if (normalizedResult?.id) {
                summary.totalStoredItems += 1;
                summary.normalizedUpserted += 1;
                summary.totalNormalizedItems += 1;
                feedSummary.normalizedCount += 1;
              }
              if (normalizedResult?.translated) {
                summary.totalTranslatedItems += 1;
                feedSummary.translatedCount += 1;
              }
            } catch (itemError) {
              summary.errors.push({
                feedId: feed.id,
                endpoint: feed.endpoint,
                message: itemError.message,
                scope: 'item',
              });
              feedSummary.status = 'completed_with_errors';
              logger.warn('rss_feed_item_failed', {
                correlationId,
                sourceRegistryId: feed.source_registry_id,
                sourceId: feed.source_id,
                endpoint: feed.endpoint,
                message: itemError.message,
              });
            }
          }

          await query(
            `UPDATE source_feeds
             SET last_success_at = NOW(), last_error_at = NULL, last_error_message = NULL, updated_at = NOW()
             WHERE id = $1`,
            [feed.id],
          );
          await markSourceRuntimeState(feed.source_id, 'active');
          summary.feedsSucceeded += 1;
          summary.successfulSources += 1;
          await finishFeedRun(feedRun.id, feedRun.started_at, feedSummary);
          await finishIngestionRun(ingestionRun.id, ingestionRun.created_at, feedSummary);
          logger.info('rss_feed_completed', {
            correlationId,
            sourceRegistryId: feed.source_registry_id,
            endpoint: feed.endpoint,
            summary: feedSummary,
          });
        })(), env.ingestionFeedTimeoutMs, 'feed_processing_timeout');
      } catch (feedErr) {
        summary.feedsFailed += 1;
        summary.failedSources += 1;
        feedSummary.status = 'failed';
        feedSummary.errorMessage = feedErr.message;
        feedSummary.attemptCount = Number(feedErr.attemptCount || feedSummary.attemptCount || 1);
        summary.errors.push({ feedId: feed.id, endpoint: feed.endpoint, message: feedErr.message });
        await query(
          `UPDATE source_feeds
           SET last_error_at = NOW(), last_error_message = $2, updated_at = NOW()
           WHERE id = $1`,
          [feed.id, String(feedErr.message || 'unknown_error').slice(0, 500)],
        );
        await markSourceRuntimeState(feed.source_id, 'active');
        await finishFeedRun(feedRun.id, feedRun.started_at, feedSummary);
        await finishIngestionRun(ingestionRun.id, ingestionRun.created_at, feedSummary);
        logger.warn('rss_feed_failed', {
          correlationId,
          sourceRegistryId: feed.source_registry_id,
          sourceId: feed.source_id,
          endpoint: feed.endpoint,
          message: feedErr.message,
          attempts: feedSummary.attemptCount,
        });
      }
  }

  try {
    let cursor = 0;
    const workerCount = Math.min(ingestionConcurrency, Math.max(feeds.length, 1));
    const workers = Array.from({ length: workerCount }, () => (async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= feeds.length) break;
        await processFeed(feeds[index]);
      }
    })());

    await Promise.all(workers);

    await finishJob(job.id, summary.feedsFailed > 0 ? 'completed_with_errors' : 'completed', job.started_at, null);
    logger.info('rss_ingestion_completed', { correlationId, summary });
    return summary;
  } catch (error) {
    await finishJob(job.id, 'failed', job.started_at, error.message);
    logger.error('rss_ingestion_failed', { correlationId, error: error.message });
    throw error;
  } finally {
    await query('SELECT pg_advisory_unlock($1)', [advisoryLockKey]).catch(() => {});
  }
}

module.exports = {
  runRssIngestion,
};
