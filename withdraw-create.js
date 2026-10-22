"use strict";
const { pool } = require("./profile-db");

async function createWithdrawal(token, amount) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 50000) {
    throw new Error("Invalid withdrawal amount");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const w = await client.query("SELECT balance FROM player_wallets WHERE resume_token = $1 FOR UPDATE", [token]);
    if (!w.rows[0] || Number(w.rows[0].balance) < amount) throw new Error("Insufficient wallet balance");
    const debited = await client.query("UPDATE player_wallets SET balance = balance - $1, updated_at = NOW() WHERE resume_token = $2", [amount, token]);
    if (debited.rowCount !== 1) throw new Error("Wallet debit failed");
    const r = await client.query("INSERT INTO withdrawal_requests (resume_token, amount) VALUES ($1, $2) RETURNING id", [token, amount]);
    await client.query("INSERT INTO wallet_transactions (resume_token, amount, type, status, reference) VALUES ($1, $2, $3, $4, $5)", [token, -amount, "withdrawal", "pending", "WITHDRAW:" + r.rows[0].id]);
    await client.query("COMMIT");
    return { id: r.rows[0].id, amount, status: "pending" };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { createWithdrawal };
