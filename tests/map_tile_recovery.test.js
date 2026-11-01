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
    'return {doSnap,cachedFrame,isAuthError,invalidateTileRetry,noteThrottle,throttled,scheduleRecovery,tileHealth,recoverTiles,recordMapError,onMapIdle,tileRetry,incompleteFrames,DIAG,state:()=>({snapshotBusy})};'
  ].join('\n');
  const canvasFactory = () => ({ width: 0, height: 0, getContext() { return { drawImage() {} }; } });
  const api = new Function('MB', 'D', 'document', 'W', 'H', 'norm', 'visualConfigReady', 'keyOf', 'cloneBg',
    'withTimeout', 'setup', 'settle', 'styleOf', 'projOf', 'Date', 'setTimeout', 'clearTimeout', 'g', 'VER', script)(
    MB, fm.map, { createElement: canvasFactory }, 1920, 1080, x => x, () => true, (bg, cam) => bg.name + '|' + cam.c[0], x => ({ ...x }),
    p => p, async () => {}, settle, () => 'broadcast', () => 'mercator', FakeDate, setT, clearT, { navigator: { userAgent: 'test' } }, 'v3.9.0');
  return { api, MB, timers, settleCalls, now: () => now, advance: ms => { now += ms; }, runTimers() { const t = timers.filter(x => !x.dead && !x.ran); t.forEach(x => { x.ran = true; x.fn(); }); return t.map(x => x.ms); } };
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
  assert.match(src, /tiles in view/);
  assert.match(src, /UNVERIFIED/);
  assert.match(src, /LIMITATION/);
  assert.match(src, /Rate limiting/);
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

/* =====================================================================
   Hardening (ChatGPT review of 74ee4f0): satellite-only completeness,
   busy/stale retries + HTTP 429 back-off, unavailable private interface.
   ===================================================================== */
// A style with several sources. spec: { id: { type, tiles: {key: state}, fail?: {key: n} } }
function multiMap(spec, extra = {}) {
  const caches = {}, map = {
    style: { _sourceCaches: caches }, transform: {},
    getCanvas() { return { width: 1920, height: 1080 }; },
    loaded() { return !Object.values(caches).some(c => Object.values(c._tiles).some(t => t.state === 'loading')); },
    isMoving() { return false; }, jumpTo() {}, triggerRepaint() { map.repaints = (map.repaints || 0) + 1; },
    on() {}, off() {}, ...extra
  };
  for (const [id, def] of Object.entries(spec)) {
    const keys = Object.keys(def.tiles), fail = Object.assign({}, def.fail);
    const c = caches[id] = {
      _tiles: Object.fromEntries(keys.map(k => [k, { state: def.tiles[k] }])),
      _source: { type: def.type }, removed: [], updates: 0,
      _removeTile(k) { c.removed.push(k); delete c._tiles[k]; },
      update() { c.updates++; for (const k of keys) { if (c._tiles[k]) continue; if ((fail[k] || 0) > 0) { fail[k]--; c._tiles[k] = { state: 'errored' }; } else c._tiles[k] = { state: 'loaded' }; } }
    };
  }
  return { map, caches };
}
const SAT = { type: 'raster', tiles: { s1: 'loaded', s2: 'loaded' } };

test('[1] a failed OPTIONAL source (terrain / vector) neither blocks the satellite snapshot nor is retried by it', async () => {
  const mm = multiMap({ 'mapbox://mapbox.satellite': SAT, composite: { type: 'vector', tiles: { v1: 'errored' } }, 'wd-terrain-dem': { type: 'raster-dem', tiles: { d1: 'errored' } } });
  const h = harness({ map: mm.map });
  const health = h.api.tileHealth(mm.map);
  assert.equal(health.complete, true, 'satellite is whole');
  assert.equal(health.errored, 0);
  assert.equal(health.optionalErrored, 2, 'but the other failures are still counted and reported');
  const cv = await h.api.doSnap(bg, cam, 'k');
  assert.ok(cv);
  assert.equal(h.settleCalls.length, 1, 'no extra settle rounds for optional failures');
  assert.equal(mm.caches.composite.removed.length + mm.caches['wd-terrain-dem'].removed.length, 0, 'optional tiles not hammered');
  assert.equal(h.api.incompleteFrames.has('k'), false, 'cached as complete');
  assert.equal(h.MB.cache.get('k'), cv);
});

test('[1] satellite failures still block, and recovery evicts the satellite tiles first and ONLY them by default', () => {
  const mm = multiMap({ 'mapbox://mapbox.satellite': { type: 'raster', tiles: { s1: 'errored', s2: 'loaded' } }, composite: { type: 'vector', tiles: { v1: 'errored' } } });
  const h = harness({ map: mm.map });
  assert.equal(h.api.tileHealth(mm.map).complete, false);
  assert.equal(h.api.recoverTiles(mm.map), 1);
  assert.deepEqual(mm.caches['mapbox://mapbox.satellite'].removed, ['s1']);
  assert.deepEqual(mm.caches.composite.removed, []);
  assert.equal(h.api.recoverTiles(mm.map, false, 'optional'), 1);
  assert.deepEqual(mm.caches.composite.removed, ['v1']);
});

test('[1] without a satellite base the vector base source is the critical one', () => {
  const mm = multiMap({ composite: { type: 'vector', tiles: { v1: 'errored', v2: 'loaded' } }, 'wd-terrain-dem': { type: 'raster-dem', tiles: { d1: 'errored' } } });
  const h = harness({ map: mm.map }), health = h.api.tileHealth(mm.map);
  assert.equal(health.complete, false);
  assert.equal(health.errored, 1);
  assert.equal(health.optionalErrored, 1);
  assert.equal(health.sources.composite.critical, true);
  assert.equal(health.sources['wd-terrain-dem'].critical, false);
});

test('[1] an optional-only failure gets ONE gentle retry, never the aggressive satellite schedule', () => {
  const mm = multiMap({ 'mapbox://mapbox.satellite': SAT, 'wd-terrain-dem': { type: 'raster-dem', tiles: { d1: 'errored' }, fail: { d1: 99 } } });
  const h = harness({ map: mm.map }), waits = [];
  for (let i = 0; i < 4; i++) { h.api.onMapIdle(); waits.push(...h.runTimers()); mm.caches['wd-terrain-dem']._tiles.d1 = { state: 'errored' }; }
  assert.deepEqual(waits, [4000]);
  assert.equal(mm.caches['wd-terrain-dem'].removed.length, 1);
});

test('[1] diagnostics keeps reporting every source, marking which ones count', () => {
  const mm = multiMap({ 'mapbox://mapbox.satellite': SAT, composite: { type: 'vector', tiles: { v1: 'errored' } } });
  const h = harness({ map: mm.map }), txt = h.MB.diagnostics();
  assert.match(txt, /mapbox:\/\/mapbox\.satellite \[satellite, counted\]/);
  assert.match(txt, /composite \[vector, informational\]: loaded 0, pending 0, failed 1/);
  assert.match(txt, /Other sources \(not blocking\): pending 0, failed 1/);
  assert.match(txt, /COMPLETE/);
});

test('[2] a retry that fires while the map is busy keeps its attempt and waits', () => {
  const fm = fakeMap({ keys: ['a', 'b'], initial: { b: 'errored' } });
  const h = harness(fm);
  h.api.onMapIdle();
  assert.equal(h.timers.length, 1);
  h.MB.interacting = true;                      // user starts dragging before the timer fires
  const first = h.runTimers();
  assert.deepEqual(first, [1500]);
  assert.equal(h.api.tileRetry.n, 0, 'attempt NOT consumed while busy');
  assert.equal(fm.cache.removed.length, 0, 'nothing requested while busy');
  assert.equal(h.timers.filter(t => !t.dead && !t.ran).length, 1, 'polls again');
  h.runTimers();                                // still busy
  assert.equal(h.api.tileRetry.n, 0);
  h.MB.interacting = false;
  h.runTimers();
  assert.equal(h.api.tileRetry.n, 1, 'consumed only when really sent');
  assert.deepEqual(fm.cache.removed, ['b']);
});

test('[2] a stale retry is dropped when the camera or style changes (epoch invalidation)', () => {
  const fm = fakeMap({ keys: ['a', 'b'], initial: { b: 'errored' }, failures: { b: 99 } });
  const h = harness(fm);
  h.api.onMapIdle();
  assert.equal(h.timers.length, 1);
  h.api.invalidateTileRetry();                  // movestart / style change / snapshot / interaction
  assert.equal(h.timers[0].dead, true, 'pending timer cancelled');
  h.runTimers();
  assert.equal(fm.cache.removed.length, 0);
  assert.equal(h.api.tileRetry.n, 0);
  // an already-running poll for the OLD view also does nothing
  h.api.onMapIdle(); const old = h.timers[h.timers.length - 1];
  h.api.tileRetry.epoch++;                      // view changed without clearing the handle
  old.fn();
  assert.equal(fm.cache.removed.length, 0);
});

test('[2] every camera/style/interaction entry point invalidates pending retries', () => {
  assert.match(source, /D\.on\('movestart', invalidateTileRetry\)/);
  assert.match(source, /if\(styleKey!==curStyleKey\|\|cfgKey!==curCfgKey\)invalidateTileRetry\(\);/);
  assert.match(source, /if\(key!==liveKey\)\{\s*invalidateTileRetry\(\);/);
  assert.match(source, /MB\.interacting=active;\s*invalidateTileRetry\(\);/);
  assert.match(source, /snapshotBusy=true;invalidateTileRetry\(\);/);
  assert.match(source, /MB\.reset = function[^\n]*invalidateTileRetry\(\)/);
});

test('[2] HTTP 429 opens a bounded, escalating cool-down; a burst of 429s counts once', () => {
  const h = harness(fakeMap({ keys: [] })), T = h.api.DIAG.throttle;
  for (let i = 0; i < 40; i++) h.api.recordMapError({ sourceId: 'mapbox-satellite', error: { status: 429, message: 'Too Many Requests' } });
  assert.equal(h.api.DIAG.throttleEvents, 1);
  assert.equal(T.level, 1);
  assert.equal(T.until - 1000000, 5000);
  assert.equal(h.api.throttled(), true);
  h.advance(5001); assert.equal(h.api.throttled(), false);
  for (const [level, dur] of [[2, 10000], [3, 20000], [4, 40000], [4, 40000]]) {
    h.api.recordMapError({ error: { status: 429, message: '' } });
    assert.equal(T.level, level);
    assert.equal(T.until - h.now(), dur);
    h.advance(dur + 1);
  }
  assert.equal(T.level, 4, 'capped');
  h.advance(70000); h.api.recordMapError({ error: { status: 500, message: 'Server Error' } });
  assert.equal(h.api.throttled(), false, 'a plain 500 does not open the 429 window');
});

test('[2] during the 429 cool-down NO tile request is sent: snapshot rounds, cache expiry and the watchdog all wait', async () => {
  const fm = fakeMap({ keys: ['a', 'b'], initial: { b: 'errored' }, failures: { b: 99 } });
  const h = harness(fm);
  h.api.recordMapError({ error: { status: 429, message: 'Too Many Requests' } });
  const cv = await h.api.doSnap(bg, cam, 'k');
  assert.ok(cv, 'best-effort picture still returned');
  assert.equal(fm.cache.removed.length, 0, 'snapshot did not evict/re-request while rate-limited');
  assert.equal(h.settleCalls.length, 1);
  assert.equal(h.api.incompleteFrames.get('k').tries, 1);
  h.advance(9000);                               // past the normal 8 s window but inside... 5 s cool-down has ended
  h.api.DIAG.throttle.until = h.api.DIAG.throttle.until + 20000;   // (a second 429 window is active)
  assert.equal(h.api.cachedFrame('k'), cv, 'incomplete frame not re-rendered during cool-down');
  h.advance(25000);
  assert.equal(h.api.cachedFrame('k'), null, 'after the cool-down it may be re-rendered');
  // watchdog: waits at least until the cool-down ends
  h.api.DIAG.throttle.until = 1000000 + 25000 + 9000 + 30000;
  h.api.onMapIdle();
  const t = h.timers[h.timers.length - 1];
  assert.ok(t.ms >= 29000, 'scheduled after the cool-down, got ' + t.ms);
  t.fn();                                        // fires early: still cooling down -> polls, does not request
  assert.equal(fm.cache.removed.length, 0);
});

test('[2] recovery is batched: at most 24 tiles per cycle, 8 while rate-limited (no request storm)', () => {
  const keys = Array.from({ length: 40 }, (_, i) => 't' + i), init = Object.fromEntries(keys.map(k => [k, 'errored']));
  const fm = fakeMap({ keys, initial: init }), h = harness(fm);
  assert.equal(h.api.recoverTiles(fm.map), 24);
  const fm2 = fakeMap({ keys, initial: init }), h2 = harness(fm2);
  h2.api.recordMapError({ error: { status: 429, message: '' } });
  assert.equal(h2.api.recoverTiles(fm2.map), 8);
});

test('[3] unavailable private source-cache interface is REPORTED, never presented as complete coverage', () => {
  const noInternals = { loaded: () => true, isStyleLoaded: () => true, style: {}, getCanvas() { return {}; }, triggerRepaint() {} };
  const h = harness({ map: noInternals });
  const health = h.api.tileHealth(noInternals);
  assert.equal(health.supported, false);
  assert.equal(health.verified, false);
  assert.equal(health.recoverable, false);
  assert.match(h.api.DIAG.limitation, /UNVERIFIED/);
  const txt = h.MB.diagnostics();
  assert.match(txt, /Tile coverage: UNVERIFIED/);
  assert.doesNotMatch(txt, /COMPLETE \(/);
  assert.equal(h.api.recoverTiles(noInternals), 0);
  h.api.onMapIdle();                                  // watchdog does nothing, no timers, no crash
  assert.equal(h.timers.length, 0);
});

test('[3] caches readable but not evictable: failures are detected AND the limitation is stated', () => {
  const mm = multiMap({ 'mapbox://mapbox.satellite': { type: 'raster', tiles: { s1: 'errored', s2: 'loaded' } } }, { isStyleLoaded: () => true });
  delete mm.caches['mapbox://mapbox.satellite']._removeTile;
  const h = harness({ map: mm.map }), health = h.api.tileHealth(mm.map);
  assert.equal(health.supported, true);
  assert.equal(health.recoverable, false);
  assert.equal(health.complete, false, 'the failed tile is still detected');
  assert.match(h.api.DIAG.limitation, /cannot be retried automatically/);
  assert.match(h.MB.diagnostics(), /LIMITATION: Mapbox internal tile-eviction interface not available/);
  assert.equal(h.api.recoverTiles(mm.map), 0);
});

test('[3] while the style is still loading, an empty cache is not reported as a limitation', () => {
  const loading = { loaded: () => false, isStyleLoaded: () => false, style: { _sourceCaches: {} }, getCanvas() { return {}; }, triggerRepaint() {} };
  const h = harness({ map: loading });
  h.api.tileHealth(loading);
  assert.equal(h.api.DIAG.limitation, '');
});

test('[3] Reload map tiles falls back to a full style reload when the private interface is unavailable', () => {
  assert.match(source, /if\(!n&&!tileHealth\(D\)\.recoverable\)\{[\s\S]*?curStyleKey=null;curCfgKey=null;DIAG\.fallbackReloads\+\+;n=1;/);
});
