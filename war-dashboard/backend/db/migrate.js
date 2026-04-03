'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '../../.env.local') });

const fs = require('node:fs/promises');
const path = require('node:path');
const { query, withTransaction } = require('../lib/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedNames(client) {
  const res = await client.query('SELECT name FROM schema_migrations');
  return new Set(res.rows.map((r) => r.name));
}

async function listMigrationNames() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  return entries
    .filter((name) => name.endsWith('.up.sql'))
    .map((name) => name.replace('.up.sql', ''))
    .sort();
}

async function migrationNeedsRepair(client, name) {
  if (name !== '003_strict_prod_expansion') return false;

  const result = await client.query(
    `SELECT
       to_regclass('public.news_categories') IS NOT NULL AS has_news_categories,
       to_regclass('public.stream_channels') IS NOT NULL AS has_stream_channels,
       EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'normalized_items'
           AND column_name = 'news_category_id'
       ) AS has_news_category_column,
       EXISTS (
         SELECT 1
         FROM pg_constraint
         WHERE conname = 'fk_normalized_items_news_category'
       ) AS has_news_category_fk`,
  );

  const row = result.rows[0] || {};
  return !(
    row.has_news_categories
    && row.has_stream_channels
    && row.has_news_category_column
    && row.has_news_category_fk
  );
}

async function applyUp() {
  await withTransaction(async (client) => {
    await ensureMigrationsTable(client);
    const applied = await getAppliedNames(client);
    const all = await listMigrationNames();

    for (const name of all) {
      const alreadyApplied = applied.has(name);
      if (alreadyApplied && !(await migrationNeedsRepair(client, name))) continue;

      const upPath = path.join(MIGRATIONS_DIR, `${name}.up.sql`);
      const sql = await fs.readFile(upPath, 'utf8');
      await client.query(sql);
      if (!alreadyApplied) {
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
        console.log(`[migrate] applied ${name}`);
      } else {
        console.log(`[migrate] repaired ${name}`);
      }
    }
  });
}

async function applyDown() {
  await withTransaction(async (client) => {
    await ensureMigrationsTable(client);
    const res = await client.query('SELECT name FROM schema_migrations ORDER BY applied_at DESC, id DESC LIMIT 1');
    if (res.rowCount === 0) {
      console.log('[migrate] no migration to rollback');
      return;
    }
    const name = res.rows[0].name;
    const downPath = path.join(MIGRATIONS_DIR, `${name}.down.sql`);
    const sql = await fs.readFile(downPath, 'utf8');
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE name = $1', [name]);
    console.log(`[migrate] rolled back ${name}`);
  });
}

async function main() {
  const mode = process.argv[2] || 'up';
  if (mode === 'up') {
    await applyUp();
    return;
  }
  if (mode === 'down') {
    await applyDown();
    return;
  }
  throw new Error(`Unknown migration mode: ${mode}`);
}

main()
  .catch((err) => {
    console.error('[migrate] failed', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { pool } = require('../lib/db');
    await pool.end();
  });
