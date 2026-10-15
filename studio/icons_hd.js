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

  /* ---- streak rain (steady, straight) ---- */
  function rain(c, ph, p) {
    const r = rng(p.seed); c.save(); c.lineCap = 'round';
    for (let i = 0; i < p.n; i++) {
      const x = p.x0 + p.xw * r(), spd = p.spd + (r() < p.spdP ? 1 : 0), f = ((ph * spd + r()) % 1), y = p.top + p.len * f,
        a = Math.min(1, f * p.fk) * Math.sin(Math.PI * Math.min(1, f * p.fs)) ** 0.7, L = p.L * (0.8 + 0.5 * r()), w = p.w0 + p.w1 * r();
      const gr = c.createLinearGradient(x, y, x - L * 0.25, y + L); gr.addColorStop(0, 'rgba(200,225,255,0)'); gr.addColorStop(1, 'rgba(214,234,255,' + (p.aS * a) + ')');
      c.strokeStyle = gr; c.lineWidth = w; c.shadowColor = 'rgba(120,180,255,' + (p.aG * a) + ')'; c.shadowBlur = p.blur; c.beginPath(); c.moveTo(x, y); c.lineTo(x - L * 0.25, y + L); c.stroke();
    }
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
  function snow(c, ph, p) {
    const r = rng(p.seed); c.save();
    for (let i = 0; i < p.n; i++) {
      const x0 = 100 + 200 * r(), spd = 1 + (r() < 0.5 ? 1 : 0), off = r(), f = ((ph * spd + off) % 1), y = 264 + 215 * f, sw = p.s0 + p.s1 * r(), x = x0 + sw * Math.sin(TAU * (ph * spd + off)),
        a = Math.min(1, f * 6) * Math.sin(Math.PI * Math.min(1, f * 1.05)) ** 0.6, R = p.r0 + p.r1 * r(), rot = (r() < 0.5 ? 1 : -1) * TAU * (ph * spd + off) + r() * 6;
      flake(c, x, y, R, rot, a);
    }
    c.restore();
  }

  /* ---- blizzard: snow pours out of the cloud, drops a little, then is driven left by the wind ---- */
  function blizzard(c, ph) {
    const r = rng(77); c.save(); c.lineCap = 'round';
    c.save(); c.translate(205, 415); c.scale(1.15, 0.8); const hz = c.createRadialGradient(0, 0, 0, 0, 0, 170); hz.addColorStop(0, 'rgba(225,238,255,' + (0.18 + 0.06 * Math.sin(ph * TAU)) + ')'); hz.addColorStop(1, 'rgba(225,238,255,0)'); c.fillStyle = hz; c.beginPath(); c.arc(0, 0, 170, 0, TAU); c.fill(); c.restore();
    const mk = () => { const xs = 90 + 250 * r(), xe = xs - (40 + 150 * r()), H = 70 + 140 * r(), y0 = 282 + 8 * r(); return { xs, D: xs - xe, H, y0 }; };
    const P = (q, u) => [q.xs - q.D * Math.pow(u, 2.4) + 4 * Math.sin(u * 9), q.y0 + q.H * Math.pow(u, 0.8)];
    for (let i = 0; i < 18; i++) {
      const q = mk(), spd = 1 + (r() < 0.5 ? 1 : 0), off = r(), u = ((ph * spd + off) % 1), a = Math.sin(Math.PI * u) ** 0.8 * 0.2, wd = 2.5 + 3 * r();
      for (let k = 0; k < 10; k++) { const ua = Math.max(0, u - 0.34 + k * 0.034), ub = Math.max(0, u - 0.34 + (k + 1) * 0.034); if (ub <= 0) continue; const A = P(q, ua), B = P(q, Math.min(1, ub)); c.strokeStyle = 'rgba(235,245,255,' + (a * ((k + 1) / 10) ** 1.5) + ')'; c.lineWidth = wd; c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke(); }
    }
    for (let i = 0; i < 300; i++) {
      const q = mk(), spd = 2 + (r() < 0.5 ? 1 : 0), off = r(), u = ((ph * spd + off) % 1), a = Math.sin(Math.PI * u) ** 0.5 * Math.min(1, u * 10), kind = r(), R = 2.2 + 3.2 * r(), Lg = 0.07 + 0.10 * r(), w = 1.6 + 2.2 * r(), rs = r();
      const H = P(q, u), T = P(q, Math.max(0, u - Lg));
      if (kind < 0.3) flake(c, H[0], H[1], R * 1.9, TAU * (ph * spd + off) * (rs < 0.5 ? 1 : -1) + rs * 6, a * 0.95);
      else { const g = c.createLinearGradient(H[0], H[1], T[0], T[1]); g.addColorStop(0, 'rgba(245,250,255,' + (0.92 * a) + ')'); g.addColorStop(1, 'rgba(245,250,255,0)'); c.strokeStyle = g; c.lineWidth = w; c.shadowColor = 'rgba(170,210,255,' + (0.6 * a) + ')'; c.shadowBlur = 4; c.beginPath(); c.moveTo(H[0], H[1]); c.lineTo(T[0], T[1]); c.stroke(); c.shadowBlur = 0; }
    }
    c.restore();
  }

  /* rain presets on the grey cloud (cloud centre y=232, rain starts under it) */
  const RP = (o) => Object.assign({ seed: 9, x0: 95, xw: 210, spd: 4, spdP: 0.4, top: 267, len: 190, fk: 6, fs: 1.06, L: 26, w0: 2.3, w1: 2.1, aS: 0.95, aG: 0.7, blur: 4 }, o);
  const P_RAIN = RP({}), P_SHOWERS = RP({ n: 11, spd: 3, L: 20, w0: 1.8, w1: 1.4 }), P_DRIZZLE = RP({ n: 6, spd: 2, spdP: 0.5, L: 27, w0: 3.4, w1: 1.6, aS: 0.92, aG: 0.65, blur: 5 }), P_HEAVY = RP({ n: 75, spd: 5, spdP: 0.5, L: 34, w0: 2.8, w1: 2.4 });
  P_RAIN.n = 34;
  /* rain on his Mostly Sunny artwork */
  const PM = (o) => ({ seed: 5, x0: 120, xw: 190, spd: 4, spdP: 0.4, top: 308, len: 165, fk: 5, fs: 1.08, L: 24, w0: 2.2, w1: 2, aS: 0.95, aG: 0.7, blur: 4, n: 30, ...o });

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
    { id: 'mostly-sunny-rain', label: 'Mostly Sunny/Rain', oy: 290, fn: (c, ph) => { mostlyImg(c, ph); rain(c, ph, PM({})); } },
    { id: 'mostly-sunny-showers', label: 'Mostly Sunny/Showers', oy: 290, fn: (c, ph) => { mostlyImg(c, ph); rain(c, ph, PM({ n: 11, spd: 3, L: 20, w0: 1.8, w1: 1.4 })); } }
  ];
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
  const rest = Icons.list.filter(i => !HD[i.id]);
  Icons.list.length = 0; Array.prototype.push.apply(Icons.list, anim.concat(stat, rest));

  const _draw = Icons.draw, _has = Icons.has, _label = Icons.label;
  Icons.has = id => !!HD[id] || _has(id);
  Icons.label = id => HD[id] ? HD[id].label : _label(id);
  Icons.draw = function (ctx, id, cx, cy, size, t) {
    const e = HD[id]; if (!e) return _draw.call(Icons, ctx, id, cx, cy, size, t);
    const ph = e.still ? STATIC_T / LOOP : (((t || 0) % LOOP) + LOOP) % LOOP / LOOP;
    ctx.save(); try {
      ctx.translate(cx, cy); const s = size / 400; ctx.scale(s, s); ctx.scale(e.ic.k || 1, e.ic.k || 1); ctx.translate(-200, -e.ic.oy);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; e.ic.fn(ctx, ph);
    } finally { ctx.restore(); }
  };
  Icons.hd = { ids: ICONS.map(i => i.id), loaded: () => Object.keys(IMG).every(ok) };
})(typeof window !== 'undefined' ? window : globalThis);
