// Password gate for the private Cloudflare Pages preview (bigym2-preview).
// Every request, pages and assets alike, first passes the browser's own
// sign-in prompt (HTTP Basic auth); any user name works, the password is the
// project's PREVIEW_PASSWORD secret:
//
//   npx wrangler pages secret put PREVIEW_PASSWORD --project-name bigym2-preview
//
// Without that secret the site answers nothing, so a deploy before the
// password is set cannot go public by accident. GitHub Pages ignores this
// directory; once the site is meant to be public, deploy it there instead.

interface Env { PREVIEW_PASSWORD?: string }

const deny = (status: number, body: string) => new Response(body, {
  status,
  headers: {
    'WWW-Authenticate': 'Basic realm="BiGym 2.0 preview", charset="UTF-8"',
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
  },
});

// Constant-time comparison, so the answer's timing says nothing about how
// much of a guess was right.
function same(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// One "bytes=a-b" range (the only kind a media element asks for) as a 206;
// anything else, and every non-200, passes through as it came.
async function ranged(request: Request, res: Response) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range')?.trim() ?? '');
  if (res.status !== 200 || !res.body || !m || (m[1] === '' && m[2] === '')) {
    const out = new Response(res.body, res);
    if (res.status === 200) out.headers.set('Accept-Ranges', 'bytes');
    return out;
  }
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  const headers = new Headers(res.headers);
  headers.set('Accept-Ranges', 'bytes');
  if (start >= size || start > end) {
    headers.set('Content-Range', `bytes */${size}`);
    headers.delete('Content-Length');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(buf.slice(start, end + 1), { status: 206, headers });
}

export const onRequest = async ({ request, env, next }: { request: Request; env: Env; next: () => Promise<Response> }) => {
  const password = env.PREVIEW_PASSWORD;
  if (!password) return new Response('Preview not configured.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Basic ')) return deny(401, 'Sign in to view the BiGym 2.0 preview.');
  let given = '';
  try { given = atob(auth.slice(6)).split(':').slice(1).join(':'); } catch { return deny(401, 'Sign in to view the BiGym 2.0 preview.'); }
  if (!same(given, password)) return deny(401, 'Wrong password.');
  const res = await next();
  // Assets behind a Function come back whole (200) even to a Range request,
  // and a video the browser cannot fetch by range cannot be scrubbed past
  // what it has loaded; answer the range here.
  const out = await ranged(request, res);
  // Out of shared caches (which would serve the page without the prompt);
  // the reader's own browser may still keep the large media.
  const cc = out.headers.get('Cache-Control');
  out.headers.set('Cache-Control', !cc ? 'private' : /\bpublic\b/.test(cc) ? cc.replace(/\bpublic\b/, 'private') : `private, ${cc}`);
  return out;
};
