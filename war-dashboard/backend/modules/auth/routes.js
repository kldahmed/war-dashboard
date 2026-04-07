'use strict';

const express = require('express');
const { query } = require('../../lib/db');
const { asyncHandler } = require('../../lib/async-handler');
const {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
  hashRefreshToken,
} = require('../../lib/auth');
const { requireAuth } = require('../../lib/auth-middleware');
const env = require('../../config/env');

const router = express.Router();

function readCookieRefreshToken(req) {
  return req.cookies?.wp_refresh_token || null;
}

function setRefreshCookie(res, token) {
  res.cookie('wp_refresh_token', token, {
    httpOnly: true,
    secure: env.authCookieSecure,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: env.authRefreshMaxAgeMs,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('wp_refresh_token', {
    httpOnly: true,
    secure: env.authCookieSecure,
    sameSite: 'lax',
    path: '/api/auth',
  });
}

function sanitizeUser(row) {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
  };
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) return 'password must be at least 8 characters';
  if (!/[A-Z]/.test(value)) return 'password must include one uppercase letter';
  if (!/[a-z]/.test(value)) return 'password must include one lowercase letter';
  if (!/[0-9]/.test(value)) return 'password must include one number';
  return null;
}

router.post('/auth/signup', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const displayName = String(req.body?.display_name || '').trim();

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'validation_error', details: ['valid email is required'] });
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ error: 'validation_error', details: [passwordError] });
  }

  if (!displayName || displayName.length < 2) {
    return res.status(400).json({ error: 'validation_error', details: ['display_name must be at least 2 characters'] });
  }

  const passwordHash = await hashPassword(password);

  let user;
  try {
    const inserted = await query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1,$2,$3)
       RETURNING id, email, display_name, role`,
      [email, passwordHash, displayName],
    );
    user = inserted.rows[0];
  } catch (error) {
    if (String(error.message).includes('duplicate key value')) {
      return res.status(409).json({ error: 'email_already_exists' });
    }
    throw error;
  }

  const payload = { sub: String(user.id), email: user.email, role: user.role };
  const accessToken = createAccessToken(payload);
  const refreshToken = createRefreshToken(payload);

  await query(
    `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, ip_address, user_agent)
     VALUES ($1,$2, NOW() + ($3 || ' milliseconds')::interval, $4, $5)`,
    [user.id, hashRefreshToken(refreshToken), String(env.authRefreshMaxAgeMs), req.ip || null, req.headers['user-agent'] || null],
  );

  setRefreshCookie(res, refreshToken);

  return res.status(201).json({
    access_token: accessToken,
    user: sanitizeUser(user),
  });
}));

router.post('/auth/signin', asyncHandler(async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');

  const found = await query(
    `SELECT id, email, password_hash, display_name, role, is_active
     FROM users
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [email],
  );

  if (found.rowCount === 0) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const user = found.rows[0];
  if (!user.is_active) {
    return res.status(403).json({ error: 'account_disabled' });
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }

  const payload = { sub: String(user.id), email: user.email, role: user.role };
  const accessToken = createAccessToken(payload);
  const refreshToken = createRefreshToken(payload);

  await query(
    `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, ip_address, user_agent)
     VALUES ($1,$2, NOW() + ($3 || ' milliseconds')::interval, $4, $5)`,
    [user.id, hashRefreshToken(refreshToken), String(env.authRefreshMaxAgeMs), req.ip || null, req.headers['user-agent'] || null],
  );

  setRefreshCookie(res, refreshToken);

  return res.json({
    access_token: accessToken,
    user: sanitizeUser(user),
  });
}));

router.post('/auth/refresh', asyncHandler(async (req, res) => {
  const refreshToken = readCookieRefreshToken(req);
  if (!refreshToken) return res.status(401).json({ error: 'missing_refresh_token' });

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (_err) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'invalid_refresh_token' });
  }

  const refreshHash = hashRefreshToken(refreshToken);
  const sessionRes = await query(
    `SELECT id, user_id, expires_at, revoked_at
     FROM auth_sessions
     WHERE refresh_token_hash = $1
     LIMIT 1`,
    [refreshHash],
  );

  if (sessionRes.rowCount === 0) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'session_not_found' });
  }

  const session = sessionRes.rows[0];
  if (session.revoked_at || new Date(session.expires_at).getTime() < Date.now()) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'session_expired' });
  }

  const userRes = await query(
    `SELECT id, email, display_name, role, is_active
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [session.user_id],
  );

  if (userRes.rowCount === 0 || !userRes.rows[0].is_active) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'user_not_found' });
  }

  await query('UPDATE auth_sessions SET revoked_at = NOW(), updated_at = NOW() WHERE id = $1', [session.id]);

  const user = userRes.rows[0];
  const newPayload = { sub: String(user.id), email: user.email, role: user.role };
  const nextAccessToken = createAccessToken(newPayload);
  const nextRefreshToken = createRefreshToken(newPayload);

  await query(
    `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, ip_address, user_agent)
     VALUES ($1,$2, NOW() + ($3 || ' milliseconds')::interval, $4, $5)`,
    [user.id, hashRefreshToken(nextRefreshToken), String(env.authRefreshMaxAgeMs), req.ip || null, req.headers['user-agent'] || null],
  );

  setRefreshCookie(res, nextRefreshToken);

  return res.json({
    access_token: nextAccessToken,
    user: sanitizeUser(user),
  });
}));

router.post('/auth/logout', asyncHandler(async (req, res) => {
  const refreshToken = readCookieRefreshToken(req);
  if (refreshToken) {
    await query(
      'UPDATE auth_sessions SET revoked_at = NOW(), updated_at = NOW() WHERE refresh_token_hash = $1',
      [hashRefreshToken(refreshToken)],
    );
  }

  clearRefreshCookie(res);
  return res.status(204).send();
}));

router.get('/auth/me', requireAuth, asyncHandler(async (req, res) => {
  const userId = Number(req.auth?.sub || 0);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: 'invalid_token_subject' });
  }

  const found = await query(
    `SELECT id, email, display_name, role, is_active
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId],
  );

  if (found.rowCount === 0 || !found.rows[0].is_active) {
    return res.status(401).json({ error: 'user_not_found' });
  }

  return res.json({ user: sanitizeUser(found.rows[0]) });
}));

module.exports = router;