#!/usr/bin/env node
import { parseArgs } from "node:util";

const { values: a } = parseArgs({
  options: {
    server: { type: "string", default: "https://tidegrab.arbelonski.workers.dev" },
    code: { type: "string" },
    name: { type: "string", default: "JsBot" },
  },
});
const base = a.server.replace(/\/+$/, "");

async function call(path, body, token) {
  const headers = { "content-type": "application/json", "user-agent": "tidegrab-sample-bot/1.0" };
  if (token) headers.authorization = "Bearer " + token;
  const r = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${out.error || r.statusText}`);
  return out;
}

function choose(s) {
  const { legal } = s.you;
  const air = legal.maxAir;
  if (!legal.wrecks.length || air < 1 || (air < 3 && Math.random() < 0.6)) return { rest: true };
  const value = (w) => w.pearls + 3 * w.air;
  const best = s.wrecks.reduce((x, y) => (value(y) > value(x) ? y : x));
  const bid = Math.round(air * 0.3 + value(best) * 0.25 + (Math.random() * 2 - 1));
  return { wreck: best.id, air: Math.max(1, Math.min(air, bid)) };
}

const m = a.code ? { ...(await call(`/api/matches/${a.code}/join`, { name: a.name })), code: a.code } : await call("/api/matches", { name: a.name, seats: 2, bots: 1 });
const { code, token } = m;
console.log(`match ${code}  watch: ${base}/m/${code}`);
let version = 0, last = 0;
for (;;) {
  const s = await call(`/api/matches/${code}?wait=${version}`, undefined, token);
  version = s.version;
  const rv = s.lastReveal;
  if (rv && rv.tide > last) {
    last = rv.tide;
    const me = s.players[s.you.seat];
    console.log(`tide ${rv.tide} done: pearls ${me.pearls} air ${me.air}`);
  }
  if (s.status === "finished") {
    console.log("final:", s.players.map((p) => `${p.name} ${p.pearls}`).join(", "));
    console.log("winners:", s.winners.map((w) => s.players[w].name));
    break;
  }
  if (s.status === "playing" && !s.you.move) await call(`/api/matches/${code}/move`, choose(s), token);
}
