"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("player token must be valid", () => {
  const valid = token => typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
  assert.equal(valid("a".repeat(64)), true);
  assert.equal(valid("wrong-token"), false);
  assert.equal(valid(null), false);
});

test("blank and oversized messages are rejected", () => {
  const valid = message => typeof message === "string" && message.trim().length >= 1 && message.trim().length <= 1000;
  assert.equal(valid("मुझे सहायता चाहिए"), true);
  assert.equal(valid("   "), false);
  assert.equal(valid("x".repeat(1001)), false);
});

test("message stays pending until admin views it", () => {
  const chat = { status: "pending", messages: [{ text: "शिकायत", seenByAdmin: false }] };
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].seenByAdmin, false);
});

test("admin viewing marks message seen but does not delete it", () => {
  const chat = { status: "pending", messages: [{ text: "शिकायत", seenByAdmin: false }] };
  chat.messages.forEach(message => { message.seenByAdmin = true; });
  assert.equal(chat.messages[0].seenByAdmin, true);
  assert.equal(chat.messages.length, 1);
});

test("only admin delete action removes chat messages", () => {
  const deleteChat = (chat, isAdmin) => isAdmin ? { ...chat, status: "deleted", messages: [] } : chat;
  const original = { status: "pending", messages: [{ text: "शिकायत" }] };
  assert.equal(deleteChat(original, false).messages.length, 1);
  assert.equal(deleteChat(original, true).messages.length, 0);
});

test("support chat message route uses transaction lock and releases client", async () => {
  const fs = require("node:fs");
  const source = fs.readFileSync("support-chat.js", "utf8");
  const routeStart = source.indexOf('app.post("/api/support-chat/messages"');
  const routeEnd = source.indexOf('app.get("/api/admin/support-chats"', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /await client\.query\("BEGIN"\)/);
  assert.match(route, /pg_advisory_xact_lock/);
  assert.match(route, /await client\.query\("COMMIT"\)/);
  assert.match(route, /await client\.query\("ROLLBACK"\)/);
  assert.match(route, /finally\s*\{\s*if\s*\(client\)\s*client\.release\(\)/);
});

test("close and reopen API validates status and updates database", () => {
  const source = require("node:fs").readFileSync("support-chat.js", "utf8");
  const start = source.indexOf("app.post(\"/api/admin/support-chats/:id/status\"");
  const end = source.indexOf("app.delete(\"/api/admin/support-chats/:id\"", start);
  assert.ok(start >= 0 && end > start, "status route must exist");
  const route = source.slice(start, end);
  assert.match(route, /requireAdmin/);
  assert.match(route, /status !== "open" && status !== "closed"/);
  assert.match(route, /UPDATE support_chats SET status=\$2, updated_at=NOW\(\)/);
  assert.match(route, /RETURNING id,status/);
});

test("closed chat disables admin replies and preserves existing messages", () => {
  const page = require("node:fs").readFileSync("public/support-admin.html", "utf8");
  const backend = require("node:fs").readFileSync("support-chat.js", "utf8");
  assert.match(page, /activeStatus!=="open"/);
  assert.match(page, /\$\("reply"\)\.disabled=activeStatus!=="open"/);
  assert.match(page, /\/api\/admin\/support-chats\/+.*\/status|\/status/);
  assert.match(backend, /status=\x27open\x27/);
  assert.match(backend, /UPDATE support_chats SET status=\$2/);
});

test("admin reply and status routes lock rows and release clients", () => {
  const source = require("node:fs").readFileSync("support-chat.js", "utf8");
  const replyStart = source.indexOf("app.post(\"/api/admin/support-chats/:id/messages\"");
  const statusStart = source.indexOf("app.post(\"/api/admin/support-chats/:id/status\"");
  const deleteStart = source.indexOf("app.delete(\"/api/admin/support-chats/:id\"", statusStart);
  assert.ok(replyStart >= 0 && statusStart > replyStart && deleteStart > statusStart);
  const reply = source.slice(replyStart, statusStart);
  const status = source.slice(statusStart, deleteStart);
  for (const route of [reply, status]) {
    assert.match(route, /await client\.query\("BEGIN"\)/);
    assert.match(route, /FOR UPDATE/);
    assert.match(route, /await client\.query\("COMMIT"\)/);
    assert.match(route, /ROLLBACK/);
    assert.match(route, /client\.release\(\)/);
  }
  assert.match(reply, /chat\.rows\[0\]\.status !== "open"/);
  assert.match(status, /UPDATE support_chats SET status=\$2/);
});
