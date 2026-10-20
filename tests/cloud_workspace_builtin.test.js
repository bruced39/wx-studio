'use strict';
/* v0.10.2 integration tests: bundled template artwork, v0.10.1.x object types (fit-box text, Flow, Jet, text-only banner, pinned pts + z0) round-tripping through
 * the cloud document, duplicate-upload recognition, and hidden-tab polling. Every scenario runs against the in-memory contract fake AND (when PostgreSQL + the
 * migrations are available, see cloud_workspace_pg.test.js) the real SQL migrations. */
const test = require('node:test');
const assert = require('node:assert/strict');
const CW = require('../studio/cloud_workspace.js');
const { createFakeSupabase } = require('./helpers/fake_supabase.js');
const { createPgSupabase, USERS } = require('./helpers/pg_supabase.js');

const bytes = (n, seed) => { const b = new Uint8Array(n); let x = seed || 1; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
const png = (n, seed) => CW.toDataUrl(bytes(n, seed), 'image/png');
const jpg = (n, seed) => CW.toDataUrl(bytes(n, seed), 'image/jpeg');
const clone = x => JSON.parse(JSON.stringify(x));
const timers = () => { let id = 0; const q = new Map(); return { set: (f, ms) => { q.set(++id, { f, ms }); return id; }, clear: t => q.delete(t), pending: () => [...q.values()].map(x => x.ms) }; };

/* the bundled artwork this simulated build "ships" (ids are the real ones; bytes are stand-ins) */
const BUILTIN = { bgdefault: jpg(4000, 11), bg7day: jpg(5000, 12), tpl_hl_sky: jpg(6000, 13), tpl_hl_night: jpg(6100, 14), tpl_hl_day: jpg(6200, 15), tpl_storm_night: jpg(6300, 16), tpl_storm_day: jpg(6400, 17) };

/* a show as v0.10.1.4 produces it: a Storm Update template scene (bundled background, text-only banner, fit-box headline), a Flow and a Jet with pinned pts + z0 */
function templateShow(extra) {
  return Object.assign({
    v: 1, name: 'Storm night', accent: '#2f9bff', bugText: 'WX', logo: null, assets: { tpl_storm_night: BUILTIN.tpl_storm_night, photo1: png(3000, 5) },
    scenes: [{
      id: 'sc1', name: 'Storm Update (night)', duration: 10, bg: { type: 'image', asset: 'tpl_storm_night', kenburns: false, fit: 'fill' }, title: { show: false, text: '', sub: '' },
      title2: { show: true, textOnly: true, text: 'STORM UPDATE', align: 'center', size: 0, font: 'Barlow', dx: 12, ty: -3, region: { l: 186, r: 1272, cy: 102, h: 88 }, fx: { stroke: { on: true, width: 3, color: '#000000' } } },
      objects: [
        { id: 'o1', type: 'text', text: 'Damaging wind gusts tonight across eastern Massachusetts', x: 960, y: 560, size: 64, fitBox: true, autoFit: true, maxLines: 2, fitH: 130, wrapW: 1500, color: '#ffffff', font: 'Barlow', weight: 700, align: 'center' },
        { id: 'o2', type: 'flow', pts: [[300, 700], [600, 640], [900, 660], [1300, 600]], z0: 7.5, geo: true, style: 'chevron', color: '#ffd23f', size: 46, spacing: 2.6, speed: 0.9 },
        { id: 'o3', type: 'jet', pts: [[100, 300], [700, 250], [1300, 330], [1800, 280]], z0: 7.5, geo: true, style: 'ribbon', color: '#d5dbe6', width: 70, speed: 1, arrowColor: '#ffffff', outline: false, fade: 0.45, flowText: true, words: 'JET STREAM', label: 'Polar jet' }
      ]
    }]
  }, extra || {});
}

const BACKENDS = [];
BACKENDS.push({ name: 'contract fake', uidA: 'user-a', uidB: 'user-b', make: async () => ({ s: createFakeSupabase(), close: async () => { } }) });
BACKENDS.push({
  name: 'real SQL', uidA: USERS['a@x.test'], uidB: USERS['b@x.test'], real: true, make: async () => {
    const pg = await createPgSupabase(); if (!pg) return null; return { s: pg, close: () => pg.close() };
  }
});

async function client(s, uid, o) {
  o = o || {}; const kv = o.kv || CW.memoryKV(), tm = timers();
  const st = { show: o.show || { v: 1, name: 'Blank', accent: '#2f9bff', bugText: 'WX', logo: null, assets: {}, scenes: [{ id: 's1', name: 'Open', duration: 6, objects: [] }] }, scene: 's1', local: !!o.realWork, hidden: !!o.hidden };
  const host = {
    getShow: () => st.show, getSceneId: () => st.scene, localOnlyMedia: () => [], hasRealLocalWork: () => st.local, renameShow: n => { st.show.name = n; },
    loadShow: async (sh, op) => { st.show = sh; if (op && op.sceneId) st.scene = op.sceneId; st.local = true; }, readSettings: () => ({}), writeSettings: () => { },
    builtinAssets: () => (o.builtin === undefined ? BUILTIN : o.builtin)
  };
  const sess = { access_token: s.token(uid), user: { id: uid } };
  const api = CW.createApi({ url: s.url, key: s.key, fetch: s.fetch, getSession: async () => sess });
  const eng = CW.createEngine({ api, kv, host, deviceId: o.deviceId || 'dev-' + uid.slice(-1), deviceName: o.deviceName || 'Home PC', timers: tm, debounceMs: 3000, backoff: [5000, 10000], auth: { session: async () => sess }, isHidden: () => st.hidden });
  await eng.attach(); return { eng, st, kv, tm, api };
}
const stable = CW.stable;
const storageCalls = (s, re) => s.calls.filter(c => /\/storage\/v1\//.test(c.path) && (!re || re.test(c.path)));

for (const B of BACKENDS) {
  const T = (name, fn) => test(B.name + ': ' + name, async t => {
    const be = await B.make(); if (!be) return t.skip('PostgreSQL binaries or the v0.10.2 migrations are not available');
    const s = be.s;
    try {
      if (B.real) { await s.query("TRUNCATE public.wx_studio_workspace, public.wx_studio_show_versions, public.wx_studio_shows, public.wx_studio_media, public.wx_studio_user_settings CASCADE; DELETE FROM storage.objects;"); s.objects.clear(); }
      await fn(s, t);
    } finally { await be.close(); }
  });
  const showRow = async s => B.real ? (await s.rows("SELECT to_jsonb(s) - 'last_op_result' FROM public.wx_studio_shows s"))[0] : s.db.shows[0];
  const mediaRows = async s => B.real ? await s.rows('SELECT to_jsonb(m) FROM public.wx_studio_media m') : s.db.media;

  T('bundled template background is not uploaded; every v0.10.1.x object field survives a second computer unchanged', async s => {
    const show = templateShow(), original = clone(show.scenes);
    const a = await client(s, B.uidA, { show, deviceId: 'A', builtin: BUILTIN }); a.eng.markDirty();
    const r = await a.eng.syncNow(); assert.equal(r.ok, true, JSON.stringify(r));
    // only the custom photo went to Storage + the media table; the bundled JPEG did not
    const posts = storageCalls(s).filter(c => c.method === 'POST'); assert.equal(posts.length, 1, 'one upload (photo1), not the bundled background');
    assert.equal((await mediaRows(s)).length, 1);
    const row = await showRow(s), doc = row.doc;
    assert.deepEqual(Object.keys(doc.assets), ['photo1'], 'no assets entry for the bundled image'); assert.match(doc.assets.photo1.media, /^sha256:/);
    assert.equal(doc.scenes[0].bg.asset, 'tpl_storm_night', 'the scene still points at the bundled background id');
    assert.equal(Object.keys(doc.builtinAssets).join(), 'tpl_storm_night'); assert.match(doc.builtinAssets.tpl_storm_night, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(doc).includes('data:'));
    assert.equal(a.eng.status().kind, 'cloud', 'valid bundled artwork never produces an incomplete / local-only warning');
    assert.deepEqual(doc.scenes, original, 'scene document (fit-box text, flow, jet, text-only banner, pts + z0) stored without changes');

    // another simulated computer opens it
    const b = await client(s, B.uidA, { deviceId: 'B', deviceName: 'Studio PC', builtin: BUILTIN });
    const o = await b.eng.openShow(a.eng.record().showId); assert.equal(o.ok, true); assert.deepEqual(o.missing, []);
    assert.equal(stable(b.st.show.scenes), stable(original), 'every object and field survives');
    assert.equal(b.st.show.assets.tpl_storm_night, BUILTIN.tpl_storm_night, 'bundled artwork re-attached from the app');
    assert.equal(b.st.show.assets.photo1, show.assets.photo1, 'custom photo downloaded and verified');
    assert.equal(b.st.show.builtinAssets, undefined, 'cloud-only field is not leaked into the working show');
    assert.equal(storageCalls(s, /tpl_|object\/authenticated/).filter(c => c.method === 'GET').length, 1, 'only the photo was downloaded');
    // saving again from B changes nothing (no extra upload, no revision for an identical document)
    b.eng.markDirty(); const r2 = await b.eng.syncNow(); assert.equal(r2.ok, true); assert.equal(storageCalls(s).filter(c => c.method === 'POST').length, 1);
    assert.equal((await showRow(s)).rev, 1);
  });

  T('a custom image that reuses a bundled id is uploaded and is not replaced by the bundled one', async s => {
    const custom = png(2500, 99), show = templateShow({ assets: { tpl_storm_night: custom } });
    const a = await client(s, B.uidA, { show, deviceId: 'A', builtin: BUILTIN }); a.eng.markDirty(); const r = await a.eng.syncNow(); assert.equal(r.ok, true, JSON.stringify(r));
    const doc = (await showRow(s)).doc; assert.match(doc.assets.tpl_storm_night.media, /^sha256:/); assert.equal(doc.builtinAssets, undefined);
    assert.equal(storageCalls(s).filter(c => c.method === 'POST').length, 1);
    const b = await client(s, B.uidA, { deviceId: 'B', builtin: BUILTIN }); const o = await b.eng.openShow(a.eng.record().showId); assert.deepEqual(o.missing, []);
    assert.equal(b.st.show.assets.tpl_storm_night, custom, 'the custom image survives opening on another computer');
  });

  T('a build without the bundled artwork, or with different artwork, reports it instead of silently loading something else', async s => {
    const a = await client(s, B.uidA, { show: templateShow(), deviceId: 'A', builtin: BUILTIN }); a.eng.markDirty(); await a.eng.syncNow();
    const missingB = await client(s, B.uidA, { deviceId: 'B', builtin: Object.assign({}, BUILTIN, { tpl_storm_night: undefined }) });
    let o = await missingB.eng.openShow(a.eng.record().showId); assert.deepEqual(o.missing.map(m => m.reason), ['builtin_missing']); assert.equal(missingB.st.show.assets.tpl_storm_night, undefined);
    const noBundle = await client(s, B.uidA, { deviceId: 'C', builtin: null });
    o = await noBundle.eng.openShow(a.eng.record().showId); assert.deepEqual(o.missing.map(m => m.reason), ['builtin_missing']);
    const changed = await client(s, B.uidA, { deviceId: 'D', builtin: Object.assign({}, BUILTIN, { tpl_storm_night: jpg(6300, 777) }) });
    o = await changed.eng.openShow(a.eng.record().showId); assert.deepEqual(o.missing.map(m => m.reason), ['builtin_changed']);
    assert.equal(changed.st.show.assets.tpl_storm_night.length > 100, true, 'the local bundled copy is attached, but the user is told it differs');
  });

  T('a bundled id with bytes that differ from the bundled copy is not skipped (no skipping by id alone)', async s => {
    const show = templateShow({ assets: { tpl_hl_sky: jpg(6000, 4242) } });     // right id, other bytes
    const a = await client(s, B.uidA, { show, deviceId: 'A', builtin: BUILTIN }); a.eng.markDirty(); const r = await a.eng.syncNow(); assert.equal(r.ok, true);
    const doc = (await showRow(s)).doc; assert.match(doc.assets.tpl_hl_sky.media, /^sha256:/); assert.equal(doc.builtinAssets, undefined);
  });

  T('older shows without the v0.10.1.x fields (and without builtinAssets) still load and save', async s => {
    const old = { v: 1, name: 'Old show', accent: '#2f9bff', bugText: 'WX', logo: null, assets: { bgdefault: BUILTIN.bgdefault }, scenes: [{ id: 's1', name: 'Open', duration: 6, bg: { type: 'image', asset: 'bgdefault' }, title: { show: true, text: 'Hello', sub: '' }, objects: [{ id: 'o1', type: 'text', text: 'Hi', x: 100, y: 100, size: 40 }, { id: 'o2', type: 'arrow', pts: [[0, 0], [10, 10]] }] }] };
    const a = await client(s, B.uidA, { show: clone(old), deviceId: 'A', builtin: BUILTIN }); a.eng.markDirty(); assert.equal((await a.eng.syncNow()).ok, true);
    const doc = (await showRow(s)).doc; assert.equal(doc.assets.bgdefault, undefined); assert.equal(doc.builtinAssets.bgdefault.length, 64);
    const b = await client(s, B.uidA, { deviceId: 'B', builtin: BUILTIN }); await b.eng.openShow(a.eng.record().showId);
    assert.equal(stable(b.st.show.scenes), stable(old.scenes)); assert.equal(b.st.show.assets.bgdefault, BUILTIN.bgdefault);
  });

  T('duplicate upload: an object left by an earlier interrupted upload is recognised (400 "Asset Already Exists", 409 "Duplicate", or the default shape) and registered without overwriting', async s => {
    const styles = B.real ? [undefined] : ['asset400', 'http409', undefined];
    for (const style of styles) {
      if (!B.real) { s.db.shows.length = 0; s.db.media.length = 0; s.objects.clear(); s.faults.dupStyle = style; } else { await s.query("TRUNCATE public.wx_studio_workspace, public.wx_studio_show_versions, public.wx_studio_shows, public.wx_studio_media CASCADE; DELETE FROM storage.objects;"); s.objects.clear(); }
      const data = png(3500, 31), p = CW.parseDataUrl(data), sha = await CW.sha256(p.bytes), uid = B.uidA, path = uid + '/' + sha + '.png';
      const pre = await client(s, uid, { deviceId: 'P' }); await pre.api.upload(path, p.bytes, 'image/png');       // upload happened, registration never did
      assert.equal(storageCalls(s).filter(c => c.method === 'POST').length >= 1, true);
      const posts0 = storageCalls(s).filter(c => c.method === 'POST').length;
      const a = await client(s, uid, { show: { v: 1, name: 'Dup', accent: '#2f9bff', bugText: 'WX', logo: null, assets: { img: data }, scenes: [{ id: 's1', name: 'Open', duration: 6, objects: [] }] }, deviceId: 'A' });
      a.eng.markDirty(); const r = await a.eng.syncNow(); assert.equal(r.ok, true, String(style) + ' ' + JSON.stringify(r));
      assert.equal(storageCalls(s).filter(c => c.method === 'POST').length, posts0 + 1, 'one (rejected) attempt, no overwrite');
      assert.equal((await mediaRows(s)).length, 1); assert.match((await showRow(s)).doc.assets.img.media, /^sha256:/); assert.equal(a.eng.status().kind, 'cloud');
    }
  });
}

test('classifyStorageError: only genuine existing-object responses are "exists"', () => {
  const c = e => CW.classifyStorageError(e).reason;
  assert.equal(c({ status: 400, body: { statusCode: '400', error: 'Asset Already Exists', message: 'The resource already exists' }, message: 'The resource already exists' }), 'exists');
  assert.equal(c({ status: 409, body: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, message: 'The resource already exists' }), 'exists');
  assert.equal(c({ status: 400, body: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, message: 'The resource already exists' }), 'exists');
  assert.equal(c({ status: 400, body: { message: 'Asset already exists' }, message: 'Asset already exists' }), 'exists');
  assert.equal(c({ status: 400, body: { statusCode: '400', error: 'invalid_request', message: 'Invalid file name' }, message: 'Invalid file name' }), 'upload_failed', 'an arbitrary 400 is not "exists"');
  assert.equal(c({ status: 409, body: { statusCode: '409', error: 'Conflict', message: 'Lock timeout' }, message: 'Lock timeout' }), 'upload_failed', 'an arbitrary 409 is not "exists"');
  assert.equal(c({ status: 413, body: { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }, message: 'The object exceeded the maximum allowed size' }), 'too_large');
  assert.equal(c({ status: 413, body: { statusCode: '413', error: 'exceed_storage_size_quota', message: 'quota' }, message: 'quota' }), 'storage_full');
  assert.equal(c({ code: 'offline' }), 'offline'); assert.equal(c({ code: 'auth' }), 'auth');
});

test('an arbitrary HTTP 400 on upload keeps the image local-only (upload_failed) instead of pretending it exists', async () => {
  const s = createFakeSupabase(), a = await client(s, 'user-a', { show: { v: 1, name: 'x', accent: '#2f9bff', bugText: 'WX', logo: null, assets: { img: png(2000, 3) }, scenes: [{ id: 's1', name: 'Open', duration: 6, objects: [] }] } });
  s.failNext(/\/storage\/v1\/object\//, { status: 400, body: { statusCode: '400', error: 'invalid_request', message: 'Invalid file name' } }); a.eng.markDirty(); const r = await a.eng.syncNow(); assert.equal(r.ok, true);
  assert.equal(s.db.shows[0].doc.assets.img.local_only, true); assert.equal(s.db.shows[0].doc.assets.img.reason, 'upload_failed'); assert.equal(s.db.media.length, 0); assert.equal(a.eng.status().kind, 'incomplete');
});

test('hidden tab: the periodic cloud-version SELECT is skipped, saves still run, and becoming visible checks straight away', async () => {
  const s = createFakeSupabase(), a = await client(s, 'user-a', { deviceId: 'A' }), b = await client(s, 'user-a', { deviceId: 'B' });
  a.eng.markDirty(); await a.eng.syncNow(); await b.eng.openShow(a.eng.record().showId);
  const polls = () => s.calls.filter(c => c.method === 'GET' && /\/rest\/v1\/wx_studio_shows\?select=rev,updated_at/.test(c.path)).length;
  a.st.show.name = 'Changed on A'; a.eng.markDirty(); await a.eng.syncNow();
  b.st.hidden = true; let n = polls(); await b.eng.tick(); await b.eng.tick(); assert.equal(polls(), n, 'no version SELECT while hidden'); assert.equal(b.eng.status().remoteNewer, null);
  // local saves are never suspended while hidden
  b.st.show.name = 'Edited on B while hidden'; b.eng.markDirty(); const r = await b.eng.syncNow({ force: true }); assert.ok(r.ok === true || r.status === 'conflict', 'a save still goes out while hidden');
  b.st.hidden = false; n = polls(); await b.eng.onVisible(); assert.equal(polls(), n + 1, 'one prompt check when the tab is visible again');
  n = polls(); await b.eng.tick(); assert.equal(polls(), n + 1, 'normal polling resumes when visible');
});
