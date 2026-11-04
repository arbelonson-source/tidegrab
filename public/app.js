const app = document.getElementById("app");
const PEARL = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="#f2c14e"/><circle cx="7" cy="7" r="2.6" fill="#fff6d6" opacity=".85"/></svg>';
const POCKET = '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="7.5" cy="7.5" r="1.8" fill="currentColor"/></svg>';

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const icon = (svg, cls) => h("span", { class: cls || "", html: svg });

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};
const myName = () => store.get("tg:name") || "";
const tokenFor = (code) => store.get("tg:t:" + code);
const EMOJI = { wave: "👋", wow: "😮", lol: "😂", ouch: "😬", gg: "🤝", pearl: "🦪" };
const EMOTE_LABEL = { wave: "Wave", wow: "Wow", lol: "Laugh", ouch: "Ouch", gg: "Good game", pearl: "Pearl" };
function viewerId() {
  let v = store.get("tg:viewer");
  if (!v || !/^[A-Za-z0-9_-]{6,32}$/.test(v)) {
    v = Math.random().toString(36).slice(2, 12).padEnd(8, "0");
    store.set("tg:viewer", v);
  }
  return v;
}

function say(msg) {
  const el = document.getElementById("sr");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => { el.textContent = msg; }, 50);
}

function syncList(ul, rows, empty) {
  const list = rows.length ? rows : [{ key: "_empty", text: empty, muted: true }];
  const old = new Map([...ul.children].map((li) => [li.dataset.key, li]));
  list.forEach((r, i) => {
    let li = old.get(r.key);
    if (!li) {
      li = h("li", { "data-key": r.key, class: r.muted ? "muted" : null }, h("span"));
      if (!r.muted) li.append(h("a", { class: "btn" }));
    }
    old.delete(r.key);
    if (li.firstChild.textContent !== r.text) li.firstChild.textContent = r.text;
    if (!r.muted) {
      const a = li.lastChild;
      if (a.getAttribute("href") !== r.href) a.setAttribute("href", r.href);
      if (a.textContent !== r.label) a.textContent = r.label;
      if (a.getAttribute("aria-label") !== r.aria) a.setAttribute("aria-label", r.aria);
    }
    if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
  });
  old.forEach((li) => li.remove());
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

async function api(path, opts = {}) {
  const headers = { "content-type": "application/json" };
  if (opts.token) headers.authorization = "Bearer " + opts.token;
  const r = await fetch("/api" + path, {
    method: opts.body ? "POST" : "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  let data = {};
  try { data = await r.json(); } catch { /* non-JSON error body */ }
  if (!r.ok) {
    const e = new Error(data.error || "request failed (" + r.status + ")");
    e.status = r.status;
    throw e;
  }
  return data;
}

let cleanup = null;
function mount(fn) {
  if (cleanup) cleanup();
  cleanup = null;
  app.replaceChildren();
  fn();
  app.focus({ preventScroll: true });
}
const go = (url) => location.assign(url);

function bubbles() {
  const box = document.querySelector(".bubbles");
  if (!box || box.children.length) return;
  for (let i = 0; i < 14; i++) {
    const s = 6 + Math.random() * 18;
    box.append(h("i", { style: `left:${Math.random() * 100}%;width:${s}px;height:${s}px;animation-duration:${14 + Math.random() * 22}s;animation-delay:${-Math.random() * 30}s` }));
  }
}

async function createMatch(opts) {
  const name = (opts.name || myName() || "Diver").trim();
  store.set("tg:name", name);
  const made = await api("/matches", { body: { ...opts, name } });
  store.set("tg:t:" + made.code, made.token);
  go("/m/" + made.code);
}

const sv = (inner) => `<svg viewBox="0 0 120 64" width="120" height="64" aria-hidden="true" focusable="false">${inner}</svg>`;
const HELP_ART = [
  sv('<g fill="none" stroke="#3fd6c8" stroke-width="2"><path d="M8 52h30l-4-18H14z" fill="#0a2a44"/><path d="M62 52h30l-4-18H66z" fill="#0a2a44"/></g><circle cx="26" cy="26" r="6" fill="#f2c14e"/><rect x="82" y="8" width="30" height="18" rx="5" fill="#16425f" stroke="#3fd6c8"/><text x="97" y="21" text-anchor="middle" font-size="11" fill="#e6f6f8" font-family="sans-serif">air 3</text><path d="M97 28v8" stroke="#f2c14e" stroke-width="2"/>'),
  sv('<path d="M6 54h46l-5-20H11z" fill="#0a2a44" stroke="#3fd6c8" stroke-width="2"/><circle cx="29" cy="26" r="6" fill="#f2c14e"/><text x="29" y="12" text-anchor="middle" font-size="11" fill="#e6f6f8" font-family="sans-serif">5 vs 3</text><path d="M70 54h46l-5-20H75z" fill="#0a2a44" stroke="#ff8a7a" stroke-width="2" stroke-dasharray="4 3"/><circle cx="93" cy="26" r="6" fill="#f2c14e"/><circle cx="104" cy="22" r="4" fill="#f2c14e"/><text x="93" y="12" text-anchor="middle" font-size="11" fill="#e6f6f8" font-family="sans-serif">4 vs 4</text>'),
  sv('<g font-family="sans-serif" font-size="11" fill="#e6f6f8"><rect x="6" y="10" width="14" height="40" rx="3" fill="#16425f" stroke="#3fd6c8"/><rect x="26" y="30" width="14" height="20" rx="3" fill="#16425f" stroke="#3fd6c8" stroke-dasharray="3 2"/><text x="23" y="62" text-anchor="middle">air</text><circle cx="66" cy="38" r="8" fill="#f2c14e"/><text x="66" y="62" text-anchor="middle">x2</text><circle cx="98" cy="26" r="9" fill="#f2c14e"/><circle cx="108" cy="40" r="6" fill="#f2c14e"/><text x="98" y="62" text-anchor="middle">most wins</text></g>')
];
let helpDlg = null, helpOpener = null;
function helpDialog() {
  if (helpDlg) return helpDlg;
  const step = (i, t, p) => h("li", { class: "hstep" }, h("div", { class: "hart", html: HELP_ART[i] }), h("div", {}, h("b", {}, `${i + 1}. ${t}`), h("p", {}, p)));
  const k = (...a) => a.map((x) => h("kbd", {}, x));
  helpDlg = h("dialog", { class: "help", "aria-labelledby": "help-t" },
    h("div", { class: "row sb" }, h("h2", { id: "help-t" }, "How to play"), h("button", { class: "x", "aria-label": "Close help", onclick: () => helpDlg.close() }, "×")),
    h("p", { class: "sub" }, "2 to 4 divers, 8 tides. Play humans or bots (easy, normal or hard)."),
    h("ol", { class: "hsteps" },
      step(0, "Pick a wreck and spend air", "Everyone chooses in secret: one wreck and how much air to put in. Or rest to breathe and get +2 air."),
      step(1, "Biggest spender wins it", "The biggest single spender takes the wreck's pearls plus its air pocket. A tie silts it up: nobody gets it and it grows by a pearl."),
      step(2, "Air is spent for good", "Spent air does not come back, you only get +1 each tide (max 10). The last tide pays double. Most pearls after 8 tides wins, spare air breaks ties.")),
    h("h3", {}, "Tide events"),
    h("p", {}, "Four of the first seven tides bring an event everyone can see, announced one tide ahead: strong current (resting gives +3 air), rich seam (the new wreck has 3 extra pearls), air pocket bloom (every wreck holds an air pocket) or slack water (no air comes back that tide)."),
    h("h3", {}, "Keyboard"),
    h("dl", { class: "hkeys" },
      h("dt", {}, ...k("1", "2", "3", "4")), h("dd", {}, "pick a wreck"),
      h("dt", {}, ...k("↑", "↓")), h("dd", {}, "more or less air (also + and -)"),
      h("dt", {}, ...k("Enter")), h("dd", {}, "dive"),
      h("dt", {}, ...k("R")), h("dd", {}, "rest"),
      h("dt", {}, ...k("?")), h("dd", {}, "open this help"),
      h("dt", {}, ...k("Esc")), h("dd", {}, "close it")),
    h("div", { class: "row", style: "justify-content:flex-end;margin-top:14px" }, h("button", { class: "primary", onclick: () => helpDlg.close() }, "Got it")));
  helpDlg.addEventListener("close", () => { const o = helpOpener; helpOpener = null; (o && o.isConnected ? o : document.querySelector(".qbtn, .linkbtn") || app).focus({ preventScroll: true }); });
  helpDlg.addEventListener("click", (e) => { if (e.target === helpDlg) helpDlg.close(); });
  document.body.append(helpDlg);
  return helpDlg;
}
function openHelp(opener) {
  const d = helpDialog();
  if (d.open) return;
  helpOpener = opener || document.activeElement;
  d.showModal();
  d.querySelector(".x").focus();
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  if (helpDlg && helpDlg.open) return;
  e.preventDefault(); openHelp();
});
const helpBtn = () => h("button", { class: "qbtn", "aria-label": "How to play", title: "How to play (?)", onclick: (e) => openHelp(e.currentTarget) }, "?");
function autoHelp() {
  try { if (store.get("tg:help")) return; } catch {}
  store.set("tg:help", "1");
  openHelp(app);
}

function matchStats(rounds, players) {
  const S = Object.fromEntries(players.map((p) => [p.seat, { seat: p.seat, name: p.name, won: 0, pearls: 0, air: 0, ties: 0, best: null }]));
  let steal = null;
  for (const r of rounds) {
    for (const m of r.moves) if (!m.rest && m.wreck != null && S[m.seat]) S[m.seat].air += m.air || 0;
    for (const w of r.wrecks) {
      if (w.winner != null && S[w.winner]) {
        const p = S[w.winner], g = w.gain ?? w.pearls, a = (w.divers.find((d) => d.seat === w.winner) || {}).air || 0;
        p.won++; p.pearls += g;
        if (!p.best || g > p.best.gain) p.best = { id: w.id, gain: g };
        if (!steal || g - a > steal.gain - steal.air) steal = { seat: w.winner, gain: g, air: a };
      } else if (w.tie) {
        const top = Math.max(...w.divers.map((d) => d.air));
        for (const d of w.divers) if (d.air === top && S[d.seat]) S[d.seat].ties++;
      }
    }
  }
  return { rows: players.map((p) => S[p.seat]), steal };
}

function highlight(rounds, players) {
  const nm = (s) => (players.find((p) => p.seat === s) || {}).name;
  const { steal } = matchStats(rounds, players);
  let close = null;
  for (const r of rounds) for (const w of r.wrecks) {
    if (w.winner == null || w.divers.length < 2) continue;
    const a = w.divers.map((d) => d.air).sort((x, y) => y - x), gap = a[0] - a[1];
    if (gap >= 1 && (!close || gap < close.gap || (gap === close.gap && (w.gain ?? w.pearls) > close.gain))) close = { seat: w.winner, gap, gain: w.gain ?? w.pearls };
  }
  if (steal && steal.gain >= 3 && steal.air <= 2) return `Biggest steal: ${nm(steal.seat)} took ${steal.gain} pearl${steal.gain === 1 ? "" : "s"} with ${steal.air} air`;
  if (close && close.gap === 1 && close.gain >= 2) return `Closest call: ${nm(close.seat)} won by 1 air`;
  if (steal && steal.gain > 0 && steal.gain - steal.air >= 3) return `Biggest steal: ${nm(steal.seat)} took ${steal.gain} pearl${steal.gain === 1 ? "" : "s"} with ${steal.air} air`;
  return null;
}
function home() {
  const nameIn = h("input", { id: "nm", maxlength: 20, placeholder: "Your name", value: myName(), autocomplete: "nickname", "aria-label": "Your name" });
  const err = h("div", { class: "err", role: "alert" });
  const run = (fn) => async () => {
    try { err.textContent = ""; await fn(); } catch (e) { err.textContent = e.message; }
  };
  const seats = h("select", { id: "seats", "aria-label": "Seats" }, [2, 3, 4].map((n) => h("option", { value: n }, n + " players")));
  const bots = h("select", { id: "bots", "aria-label": "Bots now" }, [0, 1, 2, 3].map((n) => h("option", { value: n }, n === 0 ? "No bots yet" : n + (n === 1 ? " bot" : " bots"))));
  const secs = h("select", { id: "secs", "aria-label": "Seconds per tide" }, [20, 45, 90].map((n) => h("option", { value: n, selected: n === 45 }, n + " s per tide")));
  const lvl = h("select", { id: "lvl", "aria-label": "Bot level" }, [["normal", "Normal bots"], ["easy", "Easy bots"], ["hard", "Hard bots"]].map(([v, t]) => h("option", { value: v }, t)));
  const codeIn = h("input", { class: "code", maxlength: 5, placeholder: "CODE", "aria-label": "Match code", autocomplete: "off" });
  const lobbies = h("ul", { class: "list" }, h("li", { class: "muted" }, "Looking for open tables..."));
  const live = h("ul", { class: "list" });

  const create = run(() => createMatch({ name: nameIn.value, seats: +seats.value, bots: Math.min(+bots.value, +seats.value - 1), turnSeconds: +secs.value, botLevel: lvl.value }));
  const join = run(async () => {
    const code = codeIn.value.trim().toUpperCase();
    if (code.length < 4) throw new Error("Enter the match code");
    store.set("tg:name", nameIn.value.trim());
    if (!store.get("tg:t:" + code)) {
      try {
        const r = await api(`/matches/${code}/join`, { body: { name: nameIn.value } });
        store.set("tg:t:" + code, r.token);
      } catch (e) { if (/no such match/i.test(e.message)) throw new Error("No match with code " + code); }
    }
    go("/m/" + code);
  });

  mount(() => {
    app.append(
      h("section", { class: "hero" },
        h("h1", {}, "Tidegrab"),
        h("p", {}, "2 to 4 divers race for pearls over 8 tides. Each tide, secretly spend Air to dive on a wreck or rest to breathe. The biggest single spender at a wreck takes its pearls; a tie leaves the wreck to silt up and grow. Spent Air is gone, so every dive is a bet on what your rivals will do. The last tide pays double. Most pearls after 8 tides wins."),
        h("div", { class: "row", style: "justify-content:center;margin:22px 0 8px" },
          h("button", { class: "primary big", onclick: run(() => createMatch({ name: nameIn.value, seats: 2, bots: 1 })) }, "Play vs bot now")),
        err),
      h("div", { class: "grid2" },
        h("section", { class: "card" }, h("h2", {}, "Your table"),
          h("label", { for: "nm" }, "Name"), nameIn,
          h("div", { class: "grid2" }, h("div", {}, h("label", { for: "seats" }, "Seats"), seats), h("div", {}, h("label", { for: "bots" }, "Bots"), bots)),
          h("div", { class: "grid2" }, h("div", {}, h("label", { for: "secs" }, "Pace"), secs), h("div", {}, h("label", { for: "lvl" }, "Bots are"), lvl)),
          h("div", { style: "margin-top:12px" }, h("button", { class: "primary", onclick: create }, "Create match"))),
        h("section", { class: "card" }, h("h2", {}, "Join with a code"),
          h("div", { class: "row" }, h("div", { style: "flex:1;min-width:120px" }, codeIn), h("button", { onclick: join }, "Join")),
          h("h2", { style: "margin-top:18px" }, "Open tables"), lobbies,
          h("h2", { style: "margin-top:18px" }, "Watch live"), live)),
      h("p", { class: "muted center" }, h("button", { class: "linkbtn", onclick: (e) => openHelp(e.currentTarget) }, "How to play"), " · Agents welcome: ", h("a", { href: "/docs" }, "HTTP/JSON API docs")));
    codeIn.addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
    nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });
  });

  let stop = false, tm = 0, inflight = false;
  async function refresh() {
    clearTimeout(tm);
    if (stop || inflight || document.hidden) return;
    inflight = true;
    let delay = 20000;
    try {
      const d = await api("/matches");
      syncList(lobbies, d.open.map((m) => ({ key: m.code, text: `${m.code} · ${m.host} · ${m.filled}/${m.seats}`, href: "/m/" + m.code, label: "Join", aria: "Join table " + m.code })), "No open tables right now.");
      syncList(live, d.live.slice(0, 6).map((m) => ({ key: m.code, text: `${m.code} · ${m.players.join(", ")} · tide ${m.tide}/${m.tides}`, href: "/m/" + m.code, label: "Watch", aria: "Watch match " + m.code })), "No matches in progress.");
    } catch { delay = 60000; }
    inflight = false;
    if (!stop && !document.hidden) tm = setTimeout(refresh, delay);
  }
  const onVis = () => { if (!document.hidden) refresh(); };
  document.addEventListener("visibilitychange", onVis);
  refresh();
  cleanup = () => { stop = true; clearTimeout(tm); document.removeEventListener("visibilitychange", onVis); };
}

const bub = (n, max = 10) => h("span", { class: "bub", "aria-label": n + " air" }, Array.from({ length: max }, (_, i) => h("i", { class: i < n ? "" : "off" })));

function playersPanel(players, opts = {}) {
  const win = opts.winners || [];
  return h("div", { class: "players" }, players.map((p) => h("div", { class: "pl" + (p.seat === opts.me ? " me" : "") + (win.includes(p.seat) ? " win" : "") },
    h("div", { class: "nm" }, p.name, p.seat === opts.me ? h("span", { class: "pill you" }, "you") : null, p.kind === "bot" ? h("span", { class: "pill bot" }, "bot") : null),
    h("div", { class: "stat" }, bub(p.air), h("span", { class: "pearls" }, icon(PEARL), p.pearls)),
    h("div", { class: "sub" + (p.submitted && !opts.pausing ? " ok" : "") }, opts.hideStatus ? `${p.air} air` : opts.pausing ? "waiting" : p.submitted ? "ready" : "thinking..."))));
}

function why(w) {
  const a = w.divers.map((d) => d.air).sort((x, y) => y - x);
  if (!a.length) return null;
  if (w.tie) return `tie at ${a[0]}: the silt keeps it`;
  return a.length > 1 ? `${a[0]} air beat ${a[1]}` : "only one diver, uncontested";
}

const sound = (() => {
  let ctx = null, on = store.get("tg:sound") === "1", lastTick = 0;
  const btn = () => document.getElementById("snd");
  const sync = () => { const b = btn(); if (b) { b.setAttribute("aria-pressed", String(on)); b.classList.toggle("is-on", on); } };
  const ensure = () => {
    if (!on) return null;
    try {
      if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    } catch { return null; }
  };
  const tone = (freq, at, dur, vol, type, to) => {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  };
  const splash = () => {
    const c = ensure();
    if (!c) return;
    const n = Math.floor(c.sampleRate * 0.5), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf;
    f.type = "bandpass";
    f.frequency.setValueAtTime(1800, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(500, c.currentTime + 0.45);
    g.gain.value = 0.12;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  };
  const effects = {
    splash,
    coin: () => { tone(1319, 0, 0.35, 0.07, "sine"); tone(1976, 0.09, 0.5, 0.06, "sine"); },
    thud: () => tone(110, 0, 0.35, 0.16, "sine", 45),
    fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.13, i === 3 ? 0.6 : 0.2, 0.06, "triangle")),
    tick: () => tone(880, 0, 0.06, 0.04, "sine"),
  };
  return {
    init() {
      sync();
      const b = btn();
      if (!b) return;
      b.addEventListener("click", () => {
        on = !on;
        store.set("tg:sound", on ? "1" : "0");
        sync();
        if (on) { ensure(); effects.tick(); }
        say(on ? "Sound on" : "Sound off");
      });
    },
    play(name) { if (on && effects[name]) effects[name](); },
    tick(key) { if (on && key !== lastTick) { lastTick = key; effects.tick(); } },
  };
})();

const EV_NAME = { current: "Strong current", seam: "Rich seam", bloom: "Air pocket bloom", slack: "Slack water" };
const evBadge = (e) => EV_NAME[e] ? h("span", { class: "event" }, EV_NAME[e]) : null;

function revealPanel(rv, names, title, opts = {}) {
  const last = rv.last ?? rv.payout > 1;
  const nm = (s) => names[s] || "Seat " + (s + 1);
  const rests = rv.moves.filter((m) => m.rest).map((m) => nm(m.seat) + (m.auto ? " (timed out)" : ""));
  return h("div", {},
    h("h2", {}, title || `Tide ${rv.tide} reveal`, evBadge(rv.event)),
    h("div", { class: "reveal" }, rv.wrecks.map((w, i) => {
      const verdict = w.winner != null ? `${nm(w.winner)} takes ${w.gain ?? w.pearls} pearl${(w.gain ?? w.pearls) === 1 ? "" : "s"}${(w.gain ?? w.pearls) > w.pearls ? " (doubled)" : ""}${w.air ? " and +" + w.air + " air" : ""}` : w.tie ? (last ? "Silt-out! Tie, nobody takes it" : "Silt-out! Tie, it grows") : last ? "No divers" : "No divers, it grows";
      return h("div", { class: "rw" + (w.winner != null ? " won" : "") + (w.tie ? " silt" : "") + (!w.divers.length ? " empty" : ""), style: `animation-delay:${i * 0.25}s` },
        h("div", { class: "row sb" }, h("b", {}, `Wreck #${w.id}`), h("span", { class: "pearls" }, icon(PEARL), w.pearls)),
        w.winner != null ? h("span", { class: "plus", "aria-hidden": "true" }, "+" + (w.gain ?? w.pearls)) : null,
        w.divers.length && !opts.hideBids ? w.divers.map((d, j) => h("div", { class: "dv" + (w.winner === d.seat && j === 0 ? " top" : "") }, h("span", {}, nm(d.seat)), h("span", {}, d.air + " air"))) : null,
        h("div", { class: "verdict" }, verdict),
        why(w) && !opts.hideBids ? h("div", { class: "why" }, why(w)) : null);
    })),
    rests.length ? h("div", { class: "rests" }, "Rested: " + rests.join(", ")) : null);
}

const norm = (r) => ({ ...r, wrecks: r.results || r.wrecks });

function roundLine(r, names) {
  const nm = (s) => names[s] || "Seat " + (s + 1);
  const parts = r.wrecks.filter((w) => w.divers.length).map((w) => w.winner != null ? `${nm(w.winner)} took #${w.id} (${w.gain ?? w.pearls})` : `#${w.id} silted out`);
  const rested = r.moves.filter((m) => m.rest).length;
  if (rested) parts.push(rested + " rested");
  return `Tide ${r.tide}${EV_NAME[r.event] ? ` (${EV_NAME[r.event]})` : ""}: ` + (parts.join(" · ") || "quiet tide");
}

function standings(st, rounds) {
  const order = [...st.players].sort((a, b) => b.pearls - a.pearls || b.air - a.air);
  const stats = rounds && rounds.length ? Object.fromEntries(matchStats(rounds, st.players).rows.map((r) => [r.seat, r])) : null;
  const heads = ["Diver", "Pearls", "Air left"].concat(stats ? ["Won", "Ties", "Best dive"] : []);
  return h("div", { class: "tw" }, h("table", { class: "stand st2" }, h("caption", { class: "sr" }, "Final standings"),
    h("thead", {}, h("tr", {}, heads.map((c) => h("th", { scope: "col" }, c)))),
    h("tbody", {}, order.map((p) => {
      const r = stats && stats[p.seat], win = (st.winners || []).includes(p.seat);
      return h("tr", { class: win ? "w" : "" }, h("th", { scope: "row" }, p.name + (win ? " 🏆" : "")), h("td", {}, p.pearls), h("td", {}, p.air),
        r ? [h("td", {}, r.won), h("td", {}, r.ties), h("td", {}, r.best ? `#${r.best.id} for ${r.best.gain}` : "-")] : null);
    }))));
}
function match(code) {
  const ac = new AbortController();
  let st = null, alive = true, ver = 0, offset = 0, token = tokenFor(code), logRounds = [], logTide = 0;
  let sel = null, airVal = 2, selTide = 0, busy = false, errMsg = "", animW = "", animR = -1;
  let recon = false, newReveal = false, lastPause = false;
  let emoteWait = 0, emoteTimer = 0;
  const seenEmotes = new Set(), myEmotes = new Set();
  const ann = { tide: 0, lock: "", rv: 0, end: false, fresh: false };
  const root = h("div", {});
  mount(() => app.append(root));
  const tick = setInterval(updateTimer, 250);
  document.addEventListener("keydown", onKey);
  cleanup = () => { alive = false; ac.abort(); clearInterval(tick); document.removeEventListener("keydown", onKey); };

  const names = () => Object.fromEntries((st ? st.players : []).map((p) => [p.seat, p.name]));
  const now = () => Date.now() + offset;
  const isPausing = () => !!(st && st.pauseUntil && now() < st.pauseUntil);
  const curTide = () => (st.status === "finished" ? st.tides : st.tide);

  async function act(path, body) {
    if (busy) return;
    busy = true; errMsg = "";
    try { await api(`/matches/${code}/${path}`, { token, body: body || {} }); } catch (e) { errMsg = e.message; toast(e.message); }
    busy = false;
    render();
  }

  async function sendEmote(emote) {
    if (Date.now() < emoteWait) return;
    emoteWait = Date.now() + 1500;
    render();
    clearTimeout(emoteTimer);
    emoteTimer = setTimeout(() => { if (alive) render(); }, 1550);
    try { const r = await api(`/matches/${code}/emote`, { token, body: { emote } }); myEmotes.add(r.emote.id); if (alive) render(); } catch (e) { toast(e.status === 429 ? "Easy there: wait a moment before the next reaction." : e.message); }
  }

  function emotesView() {
    const list = (st.emotes || []).filter((e) => now() - e.at < 8000);
    const cool = Date.now() < emoteWait;
    const chips = list.map((e) => {
      const fresh = !seenEmotes.has(e.id);
      seenEmotes.add(e.id);
      const mine = (st.you && e.seat === st.you.seat) || myEmotes.has(e.id);
      return h("span", { class: "emote" + (fresh ? " pop" : "") + (mine ? " me" : "") }, h("span", { "aria-hidden": "true" }, EMOJI[e.emote] || "•"), " ", mine ? "You" : e.name, h("span", { class: "sr" }, ": " + (EMOTE_LABEL[e.emote] || e.emote)));
    });
    return h("section", { class: "card reactions", "aria-label": "Reactions" },
      h("div", { class: "row sb" },
        h("div", { class: "row emotebar", role: "group", "aria-label": "Send a reaction" }, (st.rules.emotes || Object.keys(EMOJI)).map((k) => h("button", { class: "emo", "data-k": "emo-" + k, title: EMOTE_LABEL[k] || k, "aria-label": "React: " + (EMOTE_LABEL[k] || k), disabled: cool, onclick: () => sendEmote(k) }, EMOJI[k] || k))),
        h("span", { class: "muted" }, st.watching ? `${st.watching} watching` : "")),
      h("div", { class: "emotes" }, chips.length ? chips : h("span", { class: "muted" }, st.you ? "Reactions from the table show up here." : "You are watching. Reactions are open to everyone.")));
  }

  let endAt = 0;
  async function loop() {
    while (alive) {
      try {
        const s = await api(`/matches/${code}?wait=${ver}` + (token ? "" : "&viewer=" + viewerId()), { token, signal: ac.signal });
        if (!alive) return;
        offset = s.serverTime ? s.serverTime - Date.now() : 0;
        ver = s.version;
        const first = !st;
        st = s;
        if (first && s.you && s.status !== "finished") autoHelp();
        recon = false;
        if (!s.you && token) { store.del("tg:t:" + code); token = null; }
        if (s.lastReveal && s.lastReveal.tide !== logTide || (s.status === "finished" && first)) {
          logTide = s.lastReveal ? s.lastReveal.tide : 0;
          api(`/matches/${code}/log`).then((l) => { logRounds = l.rounds.map(norm); render(); }).catch(() => {});
        }
        announceState();
        render();
        if (s.status === "expired") return;
        if (s.status === "finished") {
          endAt = endAt || Date.now();
          const others = s.players.filter((p) => p.kind === "human").length > 1;
          if (!s.you || s.rematch || !others || Date.now() - endAt > 600000) return;
        }
      } catch (e) {
        if (!alive) return;
        if (e.status === 404) { root.replaceChildren(h("section", { class: "card center" }, h("h2", {}, "No such match"), h("p", {}, `There is no match with code ${code}.`), h("a", { class: "btn primary", href: "/" }, "Back home"))); return; }
        if (!recon) { recon = true; render(); }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  function announceState() {
    const parts = [], live = ann.fresh;
    if (st.lastReveal && st.lastReveal.tide !== ann.rv) {
      ann.rv = st.lastReveal.tide;
      parts.push(roundLine(st.lastReveal, names()));
      if (live) revealSound(st.lastReveal);
    }
    ann.fresh = true;
    if (st.status === "playing" && st.tide !== ann.tide) { ann.tide = st.tide; parts.push(`Tide ${st.tide} of ${st.tides} started, ${st.settings.turnSeconds} seconds`); if (EV_NAME[st.event]) parts.push(st.rules.eventText[st.event]); }
    const m = st.you && st.you.move;
    const lk = m ? st.tide + ":" + (m.rest ? "r" : m.wreck + "/" + m.air) : "";
    if (lk !== ann.lock) { ann.lock = lk; if (m) parts.push(m.rest ? "Locked in: rest" : `Locked in: wreck ${m.wreck} with ${m.air} air`); }
    if (st.status === "finished" && !ann.end) {
      ann.end = true;
      const win = st.winners || [], me = st.you && st.players.find((p) => p.seat === st.you.seat);
      if (live && me && win.includes(me.seat)) setTimeout(() => sound.play("fanfare"), 900);
      if (me && win.includes(me.seat)) parts.push(`You ${win.length > 1 ? "shared the win" : "won"} with ${me.pearls} pearls`);
      else parts.push(win.length ? "Winner: " + win.map((s) => names()[s]).join(" and ") : "Match over, no winner");
    }
    if (parts.length) say(parts.join(". "));
  }

  function revealSound(rv) {
    const mine = st.you && st.you.seat;
    const ws = rv.wrecks || [];
    const dived = ws.filter((w) => w.divers.some((d) => d.seat === mine));
    sound.play("splash");
    if (ws.some((w) => w.winner === mine && mine != null)) setTimeout(() => sound.play("coin"), 450);
    else if (dived.some((w) => w.tie)) setTimeout(() => sound.play("thud"), 450);
  }

  function onKey(e) {
    if (!alive || !st || st.status !== "playing" || !st.you || !st.you.legal) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || (t.tagName === "A" && e.key === "Enter"))) return;
    const maxA = st.you.legal.maxAir || 0;
    if (/^[1-4]$/.test(e.key)) {
      const w = st.wrecks[+e.key - 1];
      if (w) { sel = w.id; render(); }
    } else if (e.key === "ArrowUp" || e.key === "+" || e.key === "=") {
      e.preventDefault(); airVal = Math.min(airVal + 1, Math.max(1, maxA)); render();
    } else if (e.key === "ArrowDown" || e.key === "-") {
      e.preventDefault(); airVal = Math.max(1, airVal - 1); render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sel == null) toast("Pick a wreck first");
      else if (maxA < 1) toast("No air to dive with");
      else act("move", { wreck: sel, air: airVal });
    } else if (e.key === "r" || e.key === "R") act("move", { rest: true });
  }

  function updateTimer() {
    if (st && st.emotes && st.emotes.some((e) => now() - e.at >= 8000)) { st.emotes = st.emotes.filter((e) => now() - e.at < 8000); render(); }
    const bar = root.querySelector(".timer");
    if (!bar || !st || st.status !== "playing") return;
    const t = now();
    const pausing = isPausing();
    if (pausing !== lastPause) { lastPause = pausing; render(); return; }
    const total = pausing ? Math.max(1, st.pauseUntil - (st.lastRevealAt || st.pauseUntil - 4000)) : st.settings.turnSeconds * 1000;
    const left = pausing ? st.pauseUntil - t : Math.max(0, st.deadline - t);
    bar.firstChild.style.width = Math.min(100, left / total * 100) + "%";
    bar.classList.toggle("low", !pausing && left <= 5000);
    const lab = root.querySelector("#tleft");
    const secs = Math.ceil(left / 1000);
    if (lab) lab.classList.toggle("low", !pausing && left <= 5000);
    if (!pausing && left > 0 && left <= 5000 && st.you && st.you.legal && !st.you.move) sound.tick(st.tide * 10 + secs);
    if (lab) lab.textContent = pausing ? "Resolving…" : `${secs} second${secs === 1 ? "" : "s"} left`;
  }

  function lobbyView() {
    const me = st.you;
    const url = location.origin + "/m/" + code;
    const linkIn = h("input", { class: "invite", readonly: true, value: url, "aria-label": "Invite link" });
    const flash = (msg) => { const el = root.querySelector("#copied"); if (!el) return; el.textContent = msg; clearTimeout(flash.t); flash.t = setTimeout(() => { el.textContent = ""; }, 2200); };
    const copy = async () => {
      try { await navigator.clipboard.writeText(url); flash("Copied"); }
      catch { linkIn.focus(); linkIn.select(); try { document.execCommand("copy") ? flash("Copied") : flash("Press Ctrl+C to copy"); } catch { flash("Press Ctrl+C to copy"); } }
    };
    const share = async () => { try { await navigator.share({ title: "Tidegrab", text: "Join my Tidegrab match " + code, url }); } catch { /* share dismissed */ } };
    const open = st.seats.some((s) => !s);
    const nameIn = h("input", { maxlength: 20, placeholder: "Your name", value: myName(), "aria-label": "Your name" });
    const join = async () => {
      try {
        store.set("tg:name", nameIn.value.trim());
        const r = await api(`/matches/${code}/join`, { body: { name: nameIn.value } });
        token = r.token; store.set("tg:t:" + code, token); ver = 0; st = null; render();
      } catch (e) { toast(e.message); }
    };
    return [
      h("section", { class: "card center" }, h("div", { class: "muted" }, "Match code"), h("div", { class: "codebox", role: "img", "aria-label": "Match code " + code.split("").join(" ") }, code.split("").map((c) => h("span", { "aria-hidden": "true" }, c))),
        h("div", { class: "invite-row" }, linkIn),
        h("div", { class: "row", style: "justify-content:center;margin-top:10px" }, h("button", { class: "primary", "data-k": "copyinvite", onclick: copy }, "Copy invite link"), navigator.share ? h("button", { "data-k": "share", onclick: share }, "Share") : null),
        h("div", { id: "copied", class: "copied", role: "status", "aria-live": "polite" })),
      h("section", { class: "card" }, h("h2", {}, `Seats (${st.seats.filter(Boolean).length}/${st.settings.seats})`),
        h("ul", { class: "list" }, st.seats.map((s, i) => h("li", {}, s ? h("span", {}, s.name, " ", me && me.seat === i ? h("span", { class: "pill you" }, "you") : null, s.kind === "bot" ? h("span", { class: "pill bot" }, "bot") : null, i === st.host ? h("span", { class: "pill" }, "host") : null) : h("span", { class: "muted" }, "Waiting for a diver..."), h("span", { class: "sub" }, "Seat " + (i + 1))))),
        me && me.isHost ? h("div", { class: "row", style: "margin-top:12px" }, h("button", { disabled: !open, onclick: () => act("bots", { count: 1 }) }, "Add bot"), h("button", { class: "primary", onclick: () => act("start") }, open ? "Start (bots fill empty seats)" : "Start")) : null,
        me && !me.isHost ? h("p", { class: "muted" }, "Waiting for the host to start...") : null,
        !me && open ? h("div", { style: "margin-top:12px" }, h("label", {}, "Your name"), nameIn, h("div", { style: "margin-top:10px" }, h("button", { class: "primary", onclick: join }, "Take a seat"))) : null,
        !me && !open ? h("p", { class: "muted" }, "Table is full. You are watching.") : null,
        h("div", { class: "err", role: "alert" }, errMsg)),
    ];
  }

  function actionView() {
    const you = st.you;
    if (!you || !you.legal) return h("p", { class: "muted center" }, you ? "" : "You are spectating this match.");
    if (selTide !== st.tide) { selTide = st.tide; sel = you.move && !you.move.rest ? you.move.wreck : null; airVal = you.move && !you.move.rest ? you.move.air : Math.min(2, you.legal.maxAir || 1); }
    const maxA = you.legal.maxAir || 0;
    airVal = Math.max(1, Math.min(airVal, Math.max(1, maxA)));
    const m = you.move;
    return h("section", { class: "card" }, h("h2", {}, "Your move"),
      h("div", { class: "act" },
        h("div", { class: "stepper", role: "group", "aria-label": "Air to spend" }, h("button", { "data-k": "less", "aria-label": "Less air", disabled: airVal <= 1, onclick: () => { airVal--; render(); } }, "−"), h("output", { "aria-live": "polite" }, airVal), h("button", { "data-k": "more", "aria-label": "More air", disabled: airVal >= maxA, onclick: () => { airVal++; render(); } }, "+"), h("span", { class: "sub" }, `of ${you.legal.maxAir || 0} air`)),
        h("button", { "data-k": "dive", class: "gold", disabled: sel == null || maxA < 1 || busy, onclick: () => act("move", { wreck: sel, air: airVal }) }, sel == null ? "Pick a wreck" : `Dive #${sel} with ${airVal} air`),
        h("button", { "data-k": "rest", onclick: () => act("move", { rest: true }) }, `Rest (+${st.event === "current" ? st.rules.currentRest : st.rules.restGain} air)`)),
      h("p", { class: "keys sub" }, "Keys: 1-4 wreck · ↑↓ air · Enter dive · R rest"),
      h("p", { class: m ? "locked" : "sub" }, m ? (m.rest ? "Locked in: rest. You can still change your mind." : `Locked in: ${m.air} air at wreck #${m.wreck}. You can still change it.`) : "Choose a wreck, set your Air, then dive. Moves stay secret until the tide resolves."),
      h("div", { class: "err", role: "alert" }, errMsg));
  }

  function eventsLine() {
    const now = EV_NAME[st.event], next = EV_NAME[st.nextEvent];
    if (!now && !next) return null;
    const txt = (e) => st.rules.eventText[e].replace(/^[^:]*:\s*/, "");
    return h("div", { class: "events" },
      now ? h("p", {}, h("span", { class: "event" }, now), " ", txt(st.event).replace(/^./, (c) => c.toUpperCase())) : null,
      next ? h("p", { class: "muted" }, "Next tide: ", h("b", {}, next), ", " + txt(st.nextEvent)) : null);
  }

  function gameView() {
    const finished = st.status === "finished";
    const out = [];
    out.push(h("section", { class: "card" }, h("div", { class: "hud" }, h("div", {}, finished ? h("b", {}, "Match over") : h("b", {}, `Tide ${curTide()} / ${st.tides}`), " ", !finished && st.tide === st.tides ? h("span", { class: "final" }, "Final tide: pearls count double") : null, " ", h("span", { class: "muted" }, "Code " + code)), h("div", { class: "row", style: "gap:8px" }, finished ? null : h("div", { id: "tleft", class: "muted" }, ""), helpBtn())), finished ? null : eventsLine(), finished ? null : h("div", { class: "timer", role: "presentation" }, h("i"))));
    if (finished) {
      const wn = (st.winners || []).map((s) => st.players[s].name), hl = logRounds.length ? highlight(logRounds, st.players) : null;
      out.push(h("section", { class: "card center" }, h("h1", {}, wn.length ? (wn.length > 1 ? "Shared victory: " : "Winner: ") + wn.join(" & ") : "No winner"), hl ? h("p", { class: "hlline" }, hl) : null, standings(st, logRounds),
        h("div", { class: "row", style: "justify-content:center;margin-top:14px" },
          st.you ? h("button", { class: "primary", onclick: playAgain }, !st.rematch ? "Rematch" : tokenFor(st.rematch) ? "Back to rematch" : "Join rematch") : null, h("a", { class: "btn", href: "/replay/" + code }, "Watch replay"), h("button", { class: "btn", "data-k": "copy", onclick: copyLink }, copied ? "Copied!" : "Copy replay link"), h("a", { class: "btn", href: "/" }, "Home")),
        st.you && st.rematch && !tokenFor(st.rematch) ? h("p", { class: "muted", role: "status" }, "Your table wants a rematch, same seats and settings.") : null,
        showLink ? h("input", { class: "rlink", readonly: true, value: replayUrl(), "aria-label": "Replay link", onfocus: (e) => e.target.select() }) : null));
    }
    const pausing = !finished && isPausing();
    let rev = null;
    if (st.lastReveal) { const fr = animR !== st.lastReveal.tide; if (fr && animR !== -1) newReveal = true; animR = st.lastReveal.tide; rev = h("section", { class: fr ? "card rv fresh" : "card rv" }, revealPanel(st.lastReveal, names())); }
    out.push(playersPanel(st.players, { me: st.you && st.you.seat, winners: finished ? st.winners : [], hideStatus: finished, pausing }));
    if (rev && (pausing || finished)) out.push(rev);
    if (!finished) {
      const mv = st.you && st.you.move;
      const fw = animW !== st.status + curTide(); animW = st.status + curTide();
      out.push(h("section", { class: "card" }, h("h2", {}, "Wrecks", mv && mv.rest ? h("span", { class: "mine rest" }, "your move: resting") : null), h("div", { class: fw ? "wrecks fresh" : "wrecks" }, st.wrecks.map((w) => {
        const can = st.you && st.you.legal;
        const label = [`Wreck ${w.id}`, `${w.pearls} ${w.pearls === 1 ? "pearl" : "pearls"}`, w.air ? `air pocket +${w.air}` : null, w.age ? "grew " + (w.age === 1 ? "once" : w.age === 2 ? "twice" : w.age + " times") : null].filter(Boolean).join(", ");
        return h("button", { class: "wreck", "data-k": "w" + w.id, "aria-label": label, "aria-pressed": sel === w.id ? "true" : "false", disabled: !can, onclick: () => { sel = sel === w.id ? null : w.id; render(); } },
          h("div", { class: "pv" }, icon(PEARL), w.pearls, h("span", { class: "sub" }, w.pearls === 1 ? "pearl" : "pearls")), h("div", { class: "sub" }, `Wreck #${w.id}`),
          w.air ? h("span", { class: "badge air" }, icon(POCKET), ` air pocket +${w.air}`) : null,
          w.age ? h("span", { class: "badge grew" }, `grew ${w.age}×`) : null,
          mv && !mv.rest && mv.wreck === w.id ? h("span", { class: "mine" }, `your bid: ${mv.air} air`) : null);
      }))));
      out.push(actionView());
    }
    if (rev && !pausing && !finished) out.push(rev);
    out.push(emotesView());
    if (logRounds.length) out.push(h("section", { class: "card" }, h("h2", {}, "Match log"), h("ol", { class: "log", reversed: true }, [...logRounds].reverse().map((r) => h("li", {}, roundLine(r, names()))))));
    return out;
  }

  const replayUrl = () => location.origin + "/replay/" + code;
  let copied = false, showLink = false, copyT = 0;
  async function copyLink() {
    try { await navigator.clipboard.writeText(replayUrl()); copied = true; showLink = false; clearTimeout(copyT); copyT = setTimeout(() => { copied = false; render(); }, 2000); say("Replay link copied"); }
    catch { showLink = true; }
    render();
    if (showLink) { const i = root.querySelector(".rlink"); if (i) { i.focus(); i.select(); } }
  }

  async function playAgain() {
    try {
      const r = await api(`/matches/${code}/rematch`, { body: {}, token });
      store.set("tg:t:" + r.code, r.token);
      go("/m/" + r.code);
    } catch {
      try {
        const bots = st.players.filter((p) => p.kind === "bot").length;
        await createMatch({ name: st.you.name || myName(), seats: st.settings.seats, bots, turnSeconds: st.settings.turnSeconds, botLevel: st.settings.botLevel });
      } catch (e) { toast(e.message); }
    }
  }

  function render() {
    if (!alive) return;
    const note = () => h("p", { class: "recon sub center" }, "Reconnecting…");
    if (!st) { if (recon) root.replaceChildren(note()); return; }
    const ae = document.activeElement;
    const fk = ae && root.contains(ae) ? ae.dataset.k : null;
    lastPause = isPausing();
    root.replaceChildren(...(recon ? [note()] : []), ...(st.status === "lobby" ? lobbyView() : gameView()));
    if (fk) {
      const find = (k) => [...root.querySelectorAll("[data-k]")].find((e) => e.dataset.k === k);
      let el = find(fk);
      if (el && el.disabled && (fk === "less" || fk === "more")) el = find(fk === "less" ? "more" : "less");
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
    if (newReveal) {
      newReveal = false;
      const c = root.querySelector(".rv");
      if (c) c.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    updateTimer();
  }
  loop();
}

async function replay(code) {
  let log;
  try { log = await api(`/matches/${code}/log`); } catch (e) {
    return mount(() => app.append(h("section", { class: "card center" }, h("h2", {}, "Replay unavailable"), h("p", {}, e.message), h("a", { class: "btn", href: "/" }, "Home"))));
  }
  let i = 0, timer = null, shown = -1, bids = false, built = false;
  const last = log.rounds.length - 1;
  const root = h("div", {});
  const names = Object.fromEntries(log.names.map((n, s) => [s, n]));
  const stop = () => { clearInterval(timer); timer = null; };
  const go = (n) => { i = Math.max(0, Math.min(last, n)); draw(); };
  const toggle = () => {
    if (timer) { stop(); draw(); return; }
    if (i >= last) i = 0;
    timer = setInterval(() => { if (i < last) { i++; draw(); } else { stop(); draw(); } }, 3500);
    draw();
  };
  const slider = h("input", { type: "range", min: 1, max: Math.max(1, log.rounds.length), step: 1, value: 1, "aria-label": "Tide", oninput: () => { stop(); go(+slider.value - 1); } });
  const title = h("b", {});
  const prev = h("button", { onclick: () => { stop(); go(i - 1); } }, "◀ Prev");
  const play = h("button", { class: "primary", onclick: toggle });
  const next = h("button", { onclick: () => { stop(); go(i + 1); } }, "Next ▶");
  const check = h("input", { type: "checkbox", onchange: () => { bids = check.checked; shown = -1; draw(); } });
  const body = h("div", {});
  const controls = h("section", { class: "card" },
    h("div", { class: "hud" }, title, h("div", { class: "row" }, prev, play, next)),
    h("div", { class: "scrub" }, slider),
    h("label", { class: "bidcheck" }, check, "Show bids"));
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t === slider || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== "checkbox" || t.isContentEditable)) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); stop(); go(i - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); stop(); go(i + 1); }
  };
  function draw() {
    const r = log.rounds[i] && norm(log.rounds[i]);
    if (!r) { root.replaceChildren(h("section", { class: "card center" }, h("p", {}, "This match has no completed tides yet."), h("a", { class: "btn", href: "/m/" + code }, "Back to match"))); return; }
    const before = r.before || { players: [], wrecks: [] };
    const players = log.names.map((n, s) => {
      const b = before.players.find((p) => p.seat === s) || {};
      const after = r.standings.find((p) => p.seat === s) || {};
      return { seat: s, name: n, kind: log.kinds[s], air: after.air ?? b.air ?? 0, pearls: after.pearls ?? 0 };
    });
    title.textContent = `Replay ${code} · tide ${r.tide} / ${log.rounds.length}`;
    slider.value = i + 1;
    slider.setAttribute("aria-valuetext", `Tide ${r.tide} of ${log.rounds.length}`);
    prev.disabled = i === 0;
    next.disabled = i >= last;
    play.textContent = timer ? "Pause" : "Autoplay";
    check.checked = bids;
    if (!built) {
      built = true;
      root.replaceChildren(controls, body, h("p", { class: "center" }, h("a", { class: "btn", href: "/m/" + code }, "Back to match"), " ", h("a", { class: "btn", href: "/" }, "Home")));
    }
    body.replaceChildren(
      playersPanel(players, { hideStatus: true, winners: i === last ? log.winners || [] : [] }),
      h("section", { class: shown !== i ? "card fresh" : "card" }, revealPanel(r, names, "Dives and results", { hideBids: !bids })));
    shown = i;
  }
  mount(() => app.append(root));
  document.addEventListener("keydown", onKey);
  cleanup = () => { stop(); document.removeEventListener("keydown", onKey); };
  draw();
}

sound.init();
bubbles();
const path = location.pathname;
let mt;
if ((mt = /^\/m\/([A-Za-z0-9]+)\/?$/.exec(path))) match(mt[1].toUpperCase());
else if ((mt = /^\/replay\/([A-Za-z0-9]+)\/?$/.exec(path))) replay(mt[1].toUpperCase());
else home();
