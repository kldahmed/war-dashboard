'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const env = require('../../config/env');
const sseHub = require('../../lib/sse-hub');
const logger = require('../../lib/logger');
const { requireAuth } = require('../../lib/auth-middleware');
const { getSnapshot: getWeatherSnapshot, refreshWeather } = require('../weather/service');
const { getSnapshot: getMarketsSnapshot, refreshMarkets } = require('../markets/service');
const { loadSignalSnapshot } = require('./service');

const router = express.Router();

const PING_MS = 25_000;

/**
 * Build the two initial event payloads for a newly-connected client.
 */
async function buildInitialPayloads() {
  const [weatherDbSnap, marketsDbSnap] = await Promise.all([
    loadSignalSnapshot('weather'),
    loadSignalSnapshot('markets'),
  ]);
  const weatherSnap = weatherDbSnap?.payload || getWeatherSnapshot();
  const marketsSnap = marketsDbSnap?.payload || getMarketsSnapshot();

  const weather = weatherSnap
    ? weatherSnap
    : { available: !!env.weatherApiKey, data: null, reason: env.weatherApiKey ? 'not_ready' : 'not_configured' };

  const markets = marketsSnap
    ? marketsSnap
    : { available: !!env.alphaVantageApiKey, data: null, reason: env.alphaVantageApiKey ? 'not_ready' : 'not_configured' };

  return { weather, markets };
}

/**
 * GET /api/signals/stream
 * Server-Sent Events stream — pushes weather & markets updates in real-time.
 * The browser's EventSource API automatically reconnects on drop.
 */
router.get('/signals/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  // Send current snapshots right away so the UI populates immediately
  const { weather, markets } = await buildInitialPayloads();
  res.write(`event: weather\ndata: ${JSON.stringify(weather)}\n\n`);
  res.write(`event: markets\ndata: ${JSON.stringify(markets)}\n\n`);

  const unsubscribe = sseHub.addClient(res);
  logger.info('sse_client_connected', { clients: sseHub.clientCount(), correlationId: req.correlationId });

  // Heartbeat keeps the connection alive through proxies / load-balancers
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); }
    catch { clearInterval(ping); unsubscribe(); }
  }, PING_MS);

  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
    logger.info('sse_client_disconnected', { clients: sseHub.clientCount() });
  });
});

/**
 * POST /api/signals/refresh
 * Trigger an immediate out-of-schedule refresh of both weather and markets.
 * The new data is pushed to all SSE clients automatically via the hub.
 */
router.post('/signals/refresh', requireAuth, async (req, res) => {
  const correlationId = req.correlationId || randomUUID();
  logger.info('signals_manual_refresh', { correlationId });

  // Fire immediately — do not await (let SSE push when each finishes)
  Promise.all([
    refreshWeather().catch((e) => logger.warn('signals_refresh_weather_failed', { error: e.message })),
    refreshMarkets().catch((e) => logger.warn('signals_refresh_markets_failed', { error: e.message })),
  ]);

  res.json({ ok: true, message: 'refresh_triggered', correlationId });
});

module.exports = router;
