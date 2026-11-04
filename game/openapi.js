const obj = (properties, required) => ({ type: "object", properties, ...(required ? { required } : {}) });
const int = (description, extra) => ({ type: "integer", description, ...extra });
const str = (description, extra) => ({ type: "string", description, ...extra });
const bool = (description) => ({ type: "boolean", ...(description ? { description } : {}) });
const arr = (items, description) => ({ type: "array", items, ...(description ? { description } : {}) });
const nul = (schema, description) => ({ oneOf: [schema, { type: "null" }], ...(description ? { description } : {}) });
const ref = (n) => ({ $ref: "#/components/schemas/" + n });
const json = (schema, description = "OK") => ({ description, content: { "application/json": { schema } } });
const body = (schema, required) => ({ ...(required ? { required: true } : {}), content: { "application/json": { schema } } });
const err = (description) => json(ref("Error"), description);
const code = { name: "code", in: "path", required: true, schema: str("5-letter match code, case-insensitive") };
const auth = [{ bearer: [] }];
const errs = { 400: err("Bad input"), 404: err("No such match (or it expired)"), 429: err("Too many requests; wait `retryAfterMs` if given"), 503: err("`busy`: the server is full or too many long-polls are waiting; retry shortly (without `wait`)") };
const e401 = { 401: err("`no_token`: no token sent. `bad_token`: the token is not one of this match's seats") };
const e403 = { 403: err("`not_host`: only seat 0 can do this") };
const conflict = (codes) => ({ 409: err("The match is in the wrong state for this: " + codes.map((c) => "`" + c + "`").join(", ")) });

const EVENT_IDS = ["calm", "current", "seam", "bloom", "slack"];
const EMOTE_IDS = ["wave", "wow", "lol", "ouch", "gg", "pearl"];
const ERROR_CODES = [
  "bad_request", "bad_json", "not_object", "form_body", "bad_move",
  "no_token", "bad_token", "forbidden", "not_host", "not_found", "wrong_method",
  "conflict", "lobby_full", "already_started", "no_empty_seats", "match_running", "not_started", "match_over", "not_over",
  "too_large", "rate_limited", "busy", "internal",
];

const ErrorBody = obj({
  error: str("What went wrong, in words; the wording may change"),
  code: str("Stable machine-readable reason; branch on this", { enum: ERROR_CODES }),
  legal: { ...ref("Legal"), description: "Only on `bad_move`: what you may send right now" },
  allow: str("Only on 405: the methods this path takes (also in the Allow header)"),
  retryAfterMs: int("Only on some 429s: how long to wait"),
  emotes: arr({ type: "string" }, "Only on a bad emote: the allowed ones"),
}, ["error", "code"]);
const Legal = obj({ rest: bool("Resting is always allowed"), wrecks: arr({ type: "integer" }, "Wreck ids you may dive to"), minAir: int("Smallest legal bid (1)"), maxAir: int("Largest legal bid (your Air)") }, ["rest", "wrecks", "minAir", "maxAir"]);
const Rules = obj({
  text: str("The rules in words"),
  tides: int("Tides per match (8)"),
  startAir: int("Air each diver starts with"),
  maxAir: int("Air never goes above this"),
  restGain: int("Air gained by resting"),
  tideGain: int("Air every diver regains at the end of each tide"),
  growth: int("Pearls an unclaimed wreck gains each tide"),
  maxPearls: int("A wreck never holds more pearls than this"),
  airPocket: int("Air in an air pocket"),
  finalPayout: int("Pearls won on the final tide count this many times"),
  eventTides: int("How many of tides 1-7 get a public event"),
  currentRest: int("Air gained by resting during a Strong current"),
  seamBonus: int("Extra pearls on the new wreck during a Rich seam"),
  minPlayers: int("Fewest seats"),
  maxPlayers: int("Most seats"),
  eventText: obj(Object.fromEntries(EVENT_IDS.map((e) => [e, str("What the " + e + " event does")])), EVENT_IDS),
  emotes: arr({ type: "string", enum: EMOTE_IDS }, "Emotes you can send"),
}, ["text", "tides", "startAir", "maxAir", "restGain", "tideGain", "growth", "maxPearls", "airPocket", "finalPayout", "eventTides", "currentRest", "seamBonus", "minPlayers", "maxPlayers", "eventText", "emotes"]);
const Settings = obj({ seats: int("Seats"), turnSeconds: int("Seconds per tide"), botLevel: str("Bot level", { enum: ["easy", "normal", "hard"] }) }, ["seats", "turnSeconds", "botLevel"]);
const Wreck = obj({ id: int("Wreck id; ids keep increasing during a match"), pearls: int("Pearls on the wreck"), air: int("Air pocket the winner also takes (0 = none)"), age: int("Tides it went unclaimed") }, ["id", "pearls", "air", "age"]);
const Move = { oneOf: [obj({ wreck: int("A wreck id from wrecks"), air: int("Air to spend, 1..your air") }, ["wreck", "air"]), obj({ rest: { type: "boolean", enum: [true] } }, ["rest"])] };
const Standing = obj({ seat: int("Seat"), air: int("Air after the tide"), pearls: int("Pearls after the tide") }, ["seat", "air", "pearls"]);
const Result = obj({ id: int("Wreck id"), pearls: int("Pearls before payout"), air: int("Air pocket"), divers: arr(obj({ seat: int("Seat"), air: int("Air spent") })), winner: { type: ["integer", "null"], description: "Seat that took it, or null (no divers, or a tie)" }, tie: bool("Two or more divers tied for the most Air, so nobody took it"), gain: int("Pearls the winner got (doubled on the final tide)") }, ["id", "pearls", "air", "divers", "winner", "tie", "gain"]);
const RevealMove = obj({ seat: int("Seat"), wreck: int("Wreck id, when diving"), air: int("Air spent, when diving"), rest: bool("Rested"), auto: bool("Timed out, so rested") }, ["seat"]);
const Reveal = obj({
  tide: int("Tide number"),
  payout: int("1, or 2 on the final tide"),
  event: { type: ["string", "null"], enum: [...EVENT_IDS, null], description: "The event of that tide" },
  moves: arr(ref("RevealMove")),
  wrecks: arr(ref("Result")),
  standings: arr(ref("Standing"), "Everyone's Air and pearls right after the tide"),
}, ["tide", "payout", "event", "moves", "wrecks", "standings"]);
const Player = obj({
  seat: int("Seat"), name: str("Name"), kind: str("human or bot", { enum: ["human", "bot"] }), air: int("Air"), pearls: int("Pearls"),
  submitted: bool("Has a move in for this tide (the move itself stays secret)"),
  away: bool("A person who let 2 tides in a row time out; the table then waits only 8 s for them. Any move clears it."),
  form: obj({ dives: int("Tides spent diving"), rests: int("Tides spent resting"), avgAir: { type: ["number", "null"], description: "Average Air per dive" }, won: int("Wrecks won") }, ["dives", "rests", "avgAir", "won"]),
}, ["seat", "name", "kind", "air", "pearls", "submitted", "away", "form"]);
const State = obj({
  code: str("Match code"),
  status: str("lobby: waiting for players. playing: tides running. finished: over, see winners. expired: an idle lobby or match that was closed; it soon 404s", { enum: ["lobby", "playing", "finished", "expired"] }),
  version: int("Goes up on every change; pass the last one you saw back as ?wait="),
  settings: ref("Settings"),
  tide: int("Current tide, 1-8 (0 in the lobby)"),
  tides: int("Tides per match"),
  serverTime: int("Server clock, ms"),
  deadline: { type: ["integer", "null"], description: "When the tide resolves, ms" },
  pauseUntil: { type: ["integer", "null"], description: "End of the short reveal pause, ms. Moves for the next tide are already accepted during it" },
  secondsLeft: { type: ["number", "null"], description: "Seconds until the tide resolves" },
  host: int("Always seat 0"),
  seats: arr(nul(obj({ seat: int("Seat"), name: str("Name"), kind: str("human or bot") })), "One entry per seat; null while free"),
  players: arr(ref("Player"), "Empty in the lobby"),
  wrecks: arr(ref("Wreck")),
  event: { type: ["string", "null"], enum: [...EVENT_IDS, null], description: "This tide's public event (text in rules.eventText); null on the final tide, which pays double instead" },
  nextEvent: { type: ["string", "null"], enum: [...EVENT_IDS, null], description: "Next tide's event, announced one tide ahead; null when the next tide is the last" },
  lastReveal: nul(ref("Reveal"), "What happened last tide"),
  winners: { type: ["array", "null"], items: { type: "integer" }, description: "Winning seats once finished" },
  rematch: { type: ["string", "null"], description: "Code of the rematch, once someone asked for one" },
  watching: int("Watchers seen in the last 40 s (polls that send ?viewer=<id> without a seat token)"),
  emotes: arr(ref("Emote"), "Emotes from the last 8 s, oldest first; not saved, so a restart clears them"),
  rules: ref("Rules"),
  you: { ...obj({ seat: int("Your seat"), name: str("Your name"), isHost: bool(), move: nul(ref("Move"), "Your move for this tide so far"), legal: ref("Legal") }, ["seat", "name", "isHost", "move"]), description: "Only when you send your token; `legal` only while playing" },
}, ["code", "status", "version", "settings", "tide", "tides", "serverTime", "deadline", "pauseUntil", "secondsLeft", "host", "seats", "players", "wrecks", "event", "nextEvent", "lastReveal", "winners", "rematch", "watching", "emotes", "rules"]);
const Emote = obj({ id: str("Unique id, use it to show each emote once"), seat: { type: ["integer", "null"], description: "Sender's seat, or null for a watcher" }, name: str("Sender's name, or \"A watcher\""), emote: { type: "string", enum: EMOTE_IDS }, at: int("Server time it was sent, ms") }, ["id", "seat", "name", "emote", "at"]);
const Joined = obj({ code: str("Match code (on create and rematch)"), seat: int("Your seat"), token: str("Secret token for this seat; send it as `Authorization: Bearer <token>` (or a `token` field in POST bodies)"), url: str("Page to watch or play") }, ["seat", "token", "url"]);
const Index = obj({
  name: str("Tidegrab"), play: str("The game page"), docs: str("Guide for people and bots"), markdown: str("The same guide as Markdown"),
  rules: str("Rules as JSON"), openapi: str("This document"), endpoints: arr(str("METHOD path")),
}, ["name", "play", "docs", "markdown", "rules", "openapi", "endpoints"]);
const Matches = obj({
  open: arr(obj({ code: str("Code"), host: str("Host's name"), seats: int("Seats"), filled: int("Seats taken"), turnSeconds: int("Seconds per tide"), waitingSeconds: int("How long the lobby has been open; lobbies close after 15 minutes") }, ["code", "host", "seats", "filled", "turnSeconds", "waitingSeconds"]), "Lobbies with a free seat you can join, newest first"),
  live: arr(obj({ code: str("Code"), players: arr({ type: ["string", "null"] }), tide: int("Current tide"), tides: int("Tides") }, ["code", "players", "tide", "tides"]), "Matches being played now; watch with GET /api/matches/{code}"),
}, ["open", "live"]);
const Round = obj({
  tide: int("Tide"), payout: int("1, or 2 on the final tide"), event: { type: ["string", "null"] }, last: bool("The final tide"),
  before: obj({ wrecks: arr(ref("Wreck")), players: arr(ref("Standing")) }, ["wrecks", "players"]),
  moves: arr(ref("RevealMove")), results: arr(ref("Result")), standings: arr(ref("Standing")),
}, ["tide", "payout", "event", "last", "before", "moves", "results", "standings"]);
const Log = obj({
  code: str("Code"), status: str("Status"), seed: { type: ["integer", "null"], description: "Shown once the match is over" },
  settings: ref("Settings"), rules: ref("Rules"),
  names: arr({ type: ["string", "null"] }), kinds: arr({ type: ["string", "null"] }),
  rounds: arr(ref("Round"), "One entry per finished tide"),
  winners: { type: ["array", "null"], items: { type: "integer" } },
}, ["code", "status", "seed", "settings", "rules", "names", "kinds", "rounds", "winners"]);

const DESCRIPTION = [
  "Secret-bid diving game for 2 to 4 players. Full guide: ORIGIN/docs",
  "",
  "**Send a User-Agent.** The site sits behind Cloudflare, which answers some default client User-Agents (for example Python's `Python-urllib/3.x`) with error 1010 and an HTML page. Set any header such as `User-Agent: my-bot/1.0`.",
  "",
  "Loop: GET /api/matches/{code}?wait=<last version> waits until something changes, then POST a move while `status` is `playing` and `you.move` is null.",
  "Errors are JSON `{error, code}`; branch on `code`.",
].join("\n");

export function openapi(origin) {
  return {
    openapi: "3.1.0",
    info: { title: "Tidegrab", version: "1.1.0", description: DESCRIPTION.replace("ORIGIN", origin) },
    servers: [{ url: origin }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "The seat token from create/join/rematch" } },
      schemas: { Error: ErrorBody, Legal, Rules, Settings, Wreck, Move, Standing, Result, RevealMove, Reveal, Player, State, Emote, Joined, Index, Matches, Round, Log },
    },
    paths: {
      "/api": { get: { operationId: "getIndex", summary: "Index of endpoints and links to the docs", responses: { 200: json(ref("Index")) } } },
      "/api/rules": { get: { operationId: "getRules", summary: "Rule constants, event texts, emotes and the rules in words", responses: { 200: json(ref("Rules")) } } },
      "/api/openapi.json": { get: { operationId: "getOpenapi", summary: "This document", responses: { 200: json({ type: "object" }) } } },
      "/api/matches": {
        get: { operationId: "listMatches", summary: "Public list: open lobbies you can join and live matches you can watch", responses: { 200: json(ref("Matches")) } },
        post: { operationId: "createMatch", summary: "Create a match; you are the host in seat 0. With bots filling every other seat it starts at once", requestBody: body(obj({ name: str("Your name"), seats: int("2-4", { default: 2 }), bots: int("0..seats-1", { default: 0 }), turnSeconds: int("5-120", { default: 45 }), botLevel: str("Bot level", { enum: ["easy", "normal", "hard"], default: "normal" }) })), responses: { 200: json(ref("Joined")), ...errs } },
      },
      "/api/matches/{code}": { get: { operationId: "getMatch", summary: "Match state; with ?wait=<version> it long-polls (up to ~25 s) until the version is different", parameters: [code, { name: "wait", in: "query", schema: int("Last version you saw. Any other number, for example one ahead after a server restart, answers at once") }, { name: "viewer", in: "query", schema: str("Watchers only: a random 6-32 character id (letters, digits, _ or -) so you count in `watching`") }], security: [...auth, {}], responses: { 200: json(ref("State")), ...e401, ...errs } } },
      "/api/matches/{code}/join": { post: { operationId: "joinMatch", summary: "Take a free seat in a lobby; the match starts once every seat is filled", parameters: [code], requestBody: body(obj({ name: str("Your name") })), responses: { 200: json(ref("Joined")), ...errs, ...conflict(["lobby_full", "already_started", "match_running", "match_over"]) } } },
      "/api/matches/{code}/bots": { post: { operationId: "addBots", summary: "Host only: fill free seats with bots", parameters: [code], security: auth, requestBody: body(obj({ count: int("How many", { default: 1 }) })), responses: { 200: json(ref("State")), ...e401, ...e403, ...errs, ...conflict(["already_started", "no_empty_seats"]) } } },
      "/api/matches/{code}/start": { post: { operationId: "startMatch", summary: "Host only: start now; free seats get bots", parameters: [code], security: auth, responses: { 200: json(ref("State")), ...e401, ...e403, ...errs, ...conflict(["already_started"]) } } },
      "/api/matches/{code}/move": { post: { operationId: "sendMove", summary: "Your move for this tide; you can change it until the tide resolves. Unknown extra fields are ignored on a valid move", parameters: [code], security: auth, requestBody: body(ref("Move"), true), responses: { 200: json(obj({ ok: bool(), tide: int("Tide"), move: ref("Move"), version: int("New version") }, ["ok", "tide", "move", "version"])), 400: err("`bad_move`: the body also has `legal`"), ...e401, 404: errs[404], 429: errs[429], ...conflict(["not_started", "match_over"]) } } },
      "/api/matches/{code}/emote": { post: { operationId: "sendEmote", summary: "Send a preset emote; the token is optional, so watchers can send too. Players: one every 1.5 s. Watchers share 5 every 5 s", parameters: [code], security: [...auth, {}], requestBody: body(obj({ emote: { type: "string", enum: EMOTE_IDS } }, ["emote"]), true), responses: { 200: json(obj({ ok: bool(), emote: ref("Emote"), version: int("New version") }, ["ok", "emote", "version"])), ...e401, ...errs } } },
      "/api/matches/{code}/rematch": { post: { operationId: "rematch", summary: "After the match: open or join a rematch with the same table; asking again returns the same seat", parameters: [code], security: auth, responses: { 200: json(ref("Joined")), ...e401, ...errs, ...conflict(["not_over"]) } } },
      "/api/matches/{code}/log": { get: { operationId: "getLog", summary: "Replay log: every finished tide with the board before it, all moves and results", parameters: [code], responses: { 200: json(ref("Log")), ...errs } } },
      "/healthz": { get: { operationId: "health", summary: "Liveness check", responses: { 200: json(obj({ ok: bool() }, ["ok"])) } } },
    },
  };
}
