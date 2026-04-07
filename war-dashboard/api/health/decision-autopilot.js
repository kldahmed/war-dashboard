'use strict';

const { requireAuth, requireRole } = require('../../backend/lib/auth-middleware');
const { getDecisionAutopilotSnapshot } = require('../../backend/modules/observability/decision-autopilot');

module.exports = function handler(req, res) {
  return requireAuth(req, res, () => requireRole('admin')(req, res, async () => {
    const snapshot = await getDecisionAutopilotSnapshot();

    res.status(200).json({
      ...snapshot,
      correlation_id: req.correlationId || null,
      runtime: 'vercel',
    });
  }));
};
