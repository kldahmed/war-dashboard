'use strict';

const { verifyAccessToken } = require('./auth');

function getBearerToken(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.auth = payload;
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

module.exports = {
  requireAuth,
};