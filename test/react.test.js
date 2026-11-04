import { test } from "node:test";
import assert from "node:assert/strict";
import { MatchRoom } from "../game/room.js";

// Plays a 3-seat match (one resting human, two bots) on a fake clock, running each wake by hand.
test("bots react a moment after a reveal, and say gg at the end", () => {
  const random = Math.random;
  Math.random = () => 0.01; // every reaction roll succeeds
  try {
    let now = 1_000_000;
    let wakeAt = null;
    const hooks = { now: () => now, save() {}, wake: (at) => (wakeAt = at) };
    const { room } = MatchRoom.create("REACT", { seats: 3, bots: 2, turnSeconds: 45, botLevel: "normal", name: "Me" }, hooks);
    const d = room.d;
    let reactedLate = false;
    for (let step = 0; step < 500 && d.status === "playing"; step++) {
      if (!d.moves[0]) room.submitMove(0, { rest: true });
      const tides = d.rounds.length, seen = room.emotes.length;
      now = Math.max(now, wakeAt);
      room.onWake();
      if (d.rounds.length > tides) assert.equal(room.emotes.length, seen, "no reaction in the same instant as the reveal");
      if (room.emotes.length > seen && d.rounds.length === tides) reactedLate = true;
    }
    assert.equal(d.status, "finished");
    assert.ok(reactedLate, "a bot reacted after a reveal");
    for (let i = 0; i < 5 && room.reactions.length; i++) {
      now = Math.max(now, wakeAt);
      room.onWake();
    }
    assert.equal(room.reactions.length, 0);
    assert.ok(room.emotes.some((e) => e.emote === "gg" && d.seats[e.seat].kind === "bot"), "a bot said gg");
    assert.ok(room.emotes.every((e) => e.seat !== 0), "the human never emoted");
    // Bot think time stays under the cap and above a second.
    for (let i = 0; i < 50; i++) {
      const ms = room.botDelay(1);
      assert.ok(ms >= 1000 && ms <= 4000, String(ms));
    }
  } finally {
    Math.random = random;
  }
});
