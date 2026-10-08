"""Record which lines of a frozen program run at every control step of a scored episode.

Run on the eval machine, with the bigym environment, from the bigym checkout:

    MUJOCO_GL=egl .venv/bin/python <site>/scripts/trace_rollout.py JOBS.jsonl OUT_DIR

Each line of JOBS.jsonl is one episode:

    {"task": "pick_box", "session": "astra-s2", "seed": 620011,
     "program": "<dir holding the session's policy.py and its modules>"}

The episode is re-run with the program under sys.settrace (only the program's own
files are traced) and its state trajectory is compared with the scored one from the
rollout dataset on Hugging Face (episodes/<task>/<session>_seed<seed>.npz). Only a
re-run identical to the scored episode frame for frame is written, as
OUT_DIR/<task>/<session>_seed<seed>.raw.json; scripts/build_trace.py turns that into
what the page reads. One process runs its jobs in order; split JOBS.jsonl to run
several side by side.
"""

import json
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from huggingface_hub import hf_hub_download

import bigym.loco.agent.evaluate as ev

DATASET = "SWIRL-Lab/bigym2-agent-rollouts"


def forget_programs():
    """Drop modules imported from an earlier job's program, and its directory from
    sys.path (the eval appends it): sessions reuse module names (vision, g1kin),
    and either would shadow this program's own."""
    sys.path[:] = [p for p in sys.path if Path(p).resolve() not in PROGRAMS]
    for name, mod in list(sys.modules.items()):
        f = getattr(mod, "__file__", None)
        if f and Path(f).resolve().parent in PROGRAMS:
            del sys.modules[name]


PROGRAMS = set()


def trace_one(job, out_dir):
    task, session, seed = job["task"], job["session"], int(job["seed"])
    program = Path(job["program"]).resolve()
    forget_programs()
    PROGRAMS.add(program)
    files = sorted(p.name for p in program.glob("*.py"))
    index = {str(program / f): i for i, f in enumerate(files)}
    steps = []

    # A line is stored as file index * 100000 + line number.
    def tracer(frame, event, arg):
        fi = index.get(frame.f_code.co_filename)
        if fi is None:
            return None
        hit = steps[-1]
        if event == "call":
            hit.add(fi * 100000 + frame.f_code.co_firstlineno)

        def local(frame, event, arg):
            if event == "line":
                hit.add(fi * 100000 + frame.f_lineno)
            return local

        return local

    run_episode = ev.run_episode

    def traced(env, policy, seed_):
        act = policy.act

        def act_traced(obs, tools):
            steps.append(set())
            sys.settrace(tracer)
            try:
                return act(obs, tools)
            finally:
                sys.settrace(None)

        policy.act = act_traced
        return run_episode(env, policy, seed_)

    ev.run_episode = traced
    try:
        with tempfile.TemporaryDirectory() as tmp:
            recs, _, _ = ev._run_indices(
                task, str(program / "policy.py"), [seed - ev.EVAL_SEED_BASE], 0, False,
                "images", False, seed_base=ev.EVAL_SEED_BASE, batch_dir=tmp,
            )
            mine = np.load(Path(tmp) / f"seed{seed}.npz")["full_qpos"]
    finally:
        ev.run_episode = run_episode

    ref = hf_hub_download(DATASET, f"episodes/{task}/{session}_seed{seed}.npz", repo_type="dataset")
    want = np.load(ref)["full_qpos"]
    if mine.shape != want.shape or not np.array_equal(mine, want):
        return f"NOT identical to the scored episode ({mine.shape} vs {want.shape})"
    rec = recs[0]
    out = out_dir / task / f"{session}_seed{seed}.raw.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({
        "task": task, "session": session, "seed": seed,
        "success": bool(rec["success"]), "length": int(rec["length"]),
        "files": files, "steps": [sorted(s) for s in steps],
    }, separators=(",", ":")))
    return f"ok, {len(steps)} steps"


def main():
    jobs_path, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    failed = 0
    for line in jobs_path.read_text().splitlines():
        if not line.strip():
            continue
        job = json.loads(line)
        name = f"{job['task']}/{job['session']}_seed{job['seed']}"
        if (out_dir / job["task"] / f"{job['session']}_seed{job['seed']}.raw.json").exists():
            print(name, "done already", flush=True)
            continue
        t0 = time.time()
        try:
            result = trace_one(job, out_dir)
        except Exception as e:  # one bad episode should not stop the rest
            result = f"failed: {e!r}"
        failed += not result.startswith("ok")
        print(f"{name}: {result} ({time.time() - t0:.0f} s)", flush=True)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
