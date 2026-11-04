import { MatchRoom, ApiError } from "./game/room.js";
import { Registry, ipKey } from "./game/registry.js";
import { route } from "./game/api.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const hits = new Map();

function reply(status, json) {
  return new Response(status === 204 ? null : JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}

function rateLimit(ip) {
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || h.reset < now) {
    if (hits.size > 2000) hits.clear();
    hits.set(ip, (h = { n: 0, reset: now + 10000 }));
  }
  if (++h.n > 300) throw new ApiError(429, "too many requests, slow down");
}

async function readBody(request) {
  if (request.method !== "POST") return {};
  const text = await request.text();
  if (text.length > 16384) throw new ApiError(413, "request body too large (limit 16 KB)");
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new ApiError(400, "body must be a JSON object");
  }
}

async function call(stub, path, payload) {
  const r = await stub.fetch("https://do" + path, { method: "POST", body: JSON.stringify(payload || {}) });
  return { status: r.status, json: await r.json() };
}

function makeStore(env) {
  const lobby = env.LOBBY.get(env.LOBBY.idFromName("main"));
  return {
    async list() {
      return (await call(lobby, "/list")).json;
    },
    async create(params, ip) {
      const n = await call(lobby, "/new", { ip });
      if (n.status !== 200) throw new ApiError(n.status, n.json.error);
      const code = n.json.code;
      const made = await call(env.MATCH.get(env.MATCH.idFromName(code)), "/init", { code, params });
      if (made.status !== 200) throw new ApiError(503, "could not open the match, try again");
      return { code, ...made.json };
    },
    async match(code) {
      if (!/^[A-Z0-9]{5}$/.test(code)) return null;
      const stub = env.MATCH.get(env.MATCH.idFromName(code));
      return { handle: (method, sub, body, token, query, origin) => call(stub, "/call", { code, method, sub, body, token, query, origin }) };
    },
  };
}

async function allowed(env, key) {
  try {
    return !env.LIMIT || (await env.LIMIT.limit({ key })).success;
  } catch {
    return true;
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "OPTIONS") return reply(204);
      if (url.pathname === "/healthz") return reply(200, { ok: true });
      if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
      const ip = request.headers.get("cf-connecting-ip") || null;
      const key = ipKey(ip) || "?";
      rateLimit(key);
      if (!(await allowed(env, key))) throw new ApiError(429, "too many requests, slow down");
      const body = await readBody(request);
      const h = request.headers.get("authorization");
      const token = h && /^bearer /i.test(h) ? h.slice(7).trim() : body.token || null;
      const out = await route(makeStore(env), {
        method: request.method,
        parts: url.pathname.split("/").slice(2).filter(Boolean),
        body,
        token,
        query: Object.fromEntries(url.searchParams),
        origin: url.origin,
        ip,
      });
      return reply(out.status, out.json);
    } catch (e) {
      if (e instanceof ApiError) return reply(e.status, { error: e.message, ...e.extra });
      console.error("worker error", e);
      return reply(500, { error: "internal error" });
    }
  },
};

export class MatchDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null;
    this.pending = new Set();
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const data = await ctx.storage.get("d");
      if (data) this.room = this.build(data);
    });
  }

  build(data) {
    const ctx = this.ctx;
    const lobbyStub = () => this.env.LOBBY.get(this.env.LOBBY.idFromName("main"));
    return new MatchRoom(data, {
      now: () => Date.now(),
      save: (snap) => void ctx.storage.put("d", snap),
      wake: (at) => void ctx.storage.setAlarm(at == null ? this.cleanupAt() : Math.max(at, Date.now() + 1)),
      notify: (summary) => {
        const key = `${summary.status}|${summary.filled}|${summary.tide}`;
        if (key === this.sent) return;
        this.sent = key;
        const sent = call(lobbyStub(), "/update", summary).catch(() => {});
        this.pending.add(sent);
        sent.finally(() => this.pending.delete(sent));
      },
    });
  }

  async fetch(request) {
    await this.ready;
    const path = new URL(request.url).pathname;
    const p = await request.json();
    if (path === "/init") {
      if (this.room) return Response.json({ error: "code in use" }, { status: 409 });
      const hooks = this.build({}).hooks;
      const { room, seat, token } = MatchRoom.create(p.code, p.params, hooks);
      this.room = room;
      return Response.json({ seat, token });
    }
    if (!this.room) return Response.json({ error: "no such match: " + (p.code || "") }, { status: 404 });
    const out = await this.room.handle(p.method, p.sub, p.body, p.token, p.query, p.origin);
    return Response.json(out.json, { status: out.status });
  }

  // Finished matches stay a day for replays; abandoned lobbies a few minutes.
  cleanupAt() {
    const status = this.room?.d.status;
    return Date.now() + (status === "finished" ? 86400000 : 600000);
  }

  async alarm() {
    await this.ready;
    const status = this.room?.d.status;
    if (!this.room || status === "finished" || status === "expired") {
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    this.room.onWake();
    // Nobody is waiting on an alarm, so make sure the lobby hears about it before the object can sleep.
    await Promise.all(this.pending);
  }
}

export class LobbyDO {
  constructor(ctx) {
    this.ctx = ctx;
    this.reg = new Registry();
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.reg = new Registry(await ctx.storage.get("r"));
    });
  }

  async fetch(request) {
    await this.ready;
    const path = new URL(request.url).pathname;
    const p = request.method === "POST" ? await request.json() : {};
    if (path === "/list") {
      if (this.reg.prune()) await this.ctx.storage.put("r", this.reg.toJSON());
      return Response.json(this.reg.list());
    }
    if (path === "/new") {
      const full = this.reg.checkCapacity(p.ip);
      if (full) return Response.json({ error: full }, { status: full.startsWith("you already") ? 429 : 503 });
      const code = this.reg.newCode();
      this.reg.reserve(code, p.ip);
      await this.ctx.storage.put("r", this.reg.toJSON());
      return Response.json({ code });
    }
    if (path === "/update") {
      this.reg.update(p);
      await this.ctx.storage.put("r", this.reg.toJSON());
      return Response.json({ ok: true });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }
}
