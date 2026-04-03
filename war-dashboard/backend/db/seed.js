'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { query, pool } = require('../lib/db');
const { syncSourceRegistry } = require('../modules/ingestion/source-registry');
const { syncStreamRegistry, verifyStreamRegistry } = require('../modules/observability/stream-registry');

const SEEDS_DIR = path.join(__dirname, 'seeds');

const NEWS_CATEGORIES = [
  { slug: 'politics', label: 'سياسة', hints: ['election', 'government', 'minister', 'cabinet', 'parliament', 'policy', 'diplomacy'] },
  { slug: 'economy', label: 'اقتصاد', hints: ['economy', 'market', 'trade', 'inflation', 'gdp', 'bank', 'finance'] },
  { slug: 'war', label: 'حروب', hints: ['war', 'attack', 'strike', 'missile', 'military', 'battle', 'troops'] },
  { slug: 'middle-east', label: 'شرق الأوسط', hints: ['middle east', 'gaza', 'iran', 'israel', 'syria', 'lebanon', 'saudi'] },
  { slug: 'world', label: 'العالم', hints: ['world', 'global', 'international', 'united nations', 'summit'] },
  { slug: 'energy', label: 'الطاقة', hints: ['oil', 'gas', 'energy', 'pipeline', 'opec', 'electricity'] },
  { slug: 'technology', label: 'التقنية', hints: ['technology', 'ai', 'cyber', 'software', 'chip', 'digital'] },
  { slug: 'analysis', label: 'التحليل', hints: ['analysis', 'opinion', 'insight', 'assessment', 'explainer'] },
  { slug: 'breaking', label: 'عاجل', hints: ['breaking', 'urgent', 'developing', 'alert', 'flash'] },
];

async function seedNewsCategories() {
  for (const category of NEWS_CATEGORIES) {
    await query(
      `INSERT INTO news_categories (slug, label_ar, keyword_hints, status)
       VALUES ($1, $2, $3::text[], 'active')
       ON CONFLICT (slug) DO UPDATE
       SET label_ar = EXCLUDED.label_ar,
           keyword_hints = EXCLUDED.keyword_hints,
           status = EXCLUDED.status,
           updated_at = NOW()`,
      [category.slug, category.label, category.hints],
    );
  }
}

async function run() {
  const entries = (await fs.readdir(SEEDS_DIR)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of entries) {
    const sql = await fs.readFile(path.join(SEEDS_DIR, file), 'utf8');
    await query(sql);
    console.log(`[seed] executed ${file}`);
  }

  const sourceSummary = await syncSourceRegistry();
  console.log(`[seed] synced source registry (${sourceSummary.totalSourcesConfigured} configured)`);

  await seedNewsCategories();
  console.log(`[seed] synced news categories (${NEWS_CATEGORIES.length} configured)`);

  const streamSummary = await syncStreamRegistry();
  console.log(`[seed] synced stream registry (${streamSummary.totalChannelsConfigured} configured)`);

  await verifyStreamRegistry({ force: true });
  console.log('[seed] verified stream registry');

  const playbackSummary = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'inactive' AND last_verification_status = 'removed_unavailable')::int AS removed_streams,
       COUNT(*) FILTER (WHERE status = 'active')::int AS active_streams,
       COUNT(*) FILTER (WHERE status = 'active' AND playback_mode = 'playable')::int AS playable_streams,
       COUNT(*) FILTER (WHERE status = 'active' AND playback_mode = 'external_only')::int AS external_only_streams
     FROM stream_channels`,
  );
  const playbackRow = playbackSummary.rows[0] || {};
  console.log(
    `[seed] stream playback active=${playbackRow.active_streams || 0} playable=${playbackRow.playable_streams || 0} external_only=${playbackRow.external_only_streams || 0} removed=${playbackRow.removed_streams || 0}`,
  );
}

run()
  .catch((err) => {
    console.error('[seed] failed', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
