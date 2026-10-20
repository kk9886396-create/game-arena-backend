function makePlayerId() {
  return "GA" + require("crypto").randomBytes(4).toString("hex").toUpperCase();
}

function makeReferralCode() {
  return require("crypto").randomBytes(4).toString("hex").toUpperCase();
}

module.exports = { makePlayerId, makeReferralCode };
