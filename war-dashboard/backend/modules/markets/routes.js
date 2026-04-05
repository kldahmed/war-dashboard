'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const env = require('../../config/env');
const { getSnapshot } = require('./service');

const router = express.Router();

router.get('/markets/uae', asyncHandler(async (_req, res) => {
  if (!env.alphaVantageApiKey) {
    return res.status(404).json({
      error: 'markets_not_configured',
      message: 'Set ALPHAVANTAGE_API_KEY to enable this service.',
    });
  }

  const snapshot = getSnapshot();
  if (!snapshot) {
    return res.status(503).json({
      error: 'markets_not_ready',
      message: 'Markets data not yet available. Try again in a moment.',
    });
  }

  res.json(snapshot);
}));

module.exports = router;
