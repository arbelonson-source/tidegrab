import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let srv, base;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tidegrab-err-"));

before(async () => {
  srv = startServer({ port: 0, host: "127.0.0.1", dataDir: dir, fast: true });
  base = `http://127.0.0.1:${await srv.ready}`;
});
after(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function raw(p, { method = "POST", body, type = "application/json", token } = {}) {
  const headers = { "content-type": type };
  if (token) headers.authorization = "Bearer " + token;
  const r = await fetch(base + p, { method, headers, body });
  return { status: r.status, allow: r.headers.get("allow"), json: await r.json() };
}

test("missing and wrong tokens get different answers", async () => {
  const m = (await raw("/api/matches", { body: JSON.stringify({ name: "E", seats: 2, bots: 1 }) })).json;
  const none = await raw(`/api/matches/${m.code}/move`, { body: JSON.stringify({ rest: true }) });
  assert.equal(none.status, 401);
  assert.equal(none.json.code, "no_token");
  const wrong = await raw(`/api/matches/${m.code}/move`, { body: JSON.stringify({ rest: true }), token: "nope" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.code, "bad_token");
  assert.notEqual(none.json.error, wrong.json.error);
});

test("bad bodies say what is wrong", async () => {
  const bad = await raw("/api/matches", { body: "{name:" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "bad_json");
  const arr = await raw("/api/matches", { body: "[1,2]" });
  assert.equal(arr.json.code, "not_object");
  const form = await raw("/api/matches", { body: "name=E&seats=2", type: "application/x-www-form-urlencoded" });
  assert.equal(form.json.code, "form_body");
  assert.match(form.json.error, /JSON/);
});

test("wrong method lists the allowed ones", async () => {
  const r = await raw("/api/rules", { method: "DELETE" });
  assert.equal(r.status, 405);
  assert.equal(r.json.code, "wrong_method");
  assert.ok(r.allow && r.allow.includes("GET"), "Allow header present");
});

test("an unknown move field is named", async () => {
  const m = (await raw("/api/matches", { body: JSON.stringify({ name: "E", seats: 2, bots: 1 }) })).json;
  const r = await raw(`/api/matches/${m.code}/move`, { body: JSON.stringify({ wreck: 99, bid: 2 }), token: m.token });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "bad_move");
  assert.match(r.json.error, /"bid"/);
  assert.ok(Array.isArray(r.json.legal.wrecks));
});
