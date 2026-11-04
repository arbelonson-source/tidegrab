import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let srv, base, spec;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tidegrab-contract-"));

before(async () => {
  srv = startServer({ port: 0, host: "127.0.0.1", dataDir: dir, fast: true });
  base = `http://127.0.0.1:${await srv.ready}`;
  spec = (await call("/api/openapi.json")).json;
});
after(async () => {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(p, body, token, method) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  const r = await fetch(base + p, { method: method || (body ? "POST" : "GET"), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json() };
}

// A small checker for the parts of JSON Schema the spec uses: $ref, oneOf, type (or list of types),
// enum, required, properties and items. Returns a list of problems with their paths.
function check(schema, value, where = "$", out = []) {
  if (schema.$ref) return check(spec.components.schemas[schema.$ref.split("/").pop()], value, where, out);
  if (schema.oneOf) {
    const fits = schema.oneOf.filter((s) => check(s, value, where, []).length === 0);
    if (fits.length !== 1) out.push(`${where}: matches ${fits.length} of oneOf`);
    return out;
  }
  if (schema.enum && !schema.enum.includes(value)) out.push(`${where}: ${JSON.stringify(value)} not in enum`);
  if (schema.type) {
    const types = [].concat(schema.type);
    const kind = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
    if (!types.includes(kind) && !(kind === "integer" && types.includes("number"))) {
      out.push(`${where}: expected ${types.join("|")}, got ${kind}`);
      return out;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) out.push(`${where}: missing ${k}`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in value) check(s, value[k], `${where}.${k}`, out);
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => check(schema.items, v, `${where}[${i}]`, out));
  return out;
}

function fits(pathKey, method, status, value) {
  const resp = spec.paths[pathKey][method].responses[status];
  assert.ok(resp, `spec has no ${status} for ${method.toUpperCase()} ${pathKey}`);
  const problems = check(resp.content["application/json"].schema, value);
  assert.deepEqual(problems, [], `${method.toUpperCase()} ${pathKey} ${status}`);
}

test("the checker itself catches wrong answers", async () => {
  const st = (await call("/api/matches/ZZZZZ")).json;
  const schema = spec.paths["/api/matches/{code}"].get.responses[200].content["application/json"].schema;
  assert.ok(check(schema, st).some((p) => p.includes("missing version")));
  assert.ok(check({ $ref: "#/components/schemas/Wreck" }, { id: 1, pearls: "3", air: 0, age: 0 }).length > 0);
  assert.ok(check({ $ref: "#/components/schemas/Error" }, { error: "x", code: "made_up" }).length > 0);
});

test("every path has an operationId and every endpoint in /api is described", async () => {
  for (const [p, ops] of Object.entries(spec.paths)) for (const [m, op] of Object.entries(ops)) assert.ok(op.operationId, `${m} ${p}`);
  const index = (await call("/api")).json;
  fits("/api", "get", 200, index);
  for (const e of index.endpoints) {
    const [method, p] = e.split(" ");
    const key = p.split("?")[0].replace(/CODE|:code|\{code\}/, "{code}");
    assert.ok(spec.paths[key]?.[method.toLowerCase()], `missing ${e}`);
  }
});

test("real answers match the spec through a whole match", async () => {
  fits("/api/rules", "get", 200, (await call("/api/rules")).json);
  fits("/healthz", "get", 200, (await call("/healthz")).json);

  const host = await call("/api/matches", { name: "Host", seats: 3, bots: 0 });
  fits("/api/matches", "post", 200, host.json);
  const { code, token } = host.json;
  fits("/api/matches/{code}", "get", 200, (await call(`/api/matches/${code}`, null, token)).json);
  fits("/api/matches", "get", 200, (await call("/api/matches")).json);

  const guest = await call(`/api/matches/${code}/join`, { name: "Guest" });
  fits("/api/matches/{code}/join", "post", 200, guest.json);
  fits("/api/matches/{code}/bots", "post", 200, (await call(`/api/matches/${code}/bots`, { count: 1 }, token)).json);
  // The last seat is filled, so the match starts on its own; starting again is a conflict.
  const again = await call(`/api/matches/${code}/start`, {}, token);
  assert.equal(again.status, 409);
  fits("/api/matches/{code}/start", "post", 409, again.json);

  const emote = await call(`/api/matches/${code}/emote`, { emote: "wave" }, token);
  fits("/api/matches/{code}/emote", "post", 200, emote.json);

  let ver = 0, st, sawReveal = false;
  for (let guard = 0; guard < 400; guard++) {
    st = (await call(`/api/matches/${code}?wait=${ver}`, null, token)).json;
    fits("/api/matches/{code}", "get", 200, st);
    if (st.lastReveal) sawReveal = true;
    ver = st.version;
    if (st.status === "finished") break;
    if (st.status === "playing" && !st.you.move && !(st.pauseUntil > st.serverTime)) {
      const move = st.you.legal.maxAir >= 1 && st.wrecks.length ? { wreck: st.wrecks[0].id, air: 1 } : { rest: true };
      const r = await call(`/api/matches/${code}/move`, move, token);
      fits("/api/matches/{code}/move", "post", 200, r.json);
      // The guest rests, so every tide has someone who did not dive.
      await call(`/api/matches/${code}/move`, { rest: true }, guest.json.token);
    }
  }
  assert.equal(st.status, "finished");
  assert.ok(sawReveal);
  fits("/api/matches/{code}/log", "get", 200, (await call(`/api/matches/${code}/log`)).json);

  const late = await call(`/api/matches/${code}/move`, { rest: true }, token);
  assert.equal(late.status, 409);
  fits("/api/matches/{code}/move", "post", 409, late.json);
  fits("/api/matches/{code}/rematch", "post", 200, (await call(`/api/matches/${code}/rematch`, {}, token)).json);
});

test("error answers match the spec", async () => {
  const m = (await call("/api/matches", { name: "E", seats: 2, bots: 1 })).json;
  const bad = await call(`/api/matches/${m.code}/move`, { wreck: 999, air: 1 }, m.token);
  assert.equal(bad.status, 400);
  fits("/api/matches/{code}/move", "post", 400, bad.json);
  const noTok = await call(`/api/matches/${m.code}/move`, { rest: true });
  fits("/api/matches/{code}/move", "post", 401, noTok.json);
  const missing = await call("/api/matches/ZZZZZ");
  fits("/api/matches/{code}", "get", 404, missing.json);
  const early = await call(`/api/matches/${m.code}/rematch`, {}, m.token);
  fits("/api/matches/{code}/rematch", "post", 409, early.json);
});
