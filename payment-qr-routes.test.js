"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const {
  registerPaymentQrRoutes
} = require("./payment-qr");

test("Payment QR API integration (fake database)", async (t) => {
  const oldToken = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = "qr-test-token-only";

  let savedImage = null;
  let savedMime = null;

  const fakePool = {
    async query(sql, params) {
      if (sql.includes("SELECT image_data, mime_type")) {
        return savedImage
          ? {
              rowCount: 1,
              rows: [{
                image_data: savedImage,
                mime_type: savedMime
              }]
            }
          : { rowCount: 0, rows: [] };
      }

      if (sql.includes("INSERT INTO payment_qr_settings")) {
        savedImage = Buffer.from(params[0]);
        savedMime = params[1];
        return { rowCount: 1, rows: [] };
      }

      throw new Error("Unexpected fake database query");
    }
  };

  const app = express();
  registerPaymentQrRoutes(app, fakePool);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (oldToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = oldToken;
  });

  await t.test("QR न होने पर GET 404 देता है", async () => {
    const res = await fetch(`${base}/api/payment-qr`);
    assert.equal(res.status, 404);
  });

  await t.test("गलत admin token पर upload रोकता है", async () => {
    const res = await fetch(`${base}/api/admin/payment-qr`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Admin-Token": "wrong-token"
      },
      body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    });
    assert.equal(res.status, 401);
  });

  await t.test("गलत image signature अस्वीकार होती है", async () => {
    const res = await fetch(`${base}/api/admin/payment-qr`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Admin-Token": "qr-test-token-only"
      },
      body: Buffer.from("not-a-real-png")
    });
    assert.equal(res.status, 400);
  });

  await t.test("सही PNG upload होकर GET से मिलती है", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64"
    );

    const upload = await fetch(`${base}/api/admin/payment-qr`, {
      method: "POST",
      headers: {
        "Content-Type": "image/png",
        "X-Admin-Token": "qr-test-token-only"
      },
      body: png
    });

    assert.equal(upload.status, 200);
    assert.equal((await upload.json()).ok, true);

    const read = await fetch(`${base}/api/payment-qr`);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("content-type"), "image/png");
    assert.equal(read.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
  });
});
