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

test("move shapes: rest:false dives, mixed or empty moves explain themselves", async () => {
  const { json } = await call("/api/matches", { name: "T", seats: 2, bots: 1 });
  let st;
  for (let i = 0; i < 100; i++) {
    st = (await call(`/api/matches/${json.code}?wait=0`, null, json.token)).json;
    if (st.status === "playing" && !(st.pauseUntil > st.serverTime)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const id = st.wrecks[0].id;
  const empty = await call(`/api/matches/${json.code}/move`, {}, json.token);
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /empty move/);
  assert.ok(empty.json.legal);
  const mixed = await call(`/api/matches/${json.code}/move`, { rest: true, wreck: id, air: 1 }, json.token);
  assert.match(mixed.json.error, /not both/);
  const odd = await call(`/api/matches/${json.code}/move`, { rest: "yes" }, json.token);
  assert.match(odd.json.error, /rest must be true/);
  const unknown = await call(`/api/matches/${json.code}/move`, { wreckId: id, bid: 1 }, json.token);
  assert.match(unknown.json.error, /unknown field "wreckId"/);
  const strings = await call(`/api/matches/${json.code}/move`, { wreck: String(id), air: "2" }, json.token);
  assert.deepEqual(strings.json.move, { wreck: id, air: 2 });
  const ok = await call(`/api/matches/${json.code}/move`, { rest: false, wreck: id, air: 1 }, json.token);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.move, { wreck: id, air: 1 });
  assert.equal((await call(`/api/matches/${json.code}?wait=abc`, null, json.token)).status, 400);
  assert.equal((await call(`/api/matches/${json.code}/log`)).json.seed, null);
});

test("joining a full running match says so", async () => {
  const { json } = await call("/api/matches", { name: "T", seats: 2, bots: 1 });
  const j = await call(`/api/matches/${json.code}/join`, { name: "Late" });
  assert.equal(j.status, 400);
  assert.match(j.json.error, /full/);
  const nf = await call("/api/matches/QQQQQ");
  assert.match(nf.json.error, /QQQQQ/);
});

test("one address can only hold a few open lobbies", async () => {
  const codes = [];
  let last;
  for (let i = 0; i < 8; i++) {
    last = await call("/api/matches", { name: "Spam", seats: 4 });
    if (last.status !== 200) break;
    codes.push(last.json.code);
  }
  assert.equal(last.status, 429);
  assert.ok(codes.length <= 5);
});

test("openapi description lists every endpoint", async () => {
  const r = await call("/api/openapi.json");
  assert.equal(r.status, 200);
  assert.equal(r.json.openapi, "3.1.0");
  for (const p of ["/api/rules", "/api/matches", "/api/matches/{code}", "/api/matches/{code}/join", "/api/matches/{code}/bots", "/api/matches/{code}/start", "/api/matches/{code}/move", "/api/matches/{code}/log", "/healthz"]) assert.ok(r.json.paths[p], p);
  const refs = JSON.stringify(r.json).match(/#\/components\/schemas\/\w+/g);
  for (const ref of refs) assert.ok(r.json.components.schemas[ref.split("/").pop()], ref);
});
