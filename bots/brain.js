import { RULES, payout, eventOf, restGain, tideGain } from "../engine.js";

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

function legalMoves(g, seat) {
  const air = g.players[seat].air;
  const out = [{ rest: true }];
  for (const w of g.wrecks) for (let b = 1; b <= air; b++) out.push({ wreck: w.id, air: b });
  return out;
}

function easyMove(g, seat, rnd) {
  const p = g.players[seat];
  if (p.air < 1 || rnd() < 0.25) return { rest: true };
  const w = pick(g.wrecks, rnd);
  const hi = Math.max(1, Math.ceil(p.air * 0.6));
  return { wreck: w.id, air: 1 + Math.floor(rnd() * hi) };
}

// Value of one Air in pearls: high early, close to zero on the last tide
// where it only breaks ties.
function airValue(g) {
  const left = g.tides - g.tide;
  if (left <= 0) return 0.03;
  let v = Math.min(1.0, 0.12 + 0.11 * left);
  if (eventOf(g) === "slack") v *= 1.15;
  const next = eventOf(g, g.tide + 1);
  if (next === "seam" || next === "bloom") v *= 1.15;
  return Math.min(1.2, v);
}

function wreckValue(w, lam, mult = 1) {
  return w.pearls * mult + w.air * lam;
}

// Rough model of a rival: chance of resting, a pull towards juicy wrecks, and
// a bid that is somewhere between 1 and a bit more than half their Air.
function rivalModel(g, rival, lam) {
  const A = rival.air;
  const restP = A <= 1 ? 0.85 : A <= 3 ? 0.4 : 0.15;
  const weights = g.wrecks.map((w) => Math.pow(wreckValue(w, lam, payout(g)) + 1, 1.6));
  const sum = weights.reduce((a, b) => a + b, 0);
  const hi = Math.max(1, Math.min(A, Math.ceil(A * 0.9) + 1));
  return { restP, hi, wreckP: weights.map((x) => ((1 - restP) * x) / sum) };
}

function pRivalBidsAtLeast(model, b) {
  if (b > model.hi) return 0;
  return (model.hi - b + 1) / model.hi;
}

function normalMove(g, seat, rnd) {
  const me = g.players[seat];
  const lam = airValue(g);
  const models = g.players.map((p, i) => (i === seat ? null : rivalModel(g, p, lam)));
  const options = [{ move: { rest: true }, ev: restGain(g) * lam * 1.3 }];
  g.wrecks.forEach((w, wi) => {
    const prize = wreckValue(w, lam, payout(g));
    for (let b = 1; b <= me.air; b++) {
      let pWin = 1;
      for (const m of models) {
        if (!m) continue;
        pWin *= 1 - m.wreckP[wi] * pRivalBidsAtLeast(m, b);
      }
      options.push({ move: { wreck: w.id, air: b }, ev: pWin * prize - b * lam });
    }
  });
  const best = Math.max(...options.map((o) => o.ev));
  const temp = 0.35 + 0.15 * Math.abs(best);
  const weights = options.map((o) => Math.exp((o.ev - best) / temp));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) return options[i].move;
  }
  return options[0].move;
}

// One step of look-ahead: sample what the rivals might do with the normal
// model, then pick the move that leaves us furthest ahead on average.
function settle(g, moves, seat, lam, mult, last) {
  const pearls = g.players.map((p) => p.pearls);
  const air = g.players.map((p, i) => p.air + (moves[i].rest ? restGain(g) : -moves[i].air));
  for (const w of g.wrecks) {
    let top = 0, who = -1;
    moves.forEach((m, i) => {
      if (m.wreck !== w.id) return;
      if (m.air > top) { top = m.air; who = i; } else if (m.air === top) who = -1;
    });
    if (who >= 0) { pearls[who] += w.pearls * mult; air[who] += w.air; }
  }
  const val = (i) => pearls[i] + lam * Math.min(RULES.maxAir, air[i] + tideGain(g));
  let rival = -Infinity;
  for (let i = 0; i < pearls.length; i++) if (i !== seat) rival = Math.max(rival, val(i));
  const lead = val(seat) - rival;
  if (last) {
    let rp = -Infinity, ra = 0;
    for (let i = 0; i < pearls.length; i++) if (i !== seat && (pearls[i] > rp || (pearls[i] === rp && air[i] > ra))) { rp = pearls[i]; ra = air[i]; }
    const win = pearls[seat] > rp ? 1 : pearls[seat] === rp ? (air[seat] > ra ? 1 : air[seat] === ra ? 0.5 : 0) : 0;
    return win * 10 + 0.1 * (pearls[seat] - rp) + 0.01 * (air[seat] - ra);
  }
  return lead + 0.5 * val(seat);
}

// What a rival has actually done so far, read from the public tide history:
// how much of their Air they put in, which wreck (by rank of pearls) they
// went for, and when they rested.
function rivalRecords(g, seat) {
  const out = [];
  let air = RULES.startAir;
  for (const h of g.history) {
    const m = h.moves.find((x) => x.seat === seat);
    if (m) {
      if (m.rest) out.push({ air, rest: true });
      else {
        const order = h.wrecks.slice().sort((x, y) => y.pearls - x.pearls || y.air - x.air);
        const rank = Math.max(0, order.findIndex((w) => w.id === m.wreck));
        out.push({ air, frac: m.air / Math.max(1, air), rank });
      }
    }
    const st = h.standings.find((x) => x.seat === seat);
    if (st) air = st.air;
  }
  return out;
}

function sampleRecorded(g, rival, recs, rnd) {
  const A = rival.air;
  let total = 0;
  const ws = recs.map((r) => { const w = 1 / (1 + Math.abs(r.air - A)); total += w; return w; });
  let x = rnd() * total, rec = recs[0];
  for (let i = 0; i < recs.length; i++) { x -= ws[i]; if (x <= 0) { rec = recs[i]; break; } }
  if (rec.rest || A < 1) return { rest: true };
  const order = g.wrecks.slice().sort((p, q) => q.pearls - p.pearls || q.air - p.air);
  const w = order[Math.min(rec.rank, order.length - 1)];
  const jitter = rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0;
  const air = Math.max(1, Math.min(A, Math.round(rec.frac * A) + jitter));
  return { wreck: w.id, air };
}

function hardMove(g, seat, rnd, samples = 16) {
  const me = g.players[seat];
  const lam = airValue(g);
  const mult = payout(g);
  const last = g.tide >= g.tides;
  const cands = [{ rest: true }];
  for (const w of g.wrecks) for (let b = 1; b <= me.air; b++) cands.push({ wreck: w.id, air: b });
  const recs = g.players.map((p) => (p.seat === seat ? null : rivalRecords(g, p.seat)));
  const conf = recs.map((r) => {
    if (!r) return 0;
    const bids = r.filter((x) => !x.rest);
    if (bids.length < 2) return 0;
    const mean = bids.reduce((a, x) => a + x.frac, 0) / bids.length;
    const sd = Math.sqrt(bids.reduce((a, x) => a + (x.frac - mean) ** 2, 0) / bids.length);
    const steady = Math.max(0, 1 - sd * 16);
    return (r.length / (r.length + 2)) * steady;
  });
  const worlds = Array.from({ length: samples }, () =>
    g.players.map((p) => {
      if (p.seat === seat) return null;
      const r = recs[p.seat];
      return r.length && rnd() < conf[p.seat] ? sampleRecorded(g, p, r, rnd) : normalMove(g, p.seat, rnd);
    }));
  let best = cands[0], bestScore = -Infinity;
  for (const c of cands) {
    let s = rnd() * 1e-6;
    for (const w of worlds) { w[seat] = c; s += settle(g, w, seat, lam, mult, last); }
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best;
}

export const LEVELS = ["easy", "normal", "hard"];

export function chooseMove(g, seat, level = "normal", rnd = Math.random) {
  let move;
  try {
    move = level === "easy" ? easyMove(g, seat, rnd) : level === "hard" ? hardMove(g, seat, rnd) : normalMove(g, seat, rnd);
  } catch {
    move = null;
  }
  if (!move || !isLegal(g, seat, move)) return fallback(g, seat, rnd);
  return move;
}

function isLegal(g, seat, m) {
  if (m.rest === true) return true;
  const p = g.players[seat];
  return g.wrecks.some((w) => w.id === m.wreck) && Number.isInteger(m.air) && m.air >= 1 && m.air <= p.air;
}

function fallback(g, seat, rnd) {
  const legal = legalMoves(g, seat);
  return pick(legal, rnd);
}

export { RULES };
