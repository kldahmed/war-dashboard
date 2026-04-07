'use strict';

const { requireAuth, requireRole } = require('../../backend/lib/auth-middleware');
const { getProductKpiSnapshot } = require('../../backend/modules/observability/product-kpi');

module.exports = function handler(req, res) {
  return requireAuth(req, res, () => requireRole('admin')(req, res, async () => {
    const snapshot = await getProductKpiSnapshot();

    res.status(200).json({
      ...snapshot,
      correlation_id: req.correlationId || null,
      runtime: 'vercel',
    });
  }));
};
