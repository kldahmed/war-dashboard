'use strict';

const crypto = require('node:crypto');
const { query } = require('../../lib/db');
const {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
  hashRefreshToken,
} = require('../../lib/auth');
const env = require('../../config/env');
const { requireAuth } = require('../../lib/auth-middleware');

function parseCookies(req) {
  const raw = String(req.headers?.cookie || '');
  if (!raw) return {};

  return raw.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function getCookies(req) {
  return req.cookies || parseCookies(req);
}

function appendSetCookie(res, value) {
  const current = res.getHeader ? res.getHeader('Set-Cookie') : undefined;
  if (!current) {
    res.setHeader('Set-Cookie', value);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, value]);
    return;
  }
  res.setHeader('Set-Cookie', [current, value]);
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  return parts.join('; ');
}

function setRefreshCookie(res, token) {
  const cookieValue = serializeCookie('wp_refresh_token', token, {
    httpOnly: true,
    secure: env.authCookieSecure,
    sameSite: 'Lax',
    path: '/api/auth',
    maxAge: env.authRefreshMaxAgeMs,
  });

  if (typeof res.cookie === 'function') {
    res.cookie('wp_refresh_token', token, {
      httpOnly: true,
      secure: env.authCookieSecure,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: env.authRefreshMaxAgeMs,
    });
    return;
  }

  appendSetCookie(res, cookieValue);
}

function clearRefreshCookie(res) {
  const cookieValue = serializeCookie('wp_refresh_token', '', {
    httpOnly: true,
    secure: env.authCookieSecure,
    sameSite: 'Lax',
    path: '/api/auth',
    maxAge: 0,
    expires: new Date(0),
  });

  if (typeof res.clearCookie === 'function') {
    res.clearCookie('wp_refresh_token', {
      httpOnly: true,
      secure: env.authCookieSecure,
      sameSite: 'lax',
      path: '/api/auth',
    });
    return;
  }

  appendSetCookie(res, cookieValue);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
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

function createPasswordResetToken() {
  return crypto.randomBytes(24).toString('hex');
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

async function createSession(req, user) {
  const payload = { sub: String(user.id), email: user.email, role: user.role };
  const accessToken = createAccessToken(payload);
  const refreshToken = createRefreshToken(payload);

  await query(
    `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, ip_address, user_agent)
     VALUES ($1,$2, NOW() + make_interval(secs => $3), $4, $5)`,
    [
      user.id,
      hashRefreshToken(refreshToken),
      Math.floor(env.authRefreshMaxAgeMs / 1000),
      req.headers?.['x-forwarded-for'] || req.ip || null,
      req.headers?.['user-agent'] || null,
    ],
  );

  return { accessToken, refreshToken };
}

function withApiPrelude(handler, allowedMethod) {
  return async function authHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method !== allowedMethod) {
      res.statusCode = 405;
      res.setHeader('Allow', `${allowedMethod}, OPTIONS`);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    return handler(req, res);
  };
}

const signup = withApiPrelude(async (req, res) => {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (_error) {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const email = normalizeEmail(body?.email);
  const password = String(body?.password || '');
  const displayName = String(body?.display_name || '').trim();

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

  const session = await createSession(req, user);
  setRefreshCookie(res, session.refreshToken);
  return res.status(201).json({ access_token: session.accessToken, user: sanitizeUser(user) });
}, 'POST');

const signin = withApiPrelude(async (req, res) => {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (_error) {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const email = normalizeEmail(body?.email);
  const password = String(body?.password || '');

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

  const session = await createSession(req, user);
  setRefreshCookie(res, session.refreshToken);
  return res.json({ access_token: session.accessToken, user: sanitizeUser(user) });
}, 'POST');

const forgotPassword = withApiPrelude(async (req, res) => {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (_error) {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const email = normalizeEmail(body?.email);
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'validation_error', details: ['valid email is required'] });
  }

  const userRes = await query(
    `SELECT id, email, is_active
     FROM users
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [email],
  );

  if (userRes.rowCount === 0 || !userRes.rows[0].is_active) {
    return res.json({ ok: true, message: 'if_account_exists_reset_link_sent' });
  }

  const user = userRes.rows[0];
  const resetToken = createPasswordResetToken();
  const tokenHash = hashPasswordResetToken(resetToken);

  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + make_interval(mins => $3))`,
    [user.id, tokenHash, env.authResetTokenMinutes],
  );

  const payload = {
    ok: true,
    message: 'if_account_exists_reset_link_sent',
  };

  if (env.nodeEnv !== 'production') {
    payload.reset_token = resetToken;
    payload.expires_in_minutes = env.authResetTokenMinutes;
  }

  return res.json(payload);
}, 'POST');

const resetPassword = withApiPrelude(async (req, res) => {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (_error) {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const resetToken = String(body?.token || '').trim();
  const newPassword = String(body?.new_password || '');
  const passwordError = validatePassword(newPassword);

  if (!resetToken) {
    return res.status(400).json({ error: 'validation_error', details: ['token is required'] });
  }

  if (passwordError) {
    return res.status(400).json({ error: 'validation_error', details: [passwordError] });
  }

  const tokenHash = hashPasswordResetToken(resetToken);
  const tokenRes = await query(
    `SELECT id, user_id, expires_at, used_at
     FROM password_reset_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );

  if (tokenRes.rowCount === 0) {
    return res.status(400).json({ error: 'invalid_or_expired_reset_token' });
  }

  const row = tokenRes.rows[0];
  if (row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'invalid_or_expired_reset_token' });
  }

  const passwordHash = await hashPassword(newPassword);

  await query(
    `UPDATE users
     SET password_hash = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [passwordHash, row.user_id],
  );

  await query(
    `UPDATE password_reset_tokens
     SET used_at = NOW()
     WHERE id = $1`,
    [row.id],
  );

  await query(
    `UPDATE auth_sessions
     SET revoked_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [row.user_id],
  );

  clearRefreshCookie(res);

  return res.json({ ok: true, message: 'password_reset_success' });
}, 'POST');

const refresh = withApiPrelude(async (req, res) => {
  const refreshToken = getCookies(req)?.wp_refresh_token || null;
  if (!refreshToken) return res.status(401).json({ error: 'missing_refresh_token' });

  try {
    verifyRefreshToken(refreshToken);
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
  const nextSession = await createSession(req, user);
  setRefreshCookie(res, nextSession.refreshToken);
  return res.json({ access_token: nextSession.accessToken, user: sanitizeUser(user) });
}, 'POST');

const logout = withApiPrelude(async (req, res) => {
  const refreshToken = getCookies(req)?.wp_refresh_token || null;
  if (refreshToken) {
    await query(
      'UPDATE auth_sessions SET revoked_at = NOW(), updated_at = NOW() WHERE refresh_token_hash = $1',
      [hashRefreshToken(refreshToken)],
    );
  }
  clearRefreshCookie(res);
  return res.status(204).send();
}, 'POST');

const me = async function meHandler(req, res) {
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
};

function meWithAuth(req, res, next) {
  return requireAuth(req, res, () => me(req, res, next));
}

module.exports = {
  signup,
  signin,
  forgotPassword,
  resetPassword,
  refresh,
  logout,
  me,
  meWithAuth,
};