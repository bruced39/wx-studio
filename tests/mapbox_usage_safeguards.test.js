/* WX Studio v0.10.3 – Mapbox usage safeguards. Run: node --test tests/mapbox_usage_safeguards.test.js
 * Covers: Mercator maths vs an independent matrix-style reference, the runtime self-test (accept / reject),
 * when the legacy helper map is still required, map-load accounting, no-op token/scale changes, pause. */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'studio', 'mapbox.js'), 'utf8');
function block(a, b) { const i = src.indexOf(a), j = src.indexOf(b, i + a.length); assert.ok(i >= 0 && j > i, 'source section exists: ' + a); return src.slice(i, j); }
const SAFE = block('  /* ---- Mapbox usage safeguards', '  MB.init = function');
const RESET = block('  MB.reset = function', '\n  function fog(bg)');

function store() { const m = new Map(); return { get: k => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); }, m }; }
function rig(opts = {}) {
  const local = store(), session = store();
  const g = Object.assign({ navigator: {}, location: { protocol: 'https:', origin: 'https://wx-studio.streamlit.app' }, document: { referrer: '' } }, opts.g || {});
  const ls = local;                       // the module's `ls` only needs get/set
  const doc = { createElement: () => ({ style: {}, remove() { this.removed = true; } }) };
  const MB = { status: 'ready', err: '', scale: 1.5, cache: new Map(), queue: null, interacting: false, onUpdate() { MB.updates = (MB.updates || 0) + 1; } };
  const counters = { constructed: 0, inv: 0 };
  // the module reads the browser's `sessionStorage` global (getItem/setItem); back it with the same get/set store the tests inspect
  const wrapped = { getItem: k => session.get(k), setItem: (k, v) => session.set(k, v) };
  const script = [
    "'use strict';",
    'let D=null,P=null,host=null,initP=null,curStyle=null,curStyleKey=null,curCfgKey=null,curProj="mercator",pProj=null,pKey=null,liveKey=null,renderGeneration=0,snapshotBusy=false,previewHold=null,previewRestorePending=false,previewRestoreKey=null,want=null;',
    'const incompleteFrames=new Map(),DIAG={throttle:{level:0,until:0}};function invalidateTileRetry(){counters.inv++;}',
    'MB.token=()=>String(g.WX_MAPBOX_TOKEN||ls.get("wx.mapbox.token")||"").trim();',
    // sessionStorage / localStorage-by-name are looked up as globals by the module: provide them as parameters.
    SAFE, RESET,
    'return {PT,USAGE,ensureProjector,projectorSelfTest,useMath,mProject,mUnproject,unconstrained,compareCam,bump,',
    ' state:o=>{if("D" in o)D=o.D;if("P" in o)P=o.P;if("host" in o)host=o.host;if("vw" in o){vw=o.vw;vh=o.vh;}if("usedToken" in o)usedToken=o.usedToken;if("initP" in o)initP=o.initP;if("curProj" in o)curProj=o.curProj;},',
    ' get:()=>({D,P,host,initP,usedToken,vw,vh,want,liveKey,renderGeneration})};'
  ].join('\n');
  const api = new Function('MB', 'ls', 'g', 'document', 'console', 'counters', 'sessionStorage', 'Date', script)(
    MB, ls, g, doc, { warn() {}, log() {} }, counters, wrapped, opts.Date || Date);
  return Object.assign(api, { MB, g, local, session, counters, doc });
}

/* ---- an independent, matrix-style stand-in for Mapbox's Transform.locationPoint (pitch 0) ---- */
function fakeTransform(W, H, c, z, bearing) {
  const world = 512 * 2 ** z, ang = -bearing * Math.PI / 180;
  const mx = lng => (180 + lng) / 360, my = lat => (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) / 360;
  return {
    locationPoint(ll) {
      const dx = (mx(ll.lng) - mx(c[0])) * world, dy = (my(ll.lat) - my(c[1])) * world;
      const x = dx * Math.cos(ang) - dy * Math.sin(ang), y = dx * Math.sin(ang) + dy * Math.cos(ang);
      return { x: W / 2 + x, y: H / 2 + y };
    }
  };
}
function fakeDisplay(o = {}) {
  const W = 1280, H = 720, st = { c: o.c || [-71.5, 42.4], z: o.z == null ? 6 : o.z, b: o.b || 0, p: o.p || 0, moving: !!o.moving };
  const skew = o.skew || 0;          // a deliberately wrong "Mapbox" for the negative test
  const D = {
    getPitch: () => st.p, isMoving: () => st.moving, getCenter: () => ({ lng: st.c[0], lat: st.c[1] }), getZoom: () => st.z, getBearing: () => st.b,
    project: a => { const q = fakeTransform(W, H, st.c, st.z, st.b).locationPoint({ lng: a[0], lat: a[1] }); return { x: q.x + skew, y: q.y }; },
    transform: o.noClone ? {} : { clone() { const t = { zoom: 0, pitch: 0, bearing: 0, center: null, locationPoint(ll) { return fakeTransform(W, H, [t.center.lng, t.center.lat], t.zoom, t.bearing).locationPoint(ll); } }; return t; } }
  };
  return { D, st, W, H };
}
const LL = function (lng, lat) { this.lng = lng; this.lat = lat; };

test('Mercator maths matches the matrix-style reference for random cameras, bearings and points', () => {
  const r = rig(); r.state({ vw: 1280, vh: 720 });
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let worst = 0, n = 0;
  for (let i = 0; i < 400; i++) {
    const cam = { c: [-170 + rnd() * 340, -60 + rnd() * 120], z: 2.5 + rnd() * 12, b: -179 + rnd() * 358, p: 0 };
    if (!r.unconstrained(cam.c[1], cam.z)) continue;
    const T = fakeTransform(1280, 720, cam.c, cam.z, cam.b);
    for (let j = 0; j < 5; j++) {
      const px = [rnd() * 1280, rnd() * 720], ll = r.mUnproject(cam, px[0], px[1]);
      const real = T.locationPoint({ lng: ll[0], lat: ll[1] }), back = r.mProject(cam, ll[0], ll[1]);
      worst = Math.max(worst, Math.hypot(real.x - px[0], real.y - px[1]), Math.hypot(back[0] - px[0], back[1] - px[1])); n++;
    }
  }
  assert.ok(n > 500, 'enough samples ' + n);
  assert.ok(worst < 1e-5, 'max error ' + worst + ' px');
});

test('basic geometry: centre -> viewport centre, 1 degree of longitude, bearing 90 puts east at the top', () => {
  const r = rig(); r.state({ vw: 1280, vh: 720 });
  const cam = { c: [-71.5, 42.4], z: 6, b: 0, p: 0 };
  const c = r.mProject(cam, -71.5, 42.4); assert.ok(Math.abs(c[0] - 640) < 1e-9 && Math.abs(c[1] - 360) < 1e-9);
  const e = r.mProject(cam, -70.5, 42.4); assert.ok(Math.abs(e[0] - 640 - 512 * 64 / 360) < 1e-9 && Math.abs(e[1] - 360) < 1e-9);
  const n = r.mProject(cam, -71.5, 43.4); assert.ok(n[1] < 360, 'north is up');
  const rot = r.mProject({ ...cam, b: 90 }, -70.5, 42.4); assert.ok(Math.abs(rot[0] - 640) < 1e-6 && rot[1] < 360, 'east is up at bearing 90');
});

test('constrained cameras (world smaller than the view, poles in view) never use the maths', () => {
  const r = rig(); r.state({ vw: 1280, vh: 720 });
  assert.equal(r.unconstrained(0, 0), false, 'z=0: Mapbox would change zoom and centre');
  assert.equal(r.unconstrained(0, 0.3), false);
  assert.equal(r.unconstrained(85, 3), false, 'pole inside the view: centre would be shifted');
  assert.equal(r.unconstrained(42, 6), true);
});

test('self-test accepts a matching Mapbox, verifies rotation on a private transform copy, and enables the maths', () => {
  const r = rig(); global.__LL = LL; r.g.mapboxgl = { LngLat: LL };
  const d = fakeDisplay(); r.state({ D: d.D, vw: 1280, vh: 720, curProj: 'mercator' });
  r.projectorSelfTest();
  assert.equal(r.PT.state, 'ok'); assert.ok(r.PT.maxErr < 1e-6); assert.equal(r.PT.rot, true, 'rotation verified');
  const k = c => ({ c, z: 6, b: 0, p: 0 });
  assert.equal(r.useMath(k([-71.5, 42.4]), 'mercator'), true);
  assert.equal(r.useMath({ ...k([-71.5, 42.4]), b: 33 }, 'mercator'), true, 'rotated flat camera');
  assert.equal(r.useMath({ ...k([-71.5, 42.4]), p: 20 }, 'mercator'), false, 'pitched camera needs Mapbox');
  assert.equal(r.useMath(k([-71.5, 42.4]), 'globe'), false, 'globe needs Mapbox');
  assert.equal(r.useMath(k([-71.5, 85]), 'mercator'), false, 'near the pole needs Mapbox');
  assert.equal(r.useMath(k([200, 42]), 'mercator'), false, 'unwrapped longitude needs Mapbox');
});

test('without a transform copy only unrotated cameras use the maths (rotation stays unverified)', () => {
  const r = rig(); r.g.mapboxgl = { LngLat: LL };
  const d = fakeDisplay({ noClone: true }); r.state({ D: d.D, vw: 1280, vh: 720, curProj: 'mercator' });
  r.projectorSelfTest();
  assert.equal(r.PT.state, 'ok'); assert.equal(r.PT.rot, false);
  assert.equal(r.useMath({ c: [-71.5, 42.4], z: 6, b: 0, p: 0 }, 'mercator'), true);
  assert.equal(r.useMath({ c: [-71.5, 42.4], z: 6, b: 25, p: 0 }, 'mercator'), false);
});

test('self-test REJECTS a Mapbox that disagrees (even by 1 pixel): the helper map is used instead', () => {
  const r = rig(); r.g.mapboxgl = { LngLat: LL };
  const d = fakeDisplay({ skew: 1 }); r.state({ D: d.D, vw: 1280, vh: 720, curProj: 'mercator' });
  r.projectorSelfTest();
  assert.equal(r.PT.state, 'failed'); assert.match(r.PT.reason, /differs from Mapbox/);
  assert.equal(r.useMath({ c: [-71.5, 42.4], z: 6, b: 0, p: 0 }, 'mercator'), false);
});

test('self-test waits (does not guess) while the display map is moving, pitched, a globe, or constrained', () => {
  for (const o of [{ moving: true }, { p: 30 }, { z: 0.2 }, { c: [-71, 85], z: 3 }]) {
    const r = rig(); r.g.mapboxgl = { LngLat: LL }; r.state({ D: fakeDisplay(o).D, vw: 1280, vh: 720, curProj: 'mercator' });
    r.projectorSelfTest(); assert.equal(r.PT.state, 'untested', JSON.stringify(o));
    assert.equal(r.useMath({ c: [-71.5, 42.4], z: 6, b: 0, p: 0 }, 'mercator'), false, 'unverified -> helper map');
  }
  const r = rig(); r.state({ D: fakeDisplay().D, vw: 1280, vh: 720, curProj: 'globe' }); r.projectorSelfTest(); assert.equal(r.PT.state, 'untested');
});

test('forcing the native helper (wx.mapbox.projector=native) disables the maths', () => {
  const r = rig(); r.PT.mode = 'native'; r.g.mapboxgl = { LngLat: LL };
  r.state({ D: fakeDisplay().D, vw: 1280, vh: 720, curProj: 'mercator' }); r.projectorSelfTest();
  assert.equal(r.useMath({ c: [-71.5, 42.4], z: 6, b: 0, p: 0 }, 'mercator'), false);
});

test('the helper map is created lazily, counted once, never while paused, and a failed creation is not retried', () => {
  let made = 0, fail = false;
  const r = rig(); r.state({ vw: 1280, vh: 720, D: fakeDisplay().D, host: { appendChild() {} } });
  r.g.mapboxgl = { Map: function (o) { made++; if (fail) throw new Error('no GL'); this.o = o; this.remove = () => {}; } };
  r.MB.paused = true; assert.equal(r.ensureProjector(), null); assert.equal(made, 0, 'paused: no map is started');
  r.MB.paused = false; const p1 = r.ensureProjector(); assert.ok(p1); assert.equal(made, 1);
  assert.equal(r.ensureProjector(), p1); assert.equal(made, 1, 'reused');
  assert.equal(r.USAGE.page.projector, 1);
  const r2 = rig(); r2.state({ vw: 1280, vh: 720, D: fakeDisplay().D, host: { appendChild() {} } });
  fail = true; r2.g.mapboxgl = r.g.mapboxgl; made = 0;
  assert.equal(r2.ensureProjector(), null); assert.equal(r2.ensureProjector(), null); assert.equal(made, 1, 'a failed creation is not retried every frame');
  assert.equal(r2.USAGE.page.projector, 0, 'a map that failed to start is not counted');
});

test('usage accounting: page / tab-session / calendar-month counters, labelled as local estimates', () => {
  const r = rig();
  r.bump('display'); r.bump('projector');
  let u = r.MB.usage();
  assert.equal(u.estimate, true); assert.match(u.label, /not an official Mapbox billing figure/i);
  assert.equal(u.page.maps, 2); assert.equal(u.session.maps, 2); assert.equal(u.month.maps, 2); assert.deepEqual(u.warnings, []);
  r.bump('display'); r.bump('display'); u = r.MB.usage();
  assert.equal(u.page.maps, 4); assert.equal(u.warnings.length, 1); assert.match(u.warnings[0], /4 Mapbox maps/);
  assert.ok(r.session.get('wx.mapbox.usage.session'), 'session counter kept in sessionStorage');
  assert.ok(r.local.get('wx.mapbox.usage.month'), 'month counter kept in localStorage');
});

test('usage accounting: a new page load adds to the tab-session count; month rolls over; thresholds warn', () => {
  const r = rig();
  r.session.set('wx.mapbox.usage.session', JSON.stringify({ since: 'x', display: 12, projector: 1, staticPreview: 0 }));
  assert.match(r.MB.usage().warnings.join(' '), /browser tab has started about 13/);
  r.local.set('wx.mapbox.usage.month', JSON.stringify({ ym: '1999-01', display: 99999, projector: 0, staticPreview: 0 }));
  const u = r.MB.usage(); assert.equal(u.month.maps, 0, 'old month ignored'); assert.equal(u.warnings.some(w => /this month/.test(w)), false);
  r.local.set('wx.mapbox.usage.month', JSON.stringify({ ym: new Date().toISOString().slice(0, 7), display: 5001, projector: 0, staticPreview: 0 }));
  assert.match(r.MB.usage().warnings.join(' '), /browser alone has started about 5001/);
});

test('storage failures never break the counters', () => {
  const r = rig(); r.local.set = () => { throw new Error('quota'); }; r.session.get = () => { throw new Error('denied'); };
  assert.doesNotThrow(() => { r.bump('display'); r.MB.usage(); });
});

test('setToken / setScale to the value already in use do NOT rebuild the maps; real changes do', () => {
  const r = rig(); const removed = []; const D = { remove() { removed.push('D'); } };
  r.g.WX_MAPBOX_TOKEN = ''; r.local.set('wx.mapbox.token', 'pk.AAAA1111BBBB2222');
  r.state({ D, host: { remove() {} }, usedToken: 'pk.AAAA1111BBBB2222', initP: Promise.resolve() });
  assert.equal(r.MB.setToken('pk.AAAA1111BBBB2222'), false); assert.deepEqual(removed, [], 'same token: nothing destroyed');
  assert.equal(r.MB.setScale(1.5), false); assert.deepEqual(removed, [], 'same scale: nothing destroyed');
  assert.equal(r.USAGE.page.noopSkips, 2);
  assert.equal(r.MB.setScale(2), true); assert.deepEqual(removed, ['D']); assert.equal(r.MB.scale, 2); assert.equal(r.USAGE.page.resets, 1);
  r.state({ D, host: { remove() {} }, usedToken: 'pk.AAAA1111BBBB2222', initP: Promise.resolve() }); removed.length = 0; r.MB.status = 'ready';
  assert.equal(r.MB.setToken('pk.CCCC3333DDDD4444'), true); assert.deepEqual(removed, ['D'], 'different token: rebuilt');
});

test('with a Streamlit-Secrets token, saving a browser token cannot change the effective token, so nothing is rebuilt', () => {
  const r = rig({ g: { WX_MAPBOX_TOKEN: 'pk.SECRET0000000000' } }); const removed = [];
  r.state({ D: { remove() { removed.push(1); } }, host: { remove() {} }, usedToken: 'pk.SECRET0000000000', initP: Promise.resolve() });
  assert.equal(r.MB.setToken('pk.OTHER11111111111'), false); assert.equal(removed.length, 0);
});

test('after a failed start the same token may be saved again to retry (deliberate reset)', () => {
  const r = rig(); let removed = 0; r.local.set('wx.mapbox.token', 'pk.AAAA1111BBBB2222');
  r.state({ D: { remove() { removed++; } }, host: { remove() {} }, usedToken: 'pk.AAAA1111BBBB2222', initP: Promise.resolve() }); r.MB.status = 'error';
  assert.equal(r.MB.setToken('pk.AAAA1111BBBB2222'), true); assert.equal(removed, 1);
});

test('pause: persists per tab, stops queued work, never creates a map, and is reversible', () => {
  const r = rig(); r.state({ vw: 1280, vh: 720 });
  assert.equal(r.MB.paused, false);
  assert.equal(r.MB.setPaused(true), true); assert.equal(r.session.get('wx.mapbox.paused'), '1'); assert.equal(r.counters.inv, 1, 'pending tile retries cancelled');
  assert.equal(r.get().want, null);
  assert.equal(r.MB.setPaused(true), true); assert.equal(r.counters.inv, 1, 'idempotent');
  assert.equal(r.MB.setPaused(false), false); assert.equal(r.session.get('wx.mapbox.paused'), '0');
});

test('token facts never expose the token; secret (sk.) tokens are labelled rejected; origin hint is offered', () => {
  const r = rig({ g: { WX_MAPBOX_TOKEN: 'pk.eyJ1IjoiYWJjIn0.SECRETPARTabcd' } });
  const t = r.MB.tokenInfo();
  assert.equal(t.kind, 'public'); assert.equal(t.masked, 'pk.…abcd'); assert.equal(t.source, 'Streamlit Secrets');
  assert.ok(!JSON.stringify(t).includes('SECRETPART'), 'full token never returned');
  assert.equal(t.allowedUrl, 'https://wx-studio.streamlit.app');
  const bad = rig({ g: { WX_MAPBOX_TOKEN: 'sk.eyJ1IjoiYWJjIn0.TOPSECRET' } }).MB.tokenInfo();
  assert.match(bad.kind, /REJECTED/); assert.equal(bad.masked, ''); assert.ok(!JSON.stringify(bad).includes('TOPSECRET'));
});

test('source guards: pause checks in snap/pump/init/tile retry, and no Map is created at startup for the projector', () => {
  assert.match(src, /if \(MB\.paused\) return Promise\.reject\(pausedError\(\)\);/, 'init refuses while paused');
  assert.match(src, /if\(MB\.paused\)return Promise\.reject\(pausedError\(\)\);/, 'snap refuses uncached frames while paused');
  assert.match(src, /const fire=\(\)=>\{\s*\n\s*if\(MB\.paused\)\{tileRetry\.timer=null;return;\}/, 'tile retries stop while paused');
  assert.match(src, /if \(PT\.mode === 'native'\) ensureProjector\(true\);/, 'eager helper only when the user forces it');
  const initBody = block('  MB.init = function () {', '  MB.reset = function');
  assert.equal((initBody.match(/new g\.mapboxgl\.Map\(/g) || []).length, 1, 'MB.init creates exactly one Map (the display map)');
  assert.equal((src.match(/new g\.mapboxgl\.Map\(/g) || []).length, 2, 'only ensureProjector creates the optional second Map');
});

test('a frame that fails because Mapbox was reset underneath it does not latch an error on the new map; a real failure still does', async () => {
  const snapSrc = block('  MB.snap = function(bg,cam){', '\n\n  /* Live editor preview');
  const run = async (resetDuring) => {
    const MB = { status: 'ready', err: '', cache: new Map(), queue: Promise.resolve() };
    const holder = { gen: 0 };
    const mk = new Function('MB', 'keyOf', 'cloneBg', 'doSnap', 'console', 'cachedFrame', 'holder', 'pausedError',
      'let renderGeneration=0;Object.defineProperty(holder,"gen",{get:()=>renderGeneration,set:v=>{renderGeneration=v}});' + snapSrc + ';return MB.snap;');
    const snap = mk(MB, () => 'k', x => x, async () => { if (resetDuring) holder.gen++; throw new TypeError("Cannot read properties of null (reading 'setStyle')"); }, { warn() {} }, () => null, holder, () => new Error('p'));
    await assert.rejects(snap({}, {}));
    return MB.status;
  };
  assert.equal(await run(true), 'ready', 'stale failure ignored');
  assert.equal(await run(false), 'error', 'genuine failure still latched');
});

/* ---- pause: camera-driven paths (v0.10.3 review fix) ---- */
function liveRig(paused) {
  const pre = "'use strict';let D,liveKey=null,snapshotBusy=false,previewHold=null,previewRestorePending=false,previewRestoreKey=null,jumps=0,repaints=0,invalidated=0;" +
    "const norm=c=>c,visualConfigReady=()=>true,styleOf=()=>'s',projOf=()=>'mercator',curStyleKey='stock|s',curProj='mercator';let curStyleKeyX;" +
    "function invalidateTileRetry(){invalidated++}function onEditorFrameRendered(){}";
  const code = block('  function stableEditorFrame(bg,cam){', '\n  MB.setInteractive');
  const fn = new Function('MB', pre + code + ";D={jumpTo(){jumps++},triggerRepaint(){repaints++},getCanvas(){return 'CANVAS'},on(){},off(){}};" +
    "return {stable:stableEditorFrame,live:liveCanvas,get:()=>({jumps,repaints,invalidated,liveKey}),set:o=>{if('liveKey' in o)liveKey=o.liveKey;if('hold' in o){previewHold=o.hold;previewRestorePending=o.pending;previewRestoreKey=o.rkey||null}}};");
  return fn({ paused: !!paused, status: 'ready', interacting: false });
}
const CAM = { c: [-71, 42], z: 7, b: 0, p: 0 }, KEY = '-71.000000|42.000000|7.0000|0.000|0.000';
test('paused: the live-preview canvas never calls jumpTo / triggerRepaint for a new camera', () => {
  const r = liveRig(true);
  assert.equal(r.live({}, CAM), null);
  assert.equal(r.stable({}, CAM), null);
  assert.deepEqual([r.get().jumps, r.get().repaints, r.get().invalidated], [0, 0, 0]);
});
test('paused: a canvas already at the requested camera may still be shown, still without any request', () => {
  const r = liveRig(true); r.set({ liveKey: KEY });
  assert.equal(r.live({}, CAM), 'CANVAS'); assert.equal(r.get().jumps, 0);
});
test('paused: the interrupted-snapshot restore jump is held back; after resume it happens once', () => {
  const MBo = { paused: true, status: 'ready', interacting: false };
  const r = liveRig(true); r.set({ hold: 'HELD', pending: true });
  assert.equal(r.stable({}, CAM), 'HELD'); assert.equal(r.get().jumps, 0, 'no restore jump while paused');
  const r2 = liveRig(false); r2.set({ hold: 'HELD', pending: true });
  assert.equal(r2.stable({}, CAM), 'HELD'); assert.equal(r2.get().jumps, 1, 'resumed: camera restored');
  assert.ok(MBo);
});
test('not paused: live preview still follows the camera (no regression)', () => {
  const r = liveRig(false);
  assert.equal(r.live({}, CAM), 'CANVAS'); assert.equal(r.get().jumps, 1);
  r.live({}, CAM); assert.equal(r.get().jumps, 1, 'same camera: no second jump');
});
test('source: every D-moving path checks the pause flag', () => {
  const snapBody = block('  async function doSnap(', '  MB.snap = function(');
  assert.ok((snapBody.match(/if\(MB\.paused\)throw pausedError\(\)/g) || []).length >= 4, 'doSnap checkpoints');
  assert.match(block('  function recoverTiles(m,force,scope){', '    let n=0'), /if\(MB\.paused\)return 0/);
  assert.match(block('  function onMapIdle(){', '    const h=tileHealth'), /MB\.paused/);
  assert.match(block('  MB.reloadTiles=function(){', '    const now'), /MB\.paused/);
  const st = block('  function settle(m,generation,wallMs){', '\n  }\n');
  assert.equal((st.match(/MB\.paused/g) || []).length, 3, 'settle stops on pause (wall timer, render, step)');
  assert.match(src, /webglcontextrestored[\s\S]{0,600}D && !MB\.paused/, 'context-restore recovery respects pause');
});
test('setPaused(true) bumps the render generation so an in-flight snapshot ends at its next checkpoint', () => {
  const r = rig(); r.state({});
  const gen0 = r.get().renderGeneration;
  r.MB.setPaused(true);
  assert.equal(r.get().renderGeneration, gen0 + 1);
  r.MB.setPaused(false); assert.equal(r.get().renderGeneration, gen0 + 1, 'resume changes nothing else');
});
