// The 3D replays' player (its playback bar and panels) follows the page's
// light or dark theme: viser's static client switches to dark on `?darkMode`.
// Each player iframe keeps its theme-free address in data-viser.
const dark = () => document.documentElement.dataset.theme === 'dark';
export const themed = (src: string) => (dark() ? `${src}&darkMode` : src);

// On a theme switch, players already open reload in the other scheme.
let watching = false;
export function followTheme() {
  if (watching) return;
  watching = true;
  new MutationObserver(() => {
    document.querySelectorAll<HTMLIFrameElement>('iframe[data-viser]').forEach((f) => {
      const next = themed(f.dataset.viser!);
      if (f.getAttribute('src') && f.getAttribute('src') !== next) f.src = next;
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

// Starting a player parses a 2.8 MB page and sets up WebGL on this page's own
// thread; started mid-scroll, that drops a frame. So it waits for the scroll
// to rest, then for an idle moment.
export function whenScrollRests(fn: () => void) {
  let timer = 0;
  const idle = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 1));
  const go = () => { removeEventListener('scroll', on); idle(fn, { timeout: 800 }); };
  const on = () => { clearTimeout(timer); timer = window.setTimeout(go, 180); };
  addEventListener('scroll', on, { passive: true });
  on();
}
