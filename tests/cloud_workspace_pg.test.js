'use strict';
/* Client engine vs the REAL v0.10.2 SQL migrations (run in a throw-away local PostgreSQL by tests/helpers/pg_supabase.js).
 * Needs PostgreSQL server binaries and the migrations: WX_MIGRATIONS_DIR=<dir with ChatGPT's 20261020*.sql> (or supabase/migrations in this repo).
 * Skipped automatically when either is missing. This is NOT the live Supabase project: PostgREST, Storage and Auth are emulated. */
const test = require('node:test');
const assert = require('node:assert/strict');
const CW = require('../studio/cloud_workspace.js');
const { createPgSupabase, USERS } = require('./helpers/pg_supabase.js');
const A = USERS['a@x.test'], B = USERS['b@x.test'];
const bytes = (n, seed) => { const b = new Uint8Array(n); let x = seed || 1; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
const png = (n, seed) => CW.toDataUrl(bytes(n, seed), 'image/png');
const mkShow = e => Object.assign({ v: 1, name: 'Evening show', accent: '#2f9bff', bugText: 'WX', logo: null, assets: {}, scenes: [{ id: 's1', name: 'Open', duration: 6, objects: [] }, { id: 's2', name: 'Radar', duration: 8, objects: [] }] }, e || {});
const timers = () => { let id = 0; const q = new Map(); return { set: (f, ms) => { q.set(++id, { f, ms }); return id; }, clear: t => q.delete(t), pending: () => [...q.values()].map(x => x.ms) }; };
let pg = null;
async function client(uid, o) {
  o = o || {}; const kv = o.kv || CW.memoryKV(), tm = timers();
  const st = { show: o.show || mkShow(), scene: 's1', local: !!o.realWork, settings: o.settings || {}, written: [] };
  const host = { getShow: () => st.show, getSceneId: () => st.scene, localOnlyMedia: () => [], hasRealLocalWork: () => st.local, renameShow: n => { st.show.name = n; }, loadShow: async (s, op) => { st.show = s; if (op && op.sceneId) st.scene = op.sceneId; st.local = true; }, readSettings: () => Object.assign({}, st.settings), writeSettings: p => { for (const k of Object.keys(p)) { if (p[k] === null) delete st.settings[k]; else st.settings[k] = p[k]; } st.written.push(p); } };
  const sess = { access_token: pg.token(uid), user: { id: uid } };
  const api = CW.createApi({ url: pg.url, key: pg.key, fetch: pg.fetch, getSession: async () => sess });
  const eng = CW.createEngine({ api, kv, host, deviceId: o.deviceId || 'dev-' + uid.slice(-1), deviceName: o.deviceName || 'Home PC', timers: tm, debounceMs: 3000, backoff: [5000, 10000], auth: { session: async () => sess } });
  await eng.attach(); return { eng, st, kv, tm };
}
const rows = s => pg.rows(s);
const pgTest = (name, fn) => test(name, async t => { if (!pg) return t.skip('PostgreSQL binaries or the v0.10.2 migrations are not available'); await fn(t); });

test.before(async () => { pg = await createPgSupabase(); });
test.after(async () => { if (pg) await pg.close(); });
test.beforeEach(async () => { if (pg) await pg.query("TRUNCATE public.wx_studio_workspace, public.wx_studio_show_versions, public.wx_studio_shows, public.wx_studio_media, public.wx_studio_user_settings CASCADE; DELETE FROM storage.objects; "); if (pg) pg.objects.clear(); });

pgTest('real DB: first sync uploads under the storage policy, registers media, saves the document', async () => {
  const c = await client(A, { show: mkShow({ assets: { img1: png(3000, 7) } }) }); c.eng.markDirty(); const r = await c.eng.syncNow();
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(c.eng.status().kind, 'cloud');
  const [show] = await rows("SELECT to_jsonb(s) - 'last_op_result' FROM public.wx_studio_shows s"); assert.equal(show.rev, 1); assert.equal(show.doc.cloud_schema, 1); assert.equal(show.doc.v, 1);
  assert.match(show.doc.assets.img1.media, /^sha256:[0-9a-f]{64}$/); assert.equal(show.media_refs.length, 1);
  assert.equal((await rows('SELECT to_jsonb(m) FROM public.wx_studio_media m')).length, 1); assert.equal((await rows("SELECT to_jsonb(o) FROM storage.objects o WHERE bucket_id='wx-studio-media'")).length, 1);
});

pgTest('real DB: lost response is replayed by op id (one revision); a changed doc after a lost response reconciles structurally', async () => {
  const c = await client(A); c.eng.markDirty(); pg.dropResponseNext(/rpc\/wx_studio_save_show/); let r = await c.eng.syncNow(); assert.equal(r.status, 'offline');
  r = await c.eng.syncNow({ force: true }); assert.equal(r.ok, true); assert.equal((await rows('SELECT to_jsonb(s) FROM public.wx_studio_shows s'))[0].rev, 1);
  const d = await client(A, { deviceId: 'dev-x' }); d.eng.markDirty(); pg.dropResponseNext(/rpc\/wx_studio_save_show/); await d.eng.syncNow();
  d.st.show.name = 'Edited after lost response'; d.eng.markDirty(); r = await d.eng.syncNow(); assert.equal(r.ok, true, JSON.stringify(r));
  await d.eng.syncNow({ force: true }); const all = await rows('SELECT to_jsonb(s) FROM public.wx_studio_shows s ORDER BY created_at');
  assert.equal(all[1].doc.name, 'Edited after lost response'); assert.equal(all[1].rev, 2);
});

pgTest('real DB: conflict carries last_op_id + current_doc_hash; keep mine makes a protected pre-overwrite copy; use cloud / keep both work', async () => {
  const a = await client(A, { deviceId: 'A' }); a.eng.markDirty(); await a.eng.syncNow();
  const b = await client(A, { deviceId: 'B', deviceName: 'Studio PC' }); await b.eng.openShow(a.eng.record().showId); b.st.show.name = 'From B'; b.eng.markDirty(); await b.eng.syncNow();
  a.st.show.name = 'From A'; a.eng.markDirty(); const r = await a.eng.syncNow(); assert.equal(r.status, 'conflict');
  const cf = a.eng.record().conflict; assert.equal(cf.device_name, 'Studio PC'); assert.match(cf.current_doc_hash, /^[0-9a-f]{64}$/);
  assert.equal((await a.eng.resolveConflict('keep-local')).ok, true);
  const [s] = await rows('SELECT to_jsonb(s) FROM public.wx_studio_shows s'); assert.equal(s.doc.name, 'From A'); assert.equal(s.rev, 3);
  const prot = await rows("SELECT to_jsonb(v) FROM public.wx_studio_show_versions v WHERE protected"); assert.ok(prot.some(v => v.reason === 'pre-overwrite' && v.doc.name === 'From B'));
  b.st.show.name = 'B2'; b.eng.markDirty(); assert.equal((await b.eng.syncNow()).status, 'conflict'); assert.equal((await b.eng.resolveConflict('keep-both')).ok, true);
  assert.equal((await rows('SELECT to_jsonb(s) FROM public.wx_studio_shows s')).length, 2);
});

pgTest('real DB: local-only markers (4 reasons) are accepted; the failed image later becomes a registered reference', async () => {
  const big = png(8 * 1048576 + 5, 1), ok = png(900, 2), bad = png(950, 3), gif = CW.toDataUrl(bytes(100, 4), 'image/gif');
  const c = await client(A, { show: mkShow({ assets: { big, ok, bad, gif } }) }); pg.failNext(/storage\/v1\/object\/wx-studio-media\//, { status: 500, body: { message: 'boom' } });
  c.eng.markDirty(); const r = await c.eng.syncNow(); assert.equal(r.ok, true, JSON.stringify(r));
  const [s] = await rows('SELECT to_jsonb(s) FROM public.wx_studio_shows s'); const reasons = Object.values(s.doc.assets).filter(x => x.local_only).map(x => x.reason).sort();
  assert.deepEqual(reasons, ['mime_not_allowed', 'too_large', 'upload_failed']); assert.equal(c.eng.status().kind, 'incomplete');
  const r2 = await c.eng.syncNow({ retryMedia: true, force: true }); assert.equal(r2.ok, true);
  const [s2] = await rows('SELECT to_jsonb(s) FROM public.wx_studio_shows s'); assert.equal(Object.values(s2.doc.assets).filter(x => x.local_only && x.reason === 'upload_failed').length, 0); assert.equal(s2.media_refs.length, 2);
});

pgTest('real DB: a second computer keeps placeholders and valid refs when it edits a partly synced show', async () => {
  const a = await client(A, { deviceId: 'A', show: mkShow({ assets: { good: png(800, 11), bad: png(900, 12) } }) });
  pg.failNext(/storage\/v1\/object\/wx-studio-media\//, { status: 500, body: { message: 'boom' } }); a.eng.markDirty(); await a.eng.syncNow();
  const first = (await rows('SELECT to_jsonb(s) FROM public.wx_studio_shows s'))[0].doc.assets;
  const b = await client(A, { deviceId: 'B', show: mkShow() }); const o = await b.eng.openShow(a.eng.record().showId); assert.equal(o.missing.length, 1);
  b.st.show.name = 'B edit'; b.eng.markDirty(); assert.equal((await b.eng.syncNow()).ok, true);
  assert.deepEqual((await rows('SELECT to_jsonb(s) FROM public.wx_studio_shows s'))[0].doc.assets, first);
});

pgTest('real DB: versions, restore (new revision), delete / undelete (replay token reset), My Shows list columns', async () => {
  const a = await client(A); a.eng.markDirty(); await a.eng.syncNow(); a.st.show.name = 'v2'; a.eng.markDirty(); await a.eng.syncNow({ reason: 'manual' });
  const vs = await a.eng.listVersions(); assert.ok(vs.length >= 2); assert.ok('doc_hash' in vs[0] && !('doc' in vs[0]));
  const v1 = vs.find(v => v.rev === 1); assert.equal((await a.eng.restoreVersion(v1)).ok, true); assert.equal(a.st.show.name, 'Evening show'); assert.equal((await rows('SELECT to_jsonb(s) FROM public.wx_studio_shows s'))[0].rev, 3);
  const id = a.eng.record().showId; assert.equal((await a.eng.deleteShow(id)).status, 'deleted'); assert.equal((await a.eng.listShows()).length, 0); assert.equal((await a.eng.listShows(true)).length, 1);
  const un = await a.eng.undeleteShow(id); assert.equal(un.status, 'restored'); const list = await a.eng.listShows(); assert.equal(list.length, 1); assert.equal(list[0].scene_count, 2);
});

pgTest('real DB: workspace (active_show_id / active_scene_id) drives auto-open; Resume offer when local work exists; settings whitelist and token rule', async () => {
  const a = await client(A, { deviceId: 'A', settings: { 'wx.mapbox.scale': '2', 'wx.mapbox.token': 'sk.SECRETSECRET' } }); a.st.scene = 's2'; a.eng.markDirty(); await a.eng.syncNow(); await a.eng.pushWorkspace();
  const [w] = await rows('SELECT to_jsonb(w) FROM public.wx_studio_workspace w'); assert.equal(w.active_scene_id, 's2'); assert.equal(w.device_id, 'A');
  const fresh = await client(A, { deviceId: 'B', realWork: false }); const r = await fresh.eng.restoreSession(); assert.equal(r.action, 'opened'); assert.equal(fresh.st.scene, 's2');
  const busy = await client(A, { deviceId: 'C', realWork: true, show: mkShow({ name: 'Mine' }) }); assert.equal((await busy.eng.restoreSession()).action, 'resume-offer'); assert.equal(busy.st.show.name, 'Mine');
  await a.eng.pullSettings(); a.st.settings['wx.mapbox.scale'] = '3'; a.st.settings['wx.mapbox.token'] = 'pk.public.token'; await a.eng.pushSettings();
  const [s] = await rows('SELECT to_jsonb(u) FROM public.wx_studio_user_settings u'); assert.equal(s.settings['wx.mapbox.scale'], 3); assert.equal(s.settings['wx.mapbox.token'], 'pk.public.token');
  assert.ok(!JSON.stringify(pg.calls).includes('SECRETSECRET'), 'secret token never sent');
  const other = await client(A, { deviceId: 'D', settings: { 'wx.mapbox.scale': '1' } }); await other.eng.pullSettings(); assert.equal(other.st.settings['wx.mapbox.scale'], '3');
});

pgTest('real DB: account isolation (RLS + storage policy) and no direct table writes', async () => {
  const a = await client(A, { show: mkShow({ assets: { x: png(700, 5) } }) }); a.eng.markDirty(); await a.eng.syncNow();
  const b = await client(B, { show: mkShow({ name: 'B show' }) }); assert.deepEqual(await b.eng.listShows(), []); await assert.rejects(() => b.eng.openShow(a.eng.record().showId));
  const sha = (await rows('SELECT to_jsonb(m) FROM public.wx_studio_media m'))[0].sha256, path = A + '/' + sha + '.png';
  const resp = await pg.fetch(pg.url + '/storage/v1/object/authenticated/wx-studio-media/' + path, { headers: { Authorization: 'Bearer ' + pg.token(B), apikey: pg.key } }); assert.equal(resp.status, 404);
  const w = await pg.fetch(pg.url + '/rest/v1/wx_studio_shows', { method: 'POST', headers: { Authorization: 'Bearer ' + pg.token(A), apikey: pg.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) }); assert.equal(w.status, 403);
  const up = await pg.fetch(pg.url + '/storage/v1/object/wx-studio-media/' + B + '/' + sha + '.png', { method: 'POST', headers: { Authorization: 'Bearer ' + pg.token(A), apikey: pg.key, 'Content-Type': 'image/png' }, body: bytes(10, 1) }); assert.equal(up.status, 403, "cannot write into another user's folder");
});

pgTest('real DB: invalid document is refused with a plain failed status; local work untouched', async () => {
  const c = await client(A, { show: mkShow({ scenes: [] }) }); c.eng.markDirty(); const r = await c.eng.syncNow(); assert.equal(r.ok, false); assert.equal(c.eng.status().kind, 'failed'); assert.equal(c.st.show.scenes.length, 0);
});
