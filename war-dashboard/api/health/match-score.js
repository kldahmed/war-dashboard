'use strict';

const { randomUUID } = require('node:crypto');

const TARGET_HOME = ['real madrid', 'ريال مدريد'];
const TARGET_AWAY = ['bayern munich', 'bayern', 'بايرن ميونخ'];
const ESPN_COMPETITIONS = [
  'uefa.champions',
  'fifa.clubworldcup',
  'esp.1',
  'ger.1',
];

function resolveCorrelationId(req) {
  const incoming = req.headers['x-correlation-id'];
  return typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesAny(text, needles) {
  const normalized = normalize(text);
  return needles.some((needle) => normalized.includes(normalize(needle)));
}

function teamMatches(name, aliases) {
  return includesAny(name, aliases);
}

function parseClockSeconds(status) {
  const direct = Number(status?.clock);
  if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);

  const display = String(status?.displayClock || '').trim();
  const match = display.match(/^(\d{1,3}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return (minutes * 60) + seconds;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);
  try {
    const upstream = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'war-dashboard/1.0' } });
    if (!upstream.ok) {
      throw new Error(`upstream_${upstream.status}`);
    }
    return upstream.json();
  } finally {
    clearTimeout(timeout);
  }
}

function extractMatchEvent(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  for (const event of events) {
    const comps = Array.isArray(event?.competitions) ? event.competitions : [];
    const comp = comps[0] || {};
    const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];

    const home = competitors.find((entry) => String(entry?.homeAway || '').toLowerCase() === 'home') || competitors[0];
    const away = competitors.find((entry) => String(entry?.homeAway || '').toLowerCase() === 'away') || competitors[1];
    if (!home || !away) continue;

    const homeName = home?.team?.displayName || home?.team?.shortDisplayName || '';
    const awayName = away?.team?.displayName || away?.team?.shortDisplayName || '';

    const directOrder = teamMatches(homeName, TARGET_HOME) && teamMatches(awayName, TARGET_AWAY);
    const reverseOrder = teamMatches(homeName, TARGET_AWAY) && teamMatches(awayName, TARGET_HOME);
    if (!directOrder && !reverseOrder) continue;

    const status = comp?.status || event?.status || {};
    const statusType = status?.type || {};
    const homeScore = Number(home?.score);
    const awayScore = Number(away?.score);

    return {
      eventId: event?.id || null,
      competition: payload?.leagues?.[0]?.name || null,
      state: String(statusType?.state || 'unknown').toLowerCase(),
      detail: statusType?.shortDetail || statusType?.detail || status?.displayClock || null,
      clockDisplay: status?.displayClock || null,
      period: Number(status?.period) || null,
      clockSeconds: parseClockSeconds(status),
      startedAt: comp?.date || event?.date || null,
      homeTeam: reverseOrder ? awayName : homeName,
      awayTeam: reverseOrder ? homeName : awayName,
      homeScore: Number.isFinite(homeScore) ? homeScore : 0,
      awayScore: Number.isFinite(awayScore) ? awayScore : 0,
      source: 'espn',
    };
  }

  return null;
}

module.exports = async function handler(req, res) {
  const correlationId = resolveCorrelationId(req);
  res.setHeader('X-Correlation-Id', correlationId);

  try {
    const fetchedAt = new Date().toISOString();

    for (const competition of ESPN_COMPETITIONS) {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${competition}/scoreboard`;
      const payload = await fetchJson(url);
      const match = extractMatchEvent(payload);
      if (!match) continue;

      return res.status(200).json({
        ok: true,
        match_found: true,
        fetched_at: fetchedAt,
        correlation_id: correlationId,
        runtime: 'vercel',
        ...match,
      });
    }

    return res.status(200).json({
      ok: true,
      match_found: false,
      fetched_at: fetchedAt,
      correlation_id: correlationId,
      runtime: 'vercel',
      homeTeam: 'ريال مدريد',
      awayTeam: 'بايرن ميونخ',
      detail: 'لا توجد مباراة مباشرة حالياً',
      state: 'post',
      homeScore: 0,
      awayScore: 0,
      source: 'espn',
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: 'match_score_fetch_failed',
      details: error.message,
      correlation_id: correlationId,
      runtime: 'vercel',
    });
  }
};
