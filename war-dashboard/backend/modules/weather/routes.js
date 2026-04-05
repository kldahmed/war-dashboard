'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const env = require('../../config/env');
const { getSnapshot } = require('./service');

const router = express.Router();

router.get('/weather/uae', asyncHandler(async (_req, res) => {
  if (!env.weatherApiKey) {
    return res.status(404).json({
      error: 'weather_not_configured',
      message: 'Set WEATHER_API_KEY to enable this service.',
    });
  }

  const snapshot = getSnapshot();
  if (!snapshot) {
    return res.status(503).json({
      error: 'weather_not_ready',
      message: 'Weather data not yet available. Try again in a moment.',
    });
  }

  res.json(snapshot);
}));

module.exports = router;
