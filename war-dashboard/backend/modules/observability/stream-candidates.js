'use strict';

const { OFFICIAL_STREAM_REGISTRY } = require('./stream-registry');
const { probeChannels, normalizeCandidateChannel } = require('./stream-probe');

const STREAM_CANDIDATE_REGISTRY = [];

async function getStreamCandidateSnapshot() {
  const seeds = STREAM_CANDIDATE_REGISTRY.map(normalizeCandidateChannel).filter((entry) => entry.id && entry.name);
  const probe = seeds.length > 0
    ? await probeChannels(seeds, { arabicOnly: true, directOnly: true })
    : { total: 0, healthy: 0, unhealthy: 0, approved: [], results: [] };

  return {
    generated_at: new Date().toISOString(),
    candidate_inventory: {
      official_registry_total: OFFICIAL_STREAM_REGISTRY.length,
      seeded_candidates_total: seeds.length,
      healthy_candidates: probe.healthy,
      unhealthy_candidates: probe.unhealthy,
      approved_candidates: probe.approved.length,
    },
    candidates: probe.results,
    approved_candidates: probe.approved,
  };
}

async function probeStreamCandidates(candidates, options = {}) {
  return probeChannels(candidates, options);
}

module.exports = {
  STREAM_CANDIDATE_REGISTRY,
  getStreamCandidateSnapshot,
  probeStreamCandidates,
};
