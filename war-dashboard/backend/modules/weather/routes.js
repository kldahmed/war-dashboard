'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const env = require('../../config/env');
const { getSnapshot, refreshWeather } = require('./service');

const router = express.Router();

router.get('/weather/uae', asyncHandler(async (_req, res) => {
  if (!env.weatherApiKey) {
    return res.status(404).json({
      error: 'weather_not_configured',
      message: 'Set WEATHER_API_KEY to enable this service.',
    });
  }

  let snapshot = getSnapshot();
  if (!snapshot) {
    // First request warm-up: fetch immediately instead of waiting for scheduler.
    await Promise.race([
      refreshWeather(),
      new Promise((resolve) => setTimeout(resolve, 9000)),
    ]);
    snapshot = getSnapshot();
  }

  if (!snapshot) {
    return res.status(503).json({
      error: 'weather_not_ready',
      message: 'Weather warm-up in progress. Retry in a few seconds.',
    });
  }

  res.json(snapshot);
}));

module.exports = router;
