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

  /* ---------- H / L pressure centres ---------- */
  function drawHL(c, kind, x, y, size, value, t, o) {
    o = o || {}; const col = kind === 'H' ? '#2f7bff' : '#ff3b3b', glow = kind === 'H' ? 'rgba(47,123,255,' : 'rgba(255,59,59,';
    const prog = o.progress == null ? 1 : o.progress;
    c.save(); c.translate(x, y); c.globalAlpha *= clamp(prog * 1.5, 0, 1);
    const sc = 0.6 + 0.4 * Math.min(1, prog * 1.3); c.scale(sc, sc);
    for (let k = 0; k < 2; k++) {                    // pulsing rings
      const ph = fract(t * 0.5 + k * 0.5), r = size * (0.62 + ph * 0.5);
      c.strokeStyle = glow + (0.55 * (1 - ph)) + ')'; c.lineWidth = size * 0.05; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
    }
    const gl = c.createRadialGradient(0, 0, size * 0.1, 0, 0, size * 0.8); gl.addColorStop(0, glow + '0.38)'); gl.addColorStop(1, glow + '0)');
    c.fillStyle = gl; c.beginPath(); c.arc(0, 0, size * 0.8, 0, TAU); c.fill();
    c.font = `800 ${size * 1.05}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = size * 0.12; c.strokeStyle = 'rgba(255,255,255,0.95)';
    const bob = Math.sin(t * 1.6) * size * 0.015;
    c.strokeText(kind, 0, bob); c.fillStyle = col; c.fillText(kind, 0, bob);
    if (value !== '' && value != null) pill(c, String(value), 0, size * 0.66, size * 0.3, 'rgba(8,20,38,0.82)', '#fff');
    c.restore();
  }
  const hlBounds = (x, y, size) => ({ x: x - size * 0.55, y: y - size * 0.55, w: size * 1.1, h: size * 1.4 });

  /* ---------- fronts ---------- */
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
    if (side > 0) c.arc(p.x, p.y, s * 0.5, ang + Math.PI, ang + TAU); else c.arc(p.x, p.y, s * 0.5, ang, ang + Math.PI);
    c.closePath(); c.fill();
  }
  function drawFront(c, kind, pts, size, t, o) {
    o = o || {}; if (!pts || pts.length < 2) return;
    const prog = o.progress == null ? 1 : o.progress, flip = o.flip ? -1 : 1, spd = o.speed == null ? 0.35 : o.speed;
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

  g.Sym = { FONT, catmull, measure, at, drawHL, hlBounds, drawFront, drawPath, drawBarb, pill, FRONT_KINDS: [['cold', 'Cold front'], ['warm', 'Warm front'], ['stationary', 'Stationary front'], ['occluded', 'Occluded front'], ['trough', 'Trough'], ['dryline', 'Dry line']] };
})(typeof window !== 'undefined' ? window : globalThis);
