/* v0.10.1: WXData.exportReadiness(scene) and how the export preflight words weather-layer and platform-limit notes.
 * Rules from the ChatGPT review: "source connected" is not "frames ready"; unavailable and partially loaded are different;
 * loaded frames are never described as current; platform limits are advisory. */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..', 'studio');
function load() {
  const document = { readyState: 'loading', addEventListener() { }, createElement() { return { getContext() { return {}; } }; } };
  const ctx = { document, console, setTimeout, clearTimeout, requestAnimationFrame() { }, performance: { now: () => 0 } }; ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'dataloop.js'), 'utf8'), ctx); return ctx.WXData;
}
const X = require('../studio/export.js');
const scene = (on, source) => ({ dataLoop: on === null ? undefined : { on, source: source || 'demo', hours: 1 } });
const put = (D, sc, rt) => D.state.set(sc, Object.assign({ key: '', frames: [], loaded: 0, total: 0, failed: 0, status: 'idle', msg: '', gen: 0, promise: null }, rt));
const fr = (n, withImg) => Array.from({ length: n }, (_, i) => ({ t: i, img: withImg(i) ? {} : null }));

test('layer off or absent: not part of the export check', () => {
  const D = load();
  assert.equal(D.exportReadiness(scene(null)).state, 'off'); assert.equal(D.exportReadiness(scene(false)).enabled, false); assert.equal(D.exportReadiness({}).state, 'off');
});
test('connected source with no decoded frames is NOT ready', () => {
  const D = load(), sc = scene(true, 'nexrad');
  assert.equal(D.exportReadiness(sc).state, 'loading');                       // never loaded yet
  put(D, sc, { status: 'nosrc', msg: 'NEXRAD Radar is not connected yet' }); assert.equal(D.exportReadiness(sc).state, 'unavailable');
  put(D, sc, { status: 'empty', msg: 'No frames available' }); assert.equal(D.exportReadiness(sc).state, 'unavailable');
  put(D, sc, { status: 'error', msg: 'Frames could not be loaded' }); assert.equal(D.exportReadiness(sc).state, 'unavailable');
  put(D, sc, { status: 'loading', frames: fr(6, () => false), total: 6 }); assert.equal(D.exportReadiness(sc).state, 'loading');
});
test('partially loaded is different from unavailable and from ready', () => {
  const D = load(), sc = scene(true);
  put(D, sc, { status: 'ready', frames: fr(8, i => i < 5), total: 8, failed: 3, msg: '3 of 8 frames failed to load' });
  const r = D.exportReadiness(sc); assert.equal(r.state, 'partial'); assert.equal(r.usable, 5); assert.equal(r.total, 8); assert.equal(r.failed, 3);
  put(D, sc, { status: 'loading', frames: fr(8, i => i < 2), total: 8 }); assert.equal(D.exportReadiness(sc).state, 'partial');
});
test('fully decoded frames are ready, but never claimed to be current', () => {
  const D = load(), sc = scene(true); put(D, sc, { status: 'ready', frames: fr(12, () => true), total: 12 });
  const r = D.exportReadiness(sc); assert.equal(r.state, 'ready'); assert.equal(r.usable, 12); assert.equal(r.freshnessChecked, false);
});

const good = { webcodecs: true, h264: 'avc1.640028', mapboxScenes: [], mapboxToken: true, missing: [] };
const items = (weather, preset, secs) => X.preflightItems(Object.assign({}, good, { weather }), X.presetSettings(preset || 'x'), secs || 30);
test('preflight wording: ready layer is informational and says freshness is not checked', () => {
  const w = items([{ scene: 2, state: 'ready', usable: 12, total: 12 }]).find(i => /weather layer/.test(i.text));
  assert.equal(w.level, 'info'); assert.match(w.text, /12 frames loaded/); assert.match(w.text, /not checked for freshness/); assert.doesNotMatch(w.text, /live|current|fresh data|up to date/i);
});
test('preflight wording: partial and unavailable layers warn (and do not block)', () => {
  const p = items([{ scene: 1, state: 'partial', usable: 5, total: 8, msg: '3 of 8 frames failed to load' }]), u = items([{ scene: 3, state: 'unavailable', usable: 0, total: 0, msg: 'NEXRAD Radar is not connected yet' }]);
  assert.ok(X.canExport(p) && X.canExport(u));
  assert.match(p.find(i => /weather layer/.test(i.text)).text, /only 5 of 8 frames/); assert.equal(p.find(i => /weather layer/.test(i.text)).level, 'warn');
  assert.match(u.find(i => /weather layer/.test(i.text)).text, /no usable frames.*not connected.*without it/);
});
test('preflight wording: platform limits are presented as a published guide, not a guarantee', () => {
  const x = X.preflightItems(good, X.presetSettings('x'), 300).map(i => i.text).join('|'), ok = X.preflightItems(good, X.presetSettings('x'), 60).map(i => i.text).join('|');
  assert.match(x, /published limit is 2:20/); assert.match(x, /limits change/i); assert.match(ok, /a guide; limits can change/); assert.match(ok, /published guide 512 MB/);
  const fb = X.preflightItems(good, X.presetSettings('facebook'), 60).map(i => i.text).join('|'); assert.match(fb, /10 GB.*not confirmed/);
});
test('16 Mbps 1080p30 stays the X and Facebook default', () => {
  ['x', 'facebook'].forEach(id => { const s = X.presetSettings(id); assert.equal(s.bitrate, 16e6); assert.equal(s.width, 1920); assert.equal(s.height, 1080); assert.equal(s.fps, 30); });
});
