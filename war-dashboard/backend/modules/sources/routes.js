'use strict';

const express = require('express');
const { query } = require('../../lib/db');
const { validateSourcePayload, validateFeedPayload } = require('../../lib/validation');
const { writeAuditLog } = require('../../lib/audit');
const { asyncHandler } = require('../../lib/async-handler');
const { requireAuth, requireRole } = require('../../lib/auth-middleware');

const router = express.Router();

router.get('/sources', asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, domain, region, language, category, official_flag, trust_score, status, created_at, updated_at
     FROM sources
     ORDER BY id DESC`,
  );
  res.json({ items: result.rows });
}));

router.post('/sources', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { errors, value } = validateSourcePayload(req.body || {});
  if (errors.length > 0) return res.status(400).json({ error: 'validation_error', details: errors });

  try {
    const result = await query(
      `INSERT INTO sources (name, domain, region, language, category, official_flag, trust_score, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, name, domain, region, language, category, official_flag, trust_score, status, created_at, updated_at`,
      [
        value.name,
        value.domain,
        value.region,
        value.language,
        value.category,
        value.official_flag,
        value.trust_score,
        value.status,
      ],
    );

    await writeAuditLog({
      actorType: 'api',
      actorId: 'anonymous',
      action: 'create_source',
      targetType: 'source',
      targetId: result.rows[0].id,
      details: { domain: value.domain, name: value.name },
      correlationId: req.correlationId,
    });

    return res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    if (String(error.message).includes('duplicate key value')) {
      return res.status(409).json({ error: 'source_domain_already_exists' });
    }
    throw error;
  }
}));

router.post('/source-feeds', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { errors, value } = validateFeedPayload(req.body || {});
  if (errors.length > 0) return res.status(400).json({ error: 'validation_error', details: errors });

  const sourceRes = await query('SELECT id FROM sources WHERE id = $1', [value.source_id]);
  if (sourceRes.rowCount === 0) return res.status(404).json({ error: 'source_not_found' });

  try {
    const result = await query(
      `INSERT INTO source_feeds (source_id, feed_type, endpoint, polling_interval_sec, status)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, source_id, feed_type, endpoint, polling_interval_sec, status, last_success_at, last_error_at, created_at, updated_at`,
      [value.source_id, value.feed_type, value.endpoint, value.polling_interval_sec, value.status],
    );

    await writeAuditLog({
      actorType: 'api',
      actorId: 'anonymous',
      action: 'create_source_feed',
      targetType: 'source_feed',
      targetId: result.rows[0].id,
      details: { source_id: value.source_id, endpoint: value.endpoint },
      correlationId: req.correlationId,
    });

    return res.status(201).json({ item: result.rows[0] });
  } catch (error) {
    if (String(error.message).includes('duplicate key value')) {
      return res.status(409).json({ error: 'source_feed_endpoint_already_exists' });
    }
    throw error;
  }
}));

module.exports = router;
