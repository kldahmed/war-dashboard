'use strict';

const express = require('express');
const { correlationMiddleware } = require('../lib/correlation');
const logger = require('../lib/logger');
const metrics = require('../lib/metrics');

const sourcesRoutes = require('../modules/sources/routes');
const ingestionRoutes = require('../modules/ingestion/routes');
const newsFeedRoutes = require('../modules/news-feed/routes');
const observabilityRoutes = require('../modules/observability/routes');
const intelligenceRoutes = require('../modules/intelligence/routes');
const legacyClaudeHandler = require('../../api/claude');

function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(correlationMiddleware);

  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const elapsedNs = process.hrtime.bigint() - started;
      const latencyMs = Number(elapsedNs / 1000000n);
      const isError = res.statusCode >= 400;
      metrics.recordRequest(latencyMs, isError);
      logger.info('http_request', {
        correlationId: req.correlationId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        latencyMs,
      });
    });
    next();
  });

  // Legacy path remains available as fallback.
  app.post('/api/claude', legacyClaudeHandler);

  app.use('/api', observabilityRoutes);
  app.use('/api', intelligenceRoutes);
  app.use('/api', sourcesRoutes);
  app.use('/api', ingestionRoutes);
  app.use('/api', newsFeedRoutes);

  app.use((err, req, res, _next) => {
    logger.error('http_error', {
      correlationId: req.correlationId,
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
    res.status(500).json({ error: 'internal_server_error', correlation_id: req.correlationId });
  });

  return app;
}

module.exports = createApp;
