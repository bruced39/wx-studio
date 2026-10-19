'use strict';
const test = require('node:test'), assert = require('node:assert');
const X = require('../studio/export.js');
const M = require('./helpers/media.js');
const fs = require('fs');

test('X and Facebook presets are 1920x1080, 30 fps, H.264-friendly and within platform limits', () => {
  for (const id of ['x', 'facebook']) {
    const p = X.presetSettings(id); assert.strictEqual(p.width, 1920); assert.strictEqual(p.height, 1080); assert.strictEqual(p.fps, 30);
    assert.ok(p.bitrate >= 10e6 && p.bitrate <= 25e6, 'bitrate within X max 25 Mbps'); assert.ok(p.fps <= 40);
  }
  assert.strictEqual(X.presetSettings('x').maxSeconds, 140); assert.strictEqual(X.presetSettings('x').maxBytes, 512 * 1048576);
  assert.strictEqual(X.presetSettings('facebook').maxSeconds, null);
});

test('custom preset honours size and quality and is never length-limited', () => {
  const c = X.presetSettings('custom', { size: '1280x720', mbps: 6 }); assert.deepStrictEqual([c.width, c.height, c.bitrate, c.maxSeconds], [1280, 720, 6e6, null]);
  const d = X.presetSettings('custom'); assert.deepStrictEqual([d.width, d.height, d.bitrate], [1920, 1080, 10e6]);
  assert.strictEqual(X.presetSettings('nonsense').id, 'custom');
});

const good = { webcodecs: true, h264: 'avc1.640028', mapboxScenes: [], mapboxToken: true, missing: [] };
const lv = items => items.map(i => i.level);

test('preflight: healthy 45 s show on X is all green and exportable', () => {
  const items = X.preflightItems(good, X.presetSettings('x'), 45); assert.ok(X.canExport(items)); assert.ok(items.every(i => i.level === 'ok'), JSON.stringify(items));
});

test('preflight never blocks a long show: 5 minutes on X warns about length and size but can still export', () => {
  const items = X.preflightItems(good, X.presetSettings('x'), 300), t = items.map(i => i.text).join('|');
  assert.ok(X.canExport(items)); assert.strictEqual(items.filter(i => i.level === 'warn').length, 2); assert.match(t, /5:00/); assert.match(t, /2:20/); assert.match(t, /512 MB/);
});

test('preflight: Facebook has no length limit, 3 minute show is fine', () => {
  const items = X.preflightItems(good, X.presetSettings('facebook'), 180); assert.ok(X.canExport(items)); assert.ok(!lv(items).includes('warn'));
});

test('preflight blocks when the browser cannot encode H.264 or has no WebCodecs', () => {
  const a = X.preflightItems(Object.assign({}, good, { h264: null }), X.presetSettings('x'), 30), b = X.preflightItems(Object.assign({}, good, { webcodecs: false, h264: null }), X.presetSettings('x'), 30);
  assert.ok(!X.canExport(a)); assert.match(a[0].text, /H\.264/); assert.ok(!X.canExport(b)); assert.match(b[0].text, /Chrome or Edge/);
});

test('preflight: Mapbox scenes need a token (blocks) and otherwise get a keep-tab-visible note', () => {
  const miss = X.preflightItems(Object.assign({}, good, { mapboxScenes: [1, 3], mapboxToken: false }), X.presetSettings('x'), 30);
  assert.ok(!X.canExport(miss)); assert.match(miss.find(i => i.level === 'error').text, /Scenes 1, 3 use a Mapbox map but no Mapbox token/);
  const ok = X.preflightItems(Object.assign({}, good, { mapboxScenes: [2], mapboxToken: true }), X.presetSettings('x'), 30);
  assert.ok(X.canExport(ok)); assert.match(ok.find(i => i.level === 'info').text, /visible/);
});

test('preflight: missing video blocks, missing image only warns', () => {
  const v = X.preflightItems(Object.assign({}, good, { missing: [{ scene: 2, kind: 'video', name: 'loop' }] }), X.presetSettings('x'), 30);
  assert.ok(!X.canExport(v)); assert.match(v.find(i => i.level === 'error').text, /Scene 2: video or GIF “loop”/);
  const im = X.preflightItems(Object.assign({}, good, { missing: [{ scene: 1, kind: 'image', name: 'bg_x' }] }), X.presetSettings('x'), 30);
  assert.ok(X.canExport(im)); assert.ok(lv(im).includes('warn'));
});

test('size estimate and formatting', () => {
  assert.strictEqual(X.estimateBytes(60, 16e6), Math.round(60 * 16e6 / 8 * 1.02)); assert.ok(X.estimateBytes(60, 16e6, 192000) > X.estimateBytes(60, 16e6));
  assert.strictEqual(X.fmtDuration(140), '2:20'); assert.strictEqual(X.fmtDuration(45), '0:45'); assert.match(X.fmtBytes(120 * 1048576), /120 MB/);
});

/* ---- colour: our BT.709 limited-range RGBA->I420 must agree with ffmpeg's BT.709 conversion ---- */
const skip = M.haveFfmpeg() ? false : 'ffmpeg not installed';
function ffmpegYuv(rgba, w, h) {
  const inF = M.writeTmp('in.rgba', rgba), outF = M.tmp('out.yuv');
  const r = M.run('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', inF, '-vf', 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p', '-f', 'rawvideo', outF]);
  assert.strictEqual(r.status, 0, r.stderr); return fs.readFileSync(outF);
}
test('RGBA->I420 matches ffmpeg BT.709 limited-range on flat colours (exact within ±1)', { skip }, () => {
  const w = 16, h = 16, cols = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [16, 48, 80], [200, 120, 40], [128, 128, 128]];
  for (const c of cols) {
    const rgba = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) rgba.set([c[0], c[1], c[2], 255], i * 4);
    const mine = X.rgbaToI420(rgba, w, h, new Uint8Array(w * h * 3 / 2)), ref = ffmpegYuv(rgba, w, h); let max = 0; for (let i = 0; i < mine.length; i++) max = Math.max(max, Math.abs(mine[i] - ref[i]));
    assert.ok(max <= 1, `colour ${c} differs by ${max}`);
  }
});
test('RGBA->I420 gives legal ranges: black Y=16, white Y=235, neutral chroma 128', () => {
  const w = 4, h = 4, mk = c => { const a = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) a.set([c, c, c, 255], i * 4); return X.rgbaToI420(a, w, h, new Uint8Array(24)); };
  const k = mk(0), wt = mk(255); assert.strictEqual(k[0], 16); assert.strictEqual(wt[0], 235); assert.strictEqual(k[16], 128); assert.strictEqual(wt[20], 128);
});
test('RGBA->I420 on a smooth image stays within a few levels of ffmpeg (chroma subsampling differences only)', { skip }, () => {
  const w = 64, h = 36, rgba = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set([x * 4, y * 7, 255 - x * 3, 255], (y * w + x) * 4);
  const mine = X.rgbaToI420(rgba, w, h, new Uint8Array(w * h * 3 / 2)), ref = ffmpegYuv(rgba, w, h); let max = 0; for (let i = 0; i < mine.length; i++) max = Math.max(max, Math.abs(mine[i] - ref[i]));
  assert.ok(max <= 4, 'max diff ' + max);
});
