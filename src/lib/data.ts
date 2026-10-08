// Loads and validates src/data/*.json once per build. Every page and
// component imports from here, never from the JSON files directly.
import { existsSync, readFileSync } from 'node:fs';
import type { z } from 'astro/zod';
import * as schema from './schema';
import siteJson from '../data/site.json';
import tasksJson from '../data/tasks.json';
import resultsJson from '../data/results.json';
import agentJson from '../data/agent.json';
import computeJson from '../data/compute.json';

// Builds run from the project root (pnpm dev / pnpm build).
const root = `${process.cwd()}/`;

function parse<T extends z.ZodTypeAny>(name: string, s: T, value: unknown): z.infer<T> {
  const r = s.safeParse(value);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  src/data/${name} → ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid content in src/data/${name}:\n${lines.join('\n')}`);
  }
  return r.data;
}

export const site = parse('site.json', schema.site, siteJson);
export const tasks = parse('tasks.json', schema.tasks, tasksJson);
export const results = parse('results.json', schema.results, resultsJson);
export const agent = parse('agent.json', schema.agent, agentJson);
export const compute = parse('compute.json', schema.compute, computeJson);

// Cross-file checks: every task id and every media file must exist.
const problems: string[] = [];
const taskIds = new Set(tasks.tasks.map((t) => t.id));
results.generations.forEach((g) => g.rows.forEach((r) => taskIds.has(r.task) || problems.push(`results.json (${g.id}): unknown task "${r.task}"`)));
agent.tasks.forEach((t) => taskIds.has(t.task) || problems.push(`agent.json: unknown task "${t.task}"`));
compute.rows.forEach((r) => taskIds.has(r.task) || problems.push(`compute.json: unknown task "${r.task}"`));

const mediaPaths = [
  site.hero.video, site.hero.poster,
  ...tasks.tasks.flatMap((t) => [t.image, ...(t.demo ? [t.demo.video, t.demo.poster] : [])]),
  ...agent.tasks.flatMap((t) => t.sessions.flatMap((s) => s.rollouts.flatMap((r) => (r.video && r.poster ? [r.video, r.poster] : [])))),
];
// With PUBLIC_MEDIA_BASE set, media is served from elsewhere and not checked here.
if (!import.meta.env.PUBLIC_MEDIA_BASE) {
  mediaPaths.forEach((p) => existsSync(`${root}public/media/${p}`) || problems.push(`missing public/media/${p}`));
}
site.logos.forEach((l) => existsSync(`${root}public${l.src}`) || problems.push(`missing public${l.src}`));
agent.tasks.forEach((t) => t.sessions.forEach((s) => {
  s.files.forEach((f) => existsSync(`${root}src/data/${f}`) || problems.push(`missing src/data/${f}`));
  s.rollouts.forEach((r) => {
    if (r.viser && !existsSync(`${root}public/viser/${r.viser.file}`)) problems.push(`missing public/viser/${r.viser.file}`);
  });
}));
if (agent.tasks.some((t) => t.sessions.some((s) => s.rollouts.some((r) => r.viser)))
    && !existsSync(`${root}public/viser-client/index.html`)) {
  problems.push('missing public/viser-client/index.html (run viser-build-client, see CONTENT.md)');
}
if (problems.length) throw new Error(`Content problems:\n  ${problems.join('\n  ')}`);

export const taskById = new Map(tasks.tasks.map((t) => [t.id, t]));

export function policySource(path: string): string {
  return readFileSync(`${root}src/data/${path}`, 'utf8');
}

/** A session's program as one listing: policy.py, then each module it imports
 *  under a divider naming the file. */
export function sessionSource(files: string[]): string {
  return files.map((f, i) => {
    const src = policySource(f).replace(/\n+$/, '\n');
    return i === 0 ? src : `\n# ${'─'.repeat(8)} ${f.split('/').pop()} ${'─'.repeat(8)}\n\n${src}`;
  }).join('');
}

export const agentById = new Map(agent.agents.map((a) => [a.id, a]));

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** URL for a file under public/media (or under PUBLIC_MEDIA_BASE when set). */
export function media(path: string): string {
  const external = import.meta.env.PUBLIC_MEDIA_BASE as string | undefined;
  return external ? `${external.replace(/\/$/, '')}/${path}` : `${base}/media/${path}`;
}

/** URL of the static viser player replaying a recording under public/viser. */
export function viserPlayer(file: string, camera: { position: number[]; look_at: number[] }): { client: string; recording: string; query: string } {
  return {
    client: `${base}/viser-client/index.html`,
    recording: `${base}/viser/${file}`,
    query: `&initialCameraPosition=${camera.position.join(',')}&initialCameraLookAt=${camera.look_at.join(',')}`,
  };
}

/** URL of a rollout's code trace under public/codetrace, or null when it has none. */
export function codeTrace(task: string, session: string, seed: number): string | null {
  const file = `codetrace/${task}/${session}_seed${seed}.json`;
  return existsSync(`${root}public/${file}`) ? `${base}/${file}` : null;
}

/** URL for any other file under public/, given with a leading slash. */
export function asset(path: string): string {
  return `${base}${path}`;
}
