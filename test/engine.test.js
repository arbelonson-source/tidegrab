import test from "node:test";
import assert from "node:assert/strict";
import { createGame, checkMove, resolveTide, winners, RULES } from "../engine.js";

const dive = (wreck, air) => ({ wreck, air });
const rest = { rest: true };

test("setup: wreck count and starting air", () => {
  assert.equal(createGame(["a", "b"], 1).wrecks.length, 2);
  assert.equal(createGame(["a", "b", "c"], 1).wrecks.length, 2);
  assert.equal(createGame(["a", "b", "c", "d"], 1).wrecks.length, 3);
  assert.equal(createGame(["a", "b"], 1).players[0].air, RULES.startAir);
});

test("determinism from seed", () => {
  const run = (seed) => {
    const g = createGame(["a", "b", "c"], seed);
    const out = [];
    while (!g.finished) {
      const w = g.wrecks[0].id;
      out.push(resolveTide(g, [dive(w, 1), rest, dive(w, 2)]));
    }
    return JSON.stringify([out, g.players]);
  };
  assert.equal(run(7), run(7));
  assert.notEqual(run(7), run(8));
});

test("highest spender wins the wreck and spent air is gone", () => {
  const g = createGame(["a", "b"], 3);
  const w = g.wrecks[0];
  const pearls = w.pearls;
  const pocket = w.air;
  resolveTide(g, [dive(w.id, 3), dive(w.id, 2)]);
  assert.equal(g.players[0].pearls, pearls);
  assert.equal(g.players[1].pearls, 0);
  assert.equal(g.players[0].air, RULES.startAir - 3 + RULES.tideGain + pocket);
  assert.equal(g.players[1].air, RULES.startAir - 2 + RULES.tideGain);
});

test("tie at the top: nobody wins, wreck grows", () => {
  const g = createGame(["a", "b"], 3);
  const w = g.wrecks[0];
  const pearls = w.pearls;
  resolveTide(g, [dive(w.id, 2), dive(w.id, 2)]);
  assert.equal(g.players[0].pearls + g.players[1].pearls, 0);
  const again = g.wrecks.find((x) => x.id === w.id);
  assert.equal(again.pearls, pearls + RULES.growth);
});

test("rest gives air, capped at the maximum", () => {
  const g = createGame(["a", "b"], 3);
  resolveTide(g, [rest, rest]);
  assert.equal(g.players[0].air, RULES.startAir + RULES.restGain + RULES.tideGain);
  for (let i = 0; i < 4 && !g.finished; i++) resolveTide(g, [rest, rest]);
  assert.equal(g.players[0].air, RULES.maxAir);
});

test("illegal moves are rejected", () => {
  const g = createGame(["a", "b"], 3);
  assert.ok(checkMove(g, 0, dive(g.wrecks[0].id, 0)));
  assert.ok(checkMove(g, 0, dive(g.wrecks[0].id, RULES.startAir + 1)));
  assert.ok(checkMove(g, 0, dive(999, 1)));
  assert.ok(!checkMove(g, 0, dive(g.wrecks[0].id, 1)));
  assert.ok(!checkMove(g, 0, rest));
});

test("match ends after the last tide with winners", () => {
  const g = createGame(["a", "b"], 5);
  let n = 0;
  while (!g.finished) {
    resolveTide(g, [dive(g.wrecks[0].id, 1), rest]);
    n++;
  }
  assert.equal(n, RULES.tides);
  assert.ok(winners(g).length >= 1);
});

test("tie on pearls is broken by remaining air", () => {
  const g = createGame(["a", "b"], 5);
  while (!g.finished) resolveTide(g, [rest, rest]);
  g.players[0].air = 4;
  g.players[1].air = 2;
  assert.deepEqual(winners(g), [0]);
  g.players[1].air = 4;
  assert.deepEqual(winners(g), [0, 1]);
});
