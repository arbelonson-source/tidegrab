import { RULES, payout } from "../engine.js";

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
  return Math.min(1.0, 0.12 + 0.11 * left);
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
  const options = [{ move: { rest: true }, ev: 2 * lam * 1.3 }];
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

export function chooseMove(g, seat, level = "normal", rnd = Math.random) {
  let move;
  try {
    move = level === "easy" ? easyMove(g, seat, rnd) : normalMove(g, seat, rnd);
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
