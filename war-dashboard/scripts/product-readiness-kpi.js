'use strict';

require('dotenv').config({ path: '.env.local' });

const { query, pool } = require('../backend/lib/db');

function toPercent(part, total) {
  const p = Number(part || 0);
  const t = Number(total || 0);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return '0.00%';
  return `${((p / t) * 100).toFixed(2)}%`;
}

async function main() {
  const [freshness, duplicates24h, translation24h, usersKpi, sessionsKpi] = await Promise.all([
    query(`SELECT
      COUNT(*)::int AS total_ready,
      COUNT(*) FILTER (
        WHERE COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at) > NOW() - INTERVAL '24 hours'
      )::int AS ready_24h
    FROM normalized_items ni
    JOIN raw_items ri ON ri.id = ni.raw_item_id
    WHERE ni.status = 'ready'`),
    query(`SELECT
      COUNT(*)::int AS duplicate_groups,
      COALESCE(SUM(group_count - 1), 0)::int AS duplicate_items
    FROM (
      SELECT ni.title_fingerprint, COUNT(*)::int AS group_count
      FROM normalized_items ni
      JOIN raw_items ri ON ri.id = ni.raw_item_id
      WHERE ni.status = 'ready'
        AND COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at) > NOW() - INTERVAL '24 hours'
      GROUP BY ni.title_fingerprint
      HAVING COUNT(*) > 1
    ) d`),
    query(`SELECT
      COUNT(*) FILTER (WHERE ni.translation_status = 'translated')::int AS translated_24h,
      COUNT(*)::int AS total_24h
    FROM normalized_items ni
    JOIN raw_items ri ON ri.id = ni.raw_item_id
    WHERE ni.status = 'ready'
      AND COALESCE(ni.published_at_source, ri.fetched_at, ni.created_at) > NOW() - INTERVAL '24 hours'`),
    query(`SELECT
      COUNT(*)::int AS users_total,
      COUNT(*) FILTER (WHERE is_active = TRUE)::int AS users_active,
      COUNT(*) FILTER (WHERE LOWER(role) = 'admin')::int AS admins,
      COUNT(*) FILTER (WHERE LOWER(role) = 'superadmin')::int AS superadmins
    FROM users`),
    query(`SELECT
      COUNT(*)::int AS sessions_total,
      COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at > NOW())::int AS sessions_active,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS sessions_7d
    FROM auth_sessions`),
  ]);

  const f = freshness.rows[0] || { total_ready: 0, ready_24h: 0 };
  const d = duplicates24h.rows[0] || { duplicate_groups: 0, duplicate_items: 0 };
  const t = translation24h.rows[0] || { translated_24h: 0, total_24h: 0 };
  const u = usersKpi.rows[0] || { users_total: 0, users_active: 0, admins: 0, superadmins: 0 };
  const s = sessionsKpi.rows[0] || { sessions_total: 0, sessions_active: 0, sessions_7d: 0 };

  const report = {
    generated_at: new Date().toISOString(),
    product_kpi: {
      users_total: u.users_total,
      users_active: u.users_active,
      admins: u.admins,
      superadmins: u.superadmins,
      sessions_total: s.sessions_total,
      sessions_active: s.sessions_active,
      sessions_last_7d: s.sessions_7d,
    },
    content_kpi_24h: {
      total_ready: f.total_ready,
      ready_24h: f.ready_24h,
      freshness_ratio_24h: toPercent(f.ready_24h, f.total_ready),
      duplicate_groups_24h: d.duplicate_groups,
      duplicate_items_24h: d.duplicate_items,
      duplicate_ratio_24h: toPercent(d.duplicate_items, f.ready_24h),
      translated_24h: t.translated_24h,
      translated_ratio_24h: toPercent(t.translated_24h, t.total_24h),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
