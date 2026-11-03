import { RULES, createGame, checkMove, normalizeMove, resolveTide } from "../engine.js";
import { chooseMove, LEVELS } from "../bots/brain.js";

const BOT_NAMES = ["Coral", "Kelp", "Manta", "Brine", "Nacre", "Squall", "Abyss", "Tern"];
const LOBBY_TTL = 900000;
const MAX_WAITERS = 400;
const NO_TOKEN = "missing or unknown token for this match (send it as 'Authorization: Bearer <token>' or a 'token' field)";
let waiterTotal = 0;

export const RULES_TEXT =
  "Two to four divers race through eight tides. Each tide, wrecks lie on the seabed, each holding pearls (the points) " +
  "and sometimes an air pocket (+3 Air for whoever claims it). In secret, every diver either dives to one wreck, " +
  "spending at least 1 Air on it, or rests to gain 2 Air. When everyone has chosen, the choices are revealed: at each " +
  "wreck the single diver who spent the most Air takes its pearls and air pocket, but if two or more divers tie for " +
  "the most, the silt clouds the water and nobody takes it. All Air spent is gone, even if you lose. Unclaimed wrecks " +
  "stay and grow by 1 pearl, and every diver regains 1 Air each tide (up to 10). The eighth and final tide pays " +
  "double: every pearl won on it counts twice. After it, the diver with the most pearls wins; ties go to whoever " +
  "has more Air left. A diver who does not move before the timer runs out rests.";

const MOVE_SHAPE = 'send {"wreck": <id>, "air": <n>} or {"rest": true}';

function parseMove(body, legal) {
  const has = (k) => body[k] !== undefined && body[k] !== null;
  const fail = (msg) => {
    throw new ApiError(400, msg, { legal: legal() });
  };
  const odd = Object.keys(body).filter((k) => !["wreck", "air", "rest", "token"].includes(k));
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

export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
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
export class MatchRoom {
  constructor(data, hooks, opts = {}) {
    this.d = data;
    this.hooks = hooks;
    this.fast = !!opts.fast;
    this.waiters = new Set();
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
    for (let i = 0; i < params.bots; i++) room.addBot();
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

  botDelay() {
    return this.fast ? 5 + Math.random() * 20 : 500 + Math.random() * 1500;
  }

  dueBots() {
    const d = this.d;
    d.seats.forEach((s, seat) => {
      if (s.kind === "bot" && !d.moves[seat]) d.botDue[seat] = d.pauseUntil + this.botDelay();
    });
  }

  resolveAt() {
    const d = this.d;
    return d.game.players.every((p) => d.moves[p.seat]) ? d.pauseUntil : d.deadline;
  }

  nextWake() {
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
          this.submitMove(seat, chooseMove(d.game, seat, d.settings.botLevel));
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

  addSeat(name, kind) {
    const d = this.d;
    const i = d.seats.findIndex((s) => !s);
    if (i < 0) throw new ApiError(400, "the lobby is full");
    let finalName = name;
    const taken = new Set(d.seats.filter(Boolean).map((s) => s.name));
    for (let n = 2; taken.has(finalName); n++) finalName = `${name.slice(0, 17)} ${n}`;
    d.seats[i] = { name: finalName, kind, token: kind === "human" ? randToken() : null };
    return i;
  }

  addBot() {
    const used = new Set(this.d.seats.filter(Boolean).map((s) => s.name));
    const pool = BOT_NAMES.filter((n) => !used.has("Bot " + n));
    return this.addSeat("Bot " + (pool.length ? pool[randInt(pool.length)] : "Reef"), "bot");
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
    if (err) throw new ApiError(400, err, { legal: this.legalFor(seat) });
    d.moves[seat] = normalizeMove(move);
    this.commit();
    return d.moves[seat];
  }

  resolve() {
    const d = this.d;
    const g = d.game;
    const before = { wrecks: g.wrecks.map((w) => ({ ...w })), players: g.players.map((p) => ({ seat: p.seat, air: p.air, pearls: p.pearls })) };
    const ev = resolveTide(g, g.players.map((p) => d.moves[p.seat]));
    d.rounds.push({ tide: ev.tide, payout: ev.payout, last: g.finished, before, moves: ev.moves, results: ev.wrecks, standings: ev.standings });
    if (g.finished) {
      d.status = "finished";
      d.finishedAt = this.hooks.now();
      d.deadline = null;
      d.botDue = {};
      this.commit(true);
    } else {
      this.beginTide(this.fast ? 0 : 4000);
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
      seats: d.seats.map((s, i) => (s ? { seat: i, name: s.name, kind: s.kind } : null)),
      players: g
        ? g.players.map((p) => ({
            seat: p.seat,
            name: p.name,
            kind: d.seats[p.seat].kind,
            air: p.air,
            pearls: p.pearls,
            submitted: playing ? !!d.moves[p.seat] : false,
          }))
        : [],
      wrecks: g && !g.finished ? g.wrecks.map((w) => ({ ...w })) : [],
      lastReveal: g && g.history.length ? g.history[g.history.length - 1] : null,
      winners: g && g.finished ? g.winners : null,
      rematch: d.rematch ? d.rematch.code : null,
      rules: { text: RULES_TEXT, ...RULES },
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
    if (seat === null) throw new ApiError(401, NO_TOKEN);
    if (seat !== 0) throw new ApiError(403, "only the host (seat 0) can do that");
  }

  requireLobby() {
    if (this.d.status !== "lobby") throw new ApiError(400, "this match has already started (it starts by itself once every seat is filled)");
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
      if (method !== "GET") throw new ApiError(405, "use GET");
      let seat = null;
      if (token) {
        seat = this.seatOf(token);
        if (seat === null) throw new ApiError(401, NO_TOKEN);
      }
      const wait = query.wait;
      if (wait !== undefined && wait !== null && wait !== "") {
        if (!/^\d{1,9}$/.test(String(wait))) throw new ApiError(400, "wait must be the version number you last saw, e.g. ?wait=12");
        if (d.version <= Number(wait)) await this.waitForChange(Number(wait), 25000);
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
          rules: RULES,
          names: d.seats.map((s) => s && s.name),
          kinds: d.seats.map((s) => s && s.kind),
          rounds: d.rounds,
          winners: d.game && d.game.finished ? d.game.winners : null,
        },
      };
    }
    if (method !== "POST") throw new ApiError(405, "use POST");
    if (sub === "rematch:info" || sub === "rematch:set") {
      const seat = this.seatOf(token);
      if (seat === null) throw new ApiError(401, NO_TOKEN);
      if (d.status !== "finished") throw new ApiError(400, "the match is not over yet");
      const r = d.rematch || (d.rematch = { code: null, seats: {} });
      if (sub === "rematch:info") {
        if (r.seats[seat]) return { status: 200, json: { mine: r.seats[seat] } };
        const bots = d.seats.filter((x) => x.kind === "bot").length;
        return { status: 200, json: { next: r.code, name: d.seats[seat].name, seats: d.settings.seats, bots, turnSeconds: d.settings.turnSeconds, botLevel: d.settings.botLevel } };
      }
      const { code, seat: s2, token: t2, url } = body;
      if (!r.code) r.code = code;
      r.seats[seat] = { code, seat: s2, token: t2, url };
      this.commit(true);
      return { status: 200, json: r.seats[seat] };
    }
    if (sub === "join") {
      if (d.seats.every(Boolean)) throw new ApiError(400, d.status === "lobby" ? "the lobby is full" : "the match is full and already running, watch it instead");
      this.requireLobby();
      const seat = this.addSeat(cleanName(body.name, "Diver"), "human");
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
      if (free === 0) throw new ApiError(400, "no empty seats");
      for (let i = 0; i < Math.min(n, free); i++) this.addBot();
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
      if (seat === null) throw new ApiError(401, NO_TOKEN);
      if (d.status !== "playing") throw new ApiError(400, d.status === "lobby" ? "the match has not started yet: wait until status is \"playing\" (the host starts it, or it starts when every seat is filled)" : "the match is over");
      const move = parseMove(body, () => this.legalFor(seat));
      const accepted = this.submitMove(seat, move);
      return { status: 200, json: { ok: true, tide: d.game.tide, move: accepted, version: d.version } };
    }
    throw new ApiError(404, "unknown endpoint, see /docs");
  }
}
