'use strict';

const express = require('express');
const { runRssIngestion } = require('./service');
const { asyncHandler } = require('../../lib/async-handler');

const router = express.Router();

router.post('/ingestion/jobs/run', asyncHandler(async (req, res) => {
  let responded = false;

  const ingestionPromise = runRssIngestion({
    correlationId: req.correlationId,
    triggeredBy: 'api',
    onJobCreated: (jobId) => {
      responded = true;
      res.status(202).json({ summary: { jobId } });
    },
  });

  ingestionPromise.catch((err) => {
    if (!responded) {
      res.status(500).json({ error: 'ingestion_start_failed', detail: err.message });
    }
  });
}));

router.get('/ingestion/jobs/:id', asyncHandler(async (req, res) => {
  const { query } = require('../../lib/db');
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_job_id' });

  const result = await query(
    `SELECT id, job_type, status, payload_json, started_at, ended_at, latency_ms, attempt_no, correlation_id, error_message, created_at, updated_at
     FROM processing_jobs WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'job_not_found' });
  return res.json({ item: result.rows[0] });
}));

module.exports = router;
