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

test("players and watchers send preset emotes, with limits", async () => {
  const { code, token } = (await call("/api/matches", { name: "Host", seats: 3 })).json;
  const st = (await call(`/api/matches/${code}`)).json;
  assert.deepEqual(st.rules.emotes, ["wave", "wow", "lol", "ouch", "gg", "pearl"]);
  assert.deepEqual(st.emotes, []);

  const ok = await call(`/api/matches/${code}/emote`, { emote: "wave" }, token);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.emote.name, "Host");
  assert.equal(ok.json.emote.seat, 0);
  assert.ok(ok.json.version > st.version);

  const again = await call(`/api/matches/${code}/emote`, { emote: "gg" }, token);
  assert.equal(again.status, 429);
  assert.ok(again.json.retryAfterMs > 0 && again.json.retryAfterMs <= 1500);

  const bad = await call(`/api/matches/${code}/emote`, { emote: "shout" });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /wave, wow/);
  assert.equal((await call(`/api/matches/${code}/emote`, { emote: "wow" }, "nope")).status, 401);

  for (let i = 0; i < 5; i++) assert.equal((await call(`/api/matches/${code}/emote`, { emote: "lol" })).status, 200);
  const flood = await call(`/api/matches/${code}/emote`, { emote: "lol" });
  assert.equal(flood.status, 429);

  const after = (await call(`/api/matches/${code}`)).json;
  assert.equal(after.emotes.length, 6);
  assert.equal(after.emotes[0].emote, "wave");
  assert.equal(after.emotes[5].name, "A watcher");
  assert.equal(after.emotes[5].seat, null);
  assert.equal(new Set(after.emotes.map((e) => e.id)).size, 6);
});

test("an emote wakes a long-poll and a wait ahead of the version answers at once", async () => {
  const { code, token } = (await call("/api/matches", { name: "Host", seats: 3 })).json;
  const { version } = (await call(`/api/matches/${code}`)).json;
  const t0 = Date.now();
  const poll = call(`/api/matches/${code}?wait=${version}`);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await call(`/api/matches/${code}/emote`, { emote: "pearl" }, token)).status, 200);
  const woke = await poll;
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(woke.json.emotes.at(-1).emote, "pearl");

  const t1 = Date.now();
  const ahead = await call(`/api/matches/${code}?wait=${woke.json.version + 50}`);
  assert.equal(ahead.status, 200);
  assert.ok(Date.now() - t1 < 3000);
});

test("watchers are counted by viewer id, seated players are not", async () => {
  const { code, token } = (await call("/api/matches", { name: "Host", seats: 3 })).json;
  assert.equal((await call(`/api/matches/${code}`)).json.watching, 0);
  assert.equal((await call(`/api/matches/${code}?viewer=watcher1`)).json.watching, 1);
  assert.equal((await call(`/api/matches/${code}?viewer=watcher1`)).json.watching, 1);
  assert.equal((await call(`/api/matches/${code}?viewer=watcher2`)).json.watching, 2);
  assert.equal((await call(`/api/matches/${code}?viewer=hostseat`, null, token)).json.watching, 2);
  const bad = await call(`/api/matches/${code}?viewer=a!`);
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /viewer/);
});
