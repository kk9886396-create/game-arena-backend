"use strict";

const crypto = require("crypto");
const express = require("express");

const MAX_IMAGE_BYTES = 512 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isValidPng(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(signature)) {
    return false;
  }

  let offset = 8;
  let chunkIndex = 0;
  let hasHeader = false;
  let hasData = false;
  let hasEnd = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length - offset - 12) return false;

    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const crcOffset = dataStart + length;
    const type = buffer.toString("ascii", typeStart, dataStart);
    const crcInput = buffer.subarray(typeStart, crcOffset);
    const expectedCrc = buffer.readUInt32BE(crcOffset);

    if (pngCrc32(crcInput) !== expectedCrc) return false;

    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) return false;
      hasHeader = true;
    } else if (type === "IHDR") {
      return false;
    }

    if (type === "IDAT") hasData = true;

    offset = crcOffset + 4;
    chunkIndex++;

    if (type === "IEND") {
      if (length !== 0 || offset !== buffer.length) return false;
      hasEnd = true;
      break;
    }
  }

  return hasHeader && hasData && hasEnd;
}

function validateQrImage(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("QR image खाली है");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("QR image अधिकतम 512 KB की हो सकती है");
  }

  let valid = false;

  if (mimeType === "image/png") {
    valid = isValidPng(buffer);
  } else if (mimeType === "image/jpeg") {
    valid = buffer.length >= 4 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[buffer.length - 2] === 0xff &&
      buffer[buffer.length - 1] === 0xd9;
  } else if (mimeType === "image/webp") {
    valid = buffer.length >= 20 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP" &&
      buffer.readUInt32LE(4) + 8 === buffer.length;
  }

  if (!IMAGE_TYPES.includes(mimeType) || !valid) {
    throw new Error("केवल सही PNG, JPEG या WEBP image स्वीकार है");
  }

  return true;
}
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN || "";
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

async function initPaymentQrDB(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_qr_settings (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      image_data BYTEA NOT NULL,
      mime_type VARCHAR(32) NOT NULL
        CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function registerPaymentQrRoutes(app, pool) {
  app.get("/api/payment-qr", async (_req, res) => {
    try {
      const result = await pool.query(
        "SELECT image_data, mime_type FROM payment_qr_settings WHERE id = 1"
      );

      if (!result.rowCount) {
        return res.status(404).type("text/plain")
          .send("Admin ने अभी QR image सेट नहीं की है");
      }

      res.set("Cache-Control", "no-store");
      res.set("X-Content-Type-Options", "nosniff");
      res.type(result.rows[0].mime_type);
      return res.send(result.rows[0].image_data);
    } catch (err) {
      console.error("Payment QR read failed:", err.message);
      return res.status(500).json({
        ok: false,
        error: "QR image अभी उपलब्ध नहीं है"
      });
    }
  });

  app.post(
    "/api/admin/payment-qr",
    requireAdmin,
    express.raw({ type: IMAGE_TYPES, limit: MAX_IMAGE_BYTES }),
    async (req, res) => {
      try {
        validateQrImage(req.body, req.get("Content-Type"));

        await pool.query(
          `INSERT INTO payment_qr_settings
             (id, image_data, mime_type, updated_at)
           VALUES (1, $1, $2, NOW())
           ON CONFLICT (id) DO UPDATE SET
             image_data = EXCLUDED.image_data,
             mime_type = EXCLUDED.mime_type,
             updated_at = NOW()`,
          [req.body, req.get("Content-Type")]
        );

        return res.json({ ok: true, message: "QR image सेव हो गई" });
      } catch (err) {
        if (
          err.message.includes("QR image") ||
          err.message.includes("PNG")
        ) {
          return res.status(400).json({ ok: false, error: err.message });
        }

        console.error("Payment QR save failed:", err.message);
        return res.status(500).json({
          ok: false,
          error: "QR image सेव नहीं हो सकी"
        });
      }
    }
  );
}

module.exports = {
  initPaymentQrDB,
  registerPaymentQrRoutes,
  validateQrImage,
  MAX_IMAGE_BYTES
};
