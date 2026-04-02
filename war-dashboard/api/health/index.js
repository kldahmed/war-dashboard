'use strict';

const { query } = require('../../backend/lib/db');

module.exports = async function handler(_req, res) {
  try {
    const db = await query('SELECT 1 AS ok');
    return res.status(200).json({
      status: 'ok',
      db: db.rows[0]?.ok === 1,
      time: new Date().toISOString(),
      runtime: 'vercel',
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      error: 'health_check_failed',
      details: error.message,
      runtime: 'vercel',
    });
  }
};
