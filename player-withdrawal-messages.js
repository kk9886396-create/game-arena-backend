"use strict";

module.exports = function (app, getProfile, getMessages) {
  app.get("/api/wallet/withdrawal-messages", async (req, res) => {
    const token = req.get("X-Resume-Token");

    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }

    try {
      if (!await getProfile(token)) {
        return res.status(401).json({ ok: false, error: "Profile not found" });
      }

      const messages = await getMessages(token);
      return res.json({ ok: true, messages });
    } catch (e) {
      console.error("Withdrawal messages error:", e.message);
      return res.status(500).json({ ok: false, error: "Withdrawal messages unavailable" });
    }
  });
};
