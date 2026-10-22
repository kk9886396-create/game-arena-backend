"use strict";
const { pool } = require("./profile-db");

async function markWithdrawalPaid(id, payoutReference) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid withdrawal ID");
  if (typeof payoutReference !== "string") throw new Error("Invalid payout reference");
  payoutReference = payoutReference.trim();
  if (payoutReference.length < 4 || payoutReference.length > 120) throw new Error("Valid UTR required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE", [id]);
    const req = result.rows[0];
    if (!req || req.status !== "approved" || req.paid_at) throw new Error("Withdrawal not approved or already paid");
      const tx = await client.query("UPDATE wallet_transactions SET status = 'completed' WHERE resume_token = $1 AND reference = $2 AND type = 'withdrawal' AND status = 'pending'", [req.resume_token, "WITHDRAW:" + req.id]);
      if (tx.rowCount !== 1) throw new Error("Pending withdrawal transaction not found");
      const upd = await client.query("UPDATE withdrawal_requests SET status = 'paid', payout_reference = $1, paid_at = NOW() WHERE id = $2 AND status = 'approved' AND paid_at IS NULL", [payoutReference, id]);
      if (upd.rowCount !== 1) throw new Error("Withdrawal status update failed");
      await client.query("COMMIT");
      return { id: req.id, amount: String(req.amount), status: "paid", payoutReference };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
}

module.exports = { markWithdrawalPaid };
