require('dotenv').config({ path: '.env.local' });
const { query, pool } = require('../backend/lib/db');

(async () => {
  try {
    const latestUsers = await query(`
      SELECT id, email, display_name, role, is_active, created_at
      FROM users
      ORDER BY id DESC
      LIMIT 5
    `);

    const latestSessions = await query(`
      SELECT id, user_id, revoked_at IS NULL AS active_session, expires_at, created_at
      FROM auth_sessions
      ORDER BY id DESC
      LIMIT 8
    `);

    console.log(JSON.stringify({
      latestUsers: latestUsers.rows,
      latestSessions: latestSessions.rows,
    }, null, 2));
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
