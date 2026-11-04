import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let srv, base;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tidegrab-"));

before(async () => {
  srv = startServer({ port: 0, host: "127.0.0.1", dataDir: dir, fast: true });
  base = `http://127.0.0.1:${await srv.ready}`;
});
after(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(p, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  const r = await fetch(base + p, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
}

test("broken JSON without a content type is called broken JSON, not a form", async () => {
  for (const text of ['{"wreck": 1, "air"', "[1, 2"]) {
    const r = await fetch(base + "/api/matches", { method: "POST", body: text, headers: { "content-type": "application/x-www-form-urlencoded" } });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, "bad_json");
  }
  const f = await fetch(base + "/api/matches", { method: "POST", body: "name=Ann&seats=2", headers: { "content-type": "application/x-www-form-urlencoded" } });
  const fj = await f.json();
  assert.equal(fj.code, "form_body");
  assert.match(fj.error, /\{"name":"Ann","seats":2\}/);
});

test("one table can mix bot levels", async () => {
  const a = (await call("/api/matches", { name: "Ann", seats: 4, botLevel: "easy" })).json;
  const bad = await call(`/api/matches/${a.code}/bots`, { level: "godlike" }, a.token);
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /easy, normal, hard/);
  await call(`/api/matches/${a.code}/bots`, { count: 1, level: "hard" }, a.token);
  await call(`/api/matches/${a.code}/bots`, { count: 1 }, a.token);
  const s = (await call(`/api/matches/${a.code}/bots`, { count: 1, level: "normal" }, a.token)).json;
  assert.equal(s.status, "playing");
  const bots = s.players.filter((p) => p.kind === "bot").map((p) => p.level);
  assert.deepEqual(bots, ["hard", "easy", "normal"]);
  assert.equal(s.players.find((p) => p.kind === "human").level, undefined);
  assert.deepEqual(s.seats.filter((x) => x && x.kind === "bot").map((x) => x.level), ["hard", "easy", "normal"]);
});

test("a move for an old tide is refused with stale_tide", async () => {
  const a = (await call("/api/matches", { name: "Ann", seats: 2, bots: 1 })).json;
  let s = (await call(`/api/matches/${a.code}`, undefined, a.token)).json;
  assert.equal(s.tide, 1);
  const ok = await call(`/api/matches/${a.code}/move`, { rest: true, tide: 1 }, a.token);
  assert.equal(ok.status, 200);
  for (let i = 0; i < 100 && s.tide === 1; i++) {
    await new Promise((r) => setTimeout(r, 20));
    s = (await call(`/api/matches/${a.code}`, undefined, a.token)).json;
  }
  assert.ok(s.tide >= 2);
  const old = await call(`/api/matches/${a.code}/move`, { rest: true, tide: 1 }, a.token);
  assert.equal(old.status, 409);
  assert.equal(old.json.code, "stale_tide");
  assert.equal(old.json.tide, s.tide);
  assert.ok(old.json.legal);
  const odd = await call(`/api/matches/${a.code}/move`, { rest: true, tide: "soon" }, a.token);
  assert.equal(odd.status, 400);
  assert.equal(odd.json.code, "bad_move");
  const str = await call(`/api/matches/${a.code}/move`, { rest: true, tide: String(s.tide) }, a.token);
  assert.equal(str.status, 200);
  const none = await call(`/api/matches/${a.code}/move`, { rest: true }, a.token);
  assert.equal(none.status, 200);
});
