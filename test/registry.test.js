import test from "node:test";
import assert from "node:assert/strict";
import { Registry, LIVE_SILENT_MS } from "../game/registry.js";

test("a late playing update cannot bring a finished match back to the live list", () => {
  const r = new Registry();
  const t = Date.now();
  r.reserve("ABCDE", "10.0.0.1");
  r.update({ code: "ABCDE", version: 40, status: "finished", tide: 8, tides: 8, players: ["a", "b"] }, t);
  r.update({ code: "ABCDE", version: 39, status: "playing", tide: 8, tides: 8, players: ["a", "b"] }, t + 10);
  assert.deepEqual(r.list(t + 20).live, []);
  assert.equal(r.count("playing"), 0);
});

test("a live match that stops reporting drops off the list, then out of the registry", () => {
  const r = new Registry();
  const t = Date.now();
  r.reserve("FGHJK", "10.0.0.2");
  r.update({ code: "FGHJK", version: 5, status: "playing", tide: 2, tides: 8, players: ["a", "b"] }, t);
  assert.equal(r.list(t + 1000).live.length, 1);
  assert.equal(r.list(t + LIVE_SILENT_MS + 1000).live.length, 0);
  assert.equal(r.count("playing"), 1);
  r.prune(t + 3 * LIVE_SILENT_MS);
  assert.equal(r.count("playing"), 0);
});

test("finished markers are cleared after a while", () => {
  const r = new Registry();
  const t = Date.now();
  r.reserve("MNPQR", "10.0.0.3");
  r.update({ code: "MNPQR", version: 9, status: "finished" }, t);
  assert.equal(r.items.size, 1);
  r.prune(t + 11 * 60000);
  assert.equal(r.items.size, 0);
});
