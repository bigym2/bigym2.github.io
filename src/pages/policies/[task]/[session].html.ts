// One pre-highlighted HTML fragment per session's program (policy.py and
// the modules it imports). The explorer
// fetches these on demand instead of shipping every program in the page.
import type { APIRoute, GetStaticPaths } from 'astro';
import { agent, sessionSource } from '../../../lib/data';
import { highlightPython } from '../../../lib/highlight';

export const getStaticPaths = (() =>
  agent.tasks.flatMap((t) =>
    t.sessions.map((s) => ({ params: { task: t.task, session: s.id }, props: { files: s.files } })),
  )) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) =>
  new Response(await highlightPython(sessionSource(props.files as string[])), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
