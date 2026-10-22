"use strict";
const { pool } = require("./profile-db");

async function initWithdrawDB() {
  await pool.query("CREATE TABLE IF NOT EXISTS withdrawal_requests (id BIGSERIAL PRIMARY KEY, resume_token TEXT NOT NULL REFERENCES player_profiles(resume_token), amount BIGINT NOT NULL CHECK (amount > 0), status VARCHAR(20) NOT NULL DEFAULT 'pending', admin_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ)");
  await pool.query("ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS payout_reference TEXT");
  await pool.query("ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_payout_reference_unique ON withdrawal_requests (UPPER(payout_reference)) WHERE payout_reference IS NOT NULL");
}

module.exports = { initWithdrawDB };
