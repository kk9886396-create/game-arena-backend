const SAFE_SQUARES = [0, 8, 13, 21, 26, 34, 39, 47];

function nextPosition(pos, dice) {
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    return { ok: false, error: "पासे का अंक गलत है" };
  }

  if (pos === -1) {
    return dice === 6
      ? { ok: true, next: 0 }
      : { ok: false, error: "गोटी निकालने के लिए 6 चाहिए" };
  }

  if (!Number.isInteger(pos) || pos < 0 || pos > 52) {
    return { ok: false, error: "गोटी की स्थिति गलत है" };
  }

  const next = pos + dice;
  if (next > 52) {
    return { ok: false, error: "घर तक पहुँचने के लिए सही अंक चाहिए" };
  }

  return { ok: true, next };
}

module.exports = { SAFE_SQUARES, nextPosition };
