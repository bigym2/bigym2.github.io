// Shape of every file in src/data/. The build parses each file against its
// schema, so a missing field or a typo fails `pnpm build` with the path to the
// offending value instead of rendering a broken page. CONTENT.md documents
// the same fields in prose.
import { z } from 'astro/zod';

// A path under public/media, e.g. "rollouts/drawer_top_open/s1_seed620001.mp4".
const media = z.string().regex(/^[^/].*\.(mp4|webm|jpg|jpeg|png|webp|svg)$/, 'media path: relative to public/media, no leading slash');

export const site = z.object({
  title: z.string(),
  // Trailing part of the title set in the accent colour (e.g. "2.0").
  titleAccent: z.string().optional(),
  subtitle: z.string(),
  description: z.string(),
  venue: z.string().nullable(),
  authors: z.array(z.object({
    name: z.string(),
    url: z.string().url().nullable(),
    affiliations: z.array(z.number().int()),
    equal: z.boolean(),
  })).min(1),
  affiliations: z.array(z.object({ id: z.number().int(), name: z.string() })),
  logos: z.array(z.object({
    name: z.string(),
    src: z.string().startsWith('/'),
    url: z.string().url(),
    height: z.number().positive(),
  })),
  // url: null renders the link as "coming soon" instead of hiding it.
  links: z.array(z.object({
    label: z.string(),
    url: z.string().url().nullable(),
    kind: z.enum(['arxiv', 'github', 'huggingface', 'youtube', 'bilibili', 'x', 'pdf', 'docs', 'other']),
  })),
  // Background clip behind the title; keep it free of burned-in text.
  hero: z.object({ video: media, poster: media, alt: z.string() }),
  // The first scroll: what BiGym is, then the headline finding (set bold).
  lede: z.tuple([z.string(), z.string(), z.string()]),   // what it is, the finding, its limit after "but"
  // The page's closing summary, one short point per entry (the full abstract
  // is in the paper).
  summary: z.array(z.string()).min(1),
  figures: z.array(z.object({ value: z.string(), label: z.string(), note: z.string() })),
  bibtex: z.string(),
  acknowledgements: z.string(),
});

export const tasks = z.object({
  groups: z.array(z.object({ id: z.string(), label: z.string() })),
  tasks: z.array(z.object({
    id: z.string(),
    name: z.string(),
    group: z.string(),
    instruction: z.string(),
    image: media,
    // A human VR demonstration of this task, shown in the video section.
    // speed: playback rate of the clip relative to real time.
    demo: z.object({ video: media, poster: media, seed: z.number().int().optional(), speed: z.number().positive() }).optional(),
  })),
}).superRefine((d, ctx) => {
  const groups = new Set(d.groups.map((g) => g.id));
  d.tasks.forEach((t, i) => {
    if (!groups.has(t.group)) ctx.addIssue({ code: 'custom', path: ['tasks', i, 'group'], message: `unknown group "${t.group}"` });
  });
});

const cell = z.object({
  mean: z.number().min(0).max(100),
  se: z.number().min(0).nullable(),
  partial: z.boolean().default(false),
});

// One table per result generation. The scene lighting changed after the first
// results, so each generation is a complete table of its own, never merged.
// A pending method (still training in that generation) has a null mean and a
// null cell for every task not yet reported; every other method is complete.
const generation = z.object({
  id: z.string(),
  label: z.string(),
  // Kept in the data but left off the page (an earlier scene, say).
  hidden: z.boolean().default(false),
  // The caption shows under the table; the footnote, how each number was
  // measured, folds away beneath it.
  caption: z.string(),
  footnote: z.string().nullable(),
  groups: z.array(z.object({ label: z.string(), methods: z.array(z.string()) })),
  methods: z.array(z.object({
    id: z.string(),
    label: z.string(),
    sublabel: z.string().optional(),
    emphasis: z.boolean().optional(),
    short: z.string().optional(),                  // header text when the label is long
    logo: z.enum(['claude', 'openai']).optional(), // mark shown above the header
    series: z.enum(['opus', 'astra', 'sol']).optional(), // bar colour, as in the compute chart
    // The coding agent's harness, shown on hover over its header.
    harness: z.object({ name: z.string(), version: z.string(), mark: z.enum(['claude-code', 'codex']) }).optional(),
  })),
  pending: z.array(z.string()).default([]),
  rows: z.array(z.object({ task: z.string(), label: z.string(), values: z.record(z.string(), cell.nullable()) })),
  mean: z.record(z.string(), z.number().nullable()),
}).superRefine((d, ctx) => {
  const ids = d.methods.map((m) => m.id);
  const pending = (m: string) => d.pending.includes(m);
  d.rows.forEach((r, i) => ids.forEach((m) => {
    if (!(m in r.values)) ctx.addIssue({ code: 'custom', path: ['rows', i, 'values', m], message: `missing method "${m}"` });
    else if (r.values[m] === null && !pending(m)) ctx.addIssue({ code: 'custom', path: ['rows', i, 'values', m], message: `null cells only for pending methods` });
  }));
  ids.forEach((m) => {
    if (!(m in d.mean)) ctx.addIssue({ code: 'custom', path: ['mean', m], message: `missing method "${m}"` });
    else if ((d.mean[m] === null) !== pending(m)) ctx.addIssue({ code: 'custom', path: ['mean', m], message: `the mean is null exactly for pending methods` });
  });
});

export const results = z.object({ generations: z.array(generation).min(1) });

// Coding-agent sessions: each agent develops three independent sessions per
// task; each session's scored program (policy.py first, then any modules it
// imports, verbatim) and its outcome on every hidden seed.
export const agent = z.object({
  interface: z.string(),
  budget_steps: z.number().int(),
  seed_base: z.number().int(),
  agents: z.array(z.object({
    id: z.string(),
    model: z.string(),
    short: z.string(),
    harness: z.string(),
    series: z.enum(['opus', 'astra', 'sol']),
  })).min(1),
  // The agent drawn in the protocol figure.
  protocol_agent: z.string(),
  // Every other seed's 3D replay, fetched from the dataset on demand:
  // <base>/viser/<task>/<session>_seed<seed>.viser, opened with the task's
  // camera. Null until the dataset is published (only the rollouts listed per
  // session, served with the page, are then playable).
  rollouts_remote: z.object({
    base: z.string().url(),
    // Copies with the same layout on hosts reachable where the first is not
    // (Hugging Face is blocked in mainland China); the first to answer is used.
    mirrors: z.array(z.string().url()).default([]),
    cameras: z.record(z.string(), z.object({ position: z.tuple([z.number(), z.number(), z.number()]), look_at: z.tuple([z.number(), z.number(), z.number()]) })),
    // The dataset also holds each seed's code trace (trace/<task>/<session>_seed<seed>.json).
    traces: z.boolean().default(false),
  }).nullable().default(null),
  tasks: z.array(z.object({
    task: z.string(),
    sessions: z.array(z.object({
      id: z.string(),
      agent: z.string(),
      session: z.number().int().positive(),
      label: z.string(),
      success_rate: z.number().min(0).max(1),
      lines: z.number().int().positive(),
      ik: z.boolean(),                        // the scored program solves inverse kinematics
      cost_usd: z.number().nonnegative(),     // API-equivalent cost of the session
      // Paths under src/data/, policy.py first, verbatim.
      files: z.array(z.string().regex(/^policies\/.+\.py$/)).min(1),
      episodes: z.array(z.object({ seed: z.number().int(), success: z.boolean(), steps: z.number().int() })).min(1),
      // A recorded seed has a video, a 3D replay, or both.
      rollouts: z.array(z.object({
        seed: z.number().int(),
        video: media.optional(),
        poster: media.optional(),
        speed: z.number().positive().default(1),
        // Interactive 3D replay: a .viser recording under public/viser/
        // (scripts/record_viser.py) and the camera it opens with.
        viser: z.object({
          file: z.string().regex(/^[^/].*\.viser$/, 'path under public/viser, no leading slash'),
          camera: z.object({ position: z.tuple([z.number(), z.number(), z.number()]), look_at: z.tuple([z.number(), z.number(), z.number()]) }),
        }).optional(),
      })),
    })).min(1),
  })),
}).superRefine((d, ctx) => {
  const ids = new Set(d.agents.map((a) => a.id));
  if (!ids.has(d.protocol_agent)) ctx.addIssue({ code: 'custom', path: ['protocol_agent'], message: `unknown agent "${d.protocol_agent}"` });
  d.tasks.forEach((t, i) => t.sessions.forEach((s, j) => {
    const at = ['tasks', i, 'sessions', j];
    if (!ids.has(s.agent)) ctx.addIssue({ code: 'custom', path: [...at, 'agent'], message: `unknown agent "${s.agent}"` });
    if (!s.files[0].endsWith('/policy.py')) ctx.addIssue({ code: 'custom', path: [...at, 'files', 0], message: 'policy.py comes first' });
    const seeds = new Set(s.episodes.map((e) => e.seed));
    s.rollouts.forEach((r, k) => {
      if (!seeds.has(r.seed)) ctx.addIssue({ code: 'custom', path: [...at, 'rollouts', k, 'seed'], message: `seed ${r.seed} is not among the session's episodes` });
      if (!r.video && !r.viser) ctx.addIssue({ code: 'custom', path: [...at, 'rollouts', k], message: 'a rollout needs a video or a viser replay' });
      if (!r.video !== !r.poster) ctx.addIssue({ code: 'custom', path: [...at, 'rollouts', k], message: 'video and poster come together' });
    });
    const rate = s.episodes.filter((e) => e.success).length / s.episodes.length;
    if (Math.abs(rate - s.success_rate) > 1e-6) ctx.addIssue({ code: 'custom', path: [...at, 'success_rate'], message: `success_rate ${s.success_rate} disagrees with episodes (${rate})` });
  }));
});

// Coding agents against inference compute. Each cell: the success (%) of each
// development session's frozen program on 100 hidden seeds, and the
// per-session mean API-equivalent cost and input tokens (cache included). Totals are stated as
// reported and checked against the cells, allowing for their rounding.
const usage = z.object({
  sessions: z.array(z.number().int().min(0).max(100)).min(1),
  usd: z.number().positive(),
  tokens_m: z.number().positive(),
});

export const compute = z.object({
  budget_steps: z.number().int().positive(),
  sessions_per_task: z.number().int().positive(),
  quote: z.object({ text: z.string(), author: z.string(), title: z.string(), url: z.string().url(), date: z.string() }),
  footnote: z.string().nullable(),
  agents: z.array(z.object({ id: z.string(), model: z.string(), short: z.string(), harness: z.string(), effort: z.string() })).min(2),
  rows: z.array(z.object({ task: z.string(), label: z.string(), values: z.record(z.string(), usage) })).min(1),
  totals: z.record(z.string(), z.object({ mean: z.number(), usd: z.number(), tokens_m: z.number() })),
}).superRefine((d, ctx) => {
  const n = d.sessions_per_task;
  d.agents.forEach(({ id }) => {
    const cells = d.rows.map((r, i) => {
      const c = r.values[id];
      if (!c) ctx.addIssue({ code: 'custom', path: ['rows', i, 'values', id], message: `missing agent "${id}"` });
      else if (c.sessions.length !== n) ctx.addIssue({ code: 'custom', path: ['rows', i, 'values', id, 'sessions'], message: `expected ${n} sessions` });
      return c;
    }).filter(Boolean) as z.infer<typeof usage>[];
    const t = d.totals[id];
    if (!t) { ctx.addIssue({ code: 'custom', path: ['totals', id], message: `missing agent "${id}"` }); return; }
    const all = cells.flatMap((c) => c.sessions);
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    if (Math.abs(mean - t.mean) > 0.05) ctx.addIssue({ code: 'custom', path: ['totals', id, 'mean'], message: `${t.mean} disagrees with the sessions (${mean.toFixed(2)})` });
    // Per-cell values are rounded to 0.1 $ and 1 M tokens.
    const sum = (k: 'usd' | 'tokens_m') => n * cells.reduce((a, c) => a + c[k], 0);
    const slack = (step: number) => (step / 2) * n * cells.length + 0.5;
    if (Math.abs(sum('usd') - t.usd) > slack(0.1)) ctx.addIssue({ code: 'custom', path: ['totals', id, 'usd'], message: `${t.usd} disagrees with the cells (${sum('usd').toFixed(1)})` });
    if (Math.abs(sum('tokens_m') - t.tokens_m) > slack(1)) ctx.addIssue({ code: 'custom', path: ['totals', id, 'tokens_m'], message: `${t.tokens_m} disagrees with the cells (${sum('tokens_m')})` });
  });
});

export type Site = z.infer<typeof site>;
export type Tasks = z.infer<typeof tasks>;
export type Results = z.infer<typeof results>;
export type Agent = z.infer<typeof agent>;
export type Compute = z.infer<typeof compute>;
