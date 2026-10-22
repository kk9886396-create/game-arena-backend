"use strict";
const { pool } = require("./profile-db");
async function getApprovedWithdrawals() {
  const result = await pool.query("SELECT id, amount, status, created_at, reviewed_at FROM withdrawal_requests WHERE status = 'approved' AND paid_at IS NULL ORDER BY reviewed_at ASC NULLS FIRST LIMIT 100");
  return result.rows;
}
module.exports = { getApprovedWithdrawals };
