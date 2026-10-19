module.exports = function (io, rooms, colors, emit) {
  const { nextPosition } = require("./ludo-rules");
  const timers = new Map();

  function stop(code) {
    if (timers.has(code)) clearTimeout(timers.get(code));
    timers.delete(code);
  }

  function start(r) {
    stop(r.code);
    if (!r || r.players.length !== 2 || r.state.winner) return;

    r.state.turnEndsAt = Date.now() + 25000;
    emit(r);

    const timer = setTimeout(() => {
      timers.delete(r.code);
      if (!rooms.has(r.code) || r.state.winner) return;

      const st = r.state;
      const i = st.turn;
      const c = colors[i];

      if (st.dice === null) st.dice = require("crypto").randomInt(1, 7);

      const die = st.dice;
      const pawns = st.pawns[c];
      const choices = pawns
        .map((pos, p) => ({pos, p, next: (nextPosition(pos, die).ok ? nextPosition(pos, die).next : -1)}))
        .filter(x => x.next >= 0 && x.next <= 52);

      if (choices.length) {
        const chosen = choices[0];
        pawns[chosen.p] = chosen.next;

        if (pawns.every(x => x === 52)) {
          st.winner = c;
          st.message = c + " खिलाड़ी जीत गया (ऑटो चाल)";
        } else {
          st.message = "समय पूरा! " + c + " की गोटी " + (chosen.p + 1) + " अपने-आप चली।";
          if (die !== 6) st.turn = 1 - st.turn;
        }
      } else {
        st.message = "समय पूरा! कोई चाल संभव नहीं, अब दूसरे खिलाड़ी की बारी।";
        st.dice = null;
        st.turn = 1 - st.turn;
      }

      st.dice = null;
      st.turnEndsAt = null;
      emit(r);
      if (!st.winner) start(r);
    }, 25000);

    timers.set(r.code, timer);
  }

  return { start, stop };
};
