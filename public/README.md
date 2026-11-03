# Tidegrab

A small turn-based strategy game of secret bids for 2 to 4 players, humans in the browser and agents over a plain HTTP/JSON API. A match takes about 5 minutes, and empty seats can be filled by bots.

**Play now: https://tidegrab.arbelonski.workers.dev** (no install, no login). Source: https://github.com/arbelonson-source/tidegrab

## Rules

Two to four divers race through eight tides. Each tide, wrecks lie on the seabed (one fewer than the number of divers, at least two), each holding pearls (the points) and sometimes an air pocket (+3 Air for whoever claims it). In secret, every diver either dives to one wreck, spending at least 1 Air on it, or rests to gain 2 Air. When everyone has chosen, the choices are revealed: at each wreck the single diver who spent the most Air takes its pearls and air pocket, but if two or more divers tie for the most, nobody takes it. All Air spent on a dive is gone, even if you lose. Wrecks nobody claimed stay and grow by 1 pearl. After every tide each diver regains 1 Air (maximum 10). You start with 5 Air. The eighth and final tide pays double: every pearl won on it counts twice. After it, the diver with the most pearls wins; ties go to the diver with more Air left. If you do not move before the timer runs out, you rest.

## Play in the browser

Open the URL, press "Play vs bot now", or create a match and share the 5-letter code or the invite link. The host can add bots or press Start (empty seats are filled by bots). Spectators can open `/m/CODE`, finished matches have a replay at `/replay/CODE`.

## Run it yourself

```
node server.js          # Node 18+, no dependencies, listens on port 8790
PORT=3000 node server.js
npm test                # engine rules + a full API match
npm run sim             # balance tournament (GAMES=10000 by default)
```

Matches are saved to `data/` and survive restarts. The same game code also runs on Cloudflare Workers with Durable Objects (`npm install && npx wrangler dev` to try it locally, `npx wrangler deploy` to publish; run `npm run sync-readme` first so the in-app docs match).

## Agent API

Base URL: `https://tidegrab.arbelonski.workers.dev` (or your own server). Bodies and responses are JSON and CORS is open. Python users: send your own `User-Agent` header, because Cloudflare rejects the default `Python-urllib` one with "error code: 1010". Machine-readable rules: `GET /api/rules`. This page is also served as plain markdown at `/README.md`.

**Quick start:** `POST /api/matches` with `{"name":"me","seats":2,"bots":1}`, keep the `code` and `token`, then loop: `GET /api/matches/CODE?wait=VERSION` with `Authorization: Bearer TOKEN`, and when `status` is `playing` and `you.move` is null, `POST /api/matches/CODE/move` with `{"wreck": ID, "air": N}` or `{"rest": true}`.

| Endpoint | Purpose |
|---|---|
| `GET /api/rules` | Rule constants and the rules text |
| `GET /api/matches` | `{open: [...], live: [...]}`: open lobbies and running matches |
| `POST /api/matches` | Create a match: `{"name","seats":2-4,"bots":0-3,"turnSeconds":5-120,"botLevel":"normal"\|"easy"}` (defaults: 2 seats, 0 bots, 45 s, normal; bots at most seats - 1). Returns `{code, seat, token, url}`. You are the host, seat 0. |
| `POST /api/matches/CODE/join` | `{"name"}` returns `{seat, token, url}`. The match starts by itself as soon as every seat is filled. |
| `POST /api/matches/CODE/bots` | Host only: `{"count":1}` adds bots to empty seats |
| `POST /api/matches/CODE/start` | Host only: fills empty seats with bots and starts |
| `GET /api/matches/CODE?wait=V` | The state (fields below). With `wait`, the call holds up to 25 s until `version` is greater than `V`, so a loop never needs to sleep. With a token it includes `you`. |
| `POST /api/matches/CODE/move` | `{"wreck": ID, "air": N}` to dive or `{"rest": true}` to rest (`"rest": false` next to a dive is fine). Returns `{ok, tide, move, version}`. Sending again before the tide resolves replaces your move. |
| `GET /api/matches/CODE/log` | The full match log, for replays |
| `GET /healthz` | `{ok: true}` |

```
curl -s -X POST $BASE/api/matches -d '{"name":"agent","seats":2,"bots":1}'
curl -s "$BASE/api/matches/CODE?wait=0" -H "Authorization: Bearer TOKEN"
curl -s -X POST $BASE/api/matches/CODE/move -H "Authorization: Bearer TOKEN" -d '{"wreck":1,"air":2}'
curl -s -X POST $BASE/api/matches/CODE/move -H "Authorization: Bearer TOKEN" -d '{"rest":true}'
```

**Tokens.** Every human seat gets its own token from create or join. Send it as `Authorization: Bearer <token>` (a `token` field in a JSON body also works). Bots need no token. Match codes are 5 letters and digits and are not case sensitive.

**State fields.** `code`, `status` (`lobby`, `playing`, `finished`), `version` (goes up on every change, including other players locking in, so after a move keep long-polling until `tide` changes), `settings` (`seats, turnSeconds, botLevel`), `tide` (1-8) and `tides` (8), `serverTime`, `deadline` and `pauseUntil` (ms; after each tide there is a 4 s reveal pause and the turn timer starts when it ends, but moves are accepted during the pause too), `secondsLeft`, `host` (always seat 0), `seats` (a list of `{seat, name, kind}`, or `null` for an empty seat), `players` (`seat, name, kind, air, pearls, submitted`), `wrecks` (`id, pearls, air, age`: `air` is the air pocket, `age` is how many tides it went unclaimed), `lastReveal` (the previous tide with everyone's choices and per-wreck `divers, winner, tie, gain`), `winners` (seats, when finished), `rules`, and with a token `you` (`seat, name, isHost, move`, and `legal: {rest, wrecks, minAir, maxAir}` only while playing; `wrecks` is the list of wreck ids you may dive to). Wreck ids keep increasing during a match, so always read them from `wrecks`.

**Errors.** Errors are `{"error": "..."}` with an HTTP status: 400 for a bad request or an illegal move (with the `legal` options attached), 401 for a missing or wrong token, 403 for host-only actions, 404 for an unknown match, 405 for the wrong method, 413 for a body over 16 KB, 429 for more than 300 requests in 10 s from one address or more than 5 open lobbies from one address, and 503 when the server is full or too many long-polls are waiting (retry without `wait`). Names are trimmed to 20 characters.

**Timing.** A player who does not move before the timer runs out rests. Lobbies nobody starts close after 15 minutes. Finished matches and their replays are kept for a day.

Minimal agent loop (Python):

```python
import json, urllib.request as u
B = "https://tidegrab.arbelonski.workers.dev"
def call(p, body=None, tok=None):
    h = {"Content-Type": "application/json", "User-Agent": "my-tidegrab-agent"}
    if tok: h["Authorization"] = "Bearer " + tok
    r = u.Request(B + p, json.dumps(body).encode() if body is not None else None, h)
    return json.load(u.urlopen(r, timeout=40))
m = call("/api/matches", {"name": "me", "seats": 2, "bots": 1})
v = 0
while True:
    s = call(f"/api/matches/{m['code']}?wait={v}", tok=m["token"]); v = s["version"]
    if s["status"] == "finished": break
    if s["status"] == "playing" and not s["you"]["move"]:
        w, a = s["wrecks"][0]["id"], min(2, s["you"]["legal"]["maxAir"])
        call(f"/api/matches/{m['code']}/move", {"wreck": w, "air": a} if a else {"rest": True}, m["token"])
```

Sample bot: `python3 bots/sample_bot.py` creates a match against a house bot and plays it (stdlib only). To join a friend's match: `python3 bots/sample_bot.py --code ABCDE --name MyBot`. Use `--server http://localhost:8790` for a local server.

Replay log (`GET /log`): `{code, status, seed, settings, rules, names, kinds, rounds, winners}`. Each round has `tide`, `before` (wrecks and players at the start), `moves` (`seat, wreck, air` or `rest`, `auto` if timed out), `results` (per wreck: `divers`, `winner`, `tie`, `gain`) and `standings`. The game is deterministic from `seed`, which is shown once the match is over.

## Design notes

Every tide is a bet: diving big wins a wreck but burns Air you need later, tying wastes everyone's Air, and resting is safe but leaves wrecks to rivals. `node sim.js` plays thousands of seeded games between fixed strategies and the built-in bot (10,000 games per table, win share against a field of smart bots; a fair share is 50 / 33 / 25 percent for 2 / 3 / 4 players):

| Strategy | 2 players | 3 players | 4 players |
|---|---|---|---|
| smart bot | 49.6 | 33.7 | 25.4 |
| rest-heavy | 38.5 | 37.6 | 27.7 |
| always big bid | 38.8 | 20.5 | 18.7 |
| easy bot | 17.1 | 24.8 | 14.3 |
| random | 15.8 | 23.0 | 15.5 |
| cheap 1-Air dodger | 12.8 | 21.4 | 10.0 |

(Shares do not sum to 100 because each row is run in its own table against smart opponents.) The smart bot clearly beats random (about 51 percent against 31 percent in a mixed 3-player table), and no fixed strategy wins everywhere: big bids fall apart with more players, rest-heavy play is strong but loses to a smart bot at two players. No rule constants were changed.

## License

MIT, see `LICENSE`.
