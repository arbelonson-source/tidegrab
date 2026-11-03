import test from "node:test";
import assert from "node:assert/strict";
import { createGame, resolveTide, checkMove } from "../engine.js";
import { chooseMove, LEVELS } from "../bots/brain.js";
import { Registry, ipKey, MAX_PER_IP, MAX_LIVE_PER_IP } from "../game/registry.js";

test("every bot level plays whole matches with legal moves", () => {
  for (const level of LEVELS) {
    for (let n = 2; n <= 4; n++) {
      const g = createGame(Array.from({ length: n }, (_, i) => "p" + i), 7 + n);
      while (!g.finished) {
        const moves = g.players.map((p) => chooseMove(g, p.seat, level));
        moves.forEach((m, s) => assert.equal(checkMove(g, s, m), null, `${level} made an illegal move`));
        resolveTide(g, moves);
      }
    }
  }
});

test("the hard bot thinks fast", () => {
  const g = createGame(["a", "b", "c", "d"], 3);
  const t = performance.now();
  for (let i = 0; i < 20; i++) chooseMove(g, 0, "hard");
  assert.ok((performance.now() - t) / 20 < 15);
});

test("the hard bot beats normal bots more often than not", () => {
  let wins = 0;
  const games = 120;
  for (let i = 0; i < games; i++) {
    const g = createGame(["hard", "normal"], 100 + i);
    while (!g.finished) resolveTide(g, g.players.map((p) => chooseMove(g, p.seat, p.seat === 0 ? "hard" : "normal")));
    wins += g.winners.includes(0) ? 1 / g.winners.length : 0;
  }
  assert.ok(wins / games > 0.5, `hard won ${wins} of ${games}`);
});

test("one address may hold only a few open lobbies and running matches", () => {
  const r = new Registry();
  for (let i = 0; i < MAX_PER_IP; i++) {
    assert.equal(r.checkCapacity("2001:db8::" + i), null);
    r.reserve("C" + i, "2001:db8::" + i);
  }
  assert.match(r.checkCapacity("2001:db8::99"), /open lobbies/);
  for (let i = 0; i < MAX_PER_IP; i++) r.update({ code: "C" + i, status: "playing" });
  for (let i = MAX_PER_IP; i < MAX_LIVE_PER_IP; i++) {
    assert.equal(r.checkCapacity("2001:db8::" + i), null);
    r.reserve("C" + i, "2001:db8::" + i);
    r.update({ code: "C" + i, status: "playing" });
  }
  assert.match(r.checkCapacity("2001:db8::99"), /matches running/);
  assert.equal(r.checkCapacity("2001:db9::1"), null);
  assert.equal(ipKey("::ffff:10.0.0.1"), "10.0.0.1");
});
