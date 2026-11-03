import { randInt } from "./room.js";

export const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const MAX_LIVE = 60;
export const MAX_LOBBIES = 200;
export const MAX_PER_IP = 5;
const STALE_MS = 3 * 3600000;

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
    this.prune();
    if (ip) {
      let mine = 0;
      for (const s of this.items.values()) if (s.status === "lobby" && s.ip === ip) mine++;
      if (mine >= MAX_PER_IP) return `you already have ${MAX_PER_IP} open lobbies, start or let one expire first`;
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
    this.items.set(code, { code, status: "lobby", createdAt: Date.now(), ip: ip || null });
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
