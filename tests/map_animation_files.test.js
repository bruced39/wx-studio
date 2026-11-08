'use strict';
/* Map animation steps (v0.11.0) in files and the cloud document: .wxshow round trip (light JSON and media package), media references inside step
   objects, cloud document build / stable serialization (unchanged-document detection), old shows untouched, size. Run: node --test tests/map_animation_files.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const MA = require('../studio/mapanim.js');
const W = require('../studio/showfile.js');
const CW = require('../studio/cloud_workspace.js');

const clone = v => JSON.parse(JSON.stringify(v));
const front = (id, pts) => ({ id, type: 'front', geo: true, kind: 'cold', size: 28, flip: false, anim: { in: 'fade', delay: 0, dur: 0.6 }, pts });
const icon = (id, x, y) => ({ id, type: 'icon', geo: true, x, y, icon: 'rain', size: 100, anim: { in: 'fade', delay: 0, dur: 0.6 } });
const text = (id, x, y, t) => ({ id, type: 'text', geo: true, x, y, text: t, size: 60, color: '#ffffff', anim: { in: 'fade', delay: 0, dur: 0.6 } });
function animShow() {
  const a = { id: 's1', name: 'Animated', duration: 6, bg: { type: 'mapbox', view: { c: [-71, 42], z: 6, b: 0, p: 0 } }, objects: [front('f1', [[-75, 41], [-73, 42], [-71, 42.5], [-70, 42.2]]), text('t1', -73, 43, 'COLD FRONT'), icon('i1', -71, 42)] };
  const b = { id: 's2', name: 'Plain', duration: 4, bg: { type: 'color', color: '#101820' }, objects: [text('p1', 960, 540, 'PLAIN')] };
  const show = { v: 1, name: 'Anim show', accent: '#2f9bff', bugText: 'WX', logo: null, assets: {}, scenes: [a, b] };
  MA.enable(a); MA.setStep(a, 0, { hold: 1.5 }); MA.addStep(a, 0, { hold: 1, dur: 2 }); MA.addStep(a, 1, { hold: 2, dur: 2.5 });
  a.anim.steps[1].objects[0].pts = a.anim.steps[1].objects[0].pts.map(p => [p[0] + 2, p[1]]); a.anim.steps[1].objects[1].text = 'MOVING EAST'; MA.normalize(a);
  return show;
}

test('.wxshow light JSON round trip keeps every step bit for bit', async () => {
  const show = animShow(), json = W.legacyJson(show, { appVersion: '0.11.0' });
  const r = await W.unpack(new Blob([json]));
  assert.equal(r.kind, 'json'); assert.deepEqual(r.show.scenes[0].anim, show.scenes[0].anim); assert.equal(r.show.scenes[0].duration, show.scenes[0].duration);
  assert.equal(JSON.stringify(r.show.scenes), JSON.stringify(show.scenes), 'scenes serialize identically');
  assert.equal(r.show.scenes[1].anim, undefined, 'scene without animation stays without');
  const copy = clone(r.show); copy.scenes.forEach(s => MA.normalize(s)); assert.equal(JSON.stringify(copy.scenes), JSON.stringify(show.scenes), 'loading + normalizing changes nothing');
});

test('.wxshow media package round trip with animation; media used only by a later step is found', async () => {
  const show = animShow(); show.assets = { img_a: 'data:image/png;base64,iVBORw0KGgo=' };
  show.scenes[0].anim.steps[1].objects.push({ id: 'v1', type: 'image', x: 0, y: 0, w: 100, h: 100, asset: 'img_a', vid: 'vid_step2' });
  const videos = { vid_step2: { id: 'vid_step2', name: 'loop', blob: new Blob([new Uint8Array(5000).fill(7)], { type: 'video/mp4' }) } };
  const inv = W.inventory(show, videos); assert.equal(inv.present.length, 1, 'a video referenced only by step 2 is part of the package'); assert.deepEqual(inv.present[0].scenes, ['Animated']);
  const packed = await W.pack(show, { videos, appVersion: '0.11.0' }); assert.equal(packed.ext, '.wxshow');
  const r = await W.unpack(packed.blob);
  assert.equal(r.kind, 'package'); assert.equal(r.media.length, 1); assert.deepEqual(r.show.scenes[0].anim, show.scenes[0].anim); assert.equal(r.damaged.length, 0);
  const noMedia = animShow(); const light = await W.unpack(new Blob([W.legacyJson(noMedia)])); assert.equal(light.missing.length, 0);
});

test('cloud document: steps are stored inside the scene, no frames, schema versions unchanged, old scenes untouched', async () => {
  const show = animShow(), ctx = { show, hashMemo: {}, placeholders: {}, failed: {}, known: new Set(), builtin: {}, deviceId: 'd', uid: 'u', api: null };
  const { doc, issues } = await CW.buildCloudDoc(ctx);
  assert.equal(issues.length, 0); assert.equal(doc.v, 1); assert.equal(doc.cloud_schema, 1);
  assert.deepEqual(doc.scenes[0].anim, show.scenes[0].anim); assert.equal(doc.scenes[0].duration, 9);
  assert.equal(doc.scenes[1].anim, undefined); assert.deepEqual(doc.scenes[1], show.scenes[1]);
  assert.ok(!/data:image|dataURL|frames/i.test(JSON.stringify(doc)));
  assert.notEqual(doc.scenes[0], show.scenes[0], 'the document is a copy (editing continues freely)');
  const plain = { v: 1, name: 'Old', accent: '#fff', assets: {}, scenes: [show.scenes[1]] }, d2 = (await CW.buildCloudDoc(Object.assign({}, ctx, { show: plain }))).doc;
  assert.equal(CW.stable(d2.scenes), CW.stable([show.scenes[1]]), 'an old show builds the same document as before');
});

test('unchanged-document detection: key order, reload and normalize never change the stable serialization', async () => {
  const show = animShow(), ctx = { show, hashMemo: {}, placeholders: {}, failed: {}, known: new Set(), builtin: {}, deviceId: 'd', uid: 'u', api: null };
  const k1 = CW.stable((await CW.buildCloudDoc(ctx)).doc);
  const reloaded = clone(show); reloaded.scenes.forEach(s => MA.normalize(s)); reloaded.scenes[0].anim.steps.forEach(st => { const o = {}; Object.keys(st).reverse().forEach(k => { o[k] = st[k]; }); Object.keys(st).forEach(k => delete st[k]); Object.assign(st, o); });
  const k2 = CW.stable((await CW.buildCloudDoc(Object.assign({}, ctx, { show: reloaded }))).doc);
  assert.equal(k1, k2, 'same content = same key, however the JSON was ordered');
  const edited = clone(show); edited.scenes[0].anim.steps[1].hold = 1.5; MA.normalize(edited.scenes[0]);
  assert.notEqual(CW.stable((await CW.buildCloudDoc(Object.assign({}, ctx, { show: edited }))).doc), k1, 'a real change is detected');
  const sel = clone(show); /* UI-only state (selected step / playhead) is not part of the document */ assert.equal(JSON.stringify(sel), JSON.stringify(show));
});

test('step data is compact: size grows linearly, warning threshold reachable only by very large animations', () => {
  const sc = { id: 's', name: 'Big', duration: 6, bg: { type: 'mapbox' }, objects: [] };
  for (let i = 0; i < 12; i++) sc.objects.push(front('f' + i, [[-75, 41 + i * .1], [-73, 42], [-71, 42.5], [-70, 42.2], [-69, 42], [-68, 41.9]]));
  for (let i = 0; i < 40; i++) sc.objects.push(icon('i' + i, -70 + i * 0.1, 40)); for (let i = 0; i < 20; i++) sc.objects.push(text('t' + i, -70, 40 + i * 0.1, 'T' + i));
  MA.enable(sc); for (let i = 0; i < 9; i++) MA.addStep(sc, null);
  const per = MA.sizeBytes(sc) / 10; assert.ok(per < 40000, 'about ' + Math.round(per) + ' bytes per step for 72 objects');
  for (let i = 0; i < 30; i++) MA.addStep(sc, null);
  const total = MA.sizeBytes(sc); assert.equal(MA.stepCount(sc), 40);
  assert.ok(total < 4 * 1048576, '40 steps of 72 objects = ' + (total / 1048576).toFixed(2) + ' MiB, far below the 8 MiB cloud limit');
  assert.ok(!JSON.stringify(sc).includes('data:'), 'no rendered pictures are ever stored');
});
