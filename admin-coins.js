"use strict";

const crypto = require("crypto");
const { pool } = require("./profile-db");

module.exports = function registerAdminCoinsRoutes(app) {
  function requireAdmin(req, res, next) {
    const expected = process.env.ADMIN_TOKEN;
    const supplied = req.get("X-Admin-Token") || "";

    if (
      !expected ||
      !supplied ||
      Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    ) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    next();
  }

  app.get("/api/admin/coins/players", requireAdmin, async (req, res) => {
    const q = String(req.query.q || "").trim();

    if (q.length < 2 || q.length > 40) {
      return res.status(400).json({
        ok: false,
        error: "Search must be 2-40 characters"
      });
    }

    try {
      const result = await pool.query(
        `SELECT p.player_id AS "playerId",
                p.player_name AS "playerName",
                p.referral_code AS "referralCode",
                COALESCE(w.balance, 0)::TEXT AS balance
         FROM player_profiles p
         LEFT JOIN player_wallets w ON w.resume_token = p.resume_token
         WHERE p.player_id ILIKE $1 OR p.player_name ILIKE $1
         ORDER BY p.player_name
         LIMIT 20`,
        ["%" + q + "%"]
      );

      return res.json({ ok: true, players: result.rows });
    } catch (e) {
      console.error("Admin player search error:", e.message);
      return res.status(500).json({
        ok: false,
        error: "Player search unavailable"
      });
    }
  });

  app.post("/api/admin/coins/adjust", requireAdmin, async (req, res) => {
    const playerId = String(req.body?.playerId || "").trim();
    const action = req.body?.action;
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason || "").trim();

    if (!playerId || playerId.length > 16) {
      return res.status(400).json({ ok: false, error: "Invalid player ID" });
    }

    if (action !== "add" && action !== "deduct") {
      return res.status(400).json({ ok: false, error: "Invalid action" });
    }

    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) {
      return res.status(400).json({
        ok: false,
        error: "Amount must be 1 to 1000000000 coins"
      });
    }

    if (reason.length < 3 || reason.length > 200) {
      return res.status(400).json({
        ok: false,
        error: "Reason must be 3-200 characters"
      });
    }

    let client;
    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const profileResult = await client.query(
        `SELECT resume_token, player_id, player_name
         FROM player_profiles
         WHERE player_id = $1
         FOR UPDATE`,
        [playerId]
      );

      if (profileResult.rowCount !== 1) {
        await client.query("ROLLBACK");
        return res.status(404).json({ ok: false, error: "Player not found" });
      }

      const player = profileResult.rows[0];

      await client.query(
        `INSERT INTO player_wallets (resume_token, balance)
         VALUES ($1, 0)
         ON CONFLICT (resume_token) DO NOTHING`,
        [player.resume_token]
      );

      const walletResult = await client.query(
        "SELECT balance::TEXT AS balance FROM player_wallets WHERE resume_token = $1 FOR UPDATE",
        [player.resume_token]
      );

      const balance = BigInt(walletResult.rows[0].balance);
      const change = BigInt(amount);

      if (action === "deduct" && change > balance) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          ok: false,
          error: "Insufficient coins",
          balance: balance.toString()
        });
      }

      const newBalance = action === "add" ? balance + change : balance - change;
      if (newBalance > 9223372036854775807n) {
        await client.query("ROLLBACK");
        return res.status(400).json({ ok: false, error: "Balance limit exceeded" });
      }

      await client.query(
        "UPDATE player_wallets SET balance = $1, updated_at = NOW() WHERE resume_token = $2",
        [newBalance.toString(), player.resume_token]
      );

      const signedAmount = action === "add" ? amount : -amount;

      await client.query(
        `INSERT INTO wallet_transactions
          (resume_token, amount, type, status, reference)
         VALUES ($1, $2, $3, 'completed', $4)`,
        [
          player.resume_token,
          signedAmount,
          action === "add" ? "admin_add" : "admin_deduct",
          "Admin adjustment: " + reason
        ]
      );

      await client.query("COMMIT");

      return res.json({
        ok: true,
        player: {
          playerId: player.player_id,
          playerName: player.player_name
        },
        action,
        amount,
        balance: newBalance.toString(),
        reason
      });
    } catch (e) {
      if (client) {
        try {
          await client.query("ROLLBACK");
        } catch (_) {}
      }

      console.error("Admin coin adjustment error:", e.message);
      return res.status(500).json({
        ok: false,
        error: "Coin adjustment failed"
      });
    } finally {
      if (client) client.release();
    }
  });
};
