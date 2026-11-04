import { randInt, LOBBY_TTL } from "./room.js";

export const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const MAX_LIVE = 60;
export const MAX_LOBBIES = 200;
export const MAX_PER_IP = 5;
export const MAX_LIVE_PER_IP = 12;
const STALE_MS = 3 * 3600000;
// A playing match reports every tide (at most ~2.5 min apart), so silence means it is gone.
export const LIVE_SILENT_MS = 6 * 60000;
const DONE_KEEP_MS = 10 * 60000;

// One person on IPv6 usually holds a whole /64, so count those as one address.
export function ipKey(ip) {
  if (!ip) return null;
  const v = String(ip).trim().toLowerCase().replace(/^::ffff:(?=\d+\.)/, "");
  if (!v.includes(":")) return v;
  const [head, tail] = v.split("::");
  const a = head ? head.split(":") : [];
  const b = tail !== undefined && tail ? tail.split(":") : [];
  const full = tail === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill("0"), ...b];
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

export class Registry {
  constructor(items) {
    this.items = new Map(Object.entries(items || {}));
  }

  toJSON() {
    return Object.fromEntries(this.items);
  }

  count(status) {
    let n = 0;
    for (const s of this.items.values()) if (s.status === status) n++;
    return n;
  }

  checkCapacity(ip) {
    ip = ipKey(ip);
    this.prune();
    if (ip) {
      let open = 0, live = 0;
      for (const s of this.items.values()) if (s.ip === ip) s.status === "lobby" ? open++ : s.status === "playing" && live++;
      if (open >= MAX_PER_IP) return `you already have ${MAX_PER_IP} open lobbies, start one or let it expire (15 min) first`;
      if (open + live >= MAX_LIVE_PER_IP) return `you already have ${MAX_LIVE_PER_IP} matches running, let one finish first`;
    }
    if (this.count("playing") >= MAX_LIVE) return "the server is busy with too many live matches, try again in a minute";
    if (this.count("lobby") >= MAX_LOBBIES) return "too many open lobbies, try again in a minute";
    return null;
  }

  newCode() {
    for (let tries = 0; tries < 200; tries++) {
      let c = "";
      for (let i = 0; i < 5; i++) c += CODE_CHARS[randInt(CODE_CHARS.length)];
      if (!this.items.has(c)) return c;
    }
    throw new Error("no free match code");
  }

  reserve(code, ip) {
    this.items.set(code, { code, status: "lobby", createdAt: Date.now(), ip: ipKey(ip) });
  }

  // Updates can arrive out of order, so an older version never overwrites a newer one.
  // Finished and expired matches stay briefly as markers so a late "playing" update can't revive them.
  update(summary, now = Date.now()) {
    const old = this.items.get(summary.code);
    if (old && old.version != null && summary.version != null && summary.version < old.version) return;
    if (old && (old.status === "finished" || old.status === "expired") && summary.version == null) return;
    this.items.set(summary.code, { ...old, ...summary, seen: now });
  }

  remove(code) {
    this.items.delete(code);
  }

  prune(now = Date.now()) {
    let dropped = 0;
    for (const [code, s] of this.items) {
      const seen = s.seen || s.createdAt;
      const done = s.status === "finished" || s.status === "expired";
      // A lobby closes itself after LOBBY_TTL; drop it here too in case that news never arrived.
      const oldLobby = s.status === "lobby" && s.createdAt < now - LOBBY_TTL - 60000;
      if (oldLobby || s.createdAt < now - STALE_MS || (done && seen < now - DONE_KEEP_MS) || (s.status === "playing" && seen < now - 2.5 * LIVE_SILENT_MS)) {
        this.items.delete(code);
        dropped++;
      }
    }
    return dropped;
  }

  list(now = Date.now()) {
    const open = [];
    const live = [];
    this.prune(now);
    for (const s of this.items.values()) {
      if (s.status === "lobby" && s.players && s.createdAt >= now - LOBBY_TTL) open.push({ code: s.code, host: s.host, seats: s.seats, filled: s.filled, turnSeconds: s.turnSeconds, waitingSeconds: Math.max(0, Math.round((now - s.createdAt) / 1000)) });
      else if (s.status === "playing" && (s.seen || s.createdAt) >= now - LIVE_SILENT_MS) live.push({ code: s.code, players: s.players, tide: s.tide, tides: s.tides });
    }
    open.sort((a, b) => a.waitingSeconds - b.waitingSeconds);
    return { open, live };
  }
}
