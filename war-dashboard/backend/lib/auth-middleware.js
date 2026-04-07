'use strict';

const { verifyAccessToken } = require('./auth');

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

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

function requireRole(...allowedRoles) {
  const normalizedAllowed = new Set(allowedRoles.map(normalizeRole).filter(Boolean));

  return function roleGuard(req, res, next) {
    const role = normalizeRole(req.auth?.role);

    if (!role) {
      return res.status(403).json({ error: 'forbidden', detail: 'missing_role' });
    }

    if (!normalizedAllowed.has(role)) {
      return res.status(403).json({ error: 'forbidden', detail: 'insufficient_role' });
    }

    return next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
};