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

function home() {
  const nameIn = h("input", { id: "nm", maxlength: 20, placeholder: "Your name", value: myName(), autocomplete: "nickname", "aria-label": "Your name" });
  const err = h("div", { class: "err", role: "alert" });
  const run = (fn) => async () => {
    try { err.textContent = ""; await fn(); } catch (e) { err.textContent = e.message; }
  };
  const seats = h("select", { id: "seats", "aria-label": "Seats" }, [2, 3, 4].map((n) => h("option", { value: n }, n + " players")));
  const bots = h("select", { id: "bots", "aria-label": "Bots now" }, [0, 1, 2, 3].map((n) => h("option", { value: n }, n === 0 ? "No bots yet" : n + (n === 1 ? " bot" : " bots"))));
  const secs = h("select", { id: "secs", "aria-label": "Seconds per tide" }, [20, 45, 90].map((n) => h("option", { value: n, selected: n === 45 }, n + " s per tide")));
  const lvl = h("select", { id: "lvl", "aria-label": "Bot level" }, [["normal", "Normal bots"], ["easy", "Easy bots"]].map(([v, t]) => h("option", { value: v }, t)));
  const codeIn = h("input", { class: "code", maxlength: 5, placeholder: "CODE", "aria-label": "Match code", autocomplete: "off" });
  const lobbies = h("ul", { class: "list" }, h("li", { class: "muted" }, "Looking for open tables..."));
  const live = h("ul", { class: "list" });

  const create = run(() => createMatch({ name: nameIn.value, seats: +seats.value, bots: Math.min(+bots.value, +seats.value - 1), turnSeconds: +secs.value, botLevel: lvl.value }));
  const join = run(async () => {
    const code = codeIn.value.trim().toUpperCase();
    if (code.length < 4) throw new Error("Enter the match code");
    store.set("tg:name", nameIn.value.trim());
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
      h("p", { class: "muted center" }, "Agents welcome: ", h("a", { href: "/docs" }, "HTTP/JSON API docs")));
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

function revealPanel(rv, names, title) {
  const last = rv.last ?? rv.payout > 1;
  const nm = (s) => names[s] || "Seat " + (s + 1);
  const rests = rv.moves.filter((m) => m.rest).map((m) => nm(m.seat) + (m.auto ? " (timed out)" : ""));
  return h("div", {},
    h("h2", {}, title || `Tide ${rv.tide} reveal`),
    h("div", { class: "reveal" }, rv.wrecks.map((w, i) => {
      const verdict = w.winner != null ? `${nm(w.winner)} takes ${w.gain ?? w.pearls} pearl${(w.gain ?? w.pearls) === 1 ? "" : "s"}${(w.gain ?? w.pearls) > w.pearls ? " (doubled)" : ""}${w.air ? " and +" + w.air + " air" : ""}` : w.tie ? (last ? "Silt-out! Tie, nobody takes it" : "Silt-out! Tie, it grows") : last ? "Nobody dived" : "Nobody dived, it grows";
      return h("div", { class: "rw" + (w.winner != null ? " won" : "") + (w.tie ? " silt" : ""), style: `animation-delay:${i * 0.25}s` },
        h("div", { class: "row sb" }, h("b", {}, `Wreck #${w.id}`), h("span", { class: "pearls" }, icon(PEARL), w.pearls)),
        w.divers.length ? w.divers.map((d, j) => h("div", { class: "dv" + (w.winner === d.seat && j === 0 ? " top" : "") }, h("span", {}, nm(d.seat)), h("span", {}, d.air + " air"))) : null,
        h("div", { class: "verdict" }, verdict),
        why(w) ? h("div", { class: "why" }, why(w)) : null);
    })),
    rests.length ? h("div", { class: "rests" }, "Rested: " + rests.join(", ")) : null);
}

const norm = (r) => ({ ...r, wrecks: r.results || r.wrecks });

function roundLine(r, names) {
  const nm = (s) => names[s] || "Seat " + (s + 1);
  const parts = r.wrecks.filter((w) => w.divers.length).map((w) => w.winner != null ? `${nm(w.winner)} took #${w.id} (${w.gain ?? w.pearls})` : `#${w.id} silted out`);
  const rested = r.moves.filter((m) => m.rest).length;
  if (rested) parts.push(rested + " rested");
  return `Tide ${r.tide}: ` + (parts.join(" · ") || "quiet tide");
}

function standings(st) {
  const order = [...st.players].sort((a, b) => b.pearls - a.pearls || b.air - a.air);
  return h("table", { class: "stand" }, h("caption", { class: "sr" }, "Final standings"),
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Diver"), h("th", { scope: "col" }, "Pearls"), h("th", { scope: "col" }, "Air left"))),
    h("tbody", {}, order.map((p) => h("tr", { class: (st.winners || []).includes(p.seat) ? "w" : "" }, h("th", { scope: "row" }, p.name + ((st.winners || []).includes(p.seat) ? " 🏆" : "")), h("td", {}, p.pearls), h("td", {}, p.air)))));
}

function match(code) {
  const ac = new AbortController();
  let st = null, alive = true, ver = 0, offset = 0, token = tokenFor(code), logRounds = [], logTide = 0;
  let sel = null, airVal = 2, selTide = 0, busy = false, errMsg = "", animW = "", animR = -1;
  let recon = false, newReveal = false, lastPause = false;
  const ann = { tide: 0, lock: "", rv: 0, end: false };
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

  async function loop() {
    while (alive) {
      try {
        const s = await api(`/matches/${code}?wait=${ver}`, { token, signal: ac.signal });
        if (!alive) return;
        offset = s.serverTime ? s.serverTime - Date.now() : 0;
        ver = s.version;
        const first = !st;
        st = s;
        recon = false;
        if (!s.you && token) { store.del("tg:t:" + code); token = null; }
        if (s.lastReveal && s.lastReveal.tide !== logTide || (s.status === "finished" && first)) {
          logTide = s.lastReveal ? s.lastReveal.tide : 0;
          api(`/matches/${code}/log`).then((l) => { logRounds = l.rounds.map(norm); render(); }).catch(() => {});
        }
        announceState();
        render();
        if (s.status === "finished" || s.status === "expired") return;
      } catch (e) {
        if (!alive) return;
        if (e.status === 404) { root.replaceChildren(h("section", { class: "card center" }, h("h2", {}, "No such match"), h("p", {}, `There is no match with code ${code}.`), h("a", { class: "btn primary", href: "/" }, "Back home"))); return; }
        if (!recon) { recon = true; render(); }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  function announceState() {
    const parts = [];
    if (st.lastReveal && st.lastReveal.tide !== ann.rv) { ann.rv = st.lastReveal.tide; parts.push(roundLine(st.lastReveal, names())); }
    if (st.status === "playing" && st.tide !== ann.tide) { ann.tide = st.tide; parts.push(`Tide ${st.tide} of ${st.tides} started, ${st.settings.turnSeconds} seconds`); }
    const m = st.you && st.you.move;
    const lk = m ? st.tide + ":" + (m.rest ? "r" : m.wreck + "/" + m.air) : "";
    if (lk !== ann.lock) { ann.lock = lk; if (m) parts.push(m.rest ? "Locked in: rest" : `Locked in: wreck ${m.wreck} with ${m.air} air`); }
    if (st.status === "finished" && !ann.end) {
      ann.end = true;
      const win = st.winners || [], me = st.you && st.players.find((p) => p.seat === st.you.seat);
      if (me && win.includes(me.seat)) parts.push(`You ${win.length > 1 ? "shared the win" : "won"} with ${me.pearls} pearls`);
      else parts.push(win.length ? "Winner: " + win.map((s) => names()[s]).join(" and ") : "Match over, no winner");
    }
    if (parts.length) say(parts.join(". "));
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
    if (lab) lab.textContent = pausing ? "Resolving…" : `${secs} second${secs === 1 ? "" : "s"} left`;
  }

  function lobbyView() {
    const me = st.you;
    const url = location.origin + "/m/" + code;
    const copy = async () => { try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { toast(url); } };
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
      h("section", { class: "card center" }, h("div", { class: "muted" }, "Match code"), h("div", { class: "codebox", "aria-label": "Match code " + code.split("").join(" ") }, code),
        h("div", { class: "row", style: "justify-content:center;margin-top:10px" }, h("button", { onclick: copy }, "Copy invite link"))),
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
        h("button", { "data-k": "rest", onclick: () => act("move", { rest: true }) }, `Rest (+${st.rules.restGain} air)`)),
      h("p", { class: "keys sub" }, "Keys: 1-4 wreck · ↑↓ air · Enter dive · R rest"),
      h("p", { class: m ? "locked" : "sub" }, m ? (m.rest ? "Locked in: rest. You can still change your mind." : `Locked in: ${m.air} air at wreck #${m.wreck}. You can still change it.`) : "Choose a wreck, set your Air, then dive. Moves stay secret until the tide resolves."),
      h("div", { class: "err", role: "alert" }, errMsg));
  }

  function gameView() {
    const finished = st.status === "finished";
    const out = [];
    out.push(h("section", { class: "card" }, h("div", { class: "hud" }, h("div", {}, finished ? h("b", {}, "Match over") : h("b", {}, `Tide ${curTide()} / ${st.tides}`), " ", !finished && st.tide === st.tides ? h("span", { class: "final" }, "Final tide: pearls count double") : null, " ", h("span", { class: "muted" }, "Code " + code)), finished ? null : h("div", { id: "tleft", class: "muted" }, "")), finished ? null : h("div", { class: "timer", role: "presentation" }, h("i"))));
    if (finished) {
      const wn = (st.winners || []).map((s) => st.players[s].name);
      out.push(h("section", { class: "card center" }, h("h1", {}, wn.length ? (wn.length > 1 ? "Shared victory: " : "Winner: ") + wn.join(" & ") : "No winner"), standings(st),
        h("div", { class: "row", style: "justify-content:center;margin-top:14px" },
          st.you ? h("button", { class: "primary", onclick: playAgain }, "Play again") : null, h("a", { class: "btn", href: "/replay/" + code }, "Watch replay"), h("a", { class: "btn", href: "/" }, "Home"))));
    }
    const pausing = !finished && isPausing();
    let rev = null;
    if (st.lastReveal) { const fr = animR !== st.lastReveal.tide; if (fr && animR !== -1) newReveal = true; animR = st.lastReveal.tide; rev = h("section", { class: fr ? "card rv fresh" : "card rv" }, revealPanel(st.lastReveal, names())); }
    out.push(playersPanel(st.players, { me: st.you && st.you.seat, winners: finished ? st.winners : [], hideStatus: finished, pausing }));
    if (rev && (pausing || finished)) out.push(rev);
    if (!finished) {
      const fw = animW !== st.status + curTide(); animW = st.status + curTide();
      out.push(h("section", { class: "card" }, h("h2", {}, "Wrecks"), h("div", { class: fw ? "wrecks fresh" : "wrecks" }, st.wrecks.map((w) => {
        const can = st.you && st.you.legal;
        const label = [`Wreck ${w.id}`, `${w.pearls} ${w.pearls === 1 ? "pearl" : "pearls"}`, w.air ? `air pocket +${w.air}` : null, w.age ? "grew " + (w.age === 1 ? "once" : w.age === 2 ? "twice" : w.age + " times") : null].filter(Boolean).join(", ");
        return h("button", { class: "wreck", "data-k": "w" + w.id, "aria-label": label, "aria-pressed": sel === w.id ? "true" : "false", disabled: !can, onclick: () => { sel = sel === w.id ? null : w.id; render(); } },
          h("div", { class: "pv" }, icon(PEARL), w.pearls, h("span", { class: "sub" }, w.pearls === 1 ? "pearl" : "pearls")), h("div", { class: "sub" }, `Wreck #${w.id}`),
          w.air ? h("span", { class: "badge air" }, icon(POCKET), ` air pocket +${w.air}`) : null,
          w.age ? h("span", { class: "badge grew" }, `grew ${w.age}×`) : null);
      }))));
      out.push(actionView());
    }
    if (rev && !pausing && !finished) out.push(rev);
    if (logRounds.length) out.push(h("section", { class: "card" }, h("h2", {}, "Match log"), h("ol", { class: "log", reversed: true }, [...logRounds].reverse().map((r) => h("li", {}, roundLine(r, names()))))));
    return out;
  }

  async function playAgain() {
    try {
      const bots = st.players.filter((p) => p.kind === "bot").length;
      await createMatch({ name: st.you.name || myName(), seats: st.settings.seats, bots, turnSeconds: st.settings.turnSeconds, botLevel: st.settings.botLevel });
    } catch (e) { toast(e.message); }
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
  let i = 0, timer = null, shown = -1;
  const root = h("div", {});
  const names = Object.fromEntries(log.names.map((n, s) => [s, n]));
  const stop = () => { clearInterval(timer); timer = null; };
  function render() {
    const r = log.rounds[i] && norm(log.rounds[i]);
    if (!r) { root.replaceChildren(h("section", { class: "card center" }, h("p", {}, "This match has no completed tides yet."), h("a", { class: "btn", href: "/m/" + code }, "Back to match"))); return; }
    const before = r.before || { players: [], wrecks: [] };
    const players = log.names.map((n, s) => {
      const b = before.players.find((p) => p.seat === s) || {};
      const after = r.standings.find((p) => p.seat === s) || {};
      return { seat: s, name: n, kind: log.kinds[s], air: after.air ?? b.air ?? 0, pearls: after.pearls ?? 0 };
    });
    root.replaceChildren(
      h("section", { class: "card" }, h("div", { class: "hud" }, h("b", {}, `Replay ${code} · tide ${r.tide} / ${log.rounds.length}`), h("div", { class: "row" },
        h("button", { disabled: i === 0, onclick: () => { stop(); i--; render(); } }, "◀ Prev"),
        h("button", { class: "primary", onclick: () => { if (timer) { stop(); render(); } else { if (i >= log.rounds.length - 1) i = 0; timer = setInterval(() => { if (i < log.rounds.length - 1) { i++; render(); } else { stop(); render(); } }, 3500); render(); } } }, timer ? "Pause" : "Autoplay"),
        h("button", { disabled: i >= log.rounds.length - 1, onclick: () => { stop(); i++; render(); } }, "Next ▶")))),
      playersPanel(players, { hideStatus: true, winners: i === log.rounds.length - 1 ? log.winners || [] : [] }),
      h("section", { class: shown !== i ? "card fresh" : "card" }, revealPanel(r, names, "Dives and results")),
      h("p", { class: "center" }, h("a", { class: "btn", href: "/m/" + code }, "Back to match"), " ", h("a", { class: "btn", href: "/" }, "Home")));
    shown = i;
  }
  mount(() => app.append(root));
  cleanup = stop;
  render();
}

bubbles();
const path = location.pathname;
let mt;
if ((mt = /^\/m\/([A-Za-z0-9]+)\/?$/.exec(path))) match(mt[1].toUpperCase());
else if ((mt = /^\/replay\/([A-Za-z0-9]+)\/?$/.exec(path))) replay(mt[1].toUpperCase());
else home();
