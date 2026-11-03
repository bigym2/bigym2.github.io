// The hero film: task clips and the Contact shot played back to back on two alternating <video> elements, so
// every cut lands on a clip that is already loaded and running (no loop seek, no stall). Each round plays one
// pair of task clips in a random order, the pairs taking turns, then Contact. The look is fixed for the visit.
// Every clip comes in two renders, over a light ground and over a dark one, and plays in the page's theme.
import { EffectLayer, RECOMMENDED, PALETTES, type PaletteId, type Settings } from './effect';

const PAIRS: [string, string][] = [['plate', 'cup'], ['cupboard', 'blocks'], ['reach', 'dishwasher']];
const LEAD = 0.15;  // s: the next clip starts this long before the current one ends
export type Clips = Record<string, { light: string; dark: string }>;

/** The hero's look: ordered dither at the tuned values, in one palette (the clips' own colours included) drawn
 *  at random for this page load. */
export function heroSettings(): Settings {
  const ids: PaletteId[] = ['original', ...(Object.keys(PALETTES) as PaletteId[])];
  const palette = ids[Math.floor(Math.random() * ids.length)];
  const fx = { mask: 88, strength: 76, size: 5, spacing: 0, palette };
  return { filter: 'dither', ascii: { ...RECOMMENDED.ascii, ...fx }, dither: { ...RECOMMENDED.dither, ...fx } };
}

export class Sequence {
  private front: HTMLVideoElement;
  private back: HTMLVideoElement;
  private k = 0;
  private j = 0;
  private preroll = false;
  private rounds: string[][] = [];
  private pairs: [string, string][];
  readonly layer: EffectLayer;

  constructor(videos: HTMLVideoElement[], canvas: HTMLCanvasElement, private urls: Clips, private paused: boolean, private dark: boolean) {
    [this.front, this.back] = videos;
    this.pairs = PAIRS.filter((p) => p.every((c) => c in urls));
    this.load(this.front, this.clip(0, 0));
    this.load(this.back, this.clip(...this.after(0, 0)));
    this.layer = new EffectLayer(canvas, this.front, heroSettings());
    this.layer.dark = dark;
    this.front.addEventListener('loadeddata', () => { if (!this.paused) this.front.play().catch(() => {}); }, { once: true });
    const tick = () => { this.tick(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  private round(k: number) {
    while (this.rounds.length <= k) {
      const pair = [...this.pairs[this.rounds.length % this.pairs.length]];
      if (Math.random() < 0.5) pair.reverse();
      this.rounds.push([...pair, 'contact']);
    }
    return this.rounds[k];
  }
  private clip(k = this.k, j = this.j) { return this.round(k)[j]; }
  private after(k: number, j: number): [number, number] { return j < 2 ? [k, j + 1] : [k + 1, 0]; }
  private url(clip: string) { return this.urls[clip][this.dark ? 'dark' : 'light']; }
  private load(v: HTMLVideoElement, clip: string, at = 0) {
    v.pause();
    const u = this.url(clip);
    if (v.dataset.src !== u) { v.src = u; v.dataset.src = u; }
    v.currentTime = at;
  }
  /** Every animation frame: start the next clip LEAD s early, cut when the current one is done. */
  private tick() {
    const f = this.front, d = f.duration;
    if (this.paused || !d || !isFinite(d)) return;
    if (!this.preroll && f.currentTime >= d - LEAD) { this.preroll = true; this.back.play().catch(() => {}); }
    if (this.preroll && (f.ended || f.currentTime >= d - 0.01)) this.cut();
  }
  private cut() {
    const old = this.front;
    this.front = this.back; this.back = old;
    [this.k, this.j] = this.after(this.k, this.j);
    this.preroll = false;
    if (this.front.paused && !this.paused) this.front.play().catch(() => {});
    this.layer.setVideo(this.front);  // the next frame drawn is the new clip's
    this.load(old, this.clip(...this.after(this.k, this.j)));
  }
  /** The page's theme changed: carry on from the same moment in the other render (the canvas holds the last
   *  frame while it loads), and have the next clip waiting in that render too. */
  setDark(dark: boolean) {
    if (dark === this.dark) return;
    this.dark = dark;
    this.layer.dark = dark;
    const f = this.front, t = f.currentTime;
    this.preroll = false;
    this.load(f, this.clip(), t);
    if (!this.paused) f.play().catch(() => {});
    this.load(this.back, this.clip(...this.after(this.k, this.j)));
    this.layer.request();
  }
  setPaused(p: boolean) {
    this.paused = p;
    if (p) { this.front.pause(); this.back.pause(); this.preroll = false; this.back.currentTime = 0; }
    else this.front.play().catch(() => {});
  }
}
