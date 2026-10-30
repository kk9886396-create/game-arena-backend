const { pool } = require("./profile-db");

async function initWalletDB() {
  await pool.query("CREATE TABLE IF NOT EXISTS player_wallets (resume_token TEXT PRIMARY KEY REFERENCES player_profiles(resume_token), balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS wallet_transactions (id BIGSERIAL PRIMARY KEY, resume_token TEXT NOT NULL REFERENCES player_profiles(resume_token), amount BIGINT NOT NULL, type VARCHAR(24) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'pending', reference TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await pool.query("CREATE TABLE IF NOT EXISTS payment_requests (id BIGSERIAL PRIMARY KEY, resume_token TEXT NOT NULL REFERENCES player_profiles(resume_token), amount BIGINT NOT NULL CHECK (amount > 0), utr TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), admin_note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), reviewed_at TIMESTAMPTZ)");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_utr_unique ON payment_requests (UPPER(utr))");
  await pool.query("CREATE TABLE IF NOT EXISTS referral_income (id BIGSERIAL PRIMARY KEY, referrer_token TEXT NOT NULL REFERENCES player_profiles(resume_token), referred_token TEXT NOT NULL REFERENCES player_profiles(resume_token), match_id TEXT NOT NULL, entry_amount BIGINT NOT NULL DEFAULT 0 CHECK (entry_amount >= 0), income_amount BIGINT NOT NULL CHECK (income_amount >= 0), status VARCHAR(16) NOT NULL DEFAULT 'available' CHECK (status IN ('available','converted')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), converted_at TIMESTAMPTZ, UNIQUE (match_id, referrer_token))");
  await pool.query("ALTER TABLE referral_income ALTER COLUMN entry_amount SET DEFAULT 0");
  await pool.query("ALTER TABLE referral_income DROP CONSTRAINT IF EXISTS referral_income_entry_amount_check");
  await pool.query("ALTER TABLE referral_income ADD CONSTRAINT referral_income_entry_amount_check CHECK (entry_amount >= 0)");
}

async function getWallet(token) {
  const result = await pool.query("SELECT balance FROM player_wallets WHERE resume_token = $1", [token]);
  return result.rows[0] || { balance: "0" };
}

async function getWalletTransactions(token) {
  const result = await pool.query("SELECT id, amount, type, status, reference, created_at AS \"createdAt\" FROM wallet_transactions WHERE resume_token = $1 ORDER BY id DESC LIMIT 50", [token]);
  return result.rows;
}

async function createPaymentRequest(token, amount, utr) {
  const result = await pool.query("INSERT INTO payment_requests (resume_token, amount, utr) VALUES ($1, $2, $3) RETURNING id, amount, utr, status, created_at AS \"createdAt\"", [token, amount, utr]);
  return result.rows[0];
}

async function getPendingPayments() {
  const result = await pool.query("SELECT id, amount, utr, status, created_at FROM payment_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT 100");
  return result.rows;
}

function validatePaymentDecision(decision) {
  if (decision !== "approved" && decision !== "rejected") throw new Error("Invalid decision");
  return true;
}

async function reviewPayment(id, decision, note = "") {
  validatePaymentDecision(decision);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE", [id]);
    const payment = result.rows[0];
    if (!payment || payment.status !== "pending") throw new Error("Payment missing or already reviewed");
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

async function recordReferralWin(referredToken, matchId, mode) {
  if (!referredToken || !matchId || mode !== "classic") return false;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO referral_income
        (referrer_token, referred_token, match_id, entry_amount, income_amount, status, converted_at)
       SELECT referred_by, resume_token, $2, 0, 2, 'converted', NOW()
       FROM player_profiles
       WHERE resume_token = $1 AND referred_by IS NOT NULL
       ON CONFLICT (match_id, referrer_token) DO NOTHING
       RETURNING referrer_token`,
      [referredToken, String(matchId)]
    );
    if (result.rowCount === 1) {
      const referrerToken = result.rows[0].referrer_token;
      await client.query(
        "INSERT INTO player_wallets (resume_token, balance) VALUES ($1, 2) ON CONFLICT (resume_token) DO UPDATE SET balance = player_wallets.balance + 2, updated_at = NOW()",
        [referrerToken]
      );
      await client.query(
        "INSERT INTO wallet_transactions (resume_token, amount, type, status, reference) VALUES ($1, 2, 'referral', 'completed', $2)",
        [referrerToken, "Classic referral reward: " + String(matchId)]
      );
    }
    await client.query("COMMIT");
    return result.rowCount === 1;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function migrateReferralIncomeToWallet(token) {
  if (!token) throw new Error("Invalid token");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const profile = await client.query("SELECT resume_token FROM player_profiles WHERE resume_token = $1 FOR UPDATE", [token]);
    if (profile.rowCount !== 1) throw new Error("Profile not found");
    const result = await client.query("SELECT id, income_amount FROM referral_income WHERE referrer_token = $1 AND status = $2 ORDER BY id FOR UPDATE", [token, "available"]);
    const amount = result.rows.reduce((sum, row) => sum + Number(row.income_amount), 0);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid legacy referral balance");
    if (amount === 0) {
      await client.query("COMMIT");
      return { ok: true, converted: 0 };
    }
    const ids = result.rows.map(row => row.id);
    const updated = await client.query("UPDATE referral_income SET status = $1, converted_at = NOW() WHERE id = ANY($2::bigint[]) AND status = $3", ["converted", ids, "available"]);
    if (updated.rowCount !== ids.length) throw new Error("Referral migration update count mismatch");
    await client.query("INSERT INTO player_wallets (resume_token, balance) VALUES ($1, $2) ON CONFLICT (resume_token) DO UPDATE SET balance = player_wallets.balance + EXCLUDED.balance, updated_at = NOW()", [token, amount]);
    await client.query("INSERT INTO wallet_transactions (resume_token, amount, type, status, reference) VALUES ($1, $2, 'referral', 'completed', $3)", [token, amount, "Legacy referral balance migration"]);
    await client.query("COMMIT");
    return { ok: true, converted: amount };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function getReferralIncomeTotal(token) {
  if (!token) return "0";
  const result = await pool.query("SELECT COALESCE(SUM(income_amount), 0)::text AS total FROM referral_income WHERE referrer_token = $1", [token]);
  return result.rows[0]?.total || "0";
}

module.exports = {
  initWalletDB,
  getWallet,
  getWalletTransactions,
  createPaymentRequest,
  getPendingPayments,
  reviewPayment,
  recordReferralWin,
  migrateReferralIncomeToWallet,
  getReferralIncomeTotal
};
