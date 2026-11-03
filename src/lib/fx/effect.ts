// ASCII / ordered-dither rendering of one image or video, drawn into a canvas laid over it.
// One settings object drives the layer and its control panel; each filter keeps its own values.

export type Filter = 'ascii' | 'dither';
export type InkTone = 'shadows' | 'highlights';
export type PaletteId = 'original' | 'meadow' | 'blue' | 'amber' | 'lavender' | 'mono';
export interface FilterSettings { mask: number; palette: PaletteId; inkTone: InkTone; strength: number; size: number; spacing: number }
export interface Settings { filter: Filter; ascii: FilterSettings; dither: FilterSettings }

export const RECOMMENDED: Record<Filter, FilterSettings> = {
  ascii: { mask: 90, palette: 'original', inkTone: 'shadows', strength: 100, size: 37, spacing: 0 },
  dither: { mask: 88, palette: 'original', inkTone: 'shadows', strength: 100, size: 15, spacing: 0 },
};
export const PALETTES: Record<Exclude<PaletteId, 'original'>, string[]> = {
  meadow: ['#2B361F', '#677D45', '#AEBA78', '#E5E1BD'],
  blue: ['#192A4D', '#326AC5', '#A2C2F1', '#EDF3FC'],
  amber: ['#3C200F', '#A74C15', '#EF9A46', '#F7E7CA'],
  lavender: ['#292144', '#6552AB', '#B3A5E4', '#F0ECFB'],
  mono: ['#151515', '#575757', '#A6A6A6', '#ECECEC'],
};
const STOPS = [0, 0.4, 0.74, 1];
const CHARS = '  .,:;-=+xX08S#&@';
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

const range = (v: number, a: number, b: number) => a + ((b - a) * v) / 100;
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x: number) => x * x * (3 - 2 * x);
const lum = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** 256-entry luminance → colour lookup through a palette's four stops. */
function lut(id: PaletteId): Uint8ClampedArray | null {
  if (id === 'original') return null;
  const stops = PALETTES[id].map(hex), out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let k = 0;
    while (k < 2 && x > STOPS[k + 1]) k++;
    const t = (x - STOPS[k]) / (STOPS[k + 1] - STOPS[k]);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * t;
  }
  return out;
}

function rgb2hsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60 < 0 ? h * 60 + 360 : h * 60, mx ? d / mx : 0, mx];
}
function hsv2rgb(h: number, s: number, v: number) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Opacity (0-1) of each mask stop: top, 42 %, bottom. The dark theme plays the dark-ground renders, where the
 *  robot is the light thing in the frame, so its veil is about two thirds as strong. */
function maskStops(v: number, dark: boolean) {
  const base = dark ? [44, 20, 50] : [54, 20, 38];
  return base.map((b) => (dark ? 0.66 : 1) * (v <= 50 ? b * Math.pow(v / 50, 1.08) : b + (100 - b) * Math.pow((v - 50) / 50, 1.08)) / 100);
}

export class EffectLayer {
  private ctx: CanvasRenderingContext2D;
  private sample = document.createElement('canvas');
  private sctx = this.sample.getContext('2d', { willReadFrequently: true })!;
  private small = document.createElement('canvas');
  private last = document.createElement('canvas');
  private fadeFrom = 0;
  private timer = 0;
  private running: HTMLVideoElement | null = null;
  private visible = true;
  private bound = new WeakSet<HTMLVideoElement>();
  dark = false;
  /** The dark theme's veil colour, the page's own ground (oklch 0.165), as 'r,g,b'. */
  darkVeil = '13,15,16';
  /** Called at the top of every draw (a sequence player advances its storyboard here). */
  prepare: (() => void) | null = null;
  // Pointer scatter (dither only): every block is a particle; a moving pointer flings the ones near it and springs
  // pull them home in about 0.7 s. Offsets and velocities per block, in block units; only moving blocks are visited.
  private parts: { w: number; h: number; ox: Float32Array; oy: Float32Array; vx: Float32Array; vy: Float32Array; live: Set<number> } | null = null;
  ptr = { x: 0, y: 0, vx: 0, vy: 0, on: false, fresh: 0 };
  private moving = false;
  private settling = false;

  constructor(private canvas: HTMLCanvasElement, private source: HTMLImageElement | HTMLVideoElement, public settings: Settings) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.request()).observe(canvas);
    new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.loop(); }).observe(canvas);
    if (source instanceof HTMLVideoElement) this.bind(source);
    else if (!source.complete) source.addEventListener('load', () => this.request());
  }

  private bind(v: HTMLVideoElement) {
    if (this.bound.has(v)) return;
    this.bound.add(v);
    v.addEventListener('play', () => { if (v === this.source) this.loop(); });
    v.addEventListener('loadeddata', () => { if (v === this.source) this.request(); });
  }

  /** Swap the source video at a cut without dropping a frame: the next frame drawn is the new video's. */
  setVideo(v: HTMLVideoElement) {
    if (v === this.source) return;
    this.bind(v);
    this.source = v;
    this.loop();
    this.draw();
  }

  /** Pointer at (x, y) in box pixels; while it moves it flings the dither blocks near it. */
  pointer(x: number, y: number) {
    const p = this.ptr;
    if (p.on) { p.vx = 0.6 * p.vx + 0.4 * (x - p.x); p.vy = 0.6 * p.vy + 0.4 * (y - p.y); }
    p.x = x; p.y = y; p.on = true; p.fresh = 2;
    const v = this.source;
    if (!(v instanceof HTMLVideoElement) || v.paused) {  // keep drawing while particles fly over a still frame
      if (this.settling) return;
      this.settling = true;
      const tick = () => { this.draw(); if (this.moving) requestAnimationFrame(tick); else this.settling = false; };
      requestAnimationFrame(tick);
    }
  }

  /** One frame of particles over the dithered blocks `o` (gw x gh, RGBA). A moving pointer stirs the blocks near
   *  it: mostly along its motion, with a swirl around it and a little outward spread. Each displaced block then
   *  springs home with its own stiffness and damping, so they settle at different times rather than as one sheet.
   *  Displaced blocks leave the dithered ground behind (groundAt) and are returned as squares to draw on top at
   *  pixel positions. */
  private scatter(o: Uint8ClampedArray, gw: number, gh: number, pix: number, groundAt: (i: number, j: number) => number[]) {
    let P = this.parts;
    if (!P || P.w !== gw || P.h !== gh) {
      const n = gw * gh;
      P = this.parts = { w: gw, h: gh, ox: new Float32Array(n), oy: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n), live: new Set() };
    }
    const rnd = (n: number, s: number) => { const h = Math.sin(n * 12.9898 + s * 78.233) * 43758.5453; return h - Math.floor(h); };
    const p = this.ptr, R = 60 / pix;  // reach about 60 px
    if (p.on && p.fresh > 0) {
      p.fresh--;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 0.6) {
        const mx = p.x / pix, my = p.y / pix, ux = p.vx / sp, uy = p.vy / sp, v = Math.min(sp, 36) / pix;
        for (let j = Math.max(0, Math.floor(my - R)); j < Math.min(gh, Math.ceil(my + R)); j++)
          for (let i = Math.max(0, Math.floor(mx - R)); i < Math.min(gw, Math.ceil(mx + R)); i++) {
            const dx = i + 0.5 - mx, dy = j + 0.5 - my, d = Math.hypot(dx, dy);
            if (d >= R) continue;
            const n = j * gw + i, fall = Math.pow(1 - d / R, 1.6), rx = dx / (d || 1), ry = dy / (d || 1);
            const side = Math.sign(rx * uy - ry * ux) || 1;  // which side of the pointer's path: swirl the opposite ways
            const a = (0.35 + 0.5 * rnd(n, 1)) * fall * v;
            P.vx[n] += ux * a + (-ry * side) * a * 0.45 + rx * a * 0.2 + (rnd(n, 2) - 0.5) * a * 0.5;
            P.vy[n] += uy * a + (rx * side) * a * 0.45 + ry * a * 0.2 + (rnd(n, 3) - 0.5) * a * 0.5;
            P.live.add(n);
          }
      }
      p.vx *= 0.8; p.vy *= 0.8;
    }
    if (!P.live.size) { this.moving = false; return [] as number[]; }
    const out: number[] = [];  // x, y (px), r, g, b per displaced block
    const moved: number[] = [];
    for (const n of P.live) {
      const k = 0.16 + 0.14 * rnd(n, 4), damp = 0.66 + 0.12 * rnd(n, 5);  // home in 0.5-0.9 s, each at its own pace
      P.vx[n] = (P.vx[n] - P.ox[n] * k) * damp; P.vy[n] = (P.vy[n] - P.oy[n] * k) * damp;
      P.ox[n] = Math.max(-22, Math.min(22, P.ox[n] + P.vx[n])); P.oy[n] = Math.max(-22, Math.min(22, P.oy[n] + P.vy[n]));
      if (Math.abs(P.ox[n]) + Math.abs(P.oy[n]) + Math.abs(P.vx[n]) + Math.abs(P.vy[n]) < 0.12) { P.ox[n] = P.oy[n] = P.vx[n] = P.vy[n] = 0; P.live.delete(n); continue; }
      moved.push(n);
    }
    for (const n of moved) {
      const q = n * 4, i = n % gw, j = Math.floor(n / gw);
      out.push(Math.round((i + P.ox[n]) * pix), Math.round((j + P.oy[n]) * pix), o[q], o[q + 1], o[q + 2]);
      const g = groundAt(i, j); o[q] = g[0]; o[q + 1] = g[1]; o[q + 2] = g[2];
    }
    this.moving = P.live.size > 0;
    return out;
  }

  /** Settings changed: cross-fade when the filter or palette moved, redraw soon. */
  update(next: Settings, fade = false) {
    if (fade) { this.last.width = this.canvas.width; this.last.height = this.canvas.height; this.last.getContext('2d')!.drawImage(this.canvas, 0, 0); this.fadeFrom = performance.now(); }
    this.settings = next;
    this.request();
  }
  request() { clearTimeout(this.timer); this.timer = window.setTimeout(() => this.draw(), 72); }

  private loop() {
    const v = this.source;
    if (!(v instanceof HTMLVideoElement) || this.running === v) return;
    this.running = v;
    const tick = () => {
      if (this.running !== v) return;  // the source moved on to another video
      if (v.paused || v.ended || !this.visible) { this.running = null; return; }
      this.draw();
      if ('requestVideoFrameCallback' in v) (v as any).requestVideoFrameCallback(tick); else requestAnimationFrame(tick);
    };
    tick();
  }

  draw() {
    if (this.prepare) this.prepare();
    const src = this.source;
    const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
    const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
    if (!sw || !sh) return;
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.6, 2048 / Math.max(box.width, box.height));
    const W = Math.round(box.width * dpr), H = Math.round(box.height * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const f = this.settings.filter, s0 = this.settings[f], s = s0.strength / 100;

    // sampling canvas: the asset cover-fitted into the box, over white, ~480 px on the long side
    const k = 480 / Math.max(box.width, box.height);
    const cw = Math.max(1, Math.round(box.width * k)), ch = Math.max(1, Math.round(box.height * k));
    if (this.sample.width !== cw || this.sample.height !== ch) { this.sample.width = cw; this.sample.height = ch; }
    const sc = Math.max(cw / sw, ch / sh);
    this.sctx.fillStyle = '#fff'; this.sctx.fillRect(0, 0, cw, ch);
    this.sctx.drawImage(src, (cw - sw * sc) / 2, (ch - sh * sc) / 2, sw * sc, sh * sc);
    const img = this.sctx.getImageData(0, 0, cw, ch), px = img.data;
    const map = lut(s0.palette);
    if (map) for (let i = 0; i < px.length; i += 4) {
      const l = Math.round(lum(px[i], px[i + 1], px[i + 2]) * 255) * 3;
      px[i] = map[l]; px[i + 1] = map[l + 1]; px[i + 2] = map[l + 2];
    }
    if (map) this.sctx.putImageData(img, 0, 0);
    const at = (x: number, y: number) => {  // x, y in box pixels
      const i = (Math.min(ch - 1, Math.max(0, Math.floor(y * k))) * cw + Math.min(cw - 1, Math.max(0, Math.floor(x * k)))) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    };
    // tonal range from ~12,000 evenly spaced samples
    const n = Math.round(Math.sqrt(12000 * cw / ch)), m = Math.round(12000 / n), Ls: number[] = [];
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const p = ((Math.floor(((j + 0.5) / m) * ch) * cw) + Math.floor(((i + 0.5) / n) * cw)) * 4;
      Ls.push(lum(px[p], px[p + 1], px[p + 2]));
    }
    Ls.sort((a, b) => a - b);
    const low = Ls[Math.floor(Ls.length * 0.08)], high = Ls[Math.floor(Ls.length * 0.92)];

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bw = box.width, bh = box.height;
    const drawMask = () => {
      const st = maskStops(s0.mask, this.dark), c = this.dark ? this.darkVeil : '255,255,255';
      const g = ctx.createLinearGradient(0, 0, 0, bh);
      g.addColorStop(0, `rgba(${c},${st[0]})`); g.addColorStop(0.42, `rgba(${c},${st[1]})`); g.addColorStop(1, `rgba(${c},${st[2]})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, bw, bh);
    };

    if (f === 'ascii') {
      ctx.imageSmoothingEnabled = true;
      if (map) ctx.drawImage(this.sample, 0, 0, bw, bh);
      else {  // the asset itself, cover-fitted at full resolution, over white
        const c2 = Math.max(bw / sw, bh / sh);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, bw, bh);
        ctx.drawImage(src, (bw - sw * c2) / 2, (bh - sh * c2) / 2, sw * c2, sh * c2);
      }
      drawMask();
      const font = Math.round(Math.min(range(s0.size, 7, 24), bw < 720 ? 22 : 24));
      ctx.font = `${font}px "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let widest = 0;
      for (const c of CHARS) widest = Math.max(widest, ctx.measureText(c).width);
      const at_ = ctx.measureText('@'), atH = (at_.actualBoundingBoxAscent + at_.actualBoundingBoxDescent) || font;
      const dx = Math.max(range(s0.spacing, 8, 24), widest * 1.08);
      const dy = Math.max(range(s0.spacing, 9, 26), atH * 1.12, font * 1.04);
      const darkInk = s0.inkTone === 'shadows', span = high - low, mix = 0.72 + 0.14 * s;
      const black = 0.22 * s, white = 1 - 0.08 * s;
      for (let y = dy / 2; y < bh; y += dy) for (let x = dx / 2; x < bw; x += dx) {
        const [r, g, b] = at(x, y), L = lum(r, g, b);
        const raw = darkInk ? 1 - L : L;
        const norm = span < 0.025 ? raw : clamp(darkInk ? (high - L) / span : (L - low) / span);
        const t = raw * (1 - mix) + norm * mix;
        const lev = clamp((t - black) / (white - black));
        const tone = lev * (1 - s) + smooth(lev) * s;
        if (tone <= 0.02) continue;
        const chr = CHARS[Math.round(tone * 16)];
        if (chr === ' ') continue;
        let [h, sat, v] = rgb2hsv(r, g, b);
        v += (1 - v) * (0.24 + 0.18 * s + 0.24 * tone);
        sat = clamp(sat * (1 + 0.16 + 0.2 * s));
        const [R, G, B] = hsv2rgb(h, sat, v);
        const a = clamp((0.12 + 0.7 * tone) * (0.72 + 0.28 * s), 0.06, 0.94);
        ctx.fillStyle = `rgba(${R | 0},${G | 0},${B | 0},${a})`;
        ctx.fillText(chr, x, y);
      }
    } else {
      const pix = Math.max(2, Math.round(Math.min(range(s0.size, 2, 9), bw < 720 ? 7 : 9)));
      const pat = Math.max(1, Math.round(range(s0.spacing, 1, 4)));
      const levels = Math.max(2, Math.round(range(s0.strength, 8, 2)));
      const blend = range(s0.strength, 0.32, 1), push = 1 + 0.06 + 0.18 * s;
      const gw = Math.ceil(bw / pix), gh = Math.ceil(bh / pix);
      if (this.small.width !== gw || this.small.height !== gh) { this.small.width = gw; this.small.height = gh; }
      const sm = this.small.getContext('2d')!, out = sm.createImageData(gw, gh), o = out.data;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        let [r, g, b] = at((i + 0.5) * pix, (j + 0.5) * pix);
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        r = y + (r - y) * push; g = y + (g - y) * push; b = y + (b - y) * push;
        const th = (BAYER[Math.floor(j / pat) % 4][Math.floor(i / pat) % 4] + 0.5) / 16;
        const q = (c: number) => {
          c = clamp(c, 0, 255);
          const sc2 = (c / 255) * (levels - 1), fl = Math.floor(sc2);
          const qq = Math.min(levels - 1, fl + (sc2 - fl > th ? 1 : 0));
          return c + ((qq / (levels - 1)) * 255 - c) * blend;
        };
        const p = (j * gw + i) * 4;
        o[p] = q(r); o[p + 1] = q(g); o[p + 2] = q(b); o[p + 3] = 255;
      }
      const gr = at(3, 3), gy0 = 0.299 * gr[0] + 0.587 * gr[1] + 0.114 * gr[2];
      const ground = gr.map((c) => gy0 + (c - gy0) * push);
      const groundAt = (i: number, j: number) => {
        const th = (BAYER[Math.floor(j / pat) % 4][Math.floor(i / pat) % 4] + 0.5) / 16;
        return ground.map((c) => {
          c = clamp(c, 0, 255);
          const sc2 = (c / 255) * (levels - 1), fl = Math.floor(sc2);
          return c + ((Math.min(levels - 1, fl + (sc2 - fl > th ? 1 : 0)) / (levels - 1)) * 255 - c) * blend;
        });
      };
      const flying = this.scatter(o, gw, gh, pix, groundAt);
      sm.putImageData(out, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.small, 0, 0, gw * pix, gh * pix);
      for (let f = 0; f < flying.length; f += 5) {  // the stirred blocks, at pixel positions
        ctx.fillStyle = `rgb(${flying[f + 2] | 0},${flying[f + 3] | 0},${flying[f + 4] | 0})`;
        ctx.fillRect(flying[f], flying[f + 1], pix, pix);
      }
      drawMask();
    }
    // cross-fade from the previous frame over 150 ms after a filter or palette change
    const age = performance.now() - this.fadeFrom;
    if (age < 150 && this.last.width) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1 - age / 150;
      ctx.drawImage(this.last, 0, 0, W, H);
      ctx.globalAlpha = 1;
      if (!(this.source instanceof HTMLVideoElement) || this.source.paused) requestAnimationFrame(() => this.draw());
    }
  }
}
