'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { probeStreamCandidates } = require('../backend/modules/observability/stream-candidates');

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/probe-stream-candidates.js <candidates.json>');
    process.exitCode = 1;
    return;
  }

  const resolved = path.resolve(process.cwd(), inputPath);
  const raw = await fs.readFile(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  const candidates = Array.isArray(parsed) ? parsed : parsed.candidates;

  if (!Array.isArray(candidates)) {
    throw new Error('Expected candidates JSON array or { candidates: [] }');
  }

  const out = await probeStreamCandidates(candidates, {
    arabicOnly: true,
    directOnly: true,
  });

  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
