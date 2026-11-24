'use strict';
/* v0.11.7: camera keys + imported-media clock on the ONE master timeline (pure data) - run: node --test tests/unified_timeline.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const MA = require('../studio/mapanim.js');
const TL = require('../studio/timeline.js');
const clone = v => JSON.parse(JSON.stringify(v));
const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= (e == null ? 1e-6 : e), (m || '') + ' got ' + a + ' want ' + b);
const icon = (id, x, y, geo) => ({ id, type: 'icon', icon: 'rain', size: 100, x, y, geo: !!geo });
const front = (id, pts, geo) => ({ id, type: 'front', kind: 'cold', size: 28, pts, geo: !!geo });
const mb = (o) => Object.assign({ id: 'm', name: 'Map', duration: 12, bg: { type: 'mapbox', view: { c: [-71, 42.3], z: 6, b: 0, p: 0 } }, objects: [], transition: { type: 'cut', dur: 1 } }, o || {});
const V = (lng, lat, z, b, p) => ({ c: [lng, lat], z, b: b || 0, p: p || 0 });
const edit = (sc, T, fn) => { const ed = TL.beginEdit(sc, T); fn(ed.objs, ed); return TL.flush(sc, ed); };

test('c1 camera: first camera edit at T makes the start key from the scene view plus the new key; nothing else is created', () => {
  const sc = mb({ objects: [icon('a', -71, 42, true)] }); TL.enable(sc);
  assert.equal(TL.hasCam(sc), false); assert.equal(TL.camAt(sc, 3), null, 'no camera keys = the old behaviour (null here)');
  const k = TL.camSetKey(sc, 3, V(-70, 43, 8, 20, 30)); assert.ok(k);
  const keys = TL.camKeys(sc); assert.equal(keys.length, 2); assert.equal(keys[0].t, 0); near(keys[0].v.z, 6); near(keys[1].v.z, 8); assert.equal(keys[1].t, 3);
  assert.equal(Object.keys(sc.tl.tracks).length, 0, 'camera edits never create object keys');
  near(sc.bg.view.z, 6, 1e-9, 'bg.view mirrors the start key (older builds still see the start view)');
});

test('c2 camera: endpoints exact, smooth through a middle key (no overshoot, continuous speed), constant before / after', () => {
  const sc = mb(); TL.enable(sc); TL.camSetKey(sc, 0, V(-71, 42, 5)); TL.camSetKey(sc, 4, V(-70, 43, 9)); TL.camSetKey(sc, 8, V(-69, 44, 7));
  near(TL.camAt(sc, 0).z, 5); near(TL.camAt(sc, 4).z, 9); near(TL.camAt(sc, 8).z, 7); near(TL.camAt(sc, 12).z, 7); near(TL.camAt(sc, 4).c[0], -70);
  let mx = -1e9; for (let t = 0; t <= 8; t += 0.05) { const z = TL.camAt(sc, t).z; mx = Math.max(mx, z); assert.ok(z >= 5 - 1e-9 && z <= 9 + 1e-9, 'no overshoot at t=' + t + ' z=' + z); }
  near(mx, 9, 1e-9, 'peak is exactly the key');
  const sl = (t) => (TL.camAt(sc, t + 0.01).c[0] - TL.camAt(sc, t - 0.01).c[0]) / 0.02;   // pan speed
  const a = (TL.camAt(sc, 3.99).c[0] - TL.camAt(sc, 3.98).c[0]) / 0.01, b = (TL.camAt(sc, 4.02).c[0] - TL.camAt(sc, 4.01).c[0]) / 0.01;
  near(a, b, 0.02, 'speed is continuous across the middle key'); void sl;
  for (let t = 0.1; t < 8; t += 0.1) { const c = TL.camAt(sc, t).c[0]; assert.ok(c >= -71 - 1e-9 && c <= -69 + 1e-9); }
  const mid = TL.camAt(sc, 2).c[0]; assert.ok(mid > -71 && mid < -70, 'moves smoothly toward the key');
});

test('c3 camera: scrubbing never writes; editing between keys inserts a key without moving neighbours; same time updates; no duplicates', () => {
  const sc = mb(); TL.enable(sc); TL.camSetKey(sc, 0, V(-71, 42, 5)); TL.camSetKey(sc, 6, V(-69, 44, 9));
  const before = JSON.stringify(sc.tl.cam); for (let t = 0; t <= 12; t += 0.1) TL.camAt(sc, t); assert.equal(JSON.stringify(sc.tl.cam), before, 'reading never changes data');
  TL.camBegin(sc, 3); assert.equal(TL.camFlush(), null, 'no edit = no key'); assert.equal(JSON.stringify(sc.tl.cam), before);
  const v = TL.camBegin(sc, 3); v.z += 1; const k = TL.camFlush(); assert.ok(k); assert.equal(TL.camKeys(sc).length, 3);
  const keys = TL.camKeys(sc); near(keys[0].v.z, 5); near(keys[2].v.z, 9); near(keys[1].t, 3);
  const w = TL.camBegin(sc, 3.02); w.z = 7; TL.camFlush(); assert.equal(TL.camKeys(sc).length, 3, 'within EPS = same key'); near(TL.camKeys(sc)[1].v.z, 7);
});

test('c4 camera live editing override: while a working copy is open the engine-facing view at that time is the working copy', () => {
  const sc = mb(); TL.enable(sc); TL.camSetKey(sc, 0, V(-71, 42, 5)); TL.camSetKey(sc, 6, V(-69, 44, 9));
  const w = TL.camBegin(sc, 2); const z0 = w.z; w.z = z0 + 2; near(TL.camWork(sc, 2).z, z0 + 2); assert.equal(TL.camWork(sc, 3), null, 'only at that time');
  assert.equal(TL.camDirty(), true); TL.camFlush(); assert.equal(TL.camWork(sc, 2), null);
});

test('c5 camera: bearing takes the short way (170 -> -170 passes through 180, not through 0); pitch and rotation interpolate', () => {
  const sc = mb(); TL.enable(sc); TL.camSetKey(sc, 0, V(-71, 42, 6, 170, 10)); TL.camSetKey(sc, 4, V(-71, 42, 6, -170, 50));
  const m = TL.camAt(sc, 2); assert.ok(Math.abs(Math.abs(m.b) - 180) < 1e-6, 'halfway is 180, got ' + m.b); near(m.p, 30, 1e-6);
  const q = TL.camAt(sc, 1); assert.ok(q.b > 170 || q.b < -170 + 1e-9 || Math.abs(q.b) >= 170, 'never swings through 0: ' + q.b);
});

test('c6 camera: per-key ease (linear / inout) and constant speed; retiming a key changes the speed', () => {
  const sc = mb(); TL.enable(sc); TL.camSetKey(sc, 0, V(-71, 42, 5)); const k = TL.camSetKey(sc, 4, V(-69, 42, 9)); TL.camSetEase(sc, k.id, 'linear');
  near(TL.camAt(sc, 2).c[0], -70, 1e-9, 'linear = halfway at half time'); near(TL.camAt(sc, 1).z, 6, 1e-9);
  TL.camSetEase(sc, k.id, 'inout'); const q = TL.camAt(sc, 1).z; assert.ok(q < 6, 'ease in/out starts slowly'); 
  TL.camSetEase(sc, k.id, 'linear'); assert.ok(TL.camMoveKey(sc, k.id, 2)); near(TL.camAt(sc, 1).c[0], -70, 1e-9, 'shorter time = faster');
  assert.equal(TL.camMoveKey(sc, TL.camKeys(sc)[0].id, 1), false, 'the start key cannot move'); assert.equal(TL.camDelKey(sc, TL.camKeys(sc)[0].id), false);
  assert.ok(TL.camDelKey(sc, k.id)); assert.equal(TL.hasCam(sc), false, 'with a single key left the camera is just the view');
});

test('c7 camera: flat (non-Mapbox) maps work too (zoom is interpolated in log space)', () => {
  const sc = { id: 'f', duration: 10, bg: { type: 'map', view: { cx: 500, cy: 300, w: 900 } }, objects: [], transition: { type: 'cut', dur: 1 } }; TL.enable(sc);
  TL.camSetKey(sc, 0, { cx: 500, cy: 300, w: 900 }); const k = TL.camSetKey(sc, 4, { cx: 600, cy: 320, w: 100 }); TL.camSetEase(sc, k.id, 'linear');
  near(TL.camAt(sc, 2).cx, 550, 1e-6); near(TL.camAt(sc, 2).w, Math.sqrt(900 * 100), 1e-6, 'geometric mean of widths at halfway');
});

test('c8 legacy start/end camera converts to keys with the SAME picture (same ease), and its fields are removed', () => {
  const bg = { type: 'mapbox', view: V(-71, 42, 5, 0, 0), view2: V(-69, 44, 9, 30, 40), camDelay: 1.5, camDur: 4 };
  const sc = mb({ bg }); TL.enable(sc); const ease = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const L = (a, z, p) => a + (z - a) * ease(Math.max(0, Math.min(1, p))), want = t => { const p = (t - 1.5) / 4; return { z: L(5, 9, p), x: L(-71, -69, p), b: L(0, 30, p), pi: L(0, 40, p) }; };
  const r = TL.camConvertLegacy(sc); assert.ok(r.ok); assert.equal(sc.bg.view2, undefined); assert.equal(sc.bg.camDur, undefined);
  for (const t of [0, 1, 1.5, 2, 3.2, 4.4, 5.5, 8, 12]) { const w = want(t), g = TL.camAt(sc, t); near(g.z, w.z, 1e-9, 'z@' + t); near(g.c[0], w.x, 1e-9); near(g.b, w.b, 1e-9); near(g.p, w.pi, 1e-9); }
  assert.equal(TL.camConvertLegacy(sc).ok, false, 'second time: nothing to do');
});

test('c9 normalize repairs damaged camera data (bad numbers, duplicates, missing start key, unknown background)', () => {
  const sc = mb(); TL.enable(sc);
  sc.tl.cam = { keys: [{ t: 5, v: V(-70, 43, 8) }, { t: 5.01, v: V(1, 1, 1) }, { t: 'x', v: V(0, 0, 3) }, { t: 2, v: { c: [NaN, 1], z: 4 } }, { t: 3, v: V(-71, 42, 99, 400, 300) }, null, { t: 9, v: V(-70, 43, 7), e: 'bogus' }] };
  TL.normalize(sc); const k = TL.camKeys(sc); assert.equal(k[0].t, 0, 'start key added'); assert.ok(k.every((q, i) => i === 0 || q.t > k[i - 1].t + 0.03)); assert.ok(k.every(q => isFinite(q.v.z) && q.v.z <= 22 && q.v.p <= 85 && q.e === undefined));
  const v = TL.camAt(sc, 4); assert.ok(isFinite(v.z) && isFinite(v.c[0]));
  sc.tl.cam = 'junk'; TL.normalize(sc); assert.equal(sc.tl.cam, undefined);
  const im = { id: 'i', duration: 10, bg: { type: 'video', vid: 'v1' }, objects: [], transition: { type: 'cut', dur: 1 } }; TL.enable(im); im.tl.cam = { keys: [{ t: 0, v: V(0, 0, 1) }] }; TL.normalize(im); assert.equal(im.tl.cam, undefined, 'no camera on a media scene');
  assert.equal(TL.camSetKey(im, 1, V(0, 0, 4)), null);
});

test('c10 camera and graphics are one clock: same time gives the camera view AND the object pose; shortening the duration keeps keys', () => {
  const sc = mb({ objects: [icon('a', -71, 42, true)] }); TL.enable(sc); edit(sc, 6, o => { o[0].x = -69; }); TL.camSetKey(sc, 6, V(-69, 44, 9));
  const o = TL.objectsAt(sc, 3)[0], v = TL.camAt(sc, 3); assert.ok(o.x > -71 && o.x < -69); assert.ok(v.z > 6 && v.z < 9);
  TL.setDuration(sc, 4); near(TL.camAt(sc, 100).z, TL.camAt(sc, 4).z, 1e-9, 'clamped to the new end'); assert.equal(TL.camKeys(sc).length, 2);
});

test('c11 v0.11.6 scenes are untouched: no cam = no change; stats/enable do not add anything; older scene with view2 keeps working until converted', () => {
  const sc = mb({ bg: { type: 'mapbox', view: V(-71, 42, 5), view2: V(-69, 44, 9), camDelay: 0, camDur: 3 } }); TL.enable(sc);
  assert.equal(sc.tl.cam, undefined); assert.equal(JSON.stringify(Object.keys(sc.tl).sort()), JSON.stringify(['duration', 'tracks', 'v'])); assert.equal(sc.bg.view2.z, 9);
  const a = JSON.stringify(sc); TL.normalize(sc); assert.equal(JSON.stringify(sc), a);
});

test('m1 media clock: with no trim / speed it is EXACTLY the pre-v0.11.7 rule (loop and hold-last-frame)', () => {
  const old = (b, d, t) => { d = Math.max(0.1, d); const s = Math.max(0, Math.min(+b.vidStart || 0, d)), x = s + Math.max(0, t); return b.vidLoop ? x % d : Math.min(x, d - 0.04); };
  for (const b of [{}, { vidStart: 1.5 }, { vidLoop: true }, { vidStart: 2, vidLoop: true }]) for (const d of [0.5, 3, 7.3]) for (let t = 0; t < 20; t += 0.37) assert.equal(TL.mediaTime(b, d, t), old(b, d, t));
});

test('m2 media clock: trim, speed, loop within the trim window; frame k/30 s maps to the right source frame', () => {
  const b = { vidStart: 1, vidEnd: 4, vidSpeed: 2 }; near(TL.mediaTime(b, 10, 0), 1); near(TL.mediaTime(b, 10, 1), 3); near(TL.mediaTime(b, 10, 1.4), 3.8); near(TL.mediaTime(b, 10, 99), 4 - 0.04, 1e-9, 'holds the last frame of the trim');
  const l = { vidStart: 1, vidEnd: 4, vidSpeed: 2, vidLoop: true }; near(TL.mediaTime(l, 10, 1.5), 1); near(TL.mediaTime(l, 10, 2), 2, 1e-9); assert.ok(TL.mediaTime(l, 10, 123.4) >= 1 && TL.mediaTime(l, 10, 123.4) < 4);
  near(TL.mediaSpan(b, 10), 1.5); near(TL.mediaSpan({}, 6), 6); near(TL.mediaSpan({ vidSpeed: 0.5 }, 6), 12); near(TL.mediaSpan({ vidStart: 2 }, 6), 4);
  const starts = [0, 100, 200, 450, 500], frameAt = tt => { tt = tt * 1000 + 0.5; let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= tt) lo = m; else hi = m - 1; } return lo; };
  const seq = []; for (let f = 0; f < 18; f++) seq.push(frameAt(TL.mediaTime({}, 0.55, f / 30))); assert.deepEqual(seq, [0, 0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 4, 4, 4]);
  assert.ok(seq.every((x, i) => i === 0 || x >= seq[i - 1]), 'frames only move forward');
});

test('m3 fitToMedia: scene length = one pass of the clip (trim and speed applied), mirrored by tl.duration; not for non-media scenes', () => {
  const sc = { id: 'v', duration: 5, bg: { type: 'video', vid: 'x', vidStart: 0 }, objects: [icon('a', 100, 100)], transition: { type: 'cut', dur: 1 } };
  assert.ok(TL.fitToMedia(sc, 7.26)); near(sc.duration, 7.3, 1e-9); TL.enable(sc); sc.bg.vidSpeed = 2; assert.ok(TL.fitToMedia(sc, 7.26)); near(sc.tl.duration, 3.6, 1e-9); near(sc.duration, 3.6, 1e-9);
  edit(sc, 1.5, o => { o[0].x = 400; }); near(TL.objectsAt(sc, 1.5)[0].x, 400); near(TL.objectsAt(sc, 0)[0].x, 100);
  assert.equal(TL.fitToMedia({ bg: { type: 'mapbox' }, duration: 5 }, 7), false);
});

test('m4 timeline on a media scene: graphics keys and media time are driven by the same t', () => {
  const sc = { id: 'v', duration: 6, bg: { type: 'video', vid: 'x', vidStart: 0.5, vidSpeed: 1 }, objects: [icon('a', 100, 100), front('f', [[0, 0], [100, 0], [200, 10]])], transition: { type: 'cut', dur: 1 } }; TL.enable(sc);
  edit(sc, 3, o => { o[0].x = 500; }); edit(sc, 3, o => { o[1].pts = o[1].pts.map(p => [p[0] + 50, p[1] + 20]); });
  for (const t of [0, 1.5, 3, 4.5]) { const mt = TL.mediaTime(sc.bg, 8, t), o = TL.objectsAt(sc, t)[0]; near(mt, 0.5 + t); assert.ok(o.x >= 100 && o.x <= 500); }
  near(TL.objectsAt(sc, 1.5)[0].x, 300, 1e-9); near(TL.objectsAt(sc, 1.5)[1].pts[0][0], 25, 1e-6);
});
