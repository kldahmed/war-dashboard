'use strict';

const { randomUUID } = require('node:crypto');

const ESPN_COMPETITIONS = [
  'uefa.champions',
  'uefa.europa',
  'fifa.clubworldcup',
  'eng.1',
  'esp.1',
  'ger.1',
  'ita.1',
  'fra.1',
];

const FEATURED_CLUBS = [
  { id: 'real_madrid', label_ar: 'ريال مدريد', priority: 1, aliases: ['real madrid', 'ريال مدريد'] },
  { id: 'barcelona', label_ar: 'برشلونة', priority: 2, aliases: ['barcelona', 'fc barcelona', 'برشلونة'] },
  { id: 'bayern', label_ar: 'بايرن ميونخ', priority: 3, aliases: ['bayern munich', 'bayern', 'بايرن ميونخ'] },
  { id: 'man_city', label_ar: 'مانشستر سيتي', priority: 4, aliases: ['manchester city', 'man city', 'مانشستر سيتي'] },
  { id: 'liverpool', label_ar: 'ليفربول', priority: 5, aliases: ['liverpool', 'ليفربول'] },
  { id: 'arsenal', label_ar: 'أرسنال', priority: 6, aliases: ['arsenal', 'arsenal fc', 'أرسنال'] },
  { id: 'psg', label_ar: 'باريس سان جيرمان', priority: 7, aliases: ['paris saint germain', 'psg', 'باريس سان جيرمان'] },
  { id: 'inter', label_ar: 'إنتر', priority: 8, aliases: ['inter', 'inter milan', 'إنتر'] },
  { id: 'juventus', label_ar: 'يوفنتوس', priority: 9, aliases: ['juventus', 'يوفنتوس'] },
  { id: 'milan', label_ar: 'ميلان', priority: 10, aliases: ['ac milan', 'milan', 'ميلان'] },
  { id: 'atletico', label_ar: 'أتلتيكو مدريد', priority: 11, aliases: ['atletico madrid', 'atlético de madrid', 'أتلتيكو مدريد'] },
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

function resolveFeaturedClub(name) {
  for (const club of FEATURED_CLUBS) {
    if (includesAny(name, club.aliases)) return club;
  }
  return null;
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

function normalizeState(rawState) {
  const value = String(rawState || '').toLowerCase();
  if (value === 'in' || value === 'pre' || value === 'post') return value;
  if (value === 'status_in_progress') return 'in';
  if (value === 'status_scheduled') return 'pre';
  if (value === 'status_final') return 'post';
  return 'unknown';
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

function extractFeaturedEvents(payload) {
  const out = [];
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

    const homeFeatured = resolveFeaturedClub(homeName);
    const awayFeatured = resolveFeaturedClub(awayName);
    if (!homeFeatured && !awayFeatured) continue;

    const status = comp?.status || event?.status || {};
    const statusType = status?.type || {};
    const homeScore = Number(home?.score);
    const awayScore = Number(away?.score);
    const startIso = comp?.date || event?.date || null;
    const startMs = Number.isFinite(Date.parse(startIso || '')) ? Date.parse(startIso) : Number.MAX_SAFE_INTEGER;

    const featured = [homeFeatured, awayFeatured].filter(Boolean);
    const primaryFeatured = featured.slice().sort((a, b) => a.priority - b.priority)[0] || null;

    out.push({
      eventId: event?.id || null,
      competition: payload?.leagues?.[0]?.name || null,
      state: normalizeState(statusType?.state || status?.state),
      detail: statusType?.shortDetail || statusType?.detail || status?.displayClock || null,
      clockDisplay: status?.displayClock || null,
      period: Number(status?.period) || null,
      clockSeconds: parseClockSeconds(status),
      startedAt: startIso,
      startedAtMs: startMs,
      homeTeam: homeName,
      awayTeam: awayName,
      homeScore: Number.isFinite(homeScore) ? homeScore : 0,
      awayScore: Number.isFinite(awayScore) ? awayScore : 0,
      featured_club_id: primaryFeatured?.id || null,
      featured_club_label: primaryFeatured?.label_ar || null,
      featured_priority: primaryFeatured?.priority || 999,
      source: 'espn',
    });
  }

  return out;
}

function eventRank(event, nowMs) {
  const stateBucket = event.state === 'in' ? 0 : event.state === 'pre' ? 1 : event.state === 'post' ? 2 : 3;
  const priority = Number.isFinite(event.featured_priority) ? event.featured_priority : 999;

  let timeDistance = Number.MAX_SAFE_INTEGER;
  if (Number.isFinite(event.startedAtMs)) {
    if (event.state === 'pre') {
      timeDistance = Math.abs(event.startedAtMs - nowMs);
    } else if (event.state === 'post') {
      timeDistance = Math.abs(nowMs - event.startedAtMs);
    } else {
      timeDistance = 0;
    }
  }

  return [stateBucket, priority, timeDistance];
}

function compareRank(left, right) {
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

function pickBestEvent(events) {
  if (!events.length) return null;
  const nowMs = Date.now();
  const ranked = events
    .map((entry) => ({ entry, rank: eventRank(entry, nowMs) }))
    .sort((a, b) => compareRank(a.rank, b.rank));
  return ranked[0]?.entry || null;
}

module.exports = async function handler(req, res) {
  const correlationId = resolveCorrelationId(req);
  res.setHeader('X-Correlation-Id', correlationId);

  try {
    const fetchedAt = new Date().toISOString();
    const featuredEvents = [];
    const upstreamErrors = [];

    for (const competition of ESPN_COMPETITIONS) {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${competition}/scoreboard`;
        const payload = await fetchJson(url);
        featuredEvents.push(...extractFeaturedEvents(payload));
      } catch (error) {
        upstreamErrors.push(`${competition}:${error.message}`);
      }
    }

    const match = pickBestEvent(featuredEvents);
    if (match) {
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
      homeTeam: 'برشلونة',
      awayTeam: 'TBD',
      detail: upstreamErrors.length
        ? 'بانتظار مباراة برشلونة التالية - تحديث مزود النتائج قيد الاستعادة'
        : 'بانتظار مباراة برشلونة التالية ضمن أهم المباريات العالمية',
      state: 'pre',
      homeScore: 0,
      awayScore: 0,
      featured_club_id: 'barcelona',
      featured_club_label: 'برشلونة',
      source: 'espn',
      provider_warnings: upstreamErrors,
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      match_found: false,
      fetched_at: new Date().toISOString(),
      homeTeam: 'برشلونة',
      awayTeam: 'TBD',
      detail: 'بانتظار مباراة برشلونة التالية - تعذر الوصول المؤقت لمزود النتائج',
      state: 'pre',
      homeScore: 0,
      awayScore: 0,
      featured_club_id: 'barcelona',
      featured_club_label: 'برشلونة',
      source: 'espn',
      error: 'match_score_fetch_failed',
      details: error.message,
      correlation_id: correlationId,
      runtime: 'vercel',
    });
  }
};
