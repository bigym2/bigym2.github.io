// The live leaderboard, laid out at build time from board.json: one row per model with a point
// for each reasoning effort it was run at, its per-task results grouped by scene, and the
// success-against-cost chart with each model's efforts joined by an arrow.
import { board, results, tasks } from './data';

export type View = 'all' | 'core' | 'ext';
export const VIEWS: { id: View; label: string; lede: string }[] = [
  { id: 'all', label: '20 tasks', lede: 'all 20 tasks' },
  { id: 'core', label: '9 core', lede: 'the 9 core tasks' },
  { id: 'ext', label: '11 extended', lede: 'the 11 extended tasks' },
];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const core = new Set(board.core);

/** Scenes in the order of tasks.json, each with its tasks in that order. */
export const scenes = tasks.groups.map((g) => ({
  ...g,
  tasks: tasks.tasks.filter((t) => t.group === g.id),
}));
const ordered = scenes.flatMap((s) => s.tasks.map((t) => t.id));
const inView = (v: View) => ordered.filter((t) => (v === 'all' ? true : v === 'core' ? core.has(t) : !core.has(t)));

export interface Point { effort: string; score: number; cost: number; tested: string; per: Record<string, number> }
export interface Row {
  id: string; name: string; maker: string; harness: string;
  points: Point[]; top: Point;
  cells: { scene: string; values: { task: string; v: number }[] }[];
}

export function rows(v: View): Row[] {
  const ts = inView(v);
  const out: Row[] = [];
  for (const m of board.models) {
    const points: { p: Point; per: Record<string, number> }[] = [];
    for (const e of [...m.efforts].sort((a, b) => EFFORTS.indexOf(a.effort) - EFFORTS.indexOf(b.effort))) {
      if (ts.some((t) => e.per[t] == null)) continue;  // an effort not run on every task in view
      const score = ts.reduce((s, t) => s + e.per[t], 0) / ts.length;
      const nCore = board.core.length * board.sessions_per_task, nExt = board.extended.length * board.sessions_per_task;
      const cost = v === 'core' ? e.cost.core / nCore : v === 'ext' ? e.cost.ext! / nExt : (e.cost.core + e.cost.ext!) / (nCore + nExt);
      points.push({ p: { effort: e.effort, score, cost, tested: e.tested, per: e.per }, per: e.per });
    }
    if (!points.length) continue;
    const top = points[points.length - 1];
    out.push({
      id: m.id, name: m.name, maker: m.maker, harness: m.harness,
      points: points.map((x) => x.p), top: top.p,
      cells: scenes.map((s) => ({ scene: s.id, values: s.tasks.filter((t) => ts.includes(t.id)).map((t) => ({ task: t.id, v: top.per[t.id] })) }))
        .filter((c) => c.values.length),
    });
  }
  return out.sort((a, b) => b.top.score - a.top.score);
}

/** Models that have an effort missing from this view, for the note under the bars: "Claude Sonnet 5.5 at max
 *  (9 core tasks only)". */
export function missing(v: View): string[] {
  const ts = inView(v);
  const ran = (e: { per: Record<string, number> }) =>
    board.core.every((t) => e.per[t] != null) ? `${board.core.length} core tasks only` : `${board.extended.length} extended tasks only`;
  return board.models.flatMap((m) => m.efforts.filter((e) => ts.some((t) => e.per[t] == null)).map((e) => `${m.name} at ${e.effort} (${ran(e)})`));
}

// ---- success against cost per session, log x
export const CHART = { W: 1100, H: 420, L: 56, R: 28, T: 18, B: 52 };
export function chart(rs: Row[]) {
  const { W, H, L, R, T, B } = CHART;
  const costs = rs.flatMap((r) => r.points.map((p) => p.cost));
  const lo = Math.min(...costs) / 1.6, hi = Math.max(...costs) * 1.5;
  const lx = Math.log(lo), hx = Math.log(hi);
  const ymax = Math.ceil((Math.max(...rs.map((r) => r.top.score)) + 8) / 20) * 20;
  const X = (c: number) => L + (W - L - R) * (Math.log(c) - lx) / (hx - lx);
  const Y = (v: number) => T + (H - T - B) * (1 - v / ymax);
  const xticks = [0.2, 0.5, 1, 2, 5, 10, 20, 50].filter((c) => c > lo && c < hi).map((c) => ({ x: X(c), label: `$${c}` }));
  const yticks = Array.from({ length: ymax / 20 + 1 }, (_, i) => ({ y: Y(i * 20), label: `${i * 20}%` }));
  // every point says what it is under the pointer; on the chart itself a model is named once
  const dots = rs.flatMap((r) => r.points.map((p) => ({ id: r.id, x: X(p.cost), y: Y(p.score), hollow: false,
    name: r.name, effort: p.effort, score: p.score, cost: p.cost })));
  const arrows = rs.filter((r) => r.points.length > 1).flatMap((r) => r.points.slice(1).map((b, i) => {
    const a = r.points[i];
    return { id: r.id, x1: X(a.cost), y1: Y(a.score), x2: X(b.cost), y2: Y(b.score) };  // centre to centre, drawn under the dots
  }));
  // A model run at several efforts is named along its line, as Artificial Analysis does: beside the middle of the
  // line, on its upper side, the text running away from the line. A single point is named to its right; where that
  // does not fit or would cover another point or name, above it, then below it, then to its left, then under or over it slid sideways (so a name never
  // sits right beside a neighbour's dot, as Sonnet's did next to Opus's at the right edge, nor across another
  // model's line). Labels that still
  // collide are pushed apart.
  type Anchor = 'start' | 'middle' | 'end';
  type Label = { id: string; text: string; w: number; anchor: Anchor; lx: number; ly: number };
  const single = new Map<string, number[]>();
  const placed = rs.map((r): Label | null => {
    const ps = r.points.map((p) => [X(p.cost), Y(p.score)]), w = r.name.length * 7.3;
    if (ps.length === 1) { single.set(r.id, ps[0]); return null; }
    const segs = ps.slice(1).map((q, i) => ({ a: ps[i], b: q, len: Math.hypot(q[0] - ps[i][0], q[1] - ps[i][1]) }));
    let half = segs.reduce((t, g) => t + g.len, 0) / 2, mx = ps[0][0], my = ps[0][1], nx = 0, ny = -1;
    for (const g of segs) {
      if (half <= g.len) {
        const t = half / g.len, dx = (g.b[0] - g.a[0]) / g.len, dy = (g.b[1] - g.a[1]) / g.len;
        mx = g.a[0] + (g.b[0] - g.a[0]) * t; my = g.a[1] + (g.b[1] - g.a[1]) * t;
        [nx, ny] = dx > 0 ? [dy, -dx] : [-dy, dx];  // the normal on the upper side (SVG y runs down)
        break;
      }
      half -= g.len;
    }
    const anchor: Anchor = nx < -0.15 ? 'end' : nx > 0.15 ? 'start' : 'middle';
    return { id: r.id, text: r.name, w, anchor, lx: mx + nx * 14, ly: my + ny * 14 + (anchor === 'middle' ? -2 : 4.5) };
  });
  const x0 = (l: { anchor: Anchor; lx: number; w: number }) => (l.anchor === 'end' ? l.lx - l.w : l.anchor === 'middle' ? l.lx - l.w / 2 : l.lx);
  const labels = placed.filter((l): l is Label => l !== null);
  const allDots = rs.flatMap((r) => r.points.map((p) => ({ id: r.id, x: X(p.cost), y: Y(p.score) })));
  const clear = (l: Label) => {
    const a = x0(l), b = a + l.w, top = l.ly - 11, bot = l.ly + 3;
    if (a < L || b > W - R || top < T - 6) return false;
    if (allDots.some((d) => d.id !== l.id && d.x > a - 9 && d.x < b + 9 && d.y > top - 7 && d.y < bot + 7)) return false;
    // nor across another model's line (Opus's name sat on Astra's high-to-max line in the 20-task view)
    if (arrows.some((g) => g.id !== l.id && Array.from({ length: 25 }, (_, i) => i / 24).some((t) => {
      const px = g.x1 + (g.x2 - g.x1) * t, py = g.y1 + (g.y2 - g.y1) * t;
      return px > a - 3 && px < b + 3 && py > top - 3 && py < bot + 3;
    }))) return false;
    return labels.every((o) => { const oa = x0(o); return b < oa - 4 || a > oa + o.w + 4 || bot < o.ly - 13 || top > o.ly + 5; });
  };
  for (const r of [...rs].sort((p, q) => X(p.points[0].cost) - X(q.points[0].cost))) {
    const at = single.get(r.id);
    if (!at) continue;
    const [x, y] = at, w = r.name.length * 7.3, mid = Math.min(Math.max(x, L + w / 2), W - R - w / 2);
    // the name under or over the dot, slid right or left so it starts or ends just past the dot (kept inside the plot)
    const right = Math.min(x - 12, W - R - w - 1), left = Math.max(x + 12, L + w + 1);
    const tries: Label[] = [
      { id: r.id, text: r.name, w, anchor: 'start', lx: x + 12, ly: y + 4.5 },
      { id: r.id, text: r.name, w, anchor: 'middle', lx: mid, ly: y - 12 },
      { id: r.id, text: r.name, w, anchor: 'middle', lx: mid, ly: y + 21 },
      { id: r.id, text: r.name, w, anchor: 'end', lx: x - 12, ly: y + 4.5 },
      { id: r.id, text: r.name, w, anchor: 'start', lx: right, ly: y + 21 },
      { id: r.id, text: r.name, w, anchor: 'end', lx: left, ly: y + 21 },
      { id: r.id, text: r.name, w, anchor: 'start', lx: right, ly: y - 12 },
      { id: r.id, text: r.name, w, anchor: 'end', lx: left, ly: y - 12 },
    ];
    labels.push(tries.find(clear) ?? (x + 12 + w > W - R ? tries[3] : tries[0]));
  }
  labels.sort((a, b) => a.ly - b.ly);
  for (let it = 0; it < 10; it++) for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i], b = labels[j];
    const ax0 = x0(a), bx0 = x0(b);
    const gap = Math.abs(a.ly - b.ly);
    if (ax0 < bx0 + b.w && bx0 < ax0 + a.w && gap < 16) {
      const d = (16 - gap) / 2 + 0.5;
      if (a.ly <= b.ly) { a.ly -= d; b.ly += d; } else { a.ly += d; b.ly -= d; }
    }
  }
  return { xticks, yticks, dots, arrows, labels, axisY: H - B, x0: L, x1: W - R, y0: T };
}

// Learned policies, from the paper's results (9 core tasks only): the bar is the paper's mean,
// the per-task cells its per-task means.
const LEARNED: { id: string; kind: string }[] = [
  { id: 'pi05', kind: 'VLA' }, { id: 'act', kind: 'Imitation' }, { id: 'dp', kind: 'Imitation' },
  { id: 'cqnas', kind: 'Demo RL' }, { id: 'deas', kind: 'Offline RL' }, { id: 'drq', kind: 'Demo RL' },
];
const paperGen = results.generations.find((g) => !g.hidden)!;

export interface Entry {
  id: string; name: string; maker: string | null; kind: string; harness: string; effort: string | null;
  score: number; cost: number | null; several: boolean; learned: boolean; values: { task: string; v: number }[];
}
/** One bar per model, at the highest effort it was run at in this view, best first, for the bar chart and the
 *  per-task table (11-06: the lower efforts are on the cost chart, joined to it by a line); the learned policies
 *  join them in every view they have all the tasks of (the core view; π0.5 in all three). */
export function entries(v: View): Entry[] {
  const ts = inView(v);
  const agents: Entry[] = rows(v).flatMap((r) => [r.top].map((p) => ({
    id: r.id, name: r.name, maker: r.maker, kind: 'Coding agent', harness: r.harness, effort: p.effort, score: p.score, cost: p.cost,
    several: r.points.length > 1, learned: false, values: ts.map((t) => ({ task: t, v: p.per[t] })),
  })));
  // A learned policy joins a view when it has a number for every task in it: the paper's on the core tasks, and
  // board.learned_extended on the extended ones (π0.5 only, 11-06). The core view keeps the paper's mean as is.
  const ext = board.learned_extended ?? {};
  const value = (id: string, t: string) => (core.has(t) ? paperGen.rows.find((r) => r.task === t)?.values[id]?.mean : ext[id]?.per[t]);
  const learned: Entry[] = LEARNED.filter((l) => paperGen.mean[l.id] != null && ts.every((t) => value(l.id, t) != null)).map((l) => {
    const values = ts.map((t) => ({ task: t, v: value(l.id, t)! }));
    return {
      id: l.id, name: paperGen.methods.find((m) => m.id === l.id)!.label, maker: null, kind: l.kind, harness: '', effort: null,
      score: v === 'core' ? paperGen.mean[l.id]! : values.reduce((a, x) => a + x.v, 0) / values.length, cost: null, several: false,
      learned: true, values,
    };
  });
  return [...agents, ...learned].sort((a, b) => b.score - a.score);
}
/** The tasks in a view, grouped by scene, for the per-task table's header. */
export function sceneColumns(v: View) {
  const ts = new Set(inView(v));
  return scenes.map((s) => ({ id: s.id, label: s.label, tasks: s.tasks.filter((t) => ts.has(t.id)) })).filter((s) => s.tasks.length);
}

// Bar labels on two short lines: the model family, then its version.
const LINES: Record<string, [string, string]> = {
  opus: ['Claude Opus', '5.5'], astra: ['GPT-6', 'Astra'], sol61: ['GPT-6.1', 'Sol'], sol: ['GPT-6', 'Sol'],
  terra: ['GPT-6.1', 'Terra'], kimi: ['Kimi', 'K3.1 Pro'], deepseek: ['DeepSeek', 'V4.1 Flash 1017'],
};
export function nameLines(id: string, name: string, kind = ''): [string, string] {
  if (LINES[id]) return LINES[id];
  if (kind && kind !== 'Coding agent') return [name, kind];
  const w = name.split(' ');
  return [w.slice(0, -1).join(' ') || name, w.length > 1 ? w[w.length - 1] : ''];
}
