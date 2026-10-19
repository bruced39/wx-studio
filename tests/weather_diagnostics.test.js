// Regression tests for the Data Source Status logic in studio/weather_workspace.js (pure functions: no browser, no DOM, no network).
// The four states the task calls out: DISCONNECTED, WAITING, CONNECTED, STALE — plus LIVE (verified), UNAVAILABLE and the rules that
// keep "LIVE" honest. The rendered panel is exercised in a real browser by tests/browser/weather_diagnostics_browser_check.py.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
const sandbox = {}; sandbox.globalThis = sandbox; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../studio/weather_workspace.js'), 'utf8'), sandbox);
const U = sandbox.WXWeatherWorkspace.util, plain = x => JSON.parse(JSON.stringify(x));
const NOW = Date.UTC(2026, 9, 18, 15, 0, 0), MIN = 60000, PID = 'goes-east-conus-C02';
const LOCAL = 'http://127.0.0.1:8080', P_OK = { configured: true, local: true, reach: 'ok', error: '', healthStatus: 'ready' };
const meta = (ageMin, count) => ({ latest: NOW - ageMin * MIN, earliest: NOW - (ageMin + 40) * MIN, count: count == null ? 6 : count });
const S = o => U.sourceState(Object.assign({ proc: P_OK, windowMin: U.freshWindowMin(PID), now: NOW }, o));

/* ---------- processor-level states ---------- */
test('DISCONNECTED: no processor address → Not connected, nothing is live, every source says so', () => {
  const pm = U.processorState({ endpoint: '' }); assert.equal(pm.state, 'notconfigured'); assert.equal(pm.pill, 'notconnected'); assert.equal(pm.title, 'Not connected'); assert.equal(pm.mode, 'none');
  assert.match(pm.detail, /Demo patterns work/);
  const st = S({ proc: U.procInput(pm, null), meta: meta(1), verify: { ok: true, t: NOW - MIN } });   // even stale leftovers can never make it live
  assert.equal(st.state, 'notconnected'); assert.equal(st.verified, false);
});
test('WAITING: local processor not answering → Waiting for local processor (not an error, not connected)', () => {
  const pm = U.processorState({ endpoint: LOCAL, health: { ok: false, error: 'no response' }, catalog: { ok: false, error: 'no response' } });
  assert.equal(pm.state, 'waiting-local'); assert.equal(pm.pill, 'waiting'); assert.equal(pm.mode, 'local'); assert.match(pm.detail, /start the processor/i);
  const st = S({ proc: U.procInput(pm, null) }); assert.equal(st.state, 'waiting'); assert.equal(st.label, 'Waiting for local processor');
});
test('WAITING: processor up but no fresh NOAA frames yet (empty catalog) → Waiting for NOAA frames', () => {
  const pm = U.processorState({ endpoint: LOCAL, health: { ok: true, status: 'waiting-for-real-noaa-frames', freshProducts: 0 }, catalog: { ok: true, products: [] } });
  assert.equal(pm.state, 'waiting'); assert.equal(pm.title, 'Waiting for NOAA frames');
  const st = S({ proc: U.procInput(pm, { ok: true, status: 'waiting-for-real-noaa-frames' }) }); assert.equal(st.state, 'waiting'); assert.equal(st.label, 'Waiting for NOAA frames'); assert.match(st.why, /first downloads can take several minutes/);
});
test('UNAVAILABLE: a hosted (non-local) processor that cannot be reached is Unavailable, not Waiting', () => {
  const pm = U.processorState({ endpoint: 'https://noaa.example.org', health: { ok: false, error: 'HTTP 502' }, catalog: { ok: false, error: 'HTTP 502' } });
  assert.equal(pm.state, 'unavailable'); assert.equal(pm.pill, 'unavailable'); assert.equal(pm.mode, 'hosted'); assert.match(pm.detail, /HTTP 502/);
  assert.equal(S({ proc: U.procInput(pm, null) }).state, 'unavailable');
});
test('UNAVAILABLE: processor answers but the catalog is garbage → Unavailable with the reason', () => {
  const pm = U.processorState({ endpoint: LOCAL, health: { ok: true, status: 'ready' }, catalog: { ok: false, error: 'unexpected /catalog format' } });
  assert.equal(pm.state, 'unavailable'); assert.match(pm.detail, /unexpected \/catalog format/);
});
test('CONNECTED: processor lists products → Connected with a count (and says LIVE is a separate, later check)', () => {
  const pm = U.processorState({ endpoint: LOCAL, health: { ok: true, status: 'ready', freshProducts: 3 }, catalog: { ok: true, products: [{}, {}, {}] } });
  assert.equal(pm.state, 'online'); assert.equal(pm.pill, 'connected'); assert.equal(pm.short, '3 products listed'); assert.match(pm.detail, /LIVE only after/);
  assert.equal(U.processorState({ endpoint: LOCAL, health: { ok: true }, catalog: { ok: true, products: [{}] } }).short, '1 product listed');
});
test('checking: before any answer the status is "Checking…", never connected', () => {
  const pm = U.processorState({ endpoint: LOCAL, bridgeStatus: 'checking' }); assert.equal(pm.state, 'checking'); assert.equal(pm.pill, 'waiting');
  assert.equal(S({ proc: U.procInput(pm, null) }).state, 'waiting');
});
test('processor state falls back to the bridge status when diagnostics have not run', () => {
  assert.equal(U.processorState({ endpoint: LOCAL, bridgeStatus: 'available' }).state, 'online');
  assert.equal(U.processorState({ endpoint: LOCAL, bridgeStatus: 'unavailable', bridgeError: 'timeout' }).state, 'waiting-local');
});

/* ---------- per-source states ---------- */
test('CONNECTED vs LIVE: a fresh listing alone is "Connected · not verified"; only a decoded frame earns LIVE', () => {
  const listed = S({ meta: meta(3) }); assert.equal(listed.state, 'connected'); assert.equal(listed.verified, false); assert.match(listed.why, /Verify frame/);
  const live = S({ meta: meta(3), verify: { ok: true, t: NOW - 3 * MIN } }); assert.equal(live.state, 'live'); assert.equal(live.verified, true); assert.equal(live.label, 'LIVE · verified');
});
test('LIVE can also come from the active weather loop having decoded frames', () => {
  assert.equal(S({ meta: meta(4), loop: { n: 8, newest: NOW - 4 * MIN, status: 'ready' } }).state, 'live');
  assert.equal(S({ meta: meta(4), loop: { n: 0, newest: null, status: 'loading' } }).state, 'connected');           // downloading: not live yet
  assert.equal(S({ meta: meta(4), loop: { n: 0, newest: null, status: 'empty' } }).state, 'connected');             // nothing decoded → not live
});
test('STALE: listed observation older than the fresh window → Stale (never Connected/LIVE)', () => {
  const st = S({ meta: meta(45) }); assert.equal(st.state, 'stale'); assert.equal(st.verified, false); assert.match(st.why, /45 min old/);
  assert.equal(S({ meta: meta(45), verify: { ok: true, t: NOW - 45 * MIN } }).state, 'stale');                         // a verified-but-old frame is Stale too
});
test('STALE: a frame that was verified earlier ages into Stale as time passes', () => {
  const v = { ok: true, t: NOW - 5 * MIN };
  assert.equal(S({ meta: meta(5), verify: v, now: NOW }).state, 'live');
  assert.equal(S({ meta: meta(5), verify: v, now: NOW + 40 * MIN }).state, 'stale');
});
test('STALE: a product that dropped out of the catalog after being listed is Stale, not Waiting', () => {
  assert.equal(S({ meta: null, dropped: true }).state, 'stale');
});
test('older verified frame but a newer one is listed → Connected (not LIVE) until the new one is checked', () => {
  const st = S({ meta: meta(2), verify: { ok: true, t: NOW - 40 * MIN } }); assert.equal(st.state, 'connected'); assert.match(st.why, /newer observation/);
});
test('freshness windows are per product family and mesoscale is the strictest', () => {
  assert.equal(U.freshWindowMin('mrms-reflectivity'), 15); assert.equal(U.freshWindowMin('nexrad-reflectivity-KBOX'), 20);
  assert.equal(U.freshWindowMin('goes-east-conus-C13'), 20); assert.equal(U.freshWindowMin('goes-west-full-C02'), 30); assert.equal(U.freshWindowMin('goes-east-meso1-C02'), 10);
  assert.ok(U.freshWindowMin('goes-east-meso2-C13') <= U.freshWindowMin('goes-east-conus-C13'));
  const m = 'goes-east-meso1-C02', w = U.freshWindowMin(m);
  assert.equal(U.sourceState({ proc: P_OK, meta: meta(12), windowMin: w, now: NOW }).state, 'stale'); assert.equal(U.sourceState({ proc: P_OK, meta: meta(12), windowMin: U.freshWindowMin(PID), now: NOW }).state, 'connected');
});
test('UNAVAILABLE: a failed frame check or loop error is surfaced with its message', () => {
  const a = S({ meta: meta(2), verify: { ok: false, error: 'frame: HTTP 404' } }); assert.equal(a.state, 'unavailable'); assert.match(a.why, /HTTP 404/);
  const b = S({ meta: meta(2), loop: { n: 0, status: 'error', error: 'Frames could not be loaded: image failed' } }); assert.equal(b.state, 'unavailable'); assert.match(b.why, /could not be loaded/);
});
test('a failed check never shows LIVE even when the listing is fresh', () => {
  for (const st of ['connected', 'live']) assert.notEqual(S({ meta: meta(1), verify: { ok: false, error: 'x' } }).state, st);
});
test('nothing is LIVE without verified/decoded evidence — exhaustive over the evidence combinations', () => {
  const metas = [null, meta(1), meta(90)], verifies = [null, { ok: false, error: 'e' }], loops = [null, { n: 0, status: 'loading' }, { n: 0, status: 'empty' }, { n: 0, status: 'error', error: 'e' }], procs = [P_OK, { configured: false }, { configured: true, local: true, reach: 'fail' }, { configured: true, reach: 'unknown' }];
  for (const m of metas) for (const v of verifies) for (const l of loops) for (const p of procs) assert.notEqual(S({ meta: m, verify: v, loop: l, proc: p }).state, 'live', JSON.stringify([m, v, l, p]));
});

/* ---------- product parsing / what is (not) invented ---------- */
test('parseProduct names real processor ids and never invents others', () => {
  assert.deepEqual(plain(U.parseProduct('goes-east-conus-C02')).family, 'satellite'); assert.match(U.parseProduct('goes-east-conus-C02').label, /GOES-19 East · CONUS · Visible 0.5 km/); assert.match(U.parseProduct('goes-west-full-C13').label, /GOES-18 West · Full Disk · Clean IR 2 km/);
  assert.equal(U.parseProduct('mrms-reflectivity').kind, 'mrms'); assert.equal(U.parseProduct('nexrad-velocity-KBOX').site, 'KBOX'); assert.match(U.parseProduct('nexrad-reflectivity-KOKX').label, /KOKX · base reflectivity · Level II/);
  assert.equal(U.parseProduct('something-else').family, 'other'); assert.equal(U.parseProduct('goes-east-conus-C99').family, 'other');
  for (const id of ['rtma-temperature', 'rtma-2m-temperature', 'hrrr-refc', 'gfs-t2m', 'nam-x', 'model-x', 'forecast-x']) assert.equal(U.parseProduct(id).family, 'other', id + ' is not an established product id and must not be recognised');
  assert.equal(U.SAT_PRODUCTS.length, 16); assert.ok(U.SAT_PRODUCTS.every(p => U.parseProduct(p).family === 'satellite'));
});
test('loopProduct maps the weather-loop source onto a processor product', () => {
  assert.equal(U.loopProduct({ source: 'goes-west-meso1-C13' }, []), 'goes-west-meso1-C13'); assert.equal(U.loopProduct({ source: 'mrms' }, []), 'mrms-reflectivity');
  assert.equal(U.loopProduct({ source: 'nexrad', site: 'KOKX' }, []), 'nexrad-reflectivity-KOKX'); assert.equal(U.loopProduct({ source: 'nexrad' }, []), 'nexrad-reflectivity-KBOX');
  assert.equal(U.loopProduct({ source: 'goes' }, ['goes-west-conus-C13', 'goes-east-conus-C02']), 'goes-east-conus-C02'); assert.equal(U.loopProduct({ source: 'goes' }, ['goes-west-conus-C13']), 'goes-west-conus-C13');
  assert.equal(U.loopProduct({ source: 'demo' }, []), null); assert.equal(U.loopProduct(null, []), null);
});

/* ---------- reading the processor's replies ---------- */
test('parseCatalog keeps only well-formed products and reports unusable replies', () => {
  const ok = U.parseCatalog({ schema: 'wxstudio.frames.v1', products: [{ product: PID, earliestObservationUtc: 100, latestObservationUtc: 200, frameCount: 4, attribution: 'NOAA' }, { product: 'bad' }, null] });
  assert.equal(ok.ok, true); assert.equal(ok.products.length, 1); assert.deepEqual(plain(ok.products[0]), { pid: PID, latest: 200, earliest: 100, count: 4, attribution: 'NOAA' }); assert.equal(ok.bad.length, 2);
  for (const bad of [null, {}, { schema: 'other', products: [] }, { schema: 'wxstudio.frames.v1' }, { schema: 'wxstudio.frames.v1', products: 'x' }]) assert.equal(U.parseCatalog(bad).ok, false);
});
test('parseHealth', () => {
  assert.deepEqual(plain(U.parseHealth({ service: 'wxstudio-noaa-native', status: 'ready', freshProducts: 2 }, 31)), { ok: true, status: 'ready', freshProducts: 2, service: 'wxstudio-noaa-native', ms: 31 });
  assert.equal(U.parseHealth(null).ok, false); assert.equal(U.parseHealth([]).ok, false);
});

/* ---------- labels and the report ---------- */
test('badge words: only the verified state says LIVE; demo/preview/stale say what they are', () => {
  assert.equal(U.BADGE.live, 'LIVE'); for (const k of Object.keys(U.BADGE)) if (k !== 'live') assert.notEqual(U.BADGE[k], 'LIVE', k);
  assert.equal(U.BADGE.demo, 'DEMO'); assert.equal(U.BADGE.experimental, 'PREVIEW'); assert.equal(U.BADGE.stale, 'STALE');
  assert.deepEqual(Object.keys(U.BADGE).sort(), Object.keys(U.STATE_LABEL).sort()); assert.deepEqual(Object.keys(U.BADGE_COLOR).sort(), Object.keys(U.STATE_LABEL).sort());
  assert.ok(Object.values(U.BADGE).every(w => w.length <= 11));
});
test('fmtAge', () => {
  assert.equal(U.fmtAge(10 * 1000), 'just now'); assert.equal(U.fmtAge(5 * MIN), '5 min ago'); assert.equal(U.fmtAge(125 * MIN), '2 h 5 min ago'); assert.equal(U.fmtAge(NaN), 'unknown');
});
test('report text has the processor, endpoints and per-product lines — and skips untouched not-connected rows', () => {
  const r = U.buildReport({ at: NOW, version: '0.9.93', proc: { endpoint: LOCAL, mode: 'local', title: 'Connected', detail: '1 product listed' }, health: { ok: true, status: 'ready', freshProducts: 1 }, catalog: { ok: true, products: [{}] },
    rows: [{ pid: PID, state: 'live', label: 'LIVE · verified', why: '', meta: meta(3, 5), verify: { ok: true, w: 2000, h: 1200, bytes: 204800 } }, { pid: 'mrms-reflectivity', state: 'waiting', label: 'Waiting', why: 'no frame yet', meta: null, verify: null }, { pid: 'goes-west-full-C02', state: 'notconnected', label: 'x', why: '', meta: null }] });
  assert.match(r, /v0\.9\.93/); assert.match(r, /\/health: ok · status=ready · freshProducts=1/); assert.match(r, /goes-east-conus-C02.*5 frame\(s\).*verified 2000x1200 200 KB/); assert.match(r, /mrms-reflectivity.*no frame yet/); assert.doesNotMatch(r, /goes-west-full-C02/);
  assert.match(U.buildReport({ at: NOW, proc: { endpoint: '', mode: 'none', title: 'Not connected', detail: 'd' }, rows: [] }), /Processor: none/);
});

/* ---------- requirement checks added with the dataloop status hook ---------- */
test('freshness limits are one adjustable table with the approved provisional values', () => {
  assert.deepEqual(plain(U.FRESH_MINUTES), { mrms: 15, nexrad: 20, goesConus: 20, goesFull: 30, goesMeso: 10, other: 30 });
  const keep = U.FRESH_MINUTES.goesMeso; U.FRESH_MINUTES.goesMeso = 5;
  assert.equal(U.freshWindowMin('goes-west-meso2-C02'), 5, 'editing the table changes the limit'); U.FRESH_MINUTES.goesMeso = keep;
  assert.equal(U.freshWindowMin('goes-west-meso2-C02'), 10);
});
test('RTMA / model ids are not recognised anywhere: no family, no freshness special-case, report lists them as ignored', () => {
  assert.equal(U.parseProduct('rtma-anything').kind, 'other'); assert.equal(U.freshWindowMin('rtma-anything'), U.FRESH_MINUTES.other);
  const r = U.buildReport({ at: NOW, proc: { endpoint: LOCAL, mode: 'local', title: 'Connected', detail: 'd' }, rows: [], unrecognized: ['rtma-2m-temperature'] });
  assert.match(r, /Unrecognized products .*ignored.*rtma-2m-temperature/);
});
test('KBOX is labelled as the Boston NEXRAD site', () => {
  assert.match(U.parseProduct('nexrad-reflectivity-KBOX').label, /KBOX \(Boston\)/); assert.doesNotMatch(U.parseProduct('nexrad-reflectivity-KOKX').label, /Boston/);
  assert.equal(U.parseProduct('nexrad-velocity-KBOX').kind, 'nexrad');
});
test('generic GOES alias: prefers East CONUS visible; any other choice is flagged as a fallback, never silent', () => {
  const a = U.resolveGoesAlias(['goes-west-conus-C13', 'goes-east-conus-C02', 'mrms-reflectivity']); assert.deepEqual(plain(a), { pid: 'goes-east-conus-C02', fallback: false, preferred: 'goes-east-conus-C02' });
  const f = U.resolveGoesAlias(['goes-west-conus-C13', 'goes-west-full-C02', 'mrms-reflectivity']); assert.equal(f.pid, 'goes-west-conus-C13'); assert.equal(f.fallback, true); assert.equal(f.preferred, 'goes-east-conus-C02');
  assert.equal(U.resolveGoesAlias(['mrms-reflectivity']), null); assert.equal(U.resolveGoesAlias([]), null);
  assert.equal(U.loopProduct({ source: 'goes' }, ['goes-west-conus-C13']), 'goes-west-conus-C13');
});

/* ---------- the dataloop status hook (real studio/dataloop.js in a DOM-less sandbox) ---------- */
function loadDataloop() {
  const win = {}, doc = { readyState: 'complete', createElement: () => ({}), getElementById: () => null, head: { append() {} } };
  new Function('window', 'document', 'setTimeout', 'requestAnimationFrame', fs.readFileSync(path.join(__dirname, '../studio/dataloop.js'), 'utf8'))(win, doc, () => 0, () => 0);
  return win.WXData;
}
test('dataloop: without a provider the label never claims LIVE (demo → DEMO, preview → PREVIEW, otherwise UNVERIFIED)', () => {
  const D = loadDataloop();
  assert.equal(D.liveStatus({ dataLoop: { source: 'demo' } }).text, 'DEMO');
  D.registerSource({ id: 'nws-preview', label: 'preview', nativeData: false, list: async () => [] });
  assert.equal(D.liveStatus({ dataLoop: { source: 'nws-preview' } }).text, 'PREVIEW');   // browser-fetched NWS image, not decoded source data
  D.registerSource({ id: 'goes-east-conus-C02', label: 'x', list: async () => [] });
  assert.equal(D.liveStatus({ dataLoop: { source: 'goes-east-conus-C02' } }).text, 'UNVERIFIED');
  assert.notEqual(D.liveStatus(null).text, 'LIVE');
});
test('dataloop: a registered provider drives the label; a throwing or empty provider falls back to the safe default', () => {
  const D = loadDataloop(), sc = { dataLoop: { source: 'demo' } };
  D.setStatusProvider(() => ({ state: 'live', text: 'LIVE', color: '#ff5d5d', title: 't' })); assert.equal(D.liveStatus(sc).text, 'LIVE'); assert.equal(D.liveStatus(sc).state, 'live');
  D.setStatusProvider(() => { throw new Error('boom'); }); assert.equal(D.liveStatus(sc).text, 'DEMO');
  D.setStatusProvider(() => null); assert.equal(D.liveStatus(sc).text, 'DEMO');
  D.setStatusProvider(() => ({ state: 'stale', text: '' })); assert.equal(D.liveStatus(sc).text, 'DEMO');
  D.setStatusProvider(null); assert.equal(D.statusProvider, null);
});
test('dataloop.js no longer hardcodes a LIVE label', () => {
  const src = fs.readFileSync(path.join(__dirname, '../studio/dataloop.js'), 'utf8');
  assert.doesNotMatch(src, /fillText\('LIVE'/); assert.doesNotMatch(src, /text: 'LIVE'/); assert.doesNotMatch(src, /frames · Live'/);
  const ws = fs.readFileSync(path.join(__dirname, '../studio/weather_workspace.js'), 'utf8');
  for (const bad of ['MutationObserver', 'relabelDock', 'wxHonest', "fillText = function"]) assert.ok(!ws.includes(bad), bad + ' workaround must be gone from weather_workspace.js');
});
