"""Turn the raw line traces from scripts/trace_rollout.py into the code view's data.

    python3 scripts/build_trace.py RAW_DIR OUT_DIR

reads RAW_DIR/<task>/<session>_seed<seed>.raw.json and writes
OUT_DIR/<task>/<session>_seed<seed>.json (public/codetrace/ for the rollouts served
with the page). Line numbers become those of the program listing the explorer shows:
policy.py, then each module under a divider, as sessionSource() in src/lib/data.ts
joins them. The session's files are read from src/data/ via agent.json.

The page lights the lines run in the last WINDOW steps: programs that re-plan every
few steps and hold in between would otherwise flicker. The phases under the player
are runs of the same windowed line set, minus the lines lit throughout; a run shorter
than MIN_RUN steps, or than 1/PHASES_MAX of the episode, joins the one before it, so a
phase stays wide enough to click on the strip.

Output, compact because an episode can run 4,400 steps:
  sets      the distinct sets of lines run in one step
  steps     for every step, the index of its set
  segments  [from, to, line to scroll to, [the policy's own methods it runs]]
"""

import ast
import json
import re
import sys
from pathlib import Path

WINDOW, MIN_RUN, PHASES_MAX = 8, 10, 50
SITE = Path(__file__).resolve().parent.parent


def listing(files):
    """Each file's first line in the joined listing, and the listing's line count."""
    first, n = [], 0
    for i, f in enumerate(files):
        src = re.sub(r"\n+$", "\n", (SITE / "src/data" / f).read_text())
        if i:
            n += 3  # a blank line, the divider naming the file, a blank line
        first.append(n + 1)
        n += src.count("\n")
    return first, n


def methods(files, first):
    """Listing line -> method name, for the methods of the class that defines act()."""
    tree = ast.parse((SITE / "src/data" / files[0]).read_text())
    owner = {}
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and any(
            isinstance(m, ast.FunctionDef) and m.name == "act" for m in node.body
        ):
            for m in node.body:
                if isinstance(m, ast.FunctionDef) and m.name != "act":
                    for ln in range(m.lineno, m.end_lineno + 1):
                        owner[first[0] + ln - 1] = m.name
    return owner


def build(raw, files):
    first, _ = listing(files)
    by_name = {Path(f).name: i for i, f in enumerate(files)}
    where = [first[by_name[name]] - 1 if name in by_name else None for name in raw["files"]]

    def lines(step):
        out = set()
        for code in step:
            off = where[code // 100000]
            if off is not None:
                out.add(off + code % 100000)
        return frozenset(out)

    steps = [lines(s) for s in raw["steps"]]
    owner = methods(files, first)

    win = [frozenset().union(*steps[max(0, i - WINDOW + 1): i + 1]) for i in range(len(steps))]
    always = frozenset.intersection(*win[WINDOW - 1:]) if len(win) >= WINDOW else frozenset()
    runs = []
    for i, w in enumerate(win):
        sig = w - always
        if runs and runs[-1]["sig"] == sig:
            runs[-1]["to"] = i
        else:
            runs.append({"from": i, "to": i, "sig": sig})
    shortest = max(MIN_RUN, len(steps) // PHASES_MAX)
    merged = []
    for r in runs:
        if merged and r["to"] - r["from"] + 1 < shortest:
            merged[-1]["to"] = r["to"]
            merged[-1]["sig"] |= r["sig"]
        elif merged and merged[-1]["sig"] == r["sig"]:
            merged[-1]["to"] = r["to"]
        else:
            merged.append(dict(r))

    segments = []
    for s in merged:
        # Scroll to the first of the phase's own lines lit for at least half of it
        # (a short run merged in may add lines that run only for a moment).
        span = win[s["from"]: s["to"] + 1]
        lit = {l: sum(l in w for w in span) for l in (s["sig"] or span[0])}
        own = [l for l, k in lit.items() if 2 * k >= len(span)] or [max(lit, key=lit.get)] if lit else []
        fns = sorted({owner[l] for l in s["sig"] if l in owner}, key=lambda f: min(l for l in s["sig"] if owner.get(l) == f))
        segments.append([s["from"], s["to"], min(own) if own else 1, fns])

    sets = sorted(set(steps), key=lambda s: (len(s), sorted(s)))
    index = {s: i for i, s in enumerate(sets)}
    return {
        "v": 1, "window": WINDOW, "length": len(steps), "success": raw["success"],
        "sets": [sorted(s) for s in sets], "steps": [index[s] for s in steps], "segments": segments,
    }


def main():
    raw_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    agent = json.loads((SITE / "src/data/agent.json").read_text())
    files = {(t["task"], s["id"]): s["files"] for t in agent["tasks"] for s in t["sessions"]}
    for path in sorted(raw_dir.glob("*/*.raw.json")):
        raw = json.loads(path.read_text())
        data = build(raw, files[(raw["task"], raw["session"])])
        out = out_dir / raw["task"] / path.name.replace(".raw.json", ".json")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(data, separators=(",", ":")))
        print(f"{out.relative_to(out_dir)}: {data['length']} steps, {len(data['sets'])} line sets, "
              f"{len(data['segments'])} phases, {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
