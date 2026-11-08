'use strict';
/* v0.11.5: attachments - an icon / text / H-L rides on a front and follows it as it grows, shrinks, bends, or glides between animation steps.
   Pure data - run: node --test tests/map_attach.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const MA = require('../studio/mapanim.js');
const clone = v => JSON.parse(JSON.stringify(v));
const front = (id, pts) => ({ id, type: 'front', geo: true, kind: 'cold', size: 28, pts });
const icon = (id, x, y) => ({ id, type: 'icon', geo: true, x, y, icon: 'rain', size: 100 });
const A = [[-75, 41], [-74, 41.6], [-73, 42.1], [-72.2, 42.5], [-71.5, 42.7]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mid = pts => { const f = MA.attachFrame({ type: 'front', pts }, 0.5); return [f.x, f.y]; };

test('attachFromPoint / syncAttach round trip: u, t, n put the child back exactly where it was', () => {
  const f = front('f', clone(A)), at = MA.attachFrame(f, 0.4), c = icon('c', at.x - at.ty * 0.2, at.y + at.tx * 0.2);   // 0.2 off the front, on the left
  c.attach = MA.makeAttach(f, c); assert.equal(c.attach.to, 'f'); assert.ok(Math.abs(c.attach.u - 0.4) < 0.02, 'u ~ 0.4: ' + c.attach.u); assert.ok(Math.abs(c.attach.n - 0.2) < 0.01);
  const x0 = c.x, y0 = c.y; c.x = 0; c.y = 0; MA.syncAttach([f, c]);   // no memo: derived from the parent
  assert.ok(Math.abs(c.x - x0) < 1e-4 && Math.abs(c.y - y0) < 1e-4);
});

test('moving the parent front moves the attached child by the same amount; a longer front keeps the child at the same fraction', () => {
  const f = front('f', clone(A)), c = icon('c', ...mid(f.pts)); c.attach = MA.makeAttach(f, c); const memo = new WeakMap(), objs = [f, c]; MA.syncAttach(objs, memo);
  const c0 = [c.x, c.y]; f.pts = f.pts.map(p => [p[0] + 1, p[1] - 0.5]); MA.syncAttach(objs, memo);
  assert.ok(dist([c.x, c.y], [c0[0] + 1, c0[1] - 0.5]) < 1e-6, 'translated with the front');
  f.pts = f.pts.concat([[-70.5, 42.6], [-69.5, 42.2]]);   // the front gets longer
  MA.syncAttach(objs, memo); const on = MA.attachFrame(f, c.attach.u);
  assert.ok(dist([c.x, c.y], [on.x, on.y]) < 1e-6, 'still on the front, at the same fraction along it'); assert.ok(Math.abs(c.attach.u - 0.5) < 0.03);
});

test('a child the user moves stays where it was put and learns its new place; the next parent move carries that new offset', () => {
  const f = front('f', clone(A)), c = icon('c', ...mid(f.pts)); c.attach = MA.makeAttach(f, c); const memo = new WeakMap(), objs = [f, c]; MA.syncAttach(objs, memo);
  c.x += 0.3; c.y += 0.4; const moved = [c.x, c.y]; MA.syncAttach(objs, memo);
  assert.ok(dist([c.x, c.y], moved) < 1e-9, 'not pulled back'); assert.ok(Math.abs(c.attach.n) > 0.15, 'offset learned (distance from the front)');
  f.pts = f.pts.map(p => [p[0] + 2, p[1]]); MA.syncAttach(objs, memo);
  assert.ok(dist([c.x, c.y], [moved[0] + 2, moved[1]]) < 0.02, 'follows with the new offset');
});

test('attaching to a point-like parent keeps a rigid offset; broken, self and circular links are dropped; unattached scenes are untouched', () => {
  const p = icon('p', -73, 42), c = icon('c', -72, 42.5); c.attach = MA.makeAttach(p, c); const memo = new WeakMap(); MA.syncAttach([p, c], memo);
  p.x += 1; p.y += 1; MA.syncAttach([p, c], memo); assert.ok(dist([c.x, c.y], [-71, 43.5]) < 1e-9);
  const lone = icon('l', 0, 0); lone.attach = { to: 'gone', u: 0, t: 0, n: 0 }; MA.syncAttach([lone], memo); assert.equal(lone.attach, undefined);
  const s = icon('s', 0, 0); s.attach = { to: 's', u: 0, t: 0, n: 0 }; MA.syncAttach([s]); assert.equal(s.attach, undefined);
  const a = icon('a', 0, 0), b = icon('b', 1, 1); a.attach = { to: 'b', u: 0, t: 0, n: 0 }; b.attach = { to: 'a', u: 0, t: 0, n: 0 }; MA.syncAttach([a, b]); assert.ok(!(a.attach && b.attach), 'a cycle is broken');
  const plain = [front('f', clone(A)), icon('i', 1, 2)], json = JSON.stringify(plain); assert.equal(MA.syncAttach(plain, new WeakMap()), 0); assert.equal(JSON.stringify(plain), json);
});

test('between two steps the attached child glides WITH the reshaped front (stays on the curve all the way)', () => {
  const sc = { id: 's', name: 'm', duration: 6, bg: { type: 'mapbox' }, objects: [front('f', clone(A))] };
  const c1 = icon('c', ...mid(sc.objects[0].pts)); c1.attach = MA.makeAttach(sc.objects[0], c1); sc.objects.push(c1);
  MA.enable(sc); MA.addStep(sc, 0); const st2 = MA.stepObjects(sc, 1), f2 = st2.find(o => o.id === 'f'), c2 = st2.find(o => o.id === 'c');
  f2.pts = [[-75, 41], [-73.8, 42.4], [-72, 43.4], [-69.5, 43.9], [-67.5, 43.4], [-66, 42]];   // longer, bent the other way
  MA.syncAttach(st2, new WeakMap());
  assert.ok(Math.abs(c2.attach.u - 0.5) < 0.01);
  const tl = MA.timeline(sc), mv = tl.segs.find(s => s.kind === 'move');
  for (const k of [0.15, 0.3, 0.5, 0.7, 0.85]) {
    const t = mv.t0 + (mv.t1 - mv.t0) * k, objs = MA.objectsAt(sc, t), f = objs.find(o => o.id === 'f'), c = objs.find(o => o.id === 'c'), on = MA.attachFrame(f, 0.5);
    const len = (() => { let L = 0; for (let i = 1; i < f.pts.length; i++) L += dist(f.pts[i - 1], f.pts[i]); return L; })();
    assert.ok(dist([c.x, c.y], [on.x, on.y]) < 0.06 * len, 'child on the front at ' + k + ': ' + dist([c.x, c.y], [on.x, on.y]).toFixed(3) + ' vs len ' + len.toFixed(2));
  }
  const last = MA.objectsAt(sc, tl.total); assert.ok(dist([last.find(o => o.id === 'c').x, last.find(o => o.id === 'c').y], [c2.x, c2.y]) < 1e-9);
});

test('attach is carried (not blended) by the step interpolation and survives JSON round trips', () => {
  const sc = { id: 's', name: 'm', duration: 6, bg: { type: 'mapbox' }, objects: [front('f', clone(A)), Object.assign(icon('c', -73, 42), { attach: { to: 'f', u: 0.5, t: 0, n: 0 } })] };
  MA.enable(sc); MA.addStep(sc, 0); const tl = MA.timeline(sc), mv = tl.segs.find(s => s.kind === 'move'), o = MA.objectsAt(sc, (mv.t0 + mv.t1) / 2).find(q => q.id === 'c');
  assert.deepEqual(o.attach, { to: 'f', u: 0.5, t: 0, n: 0 }); assert.deepEqual(JSON.parse(JSON.stringify(sc)).anim.steps[1].objects.find(q => q.id === 'c').attach, { to: 'f', u: 0.5, t: 0, n: 0 });
});
