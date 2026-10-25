"use strict";

const crypto = require("crypto");

function validToken(token) {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

function validMessage(message) {
  return typeof message === "string" &&
    message.trim().length >= 1 &&
    message.trim().length <= 1000;
}

async function initSupportChatDB(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_chats (
      id BIGSERIAL PRIMARY KEY,
      resume_token TEXT NOT NULL REFERENCES player_profiles(resume_token) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_chat_messages (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL REFERENCES support_chats(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('player','admin')),
      message TEXT NOT NULL,
      seen_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
      seen_by_player BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function registerSupportChatRoutes(app, options) {
  const { pool, getProfile, io, sessions } = options;

  function requireAdmin(req, res, next) {
    const supplied = req.get("X-Admin-Token") || "";
    const expected = process.env.ADMIN_TOKEN || "";
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);

    if (!expected || a.length !== b.length ||
        !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    next();
  }

  app.get("/api/support-chat", async (req, res) => {
    const token = req.get("X-Resume-Token");
    if (!validToken(token)) {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }

    try {
      if (!await getProfile(token)) {
        return res.status(401).json({ ok: false, error: "Profile not found" });
      }

      const chat = await pool.query(
        "SELECT id,status,created_at AS \"createdAt\" FROM support_chats WHERE resume_token=$1 AND status='open' ORDER BY id DESC LIMIT 1",
        [token]
      );

      if (!chat.rows.length) return res.json({ ok: true, chat: null });

      const messages = await pool.query(
        "SELECT id,sender,message,seen_by_admin AS \"seenByAdmin\",seen_by_player AS \"seenByPlayer\",created_at AS \"createdAt\" FROM support_chat_messages WHERE chat_id=$1 ORDER BY id",
        [chat.rows[0].id]
      );

      return res.json({ ok: true, chat: { ...chat.rows[0], messages: messages.rows } });
    } catch (e) {
      console.error("Support chat load:", e.message);
      return res.status(500).json({ ok: false, error: "Support chat unavailable" });
    }
  });

  app.post("/api/support-chat/messages", async (req, res) => {
    const token = req.get("X-Resume-Token");
    const message = req.body && req.body.message;

    if (!validToken(token)) {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
    if (!validMessage(message)) {
      return res.status(400).json({ ok: false, error: "Message must be 1–1000 characters" });
    }

    let client;
    let inTransaction = false;

    try {
      const profile = await getProfile(token);
      if (!profile) {
        return res.status(401).json({ ok: false, error: "Profile not found" });
      }

      client = await pool.connect();
      await client.query("BEGIN");
      inTransaction = true;

      // Serialize chat creation for this player within this transaction.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [token]
      );

      let result = await client.query(
        "SELECT id FROM support_chats WHERE resume_token=$1 AND status='open' ORDER BY id DESC LIMIT 1 FOR UPDATE",
        [token]
      );

      let chatId;
      if (result.rows.length) {
        chatId = result.rows[0].id;
      } else {
        result = await client.query(
          "INSERT INTO support_chats(resume_token) VALUES($1) RETURNING id",
          [token]
        );
        chatId = result.rows[0].id;
      }

      const saved = await client.query(
        "INSERT INTO support_chat_messages(chat_id,sender,message) VALUES($1,'player',$2) RETURNING id,sender,message,seen_by_admin AS \"seenByAdmin\",created_at AS \"createdAt\"",
        [chatId, message.trim()]
      );

      await client.query(
        "UPDATE support_chats SET updated_at=NOW() WHERE id=$1",
        [chatId]
      );

      await client.query("COMMIT");
      inTransaction = false;

      return res.status(201).json({
        ok: true,
        chatId,
        message: saved.rows[0]
      });
    } catch (e) {
      if (client && inTransaction) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("Support chat rollback:", rollbackError.message);
        }
      }
      console.error("Support complaint send:", e.message);
      return res.status(500).json({
        ok: false,
        error: "Complaint could not be saved"
      });
    } finally {
      if (client) client.release();
    }
  });

  app.get("/api/admin/support-chats", requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT c.id,c.status,c.created_at AS "createdAt",
          c.updated_at AS "updatedAt",p.player_name AS "playerName",
          p.player_id AS "playerId",
          COUNT(m.id) FILTER (WHERE m.sender='player' AND NOT m.seen_by_admin) AS "unseenCount",
          (SELECT message FROM support_chat_messages WHERE chat_id=c.id ORDER BY id DESC LIMIT 1) AS "lastMessage"
        FROM support_chats c
        JOIN player_profiles p ON p.resume_token=c.resume_token
        LEFT JOIN support_chat_messages m ON m.chat_id=c.id
        GROUP BY c.id,p.player_name,p.player_id
        ORDER BY c.updated_at DESC
      `);
      return res.json({ ok: true, chats: result.rows });
    } catch (e) {
      console.error("Admin support list:", e.message);
      return res.status(500).json({ ok: false, error: "Support list unavailable" });
    }
  });

  app.get("/api/admin/support-chats/:id", requireAdmin, async (req, res) => {
    try {
      const id = req.params.id;
      if (!/^[0-9]+$/.test(id)) return res.status(400).json({ ok: false, error: "Invalid chat id" });

      const chat = await pool.query(
        'SELECT c.id,c.status,p.player_name AS "playerName",p.player_id AS "playerId" FROM support_chats c JOIN player_profiles p ON p.resume_token=c.resume_token WHERE c.id=$1',
        [id]
      );
      if (!chat.rows.length) return res.status(404).json({ ok: false, error: "Chat not found" });

      await pool.query(
        "UPDATE support_chat_messages SET seen_by_admin=TRUE WHERE chat_id=$1 AND sender='player'",
        [id]
      );

      const messages = await pool.query(
        'SELECT id,sender,message,seen_by_admin AS "seenByAdmin",seen_by_player AS "seenByPlayer",created_at AS "createdAt" FROM support_chat_messages WHERE chat_id=$1 ORDER BY id',
        [id]
      );
      return res.json({ ok: true, chat: { ...chat.rows[0], messages: messages.rows } });
    } catch (e) {
      console.error("Admin support detail:", e.message);
      return res.status(500).json({ ok: false, error: "Chat unavailable" });
    }
  });

  app.post("/api/admin/support-chats/:id/messages", requireAdmin, async (req, res) => {
    const id = req.params.id;
    const message = req.body && req.body.message;
    if (!/^[0-9]+$/.test(id)) return res.status(400).json({ ok: false, error: "Invalid chat id" });
    if (!validMessage(message)) return res.status(400).json({ ok: false, error: "Message must be 1–1000 characters" });
    let client;
    let inTransaction = false;
    let token;
    let saved;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      inTransaction = true;
      const chat = await client.query("SELECT resume_token,status FROM support_chats WHERE id=$1 FOR UPDATE", [id]);
      if (!chat.rows.length || chat.rows[0].status !== "open") {
        await client.query("ROLLBACK");
        inTransaction = false;
        return res.status(404).json({ ok: false, error: "Open chat not found" });
      }
      token = chat.rows[0].resume_token;
      saved = await client.query("INSERT INTO support_chat_messages(chat_id,sender,message) VALUES($1,$2,$3) RETURNING id,sender,message,created_at AS \"createdAt\"", [id, "admin", message.trim()]);
      await client.query("UPDATE support_chats SET updated_at=NOW() WHERE id=$1", [id]);
      await client.query("COMMIT");
      inTransaction = false;
    } catch (e) {
      if (client && inTransaction) await client.query("ROLLBACK").catch(() => {});
      console.error("Admin support reply:", e.message);
      return res.status(500).json({ ok: false, error: "Reply could not be saved" });
    } finally {
      if (client) client.release();
    }
    if (io && sessions) {
      for (const [socketId, session] of sessions) {
        if (session && session.token === token) {
          io.to(socketId).emit("support:player-notification", { chatId: Number(id), type: "admin_reply", message: message.trim() });
        }
      }
    }
    return res.status(201).json({ ok: true, message: saved.rows[0] });
  });

  app.post("/api/admin/support-chats/:id/status", requireAdmin, async (req, res) => {
    const id = req.params.id;
    const status = req.body && req.body.status;
    if (!/^[0-9]+$/.test(id)) return res.status(400).json({ ok: false, error: "Invalid chat id" });
    if (status !== "open" && status !== "closed") return res.status(400).json({ ok: false, error: "Status must be open or closed" });
    let client;
    let inTransaction = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      inTransaction = true;
      const current = await client.query("SELECT id FROM support_chats WHERE id=$1 FOR UPDATE", [id]);
      if (!current.rows.length) {
        await client.query("ROLLBACK");
        inTransaction = false;
        return res.status(404).json({ ok: false, error: "Chat not found" });
      }
      const result = await client.query("UPDATE support_chats SET status=$2, updated_at=NOW() WHERE id=$1 RETURNING id,status", [id, status]);
      await client.query("COMMIT");
      inTransaction = false;
      return res.json({ ok: true, chat: result.rows[0] });
    } catch (e) {
      if (client && inTransaction) await client.query("ROLLBACK").catch(() => {});
      console.error("Admin support status:", e.message);
      return res.status(500).json({ ok: false, error: "Chat status could not be updated" });
    } finally {
      if (client) client.release();
    }
  });

  app.delete("/api/admin/support-chats/:id", requireAdmin, async (req, res) => {
    const id = req.params.id;
    if (!/^[0-9]+$/.test(id)) return res.status(400).json({ ok: false, error: "Invalid chat id" });

    try {
      const result = await pool.query("DELETE FROM support_chats WHERE id=$1 RETURNING id", [id]);
      if (!result.rows.length) return res.status(404).json({ ok: false, error: "Chat not found" });
      return res.json({ ok: true, deleted: true });
    } catch (e) {
      console.error("Admin support delete:", e.message);
      return res.status(500).json({ ok: false, error: "Chat could not be deleted" });
    }
  });
}

module.exports = { initSupportChatDB, registerSupportChatRoutes };
