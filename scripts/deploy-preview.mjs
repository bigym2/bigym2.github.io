// Build the site and deploy it to the password-gated Cloudflare Pages preview
// (bigym2-preview; see functions/_middleware.ts). With --share <dir>, the
// preview also carries that folder's X thread draft at /share/: each post's
// text from its thread.md, with the media it names; a thread_<name>.md beside
// it (another version) goes in a column alongside. Those files are copied
// into dist/ only here, never into the repository, so the GitHub Pages build
// (the public site) never has them.
//
//   node scripts/deploy-preview.mjs --share ~/Desktop/bigym_x_launch/x_thread
//
// --ref <commit> builds that commit in a temporary worktree instead of the
// working tree, so uncommitted work stays off the preview; --no-build reuses
// dist/ as it is; --dry writes dist/share/ and stops.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i < 0 ? null : args[i + 1]; };
const repo = resolve(import.meta.dirname, '..');
const darks = new Set(); // media that have a dark variant in alt_dark/
const vers = new Map(); // media file -> content hash, the ?v= on its URL
const ref = opt('--ref');
const root = ref ? join(tmpdir(), `bigym2-deploy-${process.pid}`) : repo;
const dist = join(root, 'dist');
const run = (cmd, a, cwd = root) => execFileSync(cmd, a, { cwd, stdio: 'inherit' });

if (ref) {
  run('git', ['worktree', 'add', '--detach', root, ref], repo);
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
  process.on('exit', () => execFileSync('git', ['worktree', 'remove', '--force', root], { cwd: repo }));
}
if (!flag('--no-build') || ref) run(join(repo, 'node_modules/.bin/astro'), ['build']);
rmSync(join(dist, 'share'), { recursive: true, force: true });

const shareDir = opt('--share')?.replace(/^~(?=\/|$)/, homedir());
if (shareDir) writeShare(resolve(shareDir));
if (flag('--dry')) process.exit(0);
run('wrangler', ['pages', 'deploy', 'dist', '--project-name', 'bigym2-preview', '--branch', 'main', '--commit-dirty=true']);

function writeShare(dir) {
  // thread.md, then any other version of the draft (thread_<name>.md) by name;
  // each is a column of its own.
  const files = readdirSync(dir).filter((f) => /^thread(_[\w-]+)?\.md$/.test(f))
    .sort((a, b) => (a === 'thread.md' ? -1 : b === 'thread.md' ? 1 : a.localeCompare(b)));
  if (!files.length) throw new Error(`no thread.md in ${dir}`);
  const threads = files.map((file) => {
    const md = readFileSync(join(dir, file), 'utf8');
    return { file, title: md.match(/^# (.+)$/m)?.[1] ?? file, posts: parsePosts(md) };
  });
  const out = join(dist, 'share');
  mkdirSync(out, { recursive: true });
  const named = [...new Set(threads.flatMap((t) => t.posts.flatMap((p) => p.media)))];
  for (const f of named) {
    const src = join(dir, f);
    if (!existsSync(src)) throw new Error(`${f}: named in a thread file but not in ${dir}`);
    // Cloudflare Pages refuses any file over 25 MiB.
    if (statSync(src).size > 25 * 2 ** 20) throw new Error(`${f}: over the 25 MiB Pages limit; compress it first`);
    copyFileSync(src, join(out, basename(f)));
    // The file keeps its name across versions, so the page asks for it by
    // content (?v=hash): a browser holding an older copy fetches the new one.
    vers.set(f, createHash('sha1').update(readFileSync(src)).digest('hex').slice(0, 10));
    // A dark variant, if alt_dark/ has one, goes along as a link.
    const dark = join(dir, 'alt_dark', basename(f).replace(/(\.[^.]+)$/, '_dark$1'));
    if (existsSync(dark)) { copyFileSync(dark, join(out, basename(dark))); darks.add(basename(f)); }
    // A poster from a third of the way in: the first frame of a clip is
    // often a fade from black or white.
    if (isVideo(f)) {
      const d = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString();
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(d / 3), '-i', src, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4', join(out, poster(f))]);
    }
  }
  writeFileSync(join(out, 'index.html'), page(threads));
  console.log(`share: ${threads.map((t) => `${t.file} (${t.posts.length} posts)`).join(', ')}, ${named.length} files → dist/share/`);
}

// One post per "## n/N · ..." section: its first fenced block is the text,
// and the backticked names on its 素材 line are the media. A section headed
// otherwise (a draft for someone else to post, say) is shown under its
// heading, without the thread's 280 limit.
function parsePosts(md) {
  return md.split(/^## /m).slice(1).map((sec) => {
    const n = sec.match(/^(\d+\/\d+)/)?.[1] ?? sec.split('\n')[0].trim();
    const text = sec.match(/```\n([\s\S]*?)\n```/)?.[1] ?? '';
    const line = sec.split('\n').find((l) => l.startsWith('素材')) ?? '';
    const media = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    return { n, text, media };
  });
}

// X's weighted length: a link counts 23, and anything past the Latin, Greek,
// Cyrillic and general punctuation ranges (CJK, emoji) counts 2.
function weight(text) {
  let n = 0;
  for (const ch of text.replace(/https?:\/\/\S+/g, 'x'.repeat(23))) {
    const c = ch.codePointAt(0);
    n += c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037) ? 1 : 2;
  }
  return n;
}

function isVideo(f) { return /\.(mp4|webm|mov)$/i.test(f); }
function poster(f) { return basename(f).replace(/\.[^.]+$/, '.poster.jpg'); }

function page(threads) {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const media = (f) => {
    const v = vers.has(f) ? `?v=${vers.get(f)}` : '';
    const src = encodeURI(f) + v;
    const view = isVideo(f)
      ? `<video src="${src}" poster="${encodeURI(poster(f))}${v}" controls playsinline preload="none"></video>`
      : `<a href="${src}"><img src="${src}" alt="${esc(f)}" /></a>`;
    const dark = darks.has(basename(f)) ? `<a href="${encodeURI(basename(f).replace(/(\.[^.]+)$/, '_dark$1'))}">Dark version</a>` : '';
    return `<figure>${view}<figcaption><span>${esc(f)}</span><span class="links">${dark}<a href="${src}" download>Download</a></span></figcaption></figure>`;
  };
  const post = (p, id) => {
    const w = weight(p.text);
    const numbered = /^\d+\/\d+$/.test(p.n);
    return `
    <article>
      <header><span class="n">${esc(p.n)}</span><span class="len${w > 280 && numbered ? ' over' : ''}">${numbered ? `${w} / 280` : `${w} characters`}</span><button type="button" data-copy="${id}">Copy text</button></header>
      <p class="text" id="t${id}">${esc(p.text)}</p>
      ${p.media.length ? `<div class="media${p.media.length > 1 ? ' two' : ''}">${p.media.map(media).join('')}</div>` : ''}
    </article>`;
  };
  const many = threads.length > 1;
  const column = (t, ti) => `
  <section class="thread">${many ? `
    <div class="thead"><h2>${esc(t.title)}</h2><span>${esc(t.file)} · ${t.posts.length} posts</span></div>` : ''}${t.posts.map((p, i) => post(p, `${ti}-${i}`)).join('')}
  </section>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>X thread draft · BiGym 2.0</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<style>
  :root {
    --paper: oklch(0.985 0.003 245); --paper-2: oklch(0.962 0.005 245); --ink: oklch(0.21 0.012 245);
    --ink-2: oklch(0.43 0.012 245); --ink-3: oklch(0.58 0.01 245); --rule: oklch(0.885 0.006 245);
    --accent: oklch(0.52 0.13 245); --warn: oklch(0.55 0.19 25); color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: oklch(0.165 0.004 245); --paper-2: oklch(0.2 0.006 245); --ink: oklch(0.93 0.004 245);
      --ink-2: oklch(0.76 0.008 245); --ink-3: oklch(0.6 0.008 245); --rule: oklch(0.29 0.006 245);
      --accent: oklch(0.74 0.11 240); --warn: oklch(0.72 0.16 25); color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.55 'Hanken Grotesk Variable', 'Hanken Grotesk', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  main { width: min(100% - 2rem, 40rem); margin: 0 auto; padding: 2.5rem 0 4rem; }
  main.many { width: min(100% - 2rem, 84rem); }
  .threads { display: grid; gap: 2.5rem; }
  @media (min-width: 60rem) { main.many .threads { grid-template-columns: repeat(${threads.length}, minmax(0, 1fr)); } }
  .thread { min-width: 0; }
  .thead { position: sticky; top: 0; z-index: 1; display: flex; align-items: baseline; gap: 0.75rem; padding: 0.75rem 0; background: var(--paper); }
  .thead h2 { margin: 0; font-size: 1.125rem; }
  .thead span { color: var(--ink-3); font-size: 0.8125rem; }
  .top { margin-bottom: 2rem; }
  .top a { color: var(--accent); text-decoration: none; font-size: 0.875rem; }
  h1 { margin: 0.5rem 0 0.4rem; font-size: 1.75rem; line-height: 1.2; letter-spacing: -0.01em; }
  .note { margin: 0; color: var(--ink-2); font-size: 0.9375rem; }
  article { padding: 1.5rem 0; border-top: 1px solid var(--rule); }
  article header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.6rem; font-size: 0.8125rem; color: var(--ink-3); }
  .n { font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
  .len { font-variant-numeric: tabular-nums; }
  .len.over { color: var(--warn); font-weight: 700; }
  button { margin-left: auto; font: inherit; color: var(--ink-2); background: var(--paper-2); border: 1px solid var(--rule); border-radius: 999px; padding: 0.3rem 0.8rem; cursor: pointer; }
  button:active { scale: 0.96; }
  .text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .media { display: grid; gap: 0.75rem; margin-top: 1rem; }
  .media.two { grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
  figure { margin: 0; }
  video, img { display: block; width: 100%; height: auto; border-radius: 10px; background: var(--paper-2); box-shadow: 0 0 0 1px var(--rule); }
  figcaption { display: flex; gap: 0.75rem; justify-content: space-between; margin-top: 0.4rem; font-size: 0.8125rem; color: var(--ink-3); }
  figcaption span { overflow-wrap: anywhere; }
  figcaption a { color: var(--accent); text-decoration: none; }
  .links { display: flex; gap: 0.75rem; flex: none; }
</style>
</head>
<body>
<main${many ? ' class="many"' : ''}>
  <div class="top">
    <a href="/">← BiGym 2.0 project page</a>
    <h1>X thread draft</h1>
    <p class="note">Draft posts and media for the launch thread, in posting order${many ? ', one column per version of the draft' : ''}. Only on this preview; the public project page does not include this folder. Lengths are X's weighted count (a link counts 23).</p>
  </div>
  <div class="threads">${threads.map(column).join('')}
  </div>
</main>
<script>
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(document.getElementById('t' + b.dataset.copy).textContent); b.textContent = 'Copied'; }
    catch { b.textContent = 'Select and copy'; }
    setTimeout(() => { b.textContent = 'Copy text'; }, 1500);
  });
</script>
</body>
</html>
`;
}
