"use strict";

const crypto = require("crypto");

module.exports = function (
  app,
  { getPendingPayments, reviewPayment, getPendingWithdrawals, getApprovedWithdrawals, reviewWithdrawal, markWithdrawalPaid, sendWithdrawalMessage, io, getRecentLogs }
) {
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

  app.get("/api/admin/payments", requireAdmin, async (req, res) => {
    try {
      const payments = await getPendingPayments();
      res.json({ ok: true, payments });
    } catch (e) {
      console.error("Admin payments error:", e.message);
      res.status(500).json({ ok: false, error: "Unable to load payments" });
    }
  });

  app.post("/api/admin/payments/:id/review", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const decision = req.body?.decision;
    const note = String(req.body?.note || "");

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ ok: false, error: "Invalid payment ID" });
    }
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ ok: false, error: "Invalid decision" });
    }

    try {
      const result = await reviewPayment(id, decision, note);
      res.json({ ok: true, result });
    } catch (e) {
      console.error("Admin review error:", e.message);
      res.status(409).json({ ok: false, error: "Payment not reviewable" });
    }
  });

  app.get("/api/admin/withdrawals", requireAdmin, async (req, res) => {
    try {
      const withdrawals = await getPendingWithdrawals();
      res.json({ ok: true, withdrawals });
    } catch (e) {
      console.error("Admin withdrawals error:", e.message);
      res.status(500).json({ ok: false, error: "Unable to load withdrawals" });
    }
  });

  app.get("/api/admin/withdrawals/approved", requireAdmin, async (req, res) => {
    try {
      const withdrawals = await getApprovedWithdrawals();
      res.json({ ok: true, withdrawals });
    } catch (e) {
      console.error("Approved withdrawals error:", e.message);
      res.status(500).json({ ok: false, error: "Unable to load approved withdrawals" });
    }
  });

  app.post("/api/admin/withdrawals/:id/review", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const decision = req.body?.decision;
    const note = String(req.body?.note || "");

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ ok: false, error: "Invalid withdrawal ID" });
    }
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ ok: false, error: "Invalid decision" });
    }

    try {
      const result = await reviewWithdrawal(id, decision, note);
      res.json({ ok: true, result });
    } catch (e) {
      console.error("Admin withdrawal review error:", e.message);
      res.status(409).json({ ok: false, error: "Withdrawal not reviewable" });
    }
  });
  app.post("/api/admin/withdrawals/:id/paid", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const payoutReference = String(req.body?.payoutReference || req.body?.utr || "").trim();

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ ok: false, error: "Invalid withdrawal ID" });
    }

    if (payoutReference.length < 4 || payoutReference.length > 120) {
      return res.status(400).json({ ok: false, error: "Valid UTR required" });
    }

    try {
      const result = await markWithdrawalPaid(id, payoutReference);
      return res.json({ ok: true, result });
    } catch (e) {
      console.error("Mark withdrawal paid error:", e.message);
      return res.status(409).json({ ok: false, error: "Withdrawal could not be marked paid" });
    }
  });
  app.post("/api/admin/withdrawals/:id/message", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const action = req.body?.action;
    const message = req.body?.message;

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ ok: false, error: "Invalid withdrawal ID" });
    }

    try {
      const result = await sendWithdrawalMessage(id, action, message);
      return res.status(201).json({ ok: true, message: result });
    } catch (e) {
      console.error("Admin withdrawal message error:", e.message);
      const known = ["Invalid action", "Message must be 1-1000 characters", "Withdrawal not found"];
      if (known.includes(e.message)) {
        return res.status(400).json({ ok: false, error: e.message });
      }
      return res.status(500).json({ ok: false, error: "Unable to send withdrawal message" });
    }
  });


  app.get("/api/admin/logs", requireAdmin, (req, res) => {
    const logs = typeof getRecentLogs === "function" ? getRecentLogs() : [];
    return res.json({ ok: true, logs });
  });

  app.post("/api/admin/notifications", requireAdmin, (req, res) => {
    const message = String(req.body?.message || "").trim();
    if (!message || message.length > 500) {
      return res.status(400).json({ ok: false, error: "Message must be 1-500 characters" });
    }
    const notification = { message, sentAt: new Date().toISOString() };
    io.emit("notification:broadcast", notification);
    return res.json({ ok: true, deliveredTo: io.engine.clientsCount });
  });

};
