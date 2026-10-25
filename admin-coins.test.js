"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pool } = require("./profile-db");

process.env.ADMIN_TOKEN = "temporary-test-token";

let mode, balance, calls, released;
pool.connect = async () => ({
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT resume_token, player_id, player_name")) {
      return { rowCount: 1, rows: [{ resume_token: "mock-token", player_id: "TEST123", player_name: "Test Player" }] };
    }
    if (sql.includes("INSERT INTO player_wallets")) return { rows: [], rowCount: 1 };
    if (sql.includes("SELECT balance::TEXT AS balance")) return { rows: [{ balance: String(balance) }], rowCount: 1 };
    if (sql.startsWith("UPDATE player_wallets")) {
      if (mode === "db-error") throw new Error("simulated database failure");
      balance = BigInt(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO wallet_transactions")) return { rows: [], rowCount: 1 };
    throw new Error("Unexpected SQL: " + sql);
  },
  release() { released = true; }
});

const routes = {};
const app = {
  get(path, ...handlers) { routes["GET " + path] = handlers; },
  post(path, ...handlers) { routes["POST " + path] = handlers; }
};
require("./admin-coins")(app);

async function request(body) {
  const handlers = routes["POST /api/admin/coins/adjust"];
  const req = {
    body,
    get(name) { return name === "X-Admin-Token" ? "temporary-test-token" : ""; }
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; }
  };
  let next = false;
  handlers[0](req, res, () => { next = true; });
  if (next) await handlers[1](req, res);
  return res;
}

function setup(start, selectedMode = "") {
  balance = BigInt(start);
  mode = selectedMode;
  calls = [];
  released = false;
}

test("add updates balance and records transaction", async () => {
  setup(10);
  const res = await request({ playerId: "TEST123", action: "add", amount: 5, reason: "Test addition" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.balance, "15");
  assert.equal(balance, 15n);
  assert.ok(calls.some(c => c.sql.includes("INSERT INTO wallet_transactions")));
  assert.ok(calls.some(c => c.sql === "COMMIT"));
  assert.equal(released, true);
});

test("insufficient deduction rolls back without changing balance", async () => {
  setup(3);
  const res = await request({ playerId: "TEST123", action: "deduct", amount: 5, reason: "Test deduction" });
  assert.equal(res.statusCode, 400);
  assert.equal(balance, 3n);
  assert.ok(calls.some(c => c.sql === "ROLLBACK"));
  assert.ok(!calls.some(c => c.sql.startsWith("UPDATE player_wallets")));
  assert.equal(released, true);
});

test("database error returns 500 and releases connection", async () => {
  setup(10, "db-error");
  const res = await request({ playerId: "TEST123", action: "add", amount: 5, reason: "Test database error" });
  assert.equal(res.statusCode, 500);
  assert.ok(calls.some(c => c.sql === "ROLLBACK"));
  assert.equal(released, true);
});
