import { createGame, resolveTide, RULES } from "./engine.js";
import { chooseMove } from "./bots/brain.js";

function mulberry(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const biggest = (g) => g.wrecks.reduce((a, b) => (b.pearls + b.air > a.pearls + a.air ? b : a));

export const strategies = {
  smart: (g, s, r) => chooseMove(g, s, "normal", r),
  easy: (g, s, r) => chooseMove(g, s, "easy", r),
  hard: (g, s, r) => chooseMove(g, s, "hard", r),
  bigHigh: (g, s) => {
    const air = g.players[s].air;
    return { wreck: biggest(g).id, air: Math.max(1, Math.ceil(air * 0.8)) };
  },
  dodger: (g, s, r) => ({ wreck: g.wrecks[Math.floor(r() * g.wrecks.length)].id, air: 1 }),
  random: (g, s, r) => {
    const air = g.players[s].air;
    if (r() < 0.2) return { rest: true };
    return { wreck: g.wrecks[Math.floor(r() * g.wrecks.length)].id, air: 1 + Math.floor(r() * air) };
  },
  sample: (g, s, r) => {
    const air = g.players[s].air;
    if (air < 1 || (air < 3 && r() < 0.6)) return { rest: true };
    const v = (w) => w.pearls + 3 * w.air;
    const best = g.wrecks.reduce((a, b) => (v(b) > v(a) ? b : a));
    return { wreck: best.id, air: Math.max(1, Math.min(air, Math.round(air * 0.3 + v(best) * 0.25 + (r() * 2 - 1)))) };
  },
  restHeavy: (g, s) => {
    const air = g.players[s].air;
    return air < 6 ? { rest: true } : { wreck: biggest(g).id, air: 4 };
  },
};

export function playGame(names, seed, strats, rnd) {
  const g = createGame(names, seed);
  while (!g.finished) {
    const moves = g.players.map((p) => strats[p.seat](g, p.seat, rnd));
    resolveTide(g, moves);
  }
  return g;
}

function run(strats, n, seedBase) {
  const wins = strats.map(() => 0);
  const rnd = mulberry(seedBase * 7919 + 1);
  for (let i = 0; i < n; i++) {
    const order = strats.map((_, k) => k);
    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }
    const g = playGame(order.map((k) => "p" + k), seedBase + i, order.map((k) => strats[k]), rnd);
    const w = g.winners;
    for (const seat of w) wins[order[seat]] += 1 / w.length;
  }
  return wins.map((x) => x / n);
}

const pct = (x) => (x * 100).toFixed(1).padStart(5) + "%";

if (import.meta.url === `file://${process.argv[1]}`) {
  const N = Number(process.env.GAMES || 6000);
  const names = Object.keys(strategies);
  for (const players of [2, 3, 4]) {
    console.log(`\n=== ${players} players, ${N} games per row (fair share ${pct(1 / players)}) ===`);
    console.log("one strategy vs a field of smart bots:");
    for (const n of names) {
      const strats = [strategies[n], ...Array(players - 1).fill(strategies.smart)];
      console.log("  " + n.padEnd(10), pct(run(strats, N, 1000)[0]));
    }
    console.log("mixed table, each seat drawn at random from the whole pool:");
    const wins = Object.fromEntries(names.map((n) => [n, 0]));
    const cnt = Object.fromEntries(names.map((n) => [n, 0]));
    const rnd = mulberry(55);
    const M = N;
    for (let i = 0; i < M; i++) {
      const pick = Array.from({ length: players }, () => names[Math.floor(rnd() * names.length)]);
      const g = playGame(pick.map((_, k) => "p" + k), 5000 + i, pick.map((n) => strategies[n]), rnd);
      pick.forEach((n) => cnt[n]++);
      for (const s of g.winners) wins[pick[s]] += 1 / g.winners.length;
    }
    for (const n of names) console.log("  " + n.padEnd(10), pct(wins[n] / cnt[n]));
  }
  console.log(`\nrules: ${JSON.stringify(RULES)}`);
}
