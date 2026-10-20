'use strict';
/* In-memory fake of the WX Studio cloud-workspace Supabase contract (docs/CLOUD_WORKSPACE_CONTRACT.md).
 * Used by the client tests; it is also the executable statement of what the client expects from the real database.
 * Provides a fetch() replacement for: /rest/v1/rpc/<6 RPCs>, owner-restricted table SELECTs, and the private wx-studio-media bucket.
 *   const fake = createFakeSupabase(); fake.fetch(url, opts); fake.token('user-a')  -> bearer token for that user.
 * Fault injection: fake.faults.offline = true; fake.failNext(/regex on path/, {status, body}); fake.dropResponseNext(/regex/)
 * (the server executes the request, then the "network" fails — the lost-response case). */
const nodeCrypto = require('node:crypto');

const REASONS = ['autosave', 'close', 'import', 'restore', 'overwrite', 'keep-both', 'manual'];
const LOCAL_REASONS = ['too_large', 'mime_not_allowed', 'upload_failed', 'unavailable'];
const SETTINGS_KEYS = ['wx.mapbox.token', 'wx.mapbox.scale', 'wx.mapbox.nativeScale.v1', 'wx.studio.defaultMap.v1', 'wx_bg_default', 'wx_fxpresets', 'wx_snap', 'wx_ov_opt', 'wx.export.v1'];
const MIMES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_DOC = 8 * 1048576, MAX_IMG = 8 * 1048576, MAX_SETTING = 64 * 1024, MAX_SETTINGS = 256 * 1024, VERSION_GAP = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : (v && typeof v === 'object') ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v);
const sha = s => nodeCrypto.createHash('sha256').update(s).digest('hex');
const clone = x => JSON.parse(JSON.stringify(x));

function createFakeSupabase(opt) {
  opt = opt || {};
  const F = { url: 'https://fake-project.supabase.test', key: 'sb_publishable_fake', calls: [], faults: { offline: false }, quotaBytes: opt.quotaBytes || Infinity };
  let clockMs = opt.now || Date.UTC(2026, 9, 19, 12, 0, 0);
  F.now = () => clockMs; F.advance = ms => { clockMs += ms; };
  const iso = () => new Date(clockMs).toISOString();
  const db = F.db = { shows: [], versions: [], settings: [], workspace: [], media: [] };
  const objects = F.objects = new Map();   // 'uid/sha.ext' -> {bytes:Uint8Array, mime}
  const queue = [];   // fault queue: {re, kind:'fail'|'drop', status, body}
  F.failNext = (re, r) => queue.push({ re, kind: 'fail', status: (r && r.status) || 500, body: (r && r.body) || { message: 'fake failure' } });
  F.dropResponseNext = re => queue.push({ re, kind: 'drop' });
  F.token = uid => 'tok_' + uid;
  const userOf = h => { const a = (h && (h.Authorization || h.authorization)) || '', m = /^Bearer tok_(.+)$/.exec(a); return m ? m[1] : null; };
  const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });
  const bad = (a, b) => ({ ok: false, status: a, ...b });
  const uuid = () => nodeCrypto.randomUUID();

  /* ---------- document validation (server side) ---------- */
  function checkDoc(doc, uid) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return bad('invalid', { code: 'doc_invalid', message: 'document must be an object' });
    const bytes = Buffer.byteLength(stable(doc));
    if (bytes > MAX_DOC) return bad('invalid', { code: 'doc_too_large', message: 'document too large', bytes, max_bytes: MAX_DOC });
    if (doc.cloud_schema !== 1) return bad('invalid', { code: 'schema_unsupported', message: 'cloud_schema must be 1' });
    if (typeof doc.name !== 'string' || doc.name.length > 200) return bad('invalid', { code: 'doc_invalid', message: 'name' });
    if (!Array.isArray(doc.scenes) || doc.scenes.length < 1 || doc.scenes.length > 300) return bad('invalid', { code: 'doc_invalid', message: 'scenes' });
    for (const s of doc.scenes) if (!s || typeof s.id !== 'string' || s.id.length > 64 || typeof s.duration !== 'number') return bad('invalid', { code: 'doc_invalid', message: 'scene' });
    const assets = doc.assets === undefined ? {} : doc.assets;
    if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return bad('invalid', { code: 'doc_invalid', message: 'assets' });
    const refs = []; let localOnly = 0;
    for (const id of Object.keys(assets)) {
      const a = assets[id];
      if (typeof a === 'string' && /^data:/i.test(a)) return bad('invalid', { code: 'embedded_data_not_allowed', message: 'asset ' + id });
      if (!a || typeof a !== 'object') return bad('invalid', { code: 'doc_invalid', message: 'asset ' + id });
      if (JSON.stringify(a).includes('data:')) return bad('invalid', { code: 'embedded_data_not_allowed', message: 'asset ' + id });
      const hasMedia = a.media !== undefined, hasLocal = a.local_only !== undefined;
      if (hasMedia === hasLocal) return bad('invalid', { code: 'doc_invalid', message: 'asset ' + id + ' must be exactly one of media / local_only' });
      if (hasMedia) {
        const m = /^sha256:([0-9a-f]{64})$/.exec(String(a.media));
        if (!m || !db.media.some(r => r.user_id === uid && r.sha256 === m[1])) return bad('invalid', { code: 'media_not_registered', message: 'asset ' + id });
        refs.push(m[1]);
      } else {
        if (a.local_only !== true || !LOCAL_REASONS.includes(a.reason)) return bad('invalid', { code: 'local_only_reason_invalid', message: 'asset ' + id });
        localOnly++;
      }
    }
    return { ok: true, bytes, refs: [...new Set(refs)], localOnly };
  }
  const successOf = (row, extra) => ({ ok: true, show_id: row.id, rev: row.rev, updated_at: row.updated_at, version_created: false, replayed: false, doc_bytes: row.doc_bytes, media_state: row.local_only_image_count ? 'incomplete' : 'complete', local_only_image_count: row.local_only_image_count, ...extra });

  function prune(showId) {
    const vs = db.versions.filter(v => v.show_id === showId).sort((a, b) => b.rev - a.rev), keep = new Set();
    vs.filter(v => v.protected).forEach(v => keep.add(v.id));
    vs.slice(0, 30).forEach(v => keep.add(v.id));
    const today = new Date(clockMs); today.setUTCHours(0, 0, 0, 0);
    for (let d = 0; d < 14; d++) { const lo = today.getTime() - d * 86400000, hi = lo + 86400000, day = vs.find(v => Date.parse(v.created_at) >= lo && Date.parse(v.created_at) < hi); if (day) keep.add(day.id); }
    db.versions = db.versions.filter(v => v.show_id !== showId || keep.has(v.id));
  }
  function addVersion(row, reason, prot, meta) {
    const ex = db.versions.find(v => v.show_id === row.id && v.rev === row.rev);
    if (ex) { if (prot) ex.protected = true; return ex; }
    const v = { id: uuid(), show_id: row.id, user_id: row.user_id, rev: row.rev, doc: clone(row.doc), doc_hash: row.doc_hash, reason, protected: !!prot, name: row.name, scene_count: row.scene_count, doc_bytes: row.doc_bytes, device_id: row.device_id, device_name: row.device_name, restored_from_rev: (meta && meta.restored_from_rev) || null, note: (meta && meta.note) || null, created_at: iso() };
    db.versions.push(v); return v;
  }

  /* ---------- RPCs ---------- */
  const rpc = {
    wx_studio_save_show(uid, a) {
      const { p_show_id, p_base_rev, p_doc, p_device_id, p_device_name, p_reason, p_schema_version, p_op_id } = a, meta = a.p_meta || {};
      if (!UUID.test(String(p_show_id)) || !UUID.test(String(p_op_id))) return bad('invalid', { code: 'doc_invalid', message: 'ids must be uuid' });
      if (!REASONS.includes(p_reason)) return bad('invalid', { code: 'reason_invalid', message: p_reason });
      if (!Number.isInteger(p_base_rev) || p_base_rev < 0) return bad('invalid', { code: 'base_rev_invalid', message: 'base rev' });
      if (typeof p_device_id !== 'string' || !p_device_id || p_device_id.length > 64) return bad('invalid', { code: 'doc_invalid', message: 'device id' });
      if (p_schema_version !== 1 || (p_doc && p_doc.cloud_schema !== p_schema_version)) return bad('invalid', { code: 'schema_unsupported', message: 'schema' });
      const row = db.shows.find(r => r.id === p_show_id);
      if (row && row.user_id !== uid) return bad('not_found', { message: 'show not found' });
      const chk = checkDoc(p_doc, uid); if (!chk.ok) return chk;
      const hash = sha(stable(p_doc));
      // 1. replay check — before the revision check
      if (row && row.last_op_id === p_op_id) {
        if (row.last_op_hash !== hash) return bad('invalid', { code: 'op_id_reused', message: 'operation id reused with different content' });
        return successOf(row, { status: row.rev === 1 && row.created_by_op === p_op_id ? 'created' : 'saved', replayed: true });
      }
      if (row && row.deleted_at) return bad('invalid', { code: 'show_deleted', message: 'show is deleted' });
      const conflict = r => bad('conflict', { show_id: r.id, current_rev: r.rev, updated_at: r.updated_at, device_id: r.device_id, device_name: r.device_name, name: r.name, scene_count: r.scene_count, last_op_id: r.last_op_id, current_doc_hash: r.doc_hash });
      if (p_base_rev === 0) {
        if (row) return conflict(row);
        const n = { id: p_show_id, user_id: uid, name: p_doc.name, doc: clone(p_doc), doc_hash: hash, doc_bytes: chk.bytes, media_refs: chk.refs, local_only_image_count: chk.localOnly, schema_version: 1, rev: 1, device_id: p_device_id, device_name: p_device_name || '', scene_count: p_doc.scenes.length, created_at: iso(), updated_at: iso(), deleted_at: null, last_op_id: p_op_id, last_op_hash: hash, created_by_op: p_op_id };
        db.shows.push(n); addVersion(n, p_reason, ['import', 'restore', 'overwrite'].includes(p_reason), meta); prune(n.id);
        return successOf(n, { status: 'created', version_created: true });
      }
      if (!row) return bad('not_found', { message: 'show not found' });
      if (row.rev !== p_base_rev) return conflict(row);                 // base rev is checked BEFORE 'unchanged'
      if (row.doc_hash === hash) return successOf(row, { status: 'unchanged' });
      let vCreated = false;
      if (p_reason === 'overwrite') addVersion(row, 'pre-overwrite', true, {});   // preserve exactly the document being replaced
      const newest = db.versions.filter(v => v.show_id === row.id).sort((x, y) => y.rev - x.rev)[0];
      Object.assign(row, { name: p_doc.name, doc: clone(p_doc), doc_hash: hash, doc_bytes: chk.bytes, media_refs: chk.refs, local_only_image_count: chk.localOnly, rev: row.rev + 1, device_id: p_device_id, device_name: p_device_name || '', scene_count: p_doc.scenes.length, updated_at: iso(), last_op_id: p_op_id, last_op_hash: hash });
      if (p_reason !== 'autosave' || !newest || clockMs - Date.parse(newest.created_at) >= VERSION_GAP) { addVersion(row, p_reason, ['import', 'restore', 'overwrite'].includes(p_reason), meta); vCreated = true; }
      prune(row.id);
      return successOf(row, { status: 'saved', version_created: vCreated });
    },
    wx_studio_delete_show(uid, a) { return setDeleted(uid, a, true); },
    wx_studio_undelete_show(uid, a) { return setDeleted(uid, a, false); },
    wx_studio_save_settings(uid, a) {
      const patch = a.p_patch; if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return bad('invalid', { code: 'doc_invalid', message: 'patch' });
      let row = db.settings.find(r => r.user_id === uid); const next = Object.assign({}, row ? row.settings : {}), applied = [], ignored = [];
      for (const k of Object.keys(patch)) {
        const v = patch[k];
        if (!SETTINGS_KEYS.includes(k)) { ignored.push({ key: k, code: 'key_not_allowed' }); continue; }
        if (k === 'wx.mapbox.token' && v !== null && !(typeof v === 'string' && /^pk\.[A-Za-z0-9._-]+$/.test(v))) { ignored.push({ key: k, code: /^sk\./.test(String(v)) ? 'secret_token_rejected' : 'invalid_value' }); continue; }
        if (v === null) { delete next[k]; applied.push(k); continue; }
        if (Buffer.byteLength(JSON.stringify(v)) > MAX_SETTING) { ignored.push({ key: k, code: 'value_too_large' }); continue; }
        next[k] = v; applied.push(k);
      }
      if (Buffer.byteLength(JSON.stringify(next)) > MAX_SETTINGS) return bad('invalid', { code: 'settings_too_large', message: 'settings document too large' });
      if (!row) { row = { user_id: uid, settings: {}, rev: 0, updated_at: iso() }; db.settings.push(row); }
      if (applied.length) { row.settings = next; row.rev += 1; row.updated_at = iso(); }
      return { ok: true, status: 'saved', rev: row.rev, updated_at: row.updated_at, applied, ignored };
    },
    wx_studio_set_workspace(uid, a) {
      const { p_device_id, p_device_name, p_show_id, p_scene_id } = a;
      if (typeof p_device_id !== 'string' || !p_device_id || p_device_id.length > 64) return bad('invalid', { code: 'doc_invalid', message: 'device id' });
      const show = db.shows.find(r => r.id === p_show_id && r.user_id === uid && !r.deleted_at); if (!show) return bad('not_found', { message: 'show not found' });
      if (p_scene_id !== null && p_scene_id !== undefined && (typeof p_scene_id !== 'string' || p_scene_id.length > 64)) return bad('invalid', { code: 'doc_invalid', message: 'scene id' });
      let w = db.workspace.find(r => r.user_id === uid && r.device_id === p_device_id);
      if (!w) { w = { user_id: uid, device_id: p_device_id }; db.workspace.push(w); }
      Object.assign(w, { device_name: p_device_name || '', show_id: p_show_id, scene_id: p_scene_id || null, updated_at: iso() });
      return { ok: true, status: 'saved', updated_at: w.updated_at };
    },
    wx_studio_register_media(uid, a) {
      const { p_sha256, p_kind, p_mime, p_size_bytes, p_name, p_width, p_height } = a;
      if (!/^[0-9a-f]{64}$/.test(String(p_sha256))) return bad('invalid', { code: 'bad_hash' });
      if (p_kind !== 'image') return bad('invalid', { code: 'kind_not_allowed' });
      if (!MIMES[p_mime]) return bad('invalid', { code: 'mime_not_allowed' });
      if (!Number.isInteger(p_size_bytes) || p_size_bytes <= 0 || p_size_bytes > MAX_IMG) return bad('invalid', { code: 'too_large' });
      const path = uid + '/' + p_sha256 + '.' + MIMES[p_mime], obj = objects.get(path);
      const ex = db.media.find(r => r.user_id === uid && r.sha256 === p_sha256);
      if (ex) { if (ex.mime !== p_mime || ex.kind !== p_kind || ex.size_bytes !== p_size_bytes) return bad('invalid', { code: 'conflicts_with_existing' }); return { ok: true, status: 'exists', sha256: p_sha256, storage_path: ex.storage_path }; }
      if (!obj) return bad('invalid', { code: 'object_missing' });
      if (obj.bytes.length !== p_size_bytes || obj.mime !== p_mime) return bad('invalid', { code: 'metadata_mismatch' });
      db.media.push({ id: uuid(), user_id: uid, sha256: p_sha256, kind: p_kind, mime: p_mime, size_bytes: p_size_bytes, width: p_width || null, height: p_height || null, name: String(p_name || '').slice(0, 120), storage_path: path, created_at: iso() });
      return { ok: true, status: 'registered', sha256: p_sha256, storage_path: path };
    }
  };
  function setDeleted(uid, a, del) {
    const row = db.shows.find(r => r.id === a.p_show_id);
    if (!row || row.user_id !== uid) return bad('not_found', { message: 'show not found' });
    if (!Number.isInteger(a.p_base_rev) || row.rev !== a.p_base_rev) return bad('conflict', { current_rev: row.rev, updated_at: row.updated_at, device_name: row.device_name });
    if (del && row.deleted_at) return bad('invalid', { code: 'show_deleted', message: 'already deleted' });
    if (!del && !row.deleted_at) return bad('invalid', { code: 'not_deleted', message: 'show is not deleted' });
    row.deleted_at = del ? iso() : null; row.rev += 1; row.updated_at = iso();
    return { ok: true, status: del ? 'deleted' : 'restored', show_id: row.id, rev: row.rev, updated_at: row.updated_at };
  }

  /* ---------- table SELECT with owner-restricted RLS ---------- */
  const TABLES = { wx_studio_shows: 'shows', wx_studio_show_versions: 'versions', wx_studio_user_settings: 'settings', wx_studio_workspace: 'workspace', wx_studio_media: 'media' };
  const SELECTABLE = {
    shows: ['id', 'name', 'rev', 'scene_count', 'doc_bytes', 'schema_version', 'device_id', 'device_name', 'created_at', 'updated_at', 'deleted_at', 'doc', 'media_refs'],
    versions: ['id', 'show_id', 'rev', 'reason', 'protected', 'name', 'scene_count', 'doc_bytes', 'doc_hash', 'device_id', 'device_name', 'restored_from_rev', 'note', 'created_at', 'doc'],
    settings: ['settings', 'rev', 'updated_at'], workspace: ['device_id', 'device_name', 'show_id', 'scene_id', 'updated_at'],
    media: ['sha256', 'kind', 'mime', 'size_bytes', 'width', 'height', 'name', 'storage_path', 'created_at']
  };
  function select(uid, table, params) {
    const key = TABLES[table]; if (!key) return { status: 404, body: { message: 'no such table' } };
    let rows = db[key].filter(r => r.user_id === uid);
    const cols = (params.get('select') || '*').split(',').map(s => s.trim()), allowed = SELECTABLE[key];
    for (const c of cols) if (c !== '*' && !allowed.includes(c)) return { status: 400, body: { message: 'column ' + c + ' does not exist (or is not selectable)' } };
    for (const [k, v] of params.entries()) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      const m = /^(eq|is|not\.is|neq)\.(.*)$/.exec(v); if (!m) return { status: 400, body: { message: 'bad filter' } };
      rows = rows.filter(r => { const x = r[k]; if (m[1] === 'eq') return String(x) === m[2]; if (m[1] === 'neq') return String(x) !== m[2]; const isNull = x === null || x === undefined; return m[1] === 'is' ? (m[2] === 'null' ? isNull : !isNull) : (m[2] === 'null' ? !isNull : isNull); });
    }
    const ord = params.get('order'); if (ord) { const [c, d] = ord.split('.'); rows = rows.slice().sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (d === 'desc' ? -1 : 1)); }
    const lim = +params.get('limit'); if (lim) rows = rows.slice(0, lim);
    return { status: 200, body: rows.map(r => { const o = {}; (cols.includes('*') ? allowed.filter(c => c !== 'doc') : cols).forEach(c => { o[c] = r[c] === undefined ? null : clone(r[c]); }); return o; }) };
  }

  /* ---------- storage ---------- */
  async function storage(uid, method, path, headers, body) {
    const m = /^\/storage\/v1\/object\/(authenticated\/)?([^/]+)\/(.+)$/.exec(path); if (!m) return { status: 404, body: { message: 'bad storage path' } };
    const bucket = m[2], key = decodeURIComponent(m[3]);
    if (bucket !== 'wx-studio-media') return { status: 404, body: { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' } };
    if (!key.startsWith(uid + '/')) return { status: 403, body: { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' } };
    if (method === 'POST') {
      const mime = (headers['content-type'] || headers['Content-Type'] || '').split(';')[0];
      if (!MIMES[mime]) return { status: 415, body: { statusCode: '415', error: 'invalid_mime_type', message: 'mime type ' + mime + ' is not supported' } };
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (bytes.length > MAX_IMG) return { status: 413, body: { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' } };
      if (objects.has(key) && !(headers['x-upsert'] === 'true')) return { status: 400, body: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } };
      const used = [...objects.values()].reduce((s, o) => s + o.bytes.length, 0);
      if (used + bytes.length > F.quotaBytes) return { status: 413, body: { statusCode: '413', error: 'exceed_storage_size_quota', message: 'Storage quota exceeded' } };
      objects.set(key, { bytes, mime }); return { status: 200, body: { Key: 'wx-studio-media/' + key } };
    }
    if (method === 'GET') { const o = objects.get(key); if (!o) return { status: 404, body: { statusCode: '404', error: 'not_found', message: 'Object not found' } }; return { status: 200, raw: o.bytes, mime: o.mime }; }
    return { status: 405, body: { message: 'method not allowed' } };
  }

  /* ---------- fetch ---------- */
  F.fetch = async function (url, opts) {
    opts = opts || {}; const u = new URL(url), headers = opts.headers || {}, method = (opts.method || 'GET').toUpperCase(), path = decodeURIComponent(u.pathname) === u.pathname ? u.pathname : u.pathname;
    F.calls.push({ method, path: u.pathname + u.search, body: opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : undefined });
    if (F.faults.offline) throw new TypeError('Failed to fetch');
    const qi = queue.findIndex(q => q.re.test(u.pathname)); let dropAfter = false;
    if (qi >= 0) { const q = queue.splice(qi, 1)[0]; if (q.kind === 'fail') return json(q.body, q.status); dropAfter = true; }
    const uid = userOf(headers);
    if (!uid) return json({ message: 'Invalid or missing JWT', code: 'PGRST301' }, 401);
    let out;
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = u.pathname.slice('/rest/v1/rpc/'.length);
      if (!rpc[fn]) out = { status: 404, body: { message: 'function ' + fn + ' not found' } };
      else out = { status: 200, body: rpc[fn](uid, opts.body ? JSON.parse(opts.body) : {}) };
    } else if (u.pathname.startsWith('/rest/v1/')) {
      if (method !== 'GET') out = { status: 403, body: { code: '42501', message: 'direct writes are not permitted' } };
      else out = select(uid, u.pathname.slice('/rest/v1/'.length), u.searchParams);
    } else if (u.pathname.startsWith('/storage/v1/')) out = await storage(uid, method, u.pathname, headers, opts.body);
    else out = { status: 404, body: { message: 'not found' } };
    if (dropAfter) throw new TypeError('Failed to fetch');   // executed on the server, response lost
    if (out.raw) return new Response(out.raw, { status: out.status, headers: { 'content-type': out.mime } });
    return json(out.body, out.status);
  };
  return F;
}
module.exports = { createFakeSupabase, stable, sha };
