'use strict';

const express = require('express');
const { asyncHandler } = require('../../lib/async-handler');
const { listPodcastSources, getPodcastFeed } = require('./service');

const router = express.Router();

/* ─────────────────────────────────────────────────────────────────
   GET /api/podcasts/list
   Returns the curated podcast source list
───────────────────────────────────────────────────────────────── */
router.get('/podcasts/list', asyncHandler(async (_req, res) => {
  res.json({ sources: listPodcastSources() });
}));

/* ─────────────────────────────────────────────────────────────────
   GET /api/podcasts/feed?url=<rss_url>
   Server-side RSS proxy — avoids browser CORS issues.
   Only fetches whitelisted URLs.
───────────────────────────────────────────────────────────────── */
router.get('/podcasts/feed', asyncHandler(async (req, res) => {
  const payload = await getPodcastFeed(req.query.url);
  res.json(payload);
}));

module.exports = router;
