'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const env = require('../../config/env');
const { getSnapshot, refreshMarkets } = require('./service');

const router = express.Router();

router.get('/markets/uae', asyncHandler(async (_req, res) => {
  if (!env.alphaVantageApiKey) {
    return res.status(404).json({
      error: 'markets_not_configured',
      message: 'Set ALPHAVANTAGE_API_KEY to enable this service.',
    });
  }

  let snapshot = getSnapshot();
  if (!snapshot) {
    // First request warm-up: fetch now so UI does not stay empty.
    await Promise.race([
      refreshMarkets(),
      new Promise((resolve) => setTimeout(resolve, 9000)),
    ]);
    snapshot = getSnapshot();
  }

  if (!snapshot) {
    return res.status(503).json({
      error: 'markets_not_ready',
      message: 'Markets warm-up in progress. Retry in a few seconds.',
    });
  }

  res.json(snapshot);
}));

module.exports = router;
