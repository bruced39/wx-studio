'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const W = require('../studio/showfile.js');

const bytes = (n, seed) => { const b = new Uint8Array(n); let x = seed || 1; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
const show = (extra) => Object.assign({
  name: 'Test show', accent: '#2f9bff', bugText: 'WX', logo: null,
  assets: { img_a: 'data:image/png;base64,iVBORw0KGgo=', bgdefault: 'data:image/jpeg;base64,/9j/' },
  scenes: [
    { id: 's1', name: 'Open', duration: 6, bg: { type: 'video', vid: 'vid_a1' }, objects: [] },
    { id: 's2', name: 'Radar loop', duration: 8, bg: { type: 'video', vid: 'vid_g1' }, objects: [] },
    { id: 's3', name: 'Outlook', duration: 5, bg: { type: 'color', color: '#101820' }, objects: [] }
  ]
}, extra || {});
const videos = () => ({
  vid_a1: { id: 'vid_a1', name: 'Harbor loop', blob: new Blob([bytes(300000, 7)], { type: 'video/mp4' }) },
  vid_g1: { id: 'vid_g1', name: 'Radar', gif: true, blob: new Blob([bytes(40000, 9)], { type: 'image/gif' }) }
});
const toFile = async (blob) => new Uint8Array(await blob.arrayBuffer());

test('crc32 matches the standard check value', () => {
  assert.equal(W.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('inventory separates present and missing media and lists the scenes using it', () => {
  const v = videos(); delete v.vid_g1;
  const inv = W.inventory(show(), v);
  assert.equal(inv.present.length, 1); assert.equal(inv.missing.length, 1);
  assert.equal(inv.missing[0].id, 'vid_g1'); assert.deepEqual(inv.missing[0].scenes, ['Radar loop']);
  assert.equal(inv.imageCount, 2);
});

test('package round trip keeps the show and every media byte', async () => {
  const v = videos(), r = await W.pack(show(), { videos: v, appVersion: '0.10.1' });
  assert.equal(r.ext, '.wxshow'); assert.equal(r.manifest.format, 'wx-studio-show'); assert.equal(r.manifest.formatVersion, W.FORMAT_VERSION);
  const out = await W.unpack(r.blob);
  assert.equal(out.kind, 'package'); assert.equal(out.damaged.length, 0); assert.equal(out.media.length, 2);
  assert.deepEqual(out.show.scenes.map(s => s.name), ['Open', 'Radar loop', 'Outlook']);
  assert.equal(out.show.format, undefined, 'format header is stripped before the show is used');
  const a = out.media.find(m => m.id === 'vid_a1'), g = out.media.find(m => m.id === 'vid_g1');
  assert.deepEqual(await toFile(a.blob), await toFile(v.vid_a1.blob)); assert.equal(a.kind, 'video');
  assert.deepEqual(await toFile(g.blob), await toFile(v.vid_g1.blob)); assert.equal(g.kind, 'gif');
  assert.equal(out.show.assets.img_a, 'data:image/png;base64,iVBORw0KGgo=');
});

test('missing media is recorded in the package, not silently dropped', async () => {
  const v = videos(); delete v.vid_g1;
  const r = await W.pack(show(), { videos: v });
  assert.equal(r.manifest.missing.length, 1); assert.equal(r.manifest.missing[0].name, 'vid_g1');
  const out = await W.unpack(r.blob);
  assert.equal(out.missing.length, 1); assert.equal(out.media.length, 1);
});

test('the package is a valid ZIP for ordinary tools (python zipfile, unzip -t)', async () => {
  const r = await W.pack(show(), { videos: videos() }), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxsf-')), f = path.join(dir, 'a.wxshow');
  fs.writeFileSync(f, await toFile(r.blob));
  const py = spawnSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(",".join(sorted(z.namelist())))', f], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr); assert.match(py.stdout, /manifest\.json,media\/vid_a1\.mp4,media\/vid_g1\.gif,show\.json/);
  const un = spawnSync('unzip', ['-tq', f], { encoding: 'utf8' });
  if (!un.error) assert.equal(un.status, 0, un.stdout + un.stderr);
});

test('a flipped byte in a video is caught and only that video is skipped', async () => {
  const r = await W.pack(show(), { videos: videos() }), buf = await toFile(r.blob);
  const needle = new TextEncoder().encode('media/vid_a1.mp4'); let at = -1;
  for (let i = 0; i < buf.length - needle.length; i++) { let ok = true; for (let k = 0; k < needle.length; k++) if (buf[i + k] !== needle[k]) { ok = false; break; } if (ok) { at = i; break; } }
  assert.ok(at > 0); buf[at + needle.length + 5000] ^= 0xFF;
  const out = await W.unpack(new Blob([buf]));
  assert.equal(out.damaged.length, 1); assert.equal(out.damaged[0].id, 'vid_a1'); assert.match(out.damaged[0].why, /checksum/);
  assert.equal(out.media.length, 1); assert.equal(out.media[0].id, 'vid_g1');
});

test('a truncated download gives a clear message instead of a crash', async () => {
  const r = await W.pack(show(), { videos: videos() }), buf = await toFile(r.blob);
  await assert.rejects(() => W.unpack(new Blob([buf.slice(0, buf.length - 200)])), /damaged or incomplete|not finish/i);
});

test('legacy .wxshow.json files open unchanged, with and without the new header', async () => {
  const old = JSON.stringify(show());
  let out = await W.unpack(new Blob([old]));
  assert.equal(out.kind, 'json'); assert.equal(out.formatVersion, 1); assert.equal(out.show.scenes.length, 3);
  assert.deepEqual(out.missing.map(m => m.id).sort(), ['vid_a1', 'vid_g1']);
  out = await W.unpack(new Blob([W.legacyJson(show(), { appVersion: '0.10.1' })]));
  assert.equal(out.formatVersion, W.FORMAT_VERSION); assert.equal(out.show.format, undefined); assert.equal(out.show.name, 'Test show');
});

test('a file from a newer format warns but still opens', async () => {
  const j = JSON.stringify(Object.assign({ format: 'wx-studio-show', formatVersion: 99 }, show()));
  const out = await W.unpack(new Blob([j])); assert.equal(out.warnings.length, 1); assert.match(out.warnings[0], /newer/);
});

test('non-show files are refused with plain messages', async () => {
  await assert.rejects(() => W.unpack(new Blob(['hello'])), /not a WX Studio show/);
  await assert.rejects(() => W.unpack(new Blob([JSON.stringify({ scenes: [] })])), /not a WX Studio show/);
  const z = await W.writeZip([{ name: 'readme.txt', data: 'x' }]);
  await assert.rejects(() => W.unpack(z), /not a WX Studio show/);
});

test('deflate-compressed ZIPs made by other tools can be read', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxsf-')), f = path.join(dir, 'd.zip'), payload = 'hello '.repeat(5000);
  const py = spawnSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED);z.writestr("a.txt",sys.argv[2]);z.close()', f, payload], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const z = await W.readZip(new Blob([fs.readFileSync(f)]));
  assert.equal(await z.text('a.txt'), payload); assert.equal(await z.verify('a.txt'), true);
});

test('unicode names and empty files survive', async () => {
  const z = await W.readZip(await W.writeZip([{ name: 'média/été.txt', data: 'ok' }, { name: 'empty.bin', data: new Uint8Array(0) }]));
  assert.equal(await z.text('média/été.txt'), 'ok'); assert.equal((await z.blob('empty.bin')).size, 0); assert.equal(await z.verify('empty.bin'), true);
});

test('a 60 MB video packs and reads back without being copied into one buffer first', async () => {
  const big = new Blob(Array.from({ length: 60 }, (_, i) => bytes(1 << 20, i + 1)), { type: 'video/mp4' });
  const r = await W.pack(show(), { videos: { vid_a1: { name: 'big', blob: big }, vid_g1: videos().vid_g1 } });
  assert.ok(r.blob.size > 60 * 1048576);
  const out = await W.unpack(r.blob); assert.equal(out.damaged.length, 0);
  assert.equal(out.media.find(m => m.id === 'vid_a1').size, 60 * 1048576);
});
