'use strict';

const { query } = require('../../lib/db');
const logger = require('../../lib/logger');

const CHANNEL = 'signals_updates';
const SIGNAL_THRESHOLDS_MS = {
  weatherWarning: 90_000,
  weatherCritical: 180_000,
  marketsWarning: 180_000,
  marketsCritical: 600_000,
};

function classifyAge(ageMs, warningMs, criticalMs) {
  if (ageMs == null) return 'red';
  if (ageMs > criticalMs) return 'red';
  if (ageMs > warningMs) return 'yellow';
  return 'green';
}

function composeAlerts(weatherAgeMs, marketsAgeMs) {
  const alerts = [];
  const weatherState = classifyAge(
    weatherAgeMs,
    SIGNAL_THRESHOLDS_MS.weatherWarning,
    SIGNAL_THRESHOLDS_MS.weatherCritical,
  );
  const marketsState = classifyAge(
    marketsAgeMs,
    SIGNAL_THRESHOLDS_MS.marketsWarning,
    SIGNAL_THRESHOLDS_MS.marketsCritical,
  );

  if (weatherState === 'red') {
    alerts.push({ severity: 'critical', code: 'weather_stale', message: 'Weather signal stale or missing' });
  } else if (weatherState === 'yellow') {
    alerts.push({ severity: 'warning', code: 'weather_slow', message: 'Weather updates are delayed' });
  }

  if (marketsState === 'red') {
    alerts.push({ severity: 'critical', code: 'markets_stale', message: 'Markets signal stale or missing' });
  } else if (marketsState === 'yellow') {
    alerts.push({ severity: 'warning', code: 'markets_slow', message: 'Markets updates are delayed' });
  }

  if (alerts.length === 0) {
    alerts.push({ severity: 'ok', code: 'signals_live', message: 'Signals are live and fresh' });
  }

  const overall = alerts.some((a) => a.severity === 'critical')
    ? 'red'
    : alerts.some((a) => a.severity === 'warning')
      ? 'yellow'
      : 'green';

  return { overall, alerts };
}

async function saveSignalSnapshot(name, payload) {
  try {
    await query(
      `INSERT INTO signal_snapshots (name, payload_json, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (name)
       DO UPDATE SET payload_json = EXCLUDED.payload_json, updated_at = NOW()`,
      [name, JSON.stringify(payload)],
    );
  } catch (error) {
    // Migration may not be applied yet; keep runtime functional.
    if (error?.code !== '42P01') {
      logger.warn('signal_snapshot_save_failed', { name, error: error.message });
    }
  }
}

async function loadSignalSnapshot(name) {
  try {
    const result = await query(
      `SELECT payload_json, updated_at
       FROM signal_snapshots
       WHERE name = $1`,
      [name],
    );
    if (result.rowCount === 0) return null;
    return {
      payload: result.rows[0].payload_json,
      updatedAt: result.rows[0].updated_at,
    };
  } catch (error) {
    if (error?.code !== '42P01') {
      logger.warn('signal_snapshot_load_failed', { name, error: error.message });
    }
    return null;
  }
}

async function publishSignalEvent(name, payload) {
  try {
    await query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ name, payload })]);
  } catch (error) {
    logger.warn('signal_notify_failed', { name, error: error.message });
  }
}

async function getSignalsHealth() {
  try {
    const result = await query(
      `SELECT
         MAX(CASE WHEN name = 'weather' THEN updated_at END) AS weather_updated_at,
         MAX(CASE WHEN name = 'markets' THEN updated_at END) AS markets_updated_at
       FROM signal_snapshots`,
    );

    const row = result.rows[0] || {};
    const nowMs = Date.now();
    const weatherAgeMs = row.weather_updated_at ? Math.max(0, nowMs - new Date(row.weather_updated_at).getTime()) : null;
    const marketsAgeMs = row.markets_updated_at ? Math.max(0, nowMs - new Date(row.markets_updated_at).getTime()) : null;
    const weatherStatus = classifyAge(
      weatherAgeMs,
      SIGNAL_THRESHOLDS_MS.weatherWarning,
      SIGNAL_THRESHOLDS_MS.weatherCritical,
    );
    const marketsStatus = classifyAge(
      marketsAgeMs,
      SIGNAL_THRESHOLDS_MS.marketsWarning,
      SIGNAL_THRESHOLDS_MS.marketsCritical,
    );
    const summary = composeAlerts(weatherAgeMs, marketsAgeMs);

    return {
      channel: CHANNEL,
      weather_updated_at: row.weather_updated_at || null,
      weather_age_ms: weatherAgeMs,
      weather_status: weatherStatus,
      markets_updated_at: row.markets_updated_at || null,
      markets_age_ms: marketsAgeMs,
      markets_status: marketsStatus,
      overall_status: summary.overall,
      alerts: summary.alerts,
      thresholds_ms: SIGNAL_THRESHOLDS_MS,
    };
  } catch (error) {
    if (error?.code === '42P01') {
      return {
        channel: CHANNEL,
        weather_updated_at: null,
        weather_age_ms: null,
        weather_status: 'red',
        markets_updated_at: null,
        markets_age_ms: null,
        markets_status: 'red',
        overall_status: 'red',
        alerts: [{ severity: 'critical', code: 'signals_table_missing', message: 'Signals snapshot table is missing' }],
        thresholds_ms: SIGNAL_THRESHOLDS_MS,
      };
    }
    logger.warn('signals_health_failed', { error: error.message });
    return {
      channel: CHANNEL,
      weather_updated_at: null,
      weather_age_ms: null,
      weather_status: 'red',
      markets_updated_at: null,
      markets_age_ms: null,
      markets_status: 'red',
      overall_status: 'red',
      alerts: [{ severity: 'critical', code: 'signals_health_failed', message: 'Unable to evaluate signals health' }],
      thresholds_ms: SIGNAL_THRESHOLDS_MS,
      error: error.message,
    };
  }
}

module.exports = {
  CHANNEL,
  saveSignalSnapshot,
  loadSignalSnapshot,
  publishSignalEvent,
  getSignalsHealth,
};
