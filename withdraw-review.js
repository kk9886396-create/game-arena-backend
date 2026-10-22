"use strict";

const { pool } = require("./profile-db");

async function getPendingWithdrawals() {
  const result = await pool.query(
    "SELECT id, amount, status, created_at FROM withdrawal_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100"
  );
  return result.rows;
}

async function reviewWithdrawal(id, decision, note = "") {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("Invalid withdrawal ID");
  }
  if (!["approved", "rejected"].includes(decision)) {
    throw new Error("Invalid decision");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE",
      [id]
    );

    const request = result.rows[0];

    if (!request || request.status !== "pending") {
      throw new Error("Withdrawal missing or already reviewed");
    }

    if (decision === "rejected") {
      const refund = await client.query(
        "UPDATE player_wallets SET balance = balance + $1, updated_at = NOW() WHERE resume_token = $2",
        [request.amount, request.resume_token]
      );
      if (refund.rowCount !== 1) {
        throw new Error("Wallet row missing; refund cancelled");
      }

      await client.query(
        "INSERT INTO wallet_transactions (resume_token, amount, type, status, reference) VALUES ($1, $2, $3, $4, $5)",
        [
          request.resume_token,
          request.amount,
          "withdrawal_refund",
          "completed",
          "WITHDRAW_REFUND:" + request.id
        ]
      );

      const tx = await client.query(
        "UPDATE wallet_transactions SET status = 'rejected' WHERE resume_token = $1 AND reference = $2 AND type = 'withdrawal' AND status = 'pending'",
        [request.resume_token, "WITHDRAW:" + request.id]
      );
      if (tx.rowCount !== 1) {
        throw new Error("Withdrawal transaction record missing");
      }
    } else {
      const tx = await client.query(
        "UPDATE wallet_transactions SET status = 'pending' WHERE resume_token = $1 AND reference = $2 AND type = 'withdrawal' AND status = 'pending'",
        [request.resume_token, "WITHDRAW:" + request.id]
      );
      if (tx.rowCount !== 1) {
        throw new Error("Withdrawal transaction record missing");
      }
    }

    const updated = await client.query(
      "UPDATE withdrawal_requests SET status = $1, admin_note = $2, reviewed_at = NOW() WHERE id = $3 AND status = 'pending'",
      [decision, String(note).slice(0, 500), id]
    );
    if (updated.rowCount !== 1) throw new Error("Withdrawal status update failed");

    await client.query("COMMIT");

    return { id: request.id, amount: String(request.amount), status: decision };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { getPendingWithdrawals, reviewWithdrawal };
