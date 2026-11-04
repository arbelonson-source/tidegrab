import test from "node:test";
import assert from "node:assert/strict";
import { MatchRoom, parseCreate, AWAY_AFTER, AWAY_WAIT_MS } from "../game/room.js";

// Drives a room on a fake clock: every wake-up runs as soon as the clock passes it.
function clockRoom(params) {
  let now = 1_000_000;
  let wakeAt = null;
  const hooks = { now: () => now, save() {}, wake: (at) => (wakeAt = at) };
  const { room, token } = MatchRoom.create("AWAYT", parseCreate(params), hooks);
  const advance = (ms) => {
    const end = now + ms;
    while (wakeAt != null && wakeAt <= end) {
      now = Math.max(now, wakeAt);
      wakeAt = null;
      room.onWake();
    }
    now = end;
  };
  return { room, token, advance, time: () => now };
}

test("a person who stops moving is marked away and the table stops waiting the full timer", async () => {
  const { room, token, advance, time } = clockRoom({ name: "Host", seats: 2, bots: 1, turnSeconds: 60 });
  await room.handle("POST", "start", {}, token);
  const tideTimes = [];
  for (let i = 0; i < AWAY_AFTER + 2; i++) {
    const t0 = time();
    const tide = room.d.game.tide;
    while (room.d.game.tide === tide && room.d.status === "playing") advance(500);
    tideTimes.push(time() - t0);
  }
  assert.ok(tideTimes[0] >= 60000, `first missed tide waited the timer (${tideTimes[0]} ms)`);
  assert.ok(tideTimes[AWAY_AFTER] < 60000 && tideTimes[AWAY_AFTER] <= AWAY_WAIT_MS + 6000, `away tide was short (${tideTimes[AWAY_AFTER]} ms)`);
  const st = room.publicState(0);
  assert.equal(st.players[0].away, true);
  assert.equal(st.players[1].away, false);

  // Making any move brings you straight back.
  await room.handle("POST", "move", { rest: true }, token);
  assert.equal(room.publicState(0).players[0].away, false);
});
