'use strict';

const assert = require('node:assert/strict');
const { validateSourcePayload, validateFeedPayload } = require('../backend/lib/validation');
const { normalizeUnicode } = require('../backend/modules/normalization/service');

function testSourceValidation() {
  const ok = validateSourcePayload({
    name: 'Reuters',
    domain: 'reuters.com',
    region: 'global',
    language: 'en',
    category: 'general',
    official_flag: false,
    trust_score: 80,
    status: 'active',
  });
  assert.equal(ok.errors.length, 0);

  const bad = validateSourcePayload({ name: '', domain: '', trust_score: 200 });
  assert.ok(bad.errors.length >= 3);
}

function testFeedValidation() {
  const ok = validateFeedPayload({
    source_id: 1,
    feed_type: 'rss',
    endpoint: 'https://example.com/feed.xml',
    polling_interval_sec: 300,
    status: 'active',
  });
  assert.equal(ok.errors.length, 0);

  const bad = validateFeedPayload({
    source_id: -1,
    feed_type: 'api',
    endpoint: '',
    polling_interval_sec: 10,
  });
  assert.ok(bad.errors.length >= 3);

  const invalidUrl = validateFeedPayload({
    source_id: 1,
    feed_type: 'rss',
    endpoint: 'ftp://bad-feed',
    polling_interval_sec: 300,
  });
  assert.ok(invalidUrl.errors.some((e) => e.includes('http/https URL')));
}

function testNormalizationShape() {
  const input = '  خبر\t\tعاجل   عن\nالمنطقة  ';
  const output = normalizeUnicode(input);
  assert.equal(output, 'خبر عاجل عن المنطقة');
}

function main() {
  testSourceValidation();
  testFeedValidation();
  testNormalizationShape();
  console.log('smoke checks passed');
}

main();
