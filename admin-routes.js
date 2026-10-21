const crypto = require("crypto");

module.exports = function (app, { getPendingPayments, reviewPayment }) {
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
};
