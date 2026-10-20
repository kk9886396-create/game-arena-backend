const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

async function initProfileDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_profiles (
      resume_token TEXT PRIMARY KEY,
      player_name VARCHAR(24) NOT NULL,
      player_id VARCHAR(16) NOT NULL UNIQUE,
      referral_code VARCHAR(16) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function saveProfile(profile) {
  const result = await pool.query(
    `INSERT INTO player_profiles
      (resume_token, player_name, player_id, referral_code)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (resume_token) DO UPDATE SET
       player_name = EXCLUDED.player_name
     RETURNING player_name, player_id, referral_code`,
    [
      profile.token,
      profile.name,
      profile.playerId,
      profile.referralCode
    ]
  );
  return result.rows[0];
}

async function getProfile(token) {
  const result = await pool.query(
    `SELECT player_name AS name,
            player_id AS "playerId",
            referral_code AS "referralCode"
     FROM player_profiles
     WHERE resume_token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

module.exports = { pool, initProfileDB, saveProfile, getProfile };

