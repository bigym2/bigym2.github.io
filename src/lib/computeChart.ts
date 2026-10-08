// The compute chart, drawn in the browser: one chart whose points (one per
// agent) move between tasks (All tasks = the mean over every session), and a
// grid of one small panel per task. Both redraw on resize at the real pixel size, so text
// never scales. ComputeSection renders the controls and passes the data.

type Usage = { sessions: number[]; usd: number; tokens_m: number };
type Agent = { id: string; model: string; short: string; harness: string; effort: string };
export type ComputeData = {
  sessions_per_task: number;
  agents: Agent[];
  rows: { task: string; label: string; values: Record<string, Usage> }[];
  totals: Record<string, { mean: number; usd: number; tokens_m: number }>;
};
type Axis = 'usd' | 'tok';
type Point = { usd: number; tok: number; m: number; sessions?: number[] };
type Row = { label: string; pts: Record<string, Point> };

const AX = {
  usd: { lo: 0.24, hi: 36, ticks: [0.5, 1, 2, 5, 10, 20], f: (v: number) => `$${v}`, title: 'API-equivalent cost per task ($, log scale)', unit: 'cost' },
  tok: { lo: 0.45, hi: 90, ticks: [1, 2, 5, 10, 20, 50], f: (v: number) => `${v}M`, title: 'Input tokens per task (M, log scale)', unit: 'input tokens' },
};
const NS = 'http://www.w3.org/2000/svg';
const fmt1 = (v: number) => v.toFixed(1);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

function el(tag: string, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent?.appendChild(e);
  return e;
}

export function mountCompute(root: HTMLElement, data: ComputeData) {
  const agents = data.agents;
  const cells = data.rows.length * data.sessions_per_task;
  const rows: Row[] = data.rows.map((r) => ({
    label: r.label,
    pts: Object.fromEntries(agents.map((a) => {
      const c = r.values[a.id];
      return [a.id, { usd: c.usd, tok: c.tokens_m, m: mean(c.sessions), sessions: c.sessions }];
    })),
  }));
  const all: Row = {
    label: `All ${rows.length} tasks`,
    pts: Object.fromEntries(agents.map((a) => {
      const t = data.totals[a.id];
      return [a.id, { usd: t.usd / cells, tok: t.tokens_m / cells, m: t.mean }];
    })),
  };

  let axis: Axis = 'usd';
  let view: 'chart' | 'grid' = 'chart';
  let sel = -1;

  const name = (a: Agent) => `${a.short} (${a.effort})`;
  const bare = (a: Agent) => a.short.replace(/^(Claude|GPT-[\d.]+)\s+/, '');
  const tiny = (a: Agent) => (agents.filter((b) => bare(b) === bare(a)).length > 1 ? a.short : bare(a));
  // The spread on the current axis: the highest spender over the lowest.
  const spread = (row: Row) => {
    const by = [...agents].sort((a, b) => row.pts[a.id][axis] - row.pts[b.id][axis]);
    const lo = by[0], hi = by[by.length - 1];
    return { hi, lo, r: `${fmt1(row.pts[hi.id][axis] / row.pts[lo.id][axis])}×` };
  };
  // Narrow charts name the two ends as their point labels do.
  const ratio = (row: Row, narrow: boolean) => { const s = spread(row), n = narrow ? tiny : (a: Agent) => a.short; return `${s.r} ${AX[axis].unit}: ${n(s.hi)} vs ${n(s.lo)}`; };
  const tip = (row: Row, a: Agent) => {
    const p = row.pts[a.id];
    if (p.sessions) return `${row.label} · ${name(a)}\nSessions ${p.sessions.join(' / ')} → ${Math.round(p.m)}%\n$${fmt1(p.usd)} · ${Math.round(p.tok)}M input tokens per session`;
    const t = data.totals[a.id];
    return `${row.label} · ${name(a)}\n${fmt1(p.m)}% over ${cells} sessions\n$${t.usd} · ${Math.round(t.tokens_m)}M input tokens in total`;
  };

  function scale(w: number, h: number, m: { l: number; r: number; t: number; b: number }) {
    const k = AX[axis];
    return {
      k,
      x: (v: number) => m.l + (Math.log(v / k.lo) / Math.log(k.hi / k.lo)) * (w - m.l - m.r),
      y: (v: number) => m.t + (1 - v / 100) * (h - m.t - m.b),
    };
  }
  function axes(svg: Element, w: number, h: number, m: { l: number; r: number; t: number; b: number }, sc: ReturnType<typeof scale>, o: { yt: number[]; ticks: number[]; titles: boolean; grid: boolean }) {
    const g = el('g', { class: 'axes' }, svg);
    const x0 = m.l, x1 = w - m.r, yb = h - m.b;
    if (o.grid) o.yt.forEach((v) => v && el('line', { class: 'grid', x1: x0, x2: x1, y1: sc.y(v), y2: sc.y(v) }, g));
    el('line', { class: 'axis', x1: x0, x2: x0, y1: m.t - 6, y2: yb }, g);
    el('line', { class: 'axis', x1: x0, x2: x1, y1: yb, y2: yb }, g);
    o.yt.forEach((v) => {
      el('line', { class: 'axis', x1: x0 - 5, x2: x0, y1: sc.y(v), y2: sc.y(v) }, g);
      el('text', { class: 'tick', x: x0 - 9, y: sc.y(v) + 3.5, 'text-anchor': 'end' }, g).textContent = String(v);
    });
    o.ticks.forEach((v) => {
      el('line', { class: 'axis', x1: sc.x(v), x2: sc.x(v), y1: yb, y2: yb + 5 }, g);
      el('text', { class: 'tick', x: sc.x(v), y: yb + 18, 'text-anchor': 'middle' }, g).textContent = sc.k.f(v);
    });
    if (o.titles) {
      el('text', { class: 'atitle', x: (x0 + x1) / 2, y: h - 8, 'text-anchor': 'middle' }, g).textContent = sc.k.title;
      const yy = (m.t + yb) / 2;
      el('text', { class: 'atitle', x: 14, y: yy, 'text-anchor': 'middle', transform: `rotate(-90 14 ${yy})` }, g).textContent = 'Success rate (%)';
    }
  }
  function pill(svg: Element, text: string) {
    const g = el('g', { class: 'pill' }, svg);
    const t = el('text', { x: 0, y: 4, 'text-anchor': 'middle' }, g);
    t.textContent = text;
    const b = (t as SVGTextElement).getBBox();
    g.insertBefore(el('rect', { x: b.x - 8, y: b.y - 3, width: b.width + 16, height: b.height + 6, rx: (b.height + 6) / 2 }), t);
    return g;
  }
  const tintOf = (a: Agent) => `var(--series-${a.id})`;
  // Tick labels, as boxes for point labels to keep clear of.
  const tickBoxes = (svg: Element): Box[] => [...svg.querySelectorAll<SVGTextElement>('.tick')].map((t) => {
    const b = t.getBBox();
    return { x0: b.x, x1: b.x + b.width, y0: b.y, y1: b.y + b.height };
  });
  type XY = { x: number; y: number };
  const poly = (pts: XY[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');
  // The Pareto frontier: the agents no other agent beats on both axes (as
  // cheap or cheaper, and at least as successful). In pixels cheaper is
  // left and more successful is up, so walking right a point joins the
  // frontier only if it sits above every point before it.
  const frontier = (xy: XY[]) => {
    const idx = xy.map((_, i) => i).sort((a, b) => xy[a].x - xy[b].x || xy[a].y - xy[b].y);
    const on: number[] = [];
    let best = Infinity;
    for (const i of idx) if (xy[i].y < best - 0.01) { on.push(i); best = xy[i].y; }
    return on;
  };
  // Its step line: the best success holds until the next frontier agent's
  // cost, then rises to it; past the last one it runs on to the plot's edge.
  // The region under it, to the right, is beaten on both axes.
  const steps = (pts: XY[], xr: number) => {
    const out = [pts[0]];
    for (let k = 1; k < pts.length; k++) out.push({ x: pts[k].x, y: pts[k - 1].y }, pts[k]);
    out.push({ x: Math.max(xr, pts[pts.length - 1].x), y: pts[pts.length - 1].y });
    return out;
  };
  const segsOf = (line: XY[]) => line.slice(1).map((q, k) => [line[k], q] as const);
  function drawFrontier(line: Element, region: Element, xy: XY[], xr: number, yb: number) {
    const on = frontier(xy);
    const st = steps(on.map((i) => xy[i]), xr);
    line.setAttribute('points', poly(st));
    region.setAttribute('points', poly([...st, { x: st[st.length - 1].x, y: yb }, { x: st[0].x, y: yb }]));
    return { on, segs: segsOf(st) };
  }

  // Label placement. Each label has candidate spots around its point: beside
  // it (right first, where the eye reads on), on the diagonals, above and
  // below, and, as a fallback for bunched points, stacked a line or more up
  // or down beside it with a thin leader back to the point. Every
  // combination of spots is scored and the cheapest wins: distance from the
  // point, plus heavy penalties for leaving the plot area, for covering a
  // point, the frontier line, a tick label, the pill or another label, for a leader that
  // crosses a label, a point, the pill, the frontier line or another leader,
  // for a label without a leader that sits nearer another point than its own, and for two labels one
  // above the other in the opposite order to their points (a label under a
  // lower point's label would read as the lower score). That misreads the
  // data, so it costs the most; a label over the frontier line does not
  // (its halo lets the line pass behind it). With three or four labels the full search is
  // a few thousand combinations, cheap enough to run every animation frame;
  // the spot a label held last frame gets a small bonus so labels do not
  // flicker between equal choices mid-move.
  type Spot = { x: number; y: number; anchor: string; lead: boolean };
  type Box = { x0: number; x1: number; y0: number; y1: number };
  type Cand = Spot & { box: Box; cost: number; key: string; seg?: readonly [XY, XY] };
  const overlap = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  // Does the segment p→q pass through box b? (Sampled; the segments are short.)
  const crosses = (p: { x: number; y: number }, q: { x: number; y: number }, b: Box) => {
    for (let t = 0.15; t < 0.9; t += 0.1) {
      const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
      if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
    }
    return false;
  };
  // Does segment a→b cut box bx? Liang–Barsky clipping against the box.
  const cuts = (a: { x: number; y: number }, b: { x: number; y: number }, bx: Box) => {
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const [p, q] of [[-dx, a.x - bx.x0], [dx, bx.x1 - a.x], [-dy, a.y - bx.y0], [dy, bx.y1 - a.y]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t0 < t1;
  };
  // Do segments a→b and c→d cross?
  const meet = (a: XY, b: XY, c: XY, d: XY) => {
    const side = (p: XY, q: XY, r: XY) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  };
  // Distance from a point to a box (0 inside).
  const gap = (p: XY, b: Box) => Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1));
  // Where a leader meets the label: the box's nearest point to the dot.
  const foot = (p: { x: number; y: number }, b: Box) => ({ x: Math.min(Math.max(p.x, b.x0), b.x1), y: Math.min(Math.max(p.y, b.y0 + 4), b.y1 - 4) });
  function place(xy: { x: number; y: number; len: number }[], x0: number, w: number, yb: number, off: number, r: number,
    avoid: Box[] = [], prev: string[] = [], links: (readonly [XY, XY])[] = []): Spot[] {
    const lh = 18;
    const inside = (b: Box) => b.x0 >= x0 && b.x1 <= w - 2 && b.y0 >= 0 && b.y1 <= yb + 9;
    const cands: Cand[][] = xy.map((p, i) => {
      const d = off * 0.72;
      const raw: [number, number, string, number, boolean, string][] = [
        [p.x + off, p.y + 4.5, 'start', 0, false, 'E'],
        [p.x - off, p.y + 4.5, 'end', 3, false, 'W'],
        [p.x + d, p.y - d - 1, 'start', 5, false, 'NE'],
        [p.x + d, p.y + d + 10, 'start', 5, false, 'SE'],
        [p.x - d, p.y - d - 1, 'end', 7, false, 'NW'],
        [p.x - d, p.y + d + 10, 'end', 7, false, 'SW'],
        [p.x, p.y - off - 2, 'middle', 8, false, 'N'],
        [p.x, p.y + off + 12, 'middle', 8, false, 'S'],
      ];
      // Above or below, slid to either side so the point sits near one end
      // of the label: clears a frontier step that leaves the point steeply.
      for (const f of [0.15, 0.03]) {
        raw.push([p.x - f * p.len, p.y + off + 12, 'start', 9 + (0.15 - f) * 20, false, `Sr${f}`]);
        raw.push([p.x + f * p.len, p.y + off + 12, 'end', 10 + (0.15 - f) * 20, false, `Sl${f}`]);
        raw.push([p.x - f * p.len, p.y - off - 2, 'start', 9 + (0.15 - f) * 20, false, `Nr${f}`]);
        raw.push([p.x + f * p.len, p.y - off - 2, 'end', 10 + (0.15 - f) * 20, false, `Nl${f}`]);
      }
      // Straight above or below, a row or more away, on a leader.
      for (let k = 1; k <= 3; k++) {
        raw.push([p.x, p.y - off - 2 - k * lh, 'middle', 16 + 10 * k, true, `N${k}`]);
        raw.push([p.x, p.y + off + 12 + k * lh, 'middle', 16 + 10 * k, true, `S${k}`]);
      }
      for (let k = 1; k <= 5; k++) for (const sgn of [1, -1]) {
        raw.push([p.x + off, p.y + 4.5 + sgn * k * lh, 'start', 14 + 10 * k, true, `E${sgn * k}`]);
        raw.push([p.x - off, p.y + 4.5 + sgn * k * lh, 'end', 18 + 10 * k, true, `W${sgn * k}`]);
      }
      // A spot that would run past the plot's side is also offered slid back
      // inside, as long as the label still sits over or under its point; near
      // the right edge that keeps a label under its point instead of pushing
      // it across the frontier line to the other side.
      for (const [x, y, anchor, pref, lead, key] of [...raw]) {
        const bx0 = anchor === 'start' ? x : anchor === 'end' ? x - p.len : x - p.len / 2;
        const shift = bx0 < x0 ? x0 - bx0 : bx0 + p.len > w - 2 ? w - 2 - (bx0 + p.len) : 0;
        if (shift && bx0 + shift <= p.x && bx0 + shift + p.len >= p.x && !key.startsWith('E') && !key.startsWith('W'))
          raw.push([x + shift, y, anchor, pref + 2 + Math.abs(shift) / 12, lead, `${key}~`]);
      }
      return raw.map(([x, y, anchor, pref, lead, key]) => {
        const bx0 = anchor === 'start' ? x : anchor === 'end' ? x - p.len : x - p.len / 2;
        const box = { x0: bx0, x1: bx0 + p.len, y0: y - 13, y1: y + 4 };
        let cost = pref - (prev[i] === key ? 4 : 0);
        if (!inside(box)) cost += 1000;
        // A label over a point hides it, and one under a tick or the pill
        // cannot be read: as bad as off the plot.
        xy.forEach((q) => { if (overlap(box, { x0: q.x - r, x1: q.x + r, y0: q.y - r, y1: q.y + r })) cost += 1000; });
        avoid.forEach((a) => { if (overlap(box, a)) cost += 1000; });
        // Without a leader a label belongs to the nearest point, so no other
        // point may sit nearer to it than its own.
        if (!lead) {
          const own = gap(p, box);
          xy.forEach((q, j) => { if (j !== i && gap(q, box) < own) cost += 250; });
        }
        links.forEach(([a, b]) => { if (cuts(a, b, { x0: box.x0 - 1, x1: box.x1 + 1, y0: box.y0 + 2, y1: box.y1 - 1 })) cost += 250; });
        let seg: readonly [XY, XY] | undefined;
        if (lead) {
          const f = foot(p, box), d = Math.hypot(f.x - p.x, f.y - p.y) || 1;
          const s0 = { x: p.x + ((f.x - p.x) / d) * (r + 2), y: p.y + ((f.y - p.y) / d) * (r + 2) };
          seg = [s0, f];
          xy.forEach((q, j) => { if (j !== i && crosses(p, f, { x0: q.x - r, x1: q.x + r, y0: q.y - r, y1: q.y + r })) cost += 120; });
          avoid.forEach((a) => { if (cuts(s0, f, a)) cost += 120; });
          links.forEach(([a, b]) => { if (cuts(s0, f, { x0: Math.min(a.x, b.x) - 1, x1: Math.max(a.x, b.x) + 1, y0: Math.min(a.y, b.y) - 1, y1: Math.max(a.y, b.y) + 1 })) cost += 250; });
        }
        return { x, y, anchor, lead, box, cost, key, seg };
      });
    });
    // Pair cost between spot a of label i and spot b of label j.
    const pair = (i: number, a: Cand, j: number, b: Cand) => {
      let c = overlap(a.box, b.box) ? 500 : 0;
      // Labels within 40px of each other side to side are read as a column.
      const stacked = a.box.x0 < b.box.x1 + 40 && b.box.x0 < a.box.x1 + 40;
      if (stacked && Math.abs(xy[i].y - xy[j].y) > 3 && (xy[i].y < xy[j].y) !== (a.box.y0 < b.box.y0)) c += 400;
      // A leader through the other label, or two leaders crossing, pairs
      // the wrong label with a point at a glance.
      const pad = (q: Box) => ({ x0: q.x0 - 1, x1: q.x1 + 1, y0: q.y0 - 1, y1: q.y1 + 1 });
      if (a.seg && cuts(a.seg[0], a.seg[1], pad(b.box))) c += 400;
      if (b.seg && cuts(b.seg[0], b.seg[1], pad(a.box))) c += 400;
      if (a.seg && b.seg && meet(a.seg[0], a.seg[1], b.seg[0], b.seg[1])) c += 400;
      return c;
    };
    const n = xy.length;
    let bestCost = Infinity, best: number[] = xy.map(() => 0);
    const pick: number[] = [];
    const walk = (i: number, acc: number) => {
      if (acc >= bestCost) return;
      if (i === n) { bestCost = acc; best = [...pick]; return; }
      // Cheapest spots first, so good answers come early and prune the rest.
      const order = cands[i].map((c, k) => k).sort((a, b) => cands[i][a].cost - cands[i][b].cost);
      for (const k of order) {
        let c = acc + cands[i][k].cost;
        for (let j = 0; j < i && c < bestCost; j++) c += pair(j, cands[j][pick[j]], i, cands[i][k]);
        pick[i] = k;
        walk(i + 1, c);
      }
    };
    walk(0, 0);
    return Object.assign(best.map((k, i) => cands[i][k]), { cost: bestCost });
  }
  // Leader from the dot's edge to the label, for stacked spots.
  function leader(line: Element, p: { x: number; y: number }, s: Spot, len: number, r: number) {
    if (!s.lead) { line.setAttribute('visibility', 'hidden'); return; }
    const x0 = s.anchor === 'start' ? s.x : s.anchor === 'end' ? s.x - len : s.x - len / 2;
    const f = foot(p, { x0: x0 - 3, x1: x0 + len + 3, y0: s.y - 13, y1: s.y + 4 });
    const d = Math.hypot(f.x - p.x, f.y - p.y) || 1;
    line.setAttribute('x1', String(p.x + ((f.x - p.x) / d) * (r + 2)));
    line.setAttribute('y1', String(p.y + ((f.y - p.y) / d) * (r + 2)));
    line.setAttribute('x2', String(f.x)); line.setAttribute('y2', String(f.y));
    line.setAttribute('visibility', 'visible');
  }

  /* ---- Chart: one point per agent, moving between tasks ---- */
  const plotHost = root.querySelector<HTMLElement>('[data-plot]')!;
  type St = Record<string, { x: number; y: number; task: number }>;
  let S: { state: St; w: number; h: number; m: { l: number; r: number; t: number; b: number }; ticks: Box[]; sc: ReturnType<typeof scale>; refs: any } | null = null;
  let raf = 0;
  const rowOf = () => (sel < 0 ? all : rows[sel]);
  const target = (): St => Object.fromEntries(agents.map((a) => {
    const p = rowOf().pts[a.id];
    return [a.id, { x: S!.sc.x(p[axis]), y: S!.sc.y(p.m), task: sel < 0 ? 0 : 1 }];
  }));
  function draw(st: St) {
    const r = S!.refs;
    agents.forEach((a) => {
      const s = st[a.id], m = r[a.id];
      m.dot.setAttribute('cx', s.x); m.dot.setAttribute('cy', s.y);
      m.hit.setAttribute('cx', s.x); m.hit.setAttribute('cy', s.y);
    });
    const xy = agents.map((a) => ({ x: st[a.id].x, y: st[a.id].y, len: (r[a.id].lab as SVGTextElement).getComputedTextLength() }));
    const yb = S!.h - S!.m.b, xr = S!.w - S!.m.r;
    const { segs } = drawFrontier(r.front, r.region, xy, xr, yb);
    // The pill sits in the top margin, so it never stands between a point
    // and its label: over the span of the spread's two ends, or, where a
    // label near the top needs that room, against either side of the plot.
    // The labels are placed for each and the pill keeps its side unless
    // another frees the labels clearly.
    const { hi, lo } = spread(rowOf());
    const pb = (r.pill as SVGGElement).getBBox();
    const half = pb.width / 2 + 4;
    const clamp = (x: number) => Math.min(Math.max(x, half), S!.w - half);
    const py = 14;
    const sides = [clamp((st[hi.id].x + st[lo.id].x) / 2), clamp(S!.m.l + half - 4), clamp(xr - half + 4)];
    const runs = sides.map((px, k) => {
      const out = place(xy, S!.m.l + 4, S!.w, yb, 14, 8,
        [...S!.ticks, { x0: px + pb.x - 2, x1: px + pb.x + pb.width + 2, y0: py + pb.y - 2, y1: py + pb.y + pb.height + 2 }], r.keys, segs);
      return { px, out, cost: out.cost + (k ? 10 : 0) - (r.side === k ? 15 : 0) };
    });
    const k = runs.reduce((b, q, j) => (q.cost < runs[b].cost ? j : b), 0);
    const { px, out: spots } = runs[k];
    r.side = k;
    r.pill.setAttribute('transform', `translate(${px} ${py})`);
    r.keys = spots.map((s) => (s as any).key);
    spots.forEach((p, i) => {
      const a = r[agents[i].id];
      a.lab.setAttribute('x', p.x); a.lab.setAttribute('y', p.y); a.lab.setAttribute('text-anchor', p.anchor);
      leader(a.lead, xy[i], p, xy[i].len, 7);
    });
  }
  function labels() {
    const r = S!.refs, row = rowOf();
    agents.forEach((a) => {
      const t = r[a.id].lab as SVGTextElement;
      t.textContent = '';
      // Narrow charts drop the effort and the vendor prefix (both are in the
      // scoreboard above, next to the same colour) to leave room, except
      // where two models would then share a name (GPT-6 Sol, GPT-6.1 Sol).
      el('tspan', {}, t).textContent = `${S!.w < 720 ? tiny(a) : name(a)} `;
      el('tspan', { class: 'v' }, t).textContent = sel < 0 ? `${fmt1(row.pts[a.id].m)}%` : `${Math.round(row.pts[a.id].m)}%`;
      r[a.id].hit.dataset.tip = tip(row, a);
      r[a.id].hit.setAttribute('aria-label', tip(row, a).replaceAll('\n', '. '));
    });
    r.pill.remove();
    r.pill = pill(r.svg, ratio(row, S!.w < 720));
    if (S!.state[agents[0].id]) draw(S!.state);
  }
  function animate() {
    cancelAnimationFrame(raf);
    const from = S!.state, to = target();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - t0) / 650);
      const e = 1 - Math.pow(1 - t, 4);
      const cur: St = {};
      for (const id in to) cur[id] = { x: from[id].x + (to[id].x - from[id].x) * e, y: from[id].y + (to[id].y - from[id].y) * e, task: from[id].task + (to[id].task - from[id].task) * e };
      S!.state = cur; draw(cur);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function renderChart() {
    const w = plotHost.clientWidth;
    if (!w) return;
    const prev = S && S.w === w ? S.state : null;
    plotHost.textContent = '';
    // Phones get a taller top margin: the pill keeps the top line and labels
    // of points near 100% have a row of their own under it.
    const tall = w < 480 ? 20 : 0;
    const h = Math.round(Math.min(Math.max(w * 0.5, 300), 440)) + tall;
    const m = { l: 64, r: 16, t: 30 + tall, b: 58 };
    const svg = el('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: 'group', 'aria-label': `Success rate against ${AX[axis].unit} for ${agents.map((a) => a.model).join(', ')}` }, plotHost);
    const sc = scale(w, h, m);
    axes(svg, w, h, m, sc, { yt: [0, 25, 50, 75, 100], ticks: w < 480 ? (axis === 'usd' ? [0.5, 2, 5, 20] : [1, 5, 20, 50]) : AX[axis].ticks, titles: true, grid: true });
    const refs: any = { svg, keys: [], region: el('polygon', { class: 'region' }, svg), front: el('polyline', { class: 'front' }, svg), pill: el('g', {}, svg) };
    agents.forEach((a) => {
      const g = el('g', { style: `--c:${tintOf(a)}` }, svg);
      refs[a.id] = {
        lead: el('line', { class: 'lead', visibility: 'hidden' }, svg),
        dot: el('circle', { class: 'dot', r: 7 }, g),
        hit: el('circle', { class: 'hit', r: 16, tabindex: 0 }, g),
        lab: el('text', { class: 'lab' }, svg),
      };
    });
    S = { state: {} as St, w, h, m, ticks: tickBoxes(svg), sc, refs };
    labels();
    if (prev) { S.state = prev; draw(prev); animate(); } else { S.state = target(); draw(S.state); }
  }

  /* ---- Grid: one panel per task ---- */
  const gridHost = root.querySelector<HTMLElement>('[data-grid]')!;
  function renderGrid() {
    gridHost.textContent = '';
    rows.forEach((row, i) => {
      const p = document.createElement('button');
      p.type = 'button';
      p.className = 'panel';
      p.setAttribute('aria-label', `${row.label}: show in the chart`);
      p.innerHTML = `<span class="ph"><span>${row.label}</span><span class="r">${spread(row).r} ${AX[axis].unit}</span></span>`;
      p.addEventListener('click', () => { setView('chart'); select(i); });
      gridHost.appendChild(p);
      const w = p.clientWidth;
      const h = Math.round(w * 0.72);
      const m = { l: 30, r: 10, t: 10, b: 24 };
      const svg = el('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' }, p);
      const sc = scale(w, h, m);
      const narrow = w < 200;
      axes(svg, w, h, m, sc, { yt: [0, 50, 100], ticks: narrow ? [1, 10] : axis === 'usd' ? [0.5, 2, 5, 20] : [1, 5, 20, 50], titles: false, grid: false });
      const xy = agents.map((a) => ({ x: sc.x(row.pts[a.id][axis]), y: sc.y(row.pts[a.id].m), len: 0 }));
      const region = el('polygon', { class: 'region' }, svg);
      const { segs } = drawFrontier(el('polyline', { class: 'front' }, svg), region, xy, w - m.r, h - m.b);
      const vals = agents.map((a, i) => {
        const g = el('g', { style: `--c:${tintOf(a)}` }, svg);
        el('circle', { class: 'dot', cx: xy[i].x, cy: xy[i].y, r: 6 }, g);
        const t = el('text', { class: 'val' }, g) as SVGTextElement;
        t.textContent = `${Math.round(row.pts[a.id].m)}%`;
        xy[i].len = t.getComputedTextLength();
        el('circle', { class: 'hit', cx: xy[i].x, cy: xy[i].y, r: 14, 'data-tip': tip(row, a) }, g);
        return t;
      });
      const leads = agents.map(() => el('line', { class: 'lead', visibility: 'hidden' }, svg));
      place(xy, m.l + 3, w, h - m.b, 10, 7, tickBoxes(svg), [], segs).forEach((p, i) => {
        vals[i].setAttribute('x', String(p.x)); vals[i].setAttribute('y', String(p.y - 0.5)); vals[i].setAttribute('text-anchor', p.anchor);
        leader(leads[i], xy[i], p, xy[i].len, 6);
      });
    });
    root.querySelector('[data-fx]')!.textContent = AX[axis].title;
  }

  /* ---- Controls ---- */
  const chips = [...root.querySelectorAll<HTMLButtonElement>('[data-chip]')];
  const chipRow = root.querySelector<HTMLElement>('[data-chips]')!;
  const facet = root.querySelector<HTMLElement>('[data-facet]')!;
  function select(i: number) {
    sel = i;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.chip) === i)));
    if (!S) return renderChart();
    labels(); animate();
  }
  function setView(v: 'chart' | 'grid') {
    view = v;
    root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    const grid = v === 'grid';
    chipRow.hidden = grid;
    facet.hidden = !grid;
    plotHost.hidden = grid;
    const shown = grid ? facet : plotHost;
    shown.classList.remove('enter'); void shown.offsetWidth; shown.classList.add('enter');
    grid ? renderGrid() : renderChart();
  }
  const render = () => (view === 'grid' ? renderGrid() : renderChart());
  chips.forEach((c) => c.addEventListener('click', () => select(Number(c.dataset.chip))));
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => view !== b.dataset.view && setView(b.dataset.view as 'chart' | 'grid')));
  root.querySelectorAll<HTMLButtonElement>('[data-axis]').forEach((b) => b.addEventListener('click', () => {
    if (axis === b.dataset.axis) return;
    axis = b.dataset.axis as Axis;
    root.querySelectorAll('[data-axis]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    hideTip();
    render();
  }));

  /* ---- Tooltip ---- */
  const tipEl = root.querySelector<HTMLElement>('[data-tip-box]')!;
  function showTip(t: Element) {
    const r = t.getBoundingClientRect();
    tipEl.textContent = (t as HTMLElement).dataset.tip ?? '';
    tipEl.hidden = false;
    const half = tipEl.offsetWidth / 2 + 8;
    tipEl.style.left = `${Math.min(Math.max(r.left + r.width / 2, half), innerWidth - half)}px`;
    tipEl.style.top = `${r.top}px`;
  }
  function hideTip() { tipEl.hidden = true; }
  root.addEventListener('pointerover', (e) => { const t = (e.target as Element).closest('[data-tip]'); if (t && e.pointerType === 'mouse') showTip(t); });
  root.addEventListener('pointerout', (e) => { if ((e.target as Element).closest('[data-tip]') && e.pointerType === 'mouse') hideTip(); });
  root.addEventListener('focusin', (e) => { const t = (e.target as Element).closest('[data-tip]'); if (t) showTip(t); });
  root.addEventListener('focusout', hideTip);
  root.addEventListener('click', (e) => {
    const t = (e.target as Element).closest('[data-tip]');
    if (t) { e.stopPropagation(); showTip(t); }
  }, true);
  document.addEventListener('click', (e) => { if (!(e.target as Element).closest?.('[data-tip]')) hideTip(); });
  addEventListener('scroll', hideTip, { passive: true });

  let lastW = root.clientWidth;
  new ResizeObserver(() => { if (Math.abs(root.clientWidth - lastW) < 2) return; lastW = root.clientWidth; S = null; render(); }).observe(root);
  renderChart();
  document.fonts?.ready.then(() => { S = null; render(); });
}
