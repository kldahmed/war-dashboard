'use strict';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function asNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function isValidDomain(domain) {
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(domain);
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_err) {
    return false;
  }
}

function validateSourcePayload(payload) {
  const errors = [];
  const source = {
    name: normalizeText(payload.name),
    domain: normalizeText(payload.domain).toLowerCase(),
    region: normalizeText(payload.region).toLowerCase(),
    language: normalizeText(payload.language).toLowerCase(),
    category: normalizeText(payload.category).toLowerCase(),
    official_flag: asBoolean(payload.official_flag, false),
    trust_score: asNumber(payload.trust_score, 50),
    status: normalizeText(payload.status || 'active').toLowerCase(),
  };

  if (!isNonEmptyString(source.name)) errors.push('name is required');
  if (!isNonEmptyString(source.domain)) errors.push('domain is required');
  if (isNonEmptyString(source.domain) && !isValidDomain(source.domain)) errors.push('domain format is invalid');
  if (!isNonEmptyString(source.region)) errors.push('region is required');
  if (!isNonEmptyString(source.language)) errors.push('language is required');
  if (!isNonEmptyString(source.category)) errors.push('category is required');
  if (!['active', 'paused', 'disabled'].includes(source.status)) errors.push('status must be active|paused|disabled');
  if (source.trust_score < 0 || source.trust_score > 100) errors.push('trust_score must be between 0 and 100');

  return { errors, value: source };
}

function validateFeedPayload(payload) {
  const errors = [];
  const feed = {
    source_id: asNumber(payload.source_id, null),
    feed_type: normalizeText(payload.feed_type).toLowerCase(),
    endpoint: normalizeText(payload.endpoint),
    polling_interval_sec: asNumber(payload.polling_interval_sec, 300),
    status: normalizeText(payload.status || 'active').toLowerCase(),
  };

  if (!Number.isInteger(feed.source_id) || feed.source_id <= 0) errors.push('source_id must be a positive integer');
  if (!['rss'].includes(feed.feed_type)) errors.push('feed_type must be rss for sprint 1');
  if (!isNonEmptyString(feed.endpoint)) errors.push('endpoint is required');
  if (isNonEmptyString(feed.endpoint) && !isValidHttpUrl(feed.endpoint)) errors.push('endpoint must be a valid http/https URL');
  if (feed.polling_interval_sec < 60 || feed.polling_interval_sec > 86400) errors.push('polling_interval_sec must be between 60 and 86400');
  if (!['active', 'paused', 'disabled'].includes(feed.status)) errors.push('status must be active|paused|disabled');

  return { errors, value: feed };
}

module.exports = {
  validateSourcePayload,
  validateFeedPayload,
};
