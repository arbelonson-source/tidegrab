import { RULES } from "../engine.js";
import { RULES_TEXT, ApiError, parseCreate } from "./room.js";

// store: { list(), create(params) -> {code, seat, token}, match(code) -> {handle(...)}|null }
export async function route(store, req) {
  const { method, parts, body, token, query, origin, ip } = req;
  if (parts[0] === "rules") {
    if (method !== "GET") throw new ApiError(405, "use GET");
    return { status: 200, json: { ...RULES, text: RULES_TEXT } };
  }
  if (parts[0] !== "matches") throw new ApiError(404, "unknown endpoint, see /docs");
  if (parts.length === 1) {
    if (method === "GET") return { status: 200, json: await store.list() };
    if (method !== "POST") throw new ApiError(405, "use GET or POST");
    const made = await store.create(parseCreate(body), ip);
    return { status: 200, json: { code: made.code, seat: made.seat, token: made.token, url: `${origin}/m/${made.code}` } };
  }
  if (parts.length > 3) throw new ApiError(404, "unknown endpoint, see /docs");
  const code = parts[1].toUpperCase();
  const room = await store.match(code);
  if (!room) throw new ApiError(404, "no such match: " + code);
  return room.handle(method, parts[2], body, token, query, origin);
}
