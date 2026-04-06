'use strict';

const https = require('node:https');
const env = require('../../config/env');
const logger = require('../../lib/logger');
const sseHub = require('../../lib/sse-hub');
const { saveSignalSnapshot, publishSignalEvent } = require('../signals/service');

const AV_BASE = 'https://www.alphavantage.co/query';
const TROY_OZ_IN_GRAMS = 31.1034768;

let _snapshot = null;
let _fetchInFlight = false;
let _goldCache = null;
let _goldUpdatedAtMs = 0;
let _oilCache = null;
let _oilUpdatedAtMs = 0;

function avGet(params) {
  const key = env.alphaVantageApiKey;
  if (!key) throw new Error('ALPHAVANTAGE_API_KEY not configured');
  const qs = new URLSearchParams({ ...params, apikey: key }).toString();
  const url = `${AV_BASE}?${qs}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('request_timeout')); });
  });
}

async function fetchGoldSpotUsd() {
  // XAU (troy oz) quoted in USD — available on free tier via currency exchange
  const data = await avGet({ function: 'CURRENCY_EXCHANGE_RATE', from_currency: 'XAU', to_currency: 'USD' });
  const rate = data['Realtime Currency Exchange Rate'];
  if (!rate || !rate['5. Exchange Rate']) throw new Error('Unexpected AV gold response');
  return parseFloat(rate['5. Exchange Rate']);
}

async function fetchFxUsdAed() {
  const data = await avGet({ function: 'CURRENCY_EXCHANGE_RATE', from_currency: 'USD', to_currency: 'AED' });
  const rate = data['Realtime Currency Exchange Rate'];
  if (!rate || !rate['5. Exchange Rate']) throw new Error('Unexpected AV FX response');
  return parseFloat(rate['5. Exchange Rate']);
}

async function fetchOilBenchmark(avFunction, label) {
  const data = await avGet({ function: avFunction, interval: 'daily' });
  const series = data.data;
  if (!Array.isArray(series) || series.length < 2) {
    throw new Error(`Unexpected AV ${avFunction} response`);
  }
  // series[0] is most recent
  const latest = series.find((e) => e.value && e.value !== '.');
  const prevIdx = series.indexOf(latest) + 1;
  const prev = series[prevIdx];

  const price = parseFloat(latest.value);
  const prevPrice = prev ? parseFloat(prev.value) : price;
  const change = +(price - prevPrice).toFixed(2);
  const change_pct = prevPrice !== 0 ? +((change / prevPrice) * 100).toFixed(2) : 0;

  return {
    symbol: avFunction,
    label,
    price: +price.toFixed(2),
    change,
    change_pct,
    unit: 'USD/bbl',
    date: latest.date,
  };
}

function deriveGoldAedGrams(spotUsdOz, fxUsdAed) {
  const k24 = (spotUsdOz * fxUsdAed) / TROY_OZ_IN_GRAMS;
  return {
    k24: +k24.toFixed(2),
    k22: +(k24 * (22 / 24)).toFixed(2),
    k21: +(k24 * (21 / 24)).toFixed(2),
    k18: +(k24 * (18 / 24)).toFixed(2),
  };
}

function isFresh(updatedAtMs, ttlMs) {
  return updatedAtMs > 0 && (Date.now() - updatedAtMs) < ttlMs;
}

async function refreshGold(nowIso) {
  const [goldRes, fxRes] = await Promise.allSettled([
    fetchGoldSpotUsd(),
    fetchFxUsdAed(),
  ]);

  if (goldRes.status === 'fulfilled' && fxRes.status === 'fulfilled') {
    const spotUsdOz = goldRes.value;
    const fxUsdAed = fxRes.value;
    _goldCache = {
      provider: 'AlphaVantage',
      spot_usd_oz: +spotUsdOz.toFixed(2),
      fx_usd_aed: +fxUsdAed.toFixed(4),
      derived_aed_gram: deriveGoldAedGrams(spotUsdOz, fxUsdAed),
      mode_label: 'سعر مشتق مرجعي',
      updated_at: nowIso,
    };
    _goldUpdatedAtMs = Date.now();
    return true;
  }

  logger.warn('markets_gold_fetch_failed', {
    goldErr: goldRes.reason?.message,
    fxErr: fxRes.reason?.message,
  });
  return false;
}

async function refreshOil(nowIso) {
  const [brentRes, wtiRes] = await Promise.allSettled([
    fetchOilBenchmark('BRENT', 'برنت'),
    fetchOilBenchmark('WTI', 'WTI'),
  ]);

  const benchmarks = [];
  if (brentRes.status === 'fulfilled') benchmarks.push(brentRes.value);
  else logger.warn('markets_brent_failed', { error: brentRes.reason?.message });
  if (wtiRes.status === 'fulfilled') benchmarks.push(wtiRes.value);
  else logger.warn('markets_wti_failed', { error: wtiRes.reason?.message });

  if (benchmarks.length > 0) {
    _oilCache = {
      provider: 'AlphaVantage',
      updated_at: nowIso,
      benchmarks,
    };
    _oilUpdatedAtMs = Date.now();
    return true;
  }

  return false;
}

async function refreshMarkets(options = {}) {
  const { forceGold = false, forceOil = false } = options;
  if (_fetchInFlight) return;
  _fetchInFlight = true;
  try {
    const now = new Date().toISOString();
    const hadSnapshot = !!_snapshot;
    const shouldRefreshGold = forceGold || !isFresh(_goldUpdatedAtMs, env.marketsGoldScheduleMs);
    const shouldRefreshOil = forceOil || !isFresh(_oilUpdatedAtMs, env.marketsOilScheduleMs);

    let refreshedGold = false;
    let refreshedOil = false;
    if (shouldRefreshGold) refreshedGold = await refreshGold(now);
    if (shouldRefreshOil) refreshedOil = await refreshOil(now);

    if (_goldCache || _oilCache) {
      _snapshot = {
        updated_at: now,
        gold: _goldCache,
        oil: _oilCache || { provider: 'AlphaVantage', updated_at: now, benchmarks: [] },
      };

      if (refreshedGold || refreshedOil || !hadSnapshot) {
        logger.info('markets_refreshed', {
          gold_refreshed: refreshedGold,
          oil_refreshed: refreshedOil,
          oil_benchmarks: _oilCache?.benchmarks?.length || 0,
        });

        const eventPayload = { available: true, data: _snapshot };
        sseHub.broadcast('markets', eventPayload);
        await saveSignalSnapshot('markets', eventPayload);
        await publishSignalEvent('markets', eventPayload);
      }
    }
  } catch (err) {
    logger.error('markets_refresh_failed', { error: err.message });
  } finally {
    _fetchInFlight = false;
  }
}

function getSnapshot() {
  return _snapshot;
}

module.exports = { refreshMarkets, getSnapshot };
