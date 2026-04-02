'use strict';

const { randomUUID } = require('node:crypto');
const { query } = require('../../backend/lib/db');

function resolveCorrelationId(req) {
  const incoming = req.headers['x-correlation-id'];
  return typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
}

module.exports = async function handler(req, res) {
  const correlationId = resolveCorrelationId(req);
  res.setHeader('X-Correlation-Id', correlationId);

  try {
    const db = await query('SELECT 1 AS ok');
    return res.status(200).json({
      status: 'ok',
      db: db.rows[0]?.ok === 1,
      feed_mode: process.env.FEED_MODE || process.env.REACT_APP_FEED_MODE || 'legacy',
      feed_fallback_enabled: String(process.env.FEED_FALLBACK_ENABLED || process.env.REACT_APP_FEED_FALLBACK || 'true').toLowerCase() === 'true',
      verify_mode: String(process.env.REACT_APP_PRODUCTION_VERIFY_MODE || 'false').toLowerCase() === 'true',
      correlation_id: correlationId,
      time: new Date().toISOString(),
      runtime: 'vercel',
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      error: 'health_check_failed',
      details: error.message,
      feed_mode: process.env.FEED_MODE || process.env.REACT_APP_FEED_MODE || 'legacy',
      feed_fallback_enabled: String(process.env.FEED_FALLBACK_ENABLED || process.env.REACT_APP_FEED_FALLBACK || 'true').toLowerCase() === 'true',
      verify_mode: String(process.env.REACT_APP_PRODUCTION_VERIFY_MODE || 'false').toLowerCase() === 'true',
      correlation_id: correlationId,
      runtime: 'vercel',
    });
  }
};
