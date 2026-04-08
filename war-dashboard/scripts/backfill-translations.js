'use strict';

/**
 * backfill-translations.js
 *
 * Translates all existing normalized_items that are non-Arabic and still
 * lack an Arabic translation (translation_status IN 'pending', 'unavailable',
 * 'failed', or NULL).
 *
 * Usage:
 *   node scripts/backfill-translations.js [--limit N] [--concurrency N] [--dry-run]
 *
 * The script uses the same translateNormalizedItem() used by the ingestion
 * pipeline, so it respects the ANTHROPIC_API_KEY / Google Translate fallback
 * chain already in place.
 */

require('dotenv').config({ path: '.env.local' });

const { query, pool } = require('../backend/lib/db');
const { translateNormalizedItem } = require('../backend/modules/translation/service');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argInt(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx === -1 || !args[idx + 1]) return fallback;
  const v = Number.parseInt(args[idx + 1], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
const LIMIT       = argInt('--limit', 2000);
const CONCURRENCY = argInt('--concurrency', 4);
const DRY_RUN     = args.includes('--dry-run');

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchUntranslated(limit) {
  const result = await query(
    `SELECT id
     FROM normalized_items
     WHERE status = 'ready'
       AND LOWER(COALESCE(language, '')) NOT LIKE 'ar%'
       AND (
         translation_status IS NULL
         OR translation_status IN ('pending', 'unavailable', 'failed')
         OR (translation_status = 'translated'
             AND (translated_title_ar IS NULL OR translated_title_ar = '')
             AND (translated_summary_ar IS NULL OR translated_summary_ar = ''))
       )
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((r) => r.id);
}

async function runBatch(ids, concurrency) {
  let done = 0;
  let translated = 0;
  let skipped = 0;
  let failed = 0;

  async function processOne(id) {
    if (DRY_RUN) {
      done++;
      skipped++;
      process.stdout.write(`\r[dry-run] would translate ${done}/${ids.length}  `);
      return;
    }
    try {
      const result = await translateNormalizedItem(id);
      done++;
      if (result.translationStatus === 'translated' && result.translated) {
        translated++;
      } else if (result.translationStatus === 'not_required') {
        skipped++;
      } else {
        failed++;
      }
    } catch (err) {
      done++;
      failed++;
      process.stderr.write(`\n[warn] id=${id} error: ${err.message}\n`);
    }
    process.stdout.write(`\r[${done}/${ids.length}] translated=${translated} skipped=${skipped} failed=${failed}  `);
  }

  // Process in chunks of `concurrency`
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    await Promise.all(chunk.map(processOne));
    // Small pause between batches to avoid hammering the API
    if (!DRY_RUN && i + concurrency < ids.length) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  process.stdout.write('\n');
  return { done, translated, skipped, failed };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nbackfill-translations — limit=${LIMIT} concurrency=${CONCURRENCY}${DRY_RUN ? ' DRY-RUN' : ''}\n`);

  const ids = await fetchUntranslated(LIMIT);
  console.log(`Found ${ids.length} items needing translation.\n`);

  if (ids.length === 0) {
    console.log('Nothing to do. All items are already translated or Arabic.');
    return;
  }

  const stats = await runBatch(ids, CONCURRENCY);

  console.log('\n── Summary ──────────────────────────────────');
  console.log(`  Total processed : ${stats.done}`);
  console.log(`  Translated      : ${stats.translated}`);
  console.log(`  Skipped         : ${stats.skipped}  (not_required / already done)`);
  console.log(`  Failed          : ${stats.failed}`);
  console.log('─────────────────────────────────────────────\n');
}

main()
  .catch((err) => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
