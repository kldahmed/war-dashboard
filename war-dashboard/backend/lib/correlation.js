'use strict';

const { randomUUID } = require('node:crypto');

function correlationMiddleware(req, res, next) {
  const incoming = req.headers['x-correlation-id'];
  const correlationId = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);
  next();
}

module.exports = { correlationMiddleware };
