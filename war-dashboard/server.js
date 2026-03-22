/**
 * Local development API server — port 3001
 * Mirrors the Vercel /api/claude serverless function.
 *
 * Usage (handled by `npm run dev` automatically):
 *   node server.js
 *
 * Reads ANTHROPIC_API_KEY from .env.local
 */

require('dotenv').config({ path: '.env.local' });

const express = require('express');
const claudeHandler = require('./api/claude');

const app  = express();
const PORT = 3001;

app.use(express.json());

// Mount the exact same handler used by Vercel
app.post('/api/claude', claudeHandler);

// Health-check (optional, useful for debugging)
app.get('/api/health', (_req, res) => {
  res.json({
    status:   'ok',
    keySet:   !!process.env.ANTHROPIC_API_KEY,
    time:     new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  const keySet = !!process.env.ANTHROPIC_API_KEY;
  console.log(`\n⚡ Dev API server → http://localhost:${PORT}`);
  console.log(`   ANTHROPIC_API_KEY: ${keySet ? '✅ loaded from .env.local' : '❌ NOT SET — add it to .env.local'}`);
  if (!keySet) {
    console.warn('\n   ⚠️  Copy .env.example → .env.local and set your key.\n');
  }
});
