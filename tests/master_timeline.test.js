'use strict';
/* v0.11.6: master timeline engine - automatic keys, routes, fronts, links, legacy conversion. Pure data - run: node --test tests/master_timeline.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const MA = require('../studio/mapanim.js');
const TL = require('../studio/timeline.js');
const clone = v => JSON.parse(JSON.stringify(v));
const near = (a, b, e, m) => assert.ok(Math.abs(a - b) <= (e == null ? 1e-6 : e), (m || '') + ' got ' + a + ' want ' + b);
const icon = (id, x, y, geo) => ({ id, type: 'icon', icon: 'rain', size: 100, x, y, geo: !!geo });
const front = (id, pts, geo) => ({ id, type: 'front', kind: 'cold', size: 28, pts, geo: !!geo });
const scene = (objs, o) => Object.assign({ id: 's1', name: 'S', duration: 12, bg: { type: 'solid' }, objects: objs, transition: { type: 'cut', dur: 1 } }, o || {});
const edit = (sc, T, fn) => { const ed = TL.beginEdit(sc, T); fn(ed.objs, ed); return TL.flush(sc, ed); };
const at = (sc, T, id) => TL.objectsAt(sc, T).find(o => o.id === id);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('1 master duration: typed by the user, mirrors scene.duration, limited, not computed from keys', () => {
  const sc = scene([icon('a', 0, 0)]); TL.enable(sc, { duration: 12 });
  assert.equal(sc.tl.duration, 12); assert.equal(sc.duration, 12);
  TL.setDuration(sc, 7.25); assert.equal(sc.duration, 7.25); TL.setDuration(sc, 0); assert.equal(sc.duration, 0.5); TL.setDuration(sc, 99999); assert.equal(sc.duration, 600);
  TL.setDuration(sc, 12); edit(sc, 3, o => { o[0].x = 50; });
  assert.equal(sc.duration, 12, 'keys never change the typed duration');
  assert.equal(TL.objectsAt(sc, 500)[0].x, 50, 'time beyond the end is clamped');
});

test('2 automatic keys: edit at T creates the key; start pose key is made automatically; editing the same time updates, never duplicates', () => {
  const sc = scene([icon('a', 100, 100)]); TL.enable(sc);
  const r = edit(sc, 1, o => { o[0].x = 300; o[0].y = 100; });
  assert.ok(r.changed); const tr = TL.trackOf(sc, 'a'); assert.equal(tr.keys.length, 2); assert.equal(tr.keys[0].t, 0); assert.equal(tr.keys[0].x, 100); assert.equal(tr.keys[1].t, 1); assert.equal(tr.keys[1].x, 300);
  edit(sc, 1, o => { o[0].x = 350; }); assert.equal(TL.trackOf(sc, 'a').keys.length, 2, 'same time = same key'); assert.equal(TL.trackOf(sc, 'a').keys[1].x, 350);
  edit(sc, 1.02, o => { o[0].x = 360; }); assert.equal(TL.trackOf(sc, 'a').keys.length, 2, 'within a hundredth of a second is the same key');
  edit(sc, 4, o => { o[0].x = 360; o[0].y = 400; }); assert.equal(TL.trackOf(sc, 'a').keys.length, 3);
});

test('3 independent objects: each has its own keys and its own timing on the same clock', () => {
  const sc = scene([icon('a', 0, 0), icon('b', 0, 500)]); TL.enable(sc);
  edit(sc, 2, o => { o[0].x = 200; }); edit(sc, 5, o => { o[1].x = 500; });
  assert.deepEqual(TL.trackOf(sc, 'a').keys.map(k => k.t), [0, 2]); assert.deepEqual(TL.trackOf(sc, 'b').keys.map(k => k.t), [0, 5]);
  near(at(sc, 1, 'a').x, 100); near(at(sc, 1, 'b').x, 100); near(at(sc, 2.5, 'a').x, 200); near(at(sc, 2.5, 'b').x, 250);
});

test('4 A->B in 1 s vs 4 s along the same path: speed = distance / time', () => {
  const mk = tB => { const sc = scene([icon('a', 0, 0)]); TL.enable(sc); edit(sc, tB, o => { o[0].x = 400; o[0].y = 300; }); return sc; };
  const s1 = mk(1), s4 = mk(4);
  near(at(s1, 0.5, 'a').x, 200); near(at(s4, 2, 'a').x, 200);
  near(at(s1, 0.25, 'a').x, 100); near(at(s4, 1, 'a').x, 100, 1e-6, 'same path, quarter of the time');
  const sp = sc => TL.segSpeed(sc, 'a', TL.trackOf(sc, 'a').keys[1].id); near(sp(s1) / sp(s4), 4, 1e-9);
  /* A(0) -> B(1) -> C(4): each leg has its own constant speed */
  const sc = scene([icon('a', 0, 0)]); TL.enable(sc); edit(sc, 1, o => { o[0].x = 100; }); edit(sc, 4, o => { o[0].x = 400; });
  near(at(sc, 0.5, 'a').x, 50); near(at(sc, 2.5, 'a').x, 250); near(TL.segSpeed(sc, 'a', TL.trackOf(sc, 'a').keys[2].id), 100);
  /* moving B farther raises the speed of that leg unless its time changes */
  const k = TL.trackOf(sc, 'a').keys[2]; const before = TL.segSpeed(sc, 'a', k.id); edit(sc, 4, o => { o[0].x = 700; }); assert.ok(TL.segSpeed(sc, 'a', k.id) > before);
});

test('5 curved routes: handles shape the route and add NO keys; constant arc-length speed on a curve', () => {
  const sc = scene([icon('a', 0, 0)]); TL.enable(sc); edit(sc, 4, o => { o[0].x = 400; o[0].y = 0; });
  const k = TL.trackOf(sc, 'a').keys[1], n0 = TL.trackOf(sc, 'a').keys.length;
  TL.setHandles(sc, 'a', k.id, [0, 200], [0, 200]);
  assert.equal(TL.trackOf(sc, 'a').keys.length, n0, 'no keys added'); assert.ok(at(sc, 2, 'a').y > 50, 'the route bends away from the straight line');
  /* constant speed along the arc: equal time steps cover (almost) equal distances */
  const pts = []; for (let i = 0; i <= 40; i++) { const o = at(sc, i / 10, 'a'); pts.push([o.x, o.y]); }
  const d = pts.slice(1).map((p, i) => dist(p, pts[i])), mean = d.reduce((a, b) => a + b) / d.length;
  d.forEach(v => assert.ok(Math.abs(v - mean) / mean < 0.04, 'even speed ' + v + ' vs ' + mean));
  TL.setPath(sc, 'a', k.id, 'line'); near(at(sc, 2, 'a').y, 0, 1e-9, 'back to straight');
  TL.setPath(sc, 'a', k.id, 'curve'); assert.equal(TL.trackOf(sc, 'a').keys.length, n0);
});

test('6 repeated scrubbing never creates keys or modifies the saved scene', () => {
  const sc = scene([icon('a', 0, 0), front('f', [[0, 0], [100, 50], [200, 0], [300, 60]]), icon('c', 50, 50)]); TL.enable(sc); edit(sc, 2, o => { o[0].x = 300; o[1].pts = o[1].pts.map(p => [p[0] + 40, p[1] + 10]); });
  const before = JSON.stringify(sc);
  for (let i = 0; i < 200; i++) { const T = (i * 37 % 120) / 10, ed = TL.beginEdit(sc, T); assert.equal(TL.dirty(sc, ed), false); const r = TL.flush(sc, ed); assert.equal(r.changed, false); TL.objectsAt(sc, T); }
  assert.equal(JSON.stringify(sc), before);
});

test('7 editing between keys inserts a key without touching the earlier / later saved states', () => {
  const sc = scene([icon('a', 0, 0)]); TL.enable(sc); edit(sc, 2, o => { o[0].x = 200; }); edit(sc, 8, o => { o[0].x = 800; });
  const saved = clone(TL.trackOf(sc, 'a').keys); edit(sc, 5, o => { o[0].y = 123; });
  const keys = TL.trackOf(sc, 'a').keys; assert.deepEqual(keys.map(k => k.t), [0, 2, 5, 8]);
  [0, 2, 8].forEach(t => { const a = saved.find(k => k.t === t), b = keys.find(k => k.t === t); assert.equal(b.x, a.x); assert.equal(b.y, a.y); });
  assert.equal(keys[2].y, 123); near(keys[2].x, 500);
});

test('8 key operations: retime, delete, ease, start key protected, no duplicates', () => {
  const sc = scene([icon('a', 0, 0)]); TL.enable(sc); edit(sc, 2, o => { o[0].x = 200; }); edit(sc, 6, o => { o[0].x = 600; });
  const [k0, k1, k2] = TL.trackOf(sc, 'a').keys;
  assert.equal(TL.moveKey(sc, 'a', k0.id, 1), false, 'start key stays at 0'); assert.equal(TL.delKey(sc, 'a', k0.id), false);
  assert.equal(TL.moveKey(sc, 'a', k1.id, 6), false, 'cannot land on another key'); assert.equal(TL.moveKey(sc, 'a', k1.id, 3.04), true); near(k1.t, 3);
  near(at(sc, 3, 'a').x, 200); assert.equal(TL.setEase(sc, 'a', k2.id, 'inout'), true); const m = at(sc, 4.5, 'a').x; near(m, 400, 1e-6, 'ease in/out is symmetric');
  assert.ok(at(sc, 3.5, 'a').x < 200 + 400 * (0.5 / 3), 'ease in: slower at the start');
  assert.equal(TL.delKey(sc, 'a', k1.id), true); assert.equal(TL.trackOf(sc, 'a').keys.length, 2);
  assert.equal(TL.delKey(sc, 'a', k2.id), true); assert.equal(TL.trackOf(sc, 'a'), null, 'back to a static object'); near(sc.objects[0].x, 0);
});

test('9 fronts: edits at 0, 2 and 5 s with 4 control points; whole-front moves; geometric interpolation', () => {
  const f0 = [[0, 0], [100, 40], [200, 40], [300, 0]], sc = scene([front('f', clone(f0))]); TL.enable(sc);
  edit(sc, 2, o => { o[0].pts = o[0].pts.map(p => [p[0] + 200, p[1] + 100]); });                       // whole move
  edit(sc, 5, o => { o[0].pts[1] = [o[0].pts[1][0], o[0].pts[1][1] + 120]; });                           // bend one point
  edit(sc, 0, o => { o[0].pts[3] = [330, -20]; });                                                       // reshape the start pose
  const tr = TL.trackOf(sc, 'f'); assert.deepEqual(tr.keys.map(k => k.t), [0, 2, 5]); tr.keys.forEach(k => assert.equal(k.pts.length, 4));
  assert.deepEqual(at(sc, 0, 'f').pts[3], [330, -20]); assert.deepEqual(at(sc, 2, 'f').pts[0], [200, 100]); assert.equal(at(sc, 5, 'f').pts[1][1], 40 + 100 + 120);
  /* halfway the centre sits halfway along the route and the points stay finite and smooth */
  const mid = at(sc, 1, 'f'), c = MA.centroid(mid); const ca = MA.centroid(tr.keys[0]), cb = MA.centroid(tr.keys[1]); near(c[0], (ca[0] + cb[0]) / 2, 1e-6); near(c[1], (ca[1] + cb[1]) / 2, 1e-6);
  for (let t = 0; t <= 12; t += 0.25) at(sc, t, 'f').pts.forEach(p => assert.ok(isFinite(p[0]) && isFinite(p[1])));
});

test('10 a rotating front keeps its size (rotation + scale are interpolated, not the corner points)', () => {
  const L = 300, a = [[-L, 0], [-L / 2, 0], [L / 2, 0], [L, 0]].map(p => [p[0] + 500, p[1] + 500]), th = Math.PI / 2;
  const b = a.map(p => { const x = p[0] - 500, y = p[1] - 500; return [500 + x * Math.cos(th) - y * Math.sin(th), 500 + x * Math.sin(th) + y * Math.cos(th)]; });
  const sc = scene([front('f', a)]); TL.enable(sc); edit(sc, 4, o => { o[0].pts = b; });
  const m = at(sc, 2, 'f').pts, len = Math.hypot(m[3][0] - m[0][0], m[3][1] - m[0][1]); near(len, 2 * L, 1e-6, 'a naive point blend would shrink it to ~' + (2 * L * Math.SQRT1_2).toFixed(0));
  near(Math.atan2(m[3][1] - m[0][1], m[3][0] - m[0][0]), Math.PI / 4, 1e-6);
});

test('11 adding control points at a later key interpolates and never corrupts the earlier shape', () => {
  const f0 = [[0, 0], [100, 40], [200, 40], [300, 0]], sc = scene([front('f', clone(f0))]); TL.enable(sc);
  edit(sc, 6, o => { o[0].pts.splice(2, 0, [150, 100], [180, 20]); });
  const tr = TL.trackOf(sc, 'f'); assert.equal(tr.keys[0].pts.length, 4); assert.equal(tr.keys[1].pts.length, 6);
  assert.deepEqual(at(sc, 0, 'f').pts, f0, 'start pose exact'); assert.equal(at(sc, 6, 'f').pts.length, 6); assert.equal(at(sc, 3, 'f').pts.length, 6);
  at(sc, 3, 'f').pts.forEach(p => assert.ok(isFinite(p[0] + p[1])));
  edit(sc, 9, o => { o[0].pts.splice(1, 3); }); assert.equal(TL.trackOf(sc, 'f').keys[2].pts.length, 3); assert.deepEqual(TL.trackOf(sc, 'f').keys[0].pts, f0);
});

test('12 attached children follow the parent geometry; independent ones do not', () => {
  const f = front('f', [[0, 0], [100, 0], [200, 0], [300, 0]]), c = icon('c', 150, -40), ind = icon('i', 150, -40); const sc = scene([f, c, ind]);
  c.attach = MA.makeAttach(f, c); TL.enable(sc);
  edit(sc, 4, o => { o[0].pts = o[0].pts.map(p => [p[0] + 400, p[1] + 200]); });
  near(at(sc, 4, 'c').x, 550, 1e-6); near(at(sc, 4, 'c').y, 160, 1e-6); near(at(sc, 2, 'c').x, 350, 1e-6);
  near(at(sc, 4, 'i').x, 150); near(at(sc, 4, 'i').y, -40);
  /* the front bends -> the attached child rides on the curve at the same fraction */
  edit(sc, 8, o => { o[0].pts[3] = [700, 600]; });
  const ff = at(sc, 6, 'f'), cc = at(sc, 6, 'c'), on = MA.attachFrame(ff, c.attach.u); const [x, y] = MA.attachPos(c.attach, ff); near(cc.x, x, 1e-6); near(cc.y, y, 1e-6); void on;
});

test('13 moving a linked child keyframes its relative offset and keeps the link', () => {
  const f = front('f', [[0, 0], [100, 0], [200, 0], [300, 0]]), c = icon('c', 150, -40); const sc = scene([f, c]); c.attach = MA.makeAttach(f, c); TL.enable(sc);
  edit(sc, 4, o => { o[0].pts = o[0].pts.map(p => [p[0] + 400, p[1]]); });
  edit(sc, 2, o => { o[1].y -= 60; });
  assert.ok(sc.objects[1].attach && sc.objects[1].attach.to === 'f', 'still attached'); const keys = TL.trackOf(sc, 'c').keys; assert.ok(keys.some(k => k.t === 2 && k.att));
  const p2 = at(sc, 2, 'c'); near(p2.y, -100, 1e-6); near(at(sc, 0, 'c').y, -40, 1e-6); near(at(sc, 4, 'c').y, -100, 1e-6, 'the last key holds');
  near(at(sc, 4, 'c').x, 550, 1e-6);
});

test('14 follow: inherits the parent movement and keeps its own offset; unlink keeps the visible position', () => {
  const p = icon('p', 100, 100), c = icon('c', 200, 150), sc = scene([p, c]); TL.enable(sc); edit(sc, 4, o => { o[0].x = 500; o[0].y = 300; });
  assert.deepEqual(TL.link(sc, 'c', 'follow', 'p', 0), { ok: true });
  near(at(sc, 0, 'c').x, 200); near(at(sc, 4, 'c').x, 600); near(at(sc, 4, 'c').y, 350); near(at(sc, 2, 'c').x, 400);
  /* editing the child while it follows keyframes its own offset */
  edit(sc, 2, o => { o[1].x += 100; }); near(at(sc, 2, 'c').x, 500); near(at(sc, 4, 'c').x, 700, 1e-6, 'its own offset (+100) holds after the key, plus the parent movement');
  const T = 3, before = at(sc, T, 'c'); TL.link(sc, 'c', 'independent', null, T); const after = at(sc, T, 'c'); near(after.x, before.x, 1e-6); near(after.y, before.y, 1e-6);
  assert.equal(sc.objects[1].follow, undefined);
  for (const t of [0, 1, 2, 4, 6]) { near(at(sc, t, 'c').x, TL.objectsAt(sc, t).find(o => o.id === 'c').x); }
});

test('15 follow set while editing at T keeps the object exactly where it is on screen', () => {
  const p = icon('p', 100, 100), c = icon('c', 300, 100), sc = scene([p, c]); TL.enable(sc); edit(sc, 4, o => { o[0].x = 500; });
  const r = edit(sc, 2, (o, ed) => { o[1].follow = { to: 'p' }; }); assert.ok(r.changed);
  near(at(sc, 2, 'c').x, 300, 1e-6, 'no jump at the playhead'); near(at(sc, 4, 'c').x, 500, 1e-6); near(at(sc, 0, 'c').x, 100, 1e-6, 'relative offset (+200 from the parent) kept: 100 + 200 - 200');
});

test('16 invalid links: circles, missing parents, different coordinate systems are refused or removed', () => {
  const a = icon('a', 0, 0), b = icon('b', 10, 0), g = icon('g', 0, 0, true), sc = scene([a, b, g]); TL.enable(sc);
  assert.equal(TL.link(sc, 'b', 'follow', 'a', 0).ok, true); assert.equal(TL.link(sc, 'a', 'follow', 'b', 0).ok, false, 'circle'); assert.equal(TL.link(sc, 'a', 'follow', 'a', 0).ok, false);
  assert.equal(TL.link(sc, 'g', 'attach', 'a', 0).ok, false, 'geo vs screen'); assert.equal(TL.link(sc, 'a', 'follow', 'nope', 0).ok, false);
  const bad = scene([Object.assign(icon('x', 0, 0), { follow: { to: 'ghost' } }), Object.assign(icon('y', 0, 0), { follow: { to: 'z' } }), Object.assign(icon('z', 0, 0), { follow: { to: 'y' } })]); TL.enable(bad);
  assert.ok(TL.sanitize(bad) >= 2); assert.equal(bad.objects[0].follow, undefined); assert.ok(!(bad.objects[1].follow && bad.objects[2].follow), 'one of the pair loses its link');
  TL.objectsAt(bad, 1);   // must not throw / loop
});

test('17 undo / redo model: the whole scene JSON restores exactly (snapshot round trip)', () => {
  const sc = scene([icon('a', 0, 0)]); TL.enable(sc); const s0 = JSON.stringify(sc); edit(sc, 2, o => { o[0].x = 200; }); const s1 = JSON.stringify(sc); assert.notEqual(s0, s1);
  const r = JSON.parse(s0); assert.equal(TL.objectsAt(r, 2)[0].x, 0); const r1 = JSON.parse(s1); near(TL.objectsAt(r1, 2)[0].x, 200); near(TL.objectsAt(r1, 1)[0].x, 100);
});

test('18 pinned (lng/lat) vs screen objects: pinned routes measure in locally square space and keep geographic coordinates', () => {
  const sc = scene([icon('a', -72, 42, true)], { bg: { type: 'mapbox' } }); TL.enable(sc); edit(sc, 2, o => { o[0].x = -70; o[0].y = 43; });
  near(at(sc, 1, 'a').x, -71); near(at(sc, 1, 'a').y, 42.5); assert.equal(at(sc, 1, 'a').geo, true);
  const sc2 = scene([icon('a', 10, 10)]); TL.enable(sc2); edit(sc2, 2, o => { o[0].x = 110; }); near(at(sc2, 1, 'a').x, 60);
});

test('19 legacy v0.11.5 step shows: untouched without conversion; conversion is explicit, equal at the step times, and reversible', () => {
  const sc = scene([icon('a', 100, 100), front('f', [[0, 0], [100, 40], [200, 40], [300, 0]])]); MA.enable(sc, { hold: 2 }); MA.addStep(sc, 0, { hold: 2, dur: 3 });
  sc.anim.steps[1].objects[0].x = 700; sc.anim.steps[1].objects[1].pts = sc.anim.steps[1].objects[1].pts.map(p => [p[0] + 200, p[1] + 100]); MA.normalize(sc);
  const legacyAt = t => clone(MA.objectsAt(sc, t)), snap = JSON.stringify(sc);
  assert.equal(TL.enabled(sc), false); assert.equal(JSON.stringify(sc), snap);
  const ref = [0, 1, 2, 3.5, 5, 6.5, 8].map(t => [t, legacyAt(t)]), dur = sc.duration;
  const r = TL.fromSteps(sc); assert.equal(r.ok, true); assert.equal(sc.anim, undefined); assert.ok(TL.enabled(sc)); near(sc.duration, dur);
  ref.forEach(([t, objs]) => { objs.forEach(o => { const q = at(sc, t, o.id); if (o.pts) o.pts.forEach((p, i) => { near(q.pts[i][0], p[0], 1e-6, 'pts@' + t); near(q.pts[i][1], p[1], 1e-6); }); else { near(q.x, o.x, 1e-6, 'x@' + t); near(q.y, o.y, 1e-6); } }); }, 'step times');
  assert.equal(TL.toSteps(sc).ok, true); assert.equal(JSON.stringify(sc), snap, 'lossless back to the steps');
});

test('20 hand-edited / broken timeline data is repaired on load and never throws', () => {
  const sc = scene([icon('a', 0, 0)]); sc.tl = { v: 1, duration: 'x', tracks: { a: { keys: [{ t: 3, x: 5, y: 5 }, { t: 3.01, x: 9 }, { t: 'bad' }, { t: 1, x: 'z', y: 2, e: 'weird', h1: [1] }] }, ghost: { keys: [{ t: 1, x: 1, y: 1 }] } } };
  TL.normalize(sc); assert.equal(sc.tl.tracks.ghost, undefined); const ks = sc.tl.tracks.a.keys; assert.deepEqual(ks.map(k => k.t), [0, 1, 3]); assert.ok(ks.every(k => k.id)); assert.equal(ks[1].e, undefined); assert.equal(ks[1].x, undefined);
  assert.ok(sc.duration > 0); for (let t = -1; t < 15; t += 0.5) TL.objectsAt(sc, t);
});

test('21 removing an object removes its track; new object at T>0 appears from T; z-order edits are kept', () => {
  const sc = scene([icon('a', 0, 0), icon('b', 5, 5)]); TL.enable(sc); edit(sc, 2, o => { o[0].x = 200; });
  edit(sc, 3, (o, ed) => { o.push({ id: 'n', type: 'icon', icon: 'sun', size: 80, x: 10, y: 10 }); });
  assert.ok(sc.objects.find(o => o.id === 'n')); assert.equal(at(sc, 1, 'n').hidden, true); assert.ok(!at(sc, 3.5, 'n').hidden);
  edit(sc, 3, o => { o.reverse(); }); assert.equal(sc.objects[0].id, 'n');
  edit(sc, 3, o => { const i = o.findIndex(q => q.id === 'a'); o.splice(i, 1); }); assert.equal(sc.objects.some(o => o.id === 'a'), false); assert.equal(TL.trackOf(sc, 'a'), null);
});

test('22 performance: 60 objects x 12 s resolved at 30 fps stays cheap; static objects are not copied', () => {
  const objs = []; for (let i = 0; i < 60; i++) objs.push(i % 3 ? icon('i' + i, i * 10, i * 5) : front('f' + i, [[0, 0], [50, 20], [100, 0], [150, 30]].map(p => [p[0] + i * 10, p[1]]))); const sc = scene(objs); TL.enable(sc);
  for (let i = 0; i < 60; i += 3) edit(sc, 2 + (i % 5), o => { const q = o.find(x => x.id === 'i' + (i + 1)); if (q) q.x += 100; });
  const st = performance.now(); for (let k = 0; k < 360; k++) TL.objectsAt(sc, k / 30); const ms = performance.now() - st; assert.ok(ms < 800, 'took ' + ms.toFixed(0) + ' ms');
  const arr = TL.objectsAt(sc, 1); assert.equal(arr[0], sc.objects[0], 'untouched object returned as is');
});

test('23 live editing: children ride along while the parent is dragged, and a plain parent edit does not key the children', () => {
  const f = front('f', [[0, 0], [100, 0], [200, 0], [300, 0]]), c = icon('c', 150, -40), p = icon('p', 400, 0), k = icon('k', 450, 30); k.follow = { to: 'p' };
  const sc = scene([f, c, p, k]); c.attach = MA.makeAttach(f, c); TL.enable(sc);
  const ed = TL.beginEdit(sc, 2); TL.liveSync(ed);
  ed.objs[0].pts = ed.objs[0].pts.map(q => [q[0] + 200, q[1] + 50]); ed.objs[2].x += 100; ed.objs[2].y += 20;
  assert.ok(TL.liveSync(ed) >= 2); near(ed.objs[1].x, 350); near(ed.objs[1].y, 10); near(ed.objs[3].x, 550); near(ed.objs[3].y, 50);
  const r = TL.flush(sc, ed); assert.equal(TL.trackOf(sc, 'c'), null, 'no key for the attached child'); assert.equal(TL.trackOf(sc, 'k'), null, 'no key for the follower');
  assert.deepEqual(r.keys.map(x => x[0]).sort(), ['f', 'p']); near(at(sc, 2, 'c').x, 350); near(at(sc, 2, 'k').x, 550); near(at(sc, 0, 'k').x, 450);
  /* dragging the child itself while the parent stays: only the child gets a key (its relative offset) */
  const e2 = TL.beginEdit(sc, 2); TL.liveSync(e2); e2.objs[1].x += 30; TL.liveSync(e2); near(e2.objs[1].x, 380); TL.flush(sc, e2);
  assert.ok(TL.trackOf(sc, 'c')); assert.equal(TL.trackOf(sc, 'f').keys.length, 2);
});
