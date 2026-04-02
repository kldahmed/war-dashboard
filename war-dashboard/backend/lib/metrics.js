'use strict';

const state = {
  startedAt: Date.now(),
  requestCount: 0,
  requestErrorCount: 0,
  requestLatencyMsSum: 0,
  requestLatencyMsMax: 0,
  jobRuns: 0,
  jobFailures: 0,
  lastJob: null,
};

function recordRequest(latencyMs, isError) {
  state.requestCount += 1;
  if (isError) state.requestErrorCount += 1;
  state.requestLatencyMsSum += latencyMs;
  if (latencyMs > state.requestLatencyMsMax) state.requestLatencyMsMax = latencyMs;
}

function recordJobRun(job) {
  state.jobRuns += 1;
  if (job.status === 'failed') state.jobFailures += 1;
  state.lastJob = {
    id: job.id,
    type: job.type,
    status: job.status,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    latencyMs: job.latencyMs,
  };
}

function snapshot() {
  const avg = state.requestCount > 0
    ? Math.round((state.requestLatencyMsSum / state.requestCount) * 100) / 100
    : 0;
  return {
    uptimeSec: Math.floor((Date.now() - state.startedAt) / 1000),
    requestCount: state.requestCount,
    requestErrorCount: state.requestErrorCount,
    requestLatencyAvgMs: avg,
    requestLatencyMaxMs: state.requestLatencyMsMax,
    jobRuns: state.jobRuns,
    jobFailures: state.jobFailures,
    lastJob: state.lastJob,
  };
}

module.exports = {
  recordRequest,
  recordJobRun,
  snapshot,
};
