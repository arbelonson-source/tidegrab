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
  eventTides: 4,
  currentRest: 3,
  seamBonus: 3,
  minPlayers: 2,
  maxPlayers: 4,
});

// The last tide pays every pearl twice, so a lead is never safe until the end.
export function payout(g) {
  return g.tide >= g.tides ? RULES.finalPayout : 1;
}

// One public event per tide, dealt from the seed. Tide 8 is always calm because it already pays double.
export const EVENTS = Object.freeze({
  calm: "Calm: nothing special.",
  current: `Strong current: resting gives +${RULES.currentRest} Air instead of +${RULES.restGain}.`,
  seam: `Rich seam: the new wreck starts with ${RULES.seamBonus} extra pearls.`,
  bloom: `Air pocket bloom: every wreck holds an air pocket (+${RULES.airPocket} Air for its winner).`,
  slack: "Slack water: no Air comes back at the end of this tide.",
});

export function eventOf(g, tide = g.tide) {
  return (g.forecast && g.forecast[tide - 1]) || "calm";
}

export function restGain(g) {
  return eventOf(g) === "current" ? RULES.currentRest : RULES.restGain;
}

export function tideGain(g) {
  return eventOf(g) === "slack" ? 0 : RULES.tideGain;
}

export const OPENING_PEARLS = 6;

function dealForecast(seed) {
  const f = Array(RULES.tides).fill("calm");
  const g = { rng: (seed ^ 0x9e3779b9) | 0 };
  // Tide 1 stays calm so a first match opens on the plain rules; events land on tides 2 to 7.
  const slots = Array.from({ length: RULES.tides - 2 }, (_, i) => i + 1);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(random(g) * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const deck = ["current", "seam", "bloom", "slack"];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random(g) * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  slots.slice(0, RULES.eventTides).forEach((t, k) => { f[t] = deck[k % deck.length]; });
  return f;
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
  const fresh = [];
  while (g.wrecks.length < wreckCount(g.players.length)) {
    const w = newWreck(g);
    g.wrecks.push(w);
    fresh.push(w);
  }
  const ev = eventOf(g);
  if (ev === "bloom") for (const w of g.wrecks) if (!w.air) w.air = RULES.airPocket;
  if (ev === "seam") {
    const w = fresh.length ? fresh[fresh.length - 1] : g.wrecks.reduce((a, b) => (b.pearls < a.pearls ? b : a));
    w.pearls = Math.min(RULES.maxPearls, w.pearls + RULES.seamBonus);
  }
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
    forecast: dealForecast(seed),
  };
  refill(g);
  // Open with something worth fighting over: the richest first wreck holds at least OPENING_PEARLS.
  const top = g.wrecks.reduce((a, b) => (b.pearls > a.pearls ? b : a));
  top.pearls = Math.max(top.pearls, OPENING_PEARLS);
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
    if (m.rest) p.air += restGain(g);
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

  const regen = tideGain(g);
  for (const p of g.players) p.air = Math.min(RULES.maxAir, p.air + regen);

  g.wrecks = kept;
  const event = {
    tide: g.tide,
    payout: mult,
    event: eventOf(g),
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
