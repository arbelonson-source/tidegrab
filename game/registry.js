import { randInt } from "./room.js";

export const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const MAX_LIVE = 60;
export const MAX_LOBBIES = 200;
export const MAX_PER_IP = 5;
export const MAX_LIVE_PER_IP = 12;
const STALE_MS = 3 * 3600000;

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

  update(summary) {
    if (summary.status === "expired" || summary.status === "finished") this.items.delete(summary.code);
    else this.items.set(summary.code, { ...this.items.get(summary.code), ...summary });
  }

  remove(code) {
    this.items.delete(code);
  }

  prune() {
    const stale = Date.now() - STALE_MS;
    let dropped = 0;
    for (const [code, s] of this.items) {
      if (s.createdAt < stale) {
        this.items.delete(code);
        dropped++;
      }
    }
    return dropped;
  }

  list() {
    const open = [];
    const live = [];
    this.prune();
    for (const s of this.items.values()) {
      if (s.status === "lobby" && s.players) open.push({ code: s.code, host: s.host, seats: s.seats, filled: s.filled, turnSeconds: s.turnSeconds });
      else if (s.status === "playing") live.push({ code: s.code, players: s.players, tide: s.tide, tides: s.tides });
    }
    return { open, live };
  }
}
