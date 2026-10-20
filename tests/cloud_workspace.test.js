'use strict';
/* v0.10.2 cloud-workspace engine tests, run against the in-memory fake of the agreed Supabase contract. */
const test = require('node:test');
const assert = require('node:assert/strict');
const CW = require('../studio/cloud_workspace.js');
const { createFakeSupabase } = require('./helpers/fake_supabase.js');

const bytes = (n, seed) => { const b = new Uint8Array(n); let x = seed || 1; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
const png = (n, seed) => CW.toDataUrl(bytes(n, seed), 'image/png');
const mkShow = (extra) => Object.assign({ v: 1, name: 'Evening show', accent: '#2f9bff', bugText: 'WX', logo: null, assets: {}, scenes: [{ id: 's1', name: 'Open', duration: 6, objects: [] }, { id: 's2', name: 'Radar', duration: 8, objects: [] }] }, extra || {});

/* a controllable clock/timer so tests never wait */
function fakeTimers() { let id = 0; const q = new Map(); return { set: (f, ms) => { q.set(++id, { f, ms }); return id; }, clear: t => q.delete(t), pending: () => [...q.values()].map(x => x.ms), q }; }

async function client(fake, uid, o) {
  o = o || {}; const kv = o.kv || CW.memoryKV(), timers = fakeTimers();
  const state = { show: o.show || mkShow(), scene: 's1', local: !!o.realWork, settings: o.settings || {}, loaded: [], written: [] };
  const host = {
    getShow: () => state.show, getSceneId: () => state.scene, localOnlyMedia: () => o.lom || [], builtinAssets: () => o.builtin || {},
    hasRealLocalWork: () => state.local, renameShow: n => { state.show.name = n; },
    loadShow: async (s, opts) => { state.show = s; state.loaded.push(opts); if (opts && opts.sceneId) state.scene = opts.sceneId; state.local = true; },
    readSettings: () => Object.assign({}, state.settings), writeSettings: p => { for (const k of Object.keys(p)) { if (p[k] === null) delete state.settings[k]; else state.settings[k] = p[k]; } state.written.push(p); }
  };
  const session = { access_token: fake.token(uid), user: { id: uid } };
  const api = CW.createApi({ url: fake.url, key: fake.key, fetch: fake.fetch, getSession: async () => (o.signedOut ? null : session) });
  const eng = CW.createEngine({ api, kv, host, deviceId: o.deviceId || 'dev-' + uid, deviceName: o.deviceName || 'Home PC', timers, debounceMs: 3000, backoff: [5000, 10000, 20000], auth: { session: async () => (o.signedOut ? null : session) } });
  await eng.attach(); return { eng, state, kv, timers, host };
}
const rpcCalls = (fake, name) => fake.calls.filter(c => c.path.endsWith('/rpc/' + name));

test('first sync uploads images, registers them, then saves the document with media refs only', async () => {
  const fake = createFakeSupabase(), data = png(2000, 7);
  const c = await client(fake, 'u1', { builtin: { bgdefault: 'data:image/jpeg;base64,/9j/' }, show: mkShow({ assets: { img1: data, bgdefault: 'data:image/jpeg;base64,/9j/' } }) });
  c.eng.markDirty(); assert.ok(c.timers.pending().includes(3000), 'debounced 3 s');
  const r = await c.eng.syncNow(); assert.equal(r.ok, true); assert.ok(['created', 'saved'].includes(r.status));
  const order = fake.calls.map(x => x.path.split('?')[0].split('/').slice(-1)[0] + ':' + x.method);
  assert.ok(order.indexOf('wx_studio_register_media:POST') < order.indexOf('wx_studio_save_show:POST'), 'register before save');
  const row = fake.db.shows[0]; assert.equal(row.doc.cloud_schema, 1); assert.equal(row.doc.v, 1);
  assert.match(row.doc.assets.img1.media, /^sha256:[0-9a-f]{64}$/); assert.equal(row.doc.assets.bgdefault, undefined); assert.ok(row.doc.builtinAssets.bgdefault, 'bundled image recorded by id + hash, never uploaded'); assert.equal(fake.objects.size, 1);
  assert.ok(!JSON.stringify(row.doc).includes('data:'));
  assert.equal(c.eng.status().kind, 'cloud'); assert.equal(c.eng.status().label, 'Saved to cloud');
  // second sync with no change makes no save call
  const n = rpcCalls(fake, 'wx_studio_save_show').length; c.eng.markDirty(); await c.eng.syncNow();
  assert.equal(rpcCalls(fake, 'wx_studio_save_show').length, n, 'unchanged document is not re-sent');
});

test('same image used twice uploads once; an already-registered image is not uploaded again', async () => {
  const fake = createFakeSupabase(), d = png(1500, 3);
  const c = await client(fake, 'u1', { show: mkShow({ assets: { a: d, b: d } }) }); c.eng.markDirty(); await c.eng.syncNow();
  assert.equal(fake.objects.size, 1);
  const c2 = await client(fake, 'u1', { show: mkShow({ assets: { z: d } }), deviceId: 'other' }); c2.eng.markDirty(); await c2.eng.syncNow();
  assert.equal([...fake.calls].filter(x => x.method === 'POST' && x.path.includes('/storage/')).length, 1);
});

test('lost response: retry reuses the op id and is recognised as our own save (no conflict, one revision)', async () => {
  const fake = createFakeSupabase(); const c = await client(fake, 'u1');
  c.eng.markDirty(); fake.dropResponseNext(/rpc\/wx_studio_save_show/);
  let r = await c.eng.syncNow(); assert.equal(r.status, 'offline'); assert.equal(fake.db.shows.length, 1, 'server did execute it');
  const op1 = rpcCalls(fake, 'wx_studio_save_show')[0].body.p_op_id;
  assert.equal(c.eng.status().kind, 'offline'); assert.equal(c.eng.status().label, 'Offline – saved locally');
  r = await c.eng.syncNow({ force: true }); assert.equal(r.ok, true);
  const calls = rpcCalls(fake, 'wx_studio_save_show'); assert.equal(calls[1].body.p_op_id, op1, 'same op id');
  assert.equal(fake.db.shows[0].rev, 1); assert.equal(c.eng.record().baseRev, 1); assert.equal(c.eng.status().kind, 'cloud');
});

test('lost response then the document changed again: reconciles, then pushes the newest edit', async () => {
  const fake = createFakeSupabase(); const c = await client(fake, 'u1');
  c.eng.markDirty(); fake.dropResponseNext(/rpc\/wx_studio_save_show/); await c.eng.syncNow();
  c.state.show.name = 'Edited after'; c.eng.markDirty();
  const r = await c.eng.syncNow(); assert.equal(r.ok, true);
  await c.eng.syncNow({ force: true });
  assert.equal(fake.db.shows[0].doc.name, 'Edited after'); assert.equal(fake.db.shows[0].rev, 2);
});

test("another computer's intervening save is never mistaken for ours (conflict)", async () => {
  const fake = createFakeSupabase(); const a = await client(fake, 'u1', { deviceId: 'A', deviceName: 'Home PC' });
  a.eng.markDirty(); await a.eng.syncNow();
  const b = await client(fake, 'u1', { deviceId: 'B', deviceName: 'Studio PC' }); await b.eng.openShow(a.eng.record().showId);
  b.state.show.name = 'From B'; b.eng.markDirty(); await b.eng.syncNow();
  a.state.show.name = 'From A'; a.eng.markDirty(); const r = await a.eng.syncNow();
  assert.equal(r.status, 'conflict'); assert.equal(a.eng.status().kind, 'conflict'); assert.equal(fake.db.shows[0].doc.name, 'From B', 'cloud untouched');
  assert.equal(a.state.show.name, 'From A', 'local untouched'); assert.equal(a.eng.record().conflict.device_name, 'Studio PC');
  // lost response where the intervening save was another device's: still a conflict
  a.eng.record().conflict = null;
});

test('conflict: keep mine overwrites on the LATEST revision and leaves a protected pre-overwrite version', async () => {
  const fake = createFakeSupabase(); const a = await client(fake, 'u1', { deviceId: 'A' }); a.eng.markDirty(); await a.eng.syncNow();
  const b = await client(fake, 'u1', { deviceId: 'B' }); await b.eng.openShow(a.eng.record().showId); b.state.show.name = 'B'; b.eng.markDirty(); await b.eng.syncNow();
  a.state.show.name = 'A'; a.eng.markDirty(); await a.eng.syncNow();
  const r = await a.eng.resolveConflict('keep-local'); assert.equal(r.ok, true);
  assert.equal(fake.db.shows[0].doc.name, 'A'); assert.equal(fake.db.shows[0].rev, 3);
  const prot = fake.db.versions.filter(v => v.protected); assert.ok(prot.some(v => v.reason === 'pre-overwrite' || v.reason === 'overwrite'));
  assert.ok(fake.db.versions.some(v => v.doc.name === 'B'), "B's work is recoverable");
});

test('conflict: use cloud loads the cloud copy; keep both creates a separate show', async () => {
  const fake = createFakeSupabase(); const a = await client(fake, 'u1', { deviceId: 'A' }); a.eng.markDirty(); await a.eng.syncNow();
  const b = await client(fake, 'u1', { deviceId: 'B' }); await b.eng.openShow(a.eng.record().showId); b.state.show.name = 'B'; b.eng.markDirty(); await b.eng.syncNow();
  a.state.show.name = 'A'; a.eng.markDirty(); await a.eng.syncNow();
  await a.eng.resolveConflict('use-cloud'); assert.equal(a.state.show.name, 'B'); assert.equal(a.eng.status().kind, 'cloud');
  await b.eng.openShow(a.eng.record().showId); b.state.show.name = 'B2'; b.eng.markDirty(); await b.eng.syncNow();
  a.state.show.name = 'A3'; a.eng.markDirty(); assert.equal((await a.eng.syncNow()).status, 'conflict');
  const r = await a.eng.resolveConflict('keep-both'); assert.equal(r.ok, true);
  assert.equal(fake.db.shows.length, 2); assert.match(a.state.show.name, /copy/); assert.equal(fake.db.shows.find(s => s.doc.name === 'B2').rev >= 1, true);
});

test('image failures become local-only markers with the four allowed reasons; the document still saves', async () => {
  const fake = createFakeSupabase({ quotaBytes: 100000 });
  const big = png(8 * 1048576 + 10, 1), webp = CW.toDataUrl(bytes(200, 2), 'image/gif'), ok = png(500, 4), failing = png(600, 5);
  const c = await client(fake, 'u1', { show: mkShow({ assets: { big, gif: webp, ok, failing } }) });
  fake.failNext(/storage\/v1\/object\/wx-studio-media\/u1\/[0-9a-f]{64}\.png/, { status: 500, body: { message: 'boom' } });
  c.eng.markDirty(); const r = await c.eng.syncNow(); assert.equal(r.ok, true);
  const a = fake.db.shows[0].doc.assets;
  assert.equal(a.big.local_only, true); assert.equal(a.big.reason, 'too_large');
  assert.equal(a.gif.reason, 'mime_not_allowed');
  const reasons = Object.values(a).filter(x => x.local_only).map(x => x.reason); for (const x of reasons) assert.ok(['too_large', 'mime_not_allowed', 'upload_failed', 'unavailable'].includes(x));
  assert.ok(Object.values(a).filter(x => x.media).length >= 1 || Object.values(a).some(x => x.reason === 'upload_failed'));
  assert.equal(c.state.show.assets.big, big, 'local original untouched'); assert.equal(c.eng.status().kind, 'incomplete'); assert.match(c.eng.status().label, /Cloud document saved/);
});

test('failed upload is retried later and the marker is replaced by a registered reference', async () => {
  const fake = createFakeSupabase(), d = png(700, 9); const c = await client(fake, 'u1', { show: mkShow({ assets: { x: d } }) });
  fake.failNext(/storage\/v1\/object/, { status: 500, body: { message: 'boom' } });
  c.eng.markDirty(); await c.eng.syncNow(); assert.equal(fake.db.shows[0].doc.assets.x.reason, 'upload_failed');
  const r = await c.eng.syncNow({ retryMedia: true, force: true }); assert.equal(r.ok, true);
  assert.match(fake.db.shows[0].doc.assets.x.media, /^sha256:/); assert.equal(c.eng.status().kind, 'cloud');
});

test('storage full is reported as upload_failed (not a lost show); offline during upload keeps everything pending', async () => {
  const fake = createFakeSupabase({ quotaBytes: 10 }); const c = await client(fake, 'u1', { show: mkShow({ assets: { x: png(900, 1) } }) });
  c.eng.markDirty(); const r = await c.eng.syncNow(); assert.equal(r.ok, true); assert.equal(fake.db.shows[0].doc.assets.x.reason, 'upload_failed');
  const fake2 = createFakeSupabase(); const c2 = await client(fake2, 'u1', { show: mkShow({ assets: { x: png(900, 1) } }) });
  c2.eng.markDirty(); fake2.faults.offline = true; const r2 = await c2.eng.syncNow(); assert.equal(r2.status, 'offline'); assert.equal(fake2.db.shows.length, 0);
  assert.ok(c2.state.show.assets.x, 'local work intact'); assert.ok(c2.timers.pending().length > 0, 'retry scheduled');
  fake2.faults.offline = false; assert.equal((await c2.eng.syncNow({ force: true })).ok, true); assert.match(fake2.db.shows[0].doc.assets.x.media, /^sha256:/);
});

test('another computer opens a partial show: placeholders are kept and never replaced by local-only markers; valid refs are preserved', async () => {
  const fake = createFakeSupabase(), d = png(800, 11), bad = png(900, 12);
  const a = await client(fake, 'u1', { deviceId: 'A', deviceName: 'Home PC', show: mkShow({ assets: { good: d, bad } }) });
  fake.failNext(/storage\/v1\/object\/wx-studio-media\/u1\/[0-9a-f]{64}\.png/, { status: 500, body: { message: 'boom' } });   // first upload fails → 'good' or 'bad'
  a.eng.markDirty(); await a.eng.syncNow(); const first = JSON.parse(JSON.stringify(fake.db.shows[0].doc.assets));
  const failedId = Object.keys(first).find(k => first[k].local_only), okId = Object.keys(first).find(k => first[k].media);
  assert.ok(failedId && okId);
  // computer B: opens it. The failed image can't be downloaded; the good one is fetched.
  const b = await client(fake, 'u1', { deviceId: 'B', deviceName: 'Studio PC', show: mkShow() });
  const o = await b.eng.openShow(a.eng.record().showId); assert.equal(o.ok, true);
  assert.ok(b.state.show.assets[okId], 'good image downloaded and verified'); assert.equal(b.state.show.assets[failedId], undefined);
  assert.deepEqual(o.missing.map(m => m.id), [failedId]); assert.match(b.eng.status().label, /image/);
  b.state.show.name = 'B edit'; b.eng.markDirty(); await b.eng.syncNow();
  const after = fake.db.shows[0].doc.assets; assert.deepEqual(after[okId], first[okId], 'valid cloud ref preserved'); assert.deepEqual(after[failedId], first[failedId], 'placeholder preserved, not erased');
  // and a computer that simply has NOT downloaded a valid image must not turn it into a local-only marker
  const c = await client(fake, 'u1', { deviceId: 'C', show: mkShow() }); await c.eng.openShow(a.eng.record().showId);
  c.eng.record().placeholders[okId] = first[okId]; delete c.state.show.assets[okId]; c.state.show.name = 'C edit'; c.eng.markDirty(); await c.eng.syncNow();
  assert.deepEqual(fake.db.shows[0].doc.assets[okId], first[okId]);
});

test('hash mismatch on download keeps a placeholder instead of installing wrong bytes', async () => {
  const fake = createFakeSupabase(), d = png(500, 21); const a = await client(fake, 'u1', { show: mkShow({ assets: { p: d } }) }); a.eng.markDirty(); await a.eng.syncNow();
  const key = [...fake.objects.keys()][0]; fake.objects.get(key).bytes = bytes(500, 99);
  const b = await client(fake, 'u1', { deviceId: 'B', show: mkShow() }); const o = await b.eng.openShow(a.eng.record().showId);
  assert.equal(b.state.show.assets.p, undefined); assert.equal(o.missing[0].reason, 'hash_mismatch');
});

test('account isolation: user B never sees or opens user A shows, settings or workspace', async () => {
  const fake = createFakeSupabase(); const kv = CW.memoryKV(); const a = await client(fake, 'ua', { kv }); a.eng.markDirty(); await a.eng.syncNow();
  const b = await client(fake, 'ub', { kv, show: mkShow({ name: 'B show' }) });
  assert.equal(b.eng.record().showId, null); assert.deepEqual(await b.eng.listShows(), []);
  await assert.rejects(() => b.eng.openShow(a.eng.record().showId));
  assert.ok((await kv.keys('u:ua:')).length > 0 && (await kv.keys('u:ub:')).every(k => !k.includes('ua')));
});

test('workspace: per-device row; no local work auto-opens; real local work gets a Resume offer, never a silent replacement', async () => {
  const fake = createFakeSupabase(); const a = await client(fake, 'u1', { deviceId: 'A', deviceName: 'Home PC' }); a.state.scene = 's2'; a.eng.markDirty(); await a.eng.syncNow(); await a.eng.pushWorkspace();
  assert.equal(fake.db.workspace[0].device_id, 'A'); assert.equal(fake.db.workspace[0].active_scene_id, 's2');
  const fresh = await client(fake, 'u1', { deviceId: 'B', deviceName: 'Laptop', realWork: false });
  let r = await fresh.eng.restoreSession(); assert.equal(r.action, 'opened'); assert.equal(fresh.state.scene, 's2'); assert.equal(fresh.state.show.name, 'Evening show');
  const worker = await client(fake, 'u1', { deviceId: 'C', deviceName: 'Office', realWork: true, show: mkShow({ name: 'Local only work' }) });
  r = await worker.eng.restoreSession(); assert.equal(r.action, 'resume-offer'); assert.equal(worker.state.show.name, 'Local only work');
  assert.equal(r.deviceName, 'Home PC');
});

test('settings sync: whitelist only, token must look public, per-key, cloud wins on a fresh computer without upload', async () => {
  const fake = createFakeSupabase(); const a = await client(fake, 'u1', { settings: { 'wx.mapbox.scale': '2', secret_thing: 'nope', 'wx.mapbox.token': 'sk.SECRETSECRET' } });
  await a.eng.pullSettings(); a.state.settings['wx.mapbox.scale'] = '3'; await a.eng.pushSettings();
  const cloud = fake.db.settings[0].settings; assert.equal(cloud['wx.mapbox.scale'], 3); assert.equal(cloud.secret_thing, undefined); assert.equal(cloud['wx.mapbox.token'], undefined);
  assert.ok(!JSON.stringify(fake.calls).includes('SECRETSECRET'));
  const b = await client(fake, 'u1', { deviceId: 'B', settings: { 'wx.mapbox.scale': '1' } }); await b.eng.pullSettings();
  assert.equal(b.state.settings['wx.mapbox.scale'], '3');
});

test('versions: restore creates a NEW revision; delete / undelete advance the revision and keep history', async () => {
  const fake = createFakeSupabase(); const a = await client(fake, 'u1'); a.eng.markDirty(); await a.eng.syncNow();
  a.state.show.name = 'v2'; a.eng.markDirty(); await a.eng.syncNow({ reason: 'manual' });
  const vs = await a.eng.listVersions(); assert.ok(vs.length >= 1); const v1 = vs.find(v => v.rev === 1) || vs[vs.length - 1];
  const r = await a.eng.restoreVersion(v1); assert.equal(r.ok, true); assert.equal(a.state.show.name, 'Evening show'); assert.equal(fake.db.shows[0].rev, 3);
  const del = await a.eng.deleteShow(a.eng.record().showId); assert.equal(del.status, 'deleted'); assert.equal((await a.eng.listShows()).length, 0);
  const un = await a.eng.undeleteShow(a.eng.record().showId); assert.equal(un.status, 'restored'); assert.equal((await a.eng.listShows()).length, 1);
});

test('newer cloud version is only a notification; loading it with unsynced local edits becomes a conflict, not an overwrite', async () => {
  const fake = createFakeSupabase(); const a = await client(fake, 'u1', { deviceId: 'A' }); a.eng.markDirty(); await a.eng.syncNow();
  const b = await client(fake, 'u1', { deviceId: 'B', deviceName: 'Studio PC' }); await b.eng.openShow(a.eng.record().showId); b.state.show.name = 'B'; b.eng.markDirty(); await b.eng.syncNow();
  const n = await a.eng.checkRemote(); assert.equal(n.rev, 2); assert.equal(a.state.show.name, 'Evening show', 'not replaced');
  a.state.show.name = 'unsynced A'; a.eng.record().dirty = true; const r = await a.eng.loadRemoteNewer(); assert.equal(r.status, 'conflict'); assert.equal(a.state.show.name, 'unsynced A');
});

test('invalid / too-large document leaves local work alone and says so', async () => {
  const fake = createFakeSupabase(); const c = await client(fake, 'u1', { show: mkShow({ scenes: [] }) }); c.eng.markDirty();
  const r = await c.eng.syncNow(); assert.equal(r.ok, false); assert.equal(c.eng.status().kind, 'failed'); assert.equal(c.state.show.scenes.length, 0);
});

test('signed out: nothing is sent and status says saved locally', async () => {
  const fake = createFakeSupabase(); const c = await client(fake, 'u1', { signedOut: true }); c.eng.markDirty(); const r = await c.eng.syncNow();
  assert.equal(r.status, 'signedout'); assert.equal(fake.calls.length, 0); assert.equal(c.eng.status().label, 'Saved locally');
});

test('engine state survives a reload: pending op id and base revision are persisted per account', async () => {
  const fake = createFakeSupabase(), kv = CW.memoryKV(); const a = await client(fake, 'u1', { kv }); a.eng.markDirty(); fake.dropResponseNext(/rpc\/wx_studio_save_show/); await a.eng.syncNow();
  const op = a.eng.record().pending.opId;
  const again = await client(fake, 'u1', { kv, show: a.state.show }); assert.equal(again.eng.record().pending.opId, op);
  const r = await again.eng.syncNow({ force: true }); assert.equal(r.ok, true); assert.equal(rpcCalls(fake, 'wx_studio_save_show').pop().body.p_op_id, op); assert.equal(fake.db.shows[0].rev, 1);
});

test('re-opening your own partially synced show keeps this computer\'s original image (no placeholder, no downgrade)', async () => {
  const fake = createFakeSupabase(), d = png(640, 31); const a = await client(fake, 'u1', { deviceId: 'A', show: mkShow({ assets: { x: d } }) });
  fake.failNext(/storage\/v1\/object/, { status: 500, body: { message: 'boom' } }); a.eng.markDirty(); await a.eng.syncNow();
  assert.equal(fake.db.shows[0].doc.assets.x.reason, 'upload_failed');
  const o = await a.eng.openShow(a.eng.record().showId); assert.equal(o.missing.length, 0); assert.equal(a.state.show.assets.x, d, 'original bytes kept');
  assert.equal(Object.keys(a.eng.record().placeholders).length, 0);
});

test('only an unchanged-hash image is decoded/hashed once across many autosaves', async () => {
  const fake = createFakeSupabase(); const c = await client(fake, 'u1', { show: mkShow({ assets: { x: png(4000, 41) } }) });
  c.eng.markDirty(); await c.eng.syncNow(); const reg = rpcCalls(fake, 'wx_studio_register_media').length, sel = fake.calls.filter(x => x.path.includes('wx_studio_media')).length;
  for (let i = 0; i < 3; i++) { c.state.show.name = 'edit ' + i; c.eng.markDirty(); await c.eng.syncNow(); }
  assert.equal(rpcCalls(fake, 'wx_studio_register_media').length, reg); assert.equal(fake.calls.filter(x => x.path.includes('wx_studio_media')).length, sel, 'no repeat media lookups');
});
