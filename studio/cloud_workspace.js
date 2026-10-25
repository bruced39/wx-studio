/* WX Studio – cloud workspace sync engine (v0.10.2).  Contract: docs/CLOUD_WORKSPACE_CONTRACT.md.
 *
 * Local first: the editor's normal autosave is untouched and always works. This engine mirrors the working show, the last scene,
 * a short whitelist of settings and imported images to the user's own Supabase rows/bucket, using only the PUBLIC key and the
 * signed-in user's session from cloud_presets.js. No secret ever reaches the browser. Everything here is independent of the DOM so it is
 * tested in Node against tests/helpers/fake_supabase.js; the dialogs live in cloud_workspace_ui.js.
 *
 * Guarantees (enforced in code and tests):
 *  - a failed/offline sync never changes or replaces the local show;
 *  - the document is published only after its images are uploaded + registered, or marked local-only (never a dangling reference);
 *  - a valid cloud image reference is never replaced by a local-only marker because this computer has not downloaded the image;
 *  - a newer cloud revision is never overwritten silently (conflict dialog; "keep mine" is explicit and uses the latest revision);
 *  - lost-response retries reuse the operation id and are recognised only when the cloud document equals what was sent.          */
(function (g) {
  'use strict';
  const CW = {};
  const MAX_IMAGE = 8 * 1048576, DEBOUNCE = 3000, BACKOFF = [5000, 10000, 20000, 40000, 80000, 160000, 300000];
  const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const SETTINGS_KEYS = ['wx.mapbox.token', 'wx.mapbox.scale', 'wx.mapbox.nativeScale.v1', 'wx.studio.defaultMap.v1', 'wx_bg_default', 'wx_fxpresets', 'wx_snap', 'wx_ov_opt', 'wx.export.v1'];
  CW.SETTINGS_KEYS = SETTINGS_KEYS; CW.MAX_IMAGE = MAX_IMAGE;

  /* ---------- small utilities ---------- */
  const subtle = () => (g.crypto && g.crypto.subtle) || (typeof require === 'function' ? require('node:crypto').webcrypto.subtle : null);
  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  const sha256 = async data => hex(await subtle().digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data));
  const uuid = () => (g.crypto && g.crypto.randomUUID) ? g.crypto.randomUUID() : require('node:crypto').randomUUID();
  const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : (v && typeof v === 'object') ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v);
  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  CW.stable = stable; CW.sha256 = sha256; CW.uuid = uuid;
  function parseDataUrl(s) {
    const m = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(String(s || '')); if (!m) return null;
    let bin; try { bin = atob(m[2].replace(/\s/g, '')); } catch (e) { return null; }
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1].toLowerCase(), bytes };
  }
  function toDataUrl(bytes, mime) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return 'data:' + mime + ';base64,' + btoa(s); }
  CW.parseDataUrl = parseDataUrl; CW.toDataUrl = toDataUrl;
  class CwError extends Error { constructor(code, message, extra) { super(message || code); this.code = code; Object.assign(this, extra || {}); } }
  CW.CwError = CwError;

  /* ---------- key/value store (per-account data lives under u:<uid>:…) ---------- */
  CW.memoryKV = function () { const m = new Map(); return { async get(k) { return m.has(k) ? clone(m.get(k)) : undefined; }, async set(k, v) { m.set(k, clone(v)); }, async del(k) { m.delete(k); }, async keys(prefix) { return [...m.keys()].filter(k => k.startsWith(prefix || '')); }, _m: m }; };
  CW.idbKV = function (name) {
    const open = () => new Promise((res, rej) => { try { const r = indexedDB.open(name || 'wxstudio-cloud', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
    const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => { d.close(); res(q && q.result); }; t.onerror = () => { d.close(); rej(t.error); }; t.onabort = () => { d.close(); rej(t.error); }; }); };
    return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), del: k => tx('readwrite', s => s.delete(k)), keys: async p => ((await tx('readonly', s => s.getAllKeys())) || []).filter(k => String(k).startsWith(p || '')) };
  };

  /* ---------- Supabase REST client (public key + the user's session) ---------- */
  CW.createApi = function (o) {
    const url = String(o.url || '').replace(/\/+$/, ''), key = String(o.key || ''), doFetch = o.fetch || ((u, i) => g.fetch(u, i));
    /* v0.10.2: EVERY request is bounded. Without this a connection that goes quiet (typical right after a laptop/Wi-Fi/offline->online switch) leaves
       the request pending forever; because syncs run one after another, "Sync now" then queued behind it and the spinner never ended.
       A timeout is reported as 'offline' (+ timedOut) – the pending save is KEPT, so the retry re-sends the same operation id (the server replays it
       if it had actually executed, and still answers 'conflict' for a stale base). Nothing local is touched. */
    const setT = o.setTimeout || ((f, ms) => g.setTimeout(f, ms)), clearT = o.clearTimeout || (t => g.clearTimeout(t));
    const limitFor = (init, binary) => {
      if (typeof o.timeoutMs === 'number') return o.timeoutMs;
      const n = init && init.body && (init.body.length || init.body.byteLength) || 0;
      return binary ? 180000 : n > 65536 ? Math.min(600000, 45000 + Math.ceil(n / 20000) * 1000) : 30000;
    };
    async function req(path, init, binary) {
      const ms = limitFor(init, binary), ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timer = null, timedOut = false;
      const limit = new Promise((_, rej) => { timer = setT(() => { timedOut = true; try { ctl && ctl.abort(); } catch (e) { /* ignore */ } rej(new CwError('offline', 'The cloud did not answer within ' + Math.round(ms / 1000) + ' seconds, so the request was stopped. Your changes are safe on this computer; syncing will retry.', { timedOut: true })); }, ms); });
      const run = (async () => {
        const s = await o.getSession(); if (!s || !s.access_token) throw new CwError('auth', 'Sign in to use the cloud workspace.');
        let r;
        try { r = await doFetch(url + path, Object.assign({}, init, ctl ? { signal: ctl.signal } : {}, { headers: Object.assign({ apikey: key, Authorization: 'Bearer ' + s.access_token }, (init && init.headers) || {}) })); }
        catch (e) { throw new CwError('offline', 'The cloud could not be reached.', { cause: e }); }
        const text = binary && r.ok ? null : await r.text().catch(() => '');
        if (!r.ok) { let body = null; try { body = JSON.parse(text); } catch (e) { /* not json */ } throw new CwError(r.status === 401 || r.status === 403 && !(body && /row-level/i.test(body.message || '')) ? 'auth' : 'http', (body && (body.message || body.error || body.msg)) || ('HTTP ' + r.status), { status: r.status, body, text }); }
        if (binary) return new Uint8Array(await r.arrayBuffer());
        return text ? JSON.parse(text) : null;
      })();
      run.catch(() => { /* a request that loses the race must not become an unhandled rejection */ });
      try { return await Promise.race([run, limit]); }
      catch (e) { if (timedOut && e && !e.timedOut) throw new CwError('offline', 'The cloud did not answer in time. Your changes are safe on this computer; syncing will retry.', { timedOut: true, cause: e }); throw e; }
      finally { if (timer !== null) clearT(timer); }
    }
    return {
      rpc: (name, args) => req('/rest/v1/rpc/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }),
      select: (table, q) => req('/rest/v1/' + table + '?' + q, { method: 'GET' }),
      upload: (path, bytes, mime) => req('/storage/v1/object/wx-studio-media/' + path.split('/').map(encodeURIComponent).join('/'), { method: 'POST', headers: { 'Content-Type': mime, 'x-upsert': 'false' }, body: bytes }),
      download: path => req('/storage/v1/object/authenticated/wx-studio-media/' + path.split('/').map(encodeURIComponent).join('/'), { method: 'GET' }, true)
    };
  };
  /* Storage (not RPC) failures → a reason the user can understand. See contract §3. */
  CW.classifyStorageError = function (e) {
    if (!e) return { reason: 'upload_failed' };
    if (e.code === 'offline') return { reason: 'offline' };
    if (e.code === 'auth') return { reason: 'auth' };
    const b = e.body || {}, kind = String(b.error || '').toLowerCase(), msg = String(b.message || e.message || '').toLowerCase(), text = ((e.text || '') + ' ' + msg).toLowerCase(), sc = String(b.statusCode || e.status || '');
    /* An object already stored under this content-addressed path: older Storage answers HTTP 400 "Asset Already Exists", newer answers HTTP 409 "Duplicate" / "The resource already exists".
       Recognised only by those structured names or that specific message — an arbitrary 400 or 409 is NOT treated as "already there". */
    if (kind === 'duplicate' || kind === 'asset already exists' || /\b(resource|asset|object) already exists\b/.test(msg)) return { reason: 'exists' };
    if (/exceed_storage_size_quota|quota/.test(text)) return { reason: 'storage_full', detail: e.message };
    if (sc === '413' || /entitytoolarge|payload too large|exceeded the maximum allowed size/.test(text)) return { reason: 'too_large', detail: e.message };
    return { reason: 'upload_failed', detail: (e.status ? 'HTTP ' + e.status + ': ' : '') + (e.message || '') };
  };

  /* ---------- show <-> cloud document ---------- */
    /* Upload + register one image; resolves {ok:true} or {ok:false, reason}. Network/auth problems THROW (the sync then stays pending). */
  async function ensureUploaded(ctx, sha, bytes, mime, name) {
    const known = ctx.known; if (known.has(sha)) return { ok: true };
    const rows = await ctx.api.select('wx_studio_media', 'select=sha256,size_bytes,mime&sha256=eq.' + sha);
    if (rows && rows.length) { if (rows[0].size_bytes === bytes.length) { known.add(sha); return { ok: true }; } return { ok: false, reason: 'upload_failed', detail: 'registered media with this hash has a different size' }; }
    const path = ctx.uid + '/' + sha + '.' + IMG_EXT[mime];
    try { await ctx.api.upload(path, bytes, mime); }
    catch (e) {
      const c = CW.classifyStorageError(e);
      if (c.reason === 'offline' || c.reason === 'auth') throw e;
      if (c.reason === 'too_large') return { ok: false, reason: 'too_large', detail: c.detail };
      if (c.reason !== 'exists') return { ok: false, reason: 'upload_failed', detail: c.reason === 'storage_full' ? 'cloud storage is full' : c.detail };
      /* An object is already stored at this content-addressed path (an earlier upload that was never registered). The registration RPC only checks its size / MIME /
         owner, so read the stored bytes back and check their SHA-256 before trusting it. A mismatch is never "fixed" by overwriting. */
      let stored; try { stored = await ctx.api.download(path); }
      catch (e2) { if (e2.code === 'offline' || e2.code === 'auth') throw e2; return { ok: false, reason: 'upload_failed', detail: 'the image already in cloud storage could not be read back to verify it (' + (e2.message || e2.code) + ')' }; }
      if ((await sha256(stored)) !== sha) return { ok: false, reason: 'upload_failed', final: true, detail: 'a different file is already stored at this image’s cloud path (left untouched); your local image is kept' };
    }
    const r = await ctx.api.rpc('wx_studio_register_media', { p_sha256: sha, p_kind: 'image', p_mime: mime, p_size_bytes: bytes.length, p_name: String(name || '').slice(0, 120), p_width: null, p_height: null });
    if (r && r.ok) { known.add(sha); return { ok: true }; }
    if (r && r.status === 'unauthenticated') throw new CwError('auth', 'Sign in again.');
    const code = r && r.code;
    return { ok: false, reason: code === 'mime_not_allowed' ? 'mime_not_allowed' : 'upload_failed', detail: code || (r && r.message) };   // media_invalid | media_conflict | object_missing | object_mismatch → kept local, reported
  }
  /* local show -> cloud document. Images are uploaded first; the result never contains data URLs. */
  CW.buildCloudDoc = async function (ctx) {
    const show = ctx.show, rest = Object.assign({}, show); delete rest.assets; const doc = clone(rest); doc.cloud_schema = 1; if (doc.v === undefined) doc.v = 1;
    if (typeof doc.name !== 'string') doc.name = 'My Weather Show'; doc.name = doc.name.slice(0, 200);
    const assets = {}, issues = [], bi = ctx.builtin || {}, biDoc = {};
    /* Bundled artwork (default sky, 7-day template, headline / storm backgrounds) ships inside the app: it is never uploaded. An image is treated as bundled only
       when its id is a known bundled id AND its bytes match the bundled copy; a custom image that merely reuses such an id is uploaded like any other image. */
    const builtinSha = async id => { const k = 'builtin:' + id; if (!(k in ctx.hashMemo)) { const bp = typeof bi[id] === 'string' ? parseDataUrl(bi[id]) : null; ctx.hashMemo[k] = bp ? await sha256(bp.bytes) : null; } return ctx.hashMemo[k]; };
    for (const id of Object.keys(show.assets || {})) {
      const data = show.assets[id], mk = typeof data === 'string' ? id + '|' + data.length + '|' + data.slice(0, 64) + '|' + data.slice(-64) : '';
      if (bi[id] && data === bi[id]) { const bs = await builtinSha(id); if (bs) { biDoc[id] = bs; continue; } }
      let m = mk ? ctx.hashMemo[mk] : null, p = null;       // images are decoded and hashed once, not on every autosave
      if (!m) {
        p = parseDataUrl(data);
        if (!p) { if (ctx.placeholders[id]) continue; assets[id] = { local_only: true, reason: 'unavailable', mime: 'image/png', bytes: 0, source_device_id: ctx.deviceId }; issues.push({ id, reason: 'unavailable' }); continue; }
        m = { mime: p.mime, bytes: p.bytes.length }; if (IMG_EXT[m.mime] && m.bytes <= MAX_IMAGE) m.sha = await sha256(p.bytes); ctx.hashMemo[mk] = m;
      }
      if (bi[id] && m.sha && m.sha === await builtinSha(id)) { biDoc[id] = m.sha; continue; }
      const entry = { mime: m.mime, bytes: m.bytes };
      if (!IMG_EXT[m.mime]) { assets[id] = { local_only: true, reason: 'mime_not_allowed', ...entry, source_device_id: ctx.deviceId }; issues.push({ id, reason: 'mime_not_allowed' }); continue; }
      if (m.bytes > MAX_IMAGE) { assets[id] = { local_only: true, reason: 'too_large', ...entry, source_device_id: ctx.deviceId }; issues.push({ id, reason: 'too_large' }); continue; }
      const sha = m.sha, prior = ctx.failed[sha];
      let res;
      if (prior && (prior.final || prior.reason === 'too_large' || prior.reason === 'mime_not_allowed')) res = prior;
      else if (ctx.known.has(sha)) res = { ok: true };
      else { p = p || parseDataUrl(data); res = await ensureUploaded(ctx, sha, p.bytes, m.mime, id); }
      if (res.ok) { delete ctx.failed[sha]; assets[id] = { media: 'sha256:' + sha, ...entry }; if (ctx.placeholders[id]) delete ctx.placeholders[id]; }
      else { ctx.failed[sha] = { reason: res.reason, detail: res.detail, final: !!res.final }; assets[id] = { local_only: true, reason: res.reason, ...entry, source_device_id: ctx.deviceId }; issues.push({ id, reason: res.reason, detail: res.detail }); }
    }
    // Unresolved references this computer has no bytes for are carried forward untouched (never turned into a local-only marker, never dropped).
    for (const id of Object.keys(ctx.placeholders || {})) if (!(id in assets) && !((show.assets || {})[id] && parseDataUrl(show.assets[id]))) assets[id] = ctx.placeholders[id];
    doc.assets = assets; if (Object.keys(biDoc).length) doc.builtinAssets = biDoc; else delete doc.builtinAssets;
    const lom = ctx.localOnlyMedia ? ctx.localOnlyMedia() : []; if (lom.length) doc.localOnlyMedia = lom; else delete doc.localOnlyMedia;
    return { doc, issues };
  };
  /* cloud document -> local show: downloads + verifies images. Anything unavailable stays a placeholder (returned, never dropped). */
  CW.hydrateDoc = async function (ctx, doc) {
    const show = clone(doc); delete show.cloud_schema; const lom = show.localOnlyMedia || []; delete show.localOnlyMedia;
    const assets = {}, placeholders = {}, missing = [], have = ctx.existingAssets || {}; show.assets = assets;
    /* Bundled artwork: re-attached from this app's own copy (never downloaded). If this build lacks it, or carries different artwork, say so. */
    const bi = ctx.builtin || {}, recorded = doc.builtinAssets || {}; delete show.builtinAssets;
    for (const id of Object.keys(recorded)) {
      const bp = typeof bi[id] === 'string' ? parseDataUrl(bi[id]) : null;
      if (!bp) { missing.push({ id, reason: 'builtin_missing' }); continue; }
      assets[id] = bi[id]; if (recorded[id] && (await sha256(bp.bytes)) !== recorded[id]) missing.push({ id, reason: 'builtin_changed' });
    }
    const ids = Object.keys(doc.assets || {}); let next = 0;
    const work = async () => {
      while (next < ids.length) {
        const id = ids[next++], a = doc.assets[id];
        if (a.local_only) { if (a.source_device_id && a.source_device_id === ctx.deviceId && have[id]) { assets[id] = have[id]; } else { placeholders[id] = a; missing.push({ id, reason: a.reason, source_device_id: a.source_device_id }); } continue; }
        const sha = String(a.media).replace(/^sha256:/, '');
        const local = have[id] && parseDataUrl(have[id]); if (local && (await sha256(local.bytes)) === sha) { assets[id] = have[id]; continue; }
        try {
          const bytes = await ctx.api.download(ctx.uid + '/' + sha + '.' + (IMG_EXT[a.mime] || 'png'));
          if ((await sha256(bytes)) !== sha) { placeholders[id] = a; missing.push({ id, reason: 'hash_mismatch' }); continue; }
          assets[id] = toDataUrl(bytes, a.mime);
        } catch (e) { if (e.code === 'offline' || e.code === 'auth') throw e; placeholders[id] = a; missing.push({ id, reason: 'download_failed', detail: e.message }); }
      }
    };
    await Promise.all([work(), work(), work()]);
    return { show, placeholders, missing, localOnlyMedia: lom };
  };

  /* ---------- the engine ---------- */
  CW.createEngine = function (o) {
    const api = o.api, kv = o.kv, host = o.host, now = o.now || (() => Date.now()), timers = o.timers || { set: (f, ms) => setTimeout(f, ms), clear: t => clearTimeout(t) };
    const debounce = o.debounceMs == null ? DEBOUNCE : o.debounceMs, backoff = o.backoff || BACKOFF;
    const E = { deviceId: o.deviceId, deviceName: o.deviceName || 'This computer', listeners: [] };
    let uid = null, rec = null, timer = null, running = null, seq = 0, attempts = 0, state = 'signedout', lastError = null, lastIssues = [], hashMemo = {}, failed = {}, known = new Set(), baseDoc = null, tickT = null, wsSent = '';
    const emit = (type, data) => E.listeners.slice().forEach(f => { try { f(type, data); } catch (e) { /* listener errors never break sync */ } });
    E.on = f => { E.listeners.push(f); return () => { E.listeners = E.listeners.filter(x => x !== f); }; };
    const K = n => 'u:' + uid + ':' + n;
    const blank = () => ({ showId: null, baseRev: 0, baseKey: '', dirty: false, pending: null, recentOps: [], unacked: [], lastSyncedAt: null, placeholders: {}, localOnlyImages: 0, mediaState: null, nextReason: 'autosave', nextMeta: null, remoteNewer: null, remoteDeleted: false, conflict: null, claim: null, settingsRev: 0, settingsSent: {}, settingsInit: false, settingsIgnored: [], lastWs: '' });
    const save = () => kv.set(K('sync'), rec);
    const sessionUid = async () => { const s = await o.auth.session(); return s && s.user && s.user.id ? s.user.id : null; };
    const ctx = () => ({ api, uid, deviceId: E.deviceId, show: host.getShow(), placeholders: rec.placeholders, baseAssets: baseDoc && baseDoc.assets, hashMemo, failed, known, localOnlyMedia: host.localOnlyMedia, builtin: host.builtinAssets ? host.builtinAssets() : null });
    const setState = (s, err) => { state = s; lastError = err || null; emit('status', E.status()); };

    /* ----- status (exactly one of the contract states) ----- */
    E.status = function () {
      const lom = host.localOnlyMedia ? host.localOnlyMedia().length : 0, ph = rec ? Object.keys(rec.placeholders).length : 0, li = rec ? rec.localOnlyImages : 0;
      const parts = []; if (li) parts.push(li + ' image' + (li > 1 ? 's' : '')); if (ph) parts.push(ph + ' image' + (ph > 1 ? 's' : '') + ' not on this computer'); if (lom) parts.push(lom + ' video/GIF/audio');
      const base = { state, signedIn: !!uid, uid, error: lastError, incomplete: parts.length > 0, mediaNotes: parts, deviceName: E.deviceName, rev: rec && rec.baseRev, showId: rec && rec.showId, remoteNewer: rec && rec.remoteNewer, conflict: rec && rec.conflict, lastSyncedAt: rec && rec.lastSyncedAt, dirty: !!(rec && rec.dirty), pending: !!(rec && rec.pending), issues: lastIssues.map(i => ({ id: i.id, reason: i.reason, detail: i.detail })), localOnlyImages: (rec && rec.localOnlyImages) || 0 };
      if (!uid) return Object.assign(base, { label: 'Saved locally', kind: 'local' });
      if (state === 'conflict') return Object.assign(base, { label: 'Conflict – choose', kind: 'conflict' });
      if (state === 'failed') return Object.assign(base, { label: 'Sync failed', kind: 'failed' });
      if (state === 'offline') return Object.assign(base, { label: 'Offline – saved locally', kind: 'offline' });
      if (state === 'paused') return Object.assign(base, { label: 'Cloud paused – saved locally', kind: 'paused' });
      if (state === 'syncing') return Object.assign(base, { label: 'Syncing', kind: 'syncing' });
      if (rec && (rec.dirty || !rec.baseRev)) return Object.assign(base, { label: 'Saved locally', kind: 'local' });
      if (parts.length) return Object.assign(base, { label: 'Cloud document saved – ' + parts.join(', ') + ' only on ' + (E.deviceName || 'this computer'), short: 'Saved · ' + parts.length + ' media local', kind: 'incomplete' });
      return Object.assign(base, { label: 'Saved to cloud', kind: 'cloud' });
    };

    /* ----- account ----- */
    E.attach = async function () {      // call once the session is known (boot, sign-in, sign-out)
      timers.clear(timer); timers.clear(tickT); const was = uid; uid = await sessionUid(); hashMemo = {}; failed = {}; known = new Set(); baseDoc = null; attempts = 0;
      if (!uid) { rec = null; state = 'signedout'; emit('status', E.status()); return; }
      rec = Object.assign(blank(), (await kv.get(K('sync'))) || {}); state = 'idle';
      if (rec.showId) baseDoc = (await kv.get(K('base:' + rec.showId))) || null;
      const k = await kv.get(K('known')); if (Array.isArray(k)) known = new Set(k);
      emit('status', E.status());
      const loop = () => { tickT = timers.set(async () => { try { await E.tick(); } catch (e) { /* ticks never throw */ } loop(); }, o.tickMs || 20000); }; loop();
    };
    E.uid = () => uid; E.record = () => rec; E.baseDoc = () => baseDoc; E.state = () => state;
    E.noteRestore = function () { if (rec) { rec.nextReason = 'restore'; E.markDirty(); } };     // a recent-autosave copy replaced this show: next save is a protected 'restore' version

    /* ----- local changes → debounced sync ----- */
    let seenChg = host.changeSeq ? host.changeSeq() : 0;     // last change counter of the editor that this engine has been told about
    E.markDirty = function () {
      seenChg = host.changeSeq ? host.changeSeq() : seenChg;
      seq++; if (!uid || !rec || state === 'conflict') { return; }
      if (rec.claim === 'later' || o.paused && o.paused()) { return; }
      rec.dirty = true; save();
      if (state === 'idle' || state === 'cloud' || state === 'failed' || state === 'offline') state = 'idle';
      emit('status', E.status()); E.schedule(debounce);
    };
    E.schedule = function (ms) { timers.clear(timer); timer = timers.set(() => { E.syncNow().catch(() => { }); }, ms); };
    E.syncNow = function (opts) { const p = (running || Promise.resolve()).then(() => cycle(opts || {})); running = p.catch(() => { }); return p; };

    async function cycle(opts) {
      if (!uid || !rec) return { ok: false, status: 'signedout' };
      if (rec.conflict || state === 'conflict') return { ok: false, status: 'conflict' };
      if (rec.claim === 'later') return { ok: false, status: 'paused' };
      if (host.changeSeq && host.changeSeq() !== seenChg) { seenChg = host.changeSeq(); rec.dirty = true; }   // the editor changed without telling us: never answer "up to date" from a stale flag
      if (!rec.dirty && !opts.force && !opts.verify && rec.baseRev > 0 && !(lastIssues.some(i => i.reason === 'upload_failed' || i.reason === 'unavailable') && opts.retryMedia)) return { ok: true, status: 'idle' };
      timers.clear(timer); const mySeq = seq; setState('syncing');
      try {
        if (!rec.showId) { rec.showId = uuid(); rec.baseRev = 0; baseDoc = null; rec.nextReason = rec.nextReason === 'autosave' ? (opts.reason || 'manual') : rec.nextReason; }
        const built = await CW.buildCloudDoc(ctx()); lastIssues = built.issues; const doc = built.doc, docStr = stable(doc), docKey = await sha256(docStr);
        await kv.set(K('known'), [...known]);
        if (!opts.force && rec.baseRev > 0 && rec.baseKey === docKey && !rec.pending) { rec.dirty = seq !== mySeq; await save(); setState('idle'); afterSuccess(null); return { ok: true, status: 'unchanged' }; }
        const reason = opts.reason || rec.nextReason || 'autosave';
        if (rec.pending && rec.pending.docKey === docKey && rec.pending.baseRev === rec.baseRev && rec.pending.reason === reason) { /* retry of the same logical operation → same op id */ }
        else {
          if (rec.pending) { rec.unacked = [{ opId: rec.pending.opId, docKey: rec.pending.docKey }].concat(rec.unacked).slice(0, 4); }
          rec.pending = { opId: uuid(), docKey, baseRev: rec.baseRev, reason, meta: rec.nextMeta || {} };
        }
        const pdocs = (await kv.get(K('pdocs'))) || {}; pdocs[rec.pending.opId] = docStr; Object.keys(pdocs).forEach(k => { if (k !== rec.pending.opId && !rec.unacked.some(u => u.opId === k)) delete pdocs[k]; });
        await kv.set(K('pdocs'), pdocs); await save();
        const res = await api.rpc('wx_studio_save_show', { p_show_id: rec.showId, p_base_rev: rec.pending.baseRev, p_doc: doc, p_device_id: E.deviceId, p_device_name: E.deviceName, p_reason: reason, p_schema_version: 1, p_op_id: rec.pending.opId, p_meta: rec.pending.meta });
        return await handleResult(res, doc, docKey, docStr, mySeq);
      } catch (e) { return handleError(e); }
    }
    async function adopt(res, doc, docKey, mySeq) {
      const op = rec.pending && rec.pending.opId; rec.baseRev = res.rev; rec.baseKey = docKey; rec.recentOps = [op].concat(rec.recentOps).slice(0, 8); rec.pending = null; rec.unacked = [];
      rec.lastSyncedAt = res.updated_at || new Date(now()).toISOString(); rec.nextReason = 'autosave'; rec.nextMeta = null; rec.remoteNewer = null;
      rec.localOnlyImages = Object.values(doc.assets || {}).filter(a => a.local_only).length; rec.mediaState = res.media_state || (rec.localOnlyImages ? 'incomplete' : 'complete');
      rec.dirty = seq !== mySeq; baseDoc = doc; attempts = 0; await kv.set(K('base:' + rec.showId), doc); await kv.set(K('pdocs'), {}); await save();
    }
    async function handleResult(res, doc, docKey, docStr, mySeq) {
      if (res && res.ok) { await adopt(res, doc, docKey, mySeq); setState('idle'); afterSuccess(res); return { ok: true, status: res.status, rev: res.rev, replayed: !!res.replayed }; }
      const st = res && res.status;
      if (st === 'conflict') return handleConflict(res, doc, docKey, docStr, mySeq);
      if (st === 'invalid') {
        if (res.code === 'show_deleted') { rec.remoteDeleted = true; await save(); setState('failed', 'This cloud show was deleted from another computer.'); emit('show-deleted', { showId: rec.showId }); return { ok: false, status: 'show_deleted' }; }
        if (res.code === 'media_not_registered') { known.clear(); setState('failed', 'An image is not registered in the cloud yet; retrying.'); E.schedule(backoff[0]); return { ok: false, status: 'retry' }; }
        rec.pending = null; await save(); setState('failed', res.code === 'doc_too_large' ? 'This show is too large for the cloud (' + Math.round((res.bytes || 0) / 1048576 * 10) / 10 + ' MB; limit 8 MB). Your show is safe on this computer.' : (res.message || res.code)); return { ok: false, status: 'invalid', code: res.code };
      }
      if (st === 'not_found' && rec.baseRev > 0) { rec.showId = null; rec.baseRev = 0; rec.pending = null; rec.baseKey = ''; rec.nextReason = 'import'; await save(); emit('notice', 'The cloud copy of this show was not found; it will be saved again as a new cloud show.'); E.schedule(500); return { ok: false, status: 'recreate' }; }
      setState('failed', (res && (res.message || res.status)) || 'Unexpected cloud response'); return { ok: false, status: st || 'error' };
    }
    async function handleConflict(res, doc, docKey, docStr, mySeq) {
      const ops = [rec.pending && rec.pending.opId].concat((rec.unacked || []).map(u => u.opId)).filter(Boolean);
      if (res.last_op_id && ops.includes(res.last_op_id)) {                    // maybe our own save whose response was lost: verify by content
        const pdocs = (await kv.get(K('pdocs'))) || {};
        let row = null; try { row = ((await api.select('wx_studio_shows', 'select=doc,rev&id=eq.' + rec.showId)) || [])[0]; } catch (e) { return handleError(e); }
        if (row && pdocs[res.last_op_id] && stable(row.doc) === pdocs[res.last_op_id] && row.rev === res.current_rev) {
          const same = pdocs[res.last_op_id] === docStr;
          await adopt({ rev: res.current_rev, updated_at: res.updated_at, media_state: null }, JSON.parse(pdocs[res.last_op_id]), same ? docKey : await sha256(pdocs[res.last_op_id]), same ? mySeq : -1);
          rec.dirty = !same || seq !== mySeq; await save(); setState('idle'); afterSuccess(null);
          if (!same) E.schedule(100);   // the document changed again since that save: push the newest
          return { ok: true, status: 'recovered', rev: res.current_rev };
        }
      }
      rec.conflict = { showId: rec.showId, current_rev: res.current_rev, updated_at: res.updated_at, device_id: res.device_id, device_name: res.device_name, name: res.name, scene_count: res.scene_count, current_doc_hash: res.current_doc_hash, at: new Date(now()).toISOString() };
      await save(); setState('conflict'); emit('conflict', rec.conflict); return { ok: false, status: 'conflict' };
    }
    async function handleError(e) {
      if (e && e.code === 'offline') { setState('offline', e.message); retryLater(); return e.timedOut ? { ok: false, status: 'offline', timedOut: true, message: e.message } : { ok: false, status: 'offline' }; }
      if (e && e.code === 'auth') { setState('failed', 'Sign in again to continue syncing. Your show is safe on this computer.'); return { ok: false, status: 'auth' }; }
      setState('failed', (e && e.message) || String(e)); retryLater(); return { ok: false, status: 'error', message: e && e.message };
    }
    function retryLater() { const d = backoff[Math.min(attempts++, backoff.length - 1)]; E.schedule(d); emit('retry', { inMs: d }); }
    function afterSuccess(res) {
      if (lastIssues.some(i => i.reason === 'upload_failed' || i.reason === 'unavailable')) { const d = backoff[Math.min(attempts++, backoff.length - 1)]; timers.clear(timer); timer = timers.set(() => { E.syncNow({ retryMedia: true, force: true }).catch(() => { }); }, d); }
      else if (rec.dirty) E.schedule(100);
      E.pushWorkspace().catch(() => { });
    }

    /* ----- conflict resolution ----- */
    E.resolveConflict = async function (choice) {
      const c = rec && rec.conflict; if (!c) return { ok: false };
      if (choice === 'keep-local') { rec.baseRev = c.current_rev; rec.nextReason = 'overwrite'; rec.pending = null; rec.conflict = null; rec.dirty = true; await save(); setState('idle'); return E.syncNow({ force: true }); }
      if (choice === 'use-cloud') { const r = await E.openShow(c.showId, { reason: 'conflict' }); return r; }
      if (choice === 'keep-both') {
        const nm = String(host.getShow().name || 'My Weather Show'); if (host.renameShow) host.renameShow((nm + ' (' + E.deviceName + ' copy)').slice(0, 200));
        rec.showId = uuid(); rec.baseRev = 0; rec.baseKey = ''; rec.pending = null; rec.conflict = null; rec.nextReason = 'keep-both'; rec.dirty = true; baseDoc = null; await save(); setState('idle'); return E.syncNow({ force: true, reason: 'keep-both' });
      }
      return { ok: false };
    };

    /* ----- opening cloud shows, versions ----- */
    async function fetchDoc(table, id) { const r = ((await api.select(table, 'select=doc,rev,name&id=eq.' + id)) || [])[0]; if (!r) throw new CwError('http', 'That version is no longer available.'); return r; }
    E.openShow = async function (showId, opts) {
      opts = opts || {}; const row = await fetchDoc('wx_studio_shows', showId);
      const h = await CW.hydrateDoc({ api, uid, deviceId: E.deviceId, builtin: host.builtinAssets ? host.builtinAssets() : null, existingAssets: opts.keepAssets === false ? {} : (host.getShow().assets || {}) }, row.doc);
      const cur = rec.showId === showId;
      if (!cur && (rec.dirty || rec.pending) && !opts.skipFlush) { try { await E.syncNow({ force: true }); } catch (e) { /* best effort: local copy is kept by the host safety snapshot */ } }
      await host.loadShow(h.show, { sceneId: opts.sceneId, source: opts.reason || 'cloud', cloud: true });
      rec.showId = showId; rec.baseRev = row.rev; baseDoc = row.doc; rec.baseKey = await sha256(stable(row.doc)); rec.placeholders = h.placeholders; rec.dirty = false; rec.pending = null; rec.conflict = null; rec.remoteNewer = null; rec.remoteDeleted = false; rec.nextReason = 'autosave'; rec.nextMeta = null;
      rec.localOnlyImages = Object.values(row.doc.assets || {}).filter(a => a.local_only).length; rec.mediaState = rec.localOnlyImages ? 'incomplete' : 'complete';
      await kv.set(K('base:' + showId), row.doc); await save(); setState('idle'); E.pushWorkspace().catch(() => { });
      emit('opened', { showId, rev: row.rev, missing: h.missing, localOnlyMedia: h.localOnlyMedia });
      return { ok: true, rev: row.rev, missing: h.missing, localOnlyMedia: h.localOnlyMedia };
    };
    E.listShows = async function (deleted) { return (await api.select('wx_studio_shows', 'select=id,name,rev,scene_count,doc_bytes,schema_version,device_id,device_name,created_at,updated_at,deleted_at&deleted_at=' + (deleted ? 'not.is.null' : 'is.null') + '&order=updated_at.desc&limit=200')) || []; };
    E.listVersions = async function (showId) { return (await api.select('wx_studio_show_versions', 'select=id,show_id,rev,reason,protected,name,scene_count,doc_bytes,doc_hash,device_id,device_name,restored_from_rev,note,created_at&show_id=eq.' + (showId || rec.showId) + '&order=rev.desc&limit=200')) || []; };
    E.restoreVersion = async function (version) {      // restoring creates a NEW revision; the replaced state stays recoverable
      const row = await fetchDoc('wx_studio_show_versions', version.id);
      const h = await CW.hydrateDoc({ api, uid, deviceId: E.deviceId, builtin: host.builtinAssets ? host.builtinAssets() : null, existingAssets: host.getShow().assets || {} }, row.doc);
      await host.loadShow(h.show, { source: 'restore', cloud: true }); rec.placeholders = h.placeholders; rec.nextReason = 'restore'; rec.nextMeta = { restored_from_rev: version.rev }; rec.dirty = true; rec.conflict = null; await save();
      return E.syncNow({ force: true, reason: 'restore' });
    };
    E.deleteShow = async function (showId) {
      const row = ((await api.select('wx_studio_shows', 'select=rev&id=eq.' + showId)) || [])[0]; if (!row) return { ok: false, status: 'not_found' };
      const r = await api.rpc('wx_studio_delete_show', { p_show_id: showId, p_base_rev: row.rev, p_device_id: E.deviceId });
      if (r && r.ok && rec.showId === showId) { rec.remoteDeleted = true; await save(); } return r;
    };
    E.undeleteShow = async function (showId) {
      const row = ((await api.select('wx_studio_shows', 'select=rev&id=eq.' + showId)) || [])[0]; if (!row) return { ok: false, status: 'not_found' };
      const r = await api.rpc('wx_studio_undelete_show', { p_show_id: showId, p_base_rev: row.rev });
      if (r && r.ok && rec.showId === showId) { rec.remoteDeleted = false; rec.baseRev = r.rev; await save(); } return r;
    };
    /* Open-a-file / New: the replaced show was already synced; the next show gets a NEW cloud identity. */
    E.newIdentity = async function (reason) {
      if (!uid || !rec) return; timers.clear(timer);
      /* v0.10.2 fix: do NOT sync here. By now the editor already shows the NEW show, so a sync would write the new (blank / imported) content over the
         PREVIOUS cloud show's current version. The previous show is flushed by the host's beforeReplace hook BEFORE it is replaced (and a local safety copy is
         made); whatever could not be flushed stays in that copy. */
      rec.showId = null; rec.baseRev = 0; rec.baseKey = ''; rec.pending = null; rec.conflict = null; rec.dirty = true; rec.placeholders = {}; rec.localOnlyImages = 0; rec.nextReason = reason || 'import'; rec.nextMeta = null; baseDoc = null; rec.remoteNewer = null; rec.remoteDeleted = false; await save(); state = 'idle'; emit('status', E.status()); E.schedule(debounce);
    };

    /* ----- newer cloud version (notification only) ----- */
    E.checkRemote = async function () {
      if (!uid || !rec || !rec.showId || !rec.baseRev) return null;
      try {
        const r = ((await api.select('wx_studio_shows', 'select=rev,updated_at,device_id,device_name,deleted_at&id=eq.' + rec.showId)) || [])[0]; if (!r) return null;
        if (r.deleted_at && !rec.remoteDeleted) { rec.remoteDeleted = true; await save(); emit('show-deleted', { showId: rec.showId }); }
        if (r.rev > rec.baseRev && !(rec.pending && r.device_id === E.deviceId)) { rec.remoteNewer = { rev: r.rev, updated_at: r.updated_at, device_name: r.device_name, device_id: r.device_id }; await save(); emit('remote-newer', rec.remoteNewer); emit('status', E.status()); }
        return rec.remoteNewer;
      } catch (e) { return null; }
    };
    E.loadRemoteNewer = async function () {
      if (!rec || !rec.remoteNewer) return { ok: false };
      if (rec.dirty || rec.pending) { const r = rec.remoteNewer; rec.conflict = { showId: rec.showId, current_rev: r.rev, updated_at: r.updated_at, device_name: r.device_name, device_id: r.device_id, at: new Date(now()).toISOString() }; await save(); setState('conflict'); emit('conflict', rec.conflict); return { ok: false, status: 'conflict' }; }
      return E.openShow(rec.showId, { reason: 'newer' });
    };

    /* ----- workspace (one row per user AND device) ----- */
    E.pushWorkspace = async function () {
      if (!uid || !rec || !rec.showId || !rec.baseRev) return; const scene = host.getSceneId ? host.getSceneId() : null, sig = rec.showId + '|' + scene;
      if (sig === wsSent) return;
      const r = await api.rpc('wx_studio_set_workspace', { p_device_id: E.deviceId, p_device_name: E.deviceName, p_show_id: rec.showId, p_scene_id: scene ? String(scene).slice(0, 64) : null });
      if (r && r.ok) wsSent = sig;
    };
    /* Decide what to open on sign-in. Returns {action:'none'|'continue'|'opened'|'resume-offer', ...}. Never replaces real local work silently. */
    E.restoreSession = async function () {
      if (!uid || !rec) return { action: 'none' };
      const shows = await E.listShows(false), ws = ((await api.select('wx_studio_workspace', 'select=device_id,device_name,active_show_id,active_scene_id,updated_at&order=updated_at.desc')) || []).map(w => ({ device_id: w.device_id, device_name: w.device_name, show_id: w.active_show_id, scene_id: w.active_scene_id, updated_at: w.updated_at }));
      const alive = id => shows.find(s => s.id === id), real = host.hasRealLocalWork();
      if (rec.showId && alive(rec.showId)) { await E.checkRemote(); return { action: 'continue', showId: rec.showId }; }
      const own = ws.find(w => w.device_id === E.deviceId && alive(w.show_id)), other = ws.find(w => w.device_id !== E.deviceId && alive(w.show_id));
      if (own && !real) { const r = await E.openShow(own.show_id, { sceneId: own.scene_id, reason: 'workspace' }); return { action: 'opened', showId: own.show_id, ...r }; }
      if (own && real) return { action: 'resume-offer', showId: own.show_id, sceneId: own.scene_id, deviceName: own.device_name, own: true, updated_at: own.updated_at };
      if (!real && (other || shows.length)) { const t = other ? other.show_id : shows[0].id, r = await E.openShow(t, { sceneId: other && other.scene_id, reason: 'auto' }); return { action: 'opened', showId: t, ...r }; }
      if (real && (other || shows.length)) { const t = other || { show_id: shows[0].id, device_name: shows[0].device_name, updated_at: shows[0].updated_at }; return { action: 'resume-offer', showId: t.show_id, sceneId: t.scene_id, deviceName: t.device_name, updated_at: t.updated_at }; }
      return { action: 'none' };
    };

    /* ----- settings (whitelist only; per-key last write wins; never secrets) ----- */
    const parseVal = raw => { if (raw === null || raw === undefined) return undefined; try { return JSON.parse(raw); } catch (e) { return raw; } };
    const rawOf = v => (typeof v === 'string' ? v : JSON.stringify(v));
    const norm = raw => (raw === null || raw === undefined) ? '' : stable(parseVal(raw));
    E.pullSettings = async function (opts) {
      if (!uid || !rec) return; opts = opts || {};
      const row = ((await api.select('wx_studio_user_settings', 'select=settings,rev,updated_at')) || [])[0]; const cloud = row ? row.settings || {} : {}, local = host.readSettings(), apply = {};
      if (row && row.rev === rec.settingsRev && rec.settingsInit) return;
      const sent = Object.assign({}, rec.settingsSent);
      for (const k of SETTINGS_KEYS) {
        const has = Object.prototype.hasOwnProperty.call(cloud, k), localChanged = rec.settingsInit && norm(local[k]) !== norm(sent[k]);
        if (has) { if (!localChanged) { if (norm(local[k]) !== stable(cloud[k])) apply[k] = rawOf(cloud[k]); sent[k] = rawOf(cloud[k]); } }
        else if (rec.settingsInit) { if (!localChanged && sent[k] !== undefined && sent[k] !== null) { apply[k] = null; sent[k] = null; } }
        else if (!(rec.claim === 'upload')) sent[k] = local[k] === undefined ? null : local[k];   // first sign-in: do not upload local settings without an explicit decision
      }
      if (Object.keys(apply).length) { if (host.backupSettings) await host.backupSettings(local); host.writeSettings(apply); }
      rec.settingsSent = sent; rec.settingsRev = row ? row.rev : 0; rec.settingsInit = true; await save();
      if (Object.keys(apply).length) emit('settings-applied', Object.keys(apply));
    };
    E.pushSettings = async function () {
      if (!uid || !rec || !rec.settingsInit || rec.claim === 'later') return; const local = host.readSettings(), patch = {};
      for (const k of SETTINGS_KEYS) {
        const l = local[k], s = rec.settingsSent[k]; if (norm(l) === norm(s)) continue;
        if (k === 'wx.mapbox.token' && l && !/^pk\.[A-Za-z0-9._-]+$/.test(String(l).trim())) { rec.settingsSent[k] = l; continue; }   // never send anything that is not a public pk. token
        patch[k] = (l === null || l === undefined) ? null : parseVal(l);
      }
      if (!Object.keys(patch).length) return;
      const r = await api.rpc('wx_studio_save_settings', { p_patch: patch, p_device_id: E.deviceId });
      if (r && r.ok) { (r.applied || []).forEach(k => { rec.settingsSent[k] = local[k] === undefined ? null : local[k]; }); (r.ignored || []).forEach(i => { rec.settingsSent[i.key] = local[i.key] === undefined ? null : local[i.key]; }); rec.settingsIgnored = r.ignored || []; rec.settingsRev = r.rev; await save(); }
      else if (r && r.status === 'invalid') { rec.settingsIgnored = [{ key: '*', code: r.code }]; Object.keys(patch).forEach(k => { rec.settingsSent[k] = local[k] === undefined ? null : local[k]; }); await save(); }
    };
    E.tick = async function () {
      if (!uid || !rec) return;
      if (host.changeSeq && host.changeSeq() !== seenChg) E.markDirty();   // safety net: an edit whose notification never arrived is still synced (and the status stops saying "Saved")
      try { await E.pushSettings(); } catch (e) { /* retried on the next tick */ }
      try { await E.pushWorkspace(); } catch (e) { /* retried */ }
      if (state === 'offline' || state === 'failed') return;
      if (o.isHidden && o.isHidden()) return;       // the periodic "is there a newer version?" SELECT is skipped while the tab is hidden (saves and settings pushes above are not)
      await E.checkRemote();
    };
    /* The tab became visible again: look for a newer cloud version straight away instead of waiting for the next 20 s tick. */
    E.onVisible = async function () { if (!uid || !rec || state === 'offline' || state === 'failed') return; try { await E.checkRemote(); } catch (e) { /* retried on the next tick */ } };
    E.flushOnClose = function () { if (uid && rec && rec.dirty && state !== 'conflict') return E.syncNow({ reason: 'close' }).catch(() => { }); };
    E.setClaim = async function (c) { if (!rec) return; rec.claim = c; await save(); if (c !== 'later') { state = 'idle'; emit('status', E.status()); } };
    E.forget = async function () {        // "clear local account data": drop everything this engine stored for the current account
      if (!uid) return; for (const k of await kv.keys('u:' + uid + ':')) await kv.del(k); rec = null; baseDoc = null; known = new Set();
    };
    return E;
  };

  g.WXCloudWorkspace = CW;
  if (typeof module !== 'undefined') module.exports = CW;
})(typeof window !== 'undefined' ? window : globalThis);
