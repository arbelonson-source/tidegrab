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

test("rematch keeps the table together", async () => {
  const a = (await call("/api/matches", { name: "Ann", seats: 3, bots: 1 })).json;
  const b = (await call(`/api/matches/${a.code}/join`, { name: "Ben" })).json;
  const early = await call(`/api/matches/${a.code}/rematch`, {}, a.token);
  assert.equal(early.status, 409);
  assert.equal(early.json.code, "not_over");
  for (let i = 0; i < 200; i++) {
    const s = (await call(`/api/matches/${a.code}`, undefined, a.token)).json;
    if (s.status === "finished") break;
    for (const t of [a.token, b.token]) if (s.status === "playing") await call(`/api/matches/${a.code}/move`, { rest: true }, t);
    await new Promise((r) => setTimeout(r, 20));
  }
  const late = await call(`/api/matches/${a.code}/join`, { name: "Cat" });
  assert.equal(late.status, 409);
  assert.equal(late.json.code, "match_over");
  assert.equal((await call(`/api/matches/${a.code}/rematch`, {})).status, 401);
  const ra = (await call(`/api/matches/${a.code}/rematch`, {}, a.token)).json;
  assert.match(ra.code, /^[A-Z0-9]{5}$/);
  assert.notEqual(ra.code, a.code);
  assert.deepEqual((await call(`/api/matches/${a.code}/rematch`, {}, a.token)).json, ra);
  const old = (await call(`/api/matches/${a.code}`, undefined, b.token)).json;
  assert.equal(old.rematch, ra.code);
  const lobby = (await call(`/api/matches/${ra.code}`, undefined, ra.token)).json;
  assert.equal(lobby.status, "lobby");
  assert.equal(lobby.seats.filter(Boolean).length, 2);
  const rb = (await call(`/api/matches/${a.code}/rematch`, {}, b.token)).json;
  assert.equal(rb.code, ra.code);
  const s = (await call(`/api/matches/${ra.code}`, undefined, rb.token)).json;
  assert.equal(s.status, "playing");
  assert.deepEqual(s.players.map((p) => p.name).sort(), ["Ann", "Ben", s.players.find((p) => p.kind === "bot").name].sort());
  assert.equal((await call(`/api/matches/${a.code}/rematch:set`, { code: "ZZZZZ" }, a.token)).status, 404);
});

test("a rematch against bots brings back the same bots", async () => {
  const m = (await call("/api/matches", { name: "Solo", seats: 3, bots: 2, turnSeconds: 5, botLevel: "easy" })).json;
  let st;
  for (let i = 0; i < 200; i++) {
    st = (await call(`/api/matches/${m.code}`, undefined, m.token)).json;
    if (st.status === "finished") break;
    if (st.you && st.you.legal && !st.you.move) await call(`/api/matches/${m.code}/move`, { rest: true }, m.token);
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.equal(st.status, "finished", JSON.stringify(st).slice(0, 200));
  const before = st.players.filter((p) => p.kind === "bot").map((p) => [p.name, p.level]);
  const r = (await call(`/api/matches/${m.code}/rematch`, {}, m.token)).json;
  const next = (await call(`/api/matches/${r.code}`, undefined, r.token)).json;
  const now = next.players.filter((p) => p.kind === "bot").map((p) => [p.name, p.level]);
  assert.deepEqual(now, before);
});
