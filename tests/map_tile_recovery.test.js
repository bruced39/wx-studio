'use strict';
/* Satellite "rectangular holes" regression. Run: node --test tests/map_tile_recovery.test.js
   Mapbox GL reports map.loaded() === true even when tiles FAILED to download
   and never retries them. These tests drive the real helper/snapshot source
   from studio/mapbox.js against a fake Mapbox source cache. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../studio/mapbox.js'), 'utf8');

function slice(from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, 'source section exists: ' + from);
  return source.slice(a, b);
}

// Fake Mapbox source cache: tiles with a state, _removeTile + update() that
// "re-request" a removed tile. failures[key] > 0 means that tile fails again.
function fakeMap(opts = {}) {
  const tiles = {};
  const failures = opts.failures || {};
  let seq = 0;
  const cache = {
    _tiles: tiles,
    removed: [], updates: 0,
    _removeTile(k) { cache.removed.push(k); delete tiles[k]; },
    update() {
      cache.updates++;
      for (const k of opts.keys || []) {
        if (tiles[k]) continue;
        if (failures[k] > 0) { failures[k]--; tiles[k] = { state: 'errored' }; }
        else tiles[k] = { state: 'loaded' };
      }
    }
  };
  for (const k of opts.keys || []) tiles[k] = { state: (opts.initial && opts.initial[k]) || 'loaded' };
  const listeners = new Map();
  const canvas = { width: 1920, height: 1080, tag: 0 };
  const map = {
    style: { _sourceCaches: { 'mapbox-satellite': cache } },
    transform: {},
    getCanvas() { return canvas; },
    // Real Mapbox: loaded() treats errored tiles as loaded.
    loaded() { return !Object.values(tiles).some(t => t.state === 'loading'); },
    isMoving() { return false; },
    jumpTo() {},
    triggerRepaint() { map.repaints = (map.repaints || 0) + 1; },
    on(ev, fn) { listeners.set(ev, fn); },
    off(ev, fn) { if (listeners.get(ev) === fn) listeners.delete(ev); }
  };
  return { map, cache, tiles, failures, seq: () => ++seq };
}

function harness(fm, settleImpl) {
  let now = 1000000;
  const RealDate = Date;
  function FakeDate() { return new RealDate(now); }
  FakeDate.now = () => now;
  const timers = [];
  const setT = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const clearT = id => { if (timers[id - 1]) timers[id - 1].dead = true; };
  const MB = { status: 'ready', interacting: false, cache: new Map(), last: null, init: async () => {}, hasToken: () => true, onUpdate: () => {}, scale: 1.5 };
  const settleCalls = [];
  const settle = async (m, gen, wall) => { settleCalls.push(wall || 14000); return settleImpl ? settleImpl() : true; };
  const script = [
    'let liveKey=null,renderGeneration=0,want=null,busy=false;',
    slice('  /* ---- tile completeness', '  MB.setInteractive = function'),
    slice('  async function doSnap(', '  MB.snap = function('),
    'return {doSnap,cachedFrame,isAuthError,tileHealth,recoverTiles,recordMapError,onMapIdle,tileRetry,incompleteFrames,DIAG,state:()=>({snapshotBusy})};'
  ].join('\n');
  const canvasFactory = () => ({ width: 0, height: 0, getContext() { return { drawImage() {} }; } });
  const api = new Function('MB', 'D', 'document', 'W', 'H', 'norm', 'visualConfigReady', 'keyOf', 'cloneBg',
    'withTimeout', 'setup', 'settle', 'styleOf', 'projOf', 'Date', 'setTimeout', 'clearTimeout', 'g', 'VER', script)(
    MB, fm.map, { createElement: canvasFactory }, 1920, 1080, x => x, () => true, (bg, cam) => bg.name + '|' + cam.c[0], x => ({ ...x }),
    p => p, async () => {}, settle, () => 'broadcast', () => 'mercator', FakeDate, setT, clearT, { navigator: { userAgent: 'test' } }, 'v3.9.0');
  return { api, MB, timers, settleCalls, advance: ms => { now += ms; }, runTimers() { const t = timers.filter(x => !x.dead && !x.ran); t.forEach(x => { x.ran = true; x.fn(); }); return t.map(x => x.ms); } };
}

const bg = { name: 'sat' }, cam = { c: [-73.5, 42], z: 5.36, b: 0, p: 0 };

test('tileHealth counts FAILED tiles even though map.loaded() is true', () => {
  const fm = fakeMap({ keys: ['a', 'b', 'c'], initial: { b: 'errored' } });
  const h = harness(fm);
  assert.equal(fm.map.loaded(), true, 'Mapbox itself says loaded');
  const health = h.api.tileHealth(fm.map);
  assert.equal(health.errored, 1);
  assert.equal(health.ready, 2);
  assert.equal(health.complete, false);
  assert.deepEqual(Object.keys(health.sources), ['mapbox-satellite']);
});

test('tileHealth is complete when every tile is loaded; works for maps without internals', () => {
  const fm = fakeMap({ keys: ['a', 'b'] });
  const h = harness(fm);
  assert.equal(h.api.tileHealth(fm.map).complete, true);
  const bare = { loaded: () => true };
  assert.equal(h.api.tileHealth(bare).complete, true);
  assert.equal(h.api.tileHealth(null).complete, true);
});

test('recoverTiles evicts only failed tiles and asks the cache to request them again', () => {
  const fm = fakeMap({ keys: ['a', 'b', 'c'], initial: { b: 'errored' } });
  const h = harness(fm);
  assert.equal(h.api.recoverTiles(fm.map), 1);
  assert.deepEqual(fm.cache.removed, ['b']);
  assert.equal(fm.cache.updates, 1);
  assert.equal(fm.tiles.b.state, 'loaded');
  assert.equal(h.api.tileHealth(fm.map).complete, true);
  assert.ok(fm.map.repaints >= 1);
  assert.equal(h.api.DIAG.recoveries, 1);
});

test('recoverTiles(force) refetches every tile', () => {
  const fm = fakeMap({ keys: ['a', 'b'] });
  const h = harness(fm);
  assert.equal(h.api.recoverTiles(fm.map, true), 2);
  assert.deepEqual(fm.cache.removed.sort(), ['a', 'b']);
});

test('a snapshot with failed tiles is retried and then cached as complete', async () => {
  const fm = fakeMap({ keys: ['a', 'b', 'c'], initial: { b: 'errored' } });
  const h = harness(fm);
  const cv = await h.api.doSnap(bg, cam, 'sat|-73.5');
  assert.ok(cv);
  assert.equal(h.api.tileHealth(fm.map).complete, true);
  assert.equal(h.MB.cache.get('sat|-73.5'), cv, 'complete frame cached');
  assert.equal(h.api.incompleteFrames.has('sat|-73.5'), false);
  assert.equal(h.settleCalls.length, 2, 'settled again after recovery');
  assert.equal(h.settleCalls[1], 6000);
});

test('permanently failing tiles: frame is returned but NOT trusted as final', async () => {
  const fm = fakeMap({ keys: ['a', 'b'], initial: { b: 'errored' }, failures: { b: 99 } });
  const h = harness(fm);
  const cv = await h.api.doSnap(bg, cam, 'k');
  assert.ok(cv, 'best-effort picture still returned');
  assert.equal(h.api.incompleteFrames.get('k').tries, 1);
  assert.equal(h.api.DIAG.incompleteSnaps, 1);
  // Within the retry window the picture is reused...
  assert.equal(h.api.cachedFrame('k'), cv);
  // ...after it, the cache entry is dropped so the next frame re-renders.
  h.advance(8001);
  assert.equal(h.api.cachedFrame('k'), null);
  assert.equal(h.MB.cache.has('k'), false);
});

test('retries are bounded: after 3 incomplete renders the best picture is kept', async () => {
  const fm = fakeMap({ keys: ['a', 'b'], initial: { b: 'errored' }, failures: { b: 999 } });
  const h = harness(fm);
  let cv;
  for (let i = 0; i < 3; i++) { cv = await h.api.doSnap(bg, cam, 'k'); h.advance(9000); }
  assert.equal(h.api.incompleteFrames.get('k').tries, 3);
  assert.equal(h.api.cachedFrame('k'), cv, 'no endless re-render loop');
});

test('a tile that recovers on the second attempt is accepted', async () => {
  const fm = fakeMap({ keys: ['a', 'b'], initial: { b: 'errored' }, failures: { b: 1 } });
  const h = harness(fm);
  await h.api.doSnap(bg, cam, 'k');
  assert.equal(h.api.incompleteFrames.has('k'), false);
  assert.equal(h.api.tileHealth(fm.map).complete, true);
});

test('superseded camera during recovery caches nothing', async () => {
  const fm = fakeMap({ keys: ['a', 'b'], initial: { b: 'errored' } });
  let n = 0;
  const h = harness(fm, () => (++n === 1));
  const cv = await h.api.doSnap(bg, cam, 'k');
  assert.equal(cv, null);
  assert.equal(h.MB.cache.has('k'), false);
});

test('idle watchdog retries failed tiles with exponential back-off, max 4 times', () => {
  const fm = fakeMap({ keys: ['a', 'b'], initial: { b: 'errored' }, failures: { b: 999 } });
  const h = harness(fm);
  const waits = [];
  for (let i = 0; i < 6; i++) {
    h.api.onMapIdle();
    const ran = h.runTimers();
    waits.push(...ran);
    // b fails again -> still errored
    fm.tiles.b = { state: 'errored' };
  }
  assert.deepEqual(waits, [1500, 3000, 6000, 12000]);
  assert.equal(fm.cache.removed.length, 4);
});

test('idle watchdog does nothing while the user is moving the camera or a snapshot runs', () => {
  const fm = fakeMap({ keys: ['a', 'b'], initial: { b: 'errored' } });
  const h = harness(fm);
  h.MB.interacting = true;
  h.api.onMapIdle();
  assert.equal(h.timers.length, 0);
});

test('when everything is healthy again, stale incomplete frames are dropped', () => {
  const fm = fakeMap({ keys: ['a'] });
  const h = harness(fm);
  h.MB.cache.set('old', {});
  h.api.incompleteFrames.set('old', { at: 1, tries: 1 });
  let updated = 0;
  h.MB.onUpdate = () => { updated++; };
  h.api.onMapIdle();
  assert.equal(h.MB.cache.has('old'), false);
  assert.equal(h.api.incompleteFrames.size, 0);
  assert.equal(updated, 1);
});

test('map errors are recorded without leaking the access token', () => {
  const fm = fakeMap({ keys: [] });
  const h = harness(fm);
  h.api.recordMapError({ sourceId: 'mapbox-satellite', error: { status: 429, message: 'Too Many Requests https://api.mapbox.com/x.webp?access_token=pk.SECRET123&a=1' } });
  const e = h.api.DIAG.tileErrors[0];
  assert.equal(e.status, 429);
  assert.equal(e.source, 'mapbox-satellite');
  assert.doesNotMatch(e.message, /SECRET123/);
  assert.equal(h.api.DIAG.tileErrorCount, 1);
});

test('diagnostics report is safe without a map and lists failed tiles with a map', () => {
  const src = source.slice(source.indexOf('  MB.diagnostics=function'), source.indexOf('  // The WebGL map used by the live editor'));
  assert.match(src, /Tiles in view/);
  assert.match(src, /WebGL context losses/);
  assert.match(src, /Mapbox GL JS/);
});

test('settle accepts an explicit wall-clock and keeps the 14 s default', () => {
  assert.match(source, /function settle\(m,generation,wallMs\)/);
  assert.match(source, /wallMs>0\?wallMs:14000/);
});

test('wiring: errors, idle watchdog and WebGL context events are registered on the display map', () => {
  assert.match(source, /D\.on\('idle', onMapIdle\)/);
  assert.match(source, /recordMapError\(e\)/);
  assert.match(source, /webglcontextlost/);
  assert.match(source, /webglcontextrestored/);
  assert.match(source, /MB\.reloadTiles=function/);
});

test('only real authorisation failures latch the map into the error state', () => {
  const h = harness(fakeMap({ keys: [] })), A = h.api.isAuthError;
  const url = ' https://api.mapbox.com/v4/mapbox.satellite/5/9/11@2x.webp?access_token=pk.abc';
  assert.equal(A({ error: { status: 401, message: 'Unauthorized' } }), true);
  assert.equal(A({ error: { status: 403, message: 'Forbidden' } }), true);
  assert.equal(A({ error: { message: 'Unauthorized: invalid access token' } }), true);
  // Transient tile failures must NOT be mistaken for a rejected token, even
  // though every request URL contains "access_token=".
  assert.equal(A({ error: { status: 429, message: 'Too Many Requests' + url } }), false);
  assert.equal(A({ error: { status: 500, message: 'Server Error' + url } }), false);
  assert.equal(A({ error: { message: 'Failed to fetch' + url } }), false);
  assert.equal(A({ error: { message: 'NetworkError when attempting to fetch resource.' + url } }), false);
  assert.equal(A({}), false);
  assert.equal(A(null), false);
});
