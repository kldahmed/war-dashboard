'use strict';

const { requireAuth, requireRole } = require('../backend/lib/auth-middleware');
const { getSiteCustomization, saveSiteCustomization } = require('../backend/modules/site-customization/service');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const snapshot = await getSiteCustomization();
    return res.status(200).json({ ...snapshot, runtime: 'vercel' });
  }

  if (req.method === 'PUT') {
    return requireAuth(req, res, () => requireRole('admin')(req, res, async () => {
      const snapshot = await saveSiteCustomization(req.body?.customization || req.body || {}, req.auth?.sub || null);
      res.status(200).json({ ok: true, ...snapshot, runtime: 'vercel' });
    }));
  }

  res.setHeader('Allow', 'GET, PUT');
  return res.status(405).json({ error: 'method_not_allowed' });
};