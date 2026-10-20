const { pool } = require("./profile-db");

async function initWalletDB() {
  await pool.query("CREATE TABLE IF NOT EXISTS player_wallets (resume_token TEXT PRIMARY KEY REFERENCES player_profiles(resume_token), balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS wallet_transactions (id BIGSERIAL PRIMARY KEY, resume_token TEXT NOT NULL REFERENCES player_profiles(resume_token), amount BIGINT NOT NULL, type VARCHAR(24) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'pending', reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
}

async function getWallet(token) {
  const result = await pool.query(
    "SELECT balance FROM player_wallets WHERE resume_token = $1",
    [token]
  );
  return result.rows[0] || { balance: "0" };
}

module.exports = { initWalletDB, getWallet };
