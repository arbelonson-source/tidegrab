const obj = (properties, required) => ({ type: "object", properties, ...(required ? { required } : {}) });
const int = (description, extra) => ({ type: "integer", description, ...extra });
const str = (description, extra) => ({ type: "string", description, ...extra });
const ref = (n) => ({ $ref: "#/components/schemas/" + n });
const json = (schema, description = "OK") => ({ description, content: { "application/json": { schema } } });
const err = (description) => json(ref("Error"), description);
const code = { name: "code", in: "path", required: true, schema: str("5-letter match code, case-insensitive") };
const auth = [{ bearer: [] }];
const errs = { 400: err("Bad input; for moves the body also has `legal`"), 401: err("Missing or unknown token"), 404: err("No such match"), 429: err("Too many requests") };

const Wreck = obj({ id: int("Wreck id; ids keep increasing during a match"), pearls: int("Pearls on the wreck"), air: int("Air pocket the winner also takes"), age: int("Tides it went unclaimed") });
const Move = { oneOf: [obj({ wreck: int("A wreck id from wrecks"), air: int("Air to spend, 1..your air") }, ["wreck", "air"]), obj({ rest: { type: "boolean", enum: [true] } }, ["rest"])] };
const Result = obj({ id: int("Wreck id"), pearls: int("Pearls before payout"), air: int("Air pocket"), divers: { type: "array", items: obj({ seat: int("Seat"), air: int("Air spent") }) }, winner: { type: ["integer", "null"] }, tie: { type: "boolean" }, gain: int("Pearls the winner got (doubled on the final tide)") });
const Reveal = obj({ tide: int("Tide number"), payout: int("1, or 2 on the final tide"), moves: { type: "array", items: obj({ seat: int("Seat"), wreck: int("Wreck id"), air: int("Air"), rest: { type: "boolean" }, auto: { type: "boolean", description: "Timed out, so rested" } }) }, wrecks: { type: "array", items: ref("Result") } });
const State = obj({
  code: str("Match code"),
  status: str("Match status", { enum: ["lobby", "playing", "finished", "expired"] }),
  version: int("Goes up on every change; pass it back as ?wait="),
  settings: obj({ seats: int("Seats"), turnSeconds: int("Seconds per tide"), botLevel: str("Bot level", { enum: ["easy", "normal", "hard"] }) }),
  tide: int("Current tide, 1-8"),
  tides: int("Tides per match"),
  serverTime: int("Server clock, ms"),
  deadline: { type: ["integer", "null"], description: "When the tide resolves, ms" },
  pauseUntil: { type: ["integer", "null"], description: "End of the reveal pause, ms" },
  secondsLeft: { type: ["number", "null"] },
  host: int("Always seat 0"),
  seats: { type: "array", items: { oneOf: [obj({ seat: int("Seat"), name: str("Name"), kind: str("human or bot") }), { type: "null" }] } },
  players: { type: "array", items: obj({ seat: int("Seat"), name: str("Name"), kind: str("human or bot"), air: int("Air"), pearls: int("Pearls"), submitted: { type: "boolean" } }) },
  wrecks: { type: "array", items: ref("Wreck") },
  lastReveal: { oneOf: [ref("Reveal"), { type: "null" }] },
  winners: { type: ["array", "null"], items: { type: "integer" } },
  rematch: { type: ["string", "null"], description: "Code of the rematch, once someone asked for one" },
  you: obj({ seat: int("Your seat"), name: str("Your name"), isHost: { type: "boolean" }, move: { oneOf: [ref("Move"), { type: "null" }] }, legal: obj({ rest: { type: "boolean" }, wrecks: { type: "array", items: { type: "integer" } }, minAir: int("Smallest legal bid"), maxAir: int("Largest legal bid") }) }),
});
const Joined = obj({ code: str("Match code"), seat: int("Your seat"), token: str("Secret token for this seat"), url: str("Page to watch or play") });

export function openapi(origin) {
  return {
    openapi: "3.1.0",
    info: { title: "Tidegrab", version: "1.0.0", description: "Secret-bid diving game for 2 to 4 players. Full guide: " + origin + "/docs" },
    servers: [{ url: origin }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } }, schemas: { Error: obj({ error: str("What went wrong") }), Wreck, Move, Result, Reveal, State, Joined } },
    paths: {
      "/api/rules": { get: { summary: "Rule constants and a plain-text rules summary", responses: { 200: json(obj({ text: str("Rules in words") })) } } },
      "/api/matches": {
        get: { summary: "Open lobbies and live matches", responses: { 200: json(obj({ open: { type: "array", items: { type: "object" } }, live: { type: "array", items: { type: "object" } } })) } },
        post: { summary: "Create a match; you are the host in seat 0", requestBody: { content: { "application/json": { schema: obj({ name: str("Your name"), seats: int("2-4", { default: 2 }), bots: int("0..seats-1", { default: 0 }), turnSeconds: int("5-120", { default: 45 }), botLevel: str("Bot level", { enum: ["easy", "normal", "hard"], default: "normal" }) }) } } }, responses: { 200: json(ref("Joined")), ...errs } },
      },
      "/api/matches/{code}": { get: { summary: "Match state; with ?wait=<version> it long-polls until the version changes", parameters: [code, { name: "wait", in: "query", schema: int("Last version you saw") }], security: auth, responses: { 200: json(ref("State")), ...errs } } },
      "/api/matches/{code}/join": { post: { summary: "Take a free seat in a lobby; the match starts once every seat is filled", parameters: [code], requestBody: { content: { "application/json": { schema: obj({ name: str("Your name") }) } } }, responses: { 200: json(obj({ seat: int("Your seat"), token: str("Secret token for this seat"), url: str("Page to watch or play") })), ...errs } } },
      "/api/matches/{code}/bots": { post: { summary: "Host only: fill free seats with bots", parameters: [code], security: auth, requestBody: { content: { "application/json": { schema: obj({ count: int("How many", { default: 1 }) }) } } }, responses: { 200: json(ref("State")), ...errs } } },
      "/api/matches/{code}/start": { post: { summary: "Host only: start now; free seats get bots", parameters: [code], security: auth, responses: { 200: json(ref("State")), ...errs } } },
      "/api/matches/{code}/move": { post: { summary: "Your move for this tide; you can change it until the tide resolves", parameters: [code], security: auth, requestBody: { required: true, content: { "application/json": { schema: ref("Move") } } }, responses: { 200: json(obj({ ok: { type: "boolean" }, tide: int("Tide"), move: ref("Move"), version: int("New version") })), ...errs } } },
      "/api/matches/{code}/rematch": { post: { summary: "After the match: open or join a rematch with the same table; asking again returns the same seat", parameters: [code], security: auth, responses: { 200: json(ref("Joined")), ...errs } } },
      "/api/matches/{code}/log": { get: { summary: "Replay log; seed is shown once the match is over", parameters: [code], responses: { 200: json(obj({ code: str("Code"), status: str("Status"), seed: { type: ["integer", "null"] }, names: { type: "array", items: { type: "string" } }, kinds: { type: "array", items: { type: "string" } }, rounds: { type: "array", items: { type: "object" } }, winners: { type: ["array", "null"], items: { type: "integer" } } })), ...errs } } },
      "/healthz": { get: { summary: "Liveness check", responses: { 200: json(obj({ ok: { type: "boolean" } })) } } },
    },
  };
}
