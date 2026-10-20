/* WX Studio – map symbols: H/L pressure centres, fronts, animated arrows, isobars, wind barbs.
 * Pure functions of time t so they render identically live and in exported video.             */
(function (g) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fract = v => v - Math.floor(v);
  const FONT = '"Barlow Condensed","Arial Narrow","Segoe UI",Arial,sans-serif';

  /* ---------- path helpers ---------- */
  function catmull(pts, closed, seg) {
    seg = seg || 10; const n = pts.length;
    if (n < 2) return pts.map(p => [p[0], p[1]]);
    if (n === 2 && !closed) return pts.map(p => [p[0], p[1]]);
    const P = i => closed ? pts[(i % n + n) % n] : pts[clamp(i, 0, n - 1)];
    const last = closed ? n : n - 1, out = [];
    for (let i = 0; i < last; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let k = 0; k < seg; k++) {
        const u = k / seg, u2 = u * u, u3 = u2 * u;
        const f = j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u3);
        out.push([f(0), f(1)]);
      }
    }
    out.push(closed ? [out[0][0], out[0][1]] : [pts[n - 1][0], pts[n - 1][1]]);
    return out;
  }
  function measure(poly) {
    const cum = [0];
    for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    return { poly, cum, L: cum[cum.length - 1] || 0 };
  }
  function at(m, s) {
    const { poly, cum } = m; if (poly.length < 2) return { x: poly[0] ? poly[0][0] : 0, y: poly[0] ? poly[0][1] : 0, tx: 1, ty: 0 };
    s = clamp(s, 0, m.L); let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const a = poly[lo], b = poly[hi], seg = cum[hi] - cum[lo] || 1, u = (s - cum[lo]) / seg;
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, tx, ty };
  }
  function upTo(m, Lp) {
    if (Lp >= m.L - 0.01) return m.poly;
    const out = []; for (let i = 0; i < m.poly.length && m.cum[i] <= Lp; i++) out.push(m.poly[i]);
    const e = at(m, Lp); out.push([e.x, e.y]); return out;
  }
  function strokePoly(c, poly) { if (poly.length < 2) return; c.beginPath(); c.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) c.lineTo(poly[i][0], poly[i][1]); }
  function pill(c, text, x, y, size, bg, fg) {
    c.save(); c.font = `700 ${size}px ${FONT}`; const w = c.measureText(text).width + size * 0.7, h = size * 1.25;
    c.fillStyle = bg || 'rgba(8,20,38,0.78)'; c.beginPath();
    const r = h / 2, x0 = x - w / 2, y0 = y - h / 2; c.moveTo(x0 + r, y0); c.arcTo(x0 + w, y0, x0 + w, y0 + h, r); c.arcTo(x0 + w, y0 + h, x0, y0 + h, r); c.arcTo(x0, y0 + h, x0, y0, r); c.arcTo(x0, y0, x0 + w, y0, r); c.closePath(); c.fill();
    c.fillStyle = fg || '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y + size * 0.04); c.restore();
  }

  /* ---------- H / L pressure centres ----------
   * The badge artwork is the user's own transparent PNG (hl_art.js). Until it has decoded, the original drawn
   * letter is used instead so a pressure centre never disappears from a preview or export. */
  const HLI = {}, HL_RING = 0.964;   // opaque ring = 96.4% of the artwork width (the rest is its soft shadow)
  function hlArt(kind) {
    let e = HLI[kind]; if (e) return e.ok ? e : null;
    const A = g.WX_HL_ART; if (!A || !A[kind] || typeof Image === 'undefined') return null;
    e = HLI[kind] = { ok: false, lv: [] }; const im = new Image();
    im.onload = () => {   // mip chain: small or animated badges stay smooth instead of shimmering
      e.lv = [im]; let w = im.naturalWidth, src = im;
      while (w > 60) { w = Math.round(w / 2); const cv = document.createElement('canvas'); cv.width = cv.height = w; const x = cv.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, w); e.lv.push(cv); src = cv; }
      e.ok = true;
    };
    im.src = A[kind]; return null;
  }
  if (typeof document !== 'undefined') Object.keys(g.WX_HL_ART || {}).forEach(hlArt);   // start decoding at page load so even the first preview/export frame already has the badge
  const lvW = l => l.naturalWidth || l.width;
  function drawHL(c, kind, x, y, size, value, t, o) {
    o = o || {}; const col = kind === 'H' ? '#2f7bff' : '#ff3b3b', glow = kind === 'H' ? 'rgba(47,123,255,' : 'rgba(255,59,59,';
    const prog = o.progress == null ? 1 : o.progress, art = hlArt(kind), badge = size * 1.15;   // visible ring diameter
    c.save(); c.translate(x, y); c.globalAlpha *= clamp(prog * 1.5, 0, 1);
    const sc = 0.6 + 0.4 * Math.min(1, prog * 1.3); c.scale(sc, sc);
    for (let k = 0; k < 2; k++) {                    // pulsing rings
      const ph = fract(t * 0.5 + k * 0.5), r = art ? size * (0.6 + ph * 0.5) : size * (0.62 + ph * 0.5);
      c.strokeStyle = glow + (0.55 * (1 - ph)) + ')'; c.lineWidth = size * 0.05; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
    }
    const gl = c.createRadialGradient(0, 0, size * 0.1, 0, 0, size * 0.8); gl.addColorStop(0, glow + '0.38)'); gl.addColorStop(1, glow + '0)');
    c.fillStyle = gl; c.beginPath(); c.arc(0, 0, size * 0.8, 0, TAU); c.fill();
    const bob = Math.sin(t * 1.6) * size * 0.015;
    if (art) {
      const wd = badge / HL_RING, k = (c.getTransform ? c.getTransform().a : 1) || 1, want = wd * k;
      let lvl = art.lv[0]; for (let i = art.lv.length - 1; i >= 0; i--) if (lvW(art.lv[i]) >= want) { lvl = art.lv[i]; break; }   // smallest level that is still sharp enough
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(lvl, -wd / 2, bob - wd / 2, wd, wd);
    } else {
      c.font = `800 ${size * 1.05}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineJoin = 'round'; c.lineWidth = size * 0.12; c.strokeStyle = 'rgba(255,255,255,0.95)';
      c.strokeText(kind, 0, bob); c.fillStyle = col; c.fillText(kind, 0, bob);
    }
    if (value !== '' && value != null) pill(c, String(value), 0, size * (art ? 0.78 : 0.66), size * 0.3, 'rgba(8,20,38,0.82)', '#fff');
    c.restore();
  }
  const hlBounds = (x, y, size) => ({ x: x - size * 0.62, y: y - size * 0.62, w: size * 1.24, h: size * 1.6 });
  g.WXHLBadgeReady = () => Object.keys(g.WX_HL_ART || {}).every(k => { hlArt(k); return !!(HLI[k] && HLI[k].ok); });

  /* ---------- fronts ----------
 * Glyphs sit on the LEFT-hand side of the drawing direction (the 'Flip side' option swaps them).
 * Draw a cold front top-to-bottom and its triangles point right (east); draw a warm front
 * west-to-east and its half-circles point up (north). */
  const FC = { cold: '#2f80ff', warm: '#ff3b3b', occluded: '#b24bf3', stationary: ['#2f80ff', '#ff3b3b'], trough: '#e8932c', dryline: '#ffa83a' };
  function tri(c, p, side, s, col) {
    const nx = -p.ty * side, ny = p.tx * side;
    c.fillStyle = col; c.beginPath();
    c.moveTo(p.x - p.tx * s * 0.55, p.y - p.ty * s * 0.55);
    c.lineTo(p.x + nx * s * 0.95, p.y + ny * s * 0.95);
    c.lineTo(p.x + p.tx * s * 0.55, p.y + p.ty * s * 0.55); c.closePath(); c.fill();
  }
  function semi(c, p, side, s, col) {
    const ang = Math.atan2(p.ty, p.tx); c.fillStyle = col; c.beginPath();
    if (side > 0) c.arc(p.x, p.y, s * 0.5, ang, ang + Math.PI); else c.arc(p.x, p.y, s * 0.5, ang + Math.PI, ang + TAU);
    c.closePath(); c.fill();
  }
  function drawFront(c, kind, pts, size, t, o) {
    o = o || {}; if (!pts || pts.length < 2) return;
    const prog = o.progress == null ? 1 : o.progress, flip = o.flip ? 1 : -1, spd = o.speed == null ? 0.35 : o.speed;
    const m = measure(catmull(pts, false, 10)), Lp = m.L * prog, sp = size * 2.1, lw = Math.max(3, size * 0.2);
    const cols = FC[kind] || '#fff';
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    const sub = upTo(m, Lp);
    const lineCol = Array.isArray(cols) ? null : cols;
    if (kind === 'trough') {
      c.strokeStyle = lineCol; c.lineWidth = lw; c.setLineDash([size * 1.1, size * 0.7]); c.lineDashOffset = -t * size * spd * 2;
      c.shadowColor = lineCol; c.shadowBlur = size * 0.3; strokePoly(c, sub); c.stroke(); c.restore(); return;
    }
    if (Array.isArray(cols)) {                         // stationary: alternating coloured segments
      for (let k = 0; k * sp < Lp; k++) {
        const s0 = k * sp, s1 = Math.min(Lp, (k + 1) * sp), seg = [at(m, s0)]; for (let i = 0; i < m.poly.length; i++) if (m.cum[i] > s0 && m.cum[i] < s1) seg.push({ x: m.poly[i][0], y: m.poly[i][1] }); seg.push(at(m, s1));
        c.strokeStyle = cols[k % 2]; c.lineWidth = lw; c.beginPath(); c.moveTo(seg[0].x, seg[0].y); seg.forEach(q => c.lineTo(q.x, q.y)); c.stroke();
      }
    } else { c.strokeStyle = lineCol; c.lineWidth = lw; c.shadowColor = lineCol; c.shadowBlur = size * 0.35; strokePoly(c, sub); c.stroke(); c.shadowBlur = 0; }
    // marching glyphs
    const shift = (t * spd * sp) % (sp * 2), edge = sp * 0.6;
    for (let k = -3; ; k++) {
      const s = k * sp + shift; if (s > Lp) break; if (s < 0) continue;
      const a = clamp(Math.min(s, Lp - s) / edge, 0, 1), p = at(m, s), par = ((k % 2) + 2) % 2;
      c.globalAlpha = a;
      if (kind === 'cold') tri(c, p, flip, size, cols);
      else if (kind === 'warm') semi(c, p, flip, size, cols);
      else if (kind === 'dryline') semi(c, p, flip, size, cols);
      else if (kind === 'occluded') (par ? semi : tri)(c, p, flip, size, cols);
      else if (kind === 'stationary') { if (par) semi(c, p, -flip, size, cols[1]); else tri(c, p, flip, size, cols[0]); }
    }
    c.restore();
  }

  /* ---------- general path: arrows, isobars, pen ---------- */
  function drawPath(c, pts, o) {
    o = o || {}; if (!pts || pts.length < 1) return;
    const prog = o.progress == null ? 1 : o.progress, w = o.width || 8, col = o.color || '#ffd23f';
    const smoothed = o.raw ? pts : catmull(pts, !!o.closed, o.seg || 10);
    const m = measure(smoothed), Lp = m.L * prog, sub = upTo(m, Lp);
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    if (pts.length === 1) { c.fillStyle = col; c.beginPath(); c.arc(pts[0][0], pts[0][1], w / 2, 0, TAU); c.fill(); c.restore(); return; }
    const style = o.style || 'solid';
    if (o.glow !== false) { c.shadowColor = col; c.shadowBlur = w * 1.1; }
    if (style === 'flow') {
      c.globalAlpha *= 0.4; c.strokeStyle = col; c.lineWidth = w; strokePoly(c, sub); c.stroke();
      c.globalAlpha /= 0.4; c.shadowBlur = 0;
      c.strokeStyle = '#fff'; c.lineWidth = w * 0.5; c.setLineDash([w * 1.8, w * 2.2]); c.lineDashOffset = -(o.t || 0) * w * 4.2;
      strokePoly(c, sub); c.stroke(); c.setLineDash([]);
    } else {
      c.strokeStyle = col; c.lineWidth = w; if (style === 'dash') { c.setLineDash([w * 2.2, w * 1.5]); c.lineDashOffset = -(o.t || 0) * w * 2; }
      strokePoly(c, sub); c.stroke(); c.setLineDash([]);
    }
    c.shadowBlur = 0;
    if (o.head && m.L > 4) {                        // arrow head at the (animated) end
      const e = at(m, Lp), back = at(m, Math.max(0, Lp - w * 1.5)), tx = e.x - back.x, ty = e.y - back.y, l = Math.hypot(tx, ty) || 1, ux = tx / l, uy = ty / l;
      const hs = w * 3.1; c.fillStyle = col; c.beginPath();
      c.moveTo(e.x + ux * hs * 0.55, e.y + uy * hs * 0.55);
      c.lineTo(e.x - ux * hs * 0.45 - uy * hs * 0.62, e.y - uy * hs * 0.45 + ux * hs * 0.62);
      c.lineTo(e.x - ux * hs * 0.45 + uy * hs * 0.62, e.y - uy * hs * 0.45 - ux * hs * 0.62); c.closePath(); c.fill();
    }
    if (o.label) { const mid = at(m, m.L * 0.5); pill(c, o.label, mid.x, mid.y, Math.max(16, w * 2.6), 'rgba(8,20,38,0.85)', '#fff'); }
    c.restore();
  }

  /* ---------- colour helpers (hex / rgb() in, rgba() out) ---------- */
  function rgbOf(col) { col = String(col || '#ffffff'); let m = /^#([0-9a-f]{3})$/i.exec(col); if (m) col = '#' + m[1].split('').map(x => x + x).join(''); m = /^#([0-9a-f]{6})/i.exec(col); if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; } m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(col); return m ? [+m[1], +m[2], +m[3]] : [255, 255, 255]; }
  const rgbaOf = (col, a) => { const q = rgbOf(col); return 'rgba(' + q[0] + ',' + q[1] + ',' + q[2] + ',' + a + ')'; };
  const shade = (col, k) => { const q = rgbOf(col), t = k >= 0 ? 255 : 0, f = Math.abs(k); return 'rgb(' + q.map(v => Math.round(v + (t - v) * f)).join(',') + ')'; };

  /* ---------- flow arrows: separate arrows (no line between them) streaming along a bendable path ---------- */
  function flowGlyph(c, p, size, col, style, alpha, headOnly) {
    c.save(); c.translate(p.x, p.y); c.rotate(Math.atan2(p.ty, p.tx)); c.globalAlpha *= alpha;
    const L = size, hw = size * 0.46;
    if (style === 'glossy' && !headOnly) {
      const tl = size * 2.1, tg = c.createLinearGradient(-tl, 0, -L * 0.2, 0); tg.addColorStop(0, rgbaOf(col, 0)); tg.addColorStop(1, rgbaOf(col, 0.8));
      c.fillStyle = tg; c.beginPath(); c.moveTo(-L * 0.2, -hw * 0.34); c.lineTo(-tl, 0); c.lineTo(-L * 0.2, hw * 0.34); c.closePath(); c.fill();
    }
    if (style === 'glossy') { c.shadowColor = col; c.shadowBlur = size * 0.4; }
    c.beginPath(); c.moveTo(L * 0.58, 0); c.lineTo(-L * 0.36, -hw); c.lineTo(-L * 0.1, 0); c.lineTo(-L * 0.36, hw); c.closePath();
    if (style === 'glossy') {
      const gr = c.createLinearGradient(0, -hw, 0, hw); gr.addColorStop(0, shade(col, 0.55)); gr.addColorStop(0.5, col); gr.addColorStop(1, shade(col, -0.35));
      c.fillStyle = gr; c.fill(); c.shadowBlur = 0; c.lineJoin = 'round'; c.lineWidth = Math.max(1.5, size * 0.07); c.strokeStyle = 'rgba(255,255,255,0.92)'; c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.28)'; c.beginPath(); c.moveTo(L * 0.5, -hw * 0.04); c.lineTo(-L * 0.28, -hw * 0.86); c.lineTo(-L * 0.12, -hw * 0.04); c.closePath(); c.fill();
    } else { c.fillStyle = col; c.fill(); }
    c.restore();
  }
  function streakGlyph(c, m, s, size, col, alpha) {       // arrow head with a long curved tail that follows the path (broadcast "streak" arrow)
    const p = at(m, s), hw = size * 0.46, tl = Math.min(size * 4.2, Math.max(0, s - size * 0.15)), N = 14;
    if (tl > size * 0.4) {
      const Lf = [], Rg = []; for (let j = 0; j <= N; j++) { const q = at(m, s - size * 0.15 - tl * j / N), w = hw * 0.62 * Math.pow(1 - j / N, 1.15); Lf.push([q.x - q.ty * w, q.y + q.tx * w]); Rg.push([q.x + q.ty * w, q.y - q.tx * w]); }
      const e = at(m, s - size * 0.15 - tl), gr = c.createLinearGradient(p.x, p.y, e.x, e.y); gr.addColorStop(0, rgbaOf(col, 0.9 * alpha)); gr.addColorStop(1, rgbaOf(col, 0));
      c.fillStyle = gr; c.beginPath(); Lf.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); for (let j = N; j >= 0; j--) c.lineTo(Rg[j][0], Rg[j][1]); c.closePath(); c.fill();
    }
    flowGlyph(c, p, size, col, 'glossy', alpha, true);
  }
  function blockGlyph(c, p, size, col, alpha) {           // solid 3-D block arrow (shaft + head), bevelled
    c.save(); c.translate(p.x, p.y); c.rotate(Math.atan2(p.ty, p.tx)); c.globalAlpha *= alpha; const sh = size * 0.17, hw = size * 0.5;
    c.beginPath(); c.moveTo(size * 0.7, 0); c.lineTo(size * 0.15, -hw); c.lineTo(size * 0.15, -sh); c.lineTo(-size * 0.75, -sh); c.lineTo(-size * 0.75, sh); c.lineTo(size * 0.15, sh); c.lineTo(size * 0.15, hw); c.closePath();
    c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = size * 0.2; c.shadowOffsetY = size * 0.08; const gr = c.createLinearGradient(0, -hw, 0, hw); gr.addColorStop(0, shade(col, 0.5)); gr.addColorStop(0.5, col); gr.addColorStop(1, shade(col, -0.45));
    c.fillStyle = gr; c.fill(); c.shadowColor = 'transparent'; c.lineJoin = 'round'; c.lineWidth = Math.max(1.2, size * 0.04); c.strokeStyle = rgbaOf(shade(col, -0.6), 0.8); c.stroke(); c.restore();
  }
  function chevronGlyph(c, p, size, col, alpha) {          // outlined double chevron  >>
    c.save(); c.translate(p.x, p.y); c.rotate(Math.atan2(p.ty, p.tx)); c.globalAlpha *= alpha; c.lineCap = 'round'; c.lineJoin = 'round';
    const path = dx => { c.beginPath(); c.moveTo(dx - size * 0.32, -size * 0.45); c.lineTo(dx + size * 0.1, 0); c.lineTo(dx - size * 0.32, size * 0.45); };
    [-size * 0.28, size * 0.2].forEach(dx => { path(dx); c.strokeStyle = '#ffffff'; c.lineWidth = size * 0.3; c.stroke(); });
    [-size * 0.28, size * 0.2].forEach(dx => { path(dx); c.strokeStyle = col; c.lineWidth = size * 0.17; c.stroke(); });
    c.restore();
  }
  function drawFlow(c, pts, o) {
    o = o || {}; if (!pts || pts.length < 2) return;
    const size = Math.max(3, o.size || 46), col = o.color || '#3fa9ff', style = ['plain', 'streak', 'block', 'chevron'].includes(o.style) ? o.style : 'glossy', gap = Math.max(1.2, o.spacing || 2.8), spd = o.speed == null ? 1 : o.speed, t = o.t || 0;
    const m = measure(catmull(pts, false, 10)); if (m.L < 2) return; const Lp = m.L * (o.progress == null ? 1 : o.progress), sp = size * gap, shift = ((t * spd * size * 2.4) % sp + sp) % sp, edge = size * 1.6;
    c.save();
    for (let k = -1; ; k++) {
      const s = k * sp + shift; if (s > Lp) break; if (s < 0) continue;
      const a = clamp(Math.min(s, Lp - s) / edge, 0, 1);
      if (style === 'streak') streakGlyph(c, m, s, size, col, a); else if (style === 'block') blockGlyph(c, at(m, s), size, col, a); else if (style === 'chevron') chevronGlyph(c, at(m, s), size, col, a); else flowGlyph(c, at(m, s), size, col, style, a);
    }
    c.restore();
  }

  /* ---------- jet stream: wide band along a bendable path with animated arrows ---------- */
  function drawJet(c, pts, o) {
    o = o || {}; if (!pts || pts.length < 2) return;
    const w = Math.max(10, o.width || 64), style = o.style === 'ribbon' ? 'ribbon' : 'banded', col = o.color || (style === 'ribbon' ? '#d5dbe6' : '#0b4fa8'), acol = o.arrowColor || '#ffffff', spd = o.speed == null ? 1 : o.speed, t = o.t || 0;
    const m0 = measure(catmull(pts, false, 12)); if (m0.L < 2) return; const Lp = m0.L * (o.progress == null ? 1 : o.progress), sub = upTo(m0, Lp), m = measure(sub); if (m.L < 2) return;
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    const glyphs = (gw, step, col2, alpha0) => {                 // arrows streaming along the middle of the band
      const shift = ((t * spd * step * 0.9) % step + step) % step, edge = Math.min(step * 1.5, m.L / 3);
      for (let k = -1; ; k++) {
        const s = k * step + shift; if (s > m.L) break; if (s < 0) continue; const p = at(m, s), a = clamp(Math.min(s, m.L - s) / edge, 0, 1) * alpha0;
        c.save(); c.translate(p.x, p.y); c.rotate(Math.atan2(p.ty, p.tx)); c.globalAlpha *= a; c.fillStyle = col2;
        c.beginPath(); c.moveTo(gw * 0.55, 0); c.lineTo(-gw * 0.4, -gw * 0.5); c.lineTo(-gw * 0.15, 0); c.lineTo(-gw * 0.4, gw * 0.5); c.closePath(); c.fill(); c.restore();
      }
    };
    const words = String(o.words == null ? 'JET STREAM' : o.words).toUpperCase(), asText = o.flowText === 'text' && words.trim();
    const textRun = (fs, color, alpha0) => {                  // the words repeat along the band and slide through it; kept upright when the jet flows leftwards
      c.save(); c.font = `800 ${fs}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; const chars = [...words], adv = chars.map(ch => c.measureText(ch).width + fs * 0.07), total = adv.reduce((a, b) => a + b, 0), period = total + fs * 3.4;
      const shift = ((t * spd * fs * 3) % period + period) % period, edge2 = Math.min(fs * 2, m.L / 3), p0 = at(m, 0), p1 = at(m, m.L), flip = p1.x < p0.x - 1;
      c.fillStyle = color; c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = fs * 0.12;
      for (let k = -1; ; k++) {
        const s0 = k * period + shift; if (s0 > m.L) break; if (s0 + total < 0) continue; let cum = 0;
        chars.forEach((ch, i) => {
          const sc = s0 + (flip ? total - cum - adv[i] / 2 : cum + adv[i] / 2); cum += adv[i]; if (sc < 0 || sc > m.L || ch === ' ') return;
          const q = at(m, sc); c.save(); c.translate(q.x, q.y); c.rotate(Math.atan2(q.ty, q.tx) + (flip ? Math.PI : 0)); c.globalAlpha *= clamp(Math.min(sc, m.L - sc) / edge2, 0, 1) * alpha0; c.fillText(ch, 0, fs * 0.04); c.restore();
        });
      }
      c.restore();
    };
    const edge = o.outline !== false, fade = clamp((o.fade || 0) / 100, 0, 0.95), NL = 14;       // edge line on/off, soft (feathered) edges 0-95 %
    if (style === 'banded') {
      if (edge) { c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = w * 0.18; c.strokeStyle = '#ffffff'; c.lineWidth = w + Math.max(5, w * 0.14); strokePoly(c, m.poly); c.stroke(); c.shadowBlur = 0; }
      if (fade > 0) {                                           // stacked strokes, widest faintest: the band melts into the map at its sides
        const a = 1 - Math.pow(0.004, 1 / NL); c.strokeStyle = col; c.globalAlpha *= a;
        for (let k = 0; k < NL; k++) { c.lineWidth = w * (1 - fade * k / (NL - 1)); strokePoly(c, m.poly); c.stroke(); }
        c.globalAlpha /= a;
      } else { c.strokeStyle = col; c.lineWidth = w; strokePoly(c, m.poly); c.stroke(); }
      c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = w * 0.42; c.save(); c.translate(0, -w * 0.12); strokePoly(c, m.poly); c.stroke(); c.restore();   // soft sheen
      if (asText) textRun(w * 0.52, acol, 1); else glyphs(w * 0.46, w * 1.45, acol, 1);
    } else {
      // ribbon: narrow tail growing to full width, ending in a large arrow head
      const head = Math.min(w * 2.1, m.L * 0.45), body = Math.max(0, m.L - head), N = Math.max(8, Math.ceil(m.L / 8)), tail = Math.min(body * 0.45, w * 4);
      const hw = s => { const u = tail > 0 ? clamp(s / tail, 0, 1) : 1; return w * 0.5 * (0.3 + 0.7 * (u * u * (3 - 2 * u))); };
      const pb = at(m, body), pe = at(m, m.L), first = at(m, 0);
      const shape = sc => {                                      // sc = width scale (1 = full)
        const Lft = [], Rgt = []; for (let i = 0; i <= N; i++) { const s0 = body * i / N, p = at(m, s0), q = hw(s0) * sc; Lft.push([p.x - p.ty * q, p.y + p.tx * q]); Rgt.push([p.x + p.ty * q, p.y - p.tx * q]); }
        const hb = w * 0.5 * 1.75 * sc; c.beginPath(); Lft.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); c.lineTo(pb.x - pb.ty * hb, pb.y + pb.tx * hb); c.lineTo(pe.x, pe.y); c.lineTo(pb.x + pb.ty * hb, pb.y - pb.tx * hb);
        for (let i = N; i >= 0; i--) c.lineTo(Rgt[i][0], Rgt[i][1]); c.closePath();
      };
      const gr = c.createLinearGradient(first.x, first.y, pe.x, pe.y); gr.addColorStop(0, rgbaOf(col, 0.35)); gr.addColorStop(0.45, rgbaOf(col, 0.85)); gr.addColorStop(1, rgbaOf(col, 0.9));
      if (fade > 0) {
        c.fillStyle = gr; const a = 1 - Math.pow(0.02, 1 / NL); c.globalAlpha *= a;
        for (let k = 0; k < NL; k++) { shape(1 - fade * k / (NL - 1)); c.fill(); }
        c.globalAlpha /= a;
      } else {
        shape(1); if (edge) { c.shadowColor = 'rgba(0,0,0,0.3)'; c.shadowBlur = w * 0.25; } c.fillStyle = gr; c.fill(); c.shadowBlur = 0;
        if (edge) { c.lineWidth = Math.max(1.5, w * 0.04); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.stroke(); }
      }
      if (asText) textRun(w * 0.4, o.arrowColor ? acol : shade(col, -0.55), 0.9); else glyphs(w * 0.34, w * 1.1, o.arrowColor ? acol : shade(col, -0.45), 0.8);
    }
    if (o.label) { const mid = at(m, m.L * 0.5); pill(c, o.label, mid.x, mid.y, Math.max(16, w * 0.4), 'rgba(8,20,38,0.85)', '#fff'); }
    c.restore();
  }

  /* ---------- wind barb ---------- */
  function drawBarb(c, x, y, kt, dirFrom, size, col) {
    c.save(); c.translate(x, y); c.strokeStyle = c.fillStyle = col || '#fff'; c.lineWidth = Math.max(2, size * 0.07); c.lineCap = 'round';
    const a = dirFrom * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), rx = -dy, ry = dx;
    if (kt < 3) { c.beginPath(); c.arc(0, 0, size * 0.12, 0, TAU); c.stroke(); c.beginPath(); c.arc(0, 0, size * 0.2, 0, TAU); c.stroke(); c.restore(); return; }
    c.beginPath(); c.moveTo(0, 0); c.lineTo(dx * size, dy * size); c.stroke();
    let n = Math.round(kt / 5) * 5, pos = size, step = size * 0.14; const bl = size * 0.36;
    while (n >= 50) { c.beginPath(); c.moveTo(dx * pos, dy * pos); c.lineTo(dx * (pos - step * 1.3) + rx * bl, dy * (pos - step * 1.3) + ry * bl); c.lineTo(dx * (pos - step * 1.3), dy * (pos - step * 1.3)); c.closePath(); c.fill(); pos -= step * 1.5; n -= 50; }
    while (n >= 10) { c.beginPath(); c.moveTo(dx * pos, dy * pos); c.lineTo(dx * (pos + step * 0.5) + rx * bl, dy * (pos + step * 0.5) + ry * bl); c.stroke(); pos -= step; n -= 10; }
    if (n >= 5) { if (pos === size) pos -= step; c.beginPath(); c.moveTo(dx * pos, dy * pos); c.lineTo(dx * (pos + step * 0.25) + rx * bl * 0.5, dy * (pos + step * 0.25) + ry * bl * 0.5); c.stroke(); }
    c.restore();
  }

  g.Sym = { FONT, catmull, measure, at, drawHL, hlBounds, drawFront, drawPath, drawFlow, drawJet, drawBarb, pill, FRONT_KINDS: [['cold', 'Cold front'], ['warm', 'Warm front'], ['stationary', 'Stationary front'], ['occluded', 'Occluded front'], ['trough', 'Trough'], ['dryline', 'Dry line']] };
})(typeof window !== 'undefined' ? window : globalThis);
