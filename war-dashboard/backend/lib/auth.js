'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const env = require('../config/env');

const BCRYPT_ROUNDS = 12;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function createAccessToken(payload) {
  return jwt.sign(payload, env.authJwtAccessSecret, {
    expiresIn: env.authJwtAccessExpires,
  });
}

function createRefreshToken(payload) {
  return jwt.sign(payload, env.authJwtRefreshSecret, {
    expiresIn: env.authJwtRefreshExpires,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.authJwtAccessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.authJwtRefreshSecret);
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

module.exports = {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashRefreshToken,
};