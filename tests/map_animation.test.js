'use strict';
/* Map animation steps (v0.11.0): data model, timing, geographic interpolation, appear / disappear, determinism, old shows unchanged.
   Pure data – no browser. Run: node --test tests/map_animation.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const MA = require('../studio/mapanim.js');

const clone = v => JSON.parse(JSON.stringify(v));
const front = (id, pts, extra) => Object.assign({ id, type: 'front', geo: true, kind: 'cold', size: 28, flip: false, anim: { in: 'fade', delay: 0, dur: 0.6 }, pts }, extra || {});
const text = (id, x, y, t, extra) => Object.assign({ id, type: 'text', geo: true, x, y, text: t, size: 60, color: '#ffffff', weight: 800, anim: { in: 'fade', delay: 0, dur: 0.6 } }, extra || {});
const icon = (id, x, y, ic) => ({ id, type: 'icon', geo: true, x, y, icon: ic || 'rain', size: 100, anim: { in: 'fade', delay: 0, dur: 0.6 } });
const hl = (id, x, y, kind) => ({ id, type: 'hl', geo: true, x, y, kind: kind || 'H', value: '1030', size: 200, anim: { in: 'fade', delay: 0, dur: 0.6 } });
const NY = [[-75, 41], [-74, 41.6], [-73, 42.1], [-72.2, 42.5], [-71.5, 42.7]];
const scene = () => ({ id: 's1', name: 'Map', duration: 6, bg: { type: 'mapbox' }, objects: [front('f1', clone(NY)), text('t1', -73, 43, 'COLD FRONT'), icon('i1', -71, 42, 'rain'), hl('h1', -76, 44, 'H')] });
const byId = (arr, id) => arr.filter(o => o.id === id);

test('a scene without animation is completely untouched', () => {
  const sc = scene(), json = JSON.stringify(sc);
  assert.equal(MA.isAnimated(sc), false);
  assert.equal(MA.objectsAt(sc, 3), sc.objects);          // same array, not a copy
  assert.equal(MA.normalize(sc), sc);
  assert.equal(JSON.stringify(sc), json);
  assert.equal(MA.totalDuration(sc), 6);
  assert.equal(MA.syncDuration(sc).duration, 6);
});

test('enable creates one step and keeps scene.objects as step 1', () => {
  const sc = scene(), objs = sc.objects; MA.enable(sc);
  assert.equal(sc.anim.v, 1); assert.equal(sc.anim.steps.length, 1); assert.equal(sc.objects, objs);
  assert.equal(sc.anim.steps[0].objects, undefined);
  assert.equal(sc.duration, 3); assert.ok(sc.anim.steps[0].id);
});

test('add step: inherits graphics (same ids, deep copy) and reduces fronts to few control points', () => {
  const sc = scene(); sc.objects[0].pts = Array.from({ length: 20 }, (_, i) => [-75 + i * 0.2, 41 + Math.sin(i / 4)]);
  MA.enable(sc); const at = MA.addStep(sc, 0);
  assert.equal(at, 1); const s2 = sc.anim.steps[1];
  assert.deepEqual(s2.objects.map(o => o.id), ['f1', 't1', 'i1', 'h1']);
  assert.notEqual(s2.objects[0], sc.objects[0]);
  assert.ok(s2.objects[0].pts.length <= MA.LIMITS.frontPts);
  assert.equal(sc.objects[0].pts.length, 20, 'step 1 is not simplified');
  assert.deepEqual(s2.objects[0].pts[0], sc.objects[0].pts[0], 'end points kept');
  assert.deepEqual(s2.objects[0].pts[s2.objects[0].pts.length - 1], sc.objects[0].pts[19]);
  assert.equal(s2.hold, 2); assert.equal(s2.dur, 3); assert.equal(s2.ease, 'inout');
  s2.objects[1].text = 'X'; assert.equal(sc.objects[1].text, 'COLD FRONT', 'editing a step never changes another one');
});

test('timeline and scene duration: hold + moves, divided by speed', () => {
  const sc = scene(); MA.enable(sc); MA.setStep(sc, 0, { hold: 2 }); MA.addStep(sc, 0, { hold: 1.5, dur: 3 }); MA.addStep(sc, 1, { hold: 1, dur: 2 });
  const tl = MA.timeline(sc);
  assert.deepEqual(tl.segs.map(s => s.kind), ['hold', 'move', 'hold', 'move', 'hold']);
  assert.equal(tl.total, 2 + 3 + 1.5 + 2 + 1); assert.equal(sc.duration, 9.5);
  assert.deepEqual(MA.stepTimes(sc, 1), { arrive: 5, leave: 6.5 });
  MA.setSpeed(sc, 2); assert.equal(sc.duration, 4.75);
  assert.equal(MA.stepAt(sc, 0), 0); assert.equal(MA.stepAt(sc, 3), 1); assert.equal(MA.stepAt(sc, 4.7), 2);
  MA.setSpeed(sc, 100); assert.equal(sc.anim.speed, 4, 'speed is clamped');
});

test('duplicate / delete / reorder keep ids and keep step 1 in scene.objects', () => {
  const sc = scene(); MA.enable(sc); MA.addStep(sc, 0); MA.addStep(sc, 1);
  sc.anim.steps[1].objects[1].text = 'ONE'; sc.anim.steps[2].objects[1].text = 'TWO'; sc.objects[1].text = 'ZERO';
  const names = () => MA.stepCount(sc) + ':' + [0, 1, 2, 3].slice(0, MA.stepCount(sc)).map(i => MA.stepObjects(sc, i)[1].text).join(',');
  assert.equal(names(), '3:ZERO,ONE,TWO');
  assert.equal(MA.moveStep(sc, 0, 2), 2); assert.equal(names(), '3:ONE,TWO,ZERO');
  assert.equal(sc.objects[1].text, 'ONE', 'scene.objects always holds the first step');
  assert.equal(sc.anim.steps[0].objects, undefined);
  assert.ok(sc.anim.steps[1].objects && sc.anim.steps[2].objects);
  assert.equal(MA.moveStep(sc, 2, 0), 0); assert.equal(names(), '3:ZERO,ONE,TWO');
  assert.equal(MA.dupStep(sc, 1), 2); assert.equal(names(), '4:ZERO,ONE,ONE,TWO');
  assert.equal(new Set(sc.anim.steps.map(s => s.id)).size, 4, 'step ids stay unique');
  assert.equal(MA.delStep(sc, 0), 0); assert.equal(names(), '3:ONE,ONE,TWO'); assert.equal(sc.objects[1].text, 'ONE');
  assert.equal(MA.delStep(sc, 2), 1); assert.equal(names(), '2:ONE,ONE');
  assert.equal(MA.delStep(sc, 0), 0); assert.equal(MA.delStep(sc, 0), null, 'the last step cannot be deleted');
  assert.equal(sc.duration, MA.totalDuration(sc));
});

test('step limit', () => {
  const sc = scene(); MA.enable(sc); for (let i = 0; i < 60; i++) MA.addStep(sc, null);
  assert.equal(sc.anim.steps.length, MA.LIMITS.maxSteps); assert.equal(MA.addStep(sc, 0), null);
});

test('flatten keeps the chosen step and removes the animation', () => {
  const sc = scene(); MA.enable(sc); MA.addStep(sc, 0); sc.anim.steps[1].objects[1].text = 'LATER';
  MA.flatten(sc, 1); assert.equal(sc.anim, undefined); assert.equal(sc.objects[1].text, 'LATER'); assert.ok(sc.duration >= 1);
});

test('hold returns the step array itself; saved objects are never modified by interpolation', () => {
  const sc = scene(); MA.enable(sc); MA.setStep(sc, 0, { hold: 1 }); MA.addStep(sc, 0, { simplify: false, hold: 1, dur: 2 }); const s2 = sc.anim.steps[1];
  s2.objects[0].pts = s2.objects[0].pts.map(p => [p[0] + 3, p[1] - 1]); s2.objects[1].text = 'NEW'; s2.objects = s2.objects.filter(o => o.id !== 'i1'); s2.objects.push(icon('n1', -70, 40, 'sun'));
  MA.normalize(sc);
  assert.equal(MA.objectsAt(sc, 0.5), sc.objects, 'hold 1 = step 1 array');
  assert.equal(MA.objectsAt(sc, 3.5), s2.objects, 'hold 2 = step 2 array');
  const before = JSON.stringify(sc);
  for (let t = 0; t <= sc.duration; t += 0.13) MA.objectsAt(sc, t);
  assert.equal(JSON.stringify(sc), before, 'rendering every moment of the animation changes nothing that is saved');
});

test('fronts glide between positions: same point count blends point by point, ends are exact', () => {
  const sc = scene(); MA.enable(sc); MA.setStep(sc, 0, { hold: 1 }); MA.addStep(sc, 0, { simplify: false, hold: 1, dur: 2, ease: 'linear' });
  sc.anim.steps[1].objects[0].pts = NY.map(p => [p[0] + 4, p[1] - 0.5]);
  const f = t => byId(MA.objectsAt(sc, t), 'f1')[0];
  assert.deepEqual(f(1).pts, NY);
  assert.deepEqual(f(3).pts, NY.map(p => [p[0] + 4, p[1] - 0.5]));
  const mid = f(2).pts; mid.forEach((p, i) => { assert.ok(Math.abs(p[0] - (NY[i][0] + 2)) < 1e-9); assert.ok(Math.abs(p[1] - (NY[i][1] - 0.25)) < 1e-9); });
  assert.equal(mid.length, NY.length);
  assert.equal(f(2).kind, 'cold');
});

test('fronts with a different number of points are resampled (no jump, no distortion of end points)', () => {
  const sc = scene(); MA.enable(sc); MA.setStep(sc, 0, { hold: 1 }); MA.addStep(sc, 0, { simplify: false, hold: 1, dur: 2, ease: 'linear' });
  const B = [[-72, 42], [-71.2, 42.4], [-70.4, 42.1]]; sc.anim.steps[1].objects[0].pts = B;
  const f = t => byId(MA.objectsAt(sc, t), 'f1')[0];
  const a = f(1.001).pts, m = f(2).pts, z = f(2.999).pts;
  assert.ok(m.length >= 8, 'a common point count is used while moving');
  [a, m, z].forEach(P => assert.equal(P.length, m.length));
  assert.ok(Math.hypot(a[0][0] - NY[0][0], a[0][1] - NY[0][1]) < 0.01, 'starts where step 1 starts');
  assert.ok(Math.hypot(z[z.length - 1][0] - B[2][0], z[z.length - 1][1] - B[2][1]) < 0.01, 'ends where step 2 ends');
  assert.ok(Math.hypot(m[0][0] - (NY[0][0] + B[0][0]) / 2, m[0][1] - (NY[0][1] + B[0][1]) / 2) < 0.01, 'start point glides to the midpoint');
  // continuity: successive frames never jump
  let prev = f(1.001).pts; for (let t = 1.05; t < 3; t += 0.05) { const P = f(t).pts, step = Math.max(...P.map((p, i) => i < prev.length ? Math.hypot(p[0] - prev[i][0], p[1] - prev[i][1]) : 0)); assert.ok(step < 0.5, 'smooth at t=' + t + ' step=' + step); prev = P; }
  assert.deepEqual(f(3).pts, B, 'exact points at the end (no resampling residue)');
});

test('resample keeps both ends and spaces points by length', () => {
  const R = MA.resample([[0, 0], [10, 0], [10, 10]], 21, { type: 'line' });
  assert.equal(R.length, 21); assert.deepEqual(R[0], [0, 0]); assert.deepEqual(R[20], [10, 10]);
  const d = []; for (let i = 1; i < R.length; i++) d.push(Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1]));
  assert.ok(Math.max(...d) / Math.min(...d) < 1.3, 'roughly even spacing');
});

test('simplifyPts keeps ends and the overall shape', () => {
  const pts = Array.from({ length: 40 }, (_, i) => [i, Math.sin(i / 6) * 5]); const s = MA.simplifyPts(pts, 6);
  assert.equal(s.length, 6); assert.deepEqual(s[0], pts[0]); assert.deepEqual(s[5], pts[39]);
  assert.equal(MA.simplifyPts(pts.slice(0, 4), 6).length, 4, 'already few points: unchanged');
});

test('objects only in the next step fade / scale in; objects only in the earlier step fade out and are gone before the move ends', () => {
  const sc = scene(); MA.enable(sc); MA.setStep(sc, 0, { hold: 1 }); MA.addStep(sc, 0, { simplify: false, hold: 1, dur: 4, ease: 'linear' });
  const s2 = sc.anim.steps[1]; s2.objects = s2.objects.filter(o => o.id !== 'i1'); s2.objects.push(icon('n1', -70, 40, 'sun')); MA.normalize(sc);
  const at = u => MA.objectsAt(sc, 1 + 4 * u);
  assert.equal(byId(at(0.001), 'n1')[0]._a < 0.01, true);
  assert.equal(byId(at(0.001), 'i1')[0]._a > 0.99, true);
  const mid = at(0.5), n = byId(mid, 'n1')[0], i = byId(mid, 'i1')[0];
  assert.ok(n._a > 0.3 && n._a < 0.8 && n._s < 1 && n._s > 0.9, 'entering: partly faded in, slightly smaller');
  assert.ok(i._a > 0.05 && i._a < 0.7, 'leaving: partly faded out');
  assert.equal(byId(at(0.9), 'i1')[0]._a, 0, 'gone before the end of the move');
  assert.equal(byId(MA.objectsAt(sc, 5.001), 'i1').length, 0, 'not drawn at all once step 2 holds');
  const aIn = [0.1, 0.2, 0.4, 0.6, 0.8, 0.95].map(u => byId(at(u), 'n1')[0]._a); aIn.forEach((v, k) => { if (k) assert.ok(v >= aIn[k - 1]); });
  assert.equal(byId(MA.objectsAt(sc, 5.5), 'n1')[0]._a, undefined, 'fully there during the hold: no opacity override');
});

test('a leaving object keeps drifting the way it was already moving', () => {
  const sc = scene(); MA.enable(sc); MA.setStep(sc, 0, { hold: 1 }); MA.addStep(sc, 0, { simplify: false, hold: 1, dur: 4, ease: 'linear' }); MA.addStep(sc, 1, { simplify: false, hold: 1, dur: 4, ease: 'linear' });
  sc.anim.steps[1].objects[2].x += 2; sc.anim.steps[1].objects[2].y += 1;           // icon moves +2,+1 from step 1 to 2
  sc.anim.steps[2].objects = sc.anim.steps[2].objects.filter(o => o.id !== 'i1');   // …and is gone in step 3
  MA.normalize(sc);
  const base = sc.anim.steps[1].objects[2], t0 = 1 + 4 + 1;                          // start of move 2->3
  const o = byId(MA.objectsAt(sc, t0 + 2), 'i1')[0];
  assert.ok(o.x > base.x && o.y > base.y, 'continues east / north while fading');
  assert.ok(o._a < 1);
  const o2 = byId(MA.objectsAt(sc, t0 + 3), 'i1')[0]; assert.ok(o2.x > o.x, 'keeps moving');
});

test('text, icon and kind changes cross-fade while position glides', () => {
  const sc = scene(); MA.enable(sc); MA.setStep(sc, 0, { hold: 1 }); MA.addStep(sc, 0, { simplify: false, hold: 1, dur: 2, ease: 'linear' });
  const s2 = sc.anim.steps[1]; s2.objects[1].text = 'WARM FRONT'; s2.objects[1].x += 2; s2.objects[2].icon = 'sun'; s2.objects[0].kind = 'warm'; s2.objects[1].size = 100; s2.objects[1].color = '#ff0000';
  const mid = MA.objectsAt(sc, 2), ts = byId(mid, 't1'), is = byId(mid, 'i1'), fs = byId(mid, 'f1');
  assert.equal(ts.length, 2); assert.equal(is.length, 2); assert.equal(fs.length, 2);
  assert.deepEqual(ts.map(o => o.text).sort(), ['COLD FRONT', 'WARM FRONT']);
  ts.forEach(o => { assert.ok(Math.abs(o.x - (-73 + 1)) < 1e-9, 'both looks share the gliding position'); assert.equal(o.size, 80); });
  assert.ok(Math.abs(ts[0]._a + ts[1]._a - 1) < 1e-9, 'opacities add up to 1');
  assert.ok(/^rgb\(/.test(ts[0].color), 'colour blended');
  assert.deepEqual(fs.map(o => o.kind).sort(), ['cold', 'warm']);
  const early = MA.objectsAt(sc, 1.05), late = MA.objectsAt(sc, 2.95);
  assert.ok(byId(early, 't1').every(o => o.text === 'COLD FRONT' || o._a < 0.05)); assert.ok(byId(late, 't1').every(o => o.text === 'WARM FRONT' || o._a < 0.05));
});

test('angles take the short way round (wind barb direction)', () => {
  const sc = scene(); sc.objects = [{ id: 'b', type: 'barb', geo: true, x: 0, y: 0, dir: 350, kt: 10, size: 90 }]; MA.enable(sc); MA.setStep(sc, 0, { hold: 1 }); MA.addStep(sc, 0, { hold: 1, dur: 2, ease: 'linear' });
  sc.anim.steps[1].objects[0].dir = 10; const d = byId(MA.objectsAt(sc, 2), 'b')[0].dir; assert.ok(Math.abs(((d % 360) + 360) % 360) < 1e-9 || Math.abs(d - 360) < 1e-9, d);
});

test('a hidden object counts as absent; changing type cross-fades the whole object', () => {
  const sc = scene(); MA.enable(sc); MA.setStep(sc, 0, { hold: 1 }); MA.addStep(sc, 0, { simplify: false, hold: 1, dur: 2, ease: 'linear' });
  sc.anim.steps[1].objects[3].hidden = true; MA.normalize(sc);
  const h = byId(MA.objectsAt(sc, 2), 'h1')[0]; assert.ok(h._a < 1);
  assert.ok(byId(MA.objectsAt(sc, 3.5), 'h1').every(o => o.hidden), 'during the hold it is only present as hidden (the renderer skips hidden objects)');
  sc.anim.steps[1].objects[2] = Object.assign({}, text('i1', -71, 42, 'ICON→TEXT')); const m = byId(MA.objectsAt(sc, 2), 'i1'); assert.equal(m.length, 2);
});

test('interpolation is deterministic: any order of evaluation gives identical results', () => {
  const sc = scene(); MA.enable(sc); MA.addStep(sc, 0, { simplify: false }); sc.anim.steps[1].objects[0].pts = NY.slice(0, 3).map(p => [p[0] + 1, p[1]]);
  const ts = [0, 1.3, 2.9, 3.5, 4.4, 6, 7.7, 1.3, 0]; const first = ts.map(t => JSON.stringify(MA.objectsAt(sc, t)));
  const second = ts.slice().reverse().map(t => JSON.stringify(MA.objectsAt(sc, t))).reverse(); assert.deepEqual(first, second);
  assert.equal(first[1], first[7]);
});

test('geographic consistency: stored coordinates are blended, so any zoom / pan / camera shows the same place', () => {
  const sc = scene(); MA.enable(sc); MA.setStep(sc, 0, { hold: 1 }); MA.addStep(sc, 0, { simplify: false, hold: 1, dur: 2, ease: 'linear' });
  sc.anim.steps[1].objects[2].x = -69; sc.anim.steps[1].objects[2].y = 44;                // icon -71,42 -> -69,44
  const g = t => byId(MA.objectsAt(sc, t), 'i1')[0];
  assert.deepEqual([g(2).x, g(2).y], [-70, 43], 'mid-move = geographic midpoint, independent of any camera');
  // simulate two different cameras (web-mercator-ish projections at different zoom/centre): the midpoint's pixel is the midpoint of the end pixels for a linear projection
  const proj = (z, cx, cy) => (p => [(p[0] - cx) * 100 * z + 960, (cy - p[1]) * 100 * z + 540]);
  [proj(1, -72, 43), proj(3.7, -70.5, 42.2), proj(0.4, -80, 35)].forEach(P => {
    const a = P([g(1.001).x, g(1.001).y]), b = P([-69, 44]), m = P([g(2).x, g(2).y]), s = P([-71, 42]);
    assert.ok(Math.abs(m[0] - (s[0] + b[0]) / 2) < 1e-6 && Math.abs(m[1] - (s[1] + b[1]) / 2) < 1e-6);
    assert.ok(Math.hypot(a[0] - s[0], a[1] - s[1]) < 1 + 0.01 * 100 * 3.7 * 2);
  });
});

test('normalize repairs a hand-edited or damaged animation block', () => {
  const sc = scene(); sc.anim = { v: 9, speed: 99, steps: [{ hold: -4 }, { id: 'a', hold: 'x', dur: 0, ease: 'zzz' }, { id: 'a', name: 7, dur: 3 }] };
  MA.normalize(sc); const st = sc.anim.steps;
  assert.equal(sc.anim.v, 1); assert.equal(sc.anim.speed, 4); assert.equal(st[0].hold, 0); assert.equal(st[0].objects, undefined);
  assert.ok(Array.isArray(st[1].objects) && st[1].dur >= 0.2 && st[1].ease === 'inout'); assert.equal(new Set(st.map(s => s.id)).size, 3);
  assert.equal(typeof st[2].name, 'string');
  const bad = scene(); bad.anim = { steps: [] }; MA.normalize(bad); assert.equal(bad.anim, undefined);
  assert.equal(MA.objectsAt({ objects: [], anim: { steps: [{ hold: 1 }] }, duration: 1 }, 99).length, 0);
});

test('normalize is idempotent (stable serialization for unchanged-document detection)', () => {
  const sc = scene(); MA.enable(sc); MA.addStep(sc, 0); MA.addStep(sc, 1); const a = JSON.stringify(sc); MA.normalize(sc); MA.normalize(sc); assert.equal(JSON.stringify(sc), a);
  const back = JSON.parse(a); MA.normalize(back); assert.equal(JSON.stringify(back), a, 'a saved + reloaded scene serializes identically');
});

test('allObjects covers every step; sizeBytes grows with steps and stays compact', () => {
  const sc = scene(); MA.enable(sc); MA.addStep(sc, 0); MA.addStep(sc, 1); assert.equal(MA.allObjects(sc).length, 12);
  const s1 = MA.sizeBytes(sc); assert.ok(s1 > 500 && s1 < 4000, 'three steps of four objects are about ' + s1 + ' bytes');
  assert.equal(MA.sizeBytes(scene()), 0);
});

test('many objects: interpolation stays fast', () => {
  const sc = scene(); sc.objects = []; for (let i = 0; i < 12; i++) sc.objects.push(front('f' + i, clone(NY).map(p => [p[0] + i, p[1]]))); for (let i = 0; i < 40; i++) sc.objects.push(icon('i' + i, -70 + i * 0.1, 40, 'rain')); for (let i = 0; i < 20; i++) sc.objects.push(text('t' + i, -70, 40 + i * 0.1, 'T' + i));
  MA.enable(sc); MA.addStep(sc, 0, { simplify: false }); sc.anim.steps[1].objects.forEach(o => { if (o.pts) o.pts = o.pts.slice(0, 4); else o.x += 1; });
  const t0 = process.hrtime.bigint(); for (let k = 0; k < 300; k++) MA.objectsAt(sc, 3 + (k % 30) * 0.1); const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 300;
  assert.ok(ms < 4, 'avg ' + ms.toFixed(2) + ' ms per frame for 72 objects');
});
