"use strict";

const { pool } = require("./profile-db");

const ACTIONS = [
  "successful_message",
  "failed",
  "account_issue",
  "under_review",
  "custom"
];
async function initWithdrawalMessagesDB() {
  await pool.query("CREATE TABLE IF NOT EXISTS withdrawal_messages (id BIGSERIAL PRIMARY KEY, withdrawal_id BIGINT NOT NULL REFERENCES withdrawal_requests(id) ON DELETE CASCADE, action VARCHAR(30) NOT NULL, message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
}

async function sendWithdrawalMessage(id, action, message) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid withdrawal ID");
  if (!ACTIONS.includes(action)) throw new Error("Invalid action");
  message = String(message || "").trim();
  if (!message || message.length > 1000) throw new Error("Message must be 1-1000 characters");
  const result = await pool.query("INSERT INTO withdrawal_messages (withdrawal_id, action, message) SELECT id, $2, $3 FROM withdrawal_requests WHERE id = $1 RETURNING id, withdrawal_id, action, message, created_at", [id, action, message]);
  if (!result.rows.length) throw new Error("Withdrawal not found");
  return result.rows[0];
}


async function getPlayerWithdrawalMessages(token) {
  const r = await pool.query("SELECT m.id, m.withdrawal_id, m.action, m.message, m.created_at FROM withdrawal_messages m JOIN withdrawal_requests w ON w.id = m.withdrawal_id WHERE w.resume_token = $1 ORDER BY m.created_at DESC LIMIT 100", [token]);
  return r.rows;
}

module.exports = { initWithdrawalMessagesDB, sendWithdrawalMessage, getPlayerWithdrawalMessages };

// reader-test
