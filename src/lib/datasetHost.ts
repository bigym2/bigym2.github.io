// Which copy of the rollout dataset this reader can reach. The viser client
// fails silently inside its iframe, so the hosts are probed before a replay
// is pointed at one. The first host is preferred and needs only to answer: an
// opaque HEAD rejects only when the host is unreachable (a block, a timeout),
// whatever its CORS. The mirrors are tried only when it cannot be reached (a
// mirror may redirect readers elsewhere back to it), and a mirror counts only
// if a real recording comes back with CORS headers, as the viser client needs.

const TIMEOUT_MS = 6000;

function reach(hosts: string[], path: string, mode: RequestMode): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  return Promise.any(hosts.map((h) =>
    fetch(`${h}/${path}`, { method: 'HEAD', mode, cache: 'no-store', signal: ctl.signal })
      .then((r) => { if (mode === 'cors' && !r.ok) throw r.status; return h; })))
    .finally(() => { clearTimeout(timer); ctl.abort(); });
}

/** The first reachable host of `bases` (the dataset, then its mirrors), or
 *  null when none is; `sample` is a recording's path within the dataset. */
export function pickHost(bases: string[], sample: string): Promise<string | null> {
  const [first, ...mirrors] = bases;
  return reach([first], 'README.md', 'no-cors')
    .catch(() => (mirrors.length ? reach(mirrors, sample, 'cors') : Promise.reject()))
    .catch(() => null);
}
