import { RULES } from "../engine.js";
import { RULES_TEXT, ApiError, parseCreate } from "./room.js";
import { openapi } from "./openapi.js";

// store: { list(), create(params) -> {code, seat, token}, match(code) -> {handle(...)}|null }
export async function route(store, req) {
  const { method, parts, body, token, query, origin, ip } = req;
  if (!parts.length) {
    if (method !== "GET") throw new ApiError(405, "use GET");
    return { status: 200, json: index(origin) };
  }
  if (parts[0] === "rules") {
    if (method !== "GET") throw new ApiError(405, "use GET");
    return { status: 200, json: { ...RULES, text: RULES_TEXT } };
  }
  if (parts[0] === "openapi.json" && parts.length === 1) {
    if (method !== "GET") throw new ApiError(405, "use GET");
    return { status: 200, json: openapi(origin) };
  }
  if (parts[0] !== "matches") throw new ApiError(404, "unknown endpoint, see /docs");
  if (parts.length === 1) {
    if (method === "GET") return { status: 200, json: await store.list() };
    if (method !== "POST") throw new ApiError(405, "use GET or POST");
    const made = await store.create(parseCreate(body), ip);
    return { status: 200, json: { code: made.code, seat: made.seat, token: made.token, url: `${origin}/m/${made.code}` } };
  }
  if (parts.length > 3 || (parts[2] || "").includes(":")) throw new ApiError(404, "unknown endpoint, see /docs");
  const code = parts[1].toUpperCase();
  const room = await store.match(code);
  if (!room) throw new ApiError(404, "no such match: " + code);
  if (parts[2] === "rematch") {
    if (method !== "POST") throw new ApiError(405, "use POST");
    return { status: 200, json: await rematch(store, room, token, origin, ip) };
  }
  return room.handle(method, parts[2], body, token, query, origin);
}

const index = (o) => ({
  name: "Tidegrab",
  play: o,
  docs: `${o}/docs`,
  markdown: `${o}/README.md`,
  rules: `${o}/api/rules`,
  openapi: `${o}/api/openapi.json`,
  endpoints: [
    "GET /api/rules",
    "GET /api/matches",
    "POST /api/matches",
    "POST /api/matches/CODE/join",
    "POST /api/matches/CODE/bots",
    "POST /api/matches/CODE/start",
    "GET /api/matches/CODE?wait=VERSION",
    "POST /api/matches/CODE/move",
    "POST /api/matches/CODE/rematch",
    "GET /api/matches/CODE/log",
  ],
});

const ok = (r) => {
  if (r.status !== 200) throw new ApiError(r.status, r.json.error);
  return r.json;
};

async function rematch(store, room, token, origin, ip) {
  const info = ok(await room.handle("POST", "rematch:info", {}, token, {}, origin));
  if (info.mine) return info.mine;
  let made;
  const next = info.next && (await store.match(info.next));
  const j = next && (await next.handle("POST", "join", { name: info.name }, null, {}, origin));
  if (j && j.status === 200) made = { code: info.next, ...j.json };
  else {
    const params = parseCreate({ name: info.name, seats: info.seats, bots: info.bots, turnSeconds: info.turnSeconds, botLevel: info.botLevel });
    const c = await store.create(params, ip);
    made = { code: c.code, seat: c.seat, token: c.token, url: `${origin}/m/${c.code}` };
  }
  return ok(await room.handle("POST", "rematch:set", made, token, {}, origin));
}
