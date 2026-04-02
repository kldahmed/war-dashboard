'use strict';

const { createHash } = require('node:crypto');
const { query } = require('../../lib/db');

const SCORE_PRECISION = 4;
const DEFAULT_DUPLICATE_RISK = 0.08;
const DEFAULT_NOVELTY = 0.92;
const TOKEN_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'over', 'under', 'after', 'before', 'about',
  'into', 'onto', 'near', 'than', 'then', 'they', 'them', 'their', 'have', 'has', 'had', 'were', 'will',
  'said', 'says', 'amid', 'against', 'news', 'update', 'live', 'video',
]);

function roundScore(value) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(SCORE_PRECISION));
}

function tokenize(text) {
  return Array.from(
    new Set(
      String(text || '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !TOKEN_STOPWORDS.has(token)),
    ),
  );
}

function jaccardSimilarity(left, right) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }

  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function timeDistanceScore(leftTime, rightTime) {
  if (!leftTime || !rightTime) return 0.35;
  const diffMs = Math.abs(new Date(leftTime).getTime() - new Date(rightTime).getTime());
  if (!Number.isFinite(diffMs)) return 0.35;
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours <= 3) return 1;
  if (diffHours <= 12) return 0.8;
  if (diffHours <= 24) return 0.65;
  if (diffHours <= 72) return 0.45;
  return 0.2;
}

function buildClusterKey(item) {
  const base = [
    item.title_fingerprint || '',
    item.category || '',
    item.time_bucket_30m || '',
    item.normalized_hash || '',
  ].join('\n');
  return createHash('sha256').update(base).digest('hex');
}

function scoreDuplicateRisk(target, candidate) {
  if (!candidate) {
    return { duplicateRisk: DEFAULT_DUPLICATE_RISK, noveltyScore: DEFAULT_NOVELTY, titleSimilarity: 0, bodySimilarity: 0 };
  }

  if (target.normalized_hash && target.normalized_hash === candidate.normalized_hash) {
    return { duplicateRisk: 0.995, noveltyScore: 0.005, titleSimilarity: 1, bodySimilarity: 1 };
  }

  const titleSimilarity = target.title_fingerprint && target.title_fingerprint === candidate.title_fingerprint
    ? 1
    : jaccardSimilarity(target.canonical_title, candidate.canonical_title);
  const bodySimilarity = target.content_fingerprint && target.content_fingerprint === candidate.content_fingerprint
    ? 1
    : jaccardSimilarity(target.canonical_body, candidate.canonical_body);
  const timeScore = timeDistanceScore(
    target.published_at_source || target.created_at,
    candidate.published_at_source || candidate.created_at,
  );

  let duplicateRisk = (titleSimilarity * 0.55) + (bodySimilarity * 0.3) + (timeScore * 0.15);
  if (titleSimilarity === 1) duplicateRisk = Math.max(duplicateRisk, 0.92);
  if (bodySimilarity === 1) duplicateRisk = Math.max(duplicateRisk, 0.88);

  const roundedRisk = roundScore(duplicateRisk);
  return {
    duplicateRisk: roundedRisk,
    noveltyScore: roundScore(1 - roundedRisk),
    titleSimilarity: roundScore(titleSimilarity),
    bodySimilarity: roundScore(bodySimilarity),
  };
}

async function getExistingCluster(normalizedItemId) {
  const res = await query(
    `SELECT ce.cluster_id, sc.cluster_key
     FROM cluster_events ce
     JOIN story_clusters sc ON sc.id = ce.cluster_id
     WHERE ce.normalized_item_id = $1
     ORDER BY ce.id DESC
     LIMIT 1`,
    [normalizedItemId],
  );
  return res.rowCount > 0 ? res.rows[0] : null;
}

async function listClusterCandidates(target) {
  const res = await query(
    `SELECT
       ni.id AS normalized_id,
       ni.canonical_title,
       ni.canonical_body,
       ni.title_fingerprint,
       ni.content_fingerprint,
       ni.normalized_hash,
       ni.category,
       ni.published_at_source,
       ni.time_bucket_30m,
       ni.created_at,
       ce.cluster_id,
       sc.cluster_key
     FROM normalized_items ni
     LEFT JOIN cluster_events ce ON ce.normalized_item_id = ni.id
     LEFT JOIN story_clusters sc ON sc.id = ce.cluster_id
     WHERE ni.id <> $1
       AND ni.status = 'ready'
       AND ($2::text IS NULL OR ni.category = $2 OR ni.category IS NULL)
       AND COALESCE(ni.published_at_source, ni.created_at) >= COALESCE($3::timestamptz, NOW()) - INTERVAL '7 days'
     ORDER BY COALESCE(ni.published_at_source, ni.created_at) DESC
     LIMIT 60`,
    [target.id, target.category || null, target.published_at_source || target.created_at || null],
  );
  return res.rows;
}

async function upsertCluster(clusterKey, item) {
  const eventTime = item.published_at_source || item.created_at || new Date().toISOString();
  const res = await query(
    `INSERT INTO story_clusters (cluster_key, canonical_title, category, first_seen_at, last_seen_at, item_count)
     VALUES ($1, $2, $3, $4, $4, 0)
     ON CONFLICT (cluster_key) DO UPDATE
     SET canonical_title = CASE
           WHEN story_clusters.canonical_title IS NULL OR LENGTH(EXCLUDED.canonical_title) > LENGTH(story_clusters.canonical_title)
             THEN EXCLUDED.canonical_title
           ELSE story_clusters.canonical_title
         END,
         category = COALESCE(story_clusters.category, EXCLUDED.category),
         last_seen_at = GREATEST(story_clusters.last_seen_at, EXCLUDED.last_seen_at),
         updated_at = NOW()
     RETURNING id, cluster_key`,
    [clusterKey, item.canonical_title, item.category || null, eventTime],
  );
  return res.rows[0];
}

async function upsertClusterEvent(clusterId, normalizedItemId, duplicateRisk, noveltyScore, details) {
  const eventTime = details.eventTime || new Date().toISOString();
  await query(
    `INSERT INTO cluster_events (
       cluster_id, normalized_item_id, event_type, event_time, novelty_hint, duplicate_risk_hint, details_json
     )
     VALUES ($1, $2, 'linked', $3, $4, $5, $6::jsonb)
     ON CONFLICT (cluster_id, normalized_item_id) DO UPDATE
     SET event_time = EXCLUDED.event_time,
         novelty_hint = EXCLUDED.novelty_hint,
         duplicate_risk_hint = EXCLUDED.duplicate_risk_hint,
         details_json = EXCLUDED.details_json`,
    [clusterId, normalizedItemId, eventTime, noveltyScore, duplicateRisk, JSON.stringify(details)],
  );

  await query(
    `UPDATE story_clusters sc
     SET item_count = summary.item_count,
         last_seen_at = GREATEST(sc.last_seen_at, $2::timestamptz),
         updated_at = NOW()
     FROM (
       SELECT cluster_id, COUNT(*)::int AS item_count
       FROM cluster_events
       WHERE cluster_id = $1
       GROUP BY cluster_id
     ) AS summary
     WHERE sc.id = summary.cluster_id`,
    [clusterId, eventTime],
  );
}

async function ensureBaselineArticleVersion(previousItem) {
  const res = await query(
    `SELECT 1
     FROM article_versions
     WHERE normalized_item_id = $1
       AND version_no = 1
     LIMIT 1`,
    [previousItem.id],
  );

  if (res.rowCount > 0) return;

  await query(
    `INSERT INTO article_versions (
       normalized_item_id, version_no, title, body, title_fingerprint, content_fingerprint, change_reason
     )
     VALUES ($1, 1, $2, $3, $4, $5, 'initial_capture')`,
    [
      previousItem.id,
      previousItem.canonical_title,
      previousItem.canonical_body,
      previousItem.title_fingerprint,
      previousItem.content_fingerprint,
    ],
  );
}

function detectChangeReason(previousItem, nextItem) {
  const titleChanged = previousItem.title_fingerprint !== nextItem.title_fingerprint;
  const bodyChanged = previousItem.content_fingerprint !== nextItem.content_fingerprint;
  if (titleChanged && bodyChanged) return 'story_update';
  if (titleChanged) return 'title_update';
  return 'body_update';
}

async function recordArticleVersionIfNeeded(previousItem, nextItem) {
  if (!previousItem || !nextItem) return false;
  if (
    previousItem.title_fingerprint === nextItem.title_fingerprint
    && previousItem.content_fingerprint === nextItem.content_fingerprint
  ) {
    return false;
  }

  const bodySimilarity = jaccardSimilarity(previousItem.canonical_body, nextItem.canonical_body);
  const titleSimilarity = jaccardSimilarity(previousItem.canonical_title, nextItem.canonical_title);
  const significant = previousItem.title_fingerprint !== nextItem.title_fingerprint
    || bodySimilarity < 0.88
    || titleSimilarity < 0.9;

  if (!significant) return false;

  await ensureBaselineArticleVersion(previousItem);

  const latestRes = await query(
    `SELECT version_no, title_fingerprint, content_fingerprint
     FROM article_versions
     WHERE normalized_item_id = $1
     ORDER BY version_no DESC
     LIMIT 1`,
    [previousItem.id],
  );

  const latest = latestRes.rowCount > 0 ? latestRes.rows[0] : null;
  if (
    latest
    && latest.title_fingerprint === nextItem.title_fingerprint
    && latest.content_fingerprint === nextItem.content_fingerprint
  ) {
    return false;
  }

  const nextVersion = latest ? Number(latest.version_no) + 1 : 2;
  await query(
    `INSERT INTO article_versions (
       normalized_item_id, version_no, title, body, title_fingerprint, content_fingerprint, change_reason
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      previousItem.id,
      nextVersion,
      nextItem.canonical_title,
      nextItem.canonical_body,
      nextItem.title_fingerprint,
      nextItem.content_fingerprint,
      detectChangeReason(previousItem, nextItem),
    ],
  );

  return true;
}

async function assignStoryCluster(normalizedItem) {
  const existingCluster = await getExistingCluster(normalizedItem.id);
  if (existingCluster) {
    await upsertClusterEvent(
      existingCluster.cluster_id,
      normalizedItem.id,
      0.99,
      0.01,
      {
        algorithm: 'wave2_batch1',
        reason: 'existing_cluster',
        eventTime: normalizedItem.published_at_source || normalizedItem.created_at || new Date().toISOString(),
      },
    );
    return { clusterId: existingCluster.cluster_id, duplicateRisk: 0.99, noveltyScore: 0.01 };
  }

  const candidates = await listClusterCandidates(normalizedItem);
  let bestCandidate = null;
  let bestScores = null;

  for (const candidate of candidates) {
    const scores = scoreDuplicateRisk(normalizedItem, candidate);
    if (!bestScores || scores.duplicateRisk > bestScores.duplicateRisk) {
      bestCandidate = candidate;
      bestScores = scores;
    }
  }

  const shouldAttachToExistingStory = bestScores && bestScores.duplicateRisk >= 0.72;
  const clusterSeed = shouldAttachToExistingStory && bestCandidate ? bestCandidate : normalizedItem;
  const clusterKey = bestCandidate?.cluster_key || buildClusterKey(clusterSeed);
  const cluster = await upsertCluster(clusterKey, clusterSeed);

  if (shouldAttachToExistingStory && bestCandidate && !bestCandidate.cluster_id) {
    await upsertClusterEvent(
      cluster.id,
      bestCandidate.normalized_id,
      0.9,
      0.1,
      {
        algorithm: 'wave2_batch1',
        reason: 'backfill_cluster_seed',
        eventTime: bestCandidate.published_at_source || bestCandidate.created_at || new Date().toISOString(),
      },
    );
  }

  const scores = shouldAttachToExistingStory && bestScores
    ? bestScores
    : { duplicateRisk: DEFAULT_DUPLICATE_RISK, noveltyScore: DEFAULT_NOVELTY, titleSimilarity: 0, bodySimilarity: 0 };

  await upsertClusterEvent(
    cluster.id,
    normalizedItem.id,
    scores.duplicateRisk,
    scores.noveltyScore,
    {
      algorithm: 'wave2_batch1',
      matchedNormalizedItemId: bestCandidate?.normalized_id || null,
      titleSimilarity: scores.titleSimilarity,
      bodySimilarity: scores.bodySimilarity,
      eventTime: normalizedItem.published_at_source || normalizedItem.created_at || new Date().toISOString(),
    },
  );

  return {
    clusterId: cluster.id,
    duplicateRisk: scores.duplicateRisk,
    noveltyScore: scores.noveltyScore,
  };
}

module.exports = {
  assignStoryCluster,
  recordArticleVersionIfNeeded,
};