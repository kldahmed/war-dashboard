'use strict';

const { requireAuth, requireRole } = require('../../backend/lib/auth-middleware');
const { getStreamCandidateSnapshot, probeStreamCandidates } = require('../../backend/modules/observability/stream-candidates');

module.exports = function handler(req, res) {
  return requireAuth(req, res, () => requireRole('admin')(req, res, async () => {
    if (req.method === 'POST') {
      const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
      const probe = await probeStreamCandidates(candidates, {
        arabicOnly: true,
        directOnly: true,
      });

      res.status(200).json({
        generated_at: new Date().toISOString(),
        ...probe,
        correlation_id: req.correlationId || null,
        runtime: 'vercel',
      });
      return;
    }

    const snapshot = await getStreamCandidateSnapshot();
    res.status(200).json({
      ...snapshot,
      correlation_id: req.correlationId || null,
      runtime: 'vercel',
    });
  }));
};
