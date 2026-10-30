const test = require("node:test");
const assert = require("node:assert/strict");
const { pool } = require("./profile-db");
const {
  recordReferralWin,
  getReferralIncomeTotal
} = require("./wallet-db");

test("invalid and non-classic wins are rejected", async () => {
  const original = pool.connect;
  let calls = 0;
  pool.connect = async () => { calls++; throw Error("Unexpected DB"); };

  try {
    assert.equal(await recordReferralWin("", "m1", "classic"), false);
    assert.equal(await recordReferralWin("p1", "", "classic"), false);
    assert.equal(await recordReferralWin("p1", "m1", "tournament"), false);
    assert.equal(await recordReferralWin("p1", "m1", "open-battle"), false);
    assert.equal(calls, 0);
  } finally {
    pool.connect = original;
  }
});

test("Classic referral win credits exactly 2 coins to main wallet", async () => {
  const original = pool.connect;
  const calls = [];

  pool.connect = async () => ({
    query: async (sql, params) => {
      calls.push({ sql, params });

      if (sql.includes("INSERT INTO referral_income")) {
        return {
          rowCount: 1,
          rows: [{ referrer_token: "referrer-1" }]
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release: () => calls.push({ sql: "RELEASE" })
  });

  try {
    assert.equal(
      await recordReferralWin("player-1", "match-1", "classic"),
      true
    );

    const wallet = calls.find(c => c.sql.includes("INSERT INTO player_wallets"));
    const transaction = calls.find(c => c.sql.includes("INSERT INTO wallet_transactions"));

    assert.deepEqual(wallet.params, ["referrer-1"]);
    assert.deepEqual(transaction.params, [
      "referrer-1", "Classic referral reward: match-1"
    ]);
    assert.ok(calls.some(c => c.sql === "COMMIT"));
    assert.ok(calls.some(c => c.sql === "RELEASE"));
  } finally {
    pool.connect = original;
  }
});

test("duplicate match does not credit wallet again", async () => {
  const original = pool.connect;
  const calls = [];

  pool.connect = async () => ({
    query: async sql => {
      calls.push(sql);
      if (sql.includes("INSERT INTO referral_income")) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
    release: () => {}
  });

  try {
    assert.equal(
      await recordReferralWin("player-1", "match-1", "classic"),
      false
    );
    assert.ok(!calls.some(sql => sql.includes("INSERT INTO player_wallets")));
    assert.ok(!calls.some(sql => sql.includes("INSERT INTO wallet_transactions")));
    assert.ok(calls.includes("COMMIT"));
  } finally {
    pool.connect = original;
  }
});

test("wallet credit failure rolls back referral reward", async () => {
  const original = pool.connect;
  const calls = [];

  pool.connect = async () => ({
    query: async sql => {
      calls.push(sql);
      if (sql.includes("INSERT INTO referral_income")) {
        return {
          rowCount: 1,
          rows: [{ referrer_token: "referrer-1" }]
        };
      }
      if (sql.includes("INSERT INTO player_wallets")) {
        throw Error("Wallet failure");
      }
      return { rowCount: 1, rows: [] };
    },
    release: () => calls.push("RELEASE")
  });

  try {
    await assert.rejects(
      recordReferralWin("player-1", "match-2", "classic"),
      /Wallet failure/
    );
    assert.ok(calls.includes("ROLLBACK"));
    assert.ok(!calls.includes("COMMIT"));
    assert.ok(calls.includes("RELEASE"));
  } finally {
    pool.connect = original;
  }
});

test("referral income shows total earned across all statuses", async () => {
  const original = pool.query;
  let captured = "";

  pool.query = async (sql, params) => {
    captured = sql;
    assert.deepEqual(params, ["referrer-1"]);
    return { rows: [{ total: "125" }] };
  };

  try {
    assert.equal(await getReferralIncomeTotal("referrer-1"), "125");
    assert.match(captured, /SUM\(income_amount\)/);
    assert.doesNotMatch(captured, /status\s*=/i);
  } finally {
    pool.query = original;
  }
});
