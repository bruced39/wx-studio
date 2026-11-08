/* v0.11.5 stabilisation: how closely do Follow attachments stay with their front DURING a step transition?
 * We measure, in SCREEN pixels, how far the follower is from the drawn (Catmull-Rom) front while the front moves, rotates, lengthens, shortens or bends
 * between two steps, and compare with the plain "blend the two stored positions" result the engine used before the in-between placement was added. */
const test = require('node:test'), assert = require('node:assert/strict');
const MA = require('../studio/mapanim.js');
const clone = o => JSON.parse(JSON.stringify(o));
const front = (id, pts, extra) => Object.assign({ id, type: 'front', kind: 'cold', pts }, extra || {});
const icon = (id, x, y, extra) => Object.assign({ id, type: 'icon', icon: 'rain', x, y }, extra || {});
const dense = pts => MA.catmull(pts, false, 12);
function nearest(d, x, y) { let best = Infinity, bs = 0, acc = 0, L = 0; const cum = [0]; for (let i = 1; i < d.length; i++) { L += Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1]); cum.push(L); }
  for (let i = 1; i < d.length; i++) { const ax = d[i - 1][0], ay = d[i - 1][1], bx = d[i][0] - ax, by = d[i][1] - ay, l2 = bx * bx + by * by || 1e-12, f = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / l2)), dd = Math.hypot(x - ax - bx * f, y - ay - by * f); if (dd < best) { best = dd; bs = cum[i - 1] + f * Math.sqrt(l2); } }
  return { d: best, u: L ? bs / L : 0 }; }
/* build a pair of step snapshots A and B; the follower is attached with the same (u, t, n) in both and sits on each step's front */
function pair(ptsA, ptsB, n, u0, ctx, proj) {
  const fA = front('f', ptsA), cA = icon('c', 0, 0); cA.x = ptsA[0][0]; cA.y = ptsA[0][1];
  const mid = MA.attachFrame(fA, u0, ctx); const nx = -mid.ty, ny = mid.tx;    // unit normal in measuring space
  const kx = ctx && ctx.lngLat ? Math.cos((ptsA.reduce((s, p) => s + p[1], 0) / ptsA.length) * Math.PI / 180) : 1;
  cA.x = mid.x + (n * nx) / kx; cA.y = mid.y + n * ny; cA.attach = MA.makeAttach(fA, cA, ctx);
  const A = [fA, cA], B = [front('f', ptsB), clone(cA)]; MA.syncAttach(A, null, ctx); MA.syncAttach(B, null, ctx);
  return { A, B, n: cA.attach.n };
}
/* worst deviation (px) of |distance to the drawn front| from |n| and of the along-front fraction from u, across the whole transition */
function worst(A, B, n, u0, ctx, toPx, mode) {
  let wd = 0, wu = 0;
  for (let k = 1; k < 40; k++) {
    const u = k / 40; let out;
    if (mode === 'plain') { // the engine without the in-between placement: blend stored positions linearly
      out = MA.interpolate(A, B, u, null, { lngLat: !!(ctx && ctx.lngLat), __plain: true });
      const f = out.find(o => o.id === 'f'), c = out.find(o => o.id === 'c'), a = A[1], b = B[1]; c.x = a.x + (b.x - a.x) * u; c.y = a.y + (b.y - a.y) * u; // overwrite with the plain blend
    } else out = MA.interpolate(A, B, u, null, ctx);
    const f = out.find(o => o.id === 'f'), c = out.find(o => o.id === 'c'), P = toPx || (p => p), dn = dense(f.pts.map(p => P(p))), cp = P([c.x, c.y]), nr = nearest(dn, cp[0], cp[1]);
    wd = Math.max(wd, Math.abs(nr.d - Math.abs(n))); wu = Math.max(wu, Math.abs(nr.u - A[1].attach.u));
  }
  return { wd, wu };
}
const L = [[300, 600], [500, 520], [700, 500], [900, 540], [1100, 620]];
const rot = (pts, deg, cx, cy) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return pts.map(p => [cx + (p[0] - cx) * c - (p[1] - cy) * s, cy + (p[0] - cx) * s + (p[1] - cy) * c]); };
const cx = 700, cy = 560;

test('screen space: a follower ON the front (n = 0) stays on the drawn front through translate / rotate / lengthen / shorten / bend', () => {
  const cases = {
    translate: L.map(p => [p[0] + 260, p[1] + 140]),
    rotate90: rot(L, 90, cx, cy),
    rotate150: rot(L, 150, cx, cy),
    lengthen: L.concat([[1300, 720], [1500, 860]]),
    shorten: L.slice(0, 3),
    bend: L.map((p, i) => [p[0], p[1] + (i % 2 ? -140 : 120)]),
  };
  for (const [name, B] of Object.entries(cases)) {
    for (const u0 of [0.15, 0.5, 0.85]) {
      const { A, B: BB, n } = pair(L, B, 0, u0), w = worst(A, BB, n, u0);
      assert.ok(w.wd < 0.6, name + ' u0=' + u0 + ': follower stays on the front (worst ' + w.wd.toFixed(2) + ' px)');
    }
  }
});

test('screen space: a follower BESIDE the front keeps its distance (60 px) and its place along the front, even when the front turns', () => {
  const cases = { rotate90: rot(L, 90, cx, cy), rotate120: rot(L, 120, cx, cy), lengthen: L.concat([[1300, 720], [1500, 860]]), translate: L.map(p => [p[0] - 200, p[1] + 90]) };
  for (const [name, B] of Object.entries(cases)) {
    const { A, B: BB, n } = pair(L, B, 60, 0.45), now = worst(A, BB, n, 0.45), old = worst(A, BB, n, 0.45, undefined, undefined, 'plain');
    assert.ok(now.wd < 4.5, name + ': distance from the front stays within 4.5 px of 60 (worst ' + now.wd.toFixed(2) + ')');
    assert.ok(now.wu < 0.03, name + ': stays at the same fraction along the front (worst ' + now.wu.toFixed(3) + ')');
    assert.ok(now.wd <= old.wd + 1e-9, name + ': never worse than plain blending (new ' + now.wd.toFixed(2) + ' vs plain ' + old.wd.toFixed(2) + ')');
    if (name.startsWith('rotate')) assert.ok(old.wd > 12 && now.wd < old.wd / 3, name + ': plain blending drifts ' + old.wd.toFixed(1) + ' px, the in-between placement ' + now.wd.toFixed(1) + ' px');
  }
});

test('no jump where a move begins or ends: first / last in-between frames match the step snapshots', () => {
  const { A, B } = pair(L, rot(L, 70, cx, cy), 55, 0.4);
  const near0 = MA.interpolate(A, B, 0.001, null, {}), near1 = MA.interpolate(A, B, 0.999, null, {});
  const d0 = Math.hypot(near0.find(o => o.id === 'c').x - A[1].x, near0.find(o => o.id === 'c').y - A[1].y), d1 = Math.hypot(near1.find(o => o.id === 'c').x - B[1].x, near1.find(o => o.id === 'c').y - B[1].y);
  assert.ok(d0 < 0.8 && d1 < 0.8, 'ends meet the stored positions (' + d0.toFixed(3) + ', ' + d1.toFixed(3) + ' px)');
  /* also through the public timeline: objectsAt at the start / end of a move equals the held step */
  const sc = { id: 's', name: 's', duration: 10, objects: clone(A), bg: { type: 'solid' } }; MA.enable(sc); MA.addStep(sc, 0, { hold: 1, dur: 2 }); sc.anim.steps[1].objects = clone(B); MA.sanitizeAttach(sc);
  const tl = MA.timeline(sc), mv = tl.segs.find(s => s.kind === 'move');
  const a = MA.objectsAt(sc, mv.t0 + 0.001).find(o => o.id === 'c'), b = MA.objectsAt(sc, mv.t1 - 0.001).find(o => o.id === 'c');
  assert.ok(Math.hypot(a.x - sc.objects.find(o => o.id === 'c').x, a.y - sc.objects.find(o => o.id === 'c').y) < 1.5);
  assert.ok(Math.hypot(b.x - sc.anim.steps[1].objects.find(o => o.id === 'c').x, b.y - sc.anim.steps[1].objects.find(o => o.id === 'c').y) < 1.5);
});

test('chains (label -> icon -> front) all stay together while the front turns', () => {
  const fA = front('f', L), iA = icon('c', 0, 0), tA = { id: 'lab', type: 'text', text: 'x', x: 0, y: 0 }, f = MA.attachFrame(fA, 0.5);
  iA.x = f.x - f.ty * 70; iA.y = f.y + f.tx * 70; iA.attach = MA.makeAttach(fA, iA); tA.x = iA.x + 10; tA.y = iA.y - 50; tA.attach = MA.makeAttach(iA, tA);
  const A = [fA, iA, tA]; MA.syncAttach(A, null, {}); const B = [front('f', rot(L, 100, cx, cy)), clone(iA), clone(tA)]; MA.syncAttach(B, null, {});
  for (let k = 1; k < 20; k++) {
    const u = k / 20, out = MA.interpolate(A, B, u, null, {}), c = out.find(o => o.id === 'c'), t = out.find(o => o.id === 'lab');
    const dt = Math.hypot(t.x - c.x, t.y - c.y); assert.ok(Math.abs(dt - Math.hypot(10, 50)) < 0.5, 'label keeps its offset from the icon (' + dt.toFixed(2) + ')');
  }
});

/* ---- pinned scenes on Mapbox: coordinates are lng/lat, a degree of longitude is shorter than a degree of latitude ---- */
const Z = 7, WORLD = 256 * Math.pow(2, Z);
const toPx = p => [(p[0] + 180) / 360 * WORLD, (0.5 - Math.log(Math.tan(Math.PI / 4 + p[1] * Math.PI / 360)) / (2 * Math.PI)) * WORLD];
const fromPx = q => [q[0] / WORLD * 360 - 180, (2 * Math.atan(Math.exp((0.5 - q[1] / WORLD) * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI];
test('pinned (lng/lat on Mapbox): the follower keeps its on-screen distance when the front turns, only with the Mapbox-aware measuring', () => {
  const c0 = toPx([-71.2, 42.2]), pxL = L.map(p => [c0[0] + (p[0] - 700), c0[1] + (p[1] - 560)]), geoOf = pts => pts.map(fromPx);
  const ptsA = geoOf(pxL), ptsB = geoOf(rot(pxL, 100, c0[0], c0[1]));
  const ctx = { lngLat: true };
  // place the follower 60 screen px across the front, learned in lng/lat
  const fA = front('f', ptsA, { geo: true }), mid = toPx([MA.attachFrame(fA, 0.45, ctx).x, MA.attachFrame(fA, 0.45, ctx).y]);
  const dn = dense(ptsA.map(toPx)); const nr = nearest(dn, mid[0], mid[1]); // mid is on the front; find the screen-normal at that spot
  let k = 0; for (; k < dn.length - 1; k++) if (Math.hypot(dn[k][0] - mid[0], dn[k][1] - mid[1]) < 2) break; const a = dn[Math.max(0, k - 1)], b = dn[Math.min(dn.length - 1, k + 1)], tl = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / tl, ny = (b[0] - a[0]) / tl;
  const cll = fromPx([mid[0] + nx * 60, mid[1] + ny * 60]), cA = icon('c', cll[0], cll[1], { geo: true }); cA.attach = MA.makeAttach(fA, cA, ctx);
  const A = [fA, cA], B = [front('f', ptsB, { geo: true }), clone(cA)]; MA.syncAttach(A, null, ctx); MA.syncAttach(B, null, ctx);
  let wAware = 0, wNaive = 0;
  for (let q = 1; q < 40; q++) {
    const u = q / 40, o1 = MA.interpolate(A, B, u, null, ctx), o2 = MA.interpolate(clone(A).map(o => { if (o.attach) { /* attach learned WITHOUT the Mapbox-aware measuring */ } return o; }), B, u, null, { lngLat: false });
    for (const [out, which] of [[o1, 'aware'], [o2, 'naive']]) {
      const f = out.find(o => o.id === 'f'), c = out.find(o => o.id === 'c'), d = dense(f.pts.map(toPx)), cp = toPx([c.x, c.y]), r = nearest(d, cp[0], cp[1]), dev = Math.abs(r.d - 60);
      if (which === 'aware') wAware = Math.max(wAware, dev); else wNaive = Math.max(wNaive, dev);
    }
  }
  assert.ok(wAware < 6, 'Mapbox-aware: worst distance error ' + wAware.toFixed(2) + ' px of 60 across a 100 degree turn');
  assert.ok(wAware <= wNaive + 1e-9, 'aware (' + wAware.toFixed(2) + ' px) is no worse than naive degree-space measuring (' + wNaive.toFixed(2) + ' px)');
  // held steps are exactly where they were stored
  const h = MA.attachPos(B[1].attach, B[0], ctx); assert.ok(Math.hypot(h[0] - B[1].x, h[1] - B[1].y) < 1e-6);
});
