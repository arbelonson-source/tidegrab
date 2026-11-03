import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MatchRoom, ApiError } from "./game/room.js";
import { Registry, ipKey } from "./game/registry.js";
import { route } from "./game/api.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const KEEP_FINISHED_MS = 15 * 60 * 1000;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export function startServer(opts = {}) {
  const port = opts.port ?? Number(process.env.PORT || 8790);
  const host = opts.host ?? process.env.HOST ?? "0.0.0.0";
  const dataDir = opts.dataDir ?? path.join(ROOT, "data", "matches");
  const publicDir = path.join(ROOT, "public");
  const trustProxy = opts.trustProxy ?? process.env.TRUST_PROXY === "1";
  const fast = !!opts.fast;
  fs.mkdirSync(dataDir, { recursive: true });

  const rooms = new Map();
  const timers = new Map();
  const saves = new Map();
  const registry = new Registry();
  const hits = new Map();

  function flush(code) {
    const t = saves.get(code);
    if (t) clearTimeout(t.timer);
    saves.delete(code);
    const room = rooms.get(code);
    if (!room) return;
    const file = path.join(dataDir, code + ".json");
    try {
      fs.writeFileSync(file + ".tmp", JSON.stringify(room.snapshot()));
      fs.renameSync(file + ".tmp", file);
    } catch (e) {
      console.error("save failed", code, e.message);
    }
  }

  function makeHooks(code) {
    return {
      now: () => Date.now(),
      save(_snap, immediate) {
        if (immediate) return flush(code);
        if (!saves.has(code)) saves.set(code, { timer: setTimeout(() => flush(code), 400) });
      },
      wake(at) {
        clearTimeout(timers.get(code));
        timers.delete(code);
        if (at == null) return;
        timers.set(code, setTimeout(() => rooms.get(code)?.onWake(), Math.min(Math.max(0, at - Date.now()), 2 ** 30)));
      },
      notify: (summary) => registry.update(summary),
    };
  }

  function drop(code) {
    clearTimeout(timers.get(code));
    timers.delete(code);
    const t = saves.get(code);
    if (t) clearTimeout(t.timer);
    saves.delete(code);
    rooms.get(code)?.closeWaiters();
    rooms.delete(code);
    registry.remove(code);
  }

  function hydrate(data) {
    const room = new MatchRoom(data, makeHooks(data.code), { fast });
    rooms.set(data.code, room);
    registry.update(room.summary());
    room.rearm();
    return room;
  }

  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8"));
      if (data.status === "finished" && Date.now() - (data.finishedAt || 0) > KEEP_FINISHED_MS) continue;
      if (data.status === "expired") continue;
      hydrate(data);
    } catch (e) {
      console.error("could not load", f, e.message);
    }
  }

  const store = {
    list: () => registry.list(),
    create(params, ip) {
      const full = registry.checkCapacity(ip);
      if (full) throw new ApiError(full.startsWith("you already") ? 429 : 503, full);
      const code = registry.newCode();
      registry.reserve(code, ip);
      const hooks = makeHooks(code);
      const { room, seat, token } = MatchRoom.create(code, params, hooks, { fast });
      rooms.set(code, room);
      return { code, seat, token };
    },
    match(code) {
      if (rooms.has(code)) return rooms.get(code);
      const file = path.join(dataDir, code.replace(/[^A-Z0-9]/g, "") + ".json");
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        if (data.status === "finished") return new MatchRoom(data, { now: Date.now, save() {}, wake() {} }, { fast });
      } catch {}
      return null;
    },
  };

  const janitor = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const d = room.snapshot();
      if (d.status === "expired" || (d.status === "finished" && now - d.finishedAt > KEEP_FINISHED_MS)) {
        if (d.status === "expired") fs.rm(path.join(dataDir, code + ".json"), () => {});
        drop(code);
      }
    }
    for (const [ip, h] of hits) if (h.reset < now) hits.delete(ip);
  }, 30000);
  janitor.unref();

  function rateLimit(ip) {
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || h.reset < now) hits.set(ip, (h = { n: 0, reset: now + 10000 }));
    if (++h.n > 300) throw new ApiError(429, "too many requests, slow down");
  }

  function readBody(req) {
    return new Promise((resolveBody, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > 16384) {
          reject(new ApiError(413, "request body too large (limit 16 KB)"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8").trim();
        if (!text) return resolveBody({});
        try {
          const v = JSON.parse(text);
          if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
          resolveBody(v);
        } catch {
          reject(new ApiError(400, "body must be a JSON object"));
        }
      });
      req.on("error", reject);
    });
  }

  function send(res, status, obj) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS });
    res.end(status === 204 ? undefined : JSON.stringify(obj));
  }

  function sendFile(res, file) {
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, { error: "not found" });
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
      res.end(buf);
    });
  }

  function serveStatic(res, url) {
    let p = decodeURIComponent(url.pathname);
    if (/^\/(m|replay)\/[A-Za-z0-9]+\/?$/.test(p) || p === "/") p = "/index.html";
    else if (p === "/docs") p = "/docs.html";
    else if (p === "/README.md") return sendFile(res, path.join(ROOT, "README.md"));
    const file = path.normalize(path.join(publicDir, p));
    if (!file.startsWith(publicDir + path.sep)) throw new ApiError(404, "not found");
    return sendFile(res, file);
  }

  async function api(req, res, url, ip) {
    const body = req.method === "POST" ? await readBody(req) : {};
    const h = req.headers.authorization;
    const token = h && /^bearer /i.test(h) ? h.slice(7).trim() : body.token || null;
    const proto = req.headers["x-forwarded-proto"] || "http";
    const out = await route(store, {
      method: req.method,
      parts: url.pathname.split("/").slice(2).filter(Boolean),
      body,
      token,
      query: Object.fromEntries(url.searchParams),
      origin: `${proto}://${req.headers.host}`,
      ip,
    });
    send(res, out.status, out.json);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      const ip = (trustProxy && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
      if (req.method === "OPTIONS") return send(res, 204, {});
      if (url.pathname === "/healthz") return send(res, 200, { ok: true, matches: rooms.size });
      if (url.pathname.startsWith("/api/")) {
        rateLimit(ipKey(ip) || "?");
        return await api(req, res, url, ip === "?" ? null : ip);
      }
      if (req.method !== "GET") throw new ApiError(405, "use GET");
      return serveStatic(res, url);
    } catch (e) {
      if (res.headersSent || res.destroyed) return;
      if (e instanceof ApiError) return send(res, e.status, { error: e.message, ...e.extra });
      console.error("handler error", e);
      send(res, 500, { error: "internal error" });
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 20000;

  const ready = new Promise((ok) => server.listen(port, host, () => ok(server.address().port)));

  function close() {
    clearInterval(janitor);
    for (const code of [...rooms.keys()]) {
      flush(code);
      clearTimeout(timers.get(code));
      rooms.get(code).closeWaiters();
    }
    return new Promise((done) => {
      server.close(() => done());
      server.closeAllConnections?.();
    });
  }

  return { server, ready, close };
}

process.on("uncaughtException", (e) => console.error("uncaught", e));
process.on("unhandledRejection", (e) => console.error("unhandled", e));

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const s = startServer();
  s.ready.then((p) => console.log(`Tidegrab listening on port ${p}`));
  const stop = () => s.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
