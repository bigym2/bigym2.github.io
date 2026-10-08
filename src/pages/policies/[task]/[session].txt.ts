// The same program as plain text, for reading at any size in its own tab.
import type { APIRoute, GetStaticPaths } from 'astro';
import { agent, sessionSource } from '../../../lib/data';

export const getStaticPaths = (() =>
  agent.tasks.flatMap((t) =>
    t.sessions.map((s) => ({ params: { task: t.task, session: s.id }, props: { files: s.files } })),
  )) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(sessionSource(props.files as string[]), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
