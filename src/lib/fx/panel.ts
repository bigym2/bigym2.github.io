// Control panel for an EffectLayer: every change applies live; one settings object, one set of
// values per filter, and a reset to the recommended values of the filter in view.
import { PALETTES, RECOMMENDED, type EffectLayer, type Filter, type FilterSettings, type PaletteId, type Settings } from './effect';

const SWATCH_IDS: PaletteId[] = ['original', 'meadow', 'blue', 'amber', 'lavender', 'mono'];

export function mountPanel(host: HTMLElement, layer: EffectLayer, crop: () => string) {
  let st: Settings = structuredClone(layer.settings);
  const cur = () => st[st.filter];
  const apply = (fade = false) => layer.update(structuredClone(st), fade);

  host.classList.add('fxpanel');
  host.innerHTML = '';
  const row = (label: string, body: HTMLElement, cls = '') => {
    const r = document.createElement('div'); r.className = `fxrow ${cls}`;
    const l = document.createElement('span'); l.className = 'fxlab'; l.textContent = label;
    r.append(l, body); host.append(r); return r;
  };
  const slider = (key: 'mask' | 'strength' | 'size' | 'spacing', pct = false) => {
    const wrap = document.createElement('div'); wrap.className = 'fxslider';
    const range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1';
    range.id = `fx-${key}`;
    const num = document.createElement('input'); num.type = 'number'; num.min = '0'; num.max = '100'; num.className = 'fxnum';
    num.id = `fx-${key}-n`; num.setAttribute('aria-label', key);
    const mark = document.createElement('i'); mark.className = 'fxsnap';
    const unit = document.createElement('span'); unit.className = 'fxunit'; unit.textContent = pct ? '%' : '';
    const track = document.createElement('div'); track.className = 'fxtrack'; track.append(range, mark);
    wrap.append(track, num, unit);
    const set = (v: number, live = true) => {
      v = Math.round(Math.min(100, Math.max(0, v)));
      if (Math.abs(v - 50) <= 2) v = 50;  // snap to the middle
      (cur() as any)[key] = v; range.value = String(v); num.value = String(v);
      track.style.setProperty('--v', `${v}%`);
      if (live) { apply(); refreshOut(); }
    };
    range.addEventListener('input', () => set(+range.value));
    num.addEventListener('change', () => set(+num.value));
    return { el: wrap, sync: () => set((cur() as any)[key], false) };
  };
  const tabs = (opts: [string, string][], get: () => string, put: (v: string) => void) => {
    const g = document.createElement('div'); g.className = 'fxtabs'; g.setAttribute('role', 'group');
    const bs = opts.map(([v, label]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.v = v;
      b.addEventListener('click', () => { put(v); sync(); });
      g.append(b); return b;
    });
    return { el: g, sync: () => bs.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === get()))) };
  };

  const mask = slider('mask');
  const filter = tabs([['ascii', 'ASCII'], ['dither', 'Dither']], () => st.filter, (v) => { st.filter = v as Filter; apply(true); });
  const sw = document.createElement('div'); sw.className = 'fxswatches';
  const swatches = SWATCH_IDS.map((id) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'fxsw'; b.title = id[0].toUpperCase() + id.slice(1);
    b.setAttribute('aria-label', b.title);
    b.style.background = id === 'original' ? `center / cover url(${crop()})` : `linear-gradient(135deg, ${PALETTES[id][1]}, ${PALETTES[id][2]})`;
    b.addEventListener('click', () => { cur().palette = id; apply(true); sync(); });
    sw.append(b); return b;
  });
  const tone = tabs([['shadows', 'Shadows'], ['highlights', 'Highlights']], () => cur().inkTone, (v) => { cur().inkTone = v as FilterSettings['inkTone']; apply(); });
  const strength = slider('strength'), size = slider('size'), spacing = slider('spacing', true);

  row('Mask effect', mask.el);
  row('Filter', filter.el);
  row('Color', sw);
  const toneRow = row('Sample tones', tone.el);
  row('Sampling strength', strength.el);
  row('Size', size.el);
  row('Spacing', spacing.el);
  const foot = document.createElement('div'); foot.className = 'fxfoot';
  const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'fxreset'; reset.textContent = 'Reset to recommended';
  reset.addEventListener('click', () => { st[st.filter] = { ...RECOMMENDED[st.filter] }; apply(true); sync(); });
  const out = document.createElement('code'); out.className = 'fxout';
  foot.append(reset, out); host.append(foot);

  function refreshOut() { out.textContent = JSON.stringify({ filter: st.filter, ...cur() }); }
  function sync() {
    for (const s of [mask, strength, size, spacing]) s.sync();
    filter.sync(); tone.sync();
    swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(SWATCH_IDS[i] === cur().palette)));
    toneRow.hidden = st.filter !== 'ascii';
    refreshOut();
  }
  sync();
}
