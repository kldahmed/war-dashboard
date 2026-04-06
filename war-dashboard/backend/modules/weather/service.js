'use strict';

const https = require('node:https');
const env = require('../../config/env');
const logger = require('../../lib/logger');
const sseHub = require('../../lib/sse-hub');
const { saveSignalSnapshot, publishSignalEvent } = require('../signals/service');

const UAE_CITIES = [
  { id: 'dubai',    name: 'دبي',         lat: 25.2048, lon: 55.2708 },
  { id: 'abudhabi', name: 'أبوظبي',      lat: 24.4539, lon: 54.3773 },
  { id: 'sharjah',  name: 'الشارقة',     lat: 25.3463, lon: 55.4209 },
  { id: 'ajman',    name: 'عجمان',       lat: 25.4052, lon: 55.5136 },
  { id: 'rak',      name: 'رأس الخيمة',  lat: 25.7895, lon: 55.9432 },
  { id: 'fujairah', name: 'الفجيرة',     lat: 25.1288, lon: 56.3265 },
  { id: 'alain',    name: 'العين',       lat: 24.1302, lon: 55.8023 },
  { id: 'uaq',      name: 'أم القيوين',  lat: 25.5647, lon: 55.5554 },
];

let _snapshot = null;
let _fetchInFlight = false;

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('request_timeout')); });
  });
}

function hourLabel(timeStr) {
  // timeStr like "2024-04-06 15:00"
  const parts = (timeStr || '').split(' ');
  if (parts.length < 2) return timeStr;
  const [h] = parts[1].split(':');
  const hour = parseInt(h, 10);
  if (Number.isNaN(hour)) return parts[1];
  const h12 = hour % 12 || 12;
  return `${h12}${hour >= 12 ? 'م' : 'ص'}`;
}

function parseHourClock(timeStr) {
  const parts = (timeStr || '').split(' ');
  return parts.length >= 2 ? parts[1] : timeStr;
}

function dayLabel(dateStr, index) {
  if (index === 0) return 'اليوم';
  if (index === 1) return 'غداً';
  const d = new Date(dateStr);
  const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return days[d.getDay()] || dateStr;
}

function formatLocalTime(localtime) {
  if (!localtime) return '';
  const d = new Date(localtime.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return localtime;
  return d.toLocaleTimeString('ar-AE', { hour: '2-digit', minute: '2-digit', hour12: true });
}

async function fetchCity(city) {
  const key = env.weatherApiKey;
  if (!key) throw new Error('WEATHER_API_KEY not configured');

  const url = `https://api.weatherapi.com/v1/forecast.json?key=${encodeURIComponent(key)}&q=${city.lat},${city.lon}&days=3&lang=ar&aqi=no&alerts=yes`;
  const data = await httpsGet(url);

  if (!data.current || !data.forecast) throw new Error('Unexpected WeatherAPI response');

  const current = data.current;
  const forecastDays = data.forecast.forecastday || [];
  const localtime = data.location?.localtime || '';
  const now = new Date(localtime.replace(' ', 'T'));

  const allHours = forecastDays.flatMap((fd) => fd.hour || []);
  const hourly = allHours
    .filter((h) => new Date(h.time.replace(' ', 'T')) > now)
    .slice(0, 12)
    .map((h) => ({
      time: parseHourClock(h.time),
      time_label: hourLabel(h.time),
      temp_c: Math.round(h.temp_c),
      condition_text: h.condition?.text || '',
    }));

  const daily = forecastDays.map((fd, i) => ({
    date: fd.date,
    label: dayLabel(fd.date, i),
    max_c: Math.round(fd.day?.maxtemp_c ?? 0),
    min_c: Math.round(fd.day?.mintemp_c ?? 0),
    condition_text: fd.day?.condition?.text || '',
  }));

  const alerts = (data.alerts?.alert || []).map((a) => ({
    headline: a.headline,
    severity: a.severity,
    effective: a.effective,
    expires: a.expires,
    desc: a.desc,
  }));

  return {
    id: city.id,
    name: city.name,
    local_time: formatLocalTime(localtime),
    current: {
      temp_c: Math.round(current.temp_c),
      feelslike_c: Math.round(current.feelslike_c),
      humidity: current.humidity,
      wind_kph: Math.round(current.wind_kph),
      pressure_mb: current.pressure_mb,
      vis_km: current.vis_km,
      uv: current.uv,
      condition_text: current.condition?.text || '',
      last_updated: current.last_updated
        ? new Date(current.last_updated.replace(' ', 'T')).toISOString()
        : new Date().toISOString(),
    },
    hourly,
    daily,
    alerts,
  };
}

async function refreshWeather() {
  if (_fetchInFlight) return;
  _fetchInFlight = true;
  try {
    const results = await Promise.allSettled(UAE_CITIES.map(fetchCity));
    const locations = results
      .map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        logger.warn('weather_city_fetch_failed', { city: UAE_CITIES[i].id, error: r.reason?.message });
        return null;
      })
      .filter(Boolean);

    if (locations.length > 0) {
      _snapshot = {
        provider: 'WeatherAPI',
        updated_at: new Date().toISOString(),
        locations,
      };
      logger.info('weather_refreshed', { cities: locations.length });
      const eventPayload = { available: true, data: _snapshot };
      sseHub.broadcast('weather', eventPayload);
      await saveSignalSnapshot('weather', eventPayload);
      await publishSignalEvent('weather', eventPayload);
    }
  } catch (err) {
    logger.error('weather_refresh_failed', { error: err.message });
  } finally {
    _fetchInFlight = false;
  }
}

function getSnapshot() {
  return _snapshot;
}

module.exports = { refreshWeather, getSnapshot, UAE_CITIES };
