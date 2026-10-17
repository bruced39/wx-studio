/* WX Studio – HD broadcast-style weather icons (user artwork, animated).
 * Registers an "Animated" and a "Static" library category on top of icons.js.
 * Animated ids that match an original icons.js id REPLACE that original in the library;
 * all loops are seamless over LOOP seconds. Static variants are the same artwork frozen.
 * Icons are drawn in the same 100x100 box as icons.js (400 art-pixels = 100 units).          */
(function (g) {
  'use strict';
  if (!g.Icons || !g.WX_ICON_ART) return;
  const TAU = Math.PI * 2, LOOP = 3;
  const IMG = {};
  Object.keys(g.WX_ICON_ART).forEach(k => { const im = new Image(); im.src = g.WX_ICON_ART[k]; IMG[k] = im; });
  const ok = k => IMG[k] && IMG[k].complete && IMG[k].naturalWidth > 0;

  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const gauss = r => { let u = 0; for (let i = 0; i < 4; i++) u += r(); return (u - 2) / 0.58; };

  /* ---- procedural feathered cloud (Partly Sunny / Mostly Sunny) ---- */
  const cache = {};
  function cloudTex(w, h, seed, dark) {
    const k = w + '|' + h + '|' + seed + '|' + dark; if (cache[k]) return cache[k];
    const W = Math.ceil(w * 1.5), H = Math.ceil(h * 2.0), o = document.createElement('canvas'); o.width = W; o.height = H;
    const x = o.getContext('2d'), r = rng(seed), cx = W / 2, cy = H * 0.52;
    for (let i = 0; i < 420; i++) {
      const gx = gauss(r) * 0.30, gy = gauss(r) * 0.30, px = cx + gx * w, py = cy + gy * h * 1.15;
      const d = Math.min(1, Math.hypot(gx / 0.5, gy / 0.5)), rad = (0.035 + 0.07 * r()) * w * (1 - 0.35 * d);
      const lum = Math.round(246 - (dark || 0) - d * 115 - (gy > 0 ? gy * 70 : 0) + r() * 10), a = 0.30 + 0.25 * (1 - d);
      const gr = x.createRadialGradient(px - rad * 0.2, py - rad * 0.25, 0, px, py, rad);
      gr.addColorStop(0, `rgba(${lum + 3},${lum + 4},${lum + 7},${a})`); gr.addColorStop(0.7, `rgba(${lum - 12},${lum - 10},${lum - 4},${a * 0.6})`); gr.addColorStop(1, `rgba(${lum - 20},${lum - 18},${lum - 10},0)`);
      x.fillStyle = gr; x.beginPath(); x.arc(px, py, rad, 0, TAU); x.fill();
    }
    for (let i = 0; i < 46; i++) { const gx = gauss(r) * 0.14, gy = gauss(r) * 0.10 - 0.02, px = cx + gx * w, py = cy + gy * h * 1.1, rad = (0.03 + 0.04 * r()) * w; const gr = x.createRadialGradient(px, py, 0, px, py, rad); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.beginPath(); x.arc(px, py, rad, 0, TAU); x.fill(); }
    x.globalCompositeOperation = 'destination-in'; x.save(); x.translate(cx, cy); x.scale(w * 0.55, h * 0.72);
    const m = x.createRadialGradient(0, 0, 0, 0, 0, 1); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.72, 'rgba(0,0,0,0.97)'); m.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = m; x.beginPath(); x.arc(0, 0, 1, 0, TAU); x.fill(); x.restore();
    const b = document.createElement('canvas'); b.width = W; b.height = H; const bx = b.getContext('2d'); try { bx.filter = 'blur(0.9px)'; } catch (e) { } bx.drawImage(o, 0, 0);
    return cache[k] = { cv: b, W, H, cx, cy };
  }
  function cloudR(c, x, y, w, h, seed, alpha, dark) { const t = cloudTex(Math.round(w), Math.round(h), seed, dark); c.save(); c.globalAlpha = alpha == null ? 1 : alpha; c.shadowColor = 'rgba(40,50,70,0.25)'; c.shadowBlur = h * 0.18; c.shadowOffsetY = h * 0.08; c.drawImage(t.cv, x - t.cx, y - t.cy); c.restore(); }

  /* ---- his sun artwork: breathing glow + twinkling rays ---- */
  function sunImg(c, cx, cy, sc, ph) {
    if (!ok('sun')) return; const S = sc * (1 + 0.018 * Math.sin(ph * TAU)), br = 0.5 + 0.5 * Math.sin(ph * TAU), R = sc * 230;
    const gl = c.createRadialGradient(cx, cy, sc * 40, cx, cy, R); gl.addColorStop(0, 'rgba(255,190,60,' + (0.30 + 0.22 * br) + ')'); gl.addColorStop(1, 'rgba(255,170,40,0)'); c.fillStyle = gl; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
    const draw = (rot, k, alpha, comp, ring) => { c.save(); if (ring) { c.beginPath(); c.rect(-2000, -2000, 5000, 5000); c.arc(cx, cy, 88 * sc, 0, TAU, true); c.clip('evenodd'); } c.translate(cx, cy); c.rotate(rot); c.scale(k, k); c.globalAlpha = alpha; c.globalCompositeOperation = comp; c.drawImage(IMG.sun, -200, -200); c.restore(); };
    draw(0, S, 1, 'source-over'); draw(0.05 * Math.sin(ph * TAU), S * 1.03, 0.2 * (0.6 + 0.4 * Math.sin(ph * TAU + 1)), 'lighter', true); draw(-0.05 * Math.sin(ph * TAU + 0.6), S * 0.99, 0.16 * (0.6 + 0.4 * Math.cos(ph * TAU)), 'lighter', true);
  }
  /* ---- his grey cloud artwork: slow drift + faint back layer ---- */
  function cloudImg(c, cx, cy, ph) {
    if (!ok('cloud')) return; const sx = Math.sin(ph * TAU), cs = Math.cos(ph * TAU);
    const L = (dx, dy, k, a) => { c.save(); c.globalAlpha = a; c.translate(cx + dx, cy + dy); c.scale(k, k); c.shadowColor = 'rgba(6,24,66,0.35)'; c.shadowBlur = 18; c.shadowOffsetY = 8; c.drawImage(IMG.cloud, -200, -200); c.restore(); };
    L(-9 * sx, 3 * cs, 0.97, 0.55); L(8 * sx, -2 * cs, 1.0 + 0.012 * cs, 1);
  }
  /* ---- his Mostly Sunny artwork (cloud higher) with ray shimmer ---- */
  function mostlyImg(c, ph) {
    if (!ok('mostly')) return; const ox = 200, oy = 240, S = 1 + 0.016 * Math.sin(ph * TAU), br = 0.5 + 0.5 * Math.sin(ph * TAU), dcx = 2, dcy = -10;
    const gl = c.createRadialGradient(ox + dcx, oy + dcy, 40, ox + dcx, oy + dcy, 230); gl.addColorStop(0, 'rgba(255,190,60,' + (0.28 + 0.2 * br) + ')'); gl.addColorStop(1, 'rgba(255,170,40,0)'); c.fillStyle = gl; c.beginPath(); c.arc(ox + dcx, oy + dcy, 230, 0, TAU); c.fill();
    const draw = (rot, k, alpha, comp, ring) => { c.save(); if (ring) { c.beginPath(); c.rect(-2000, -2000, 5000, 2222); c.clip(); c.beginPath(); c.rect(-2000, -2000, 5000, 5000); c.arc(ox + dcx, oy + dcy, 88, 0, TAU, true); c.clip('evenodd'); } c.translate(ox + dcx, oy + dcy); c.rotate(rot); c.scale(k, k); c.globalAlpha = alpha; c.globalCompositeOperation = comp; c.drawImage(IMG.mostly, -200 - dcx, -200 - dcy); c.restore(); };
    draw(0, S, 1, 'source-over'); draw(0.05 * Math.sin(ph * TAU), S * 1.03, 0.2 * (0.6 + 0.4 * Math.sin(ph * TAU + 1)), 'lighter', true); draw(-0.05 * Math.sin(ph * TAU + 0.6), S * 0.99, 0.16 * (0.6 + 0.4 * Math.cos(ph * TAU)), 'lighter', true);
  }


  /* ---- realistic lightning (procedural, branching bolt: leader -> return stroke -> flicker -> afterglow) ---- */
  function bdisp(p0, p1, amp, levels, r) { let pts = [p0, p1]; for (let l = 0; l < levels; l++) { const n = [pts[0]]; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, off = (r() - 0.5) * 2 * amp; n.push([(a[0] + b[0]) / 2 + (-dy / L) * off, (a[1] + b[1]) / 2 + (dx / L) * off]); n.push(b); } pts = n; amp *= 0.58; } return pts; }
  function plen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
  function makeBolt(seed, x0, y0, x1, y1) {
    const r = rng(seed), main = bdisp([x0, y0], [x1, y1], 26, 7, r), branches = [], nb = 3 + Math.floor(r() * 2);
    for (let k = 0; k < nb; k++) { const i = Math.floor(main.length * (0.18 + 0.5 * r())), p = main[i], dir = r() < 0.5 ? -1 : 1, ang = dir * (0.35 + 0.5 * r()), len = 38 + 60 * r(), q = [p[0] + Math.sin(ang) * len, p[1] + Math.cos(ang) * len * 0.85]; branches.push({ pts: bdisp(p, q, 9, 5, r), at: i / main.length }); }
    return { main, branches, len: plen(main) };
  }
  function strike(ph, s) { const d = ((ph - s) % 1 + 1) % 1; if (d > 0.32) return { prog: 0, I: 0 }; const lead = 0.020; if (d < lead) return { prog: d / lead, I: 0.18 }; const e = d - lead; let I = Math.exp(-e / 0.020); if (e > 0.05) I += 0.85 * Math.exp(-(e - 0.05) / 0.016); I += 0.16 * Math.exp(-e / 0.09); return { prog: 1, I: Math.min(1.6, I) }; }
  function strokePath(c, pts, upto, wd, col) { let acc = 0; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) { const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc + seg > upto) { const f = (upto - acc) / seg; c.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f); break; } c.lineTo(pts[i][0], pts[i][1]); acc += seg; } c.lineWidth = wd; c.strokeStyle = col; c.stroke(); }
  function drawBolt(c, B, prog, I, wm) {
    wm = wm || 1; if (I <= 0.01) return; const up = B.len * prog, a = Math.min(1, I); c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.globalCompositeOperation = 'lighter';
    [[22, 'rgba(70,120,255,' + 0.16 * a + ')', 0], [11, 'rgba(120,170,255,' + 0.30 * a + ')', 0], [5, 'rgba(190,215,255,' + 0.65 * a + ')', 8], [2.4, 'rgba(255,255,255,' + Math.min(1, a * 1.1) + ')', 10]].forEach(([w0, col, bl]) => { const w = w0 * wm;
      c.shadowColor = 'rgba(120,170,255,' + a + ')'; c.shadowBlur = bl; strokePath(c, B.main, up, w, col);
      B.branches.forEach(br => { const bl2 = plen(br.pts), bp = Math.max(0, Math.min(1, (up - B.len * br.at) / bl2)); if (bp > 0) strokePath(c, br.pts, bl2 * bp, w * 0.55, col); });
    }); c.restore();
  }
  const mkc = () => { const o = document.createElement('canvas'); o.width = 400; o.height = 400; return o; };
  let _oc, _oc2;

  /* ---- Thunderstorms: his cumulonimbus (sun removed, darkened) + falling rain + the lightning bolt. Art pixel space. ---- */
  const BOLTS_T = [makeBolt(11, 150, 204, 126, 388), makeBolt(23, 180, 210, 192, 332)];
  let _oc3;
  function thunder(c, ph) {
    if (!ok('stormcloud')) return; _oc3 = _oc3 || mkc(); const o = _oc3.getContext('2d');
    const S1 = strike(ph, 0.18), S2 = strike(ph, 0.62), F = Math.min(1, 0.9 * Math.max(S1.I > 0.3 ? S1.I : 0, S2.I > 0.3 ? S2.I * 0.8 : 0)), sc = 1 + 0.012 * Math.sin(ph * TAU);
    c.save(); c.translate(10, 0);
    rain(c, ph, PM({ seed: 9, x0: 50, xw: 285, top: 212, len: 185, n: 30, spd: 4, spdP: 0.4, L: 26, mask: { k: 'stormcloud' } }));
    let bg = c.createRadialGradient(150, 270, 5, 150, 270, 150); bg.addColorStop(0, 'rgba(140,185,255,' + (0.03 + 0.5 * F) + ')'); bg.addColorStop(1, 'rgba(120,170,255,0)'); c.fillStyle = bg; c.beginPath(); c.arc(150, 270, 150, 0, TAU); c.fill();
    o.clearRect(0, 0, 400, 400); o.globalCompositeOperation = 'source-over'; o.drawImage(IMG.stormcloud, 0, 0);
    o.globalCompositeOperation = 'source-atop'; const fl = o.createRadialGradient(150, 215, 10, 150, 215, 190); fl.addColorStop(0, 'rgba(205,225,255,' + 0.55 * F + ')'); fl.addColorStop(1, 'rgba(205,225,255,0)'); o.fillStyle = fl; o.fillRect(0, 0, 400, 400);
    c.save(); c.translate(190, 130); c.scale(sc, sc); c.shadowColor = 'rgba(6,24,66,0.35)'; c.shadowBlur = 16; c.shadowOffsetY = 7; c.drawImage(_oc3, -190, -130); c.restore();
    drawBolt(c, BOLTS_T[0], S1.prog, S1.I, 1.3); drawBolt(c, BOLTS_T[1], S2.prog, S2.I * 0.85, 1.3);
    c.restore();
  }

  /* ---- Mostly Cloudy (his artwork: sun peeking over a big cloud): breathing glow + shimmering rays ---- */
  function mostlyCloudy(c, ph) {
    if (!ok('mcloudy')) return; const im = IMG.mcloudy, SXm = 213, SYm = 190; _oc2 = _oc2 || mkc(); const o2 = _oc2.getContext('2d');
    const br = 0.5 + 0.5 * Math.sin(ph * TAU), S = 1 + 0.014 * Math.sin(ph * TAU);
    c.save(); c.translate(-10, 0);
    const gl = c.createRadialGradient(SXm, SYm, 30, SXm, SYm, 230); gl.addColorStop(0, 'rgba(255,190,60,' + (0.22 + 0.18 * br) + ')'); gl.addColorStop(1, 'rgba(255,170,40,0)'); c.fillStyle = gl; c.beginPath(); c.arc(SXm, SYm, 230, 0, TAU); c.fill();
    c.save(); c.translate(SXm, SYm); c.scale(S, S); c.drawImage(im, -SXm, -SYm); c.restore();
    const mask = () => { const r = o2.createRadialGradient(SXm, SYm, 0, SXm, SYm, 160); r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(0.46, 'rgba(0,0,0,0)'); r.addColorStop(0.62, 'rgba(0,0,0,1)'); r.addColorStop(1, 'rgba(0,0,0,0)'); o2.fillStyle = r; o2.fillRect(0, 0, 400, 400); o2.globalCompositeOperation = 'destination-in'; const v = o2.createLinearGradient(0, SYm - 76, 0, SYm - 44); v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)'); o2.fillStyle = v; o2.fillRect(0, 0, 400, 400); };
    const lay = (rot, k, al) => { o2.globalCompositeOperation = 'source-over'; o2.clearRect(0, 0, 400, 400); o2.drawImage(im, 0, 0); o2.globalCompositeOperation = 'destination-in'; mask(); c.save(); c.translate(SXm, SYm); c.rotate(rot); c.scale(k, k); c.globalAlpha = al; c.globalCompositeOperation = 'lighter'; c.drawImage(_oc2, -SXm, -SYm); c.restore(); };
    lay(0.05 * Math.sin(ph * TAU), 1.03, 0.34 * (0.6 + 0.4 * Math.sin(ph * TAU + 1))); lay(-0.05 * Math.sin(ph * TAU + 0.6), 0.99, 0.26 * (0.6 + 0.4 * Math.cos(ph * TAU)));
    c.restore();
  }

  /* ---- Sun_Thunderstorms (his artwork, bolt removed and redrawn procedurally). Art pixel space, drawn at (0,0). ---- */
  const SX = 125, SY = 113, BOLTS = [makeBolt(11, 184, 238, 160, 392), makeBolt(23, 210, 238, 222, 360)];
  function sunStorm(c, ph) {
    if (!ok('sunstorm')) return; const im = IMG.sunstorm; _oc = _oc || mkc(); _oc2 = _oc2 || mkc(); const o = _oc.getContext('2d'), o2 = _oc2.getContext('2d');
    const br = 0.5 + 0.5 * Math.sin(ph * TAU), S = 1 + 0.012 * Math.sin(ph * TAU), S1 = strike(ph, 0.18), S2 = strike(ph, 0.62);
    const F = Math.min(1, 0.9 * Math.max(S1.I > 0.3 ? S1.I : 0, S2.I > 0.3 ? S2.I * 0.8 : 0));
    c.save(); c.translate(200 - 200, 200 - 200);
    let gl = c.createRadialGradient(SX, SY, 10, SX, SY, 170); gl.addColorStop(0, 'rgba(255,190,60,' + (0.30 + 0.20 * br) + ')'); gl.addColorStop(1, 'rgba(255,170,40,0)'); c.fillStyle = gl; c.beginPath(); c.arc(SX, SY, 170, 0, TAU); c.fill();
    let bg = c.createRadialGradient(180, 260, 5, 180, 260, 150); bg.addColorStop(0, 'rgba(140,185,255,' + (0.05 + 0.55 * F) + ')'); bg.addColorStop(1, 'rgba(120,170,255,0)'); c.fillStyle = bg; c.beginPath(); c.arc(180, 260, 150, 0, TAU); c.fill();
    rain(c, ph, PM({ seed: 5, x0: 80, xw: 260, top: 228, len: 175, n: 30, spd: 4, spdP: 0.4, L: 26, mask: { k: 'sunstorm' } }));
    o.clearRect(0, 0, 400, 400); o.globalCompositeOperation = 'source-over'; o.drawImage(im, 0, 0);
    o.globalCompositeOperation = 'source-atop'; let fl = o.createRadialGradient(185, 250, 10, 185, 250, 190); fl.addColorStop(0, 'rgba(215,230,255,' + 0.75 * F + ')'); fl.addColorStop(1, 'rgba(215,230,255,0)'); o.fillStyle = fl; o.fillRect(0, 0, 400, 400);
    c.save(); c.translate(200, 200); c.scale(S, S); c.drawImage(_oc, -200, -200); c.restore();
    c.save(); c.translate(178, 244); c.scale(1, 0.42); let nb = c.createRadialGradient(0, 0, 0, 0, 0, 40); nb.addColorStop(0, 'rgba(212,216,226,0.95)'); nb.addColorStop(0.6, 'rgba(205,210,222,0.7)'); nb.addColorStop(1, 'rgba(205,210,222,0)'); c.fillStyle = nb; c.beginPath(); c.arc(0, 0, 40, 0, TAU); c.fill(); c.restore();
    const lay = (maskFn, rot, k, al) => { o2.globalCompositeOperation = 'source-over'; o2.clearRect(0, 0, 400, 400); o2.drawImage(im, 0, 0); o2.globalCompositeOperation = 'destination-in'; maskFn(); c.save(); c.translate(SX, SY); c.rotate(rot); c.scale(k, k); c.globalAlpha = al; c.globalCompositeOperation = 'lighter'; c.drawImage(_oc2, -SX, -SY); c.restore(); };
    const rayMask = () => { let r = o2.createRadialGradient(SX, SY, 0, SX, SY, 112); r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(0.5, 'rgba(0,0,0,0)'); r.addColorStop(0.66, 'rgba(0,0,0,1)'); r.addColorStop(1, 'rgba(0,0,0,0)'); o2.fillStyle = r; o2.fillRect(0, 0, 400, 400); o2.globalCompositeOperation = 'destination-in'; let h = o2.createLinearGradient(SX + 5, 0, SX + 60, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)'); o2.fillStyle = h; o2.fillRect(0, 0, 400, 400); };
    lay(rayMask, 0.05 * Math.sin(ph * TAU), 1.03, 0.34 * (0.6 + 0.4 * Math.sin(ph * TAU + 1))); lay(rayMask, -0.05 * Math.sin(ph * TAU + 0.6), 0.99, 0.26 * (0.6 + 0.4 * Math.cos(ph * TAU)));
    drawBolt(c, BOLTS[0], S1.prog, S1.I); drawBolt(c, BOLTS[1], S2.prog, S2.I * 0.85);
    c.restore();
  }

  /* ---- streak rain (steady, straight) ---- */
  /* ---- raindrops: glossy drop sprites (from the user's reference photo), falling along their own slant ---- */
  const DROPS = [[44, 112, -19.8], [45, 111, -20.2], [44, 111, -20.0], [46, 112, -20.2], [48, 112, -20.3], [44, 112, -20.1], [46, 112, -20.2], [56, 112, -23.0], [42, 112, -20.1], [44, 112, -20.1], [48, 112, -20.2], [44, 112, -19.7]];   // [width, height, tilt-deg] of drop0..dropN art (sprite images in icons_hd_art.js)
  const rainLay = {}, baseCache = {};
  /* underside of the cloud in an art image: per column, the lowest row of solid cloud (or -1) */
  function cloudBase(k) {
    if (baseCache[k]) return baseCache[k]; if (!ok(k)) return null;
    const cv = document.createElement('canvas'); cv.width = cv.height = 400; const x = cv.getContext('2d'); x.drawImage(IMG[k], 0, 0);
    const d = x.getImageData(0, 0, 400, 400).data, base = new Array(400).fill(-1);
    for (let i = 0; i < 400; i++) { let n = 0, last = -1; for (let j = 0; j < 400; j++) if (d[(j * 400 + i) * 4 + 3] > 150) { n++; last = j; } if (n >= 20 && last >= 225) base[i] = last; }
    return baseCache[k] = base;
  }
  function rainLayout(p) {
    const key = [p.seed, p.n, p.x0, p.xw, p.top, p.len, p.spd, p.spdP, p.L, p.mask ? p.mask.k : ''].join('|'); if (rainLay[key]) return rainLay[key];
    const n = Math.max(4, Math.round(p.n * 0.5)), sz = Math.min(1.1, Math.max(0.9, p.L / 24)), tn = d => Math.tan(DROPS[d.si][2] * Math.PI / 180);
    let cols = null, base = null, mid = p.x0 + p.xw / 2;
    if (p.mask) {   /* drops are born under the cloud body and appear right at its underside */
      base = cloudBase(p.mask.k); if (!base) return null;
      const v = []; base.forEach((b, i) => { if (b >= 0) v.push(i); }); const lo = v[0] + 14, hi = v[v.length - 1] - 14; cols = v.filter(i => i >= lo && i <= hi);
      mid = (v[0] + v[v.length - 1]) / 2;
      /* every drop slants to the left as it falls, so start the drops toward the right: the falling shower is then centred under the cloud and stays inside its width */
      const tnm = Math.abs(DROPS.reduce((q, d) => q + Math.tan(d[2] * Math.PI / 180), 0) / DROPS.length), avgB = cols.reduce((q, i) => q + base[i], 0) / cols.length;
      const shift = Math.min(tnm * Math.max(90, p.top + p.len - (avgB - 8)), (cols[cols.length - 1] - cols[0]) * 0.45), keep = cols.filter(i => i >= cols[0] + shift); if (keep.length > 20) cols = keep;
    }
    const yb = d => base ? base[d.cx] : p.top, endY = p.top + p.len;
    const pos = (d, ph) => { const f = (ph * d.spd + d.off) % 1, y0 = yb(d) - 8, trav = base ? Math.max(90, endY - y0) : p.len; return base ? [d.x + tn(d) * trav * f, y0 + trav * f] : [d.x + tn(d) * p.len * (f - 0.5), p.top + p.len * f]; };
    let best = null, bs = -1e9;
    for (let t = 0; t < 300; t++) {
      const r = rng(p.seed * 131 + t + 1), L = [];
      /* stratified: one drop per equal-width slice of the cloud, so the rain is spread evenly left to right */
      for (let i = 0; i < n; i++) { const u = (i + r()) / n, cx = cols ? cols[Math.min(cols.length - 1, Math.floor(u * cols.length))] : 0; L.push({ cx, x: cols ? cx + 0.5 : p.x0 + p.xw * u, off: r(), spd: p.spd + (r() < p.spdP ? 1 : 0), h: (26 + 34 * r()) * sz, si: Math.floor(r() * DROPS.length) }); }
      let ms = 1e9, sx = 0, cnt = 0; for (let k = 0; k < 12; k++) { const P = L.map(d => pos(d, k / 12)); P.forEach(q => { sx += q[0]; cnt++; }); for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const dd = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]); if (dd < ms) ms = dd; } }
      const score = ms - 0.8 * Math.abs(sx / cnt - mid);   /* well spaced AND centred under the cloud */
      if (score > bs) { bs = score; best = L; }
    }
    return rainLay[key] = { L: best, pos, base };
  }
  function rain(c, ph, p) {
    if (!ok('drop0')) return; const lay = rainLayout(p); if (!lay) return; c.save();
    lay.L.forEach(d => {
      const f = (ph * d.spd + d.off) % 1, xy = lay.pos(d, ph), D = DROPS[d.si], h = d.h, w = D[0] * h / D[1];
      const a = lay.base ? Math.min(1, Math.max(0, (xy[1] - lay.base[d.cx]) / 14)) * Math.min(1, (1 - f) * 4)
        : Math.min(1, f * p.fk) * Math.sin(Math.PI * Math.min(1, f * p.fs)) ** 0.7;
      c.globalAlpha = 0.95 * a; c.drawImage(IMG['drop' + d.si], xy[0] - w * 0.2, xy[1] - h * 0.05, w, h);
    });
    c.restore();
  }
  /* ---- wind-swept curved streaks ---- */
  function windRain(c, ph) {
    const r = rng(21); c.save(); c.lineCap = 'butt';
    const P = (x0, D, H, w, u) => [x0 - D * Math.pow(u, 2.2) + w * Math.sin(u * 6.28 * 1.5), 285 + H * u];
    function seg(x0, D, H, w, u0, u1, wd, col, al) { const n = 26; for (let k = 0; k < n; k++) { const ua = u0 + (u1 - u0) * k / n, ub = u0 + (u1 - u0) * (k + 1) / n; if (ub < 0 || ua > 1) continue; const A = P(x0, D, H, w, Math.max(0, Math.min(1, ua))), B = P(x0, D, H, w, Math.max(0, Math.min(1, ub))); const q = (k + 1) / n; c.strokeStyle = col.replace('A', (al * q * q).toFixed(3)); c.lineWidth = wd * (0.4 + 0.6 * q); c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke(); } }
    const S = []; for (let i = 0; i < 46; i++) S.push({ x0: 105 + 175 * r(), D: 30 + 95 * r(), H: 175 + 30 * r(), w: 5 * r(), spd: 1 + (r() < 0.5 ? 1 : 0), off: r(), wd: 2.2 + 2.4 * r(), L: 0.38 + 0.2 * r() });
    for (const q of S) { const u = ((ph * q.spd + q.off) % 1) * 1.35 - 0.1; c.shadowBlur = 0; seg(q.x0 - 6, q.D * 1.5, q.H + 10, q.w, u - 0.3, u + 0.06, q.wd * 1.3, 'rgba(235,242,250,A)', 0.3); }
    for (const q of S) { const f = ((ph * q.spd + q.off) % 1), u = f * 1.3 - 0.05, fade = Math.sin(Math.PI * Math.min(1, f * 1.0)) ** 0.6; c.shadowColor = 'rgba(150,200,240,0.6)'; c.shadowBlur = 3; seg(q.x0, q.D, q.H, q.w, u - q.L, u, q.wd, 'rgba(120,170,205,A)', 0.9 * fade); c.shadowBlur = 0; seg(q.x0, q.D, q.H, q.w - 1.2, u - q.L * 0.8, u - 0.01, q.wd * 0.35, 'rgba(225,242,255,A)', 0.9 * fade); }
    c.restore();
  }

  /* ---- falling snowflakes (six-armed crystals that drift, sway and slowly spin) ---- */
  function flake(c, x, y, R, rot, a) {
    c.save(); c.translate(x, y); c.rotate(rot); c.shadowColor = 'rgba(150,205,255,' + (0.85 * a) + ')'; c.shadowBlur = 7; c.strokeStyle = 'rgba(240,248,255,' + (0.95 * a) + ')'; c.lineCap = 'round';
    for (let k = 0; k < 6; k++) { c.save(); c.rotate(k * Math.PI / 3); c.lineWidth = Math.max(1.4, R * 0.17); c.beginPath(); c.moveTo(0, 0); c.lineTo(R, 0); c.stroke(); c.lineWidth = Math.max(1, R * 0.12); c.beginPath(); c.moveTo(R * 0.55, 0); c.lineTo(R * 0.78, -R * 0.26); c.moveTo(R * 0.55, 0); c.lineTo(R * 0.78, R * 0.26); c.stroke(); c.restore(); }
    c.restore();
  }
  /* Snow: random flakes. Each layout starts random, then individual flakes are re-rolled at random until no two flakes crowd each other at any moment of the loop. */
  const snowLay = {};
  function snowLayout(p) {
    const key = [p.seed, p.n, p.s0, p.s1, p.r0, p.r1].join('|'); if (snowLay[key]) return snowLay[key];
    const r = rng(p.seed * 977 + 13), mk = i => ({ x0: 100 + 200 * ((i + r()) / p.n), spd: 1 + (r() < 0.5 ? 1 : 0), off: r(), sw: p.s0 + p.s1 * r(), R: p.r0 + p.r1 * r(), dir: r() < 0.5 ? 1 : -1, rot0: r() * 6 });
    const pos = (d, ph) => { const u = ph * d.spd + d.off, f = u % 1; return [d.x0 + d.sw * Math.sin(TAU * u), 264 + 215 * f, f]; };
    const K = 24, L = []; for (let i = 0; i < p.n; i++) L.push(mk(i));
    const cache = L.map(d => { const a = []; for (let k = 0; k < K; k++) a.push(pos(d, k / K)); return a; });
    const vis = q => q[2] > 0.04 && q[2] < 0.92;
    const pairE = (ci, ri, cj, rj) => { let e = 0, T = (ri + rj) * 1.7 + 8; for (let k = 0; k < K; k++) { const a = ci[k], b = cj[k]; if (!vis(a) || !vis(b)) continue; const dd = T - Math.hypot(a[0] - b[0], a[1] - b[1]); if (dd > 0) e += dd * dd; } return e; };
    const eOf = (i, ci, ri) => { let e = 0; for (let j = 0; j < L.length; j++) if (j !== i) e += pairE(ci, ri, cache[j], L[j].R); return e; };
    for (let it = 0; it < 3000; it++) {
      const i = it % L.length, old = L[i], oc = cache[i], eo = eOf(i, oc, old.R); if (eo === 0) continue;
      const nd = mk(i), nc = []; for (let k = 0; k < K; k++) nc.push(pos(nd, k / K));
      if (eOf(i, nc, nd.R) < eo) { L[i] = nd; cache[i] = nc; }
    }
    return snowLay[key] = { L, pos };
  }
  function snow(c, ph, p) {
    const lay = snowLayout(p); c.save();
    lay.L.forEach(d => {
      const u = ph * d.spd + d.off, f = u % 1, xy = lay.pos(d, ph), a = Math.min(1, f * 6) * Math.sin(Math.PI * Math.min(1, f * 1.05)) ** 0.6;
      flake(c, xy[0], xy[1], d.R, d.dir * TAU * u + d.rot0, a);
    });
    c.restore();
  }

  /* ---- blizzard: snow pours out of the cloud, drops a little, then is driven left by the wind ---- */
  function blizzard(c, ph) {
    const r = rng(77); c.save(); c.lineCap = 'round';
    c.save(); c.translate(205, 415); c.scale(1.15, 0.8); const hz = c.createRadialGradient(0, 0, 0, 0, 0, 170); hz.addColorStop(0, 'rgba(225,238,255,' + (0.18 + 0.06 * Math.sin(ph * TAU)) + ')'); hz.addColorStop(1, 'rgba(225,238,255,0)'); c.fillStyle = hz; c.beginPath(); c.arc(0, 0, 170, 0, TAU); c.fill(); c.restore();
    const mk = () => { const xs = 90 + 250 * r(), xe = xs - (20 + 85 * r()), H = 70 + 140 * r(), y0 = 282 + 8 * r(); return { xs, D: xs - xe, H, y0 }; };
    const P = (q, u) => [q.xs - q.D * Math.pow(u, 2.4) + 4 * Math.sin(u * 9), q.y0 + q.H * Math.pow(u, 0.8)];
    for (let i = 0; i < 18; i++) {
      const q = mk(), spd = 1 + (r() < 0.5 ? 1 : 0), off = r(), u = ((ph * spd + off) % 1), a = Math.sin(Math.PI * u) ** 0.8 * 0.13, wd = 2.5 + 3 * r();
      for (let k = 0; k < 10; k++) { const ua = Math.max(0, u - 0.34 + k * 0.034), ub = Math.max(0, u - 0.34 + (k + 1) * 0.034); if (ub <= 0) continue; const A = P(q, ua), B = P(q, Math.min(1, ub)); c.strokeStyle = 'rgba(235,245,255,' + (a * ((k + 1) / 10) ** 1.5) + ')'; c.lineWidth = wd; c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke(); }
    }
    for (let i = 0; i < 300; i++) {
      const q = mk(), spd = 2 + (r() < 0.5 ? 1 : 0), off = r(), u = ((ph * spd + off) % 1), a = Math.sin(Math.PI * u) ** 0.5 * Math.min(1, u * 10), kind = r(), R = 2.2 + 3.2 * r(), Lg = 0.05 + 0.07 * r(), w = 1.6 + 2.2 * r(), rs = r();
      const H = P(q, u), T = P(q, Math.max(0, u - Lg));
      if (kind < 0.45) flake(c, H[0], H[1], R * 1.9, TAU * (ph * spd + off) * (rs < 0.5 ? 1 : -1) + rs * 6, a * 0.95);
      else { const g = c.createLinearGradient(H[0], H[1], T[0], T[1]); g.addColorStop(0, 'rgba(245,250,255,' + (0.92 * a) + ')'); g.addColorStop(1, 'rgba(245,250,255,0)'); c.strokeStyle = g; c.lineWidth = w; c.shadowColor = 'rgba(170,210,255,' + (0.6 * a) + ')'; c.shadowBlur = 4; c.beginPath(); c.moveTo(H[0], H[1]); c.lineTo(T[0], T[1]); c.stroke(); c.shadowBlur = 0; }
    }
    c.restore();
  }

  /* rain presets on the grey cloud (cloud centre y=232, rain starts under it) */
  const RP = (o) => Object.assign({ seed: 9, x0: 95, xw: 210, spd: 4, spdP: 0.4, top: 267, len: 190, fk: 6, fs: 1.06, L: 26, w0: 2.3, w1: 2.1, aS: 0.95, aG: 0.7, blur: 4 }, o);
  const P_RAIN = RP({}), P_SHOWERS = RP({ n: 11, spd: 3, L: 20, w0: 1.8, w1: 1.4 }), P_DRIZZLE = RP({ n: 6, spd: 2, spdP: 0.5, L: 27, w0: 3.4, w1: 1.6, aS: 0.92, aG: 0.65, blur: 5 }), P_HEAVY = RP({ n: 75, spd: 5, spdP: 0.5, L: 34, w0: 2.8, w1: 2.4 });
  P_RAIN.n = 34;
  /* rain on his Mostly Sunny artwork */
  const PM = (o) => ({ seed: 5, x0: 112, xw: 190, spd: 4, spdP: 0.4, top: 308, len: 165, fk: 5, fs: 1.08, L: 24, w0: 2.2, w1: 2, aS: 0.95, aG: 0.7, blur: 4, n: 30, ...o });

  /* each icon: fn(ctx, phase 0..1) in 400-px art coordinates, origin at art point (200, oy) */
  const ICONS = [
    { id: 'sunny', label: 'Sunny', oy: 270, fn: (c, ph) => sunImg(c, 200, 270, 1, ph) },
    { id: 'partly-cloudy', label: 'Partly Sunny', oy: 270, fn: (c, ph) => { const s = 340, d = Math.sin(ph * TAU); sunImg(c, 200, 270, 0.78, ph); cloudR(c, 200 + s * 0.2 - d * s * 0.025, 270 - s * 0.15, s * 0.4, s * 0.17, 5, 0.8, 10); cloudR(c, 200 - s * 0.12 + d * s * 0.025, 270 + s * 0.15, s * 0.5, s * 0.21, 12, 1, 0); } },
    { id: 'mostly-sunny', label: 'Mostly Sunny', oy: 270, fn: (c, ph) => { const s = 340, d = Math.sin(ph * TAU); sunImg(c, 200, 262, 0.85, ph); cloudR(c, 200 + s * 0.02 + d * s * 0.02, 270 + s * 0.15, s * 0.64, s * 0.22, 21, 1, 0); } },
    { id: 'cloudy', label: 'Cloudy', oy: 270, k: 1.3, fn: (c, ph) => cloudImg(c, 200, 270, ph) },
    { id: 'rain', k: 1.18, label: 'Rain', oy: 300, fn: (c, ph) => { rain(c, ph, P_RAIN); cloudImg(c, 200, 232, ph); } },
    { id: 'showers', k: 1.18, label: 'Showers', oy: 300, fn: (c, ph) => { rain(c, ph, P_SHOWERS); cloudImg(c, 200, 232, ph); } },
    { id: 'drizzle', k: 1.18, label: 'Drizzle', oy: 300, fn: (c, ph) => { rain(c, ph, P_DRIZZLE); cloudImg(c, 200, 232, ph); } },
    { id: 'heavy-rain', k: 1.18, label: 'Heavy Rain', oy: 300, fn: (c, ph) => { rain(c, ph, P_HEAVY); cloudImg(c, 200, 232, ph); } },
    { id: 'heavy-rain-wind', k: 1.18, label: 'Heavy Rain & Wind', oy: 300, fn: (c, ph) => { windRain(c, ph); cloudImg(c, 200, 232, ph); } },
    { id: 'flurries', k: 1.18, label: 'Flurries', oy: 300, fn: (c, ph) => { snow(c, ph, { seed: 14, n: 5, s0: 10, s1: 10, r0: 6.5, r1: 2 }); cloudImg(c, 200, 232, ph); } },
    { id: 'light-snow', k: 1.18, label: 'Light Snow', oy: 300, fn: (c, ph) => { snow(c, ph, { seed: 16363, n: 10, s0: 6, s1: 8, r0: 8.5, r1: 3.5 }); cloudImg(c, 200, 232, ph); } },
    { id: 'snow', k: 1.18, label: 'Snow', oy: 300, fn: (c, ph) => { snow(c, ph, { seed: 165877, n: 18, s0: 6, s1: 8, r0: 8.5, r1: 3.5 }); cloudImg(c, 200, 232, ph); } },
    { id: 'heavy-snow', k: 1.18, label: 'Heavy Snow', oy: 300, fn: (c, ph) => { snow(c, ph, { seed: 55928, n: 30, s0: 6, s1: 8, r0: 8.5, r1: 3.5 }); cloudImg(c, 200, 232, ph); } },
    { id: 'blizzard', k: 1.05, label: 'Blizzard', oy: 318, fn: (c, ph) => { blizzard(c, ph); cloudImg(c, 200, 232, ph); } },
    { id: 'wintry-mix', k: 1.18, label: 'Wintry Mix', oy: 300, fn: (c, ph) => { rain(c, ph, RP({ seed: 21, n: 28, spd: 3, spdP: 0.4, L: 26 })); snow(c, ph, { seed: 16363, n: 10, s0: 6, s1: 8, r0: 8.5, r1: 3.5 }); cloudImg(c, 200, 232, ph); } },
    { id: 'snow-showers-day', k: 1.18, label: 'Snow Showers', oy: 300, fn: (c, ph) => { snow(c, ph, { seed: 4242, n: 7, s0: 6, s1: 8, r0: 8.5, r1: 3.5 }); cloudImg(c, 200, 232, ph); } },
    { id: 'mostly-sunny-rain', label: 'Mostly Sunny/Rain', oy: 290, fn: (c, ph) => { mostlyImg(c, ph); rain(c, ph, PM({})); } },
    { id: 'mostly-sunny-showers', label: 'Mostly Sunny/Showers', oy: 290, fn: (c, ph) => { mostlyImg(c, ph); rain(c, ph, PM({ n: 11, spd: 3, L: 20, w0: 1.8, w1: 1.4 })); } },
    { id: 'thunderstorm', label: 'Thunderstorms', k: 0.95, oy: 195, st: 0.205, fn: (c, ph) => thunder(c, ph) },
    { id: 'mostly-cloudy', label: 'Mostly Cloudy', k: 1.08, oy: 197, fn: (c, ph) => mostlyCloudy(c, ph) },
    { id: 'sun-thunderstorms', label: 'Sun_Thunderstorms', k: 1.0, oy: 206, st: 0.205, fn: (c, ph) => sunStorm(c, ph) }
  ];
  /* same artwork, different wording (user's call): Light Rain / Light Showers reuse Showers, Snow Showers reuses Light Snow */
  const byId = {}; ICONS.forEach(i => { byId[i.id] = i; });
  [{ id: 'light-rain', label: 'Light Rain', src: 'showers' }, { id: 'light-showers', label: 'Light Showers', src: 'showers' }]
    .forEach(d => ICONS.push(Object.assign({}, byId[d.src], { id: d.id, label: d.label })));
  const STATIC_T = 0.75;       // frozen frame used for the Static versions (seconds)

  const Icons = g.Icons, HD = {};
  const anim = [], stat = [];
  ICONS.forEach(ic => {
    HD[ic.id] = { label: ic.label, ic, still: false };
    HD[ic.id + '-static'] = { label: ic.label + ' (Static)', ic, still: true };
    anim.push({ id: ic.id, label: ic.label, cat: 'Animated' });
    stat.push({ id: ic.id + '-static', label: ic.label + ' (Static)', cat: 'Static' });
  });
  /* replaced originals leave their old category; the new Animated / Static groups come first */
  /* Day-only graphics for now: the new Showers stands in for both original showers icons, and
     night variants are hidden from the library (saved scenes that use them still draw). */
  const ALIAS = { 'showers-day': 'showers', 'showers-night': 'showers', 'overcast': 'cloudy' };   // Overcast is dropped: Cloudy covers it
  const rest = Icons.list.filter(i => !HD[i.id] && !ALIAS[i.id] && !/night/.test(i.id));
  Icons.list.length = 0; Array.prototype.push.apply(Icons.list, anim.concat(stat, rest));

  const _draw = Icons.draw, _has = Icons.has, _label = Icons.label;
  Icons.has = id => !!HD[id] || !!ALIAS[id] || _has(id);
  Icons.label = id => HD[ALIAS[id] || id] ? HD[ALIAS[id] || id].label : _label(id);
  const _from = Icons.fromText; Icons.fromText = (txt) => { const id = _from.call(Icons, txt, true); return ALIAS[id] || id; };   // day icons only
  Icons.draw = function (ctx, id, cx, cy, size, t) {
    id = ALIAS[id] || id; const e = HD[id]; if (!e) return _draw.call(Icons, ctx, id, cx, cy, size, t);
    const ph = e.still ? (e.ic.st != null ? e.ic.st : STATIC_T / LOOP) : (((t || 0) % LOOP) + LOOP) % LOOP / LOOP;
    ctx.save(); try {
      ctx.translate(cx, cy); const s = size / 400; ctx.scale(s, s); ctx.scale(e.ic.k || 1, e.ic.k || 1); ctx.translate(-200, -e.ic.oy);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; e.ic.fn(ctx, ph);
    } finally { ctx.restore(); }
  };
  Icons.hd = { ids: ICONS.map(i => i.id), loaded: () => Object.keys(IMG).every(ok) };
})(typeof window !== 'undefined' ? window : globalThis);
