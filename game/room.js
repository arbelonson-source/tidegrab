import { RULES, EVENTS, eventOf, createGame, checkMove, normalizeMove, resolveTide } from "../engine.js";
import { chooseMove, LEVELS } from "../bots/brain.js";

const BOT_NAMES = ["Coral", "Kelp", "Manta", "Brine", "Nacre", "Squall", "Abyss", "Tern"];
export const LOBBY_TTL = 900000;
const MAX_WAITERS = 400;
// A person who lets this many tides time out in a row is marked away, and the table
// then waits only AWAY_WAIT_MS for them instead of the whole turn timer.
export const AWAY_AFTER = 2;
export const AWAY_WAIT_MS = 8000;
const EMOTE_KEEP = 12;
const EMOTE_SHOW = 8000;
const EMOTE_GAP = 1500;
const WATCHER_EMOTES = 5;
const WATCHER_WINDOW = 5000;
const MAX_VIEWERS = 300;
const VIEWER_TTL = 40000;
const NO_TOKEN = "this needs your seat token: send it as 'Authorization: Bearer <token>' or as a 'token' field in the JSON body";
const BAD_TOKEN = "that token does not hold a seat in this match (tokens belong to one match: use the one you got when you created or joined it)";
let waiterTotal = 0;

export const EMOTES = ["wave", "wow", "lol", "ouch", "gg", "pearl"];

export const RULES_TEXT =
  "Two to four divers race through eight tides. Each tide, wrecks lie on the seabed, each holding pearls (the points) " +
  "and sometimes an air pocket (+3 Air for whoever claims it). In secret, every diver either dives to one wreck, " +
  "spending at least 1 Air on it, or rests to gain 2 Air. When everyone has chosen, the choices are revealed: at each " +
  "wreck the single diver who spent the most Air takes its pearls and air pocket, but if two or more divers tie for " +
  "the most, the silt clouds the water and nobody takes it. All Air spent is gone, even if you lose. Unclaimed wrecks " +
  "stay and grow by 1 pearl, and every diver regains 1 Air each tide (up to 10). The eighth and final tide pays " +
  "double: every pearl won on it counts twice. After it, the diver with the most pearls wins; ties go to whoever " +
  "has more Air left. A diver who does not move before the timer runs out rests. The first tide is always calm and " +
  "opens with a wreck of at least 6 pearls. Four of tides 2 to 7 " +
  "bring a public event, always announced one tide ahead: Strong current (resting gives +3 Air), Rich seam (the new " +
  "wreck gets 3 extra pearls), Air pocket bloom (every wreck holds an air pocket) or Slack water (no Air comes back " +
  "at the end of the tide).";

// Everything a bot needs to know about the rules, served at /api/rules, in each state and in the replay log.
export const RULES_INFO = Object.freeze({ text: RULES_TEXT, ...RULES, eventText: EVENTS, emotes: EMOTES });

const MOVE_SHAPE = 'send {"wreck": <id>, "air": <n>} or {"rest": true}';

function parseMove(body, legal) {
  const has = (k) => body[k] !== undefined && body[k] !== null;
  const fail = (msg) => {
    throw new ApiError(400, msg, { code: "bad_move", legal: legal() });
  };
  const odd = Object.keys(body).filter((k) => !["wreck", "air", "rest", "token", "tide"].includes(k));
  const rest = body.rest === false ? undefined : body.rest;
  if (rest === undefined && !has("wreck") && !has("air")) fail((odd.length ? `unknown field "${odd[0]}": ` : "empty move: ") + MOVE_SHAPE);
  if (rest !== undefined && rest !== null) {
    if (rest !== true) fail('rest must be true or left out: ' + MOVE_SHAPE);
    if (has("wreck") || has("air")) fail("send either rest or wreck + air, not both");
    return { rest: true };
  }
  const num = (v) => (typeof v === "string" && /^\d{1,3}$/.test(v) ? Number(v) : v);
  return { wreck: num(body.wreck), air: num(body.air) };
}

// Every error carries a stable `code` so bots can branch on it instead of the wording.
const STATUS_CODES = { 400: "bad_request", 401: "no_token", 403: "forbidden", 404: "not_found", 405: "wrong_method", 409: "conflict", 413: "too_large", 429: "rate_limited", 503: "busy" };

export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = { code: STATUS_CODES[status] || "error", ...extra };
  }
}

// 405 with the methods that do work; the JSON "allow" field becomes the Allow header.
export const useMethod = (allow) => new ApiError(405, "use " + allow.split(", ").join(" or "), { allow, code: "wrong_method" });

// The match is in the wrong state for this request (409), with a stable code for bots.
const conflict = (code, message, extra = {}) => new ApiError(409, message, { code, ...extra });

const tokenError = (token) => new ApiError(401, token ? BAD_TOKEN : NO_TOKEN, { code: token ? "bad_token" : "no_token" });

// Request bodies: one JSON object (or nothing). Each kind of mistake gets its own hint.
// Turn "name=Ann&seats=2" into '{"name":"Ann","seats":2}' so the error shows the fix for this very request.
function formAsJson(text) {
  const out = {};
  try {
    for (const [k, v] of new URLSearchParams(text)) out[k.slice(0, 20)] = /^-?\d{1,6}$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v.slice(0, 30);
  } catch { /* fall through to the generic example */ }
  const j = JSON.stringify(out);
  return j !== "{}" && j.length <= 160 ? j : '{"wreck": 3, "air": 2}';
}

export function parseBody(text, contentType = "") {
  text = String(text || "").trim();
  if (!text) return {};
  let v;
  try {
    v = JSON.parse(text);
  } catch (e) {
    if (!/^[[{]/.test(text) && (/form/i.test(contentType) || /^[\w.%-]+=[^{}]*$/.test(text)))
      throw new ApiError(400, "the body looks like a form (key=value), send JSON instead, e.g. " + formAsJson(text), { code: "form_body" });
    throw new ApiError(400, "the body is not valid JSON (" + String(e.message).slice(0, 80) + ")", { code: "bad_json" });
  }
  if (Array.isArray(v)) throw new ApiError(400, "the body must be a JSON object, not an array", { code: "not_object" });
  if (!v || typeof v !== "object") throw new ApiError(400, 'the body must be a JSON object, e.g. {"rest": true}', { code: "not_object" });
  return v;
}

export function cleanName(raw, fallback) {
  let s = typeof raw === "string" ? raw : "";
  s = Array.from(s)
    .filter((ch) => {
      const c = ch.codePointAt(0);
      return c > 31 && !(c >= 127 && c <= 159) && !(c >= 0x200b && c <= 0x200f) && !(c >= 0x2028 && c <= 0x202e) && !(c >= 0x2066 && c <= 0x2069) && c !== 0xfeff;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  s = Array.from(s).slice(0, 20).join("").trim();
  return s || fallback;
}

export function randInt(n) {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] % n;
}

function randToken() {
  const a = new Uint8Array(16);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseCreate(body) {
  const seats = body.seats === undefined ? 2 : body.seats;
  if (!Number.isInteger(seats) || seats < 2 || seats > 4) throw new ApiError(400, "seats must be a whole number from 2 to 4");
  const bots = body.bots === undefined ? 0 : body.bots;
  if (!Number.isInteger(bots) || bots < 0 || bots > seats - 1) throw new ApiError(400, `bots must be a whole number from 0 to ${seats - 1}`);
  const turnSeconds = body.turnSeconds === undefined ? 45 : body.turnSeconds;
  if (!Number.isInteger(turnSeconds) || turnSeconds < 5 || turnSeconds > 120) throw new ApiError(400, "turnSeconds must be a whole number from 5 to 120");
  const botLevel = body.botLevel === undefined ? "normal" : body.botLevel;
  if (!LEVELS.includes(botLevel)) throw new ApiError(400, "botLevel must be one of: " + LEVELS.join(", "));
  return { seats, bots, turnSeconds, botLevel, name: cleanName(body.name, "Diver") };
}

// hooks: { now(), save(snapshot, immediate), wake(atMs|null), notify?(summary) }.
// All time-based behaviour (bot delays, deadlines, reveal pause) runs from onWake().
// What each diver has shown so far, from the public reveals: dives, rests,
// average Air per dive and wrecks won.
export function formOf(g, seat) {
  let dives = 0, spent = 0, won = 0;
  for (const ev of g.history) {
    const m = ev.moves[seat];
    if (m && !m.rest) { dives++; spent += m.air; }
    won += ev.wrecks.filter((w) => w.winner === seat).length;
  }
  return { dives, rests: g.history.length - dives, avgAir: dives ? Math.round((spent / dives) * 10) / 10 : null, won };
}

export class MatchRoom {
  constructor(data, hooks, opts = {}) {
    this.d = data;
    this.hooks = hooks;
    this.fast = !!opts.fast;
    this.waiters = new Set();
    // Emotes and watcher counts live in memory only: they are cheap chatter, not game state.
    this.emotes = [];
    this.emoteSeq = 0;
    this.lastEmote = new Map();
    this.watcherEmotes = [];
    this.reactions = [];
    this.viewers = new Map();
    // Viewer ids that took a seat here: they stop counting as watchers, even if an older request of theirs lands late.
    this.seated = new Set();
  }

  static create(code, params, hooks, opts = {}) {
    const d = {
      code,
      status: "lobby",
      version: 0,
      createdAt: hooks.now(),
      settings: { seats: params.seats, turnSeconds: params.turnSeconds, botLevel: params.botLevel },
      seed: 1 + randInt(2 ** 31 - 1),
      seats: new Array(params.seats).fill(null),
      moves: {},
      botDue: {},
      rounds: [],
      game: null,
    };
    const room = new MatchRoom(d, hooks, opts);
    const seat = room.addSeat(params.name, "human");
    // A rematch brings back the same bot crew (names and levels), so a series has the same rivals.
    for (let i = 0; i < params.bots; i++) {
      const c = params.crew && params.crew[i];
      if (c) room.addSeat(c.name, "bot", c.level);
      else room.addBot();
    }
    if (d.seats.every(Boolean)) room.startMatch();
    else room.commit(true);
    return { room, seat, token: d.seats[seat].token };
  }

  snapshot() {
    return this.d;
  }

  get status() {
    return this.d.status;
  }

  summary() {
    const d = this.d;
    return {
      code: d.code,
      version: d.version,
      status: d.status,
      host: d.seats[0] ? d.seats[0].name : "",
      seats: d.settings.seats,
      filled: d.seats.filter(Boolean).length,
      turnSeconds: d.settings.turnSeconds,
      players: d.seats.map((s) => s && s.name),
      tide: d.game ? d.game.tide : 0,
      tides: RULES.tides,
      createdAt: d.createdAt,
      finishedAt: d.finishedAt || null,
    };
  }

  // After a process restart the old deadlines are stale; give everyone a fresh window.
  rearm() {
    const d = this.d;
    if (d.status !== "playing") return this.schedule();
    const now = this.hooks.now();
    d.pauseUntil = Math.max(d.pauseUntil || 0, now + 1000);
    d.deadline = d.pauseUntil + d.settings.turnSeconds * 1000;
    d.botDue = {};
    this.dueBots();
    this.commit(true);
  }

  // Bots take a human-ish moment to "think", shorter on fast timers; hard bots a little longer.
  botDelay(seat) {
    if (this.fast) return 5 + Math.random() * 20;
    const top = Math.min(4000, this.d.settings.turnSeconds * 200);
    const hard = (this.d.seats[seat] && this.d.seats[seat].level || this.d.settings.botLevel) === "hard";
    return 1000 + Math.random() * Math.max(0, top - 1000) + (hard ? Math.random() * 800 : 0);
  }

  dueBots() {
    const d = this.d;
    d.seats.forEach((s, seat) => {
      if (s.kind === "bot" && !d.moves[seat]) d.botDue[seat] = d.pauseUntil + this.botDelay(seat);
    });
  }

  isAway(seat) {
    const d = this.d;
    return d.seats[seat].kind !== "bot" && ((d.missed && d.missed[seat]) || 0) >= AWAY_AFTER;
  }

  resolveAt() {
    const d = this.d;
    const waiting = d.game.players.filter((p) => !d.moves[p.seat]);
    if (!waiting.length) return d.pauseUntil;
    if (waiting.every((p) => this.isAway(p.seat))) return Math.min(d.deadline, d.pauseUntil + AWAY_WAIT_MS);
    return d.deadline;
  }

  nextWake() {
    const d = this.d;
    const react = this.reactions.length ? this.reactions[0].at : null;
    const at = this.nextGameWake();
    return react !== null && (at === null || react < at) ? react : at;
  }

  nextGameWake() {
    const d = this.d;
    if (d.status === "lobby") return d.createdAt + LOBBY_TTL;
    if (d.status !== "playing") return null;
    let at = this.resolveAt();
    for (const [seat, due] of Object.entries(d.botDue)) if (!d.moves[seat] && due < at) at = due;
    return at;
  }

  schedule() {
    this.hooks.wake(this.nextWake());
  }

  commit(immediate = false) {
    this.d.version += 1;
    for (const w of [...this.waiters]) w();
    this.hooks.save(this.d, immediate);
    if (this.hooks.notify) this.hooks.notify(this.summary());
    this.schedule();
  }

  onWake() {
    const d = this.d;
    const now = this.hooks.now();
    this.fireReactions(now);
    try {
      if (d.status === "lobby") {
        if (now - d.createdAt >= LOBBY_TTL) {
          d.status = "expired";
          this.commit(true);
        } else this.schedule();
        return;
      }
      if (d.status !== "playing") return this.schedule();
      for (const [key, due] of Object.entries(d.botDue)) {
        const seat = Number(key);
        if (due > now) continue;
        delete d.botDue[key];
        if (d.moves[seat]) continue;
        try {
          this.submitMove(seat, chooseMove(d.game, seat, d.seats[seat].level || d.settings.botLevel));
        } catch (e) {
          console.error("bot move failed", d.code, e.message);
        }
      }
      if (d.status === "playing" && now >= this.resolveAt()) this.resolve();
      else this.schedule();
    } catch (e) {
      console.error("wake failed", d.code, e);
      this.schedule();
    }
  }

  addSeat(name, kind, level) {
    const d = this.d;
    const i = d.seats.findIndex((s) => !s);
    if (i < 0) throw conflict("lobby_full", "the lobby is full");
    let finalName = name;
    const taken = new Set(d.seats.filter(Boolean).map((s) => s.name));
    for (let n = 2; taken.has(finalName); n++) finalName = `${name.slice(0, 17)} ${n}`;
    d.seats[i] = { name: finalName, kind, token: kind === "human" ? randToken() : null };
    if (level) d.seats[i].level = level;
    return i;
  }

  addBot(level = this.d.settings.botLevel) {
    const used = new Set(this.d.seats.filter(Boolean).map((s) => s.name));
    const pool = BOT_NAMES.filter((n) => !used.has("Bot " + n));
    return this.addSeat("Bot " + (pool.length ? pool[randInt(pool.length)] : "Reef"), "bot", level);
  }

  startMatch() {
    const d = this.d;
    d.status = "playing";
    d.startedAt = this.hooks.now();
    d.game = createGame(d.seats.map((s) => s.name), d.seed);
    d.rounds = [];
    this.beginTide(this.fast ? 0 : 1500);
    this.commit(true);
  }

  beginTide(pause) {
    const d = this.d;
    d.moves = {};
    d.botDue = {};
    d.pauseUntil = this.hooks.now() + pause;
    d.deadline = d.pauseUntil + d.settings.turnSeconds * 1000;
    this.dueBots();
  }

  legalFor(seat) {
    const g = this.d.game;
    return { rest: true, wrecks: g.wrecks.map((w) => w.id), maxAir: g.players[seat].air, minAir: 1 };
  }

  submitMove(seat, move) {
    const d = this.d;
    const err = checkMove(d.game, seat, move);
    if (err) throw new ApiError(400, err, { code: "bad_move", legal: this.legalFor(seat) });
    d.moves[seat] = normalizeMove(move);
    if (d.missed) delete d.missed[seat];
    this.commit();
    return d.moves[seat];
  }

  resolve() {
    const d = this.d;
    const g = d.game;
    const before = { wrecks: g.wrecks.map((w) => ({ ...w })), players: g.players.map((p) => ({ seat: p.seat, air: p.air, pearls: p.pearls })) };
    d.missed = d.missed || {};
    for (const p of g.players) {
      if (d.seats[p.seat].kind === "bot" || d.moves[p.seat]) delete d.missed[p.seat];
      else d.missed[p.seat] = (d.missed[p.seat] || 0) + 1;
    }
    const ev = resolveTide(g, g.players.map((p) => d.moves[p.seat]));
    this.botReact(ev, g.finished);
    d.rounds.push({ tide: ev.tide, payout: ev.payout, event: ev.event, last: g.finished, before, moves: ev.moves, results: ev.wrecks, standings: ev.standings });
    if (g.finished) {
      d.status = "finished";
      d.finishedAt = this.hooks.now();
      d.deadline = null;
      d.botDue = {};
      this.commit(true);
    } else {
      // A contested tide gets a slightly longer reveal, so the close call can sink in.
      const contested = ev.wrecks.some((w) => w.divers.length > 1);
      this.beginTide(this.fast ? 0 : contested ? 4800 : 4000);
      this.commit();
    }
  }

  publicState(seat = null) {
    const d = this.d;
    const g = d.game;
    const now = this.hooks.now();
    const playing = d.status === "playing";
    const st = {
      code: d.code,
      status: d.status,
      version: d.version,
      serverTime: now,
      settings: d.settings,
      tides: RULES.tides,
      tide: g ? g.tide : 0,
      deadline: playing ? d.deadline : null,
      pauseUntil: playing ? d.pauseUntil : null,
      secondsLeft: playing ? Math.max(0, Math.ceil((d.deadline - now) / 1000)) : null,
      host: 0,
      seats: d.seats.map((s, i) => (s ? { seat: i, name: s.name, kind: s.kind, ...(s.kind === "bot" ? { level: s.level || d.settings.botLevel } : {}) } : null)),
      players: g
        ? g.players.map((p) => ({
            seat: p.seat,
            name: p.name,
            kind: d.seats[p.seat].kind,
            ...(d.seats[p.seat].kind === "bot" ? { level: d.seats[p.seat].level || d.settings.botLevel } : {}),
            air: p.air,
            pearls: p.pearls,
            submitted: playing ? !!d.moves[p.seat] : false,
            away: playing && this.isAway(p.seat),
            form: formOf(g, p.seat),
          }))
        : [],
      wrecks: g && !g.finished ? g.wrecks.map((w) => ({ ...w })) : [],
      event: g && !g.finished ? eventOf(g) : null,
      nextEvent: g && !g.finished && g.tide < g.tides ? eventOf(g, g.tide + 1) : null,
      lastReveal: g && g.history.length ? g.history[g.history.length - 1] : null,
      winners: g && g.finished ? g.winners : null,
      rematch: d.rematch ? d.rematch.code : null,
      watching: this.watching(now),
      emotes: this.emotes.filter((e) => now - e.at < EMOTE_SHOW).map((e) => ({ ...e })),
      rules: RULES_INFO,
    };
    if (seat !== null) {
      st.you = { seat, name: d.seats[seat].name, isHost: seat === 0, move: d.moves[seat] || null };
      if (playing) st.you.legal = this.legalFor(seat);
    }
    return st;
  }

  seatOf(token) {
    if (!token || typeof token !== "string") return null;
    const i = this.d.seats.findIndex((s) => s && s.token === token);
    return i < 0 ? null : i;
  }

  requireHost(token) {
    const seat = this.seatOf(token);
    if (seat === null) throw tokenError(token);
    if (seat !== 0) throw new ApiError(403, "only the host (seat 0) can do that", { code: "not_host" });
  }

  requireLobby() {
    if (this.d.status !== "lobby") throw conflict("already_started", "this match has already started (it starts by itself once every seat is filled)");
  }

  waitForChange(version, ms) {
    if (waiterTotal >= MAX_WAITERS) throw new ApiError(503, "too many long-polls, retry without ?wait");
    waiterTotal++;
    return new Promise((done) => {
      const fin = () => {
        clearTimeout(t);
        this.waiters.delete(fin);
        waiterTotal--;
        done();
      };
      const t = setTimeout(fin, ms);
      this.waiters.add(fin);
    });
  }

  closeWaiters() {
    for (const w of [...this.waiters]) w();
  }

  seeViewer(id) {
    if (this.seated.has(id)) return;
    const now = this.hooks.now();
    if (!this.viewers.has(id) && this.viewers.size >= MAX_VIEWERS) this.watching(now);
    if (this.viewers.has(id) || this.viewers.size < MAX_VIEWERS) this.viewers.set(id, now);
  }

  watching(now) {
    for (const [id, at] of this.viewers) if (now - at > VIEWER_TTL) this.viewers.delete(id);
    return this.viewers.size;
  }

  // Not saved: bumping the version wakes long-polls without spending a storage write.
  // After a restart the saved version can be lower than a client's ?wait, which answers at once.
  // Bots react to a reveal a moment after it shows: a silt-out, losing by one, a rich haul, gg at the end.
  // At most one per tide (two at the end), and like every emote they live in memory only.
  botReact(ev, finished) {
    const d = this.d;
    const bot = (seat) => d.seats[seat] && d.seats[seat].kind === "bot";
    const picks = [];
    for (const w of ev.wrecks) {
      const [top, next] = w.divers;
      for (const dv of w.divers) {
        if (!bot(dv.seat)) continue;
        if (w.tie && dv.air === top.air) picks.push([dv.seat, "wow"]);
        else if (w.winner !== null && dv.seat !== w.winner && top.air - dv.air === 1) picks.push([dv.seat, "ouch"]);
        else if (dv.seat === w.winner && w.gain >= 6) picks.push([dv.seat, "pearl"]);
        else if (dv.seat === w.winner && next && !bot(next.seat) && Math.random() < 0.4) picks.push([dv.seat, "lol"]);
      }
    }
    const bots = d.seats.map((s, i) => (s && s.kind === "bot" ? i : -1)).filter((i) => i >= 0);
    const chosen = [];
    if (finished) {
      const seats = [...bots].sort(() => Math.random() - 0.5).slice(0, 2);
      for (const seat of seats) if (Math.random() < 0.85) chosen.push([seat, "gg"]);
    } else if (picks.length && Math.random() < 0.6) chosen.push(picks[Math.floor(Math.random() * picks.length)]);
    const base = this.hooks.now() + (this.fast ? 5 : 1800);
    chosen.forEach(([seat, emote], i) => this.reactions.push({ seat, emote, at: base + i * (this.fast ? 5 : 900) + Math.random() * (this.fast ? 5 : 600) }));
    this.reactions.sort((a, b) => a.at - b.at);
  }

  fireReactions(now) {
    while (this.reactions.length && this.reactions[0].at <= now) {
      const r = this.reactions.shift();
      try {
        this.addEmote(r.seat, r.emote);
      } catch { /* rate-limited: skip it */ }
    }
  }

  addEmote(seat, emote) {
    const now = this.hooks.now();
    if (seat === null) {
      this.watcherEmotes = this.watcherEmotes.filter((t) => now - t < WATCHER_WINDOW);
      if (this.watcherEmotes.length >= WATCHER_EMOTES) {
        throw new ApiError(429, `watchers share ${WATCHER_EMOTES} emotes every ${WATCHER_WINDOW / 1000} s, try again shortly`, { retryAfterMs: WATCHER_WINDOW - (now - this.watcherEmotes[0]) });
      }
      this.watcherEmotes.push(now);
    } else {
      const last = this.lastEmote.get(seat);
      if (last !== undefined && now - last < EMOTE_GAP) {
        throw new ApiError(429, `one emote every ${EMOTE_GAP / 1000} s`, { retryAfterMs: EMOTE_GAP - (now - last) });
      }
      this.lastEmote.set(seat, now);
    }
    const e = { id: now.toString(36) + "-" + (this.emoteSeq++).toString(36), seat, name: seat === null ? "A watcher" : this.d.seats[seat].name, emote, at: now };
    this.emotes = [...this.emotes, e].slice(-EMOTE_KEEP);
    this.d.version += 1;
    for (const w of [...this.waiters]) w();
    return e;
  }

  async handle(method, sub, body, token, query, origin) {
    try {
      return await this.dispatch(method, sub, body || {}, token, query || {}, origin);
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, json: { error: e.message, ...e.extra } };
      console.error("handler error", e);
      return { status: 500, json: { error: "internal error" } };
    }
  }

  async dispatch(method, sub, body, token, query, origin) {
    const d = this.d;
    if (d.status === "expired") throw new ApiError(404, "no such match: " + d.code);
    if (sub === undefined) {
      if (method !== "GET") throw useMethod("GET");
      let seat = null;
      if (token) {
        seat = this.seatOf(token);
        if (seat === null) throw tokenError(token);
      }
      const wait = query.wait;
      if (wait !== undefined && wait !== null && wait !== "") {
        if (!/^\d{1,9}$/.test(String(wait))) throw new ApiError(400, "wait must be the version number you last saw, e.g. ?wait=12");
      }
      const viewer = query.viewer;
      if (viewer !== undefined && viewer !== null && viewer !== "") {
        if (!/^[A-Za-z0-9_-]{6,32}$/.test(String(viewer))) throw new ApiError(400, "viewer must be 6-32 letters, digits, _ or -, e.g. ?viewer=abc123");
        if (seat === null) this.seeViewer(String(viewer));
      }
      if (wait !== undefined && wait !== null && wait !== "" && d.version === Number(wait)) {
        await this.waitForChange(Number(wait), 25000);
        if (seat === null && viewer) this.seeViewer(String(viewer));
      }
      return { status: 200, json: this.publicState(seat) };
    }
    if (sub === "log" && method === "GET") {
      return {
        status: 200,
        json: {
          code: d.code,
          status: d.status,
          seed: d.status === "finished" ? d.seed : null,
          settings: d.settings,
          rules: RULES_INFO,
          names: d.seats.map((s) => s && s.name),
          kinds: d.seats.map((s) => s && s.kind),
          rounds: d.rounds,
          winners: d.game && d.game.finished ? d.game.winners : null,
        },
      };
    }
    if (method !== "POST") throw useMethod("POST");
    if (sub === "rematch:info" || sub === "rematch:set") {
      const seat = this.seatOf(token);
      if (seat === null) throw tokenError(token);
      if (d.status !== "finished") throw conflict("not_over", "the match is not over yet");
      const r = d.rematch || (d.rematch = { code: null, seats: {} });
      if (sub === "rematch:info") {
        if (r.seats[seat]) return { status: 200, json: { mine: r.seats[seat] } };
        const crew = d.seats.filter((x) => x.kind === "bot").map((x) => ({ name: x.name, level: x.level || d.settings.botLevel }));
        return { status: 200, json: { next: r.code, name: d.seats[seat].name, seats: d.settings.seats, bots: crew.length, crew, turnSeconds: d.settings.turnSeconds, botLevel: d.settings.botLevel } };
      }
      const { code, seat: s2, token: t2, url } = body;
      if (!r.code) r.code = code;
      r.seats[seat] = { code, seat: s2, token: t2, url };
      this.commit(true);
      return { status: 200, json: r.seats[seat] };
    }
    if (sub === "join") {
      if (d.status === "finished" || d.status === "expired") throw conflict("match_over", "the match is over, see /log or start a new one");
    if (d.seats.every(Boolean)) throw d.status === "lobby" ? conflict("lobby_full", "the lobby is full") : conflict("match_running", "the match is full and already running, watch it instead");
      this.requireLobby();
      const seat = this.addSeat(cleanName(body.name, "Diver"), "human");
      const v = query && query.viewer;
      if (v && /^[A-Za-z0-9_-]{6,32}$/.test(String(v)) && this.seated.size < 16) { this.seated.add(String(v)); this.viewers.delete(String(v)); }
      if (d.seats.every(Boolean)) this.startMatch();
      else this.commit(true);
      return { status: 200, json: { seat, token: d.seats[seat].token, url: `${origin}/m/${d.code}` } };
    }
    if (sub === "bots") {
      this.requireHost(token);
      this.requireLobby();
      const free = d.seats.filter((s) => !s).length;
      const n = body.count === undefined ? 1 : body.count;
      if (!Number.isInteger(n) || n < 1) throw new ApiError(400, "count must be a whole number, at least 1");
      const level = body.level === undefined || body.level === null ? d.settings.botLevel : body.level;
      if (!LEVELS.includes(level)) throw new ApiError(400, "level must be one of: " + LEVELS.join(", "));
      if (free === 0) throw conflict("no_empty_seats", "no empty seats");
      for (let i = 0; i < Math.min(n, free); i++) this.addBot(level);
      if (d.seats.every(Boolean)) this.startMatch();
      else this.commit(true);
      return { status: 200, json: this.publicState(0) };
    }
    if (sub === "start") {
      this.requireHost(token);
      this.requireLobby();
      while (d.seats.some((s) => !s)) this.addBot();
      this.startMatch();
      return { status: 200, json: this.publicState(0) };
    }
    if (sub === "move") {
      const seat = this.seatOf(token);
      if (seat === null) throw tokenError(token);
      if (d.status !== "playing") throw d.status === "lobby" ? conflict("not_started", "the match has not started yet: wait until status is \"playing\" (the host starts it, or it starts when every seat is filled)") : conflict("match_over", "the match is over");
      const move = parseMove(body, () => this.legalFor(seat));
      const odd = Object.keys(body).filter((k) => !["wreck", "air", "rest", "token", "tide"].includes(k));
      if (body.tide !== undefined && body.tide !== null && !/^\d{1,2}$/.test(String(body.tide))) throw new ApiError(400, "tide must be the tide number from the state (or left out)", { code: "bad_move", legal: this.legalFor(seat) });
      if (body.tide !== undefined && body.tide !== null && Number(body.tide) !== d.game.tide)
        throw conflict("stale_tide", `that move was for tide ${body.tide}, but it is tide ${d.game.tide} now: read the state again and move for tide ${d.game.tide}`, { tide: d.game.tide, legal: this.legalFor(seat) });
      const err = checkMove(d.game, seat, move);
      if (err) throw new ApiError(400, err + (odd.length ? ` (unknown field "${odd[0]}" was ignored: ${MOVE_SHAPE})` : ""), { code: "bad_move", legal: this.legalFor(seat) });
      const accepted = this.submitMove(seat, move);
      return { status: 200, json: { ok: true, tide: d.game.tide, move: accepted, version: d.version } };
    }
    if (sub === "emote") {
      let seat = null;
      if (token) {
        seat = this.seatOf(token);
        if (seat === null) throw tokenError(token);
      }
      const emote = body.emote;
      if (!EMOTES.includes(emote)) throw new ApiError(400, `emote must be one of: ${EMOTES.join(", ")}`, { emotes: EMOTES });
      const e = this.addEmote(seat, emote);
      return { status: 200, json: { ok: true, emote: e, version: d.version } };
    }
    throw new ApiError(404, "unknown endpoint, see /docs");
  }
}
