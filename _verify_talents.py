import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
d = json.load(
    open("opendota-match-ui/public/data/matches/8767833338.json", encoding="utf-8")
)
EXP = {
    19: ("R", "R", "L", "R"),
    73: ("L", "L", "L", "L"),
    123: ("R", "R", "L", None),
    114: ("R", "R", "R", None),
    13: ("R", "R", "L", None),
    14: ("R", "R", "L", None),
    145: ("R", "R", "R", None),
    55: ("L", "L", "L", None),
    87: ("L", "R", None, None),
    71: ("R", "R", None, None),
}


def sel(p):
    by = {int(t["hero_level"]): t.get("selected") for t in (p.get("talent_tree") or {}).get("tiers") or []}
    return [
        "L" if by.get(lv) == "left" else "R" if by.get(lv) == "right" else "-"
        for lv in (10, 15, 20, 25)
    ]


for p in sorted(d["players"], key=lambda x: x.get("player_slot", 0)):
    hid = p.get("hero_id")
    if hid not in EXP:
        continue
    s = sel(p)
    e = list(EXP[hid])
    ok = all((e[i] is None) or (s[i] == e[i]) for i in range(4))
    print(hid, p.get("personaname"), s, "OK" if ok else "BAD", "exp", e)
