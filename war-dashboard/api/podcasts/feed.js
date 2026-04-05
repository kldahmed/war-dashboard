'use strict';

const { getPodcastFeed } = require('../../backend/modules/podcasts/service');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const payload = await getPodcastFeed(req.query?.url);
    return res.status(200).json({ ...payload, runtime: 'vercel' });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: error.code || 'podcast_feed_error',
      message: error.message || 'Failed to load podcast feed',
      runtime: 'vercel',
    });
  }
};
