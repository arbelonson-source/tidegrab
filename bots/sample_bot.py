#!/usr/bin/env python3
import argparse, json, random, sys, urllib.error, urllib.request


def call(base, path, body=None, token=None):
    headers = {"Content-Type": "application/json", "User-Agent": "tidegrab-sample-bot/1.0"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit("HTTP %d: %s" % (e.code, e.read().decode()))


def choose(state):
    legal = state["you"]["legal"]
    air = legal["maxAir"]
    if not legal["wrecks"] or air < 1 or (air < 3 and random.random() < 0.6):
        return {"rest": True}
    best = max(state["wrecks"], key=lambda w: w["pearls"] + 3 * w["air"])
    value = best["pearls"] + 3 * best["air"]
    bid = max(1, min(air, round(air * 0.3 + value * 0.25 + random.uniform(-1, 1))))
    return {"wreck": best["id"], "air": bid}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="https://tidegrab.arbelonski.workers.dev")
    ap.add_argument("--code")
    ap.add_argument("--name", default="PyBot")
    a = ap.parse_args()
    base = a.server.rstrip("/")
    if a.code:
        m = call(base, "/api/matches/%s/join" % a.code, {"name": a.name})
        m["code"] = a.code
    else:
        m = call(base, "/api/matches", {"name": a.name, "seats": 2, "bots": 1})
    code, token = m["code"], m["token"]
    print("match %s  watch: %s/m/%s" % (code, base, code))
    version, last = 0, 0
    while True:
        s = call(base, "/api/matches/%s?wait=%d" % (code, version), token=token)
        version = s["version"]
        rv = s.get("lastReveal")
        if rv and rv["tide"] > last:
            last = rv["tide"]
            me = s["players"][s["you"]["seat"]]
            print("tide %d done: pearls %d air %d" % (rv["tide"], me["pearls"], me["air"]))
        if s["status"] == "finished":
            print("final:", ", ".join("%s %d" % (p["name"], p["pearls"]) for p in s["players"]))
            print("winners:", [s["players"][w]["name"] for w in s["winners"]])
            return
        if s["status"] == "expired":
            print("the match was closed for being idle")
            return
        if s["status"] == "playing" and not s["you"]["move"]:
            call(base, "/api/matches/%s/move" % code, choose(s), token)


if __name__ == "__main__":
    sys.exit(main())
