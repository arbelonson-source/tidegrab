#!/usr/bin/env bash
# Tidegrab bot in plain bash: curl + jq. Usage: bash bots/sample_bot.sh [BASE_URL]
# Each tide it dives on the richest wreck with half its air, or rests when low.
BASE=${1:-https://tidegrab.arbelonski.workers.dev}
H=(-s -H 'Content-Type: application/json' -H 'User-Agent: tidegrab-bash/1.0')
M=$(curl "${H[@]}" -X POST "$BASE/api/matches" -d '{"name":"bash bot","seats":2,"bots":1}')
CODE=$(jq -r .code <<<"$M"); TOKEN=$(jq -r .token <<<"$M"); V=0
echo "match $CODE: $BASE/m/$CODE"
while :; do
  S=$(curl "${H[@]}" -H "Authorization: Bearer $TOKEN" "$BASE/api/matches/$CODE?wait=$V")
  V=$(jq -r .version <<<"$S"); ST=$(jq -r .status <<<"$S")
  [ "$ST" = finished ] || [ "$ST" = expired ] && { jq -c '{status, winners, players: [.players[] | {name, pearls}]}' <<<"$S"; break; }
  [ "$ST" = playing ] && [ "$(jq -r .you.move <<<"$S")" = null ] || continue
  MOVE=$(jq -c '.you.legal as $l | if $l.maxAir < 2 then {rest: true, tide}
    else {wreck: ([.wrecks[] | select(.id as $i | $l.wrecks | index($i))] | max_by(.pearls + .air).id),
          air: ([$l.minAir, ($l.maxAir / 2 | floor)] | max), tide} end' <<<"$S")
  echo "tide $(jq .tide <<<"$S"): $MOVE"
  curl "${H[@]}" -H "Authorization: Bearer $TOKEN" -X POST "$BASE/api/matches/$CODE/move" -d "$MOVE" >/dev/null
done
