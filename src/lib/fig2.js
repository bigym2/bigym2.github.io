// Fig. 2 of the paper (From BiGym to BiGym 2.0) as an animated SVG.
// Generated from build/fig2svg/index.html by build/fig2svg/scripts/port_site.py;
// edit the figure there, not here. mountFig2() draws the finished figure into
// `svg` and returns seek(t): t = 0 and t >= FINISHED are the paper's figure;
// in between, (a) BiGym's animated legs follow a pelvis command and (b) a
// GR00T-WBC rollout squats, walks and leans forward under height, velocity and
// torso-pitch commands.
// FOCUS lists when each panel is lit (0 both, 1 = (a), 2 = (b)).
export function mountFig2(svg, { ICONS, ROBOTS }, viewBase, P = 'fig2-') {
  // ---------------------------------------------------------------- geometry
  const S = 108;                       // px per TikZ cm
  const X0 = 0.60, Y0 = 0.22;          // viewBox origin in page cm (x right, y up)
  const W = 16.65, H = 5.00;           // viewBox size in cm
  const PT = 0.035146;                 // 1 TeX pt in cm
  const OA = 0.45, OB = 8.48;          // panel origins on the 17.78 cm text width:
                                       // \hspace 0.45 + (a) 5.90 + \hfill 2.13 + (b) 8.85 + 0.45
  const FS = { script: 7 * PT, tiny: 5.5 * PT, foot: 8 * PT, math: 8.2 * PT };   // as in ../fig2anim
  svg.setAttribute('viewBox', `0 0 ${W * S} ${H * S}`);
  const NS = 'http://www.w3.org/2000/svg';
  let ox = 0;                          // current panel origin
  const px = (x) => (ox + x - X0) * S; // TikZ x -> svg px
  const py = (y) => (Y0 - y) * S;      // TikZ y -> svg px
  const L = (cm) => cm * S;            // length
  function el(tag, attrs = {}, parent = svg) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent.appendChild(e); return e;
  }
  const g = (parent = svg, attrs = {}) => el('g', attrs, parent);
  const defs = el('defs');
  function rrect(x1, y1, x2, y2, r) {
    const [a, b, c, d] = [px(Math.min(x1, x2)), py(Math.max(y1, y2)), px(Math.max(x1, x2)), py(Math.min(y1, y2))];
    const R = L(r);
    return `M ${a + R} ${b} L ${c - R} ${b} Q ${c} ${b} ${c} ${b + R} L ${c} ${d - R} Q ${c} ${d} ${c - R} ${d} ` +
      `L ${a + R} ${d} Q ${a} ${d} ${a} ${d - R} L ${a} ${b + R} Q ${a} ${b} ${a + R} ${b} Z`;
  }
  const dash = (on, off) => `${L(on * PT)} ${L(off * PT)}`;
  // TikZ Stealth[length=1.7mm] with its tip at (bx, by) (svg px), pointing along a -> b
  function stealthD(ax, ay, bx, by) {
    const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len;
    const Lh = L(0.17), w = 0.375 * Lh, ins = 0.325 * Lh;
    const p = (s, t) => `${bx - ux * s - uy * t} ${by - uy * s + ux * t}`;
    return `M ${p(0, 0)} L ${p(Lh, w)} L ${p(Lh - ins, 0)} L ${p(Lh, -w)} Z`;
  }
  function line(parent, x1, y1, x2, y2, attrs) {
    return el('path', Object.assign({ d: `M ${px(x1)} ${py(y1)} L ${px(x2)} ${py(y2)}`, fill: 'none' }, attrs), parent);
  }
  function text(parent, s, x, y, attrs = {}) {
    const t = el('text', Object.assign({ x: px(x), y: py(y) }, attrs), parent);
    t.innerHTML = s; return t;
  }
  function card(parent, x, yMid, w, h, stroke = 'var(--ruleGray)', lw = 0.6) {
    return el('rect', { x: px(x), y: py(yMid + h / 2), width: L(w), height: L(h), rx: L(2.5 * PT),
      fill: '#fff', stroke, 'stroke-width': L(lw * PT) }, parent);
  }
  // a traced monochrome icon (scripts/pack_assets.py), drawn into a w x h cm box
  function icon(parent, name, x, yTop, w, h) {
    const I = ICONS[name];
    const gi = g(parent, { transform: `translate(${px(x)} ${py(yTop)}) scale(${L(w) / I.w} ${L(h) / I.h})` });
    el('path', { d: I.d, fill: I.fill, 'fill-rule': 'evenodd' }, gi);
    return gi;
  }
  // a traced robot: one group per link, painted in the order the render shows them.
  // Link geometry is in the paper PNG's pixel frame; the outer group maps that frame
  // onto the TikZ box the paper draws the PNG into.
  function robot(parent, R, x, yTop, w, h, id) {
    const mover = g(parent);        // keeps the robot on the panel's floor line (see seek)
    const outer = g(mover, { transform: `translate(${px(x)} ${py(yTop)}) scale(${L(w) / R.png[0]} ${L(h) / R.png[1]})` });
    const wrap = g(outer);          // carries the robot's own fade (panel a); <use> copies of body skip it
    const body = g(wrap, id ? { id } : {});
    const links = {};
    for (const part of R.parts) {
      const pg = g(body, { 'data-link': part.name });
      for (const ly of part.layers) el('path', { d: ly.d, fill: ly.fill, 'fill-rule': 'evenodd' }, pg);
      links[part.name] = pg;
    }
    return { mover, outer, wrap, body, links, R, sx: L(w) / R.png[0], sy: L(h) / R.png[1], x0: px(x), y0: py(yTop) };
  }
  // the pose at motion frame f (fractional): one matrix per link, interpolated
  function pose(rb, f, atRest = false) {
    if (atRest) {             // outside the clip: the paper pose itself (the clip ends there up to ~0.02 px)
      const M = {};
      for (const [name, pg] of Object.entries(rb.links)) { M[name] = [1, 0, 0, 1, 0, 0]; pg.removeAttribute('transform'); }
      return M;
    }
    const n = rb.R.frames, i = Math.max(0, Math.min(n - 1, Math.floor(f))), j = Math.min(n - 1, i + 1), a = Math.max(0, Math.min(1, f - i));
    const M = {};
    for (const [name, pg] of Object.entries(rb.links)) {
      const A = rb.R.mats[name][i], B = rb.R.mats[name][j];
      const m = A.map((v, k) => v + (B[k] - v) * a);
      M[name] = m;
      pg.setAttribute('transform', `matrix(${m.map((v) => v.toFixed(4)).join(' ')})`);
    }
    return M;
  }
  // where a point of the paper pose (PNG px) goes under link matrix m, in svg px
  const carry = (rb, m, u, v) => [rb.x0 + (m[0] * u + m[2] * v + m[4]) * rb.sx, rb.y0 + (m[1] * u + m[3] * v + m[5]) * rb.sy];
  const rest = (rb, u, v) => [rb.x0 + u * rb.sx, rb.y0 + v * rb.sy];

  // ================================================================ panel (a)
  ox = OA;
  const A = g();
  const hX = 3.80, hH = 3.90, hW = 1.562, hY = -0.13;
  const hP = hY - 0.439 * hH, hF = hY - 0.541 * hH, hG = hY - hH;
  const LA = 0.04, LB = 0.79, LC = 0.535, bY = hY - LC * hH;
  const cX = 0.30;

  const h1 = robot(A, ROBOTS.h1, hX, hY, hW, hH, P + 'h1body');
  // The weight scrim and the leg fade (16 strips) of the TikZ, carried by the robot.
  // The paper lays white rectangles over the render: 20 % everywhere, then 16 strips of
  // 3.2 % starting at the hip row and the 0.1 H above it. Over the white page that is
  // exactly the robot at opacity 0.8 * 0.968^k, k = strips covering the row, so it is
  // drawn as an alpha mask on the robot itself. The mask rides on the pelvis, so the
  // fade stays on the legs and nothing passes in and out of a fixed white patch.
  const fadeMask = el('mask', { id: P + 'h1fade', maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse',
    x: -400, y: -400, width: 1000, height: 1200, style: 'mask-type: alpha' }, defs);
  const fadeG = g(fadeMask);
  {
    const P = ROBOTS.h1.png, toV = (y) => (hY - y) / hH * P[1];
    const starts = [];                      // TikZ y where strip i starts (it runs down to the floor)
    for (let i = 1; i <= 16; i++) starts.push(hF + (0.10 * hH) * (i - 1) / 16);
    // one rect, one vertical gradient with hard stops: no seams between the bands
    const V0 = -400, V1 = 800, off = (y) => (toV(y) - V0) / (V1 - V0);
    const gr = el('linearGradient', { id: P + 'h1fadeGrad', gradientUnits: 'userSpaceOnUse', x1: 0, y1: V0, x2: 0, y2: V1 }, defs);
    const a = (k) => 0.8 * Math.pow(0.968, k);
    const stop = (o, k) => el('stop', { offset: o, 'stop-color': '#fff', 'stop-opacity': a(k) }, gr);
    const sorted = starts.slice().sort((p, q) => q - p);      // top to bottom
    stop(0, 0);
    sorted.forEach((y, i) => { stop(off(y), i); stop(off(y), i + 1); });
    stop(1, 16);
    el('rect', { x: -400, y: V0, width: 1000, height: V1 - V0, fill: 'url(#' + P + 'h1fadeGrad)' }, fadeG);
  }
  h1.wrap.setAttribute('mask', 'url(#' + P + 'h1fade)');
  // the open floor: dashed okGray!55
  line(A, hX - 0.24, hG, hX + hW + 0.24, hG, { stroke: '#A4A4A4', 'stroke-width': L(0.55 * PT), 'stroke-dasharray': dash(2, 2) });
  // the two faded copies the paper draws at -/+0.13 cm, clipped to the braced legs:
  // live copies of the traced robot, so they carry whatever pose it is in
  const cp = el('clipPath', { id: P + 'legclip' }, defs);
  const legClipA = el('rect', { x: px(hX + LA * hW), y: py(bY), width: L((LB - LA) * hW), height: py(hG) - py(bY) }, cp);
  const ghosts = g(A, { 'clip-path': 'url(#' + P + 'legclip)' });
  for (const d of [-0.13, 0.13]) {
    const gi = g(ghosts, { transform: `translate(${L(d)} 0)`, opacity: 0.17 });
    el('use', { href: '#' + P + 'h1body', transform: h1.outer.getAttribute('transform') }, gi);
  }
  const legBoxA = el('path', { d: rrect(hX + LA * hW, bY, hX + LB * hW, hG, 3 * PT), fill: 'none', stroke: 'var(--okGray)',
    'stroke-width': L(0.7 * PT), 'stroke-dasharray': dash(1.6, 1.4) }, A);
  // "animated legs" card and its connector
  const animMid = (bY + hG) / 2;
  const animCard = g(A);
  card(animCard, cX, animMid, 2.45, 0.58);
  icon(animCard, 'anim_legs', cX + 0.17, animMid + 0.21, 0.42 * 200 / 239, 0.42);
  text(animCard, 'animated legs', cX + 0.17 + 0.42 * 200 / 239 + 0.16, animMid,
    { 'font-size': L(FS.script), 'font-weight': 700, fill: '#000', 'dominant-baseline': 'central' });
  const animLink = line(A, cX + 2.45, animMid, hX + LA * hW, animMid, { stroke: 'var(--okGray)', 'stroke-width': L(0.9 * PT), 'stroke-linecap': 'round' });
  // command chip; its four terms are separate so the active ones can stay dark
  const cmdA = g(A);
  card(cmdA, cX, hP, 2.45, 0.53);
  const chipA = text(cmdA, '', cX + 2.45 / 2, hP, { class: 'math', 'font-size': L(FS.math), 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  const termA = {};
  ['(', '𝛿𝑥', ', ', '𝛿𝑦', ', ', '𝛿𝑧', ', ', '𝛿𝜃', ')'].forEach((s, i) => {
    const t = el('tspan', {}, chipA); t.textContent = s;
    if (s.startsWith('𝛿')) termA[s] = t;
  });
  // pelvis: rule, arrow, frame dot and tag, all carried by the pelvis
  const pelvisG = g(A);
  const pelvisRule = line(pelvisG, hX - 0.26, hP, hX + hW + 0.10, hP, { stroke: 'var(--inkGray)', 'stroke-width': L(0.45 * PT), 'stroke-dasharray': dash(1.6, 1.6) });
  const pelvisTag = text(pelvisG, 'pelvis', hX - 0.06, hP + 0.04 + 0.05, { 'font-size': L(FS.tiny), 'font-style': 'italic', 'text-anchor': 'end', fill: 'var(--inkGray)' });
  const arrA = el('path', { fill: 'none', stroke: 'var(--inkGray)', 'stroke-width': L(0.7 * PT) }, A);
  const arrAHead = el('path', { fill: 'var(--inkGray)' }, A);
  const dotA = el('circle', { r: L(0.05), fill: 'var(--inkGray)' }, A);
  function placePelvis(dx, dy) {
    ox = OA;
    const [ax, ay] = [px(cX + 2.45), py(hP)];
    const [tx, ty] = [px(hX + 0.10) + dx, py(hP) + dy];
    const len = Math.hypot(tx - ax, ty - ay), k = (len - L(0.08)) / len;
    arrA.setAttribute('d', `M ${ax} ${ay} L ${ax + (tx - ax) * k} ${ay + (ty - ay) * k}`);
    arrAHead.setAttribute('d', stealthD(ax, ay, tx, ty));
    dotA.setAttribute('cx', px(hX + 0.13) + dx); dotA.setAttribute('cy', py(hP) + dy);
    pelvisG.setAttribute('transform', `translate(${dx} ${dy})`);
  }
  placePelvis(0, 0);
  text(A, '(a) BiGym (H1)', 5.90 / 2, -4.65, { class: 'sub', 'font-size': L(FS.foot), 'text-anchor': 'middle' });

  // ================================================================ panel (b)
  ox = OB;
  const B = g();
  const GX = 0.45, GY = -0.805, GH = 3.225, GW = 1.472, GG = GY - GH;
  const VX = 2.70, VY = -0.18, VS = 1.75, VG = 0.26, VE = VX + 3 * VS + 2 * VG, VM = VY - VS / 2;
  const CY = -2.88, RY = -3.265, QY = -3.48;
  const LBA = 0.07, LBB = 0.755, LBC = 0.520;

  const g1 = robot(B, ROBOTS.g1, GX, GY, GW, GH);
  // the two reach targets of the views, where the rollout puts them relative to the robot
  const BALLS = ROBOTS.g1.tracks.balls;
  const ballEls = BALLS.rgb.map((c, i) => {
    const hex = (k) => '#' + c.map((v) => Math.round(255 * Math.min(1, v * k)).toString(16).padStart(2, '0')).join('');
    const gr = el('radialGradient', { id: ['ballGrad0', 'ballGrad1'][i], cx: 0.38, cy: 0.34, r: 0.70 }, defs);
    el('stop', { offset: 0, 'stop-color': hex(2.6) }, gr);
    el('stop', { offset: 0.55, 'stop-color': hex(1.6) }, gr);
    el('stop', { offset: 1, 'stop-color': hex(0.7) }, gr);
    return el('circle', { fill: ['url(#ballGrad0)', 'url(#ballGrad1)'][i] }, BALLS.front[i] ? g1.outer : g1.outer.insertBefore(el('g'), g1.wrap));
  });
  function placeBalls(f) {
    BALLS.track[0].forEach((_, i) => {
      const n = BALLS.track.length, a0 = Math.max(0, Math.min(n - 1, Math.floor(f))), a1 = Math.min(n - 1, a0 + 1), w = Math.max(0, Math.min(1, f - a0));
      const [u0, v0, r0] = BALLS.track[a0][i], [u1, v1, r1] = BALLS.track[a1][i];
      ballEls[i].setAttribute('cx', u0 + (u1 - u0) * w); ballEls[i].setAttribute('cy', v0 + (v1 - v0) * w); ballEls[i].setAttribute('r', r0 + (r1 - r0) * w);
    });
  }
  placeBalls(ROBOTS.g1.frames - 1);
  line(B, GX - 0.24, GG, GX + GW + 0.24, GG, { stroke: 'var(--inkGray)', 'stroke-width': L(0.8 * PT) });
  for (let s = 0; s <= 8; s++) {
    const x0 = GX - 0.10 + 0.19 * s;
    line(B, x0, GG, x0 - 0.09, GG - 0.12, { stroke: 'var(--inkGray)', 'stroke-width': L(0.35 * PT) });
  }
  const legBoxB = el('path', { d: rrect(GX + LBA * GW, GY - LBC * GH, GX + LBB * GW, GG, 3 * PT), fill: 'none', stroke: 'var(--nv)',
    'stroke-width': L(0.7 * PT), 'stroke-dasharray': dash(1.6, 1.4) }, B);
  const callout = { stroke: 'var(--data)', 'stroke-width': L(0.6 * PT), 'stroke-dasharray': dash(1.6, 1.4), fill: 'none' };
  el('path', Object.assign({ d: rrect(VX - 0.14, VY + 0.14, VE + 0.14, VY - VS - 0.14, 1.5 * PT) }, callout), B);
  // camera boxes ride on the torso; their connectors follow
  const cams = [[0.18, 0.005, 0.53, 0.150], [0.25, 0.278, 0.49, 0.376], [0.775, 0.294, 1.000, 0.378]];
  const camFrom = [[0.53, 0.0775], [0.49, 0.327], [1.000, 0.336]];
  const camBoxes = cams.map(([a, b, c, d]) => {
    const cg = g(B);
    el('path', Object.assign({ d: rrect(GX + a * GW, GY - b * GH, GX + c * GW, GY - d * GH, 1.5 * PT) }, callout), cg);
    return { g: cg, u: (a + c) / 2 * ROBOTS.g1.png[0], v: (b + d) / 2 * ROBOTS.g1.png[1] };
  });
  const camLinks = camFrom.map(([a, b]) => ({ p: el('path', callout, B), x: px(GX + a * GW), y: py(GY - b * GH),
    u: a * ROBOTS.g1.png[0], v: b * ROBOTS.g1.png[1] }));
  // each box and connector end is carried by the torso's matrix at its own point, so a
  // leaning torso moves the wrist boxes with the wrists; M = null is the paper pose
  function placeCams(M, lift) {
    ox = OB;
    const off = (u, v) => {
      if (!M) return [0, 0];
      const [a, b] = carry(g1, M, u, v), [c, d] = rest(g1, u, v);
      return [a - c, b - d + lift];
    };
    camBoxes.forEach((c) => { const [dx, dy] = off(c.u, c.v); c.g.setAttribute('transform', `translate(${dx} ${dy})`); });
    camLinks.forEach((c) => { const [dx, dy] = off(c.u, c.v); c.p.setAttribute('d', `M ${c.x + dx} ${c.y + dy} L ${px(VX - 0.14)} ${py(VM)}`); });
  }
  placeCams(null, 0);
  const VCOLS = 20, VROWS = Math.ceil(ROBOTS.g1.frames / VCOLS);
  const viewEls = ['head', 'wristR', 'wristL'].map((f, i) => {
    const x = VX + i * (VS + VG);
    const vs = el('svg', { x: px(x), y: py(VY), width: L(VS), height: L(VS), viewBox: '0 0 84 84', preserveAspectRatio: 'none' }, B);
    el('image', { href: `${viewBase}views_${f}.png`, x: 0, y: 0, width: 84 * VCOLS, height: 84 * VROWS, preserveAspectRatio: 'none',
      style: 'image-rendering: pixelated' }, vs);
    return vs;
  });
  // the views at motion frame f: the rollout's own onboard renders
  function placeViews(f) {
    const k = Math.max(0, Math.min(ROBOTS.g1.frames - 1, Math.round(f))), r = Math.floor(k / VCOLS), c = k % VCOLS;
    viewEls.forEach((vs) => vs.setAttribute('viewBox', `${c * 84} ${r * 84} 84 84`));
  }
  placeViews(ROBOTS.g1.frames - 1);
  ['head', 'wristR', 'wristL'].forEach((f, i) => {
    const x = VX + i * (VS + VG);
    el('rect', { x: px(x), y: py(VY), width: L(VS), height: L(VS), rx: L(1.5 * PT), fill: 'none', stroke: 'var(--ruleGray)', 'stroke-width': L(0.5 * PT) }, B);
    text(B, ['head', 'right wrist', 'left wrist'][i], x + VS / 2, VY - VS - 0.20 - 0.05,
      { 'font-size': L(FS.tiny), 'text-anchor': 'middle', fill: 'var(--okGray)', 'dominant-baseline': 'hanging' });
  });
  // the frozen controller and the command it tracks
  const wbcX = VX - 0.14, wbcW = 2.55, wbcH = 0.64;
  const wbc = g(B);
  const wbcRect = card(wbc, wbcX, CY, wbcW, wbcH, 'var(--nv)', 0.8);
  const nvH = 0.34, nvW = 0.34 * (71.183594 - 0.28125) / 46.894531;
  const nv = el('svg', { x: px(wbcX + 0.17), y: py(CY + nvH / 2), width: L(nvW), height: L(nvH),
    viewBox: '0.28125 0 70.902344 46.894531', preserveAspectRatio: 'none' }, wbc);
  el('path', { fill: '#76B900', d: 'M 26.714844 13.988281 L 26.714844 9.761719 C 27.132812 9.730469 27.550781 9.714844 27.96875 9.710938 C 39.554688 9.34375 47.152344 19.675781 47.152344 19.675781 C 47.152344 19.675781 38.957031 31.054688 30.164062 31.054688 C 28.988281 31.054688 27.839844 30.871094 26.742188 30.507812 L 26.742188 17.667969 C 31.257812 18.214844 32.171875 20.199219 34.859375 24.714844 L 40.886719 19.648438 C 40.886719 19.648438 36.476562 13.882812 29.066406 13.882812 C 28.28125 13.867188 27.496094 13.902344 26.714844 13.988281 M 26.714844 0 L 26.714844 6.316406 L 27.96875 6.234375 C 44.070312 5.6875 54.585938 19.441406 54.585938 19.441406 C 54.585938 19.441406 42.535156 34.105469 29.976562 34.105469 C 28.886719 34.105469 27.8125 34 26.742188 33.820312 L 26.742188 37.734375 C 27.628906 37.835938 28.546875 37.914062 29.433594 37.914062 C 41.121094 37.914062 49.578125 31.941406 57.769531 24.894531 C 59.128906 25.988281 64.683594 28.625 65.835938 29.773438 C 58.058594 36.296875 39.921875 41.542969 29.636719 41.542969 C 28.648438 41.542969 27.710938 41.492188 26.769531 41.386719 L 26.769531 46.894531 L 71.183594 46.894531 L 71.183594 0 Z M 26.714844 30.503906 L 26.714844 33.84375 C 15.914062 31.914062 12.910156 20.667969 12.910156 20.667969 C 12.910156 20.667969 18.105469 14.925781 26.714844 13.988281 L 26.714844 17.640625 L 26.691406 17.640625 C 22.179688 17.089844 18.628906 21.320312 18.628906 21.320312 C 18.628906 21.320312 20.636719 28.445312 26.71875 30.507812 M 7.539062 20.195312 C 7.539062 20.195312 13.929688 10.753906 26.742188 9.757812 L 26.742188 6.316406 C 12.550781 7.464844 0.28125 19.46875 0.28125 19.46875 C 0.28125 19.46875 7.226562 39.5625 26.714844 41.386719 L 26.714844 37.734375 C 12.417969 35.960938 7.539062 20.195312 7.539062 20.195312 Z' }, nv);
  text(wbc, 'GR00T-WBC', wbcX + 0.17 + nvW + 0.16, CY, { 'font-size': L(FS.script), 'font-weight': 700, fill: '#000', 'dominant-baseline': 'central' });
  const cmdBW = 2.42, cmdBH = 0.53, cmdBX = wbcX + wbcW / 2;
  const cmdBTop = CY - wbcH / 2 + (QY - CY + 0.32);
  const cmdB = g(B);
  card(cmdB, cmdBX - cmdBW / 2, cmdBTop - cmdBH / 2, cmdBW, cmdBH);
  const dd = L(0.05), fsub = L(FS.math * 0.72), th = ' ';
  const chipB = text(cmdB, '', cmdBX, cmdBTop - cmdBH / 2, { class: 'math', 'font-size': L(FS.math), 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  const termB = {};
  // (v_x, v_y, ω_z, h, θ): each term a tspan group so the active one can stay dark
  function tsp(s, attrs = {}) { const t = el('tspan', attrs, chipB); t.textContent = s; return t; }
  tsp('(');
  termB.vx = [tsp('𝑣'), tsp('𝑥', { dy: dd, 'font-size': fsub })]; tsp(',' + th, { dy: -dd });
  termB.vy = [tsp('𝑣'), tsp('𝑦', { dy: dd, 'font-size': fsub })]; tsp(',' + th, { dy: -dd });
  termB.wz = [tsp('𝜔'), tsp('𝑧', { dy: dd, 'font-size': fsub })]; tsp(',' + th, { dy: -dd });
  termB.h = [tsp('ℎ')]; tsp(',' + th);
  termB.pitch = [tsp('𝜃')]; tsp(')');
  const arrBy0 = py(cmdBTop), arrBy1 = py(CY - wbcH / 2);
  line(B, cmdBX, cmdBTop, cmdBX, CY - wbcH / 2 - 0.08, { stroke: 'var(--inkGray)', 'stroke-width': L(0.7 * PT) });
  el('path', { d: stealthD(px(cmdBX), arrBy0, px(cmdBX), arrBy1), fill: 'var(--inkGray)' }, B);
  // the controller's wire, leaving the card and becoming the leg chain
  const wireB = line(B, wbcX, CY, GX + LBB * GW, CY, { stroke: 'var(--nv)', 'stroke-width': L(0.9 * PT), 'stroke-linecap': 'round' });
  // collection: VR rig -> Demo Collection -> store
  const vrW = 1.40, vrH = 1.40 * 277 / 480;
  icon(B, 'vr_rig', 5.23, RY + vrH / 2, vrW, vrH);
  el('rect', { x: px(6.80), y: py(RY + 0.035), width: L(0.47), height: L(0.07), fill: 'var(--inkGray)' }, B);
  el('path', { d: `M ${px(7.27)} ${py(RY - 0.105)} L ${px(7.45)} ${py(RY)} L ${px(7.27)} ${py(RY + 0.105)} Z`, fill: 'var(--inkGray)' }, B);
  text(B, 'Demo', 7.125, RY + 0.11 + 0.05, { 'font-size': L(FS.tiny), 'text-anchor': 'middle', fill: 'var(--inkGray)' });
  text(B, 'Collection', 7.125, RY - 0.11 - 0.05, { 'font-size': L(FS.tiny), 'text-anchor': 'middle', fill: 'var(--inkGray)', 'dominant-baseline': 'hanging' });
  const stH = 0.88, stW = 0.88 * 360 / 349;
  icon(B, 'demo_store', VE + 0.14 - stW, RY + stH / 2, stW, stH);
  text(B, '(b) BiGym 2.0 (G1)', 8.85 / 2, -4.65, { class: 'sub', 'font-size': L(FS.foot), 'text-anchor': 'middle' });

  // signal pulses: a dot that runs along a polyline (svg px) while the command travels
  function pulse(parent, color) {
    const c = el('circle', { r: L(0.045), fill: color, opacity: 0 }, parent);
    const halo = el('circle', { r: L(0.11), fill: color, opacity: 0 }, parent);
    return { c, halo, at(pts, p) {
      if (p <= 0 || p >= 1) { c.setAttribute('opacity', 0); halo.setAttribute('opacity', 0); return; }
      const segs = []; let tot = 0;
      for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); tot += l; }
      let s = p * tot, i = 0;
      while (i < segs.length - 1 && s > segs[i]) { s -= segs[i]; i++; }
      const k = s / segs[i], x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k;
      const fade = Math.min(1, p / 0.12, (1 - p) / 0.12);
      for (const e of [c, halo]) { e.setAttribute('cx', x); e.setAttribute('cy', y); }
      c.setAttribute('opacity', fade); halo.setAttribute('opacity', 0.22 * fade);
    } };
  }
  ox = OA; const pulseA = pulse(A, 'var(--inkGray)');
  ox = OB; const pulseB = pulse(B, 'var(--inkGray)'), pulseB2 = pulse(B, 'var(--nv)');

  // ================================================================ timeline
  // 0.0-1.0   the finished figure (the thumbnail)
  // 1.3-5.9   (a) the pelvis command places the pelvis; BiGym's animated legs play back
  // 6.5-13.25 (b) height, then forward/back velocity commands go through GR00T-WBC:
  //           the legs flex with the feet planted, then step forward and back
  // 13.8-     the finished figure, held
  const TA = 1.30;                                   // (a) clip start (s)
  const DA = (ROBOTS.h1.frames - 1) / ROBOTS.h1.fps; // 5.0 s
  const G1SKIP = 0.40;                               // the rollout's first 0.4 s are a steady stand
  const TB = TA + DA + 0.60;
  const DB = (ROBOTS.g1.frames - 1) / ROBOTS.g1.fps - G1SKIP;
  const FOCUS = [[1.00, 1.30, 0, 1], [TA + DA + 0.05, TA + DA + 0.45, 1, 2], [TB + DB + 0.05, TB + DB + 0.55, 2, 0]];
  const FINISHED = TB + DB + 0.55;
  const DURATION = FINISHED + 3.2;

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const inOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const DIM = 0.32;
  // which terms of each chip are live (the others ease to grey), by clip time
  const H1T = ROBOTS.h1.tracks.joints, G1H = ROBOTS.g1.tracks.h;
  const f2 = (arr, f) => arr[Math.max(0, Math.min(arr.length - 1, Math.round(f)))];
  function liveA(f) {        // a term is live while its pelvis coordinate is changing
    const k = 4, dz = Math.abs(f2(H1T.pelvis_z, f + k) - f2(H1T.pelvis_z, f - k)), dx = Math.abs(f2(H1T.pelvis_x, f + k) - f2(H1T.pelvis_x, f - k));
    return { '𝛿𝑧': clamp(dz / 0.004), '𝛿𝑥': clamp(dx / 0.004) };
  }
  function setTerm(nodes, live, active) {
    const c = active ? Math.round(170 - 170 * live) : 0;
    for (const n of [].concat(nodes)) n.style.fill = `rgb(${c},${c},${c})`;
  }

  function seek(t) {
    // focus: which panel is lit (0 both, 1 = a, 2 = b)
    let wa = 1, wb = 1;
    const focusW = (from, to, p) => { const lev = (s) => (s === 0 ? [1, 1] : s === 1 ? [1, DIM] : [DIM, 1]); const [a0, b0] = lev(from), [a1, b1] = lev(to); return [a0 + (a1 - a0) * p, b0 + (b1 - b0) * p]; };
    let state = [1, 1];
    for (const [t0, t1, from, to] of FOCUS) if (t >= t0) state = focusW(from, to, inOut(span(t, t0, t1)));
    [wa, wb] = state;
    A.style.opacity = wa; B.style.opacity = wb;

    // ---- (a): BiGym animated legs under the pelvis command
    ox = OA;
    const ta = t - TA, fa = clamp(ta / DA) * (ROBOTS.h1.frames - 1);
    const restA = ta <= 0 || ta >= DA;
    const MA = pose(h1, fa, restA);
    const [rx, ry] = rest(h1, ROBOTS.h1.anchors.pelvis_frame[0], ROBOTS.h1.anchors.pelvis_frame[1]);
    // The panels draw the floor as a fixed 2D line. Moving over the floor towards the
    // camera, the true projection drops the robot below it, so it is lifted back by the
    // image drop of the floor point under its pelvis (track 'box'; at most 4 px here,
    // 9 px for the G1 walk) and the dashed regions follow it sideways.
    const boxA = restA ? [0, 0] : f2(ROBOTS.h1.tracks.box, fa), liftA = -boxA[1] * h1.sy;
    h1.mover.setAttribute('transform', `translate(0 ${liftA})`);
    let [cx_, cy_] = carry(h1, MA.upper, ROBOTS.h1.anchors.pelvis_frame[0], ROBOTS.h1.anchors.pelvis_frame[1]);
    cy_ += liftA;
    placePelvis(cx_ - rx, cy_ - ry);
    fadeG.setAttribute('transform', `translate(${(cx_ - rx) / h1.sx} ${(cy_ - ry) / h1.sy})`);
    const runA = ta > 0 && ta < DA;
    const la = liveA(fa);
    setTerm(termA['𝛿𝑥'], la['𝛿𝑥'], runA); setTerm(termA['𝛿𝑧'], la['𝛿𝑧'], runA);
    setTerm(termA['𝛿𝑦'], 0, runA); setTerm(termA['𝛿𝜃'], 0, runA);
    // the braced region is the legs: it follows the robot over the floor, and its top
    // edge rides with the pelvis while the floor edge stays put
    const bxA = boxA[0] * h1.sx, topA = bY - (cy_ - ry) / S;
    legBoxA.setAttribute('d', rrect(hX + LA * hW, topA, hX + LB * hW, hG, 3 * PT));
    legBoxA.setAttribute('transform', `translate(${bxA} 0)`); legClipA.setAttribute('transform', `translate(${bxA} 0)`);
    legClipA.setAttribute('y', py(topA)); legClipA.setAttribute('height', py(hG) - py(topA));
    animLink.setAttribute('d', `M ${px(cX + 2.45)} ${py(animMid)} L ${px(hX + LA * hW) + bxA} ${py(animMid)}`);
    ghosts.style.opacity = 1 - clamp(Math.min(ta / 0.3, (DA - ta) / 0.4));
    // the tag sits where the arrow runs once the pelvis drops: it steps aside while the pelvis moves
    pelvisTag.style.opacity = 1 - clamp(Math.min((ta - 0.15) / 0.3, (DA - 0.2 - ta) / 0.3));
    // the command's path: chip -> pelvis dot, once as each move begins
    ox = OA;
    const pA = [[px(cX + 2.45), py(hP)], [px(hX + 0.13) + cx_ - rx, py(hP) + cy_ - ry]];
    let pa = 0;
    for (const k0 of [0.05, 1.45, 2.65]) if (ta >= k0 && ta < k0 + 0.55) pa = (ta - k0) / 0.55;   // the moves start at 0.30, 1.70, 2.90
    pulseA.at(pA, pa);

    // ---- (b): GR00T-WBC rollout
    ox = OB;
    const tb = t - TB, fb = tb <= 0 ? ROBOTS.g1.frames - 1 : (clamp(tb / DB) * DB + G1SKIP) * ROBOTS.g1.fps;   // before the clip: the paper pose (the rollout's last frame)
    const restB = tb <= 0 || tb >= DB;
    const MB = pose(g1, fb, restB);
    const boxB = restB ? [0, 0] : f2(ROBOTS.g1.tracks.box, fb), liftB = -boxB[1] * g1.sy;
    g1.mover.setAttribute('transform', `translate(0 ${liftB})`);
    placeCams(MB.upper, liftB);
    placeBalls(fb); placeViews(fb);
    const runB = tb > 0 && tb < DB;
    const hNow = f2(G1H, fb), hLive = clamp(Math.abs(f2(G1H, fb + 4) - f2(G1H, fb - 4)) / 0.003);
    const vxNow = f2(ROBOTS.g1.tracks.vx, fb);
    setTerm(termB.vx, clamp(Math.abs(vxNow) / 0.08), runB);
    for (const k of ['vy', 'wz']) setTerm(termB[k], 0, runB);
    // the driven region is the legs: it follows the robot over the floor, and its top
    // edge rides with the pelvis (the wire steps down with it while still inside the card)
    const pfB = ROBOTS.g1.anchors.pelvis_frame, dyB = carry(g1, MB.pelvis, pfB[0], pfB[1])[1] - rest(g1, pfB[0], pfB[1])[1] + liftB;
    const bxB = boxB[0] * g1.sx, topB = GY - LBC * GH - dyB / S, wireY = Math.min(CY, topB - 0.17);
    legBoxB.setAttribute('d', rrect(GX + LBA * GW, topB, GX + LBB * GW, GG, 3 * PT));
    legBoxB.setAttribute('transform', `translate(${bxB} 0)`);
    setTerm(termB.h, hLive, runB);
    setTerm(termB.pitch, clamp(Math.abs(f2(ROBOTS.g1.tracks.pitch, fb)) / 0.08), runB);
    // chip -> controller; the controller lights; its green wire -> the legs. Once as each
    // command change begins (rollout: h down 0.5 s, h up 1.8 s, forward 3.0 s, back 4.4 s,
    // torso pitch forward 7.15 s, back up 8.75 s)
    ox = OB;
    const pB1 = [[px(cmdBX), arrBy0], [px(cmdBX), arrBy1]];
    wireB.setAttribute('d', `M ${px(wbcX)} ${py(wireY)} L ${px(GX + LBB * GW) + bxB} ${py(wireY)}`);
    const pB2 = [[px(wbcX), py(wireY)], [px(GX + LBB * GW) + bxB, py(wireY)]];
    let p1 = 0, p2 = 0, glow = 0;
    for (const k0 of [-0.05, 1.25, 2.45, 3.85, 6.60, 8.20]) {
      const u = tb - k0;
      if (u >= 0 && u < 0.32) p1 = u / 0.32;
      if (u >= 0.42 && u < 0.80) p2 = (u - 0.42) / 0.38;
      if (u >= 0.25 && u < 0.65) glow = Math.sin(Math.PI * (u - 0.25) / 0.40);
    }
    pulseB.at(pB1, p1); pulseB2.at(pB2, p2);
    wbcRect.setAttribute('stroke-width', L((0.8 + 0.9 * glow) * PT));
  }
  // one-panel views (svg px): both as wide as panel (b), centred on their panel,
  // so switching between them is a pure horizontal slide
  const view = (o, w) => ({ x: (o + w / 2 - X0) * S - 8.85 * S / 2, w: 8.85 * S });
  return { seek, FINISHED, DURATION, FOCUS, panels: { a: A, b: B }, views: { a: view(OA, 5.90), b: view(OB, 8.85) } };
}
