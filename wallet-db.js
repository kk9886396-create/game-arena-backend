const { pool } = require("./profile-db");

async function initWalletDB() {
  await pool.query("CREATE TABLE IF NOT EXISTS player_wallets (resume_token TEXT PRIMARY KEY REFERENCES player_profiles(resume_token), balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS wallet_transactions (id BIGSERIAL PRIMARY KEY, resume_token TEXT NOT NULL REFERENCES player_profiles(resume_token), amount BIGINT NOT NULL, type VARCHAR(24) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'pending', reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS payment_requests (id BIGSERIAL PRIMARY KEY, resume_token TEXT NOT NULL REFERENCES player_profiles(resume_token), amount BIGINT NOT NULL CHECK (amount > 0), utr TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), admin_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ)");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_utr_unique ON payment_requests (UPPER(utr))");
}

async function getWallet(token) {
  const result = await pool.query(
    "SELECT balance FROM player_wallets WHERE resume_token = $1",
    [token]
  );
  return result.rows[0] || { balance: "0" };
}

async function getWalletTransactions(token) {
  const result = await pool.query(
    "SELECT id, amount, type, status, reference, created_at AS \"createdAt\" FROM wallet_transactions WHERE resume_token = $1 ORDER BY id DESC LIMIT 50",
    [token]
  );
  return result.rows;
}

async function createPaymentRequest(token, amount, utr) { const result = await pool.query("INSERT INTO payment_requests (resume_token, amount, utr) VALUES ($1, $2, $3) RETURNING id, amount, utr, status, created_at AS \"createdAt\"", [token, amount, utr]); return result.rows[0]; }
async function getPendingPayments() {
  const result = await pool.query("SELECT id, amount, utr, status, created_at FROM payment_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100");
  return result.rows;
}

function validatePaymentDecision(decision) {
  if (decision !== "approved" && decision !== "rejected") {
    throw new Error("Invalid decision");
  }
  return true;
}

async function reviewPayment(id, decision, note = "") {
  validatePaymentDecision(decision);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE", [id]);
    const payment = result.rows[0];
    if (!payment || payment.status !== "pending") {
      throw new Error("Payment missing or already reviewed");
    }
    if (decision === "approved") {
      await client.query("INSERT INTO player_wallets (resume_token, balance) VALUES ($1, $2) ON CONFLICT (resume_token) DO UPDATE SET balance = player_wallets.balance + EXCLUDED.balance, updated_at = NOW()", [payment.resume_token, payment.amount]);
      await client.query("INSERT INTO wallet_transactions (resume_token, amount, type, status, reference) VALUES ($1, $2, $3, $4, $5)", [payment.resume_token, payment.amount, "deposit", "completed", "UTR:" + payment.utr]);
    }
    await client.query("UPDATE payment_requests SET status = $1, admin_note = $2, reviewed_at = NOW() WHERE id = $3", [decision, String(note).slice(0, 500), id]);
    await client.query("COMMIT");
    return { id: payment.id, status: decision };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { initWalletDB, getWallet, getWalletTransactions, createPaymentRequest, getPendingPayments, reviewPayment };
