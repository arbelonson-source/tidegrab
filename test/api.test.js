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

test("full match against a bot via the API", async () => {
  const c = await call("/api/matches", { name: "Tester", seats: 2, bots: 1 });
  assert.equal(c.status, 200);
  const { code, token } = c.json;
  let ver = 0, st;
  for (let guard = 0; guard < 400; guard++) {
    st = (await call(`/api/matches/${code}?wait=${ver}`, null, token)).json;
    ver = st.version;
    if (st.status === "finished") break;
    if (st.status === "playing" && !st.you.move && !(st.pauseUntil > st.serverTime)) {
      const l = st.you.legal;
      const move = l.maxAir >= 1 && st.wrecks.length ? { wreck: st.wrecks[0].id, air: 1 } : { rest: true };
      assert.equal((await call(`/api/matches/${code}/move`, move, token)).status, 200);
    }
  }
  assert.equal(st.status, "finished");
  assert.ok(st.winners.length >= 1);
  const log = (await call(`/api/matches/${code}/log`)).json;
  assert.equal(log.rounds.length, 8);
  assert.equal(log.names[0], "Tester");
});

test("illegal move and bad token", async () => {
  const { json } = await call("/api/matches", { name: "T", seats: 2, bots: 1 });
  const bad = await call(`/api/matches/${json.code}/move`, { wreck: 9999, air: 1 }, json.token);
  assert.equal(bad.status, 400);
  assert.ok(bad.json.error);
  const noTok = await call(`/api/matches/${json.code}/move`, { rest: true });
  assert.equal(noTok.status, 401);
  assert.equal((await call("/api/matches/ZZZZZ")).status, 404);
});

test("lobby: join, add bots, start", async () => {
  const c = (await call("/api/matches", { name: "Host", seats: 3 })).json;
  let s = (await call(`/api/matches/${c.code}`, null, c.token)).json;
  assert.equal(s.status, "lobby");
  const j = await call(`/api/matches/${c.code}/join`, { name: "Guest" });
  assert.equal(j.status, 200);
  assert.equal((await call(`/api/matches/${c.code}/start`, {}, j.json.token)).status, 403);
  const open = (await call("/api/matches")).json.open;
  assert.ok(open.some((m) => m.code === c.code));
  assert.equal((await call(`/api/matches/${c.code}/start`, {}, c.token)).status, 200);
  s = (await call(`/api/matches/${c.code}`, null, c.token)).json;
  assert.equal(s.status, "playing");
  assert.equal(s.players.length, 3);
  assert.equal(s.players.filter((p) => p.kind === "bot").length, 1);
});

test("rules and health endpoints", async () => {
  assert.equal((await call("/healthz")).json.ok, true);
  assert.equal((await call("/api/rules")).json.tides, 8);
});
