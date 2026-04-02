'use strict';

const { query } = require('./db');

async function writeAuditLog({
  actorType = 'system',
  actorId = null,
  action,
  targetType,
  targetId,
  details = {},
  correlationId = null,
}) {
  await query(
    `INSERT INTO audit_logs (actor_type, actor_id, action, target_type, target_id, details_json, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [actorType, actorId, action, targetType, String(targetId ?? ''), JSON.stringify(details), correlationId],
  );
}

module.exports = { writeAuditLog };
