require('dotenv').config({ path: '.env.local' });
const { query, pool } = require('../backend/lib/db');
const { normalizeEmail, hashPassword } = require('../backend/lib/auth');

const emailArg = process.argv[2] || 'q_qk@hotmail.com';
const passwordArg = process.argv[3] || 'WpAdmin!2026';
const displayNameArg = process.argv[4] || 'Owner Admin';

(async () => {
  try {
    const email = normalizeEmail(emailArg);
    const hashed = await hashPassword(passwordArg);

    const upsert = await query(
      `INSERT INTO users (email, password_hash, display_name, role, is_active)
       VALUES ($1,$2,$3,'admin',TRUE)
       ON CONFLICT (email) DO UPDATE
       SET role = 'admin',
           is_active = TRUE,
           password_hash = EXCLUDED.password_hash,
           display_name = COALESCE(NULLIF(TRIM(users.display_name), ''), EXCLUDED.display_name),
           updated_at = NOW()
       RETURNING id, email, display_name, role, is_active, created_at, updated_at`,
      [email, hashed, displayNameArg],
    );

    const user = upsert.rows[0];

    console.log(JSON.stringify({
      ok: true,
      account: user,
      login: {
        email,
        password: passwordArg,
      },
      permissions: [
        'POST /api/ingestion/jobs/run',
        'POST /api/signals/refresh',
        'POST /api/sources',
        'POST /api/source-feeds',
      ],
    }, null, 2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
