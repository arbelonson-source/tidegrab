import test from "node:test";
import assert from "node:assert/strict";
import { createGame, checkMove, resolveTide, winners, RULES, EVENTS } from "../engine.js";

const dive = (wreck, air) => ({ wreck, air });
const rest = { rest: true };
const calm = (g) => { g.forecast = g.forecast.map(() => "calm"); return g; };

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
  const g = calm(createGame(["a", "b"], 3));
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
  const g = calm(createGame(["a", "b"], 3));
  const w = g.wrecks[0];
  const pearls = w.pearls;
  resolveTide(g, [dive(w.id, 2), dive(w.id, 2)]);
  assert.equal(g.players[0].pearls + g.players[1].pearls, 0);
  const again = g.wrecks.find((x) => x.id === w.id);
  assert.equal(again.pearls, pearls + RULES.growth);
});

test("rest gives air, capped at the maximum", () => {
  const g = calm(createGame(["a", "b"], 3));
  resolveTide(g, [rest, rest]);
  assert.equal(g.players[0].air, RULES.startAir + RULES.restGain + RULES.tideGain);
  for (let i = 0; i < 4 && !g.finished; i++) resolveTide(g, [rest, rest]);
  assert.equal(g.players[0].air, RULES.maxAir);
});

test("illegal moves are rejected", () => {
  const g = calm(createGame(["a", "b"], 3));
  assert.ok(checkMove(g, 0, dive(g.wrecks[0].id, 0)));
  assert.ok(checkMove(g, 0, dive(g.wrecks[0].id, RULES.startAir + 1)));
  assert.ok(checkMove(g, 0, dive(999, 1)));
  assert.ok(!checkMove(g, 0, dive(g.wrecks[0].id, 1)));
  assert.ok(!checkMove(g, 0, rest));
});

test("match ends after the last tide with winners", () => {
  const g = calm(createGame(["a", "b"], 5));
  let n = 0;
  while (!g.finished) {
    resolveTide(g, [dive(g.wrecks[0].id, 1), rest]);
    n++;
  }
  assert.equal(n, RULES.tides);
  assert.ok(winners(g).length >= 1);
});

test("tie on pearls is broken by remaining air", () => {
  const g = calm(createGame(["a", "b"], 5));
  while (!g.finished) resolveTide(g, [rest, rest]);
  g.players[0].air = 4;
  g.players[1].air = 2;
  assert.deepEqual(winners(g), [0]);
  g.players[1].air = 4;
  assert.deepEqual(winners(g), [0, 1]);
});

test("the final tide pays double", () => {
  const g = calm(createGame(["a", "b"], 5));
  while (g.tide < g.tides) resolveTide(g, [{ rest: true }, { rest: true }]);
  const w = g.wrecks[0];
  const before = g.players[0].pearls;
  const ev = resolveTide(g, [dive(w.id, 1), { rest: true }]);
  assert.equal(ev.payout, RULES.finalPayout);
  assert.equal(g.players[0].pearls - before, w.pearls * RULES.finalPayout);
  assert.equal(g.finished, true);
});

test("tide events: four dealt from the seed, never on the final tide", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const f = createGame(["a", "b", "c"], seed).forecast;
    assert.equal(f.length, RULES.tides);
    assert.equal(f.filter((e) => e !== "calm").length, RULES.eventTides);
    assert.equal(f[RULES.tides - 1], "calm");
    for (const e of f) assert.ok(e in EVENTS);
  }
  assert.deepEqual(createGame(["a", "b"], 9).forecast, createGame(["x", "y"], 9).forecast);
});

test("strong current and slack water change the Air flow", () => {
  const g = calm(createGame(["a", "b"], 3));
  g.forecast[0] = "current";
  resolveTide(g, [rest, rest]);
  assert.equal(g.players[0].air, RULES.startAir + RULES.currentRest + RULES.tideGain);
  g.forecast[1] = "slack";
  const air = g.players[1].air;
  resolveTide(g, [dive(g.wrecks[0].id, 2), dive(g.wrecks[0].id, 2)]);
  assert.equal(g.players[1].air, air - 2);
});

test("bloom gives every wreck an air pocket and a rich seam adds pearls", () => {
  const g = calm(createGame(["a", "b", "c", "d"], 3));
  g.forecast[1] = "bloom";
  g.forecast[2] = "seam";
  const w = g.wrecks[0];
  resolveTide(g, [dive(w.id, 1), rest, rest, rest]);
  assert.ok(g.wrecks.every((x) => x.air === RULES.airPocket));
  const fresh = g.wrecks.find((x) => x.age === 0);
  const pearls = fresh.pearls;
  resolveTide(g, [dive(fresh.id, 1), rest, rest, rest]);
  const seam = g.wrecks.find((x) => x.age === 0);
  assert.ok(seam.pearls >= 1 + RULES.seamBonus || seam.pearls === RULES.maxPearls);
  assert.notEqual(seam.id, fresh.id);
  assert.ok(pearls >= 1);
});

test("old saved games without a forecast still play as calm", () => {
  const g = createGame(["a", "b"], 3);
  delete g.forecast;
  resolveTide(g, [rest, rest]);
  assert.equal(g.players[0].air, RULES.startAir + RULES.restGain + RULES.tideGain);
});
