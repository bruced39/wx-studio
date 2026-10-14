/* WX Studio – animated weather icon library.
 * Every icon is drawn procedurally on a 2D canvas as a pure function of time t (seconds),
 * so the same code drives live preview AND frame-exact video export.
 * Icons are drawn in a 100x100 unit box centred on (0,0).                                   */
(function (g) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fract = v => v - Math.floor(v);

  /* ---------- small drawing parts ---------- */
  function cloudPath(c, x, y, s) {
    c.beginPath();
    c.moveTo(x - 26 * s, y + 17 * s);
    c.arc(x - 24 * s, y + 3 * s, 14 * s, Math.PI * 0.5, Math.PI * 1.5);
    c.arc(x - 4 * s, y - 8 * s, 20 * s, Math.PI, Math.PI * 1.85);
    c.arc(x + 20 * s, y + 2 * s, 15 * s, Math.PI * 1.45, Math.PI * 0.5);
    c.closePath();
  }
  const TONES = {
    white: ['#ffffff', '#c9d6e6'],
    light: ['#f2f6fb', '#aebdd0'],
    grey:  ['#c4ccd8', '#87939f'],
    dark:  ['#8b96a5', '#4a5360'],
    storm: ['#6d7787', '#363e4a']
  };
  function cloud(c, x, y, s, tone, t, ph) {
    const bob = Math.sin(t * 1.1 + (ph || 0)) * 1.6 * s;
    const dx = Math.sin(t * 0.7 + (ph || 0) * 1.7) * 2.2 * s;
    const tn = TONES[tone || 'white'];
    c.save();
    c.shadowColor = 'rgba(0,10,30,0.35)'; c.shadowBlur = 10 * s; c.shadowOffsetY = 3 * s;
    const gr = c.createLinearGradient(0, y - 28 * s + bob, 0, y + 18 * s + bob);
    gr.addColorStop(0, tn[0]); gr.addColorStop(1, tn[1]);
    c.fillStyle = gr;
    cloudPath(c, x + dx, y + bob, s); c.fill();
    c.shadowColor = 'transparent';
    c.lineWidth = 1.2 * s; c.strokeStyle = 'rgba(255,255,255,0.55)'; c.stroke();
    c.restore();
  }
  function sun(c, x, y, r, t, dim) {
    c.save(); c.translate(x, y);
    const pulse = 1 + Math.sin(t * 2) * 0.03;
    const glow = c.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 2.4);
    glow.addColorStop(0, `rgba(255,205,60,${0.5 * (dim ? 0.5 : 1)})`); glow.addColorStop(1, 'rgba(255,205,60,0)');
    c.fillStyle = glow; c.beginPath(); c.arc(0, 0, r * 2.4, 0, TAU); c.fill();
    c.rotate(t * 0.25);
    c.lineCap = 'round'; c.strokeStyle = dim ? '#e8b550' : '#ffc83d'; c.lineWidth = r * 0.2;
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12, L = (i % 2 ? 0.36 : 0.52) * r * pulse;
      c.beginPath(); c.moveTo(Math.cos(a) * r * 1.3, Math.sin(a) * r * 1.3);
      c.lineTo(Math.cos(a) * (r * 1.3 + L), Math.sin(a) * (r * 1.3 + L)); c.stroke();
    }
    c.rotate(-t * 0.25);
    const gr = c.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.1);
    gr.addColorStop(0, dim ? '#ffeaa0' : '#fff3a8'); gr.addColorStop(0.6, dim ? '#f0b040' : '#ffcb2e'); gr.addColorStop(1, dim ? '#d98a1e' : '#ff9d00');
    c.fillStyle = gr; c.beginPath(); c.arc(0, 0, r * pulse, 0, TAU); c.fill();
    c.restore();
  }
  function moon(c, x, y, r, t) {
    c.save(); c.translate(x, y);
    const glow = c.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 2.2);
    glow.addColorStop(0, 'rgba(190,210,255,0.35)'); glow.addColorStop(1, 'rgba(190,210,255,0)');
    c.fillStyle = glow; c.beginPath(); c.arc(0, 0, r * 2.2, 0, TAU); c.fill();
    c.rotate(-0.35 + Math.sin(t * 0.5) * 0.03);
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.clip();
    const gr = c.createLinearGradient(-r, -r, r, r); gr.addColorStop(0, '#fffbe6'); gr.addColorStop(1, '#e6d9a8');
    c.fillStyle = gr;
    c.beginPath(); c.rect(-r * 2, -r * 2, r * 4, r * 4);
    c.arc(r * 0.5, -r * 0.18, r * 0.86, 0, TAU);
    c.fill('evenodd');
    c.restore();
  }
  function stars(c, pts, t) {
    c.save(); c.fillStyle = '#fff';
    pts.forEach((p, i) => {
      const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 2.3 + i * 1.9)), s = p[2] * (0.75 + 0.25 * a);
      c.globalAlpha = a; c.beginPath();
      c.moveTo(p[0], p[1] - s); c.quadraticCurveTo(p[0], p[1], p[0] + s, p[1]);
      c.quadraticCurveTo(p[0], p[1], p[0], p[1] + s); c.quadraticCurveTo(p[0], p[1], p[0] - s, p[1]);
      c.quadraticCurveTo(p[0], p[1], p[0], p[1] - s); c.fill();
    });
    c.restore();
  }
  function drops(c, x0, x1, y0, y1, n, t, o) {
    o = o || {}; const len = (o.len || 9) * 1.2, sl = o.slant == null ? 0.28 : o.slant, w = (o.w || 3) * 1.2, sp = o.speed || 1.1;
    c.save(); c.beginPath(); c.rect(x0 - 6, y0, x1 - x0 + 12, y1 - y0); c.clip();
    c.lineCap = 'round'; c.lineWidth = w;
    for (let i = 0; i < n; i++) {
      const ph = fract(t * sp + i / n + (i % 2) * 0.13), yy = y0 - len + ph * (y1 - y0 + len * 2);
      const xx = x0 + (x1 - x0) * ((i + 0.5) / n) - (yy - y0) * sl * 0.5;
      c.globalAlpha = Math.sin(ph * Math.PI) * 0.95 + 0.05;
      c.strokeStyle = o.color || '#58a9ff';
      c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx - len * sl, yy + len); c.stroke();
      if (o.ice) { c.fillStyle = '#e6f6ff'; c.beginPath(); c.arc(xx - len * sl, yy + len, w * 0.75, 0, TAU); c.fill(); }
    }
    c.restore();
  }
  function flake(c, x, y, r, rot) {
    c.save(); c.translate(x, y); c.rotate(rot); c.lineCap = 'round'; c.lineWidth = Math.max(1.2, r * 0.28);
    for (let i = 0; i < 3; i++) { c.rotate(Math.PI / 3); c.beginPath(); c.moveTo(-r, 0); c.lineTo(r, 0); c.stroke(); }
    c.restore();
  }
  function snow(c, x0, x1, y0, y1, n, t, o) {
    o = o || {}; const r = (o.r || 3.6) * 1.35, sp = o.speed || 0.38;
    c.save(); c.beginPath(); c.rect(x0 - 6, y0, x1 - x0 + 12, y1 - y0); c.clip();
    c.strokeStyle = o.color || '#ffffff';
    for (let i = 0; i < n; i++) {
      const ph = fract(t * sp + i / n + (i % 3) * 0.09), yy = y0 - r + ph * (y1 - y0 + r * 2);
      const xx = x0 + (x1 - x0) * ((i + 0.5) / n) + Math.sin(t * 1.6 + i * 2.1) * 4;
      c.globalAlpha = Math.sin(ph * Math.PI) * 0.95 + 0.05;
      flake(c, xx, yy, r, t * 0.8 + i);
    }
    c.restore();
  }
  function pellets(c, x0, x1, y0, y1, n, t, col, r, sp) {
    c.save(); c.beginPath(); c.rect(x0 - 4, y0, x1 - x0 + 8, y1 - y0); c.clip();
    for (let i = 0; i < n; i++) {
      const ph = fract(t * (sp || 1.0) + i / n + 0.31), yy = y0 + ph * (y1 - y0), xx = x0 + (x1 - x0) * ((i + 0.5) / n);
      c.globalAlpha = Math.sin(ph * Math.PI) * 0.9 + 0.1; c.fillStyle = col || '#eaf6ff'; c.strokeStyle = 'rgba(120,170,220,.9)'; c.lineWidth = 1;
      c.beginPath(); c.arc(xx, yy, (r || 2.8) * 1.2, 0, TAU); c.fill(); c.stroke();
    }
    c.restore();
  }
  function bolt(c, x, y, s, t, strong) {
    const f = Math.pow(Math.max(0, Math.sin(t * 2.4)), strong ? 6 : 14), a = 0.55 + 0.45 * f;
    c.save(); c.translate(x, y); c.scale(s, s);
    if (f > 0.05) { const gl = c.createRadialGradient(0, 8, 2, 0, 8, 38); gl.addColorStop(0, `rgba(255,240,150,${0.55 * f})`); gl.addColorStop(1, 'rgba(255,240,150,0)'); c.fillStyle = gl; c.fillRect(-40, -30, 80, 80); }
    c.globalAlpha = a; c.beginPath();
    c.moveTo(5, -14); c.lineTo(-9, 6); c.lineTo(-1, 6); c.lineTo(-6, 26); c.lineTo(10, 1); c.lineTo(2, 1); c.lineTo(9, -14); c.closePath();
    const gr = c.createLinearGradient(0, -14, 0, 26); gr.addColorStop(0, '#fff38a'); gr.addColorStop(1, '#ffb400');
    c.fillStyle = gr; c.fill(); c.lineWidth = 1.6; c.strokeStyle = '#ff8c00'; c.lineJoin = 'round'; c.stroke();
    c.restore();
  }
  function fogBars(c, y0, n, t, w, col) {
    c.save(); c.lineCap = 'round'; c.lineWidth = 6.5;
    for (let i = 0; i < n; i++) {
      const x = Math.sin(t * 0.8 + i * 1.3) * 7, y = y0 + i * 12, ww = (w || 62) - (i % 2) * 14;
      c.strokeStyle = col || 'rgba(226,234,244,0.92)'; c.globalAlpha = 0.65 + 0.35 * Math.sin(t * 0.9 + i);
      c.beginPath(); c.moveTo(-ww / 2 + x, y); c.lineTo(ww / 2 + x, y); c.stroke();
    }
    c.restore();
  }
  function windLines(c, t, ys, col) {
    c.save(); c.lineCap = 'round'; c.lineWidth = 5.5; c.strokeStyle = col || '#e6f3ff';
    ys.forEach((yy, i) => {
      const sway = Math.sin(t * 1.8 + i * 1.4) * 6, L = (62 + Math.sin(t * 2.2 + i) * 8) - i * 7;
      const x0 = -44 + sway, x1 = x0 + L, k = 15 - i * 2;
      c.globalAlpha = 0.78 + 0.22 * Math.sin(t * 2 + i);
      c.beginPath(); c.moveTo(x0, yy); c.lineTo(x1, yy);
      c.bezierCurveTo(x1 + k + 8, yy, x1 + k + 11, yy - k * 1.7, x1 + k * 0.3, yy - k * 1.4); c.stroke();
      const ph = fract(t * 0.55 + i * 0.37); c.globalAlpha = Math.sin(ph * Math.PI) * 0.8;
      c.lineWidth = 3; c.beginPath(); c.moveTo(-46 + ph * 96, yy + 9); c.lineTo(-46 + ph * 96 + 14, yy + 9); c.stroke(); c.lineWidth = 5.5;
    });
    c.restore();
  }
  function dustParts(c, t, n) {
    c.save();
    for (let i = 0; i < n; i++) {
      const ph = fract(t * (0.35 + (i % 3) * 0.12) + i * 0.173), x = -44 + ph * 88, y = -34 + ((i * 29) % 78) + Math.sin(t * 3 + i) * 3;
      c.globalAlpha = Math.sin(ph * Math.PI) * 0.95; c.fillStyle = i % 2 ? '#d9b680' : '#b98f55';
      c.beginPath(); c.arc(x, y, 2 + (i % 3) * 0.9, 0, TAU); c.fill();
    }
    c.restore();
  }
  function thermometer(c, x, y, s, level, col, t) {
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = 'rgba(255,255,255,0.92)'; c.beginPath(); c.arc(0, 22, 12, 0, TAU); c.fill();
    rr(c, -6.5, -38, 13, 62, 6.5); c.fill();
    c.fillStyle = col; c.beginPath(); c.arc(0, 22, 8, 0, TAU); c.fill();
    const lv = clamp(level + Math.sin(t * 2) * 0.04, 0, 1), top = 20 - lv * 52;
    rr(c, -3.4, top, 6.8, 20 - top + 2, 3.4); c.fill();
    c.restore();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  const STARS = [[-34, -34, 4], [30, -40, 3.2], [-8, -44, 2.6], [40, -12, 2.4], [-42, -8, 2.2]];
  const STARS_FEW = [[-36, -36, 3.6], [32, -42, 2.8]];

  /* ---------- icon recipes ---------- */
  const R = {};
  const add = (id, label, cat, fn) => { R[id] = { id, label, cat, fn }; };

  // clear / sun
  add('sunny', 'Sunny', 'Sky', (c, t) => { sun(c, 0, 0, 20, t); });
  add('mostly-sunny', 'Mostly Sunny', 'Sky', (c, t) => { sun(c, -6, -8, 20, t); cloud(c, 18, 20, 0.62, 'white', t, 1); });
  add('partly-cloudy', 'Partly Cloudy', 'Sky', (c, t) => { sun(c, -14, -14, 18, t); cloud(c, 8, 12, 0.92, 'white', t, 2); });
  add('mostly-cloudy', 'Mostly Cloudy', 'Sky', (c, t) => { sun(c, -18, -22, 14, t, true); cloud(c, -8, 6, 0.85, 'light', t, 0.5); cloud(c, 18, 18, 0.75, 'white', t, 2.4); });
  add('cloudy', 'Cloudy', 'Sky', (c, t) => { cloud(c, 16, -6, 0.72, 'light', t, 0.6); cloud(c, -6, 12, 1.0, 'grey', t, 1.9); });
  add('overcast', 'Overcast', 'Sky', (c, t) => { cloud(c, -14, -8, 0.8, 'grey', t, 0.2); cloud(c, 18, -4, 0.8, 'dark', t, 1.4); cloud(c, 0, 14, 1.0, 'grey', t, 2.6); });
  // night
  add('clear-night', 'Clear Night', 'Sky', (c, t) => { moon(c, 0, 2, 26, t); stars(c, STARS, t); });
  add('mostly-clear-night', 'Mostly Clear Night', 'Sky', (c, t) => { moon(c, -8, -8, 24, t); stars(c, STARS_FEW, t); cloud(c, 16, 20, 0.6, 'light', t, 1); });
  add('partly-cloudy-night', 'Partly Cloudy Night', 'Sky', (c, t) => { moon(c, -14, -14, 20, t); stars(c, STARS_FEW, t); cloud(c, 8, 12, 0.92, 'light', t, 2); });
  add('mostly-cloudy-night', 'Mostly Cloudy Night', 'Sky', (c, t) => { moon(c, -20, -22, 15, t); cloud(c, -8, 6, 0.85, 'grey', t, 0.5); cloud(c, 18, 18, 0.75, 'light', t, 2.4); });
  // rain
  add('drizzle', 'Drizzle', 'Rain', (c, t) => { cloud(c, 0, -14, 1.0, 'grey', t, 0.3); drops(c, -26, 26, 12, 46, 8, t, { len: 6, w: 2.2, speed: 0.9, color: '#8fc6ff' }); });
  add('light-rain', 'Light Rain', 'Rain', (c, t) => { cloud(c, 0, -14, 1.0, 'grey', t, 0.3); drops(c, -24, 24, 12, 46, 5, t, { len: 9, w: 3 }); });
  add('rain', 'Rain', 'Rain', (c, t) => { cloud(c, 0, -14, 1.0, 'dark', t, 0.3); drops(c, -28, 28, 12, 48, 8, t, { len: 10, w: 3.2, speed: 1.2 }); });
  add('heavy-rain', 'Heavy Rain', 'Rain', (c, t) => { cloud(c, 0, -16, 1.04, 'storm', t, 0.3); drops(c, -30, 30, 10, 50, 13, t, { len: 12, w: 3.4, speed: 1.6, color: '#3d94ff' }); });
  add('showers-day', 'Showers (Day)', 'Rain', (c, t) => { sun(c, -16, -22, 14, t); cloud(c, 4, -2, 0.92, 'grey', t, 0.8); drops(c, -18, 24, 22, 48, 5, t, { len: 9 }); });
  add('showers-night', 'Showers (Night)', 'Rain', (c, t) => { moon(c, -18, -24, 14, t); cloud(c, 4, -2, 0.92, 'grey', t, 0.8); drops(c, -18, 24, 22, 48, 5, t, { len: 9 }); });
  // storms
  add('thunderstorm', 'Thunderstorms', 'Storm', (c, t) => { cloud(c, 0, -16, 1.04, 'storm', t, 0.3); drops(c, -30, 30, 10, 50, 8, t, { len: 10, w: 3 }); bolt(c, 3, 20, 0.95, t); });
  add('tstorm-day', 'Scattered T-storms (Day)', 'Storm', (c, t) => { sun(c, -18, -24, 13, t, true); cloud(c, 4, -4, 0.95, 'dark', t, 0.8); drops(c, -22, 26, 16, 50, 5, t, { len: 9 }); bolt(c, 6, 24, 0.8, t); });
  add('tstorm-night', 'Scattered T-storms (Night)', 'Storm', (c, t) => { moon(c, -18, -24, 14, t); cloud(c, 4, -4, 0.95, 'dark', t, 0.8); drops(c, -22, 26, 16, 50, 5, t, { len: 9 }); bolt(c, 6, 24, 0.8, t); });
  add('severe-tstorm', 'Severe T-storms', 'Storm', (c, t) => { cloud(c, 0, -18, 1.08, 'storm', t, 0.3); drops(c, -30, 30, 8, 50, 11, t, { len: 12, w: 3.4, speed: 1.7, color: '#3d94ff' }); pellets(c, -22, 22, 12, 50, 4, t, '#fff', 3.2, 1.3); bolt(c, 0, 18, 1.15, t + 0.4, true); });
  // winter
  add('flurries', 'Flurries', 'Winter', (c, t) => { cloud(c, 0, -14, 1.0, 'light', t, 0.3); snow(c, -22, 22, 10, 46, 4, t, { r: 3 }); });
  add('snow', 'Snow', 'Winter', (c, t) => { cloud(c, 0, -14, 1.0, 'grey', t, 0.3); snow(c, -26, 26, 10, 48, 6, t); });
  add('heavy-snow', 'Heavy Snow', 'Winter', (c, t) => { cloud(c, 0, -16, 1.04, 'dark', t, 0.3); snow(c, -30, 30, 8, 50, 10, t, { r: 4, speed: 0.55 }); });
  add('snow-showers-day', 'Snow Showers (Day)', 'Winter', (c, t) => { sun(c, -16, -22, 14, t); cloud(c, 4, -2, 0.92, 'grey', t, 0.8); snow(c, -18, 24, 22, 48, 5, t, { r: 3.4 }); });
  add('snow-showers-night', 'Snow Showers (Night)', 'Winter', (c, t) => { moon(c, -18, -24, 14, t); cloud(c, 4, -2, 0.92, 'grey', t, 0.8); snow(c, -18, 24, 22, 48, 5, t, { r: 3.4 }); });
  add('blizzard', 'Blizzard', 'Winter', (c, t) => { cloud(c, 0, -20, 1.0, 'dark', t, 0.3); snow(c, -34, 34, 4, 50, 11, t, { r: 3.4, speed: 0.9 }); c.save(); c.globalAlpha = 0.85; windLines(c, t, [26, 40], '#ffffff'); c.restore(); });
  add('sleet', 'Sleet', 'Winter', (c, t) => { cloud(c, 0, -14, 1.0, 'grey', t, 0.3); drops(c, -28, -2, 12, 48, 3, t, { len: 9 }); pellets(c, 4, 28, 12, 48, 3, t); });
  add('wintry-mix', 'Wintry Mix', 'Winter', (c, t) => { cloud(c, 0, -14, 1.0, 'grey', t, 0.3); drops(c, -30, -12, 12, 48, 2, t, { len: 9 }); snow(c, -8, 10, 12, 48, 2, t, { r: 3.2 }); pellets(c, 14, 30, 12, 48, 2, t); });
  add('freezing-rain', 'Freezing Rain', 'Winter', (c, t) => { cloud(c, 0, -14, 1.0, 'grey', t, 0.3); drops(c, -26, 26, 12, 48, 6, t, { len: 9, color: '#6fd6ff', ice: true }); });
  add('hail', 'Hail', 'Winter', (c, t) => { cloud(c, 0, -14, 1.0, 'storm', t, 0.3); pellets(c, -26, 26, 14, 50, 6, t, '#ffffff', 4, 1.35); });
  // obstructions / wind
  add('fog', 'Fog', 'Other', (c, t) => { cloud(c, 0, -18, 0.9, 'light', t, 0.4); fogBars(c, 8, 4, t); });
  add('haze', 'Haze', 'Other', (c, t) => { sun(c, 0, -10, 17, t, true); fogBars(c, 18, 3, t, 66, 'rgba(214,190,150,0.9)'); });
  add('smoke', 'Smoke', 'Other', (c, t) => { sun(c, 0, -12, 16, t, true); fogBars(c, 14, 4, t, 66, 'rgba(168,150,134,0.92)'); });
  add('dust', 'Blowing Dust', 'Other', (c, t) => { dustParts(c, t, 22); windLines(c, t, [-6, 14, 34], '#e6cfa3'); });
  add('windy', 'Windy', 'Other', (c, t) => { windLines(c, t, [-6, 14, 34], '#e6f3ff'); });
  add('breezy', 'Breezy', 'Other', (c, t) => { sun(c, 14, -22, 13, t); c.save(); c.scale(0.9, 0.9); windLines(c, t, [8, 28], '#e6f3ff'); c.restore(); });
  add('tornado', 'Tornado', 'Severe', (c, t) => {
    cloud(c, 0, -22, 1.1, 'storm', t, 0.5);
    for (let i = 0; i < 8; i++) {
      const k = i / 7, w = 36 - k * 30, y = -4 + i * 8.2, sw = Math.sin(t * 3 + i * 0.7) * (3 + k * 5);
      c.fillStyle = `rgba(${150 - i * 8},${158 - i * 8},${168 - i * 8},0.95)`;
      c.beginPath(); c.ellipse(sw, y, w / 2, 4.4, 0, 0, TAU); c.fill();
    }
    c.fillStyle = '#c9b48a';
    for (let i = 0; i < 6; i++) { const a = t * 4 + i * 1.05, rx = 22 + (i % 3) * 5; c.globalAlpha = 0.85; c.beginPath(); c.arc(Math.cos(a) * rx, 36 + Math.sin(a) * 4, 1.8, 0, TAU); c.fill(); }
    c.globalAlpha = 1;
  });
  add('hurricane', 'Hurricane', 'Severe', (c, t) => { hurricane(c, 0, 0, 40, t, 'H'); });
  add('tropical-storm', 'Tropical Storm', 'Severe', (c, t) => { hurricane(c, 0, 0, 40, t, 'TS'); });
  add('hot', 'Hot', 'Other', (c, t) => { sun(c, 14, -14, 15, t); thermometer(c, -16, 4, 0.85, 0.92, '#ff3b30', t); });
  add('cold', 'Cold', 'Other', (c, t) => { thermometer(c, -18, 0, 0.85, 0.12, '#38a3ff', t); c.strokeStyle = '#dff1ff'; flake(c, 18, -4, 15, t * 0.5); });
  add('frost', 'Frost', 'Other', (c, t) => { c.strokeStyle = '#dff1ff'; c.shadowColor = 'rgba(150,210,255,.8)'; c.shadowBlur = 12; flake(c, 0, 0, 34, t * 0.25); c.shadowBlur = 0; stars(c, [[-30, -30, 4], [32, 30, 3.4]], t); });

  function hurricane(c, x, y, r, t, kind) {
    c.save(); c.translate(x, y);
    const col = kind === 'H' ? '#ff4d4d' : kind === 'TS' ? '#ffa62b' : '#ffd84d';
    const gl = c.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 1.15); gl.addColorStop(0, 'rgba(255,255,255,0.25)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gl; c.beginPath(); c.arc(0, 0, r * 1.15, 0, TAU); c.fill();
    c.rotate(-t * 1.6); c.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      c.rotate(Math.PI);
      c.beginPath();
      for (let i = 0; i <= 40; i++) { const a = i / 40 * 4.2, rad = r * (0.16 + 0.84 * i / 40), px = Math.cos(a) * rad, py = Math.sin(a) * rad; i ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.lineWidth = r * 0.2; c.strokeStyle = col; c.stroke();
      c.lineWidth = r * 0.07; c.strokeStyle = 'rgba(255,255,255,0.8)'; c.stroke();
    }
    c.fillStyle = '#0a1a2e'; c.beginPath(); c.arc(0, 0, r * 0.14, 0, TAU); c.fill();
    c.restore();
  }

  /* ---------- public API ---------- */
  const Icons = {
    list: Object.values(R).map(o => ({ id: o.id, label: o.label, cat: o.cat })),
    has: id => !!R[id],
    label: id => (R[id] ? R[id].label : id),
    draw(ctx, id, cx, cy, size, t) {
      const ic = R[id]; if (!ic) return;
      ctx.save(); ctx.translate(cx, cy); const s = size / 100; ctx.scale(s, s);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      try { ic.fn(ctx, t || 0); } finally { ctx.restore(); }
    },
    /* map NWS "shortForecast"-style text to an icon id */
    fromText(txt, isDay) {
      const s = String(txt || '').toLowerCase(), d = isDay !== false;
      const has = (...w) => w.some(x => s.includes(x));
      if (has('tornado')) return 'tornado';
      if (has('hurricane')) return 'hurricane';
      if (has('tropical')) return 'tropical-storm';
      if (has('blizzard')) return 'blizzard';
      if (has('freezing rain', 'freezing drizzle')) return 'freezing-rain';
      if (has('wintry', 'rain and snow', 'snow and rain', 'rain/snow')) return 'wintry-mix';
      if (has('sleet', 'ice pellets')) return 'sleet';
      if (has('hail')) return 'hail';
      if (has('severe')) return 'severe-tstorm';
      if (has('thunder')) return has('chance', 'scattered', 'isolated', 'slight') ? (d ? 'tstorm-day' : 'tstorm-night') : 'thunderstorm';
      if (has('heavy snow')) return 'heavy-snow';
      if (has('flurr')) return 'flurries';
      if (has('snow showers')) return d ? 'snow-showers-day' : 'snow-showers-night';
      if (has('snow')) return 'snow';
      if (has('heavy rain')) return 'heavy-rain';
      if (has('drizzle')) return 'drizzle';
      if (has('showers', 'chance rain', 'scattered rain', 'slight chance rain', 'isolated')) return d ? 'showers-day' : 'showers-night';
      if (has('light rain')) return 'light-rain';
      if (has('rain')) return 'rain';
      if (has('fog')) return 'fog';
      if (has('smoke')) return 'smoke';
      if (has('haze')) return 'haze';
      if (has('dust')) return 'dust';
      if (has('windy', 'gusty')) return 'windy';
      if (has('breezy')) return 'breezy';
      if (has('mostly cloudy')) return d ? 'mostly-cloudy' : 'mostly-cloudy-night';
      if (has('partly cloudy', 'partly sunny')) return d ? 'partly-cloudy' : 'partly-cloudy-night';
      if (has('overcast')) return 'overcast';
      if (has('cloudy')) return 'cloudy';
      if (has('mostly sunny')) return 'mostly-sunny';
      if (has('mostly clear')) return d ? 'mostly-sunny' : 'mostly-clear-night';
      if (has('sunny', 'clear', 'fair')) return d ? 'sunny' : 'clear-night';
      if (has('hot')) return 'hot'; if (has('cold')) return 'cold'; if (has('frost')) return 'frost';
      return d ? 'partly-cloudy' : 'partly-cloudy-night';
    },
    hurricaneSymbol: hurricane
  };
  g.Icons = Icons;
})(typeof window !== 'undefined' ? window : globalThis);
