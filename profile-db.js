const { Pool } = require("pg");
const { makePlayerId } = require("./profile-feature");

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
  await pool.query("ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS referred_by TEXT REFERENCES player_profiles(resume_token)");
}

async function saveProfile(profile) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
  const result = await pool.query(
    `INSERT INTO player_profiles
      (resume_token, player_name, player_id, referral_code, referred_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (resume_token) DO UPDATE SET
       player_name = EXCLUDED.player_name
     RETURNING player_name, player_id, referral_code`,
    [
      profile.token,
      profile.name,
      profile.playerId,
      profile.referralCode,
      profile.referredBy || null
    ]
  );
  return result.rows[0];
    } catch (err) {
      const duplicatePlayerId = err.code === "23505" && (err.constraint === "player_profiles_player_id_key" || String(err.detail || "").includes("(player_id)="));
      if (!duplicatePlayerId || attempt === 4) throw err;
      profile.playerId = makePlayerId();
    }
  }
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


async function findProfileByReferralCode(code) {
  const result = await pool.query(
    `SELECT resume_token AS token, player_name AS name, referral_code AS "referralCode" FROM player_profiles WHERE referral_code = $1`,
    [String(code || "").trim()]
  );
  return result.rows[0] || null;
}

module.exports = { pool, initProfileDB, saveProfile, getProfile, findProfileByReferralCode };

