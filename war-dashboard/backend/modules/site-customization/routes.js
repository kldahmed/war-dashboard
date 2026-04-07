'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const { requireAuth, requireRole } = require('../../lib/auth-middleware');
const { getSiteCustomization, saveSiteCustomization } = require('./service');

const router = express.Router();

router.get('/site-customization', asyncHandler(async (req, res) => {
  const snapshot = await getSiteCustomization();
  res.json(snapshot);
}));

router.put('/site-customization', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const snapshot = await saveSiteCustomization(req.body?.customization || req.body || {}, req.auth?.sub || null);
  res.json({ ok: true, ...snapshot });
}));

module.exports = router;