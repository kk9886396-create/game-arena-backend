"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateQrImage,
  MAX_IMAGE_BYTES
} = require("./payment-qr");

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64"
);

test("वास्तविक PNG fixture स्वीकार होती है", () => {
  assert.equal(validateQrImage(png, "image/png"), true);
});

test("गलत MIME type अस्वीकार होता है", () => {
  assert.throws(() => validateQrImage(png, "text/plain"));
});

test("केवल PNG header वाली नकली image अस्वीकार होनी चाहिए", () => {
  const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.throws(() => validateQrImage(fakePng, "image/png"));
});

test("गलत image signature अस्वीकार होती है", () => {
  assert.throws(() =>
    validateQrImage(Buffer.from("not an image"), "image/png")
  );
});

test("खाली image अस्वीकार होती है", () => {
  assert.throws(() =>
    validateQrImage(Buffer.alloc(0), "image/png")
  );
});

test("512 KB से बड़ी image अस्वीकार होती है", () => {
  const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
  assert.throws(() => validateQrImage(big, "image/png"));
});
