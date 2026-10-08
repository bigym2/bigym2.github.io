// A full-screen button for a rollout player. It fills the screen with the
// player's frame, so whatever the frame shows (video or 3D replay) goes with
// it, and the 3D iframe is never moved or reloaded.
//
// Where the element Fullscreen API exists (desktop, Android, iPad) the frame
// goes native full screen. iPhone Safari has none, so there the frame is
// pinned over the page instead (.fs-pseudo in global.css) and the button
// turns into a close button.

const svg = (d: string) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const icons = {
  expand: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  collapse: svg('<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
};

const native = () => !!document.fullscreenEnabled && typeof HTMLElement.prototype.requestFullscreen === 'function';

export function attachFullscreen(frame: HTMLElement) {
  if (frame.querySelector(':scope > .fs-btn')) return;
  frame.dataset.fsHost = '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fs-btn';
  frame.append(btn);

  let pseudo = false;
  let lifted: HTMLElement | null = null;
  let holder: HTMLElement | null = null;
  let scrollY0 = 0;
  let inner: Window | null = null;

  const paint = () => {
    const on = pseudo || document.fullscreenElement === frame;
    btn.innerHTML = pseudo ? icons.close : on ? icons.collapse : icons.expand;
    btn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    btn.title = on ? 'Exit full screen' : 'Full screen';
  };

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitPseudo(); };

  function enterPseudo() {
    if (pseudo) return;
    pseudo = true;
    scrollY0 = scrollY;
    // The frame leaves the flow; a stand-in of the same size keeps the page
    // beneath from reflowing (and the scroll position from shifting).
    const r = frame.getBoundingClientRect();
    const cs = getComputedStyle(frame);
    holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.style.cssText = `height:${r.height}px;grid-column:${cs.gridColumn};grid-row:${cs.gridRow};margin:${cs.margin}`;
    frame.before(holder);
    // The section's scroll-in leaves a translate (and, while it settles,
    // will-change and opacity) on its direct child. Either one would anchor a
    // fixed descendant to that child, or trap it under the sticky nav, so the
    // child drops them while the player covers the screen.
    lifted = frame.closest<HTMLElement>('.section > *');
    lifted?.classList.add('fs-lift');
    frame.classList.add('fs-pseudo');
    document.documentElement.classList.add('fs-lock');
    document.addEventListener('keydown', onKey);
    // After a touch on the 3D view the keys go to the (same-origin) replay.
    try { inner = frame.querySelector('iframe')?.contentWindow ?? null; inner?.addEventListener('keydown', onKey); } catch { inner = null; }
    paint();
  }

  function exitPseudo() {
    if (!pseudo) return;
    pseudo = false;
    frame.classList.remove('fs-pseudo');
    lifted?.classList.remove('fs-lift');
    holder?.remove();
    lifted = holder = null;
    document.documentElement.classList.remove('fs-lock');
    document.removeEventListener('keydown', onKey);
    try { inner?.removeEventListener('keydown', onKey); } catch {}
    inner = null;
    if (scrollY !== scrollY0) scrollTo({ top: scrollY0, behavior: 'instant' });
    paint();
  }

  btn.addEventListener('click', () => {
    if (pseudo) return exitPseudo();
    if (document.fullscreenElement === frame) { document.exitFullscreen().catch(() => {}); return; }
    if (native()) frame.requestFullscreen().catch(enterPseudo);
    else enterPseudo();
  });
  document.addEventListener('fullscreenchange', paint);
  paint();
}
