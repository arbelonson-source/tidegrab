// Pure game rules for Tidegrab. No I/O here: the server and the simulator
// both drive these functions, so a match replays identically from its seed.

export const RULES = Object.freeze({
  tides: 8,
  startAir: 5,
  maxAir: 10,
  restGain: 2,
  tideGain: 1,
  growth: 1,
  maxPearls: 12,
  airPocket: 3,
  finalPayout: 2,
  minPlayers: 2,
  maxPlayers: 4,
});

// The last tide pays every pearl twice, so a lead is never safe until the end.
export function payout(g) {
  return g.tide >= g.tides ? RULES.finalPayout : 1;
}

export function wreckCount(players) {
  return Math.max(2, players - 1);
}

// mulberry32, with its state kept on the game object so it survives JSON.
export function random(g) {
  let t = (g.rng = (g.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function newWreck(g) {
  let pearls = 2 + Math.floor(random(g) * 6);
  let air = 0;
  if (random(g) < 0.3) {
    air = RULES.airPocket;
    pearls = Math.max(1, pearls - 2);
  }
  return { id: g.nextWreckId++, pearls, air, age: 0 };
}

function refill(g) {
  while (g.wrecks.length < wreckCount(g.players.length)) g.wrecks.push(newWreck(g));
}

export function createGame(names, seed) {
  if (names.length < RULES.minPlayers || names.length > RULES.maxPlayers) {
    throw new Error(`need ${RULES.minPlayers}-${RULES.maxPlayers} players`);
  }
  const g = {
    tide: 1,
    tides: RULES.tides,
    finished: false,
    players: names.map((name, seat) => ({ seat, name, air: RULES.startAir, pearls: 0 })),
    wrecks: [],
    rng: seed | 0,
    nextWreckId: 1,
    history: [],
  };
  refill(g);
  return g;
}

// Returns an error message, or null when the move is legal.
export function checkMove(g, seat, move) {
  if (g.finished) return "the match is over";
  const p = g.players[seat];
  if (!p) return "no such seat";
  if (!move || typeof move !== "object") return "move must be an object";
  if (move.rest === true) return null;
  const wreck = g.wrecks.find((w) => w.id === move.wreck);
  if (!wreck) return `wreck must be one of: ${g.wrecks.map((w) => w.id).join(", ")}`;
  if (!Number.isInteger(move.air) || move.air < 1) return "air must be a whole number, at least 1";
  if (move.air > p.air) return `you only have ${p.air} air`;
  return null;
}

export function normalizeMove(move) {
  return move.rest === true ? { rest: true } : { wreck: move.wreck, air: move.air };
}

// moves: array indexed by seat; a missing entry means the diver rested.
export function resolveTide(g, moves) {
  const taken = g.players.map((p, seat) => {
    const m = moves[seat];
    if (!m || checkMove(g, seat, m)) return { seat, rest: true, auto: true };
    return { seat, ...normalizeMove(m) };
  });

  for (const m of taken) {
    const p = g.players[m.seat];
    if (m.rest) p.air += RULES.restGain;
    else p.air -= m.air;
  }

  const mult = payout(g);
  const outcome = [];
  const kept = [];
  for (const w of g.wrecks) {
    const divers = taken.filter((m) => !m.rest && m.wreck === w.id).map((m) => ({ seat: m.seat, air: m.air }));
    divers.sort((a, b) => b.air - a.air);
    const top = divers.length ? divers[0].air : 0;
    const tie = divers.length > 1 && divers[1].air === top;
    const winner = divers.length && !tie ? divers[0].seat : null;
    const gain = winner !== null ? w.pearls * mult : 0;
    outcome.push({ id: w.id, pearls: w.pearls, air: w.air, divers, winner, tie, gain });
    if (winner !== null) {
      g.players[winner].pearls += gain;
      g.players[winner].air += w.air;
    } else {
      kept.push({ ...w, pearls: Math.min(RULES.maxPearls, w.pearls + RULES.growth), age: w.age + 1 });
    }
  }

  for (const p of g.players) p.air = Math.min(RULES.maxAir, p.air + RULES.tideGain);

  g.wrecks = kept;
  const event = {
    tide: g.tide,
    payout: mult,
    moves: taken,
    wrecks: outcome,
    standings: g.players.map((p) => ({ seat: p.seat, air: p.air, pearls: p.pearls })),
  };
  g.history.push(event);

  if (g.tide >= g.tides) {
    g.finished = true;
    g.winners = winners(g);
  } else {
    g.tide += 1;
    refill(g);
  }
  return event;
}

export function winners(g) {
  const best = Math.max(...g.players.map((p) => p.pearls));
  let top = g.players.filter((p) => p.pearls === best);
  const air = Math.max(...top.map((p) => p.air));
  top = top.filter((p) => p.air === air);
  return top.map((p) => p.seat);
}
