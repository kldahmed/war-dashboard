'use strict';

const express = require('express');
const { asyncHandler }    = require('../../lib/async-handler');
const { getLatestSitrep } = require('./service');

const router = express.Router();

router.get('/intelligence/latest', asyncHandler(async (req, res) => {
  const digest = await getLatestSitrep();
  if (!digest) {
    return res.status(204).end();   // no digest yet — frontend handles gracefully
  }
  res.json({
    ...digest,
    correlation_id: req.correlationId || null,
  });
}));

module.exports = router;
