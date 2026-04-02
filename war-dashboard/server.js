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

const createApp = require('./backend/app/createApp');
const env = require('./backend/config/env');

const app = createApp();

app.listen(env.port, () => {
  const keySet = !!process.env.ANTHROPIC_API_KEY;
  console.log(`\n⚡ Dev API server → http://localhost:${env.port}`);
  console.log(`   ANTHROPIC_API_KEY: ${keySet ? '✅ loaded from .env.local' : '❌ NOT SET — add it to .env.local'}`);
  console.log(`   FEED_MODE: ${env.feedMode}`);
  console.log(`   FEED_FALLBACK_ENABLED: ${env.feedFallbackEnabled}`);
  console.log(`   DATABASE_URL configured: ${!!process.env.DATABASE_URL}`);
  if (!keySet) {
    console.warn('\n   ⚠️  Copy .env.example → .env.local and set your key.\n');
  }
});
