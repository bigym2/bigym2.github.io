// The code view follows a 3D replay: the lines the program ran in the last few
// control steps are lit, the phases of the episode sit under the player, and the
// lines the episode never ran are dimmed. The traces come from re-running each
// scored episode with the program under sys.settrace (scripts/trace_rollout.py,
// scripts/build_trace.py); a trace is kept only if the re-run matched the scored
// episode frame for frame.
//
// The player (public/viser-client, patched) posts its clock to this page each frame
// and seeks on request. It shares this page's main thread, so the page holds still
// while a pointer is on the 3D view (orbiting, pinching) and for a moment after, and
// the code also holds while it is off screen; then it catches up in one jump. Dragging
// the playback bar is different: the code follows the drag.

type Trace = {
  window: number;
  length: number;
  sets: number[][];
  steps: number[];
  segments: [from: number, to: number, at: number, methods: string[]][];
};

const STEP_S = 0.02; // one control step; the replays play in real time

export function codeTrace(els: {
  code: HTMLElement; // the scroller holding the highlighted listing (.line spans)
  player: HTMLElement; // holds the replay's iframe
  phases: HTMLElement; // the strip of phases under the player
  methods: HTMLElement; // what the current phase runs
  resume: HTMLButtonElement; // shown once the reader scrolls the code away
}) {
  const { code, player, phases, methods, resume } = els;
  // The playhead moves by a transform of a full-width layer; the track clips it,
  // or it would widen the page as it travels right.
  const track = document.createElement('span');
  track.className = 'ph-track';
  track.setAttribute('aria-hidden', 'true');
  const head = document.createElement('span');
  head.className = 'ph-head';
  head.append(document.createElement('i'));
  track.append(head);
  const map = document.createElement('div');
  map.className = 'trace-map';
  map.hidden = true;
  map.setAttribute('aria-hidden', 'true');
  code.after(map);
  let marks: HTMLElement[] = [];
  const place = () => { map.style.top = `${code.offsetTop + 4}px`; map.style.height = `${code.clientHeight - 8}px`; };
  new ResizeObserver(place).observe(code);
  map.addEventListener('click', (e) => {
    const r = map.getBoundingClientRect();
    setFollow(false);
    code.scrollTo({ top: ((e.clientY - r.top) / r.height) * code.scrollHeight - code.clientHeight / 2, behavior: 'instant' });
  });

  let trace: Trace | null = null;
  let steps: Set<number>[] = [];
  let lines: HTMLElement[] = [];
  let step = -1, segIdx = -1, latest = 0, target = 1, scrolled = false;
  let lit = new Set<number>();
  let follow = true, holding = false, scrubbing = false, codeSeen = true, jump = false;
  let token = 0;

  const frame = () => player.querySelector<HTMLIFrameElement>('iframe');

  function clear() {
    token++;
    trace = null;
    lit.forEach((l) => { lines[l - 1]?.classList.remove('on'); marks[l - 1]?.classList.remove('on'); });
    lines.forEach((el) => el.classList.remove('cold'));
    map.hidden = true;
    lit = new Set();
    delete code.dataset.traced;
    phases.replaceChildren();
    phases.hidden = true;
    methods.textContent = '';
    resume.hidden = true;
  }

  /** Show the trace at url (null: none) for the listing now in the code panel. */
  async function load(url: string | null) {
    clear();
    const mine = token;
    if (!url) return;
    let t: Trace;
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      t = await r.json();
    } catch {
      return;
    }
    if (mine !== token) return;
    trace = t;
    steps = t.steps.map((i) => new Set(t.sets[i]));
    attach();
  }

  /** The listing changed (a session's code arrived): re-apply the trace to it. */
  function attach() {
    // While a session's code is still on its way, the panel shows the previous one.
    if (!trace || 'loading' in code.dataset) return;
    lines = [...code.querySelectorAll<HTMLElement>('.line')];
    const ever = new Set(trace.sets.flat());
    lines.forEach((el, j) => {
      el.classList.toggle('cold', !ever.has(j + 1));
      el.classList.remove('on');
    });
    code.dataset.traced = '';
    lit = new Set();
    marks = lines.map(() => document.createElement('i'));
    map.replaceChildren(...marks);
    map.style.setProperty('--n', String(lines.length));
    map.hidden = false;
    place();
    step = -1; segIdx = -1; follow = true; resume.hidden = true;

    phases.replaceChildren();
    trace.segments.forEach(([from, to, , m], j) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ph';
      b.dataset.seg = String(j);
      b.style.left = `${(from / trace!.length) * 100}%`;
      b.style.width = `${((to - from + 1) / trace!.length) * 100}%`;
      const what = m.length ? m.map((f) => `${f}()`).join(', ') : 'the main loop';
      b.title = `Steps ${from}–${to}: ${what}`;
      b.setAttribute('aria-label', `Play from step ${from}: ${what}`);
      b.addEventListener('click', () => seek(from));
      phases.append(b);
    });
    phases.append(track);
    phases.hidden = false;
    render(latest, true);
  }

  function windowed(i: number) {
    const out = new Set<number>();
    for (let s = Math.max(0, i - trace!.window + 1); s <= i; s++) steps[s]?.forEach((l) => out.add(l));
    return out;
  }

  function render(i: number, force = false) {
    if (!trace) return;
    i = Math.max(0, Math.min(trace.length - 1, i));
    latest = i;
    if (holding) return;
    // The strip under the player follows even while the code is off screen.
    head.style.transform = `translateX(${(i / trace.length) * 100}%)`;
    const j = trace.segments.findIndex(([from, to]) => from <= i && i <= to);
    if (j >= 0 && (j !== segIdx || force)) {
      segIdx = j;
      phases.querySelectorAll<HTMLElement>('.ph').forEach((b) => b.classList.toggle('cur', Number(b.dataset.seg) === j));
      const [, , at, m] = trace.segments[j];
      target = at;
      scrolled = false;
      // The policy's own methods this phase runs; it changes with the phase, not every step.
      methods.textContent = m.map((f) => `${f}()`).join(' · ');
    }
    if ((i === step && !force) || !codeSeen) return;
    step = i;
    const now = windowed(i);
    lit.forEach((l) => { if (!now.has(l)) { lines[l - 1]?.classList.remove('on'); marks[l - 1]?.classList.remove('on'); } });
    now.forEach((l) => { if (!lit.has(l)) { lines[l - 1]?.classList.add('on'); marks[l - 1]?.classList.add('on'); } });
    lit = now;
    // Jump to where this phase's own code starts, once per phase.
    if (follow && !scrolled) { scrolled = true; scrollToLine(target); }
  }

  function scrollToLine(ln: number) {
    const el = lines[ln - 1];
    if (!el) return;
    const top = Math.max(0, el.offsetTop - code.clientHeight * 0.28);
    const instant = jump || scrubbing || matchMedia('(prefers-reduced-motion: reduce)').matches;
    code.scrollTo({ top, behavior: instant ? 'instant' : 'smooth' });
  }

  function seek(i: number) {
    frame()?.contentWindow?.postMessage({ type: 'viser-seek', time: i * STEP_S + 1e-4, play: true }, '*');
    setFollow(true);
    render(i);
  }

  // Scrolling the code by hand stops it following the replay, until the reader
  // asks to go back (or clicks a line or a phase, which jumps the replay there).
  function setFollow(on: boolean) {
    if (on === follow) return;
    follow = on;
    resume.hidden = on || !trace;
    if (on) { jump = true; scrollToLine(target); jump = false; scrolled = true; }
  }
  const away = () => {
    if (!trace || !follow) return;
    // Stop a scroll to the next phase still under way, so it does not undo the reader's.
    code.scrollTo({ top: code.scrollTop, behavior: 'instant' });
    setFollow(false);
  };
  code.addEventListener('wheel', away, { passive: true });
  code.addEventListener('touchmove', away, { passive: true });
  code.addEventListener('keydown', away);
  resume.addEventListener('click', () => setFollow(true));

  // Click a line: jump the replay to the next time that line runs.
  code.addEventListener('click', (e) => {
    if (!trace) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('.line');
    if (!el || el.classList.contains('cold') || getSelection()?.toString()) return;
    const ln = lines.indexOf(el) + 1, n = trace.length;
    for (let d = 1; d <= n; d++) {
      const s = (step + d) % n;
      if (steps[s].has(ln)) return seek(s);
    }
  });

  const catchUp = () => { jump = true; render(latest, true); jump = false; };

  // The player reports its clock; the page follows it.
  addEventListener('message', (e) => {
    const f = frame();
    if (!f || e.source !== f.contentWindow || e.data?.type !== 'viser-playback') return;
    render(Math.floor(e.data.time / STEP_S + 1e-6));
  });

  // Each load of the player: watch where pointers go down in it. On the 3D canvas
  // (orbit, pinch) the page holds; anywhere else (the playback bar) it follows.
  function watch(f: HTMLIFrameElement) {
    if (f.dataset.traceWatched) return;
    f.dataset.traceWatched = '';
    f.addEventListener('load', () => {
      const w = f.contentWindow;
      if (!w) return;
      const onCanvas = new Set<number>();
      let wait = 0;
      holding = false; scrubbing = false;
      w.addEventListener('pointerdown', (e) => {
        if (!(e.target instanceof w.HTMLCanvasElement)) { scrubbing = true; return; }
        onCanvas.add(e.pointerId); holding = true; clearTimeout(wait);
      }, true);
      const up = (e: PointerEvent) => {
        if (!onCanvas.delete(e.pointerId)) { scrubbing = false; return; }
        if (!onCanvas.size) wait = window.setTimeout(() => { holding = false; catchUp(); }, 250);
      };
      w.addEventListener('pointerup', up, true);
      w.addEventListener('pointercancel', up, true);
    });
  }
  new MutationObserver(() => { const f = frame(); if (f) watch(f); }).observe(player, { childList: true });
  const f0 = frame();
  if (f0) watch(f0);

  new IntersectionObserver(([e]) => { codeSeen = e.isIntersecting; if (codeSeen) catchUp(); }).observe(code);

  return { load, attach, clear };
}
