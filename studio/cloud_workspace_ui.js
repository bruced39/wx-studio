/* WX Studio – cloud workspace interface (v0.10.2): status chip, account / My Shows / Version history, sign-in claim wizard,
   conflict and recovery dialogs. All sync logic lives in cloud_workspace.js; local autosave in ui.js is never blocked by anything here. */
(function (g) {
  'use strict';
  const B = g.WX && g.WX.cloud, CWm = g.WXCloudWorkspace, P = g.WXCloudPresets, chip = document.getElementById('cloudState');
  if (!B || !CWm || !P || !chip) return;
  if (!P.configured()) return;                         // not configured (no Supabase keys): the app is local-only exactly as before
  const { h, modal, closeModal, toast, notice } = B, cfg = g.WX_CLOUD_CONFIG || {};
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }, del: k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
  const guess = () => { const u = navigator.userAgent || '', os = /Windows/.test(u) ? 'Windows' : /Mac OS/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : 'Computer', br = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser'; return os + ' · ' + br; };
  let deviceId = ls.get('wx.studio.deviceId.v1'); if (!deviceId) { deviceId = CWm.uuid(); ls.set('wx.studio.deviceId.v1', deviceId); }
  const deviceName = () => ls.get('wx.studio.deviceName.v1') || guess();
  /* IndexedDB when available, memory otherwise (private windows): sync still works for the session, it just can't survive a reload. */
  const kv = (() => { let mem = CWm.memoryKV(), idb = null, bad = false; try { idb = CWm.idbKV('wxstudio-cloud'); } catch (e) { bad = true; } const wrap = fn => async (...a) => { if (idb && !bad) { try { return await idb[fn](...a); } catch (e) { bad = true; } } return mem[fn](...a); }; return { get: wrap('get'), set: wrap('set'), del: wrap('del'), keys: wrap('keys') }; })();
  const getSession = async () => { try { return await P.ensureSession(); } catch (e) { return null; } };
  const api = CWm.createApi({ url: cfg.url, key: cfg.publishableKey, getSession, timeoutMs: typeof g.WX_CLOUD_TIMEOUT_MS === 'number' ? g.WX_CLOUD_TIMEOUT_MS : undefined });   // timeoutMs override is for tests only
  const WX = g.WX, S = WX.S, WF = g.WXShowFile;

  const host = {
    getShow: () => S.show, changeSeq: () => B.changeSeq(), builtinAssets: () => B.builtinAssets(), getSceneId: () => B.sceneId(), hasRealLocalWork: B.hasRealLocalWork, renameShow: B.renameShow,
    loadShow: async (sh, o) => { B.loadCloudShow(sh, o); },
    localOnlyMedia: () => {
      const out = [], here = new Set();
      try { WF.inventory(S.show, B.videos()).items.forEach(i => { if (i.present) { here.add(i.id); out.push({ id: i.id, kind: i.kind, name: String(i.name).slice(0, 120), bytes: i.size, scenes: (i.scenes || []).slice(0, 8).map(x => String(x).slice(0, 60)) }); } }); } catch (e) { /* ignore */ }
      try { const used = new Set(WF.inventory(S.show, B.videos()).items.map(i => i.id)); ((eng.baseDoc() || {}).localOnlyMedia || []).forEach(m => { if (!here.has(m.id) && used.has(m.id)) out.push(m); }); } catch (e) { /* ignore */ }
      return out.slice(0, 100);
    },
    readSettings: () => { const o = {}; CWm.SETTINGS_KEYS.forEach(k => { const v = ls.get(k); if (v !== null) o[k] = v; }); return o; },
    writeSettings: patch => { Object.keys(patch).forEach(k => { if (patch[k] === null) ls.del(k); else ls.set(k, patch[k]); }); },
    backupSettings: async local => { ls.set('wx.studio.settingsBackup.v1', JSON.stringify({ at: new Date().toISOString(), settings: local })); }
  };
  const eng = CWm.createEngine({ api, kv, host, deviceId, deviceName: deviceName(), auth: { session: getSession }, isHidden: () => document.visibilityState === 'hidden' });
  g.WXCloudUI = { engine: eng, api, kv, deviceId, ready: null };

  /* ---------- small helpers ---------- */
  const when = iso => { try { return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return String(iso || ''); } };
  const userEmail = () => { const u = P.user(); return (u && u.email) || 'your account'; };
  const REASON = { autosave: 'Autosave', manual: 'Saved by you', close: 'When you left the page', import: 'Opened a file / new show', restore: 'Restored', overwrite: 'Kept one computer’s version', 'pre-overwrite': 'Before another computer’s version replaced it', 'keep-both': 'Kept both copies', undelete: 'Brought back from Deleted shows' };
  const btn = (text, fn, cls) => h('button', { className: cls || '', text, on: { click: fn } });
  const err = m => h('div', { className: 'hint', style: 'color:#ff8a8a;overflow-wrap:anywhere', text: m });
  let dialogKind = '';
  const open = (kind, title, body, buttons) => { dialogKind = kind; modal(title, body, buttons); };
  const closeIf = kind => { if (dialogKind === kind) { closeModal(); dialogKind = ''; } };

  /* ---------- status chip ---------- */
  function chipState() {
    const st = eng.status(), ns = B.ns();
    if (!st.signedIn) return ns ? { k: 'paused', label: 'Cloud paused – saved locally', title: 'Your work is saved on this computer. Sign in again to continue syncing.' } : { k: 'local', label: 'Sign in to sync', title: 'Your work is saved in this browser. Sign in to keep it in the cloud and open it on other computers.' };
    let k = st.kind, label = st.label, title = st.label;
    if (st.remoteNewer && k !== 'conflict') { k = 'incomplete'; label = 'Newer version from ' + (st.remoteNewer.device_name || 'another computer'); title = label + ' – click to review and load it. Your version is not replaced.'; }
    else if (k === 'failed' && st.error) title = st.error;
    else if (k === 'cloud') title = 'Saved to the cloud' + (st.rev ? ' – version ' + st.rev : '') + (st.lastSyncedAt ? ' at ' + when(st.lastSyncedAt) : '') + '. Click for your cloud workspace.';
    else if (k === 'local') title = 'Saved on this computer; changes are waiting to sync to the cloud' + (st.rev ? ' (latest cloud version ' + st.rev + ')' : '') + '.';
    else if (k === 'incomplete') title = st.label + '. Videos, GIFs and any image that could not upload stay on that computer; Save as a .wxshow file to move them.';
    return { k, label: st.short || label, title };
  }
  function paintChip() { const c = chipState(); chip.hidden = false; chip.dataset.k = c.k; chip.querySelector('.cl').textContent = c.label; chip.title = c.title; chip.setAttribute('aria-label', 'Cloud workspace: ' + c.label); }
  chip.addEventListener('click', () => accountDialog());

  /* ---------- sign in / account ---------- */
  function signInForm(note) {
    const em = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'username', style: 'width:100%' }), pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', style: 'width:100%' }), msg = h('div');
    const go = async create => {
      msg.replaceChildren(); const e = em.value.trim(), p = pw.value; if (!e || !p) { msg.append(err('Enter your email and password.')); return; }
      try { if (create) { const r = await P.signUp(e, p); if (r.confirmationRequired) { msg.replaceChildren(h('div', { className: 'hint', text: 'Check your email to confirm the account, then sign in.' })); return; } } else await P.signIn(e, p); closeIf('account'); }
      catch (x) { msg.replaceChildren(err(String(x && x.message || x))); }
    };
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') go(false); });
    return h('div', { style: 'display:grid;gap:8px' }, h('div', { className: 'hint', text: note }), em, pw, h('div', { className: 'btnrow' }, btn('Sign in', () => go(false), 'pri'), btn('Create account', () => go(true))), msg);
  }
  /* Which Supabase project this build talks to (public values only: host + the last 4 characters of the publishable key) — lets you check a dev build is pointed at the right project. */
  const projectLine = () => { let host = ''; try { host = new URL(cfg.url).host; } catch (e) { host = String(cfg.url || '(none)'); } const k = String(cfg.publishableKey || ''); return h('div', { className: 'hint', 'data-cloud-project': host, text: 'Cloud project: ' + host + ' · publishable key …' + k.slice(-4) }); };
  /* ---------- Cloud workspace dialog (v0.10.2 UI fix) ----------
     One dialog: account + status, Sync now with a visible result, and the My Shows / Deleted shows list right in it (My Shows by default).
     Nothing here opens another dialog on its own: every list change happens in place, and results that arrive after the dialog was closed or
     the tab was switched are ignored (token check), so stale content can never replace what is on screen. */
  (() => { const st = document.createElement('style'); st.textContent = '.cwtabs{display:flex;gap:6px;flex-wrap:wrap}.cwtabs button{background:#1c2535;border:1px solid #42516a;color:#cbd6e6}.cwtabs button[aria-selected=true]{background:#2f9bff;border-color:#2f9bff;color:#fff}.cwspin{display:inline-block;width:12px;height:12px;border:2px solid #7fb2e6;border-top-color:transparent;border-radius:50%;animation:cwspin .8s linear infinite;vertical-align:-2px;margin-right:6px}@keyframes cwspin{to{transform:rotate(360deg)}}.cwres{padding:8px 10px;border-radius:6px;border:1px solid #42516a;line-height:1.4}.cwres[data-kind=ok],.cwres[data-kind=same]{border-color:#3ecf8e}.cwres[data-kind=incomplete]{border-color:#f5b942}.cwres[data-kind=error],.cwres[data-kind=conflict]{border-color:#ff6b6b}.cwres[data-kind=busy]{border-color:#2f9bff}.cwres b{display:block}'; document.head.append(st); })();
  const localSaveOk = () => { const el = document.getElementById('saveState'); return !(el && el.dataset.state === 'failed'); };   // the editor's own "Saved hh:mm" / "⚠ Not saved" label
  const timeOf = d => { try { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }); } catch (e) { return String(d); } };
  const MEDIA_WHY = { too_large: 'larger than the 8 MB limit', mime_not_allowed: 'not a PNG, JPEG or WebP image', upload_failed: 'the upload did not finish', unavailable: 'the image is not available on this computer', storage_full: 'the cloud storage is full', offline: 'there is no connection' };
  let syncBusy = false, syncStart = 0, lastSync = null, view = null;       // lastSync keeps the newest Sync-now result so reopening the dialog still shows it
  /* Turn the engine's answer into what the person should read. Never claims more than is true: "complete" only when the document AND every supported image are in the cloud. */
  function classifySync(r, thrown) {
    const st = eng.status(), at = new Date(), localOk = localSaveOk(), ver = st.rev ? 'cloud version ' + st.rev : '';
    const safe = localOk ? 'Your latest changes are safely saved on this computer.' : 'Warning: this browser could not save a local copy of your latest changes – click “⚠ Not saved” (or Save) to download a file.';
    const res = { at, rev: st.rev, localOk, lines: [] };
    if (thrown || !r) { return Object.assign(res, { kind: 'error', title: 'Sync failed', lines: [String((thrown && thrown.message) || 'The cloud did not answer.'), safe] }); }
    if (r.ok) {
      const imgs = (st.issues || []).filter(i => i.reason !== 'offline');
      if (imgs.length || st.localOnlyImages) {
        const n = Math.max(imgs.length, st.localOnlyImages || 0);
        res.kind = 'incomplete'; res.title = 'Sync incomplete';
        res.lines.push('The show itself is saved in the cloud (' + (ver || 'latest version') + '), but ' + n + ' image' + (n > 1 ? 's' : '') + ' could not be uploaded, so another computer would see ' + (n > 1 ? 'them' : 'it') + ' missing:');
        imgs.slice(0, 6).forEach(i => res.lines.push('• ' + i.id + ' – ' + (MEDIA_WHY[i.reason] || i.reason) + (i.detail && i.reason === 'upload_failed' ? ' (' + String(i.detail).slice(0, 120) + ')' : '')));
        res.lines.push('The images stay on this computer. Try Sync now again, or use Save to keep everything in a .wxshow file.');
      } else if (r.status === 'unchanged' || r.status === 'idle') {
        res.kind = 'same'; res.title = 'Already up to date.'; res.lines.push('Nothing has changed since ' + (ver || 'the last cloud save') + (st.lastSyncedAt ? ' (saved ' + when(st.lastSyncedAt) + ')' : '') + '. Checked at ' + timeOf(at) + '.');
      } else { res.kind = 'ok'; res.title = 'Cloud sync complete!'; res.lines.push('Completed at ' + timeOf(at) + (ver ? ' · ' + ver : '') + '.'); }
      if (st.dirty && res.kind !== 'incomplete') res.lines.push('More changes were made while syncing; they will be sent automatically.');
      if ((st.mediaNotes || []).some(x => /video|GIF|audio/i.test(x))) res.lines.push('Videos, GIFs and audio stay on this computer in v0.10.2.');
      if (!localOk) res.lines.push(safe + ' (The cloud copy is up to date.)');
      return res;
    }
    const sv = r.status;
    if (sv === 'conflict') return Object.assign(res, { kind: 'conflict', title: 'Sync paused – this show changed on another computer', lines: ['Nothing was overwritten. Choose which version to keep.', safe], resolve: true });
    if (sv === 'offline' && r.timedOut) return Object.assign(res, { kind: 'error', title: 'Not synced – the cloud did not answer', lines: ['The request was stopped after waiting too long (the connection may have gone quiet). Nothing was lost and nothing was overwritten; it will retry automatically, or click Sync now again.', safe] });
    if (sv === 'offline') return Object.assign(res, { kind: 'error', title: 'Not synced – no connection to the cloud', lines: ['It will retry automatically when the connection is back.', safe] });
    if (sv === 'auth') return Object.assign(res, { kind: 'error', title: 'Not synced – please sign in again', lines: ['Your session has ended. Your work is not lost.', safe] });
    if (sv === 'show_deleted') return Object.assign(res, { kind: 'error', title: 'Not synced – this cloud show was deleted elsewhere', lines: [safe] });
    if (sv === 'paused') return Object.assign(res, { kind: 'error', title: 'Cloud sync is paused', lines: ['Finish the sign-in choice first (cloud chip), then try again.', safe] });
    return Object.assign(res, { kind: 'error', title: 'Sync failed', lines: [String(r.message || st.error || r.code || sv || 'Unknown problem'), safe] });
  }
  async function runSync(reason) {
    if (syncBusy) return; syncBusy = true; syncStart = Date.now(); lastSync = null; if (view) view.render();
    const slowT = setTimeout(() => { if (syncBusy && view && view.alive()) view.render(); }, 15200);
    let r = null, thrown = null;
    try { r = await eng.syncNow(reason === 'manual' ? { force: true, reason: 'manual', retryMedia: true } : { verify: true, retryMedia: true }); } catch (e) { thrown = e; }
    clearTimeout(slowT); syncBusy = false; lastSync = classifySync(r, thrown); if (reason === 'manual' && lastSync.kind === 'ok') lastSync.title = 'Version saved'; paintChip();
    if (view && view.alive()) view.render(); else toast(lastSync.title);
  }
  function accountDialog(o) {
    const st0 = eng.status(), body = h('div', { className: 'cwbox', 'data-cloud-dialog': 'workspace' });
    if (!st0.signedIn) {
      const ns = B.ns();
      body.append(signInForm(ns ? 'Your work stays saved on this computer. Sign in to continue syncing it to your cloud workspace.' : 'Your show is saved in this browser. Sign in to keep your shows and settings in the cloud and open them from any computer. Signing in never replaces work you already have here without asking.'));
      body.append(projectLine()); open('account', 'Cloud workspace', body, [btn('Close', closeModal)]); return;
    }
    let tab = o && o.tab === 'deleted' ? 'deleted' : 'shows', token = 0;
    const top = h('div', { style: 'display:grid;gap:8px' }), actions = h('div', { className: 'btnrow' }), res = h('div', { role: 'status', 'aria-live': 'polite', 'data-cloud-sync-result': '' });
    const tabs = h('div', { className: 'cwtabs', role: 'tablist' }), list = h('div', { className: 'cwlist', 'data-cloud-list': '' });
    const mkTab = (id, label) => h('button', { role: 'tab', text: label, 'data-tab': id, on: { click: () => { if (tab !== id) { tab = id; paintTabs(); loadList(); } } } });
    const tShows = mkTab('shows', 'My Shows'), tDel = mkTab('deleted', 'Deleted shows'); tabs.append(tShows, tDel);
    const paintTabs = () => { [tShows, tDel].forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab))); };
    const bSync = btn('Sync now', () => runSync('sync')), bVer = btn('Save a version now', () => runSync('manual')), bHist = btn('Version history…', versions);
    bSync.setAttribute('data-cloud-sync', ''); actions.append(bSync, bVer, bHist);
    const renderTop = () => {
      const st = eng.status(), c = chipState(); top.replaceChildren();
      top.append(h('div', { className: 'cwrow' }, h('div', { className: 'grow' }, h('div', { style: 'font-weight:700', text: userEmail() }), h('div', { className: 'hint', 'data-cloud-status': '', text: c.label }), h('div', { className: 'hint', 'data-cloud-version': st.rev || 0, text: (st.rev ? 'Latest cloud version: ' + st.rev + (st.lastSyncedAt ? ' · saved ' + when(st.lastSyncedAt) : '') : 'Not saved to the cloud yet') + (st.dirty || st.pending ? ' · changes waiting to sync' : '') })), h('i', { className: 'cd', style: 'width:12px;height:12px;border-radius:50%;background:' + ({ cloud: '#3ecf8e', incomplete: '#f5b942', syncing: '#2f9bff', failed: '#ff6b6b', conflict: '#ff6b6b' }[c.k] || '#7f93ad') })));
      if (st.error) top.append(err(st.error));
      if (st.mediaNotes.length) top.append(h('div', { className: 'hint', text: 'The cloud copy of this show is saved, but ' + st.mediaNotes.join(', ') + ' ' + (st.mediaNotes.length > 1 ? 'are' : 'is') + ' not in the cloud. Save a .wxshow file to move everything to another computer.' }));
      if (st.remoteNewer) top.append(h('div', { className: 'cwrow' }, h('div', { className: 'grow', text: 'A newer version was saved by ' + (st.remoteNewer.device_name || 'another computer') + ' at ' + when(st.remoteNewer.updated_at) + '. Your version has not been changed.' }), btn('Load it', async () => { closeModal(); const r = await eng.loadRemoteNewer(); if (r && r.ok) reportOpen(r, 'Loaded the newer version'); }, 'pri')));
      if (st.conflict) top.append(h('div', { className: 'cwrow' }, h('div', { className: 'grow', text: 'This show has a sync conflict that needs a choice.' }), btn('Resolve…', () => conflictDialog(st.conflict), 'pri')));
    };
    const renderRes = () => {
      res.replaceChildren(); bSync.disabled = bVer.disabled = syncBusy; bSync.textContent = syncBusy ? 'Syncing…' : 'Sync now';
      if (syncBusy) { res.append(h('div', { className: 'cwres', 'data-kind': 'busy' }, h('b', {}, h('span', { className: 'cwspin' }), 'Syncing…'), h('span', { className: 'hint', text: 'Sending your show to the cloud. This can take a few seconds when images are uploaded.' }), Date.now() - syncStart >= 15000 ? h('span', { className: 'hint', 'data-cloud-slow': '', text: 'Still working – this is taking longer than usual. Your changes are safe on this computer. If the cloud does not answer, the attempt stops by itself after at most half a minute per request and is retried; you do not need to reload.' }) : null)); res.dataset.kind = 'busy'; return; }
      if (!lastSync) { res.dataset.kind = ''; return; }
      const L = lastSync; res.dataset.kind = L.kind;
      res.append(h('div', { className: 'cwres', 'data-kind': L.kind }, h('b', { text: L.title }), ...L.lines.map(t => h('div', { className: 'hint', text: t })), L.resolve ? btn('Resolve…', () => conflictDialog(), 'pri') : null));
    };
    const rowFor = r => {
      const cur = eng.record() && eng.record().showId;
      return h('div', { className: 'cwrow', 'data-show-id': r.id }, h('div', { className: 'grow' }, h('div', { style: 'font-weight:600', text: r.name + (r.id === cur ? '  · open now' : '') }), h('div', { className: 'hint', text: when(r.updated_at) + ' · ' + r.scene_count + ' scene' + (r.scene_count === 1 ? '' : 's') + (r.device_name ? ' · from ' + r.device_name : '') })),
        tab === 'deleted' ? btn('Restore', async () => { const x = await eng.undeleteShow(r.id); toast(x && x.ok ? 'Restored “' + r.name + '”' : 'Could not restore'); loadList(); }, 'pri')
          : [r.id === cur ? null : btn('Open', () => openCloudShow(r), 'pri'), btn('Delete', async () => { if (!confirm('Delete “' + r.name + '” from your cloud workspace? You can restore it from Deleted shows.')) return; const x = await eng.deleteShow(r.id); toast(x && x.ok ? 'Deleted – restore it from Deleted shows' : 'Could not delete'); loadList(); }, 'dng')]);
    };
    async function loadList() {
      const my = ++token, wantDeleted = tab === 'deleted'; list.dataset.state = 'loading'; list.dataset.tab = tab; list.replaceChildren(h('div', { className: 'hint', text: wantDeleted ? 'Loading deleted shows…' : 'Loading your shows…' }));
      let rows; try { rows = await eng.listShows(wantDeleted); } catch (e) { if (my !== token) return; list.dataset.state = 'error'; list.replaceChildren(err('Could not load ' + (wantDeleted ? 'deleted shows' : 'your shows') + ': ' + (e && e.message || e)), btn('Try again', loadList)); return; }
      if (my !== token) return;                                   // another tab was chosen, or the dialog was closed, while this was loading
      list.replaceChildren();
      if (!rows.length) { list.dataset.state = 'empty'; list.append(h('div', { className: 'hint', text: wantDeleted ? 'No deleted shows.' : 'No shows in the cloud yet. Your current show will appear here after it syncs.' })); return; }
      list.dataset.state = 'ready'; rows.forEach(r => list.append(rowFor(r)));
    }
    body.append(top, actions, res, tabs, list);
    const nm = h('input', { type: 'text', value: eng.deviceName, maxLength: 60, style: 'flex:1;min-width:0' });
    body.append(h('div', { className: 'hint', text: 'This computer’s name (shown on other computers when a show was saved here):' }), h('div', { className: 'cwrow' }, nm, btn('Rename', () => { const v = nm.value.trim().slice(0, 60) || guess(); ls.set('wx.studio.deviceName.v1', v); eng.deviceName = v; toast('Computer named “' + v + '”'); })));
    const ig = (eng.record() && eng.record().settingsIgnored) || []; if (ig.length) body.append(h('div', { className: 'hint', text: 'Some settings were not synced: ' + ig.map(i => i.key + ' (' + (i.code || i.reason || 'not allowed') + ')').join(', ') }));
    body.append(h('div', { className: 'hint', text: 'Synced: your current show, the scene you were on, and a short list of settings (map defaults, export choices, snap options, your public map token). Private keys are never sent. Videos and GIFs stay on this computer in v0.10.2.' }));
    body.append(projectLine()); open('account', 'Cloud workspace', body, [btn('Sign out…', signOutDialog, 'dng'), btn('Close', closeModal)]);
    const alive = () => document.body.contains(body) && dialogKind === 'account';
    const off = eng.on(type => { if (!alive()) { off(); if (view && view.body === body) view = null; return; } if (type === 'status') { renderTop(); renderRes(); } });
    view = { body, alive, render: () => { renderTop(); renderRes(); } };
    paintTabs(); renderTop(); renderRes(); loadList();
  }
  function reportOpen(r, title) {
    const lines = []; if (r.missing && r.missing.length) lines.push(r.missing.length + ' image(s) in this show are not available on this computer (' + r.missing.slice(0, 4).map(m => m.id + ': ' + ({ too_large: 'too large to upload', mime_not_allowed: 'unsupported type', upload_failed: 'upload failed', unavailable: 'unavailable', hash_mismatch: 'download damaged', download_failed: 'could not download', builtin_missing: 'bundled artwork missing from this version of WX Studio', builtin_changed: 'bundled artwork differs in this version of WX Studio' }[m.reason] || m.reason)).join('; ') + '). Their place is kept so nothing is lost.');
    if (r.localOnlyMedia && r.localOnlyMedia.length) lines.push(r.localOnlyMedia.length + ' video/GIF file(s) used by this show live on another computer: ' + r.localOnlyMedia.slice(0, 5).map(m => m.name).join(', ') + '. Open the .wxshow file from that computer to bring them here.');
    if (lines.length) notice(title, ['The show is open, with notes:'].concat(lines)); else toast(title);
  }

  /* ---------- My Shows ---------- */
  function myShows(trash) { accountDialog({ tab: trash === true ? 'deleted' : 'shows' }); }   // a click event (or anything else) is NOT 'deleted': only an explicit true opens Deleted shows
  async function openCloudShow(r) {
    if (B.hasRealLocalWork() && !confirm('Open “' + r.name + '”? The show that is open now is saved first and kept as a recent safety copy.')) return;
    closeModal(); toast('Opening “' + r.name + '”…');
    try { await B.recentSnap('safety', 'Before opening “' + r.name + '” from the cloud'); const x = await eng.openShow(r.id); reportOpen(x, 'Opened “' + r.name + '”'); }
    catch (e) { notice('Could not open that show', [String(e && e.message || e), 'The show that was open is unchanged.']); }
  }

  /* ---------- version history ---------- */
  async function versions() {
    const rec = eng.record(); if (!rec || !rec.showId) { notice('Version history', ['This show has not been saved to the cloud yet. Make a change and wait a few seconds.']); return; }
    const body = h('div', { className: 'cwbox' }), list = h('div', { className: 'cwlist' }); body.append(h('div', { className: 'hint', text: 'Restoring never deletes anything: it makes the old version the newest one, and the version it replaced stays in this list.' }), list, h('div', { className: 'hint', text: 'Loading…' }));
    open('versions', 'Version history', body, [btn('Back', accountDialog), btn('Close', closeModal)]);
    let rows; try { rows = await eng.listVersions(rec.showId); } catch (e) { body.lastChild.replaceWith(err('Could not load versions: ' + (e && e.message || e))); return; }
    body.lastChild.remove(); if (!rows.length) list.append(h('div', { className: 'hint', text: 'No saved versions yet.' }));
    rows.forEach(v => list.append(h('div', { className: 'cwrow' }, h('div', { className: 'grow' }, h('div', { style: 'font-weight:600', text: (v.protected ? '🔒 ' : '') + (REASON[v.reason] || v.reason) + ' · version ' + v.rev }), h('div', { className: 'hint', text: when(v.created_at) + ' · ' + v.name + ' · ' + v.scene_count + ' scenes' + (v.device_name ? ' · ' + v.device_name : '') })),
      btn('Restore', async () => { if (!confirm('Restore version ' + v.rev + '? It becomes the newest version; what is open now stays in history.')) return; closeModal(); try { await B.recentSnap('safety', 'Before restoring cloud version ' + v.rev); const r = await eng.restoreVersion(v); toast(r && r.ok ? 'Restored version ' + v.rev : 'Restored locally; the cloud will update when it can reconnect'); } catch (e) { notice('Could not restore that version', [String(e && e.message || e), 'Nothing was changed.']); } }, 'pri'))));
  }
  const saveVersion = () => runSync('manual');

  /* ---------- conflict ---------- */
  function conflictDialog(c) {
    c = c || (eng.record() && eng.record().conflict); if (!c) return;
    const dev = c.device_name || 'another computer', body = h('div', { className: 'cwbox' },
      h('div', { text: 'This show was changed on ' + dev + (c.updated_at ? ' at ' + when(c.updated_at) : '') + ' while you were editing it here.' }),
      h('div', { className: 'hint', text: 'Nothing has been overwritten. Your edits are safe on this computer and the other version is safe in the cloud. Choose what to keep:' }),
      h('div', { className: 'cwrow' }, h('div', { className: 'grow' }, h('b', { text: 'Keep both ' }), '— save this computer’s version as a separate show; open the other one from My Shows.'), btn('Keep both', () => resolve('keep-both'), 'pri')),
      h('div', { className: 'cwrow' }, h('div', { className: 'grow' }, h('b', { text: 'Use the cloud version ' }), '— replace what is open here. Your version is kept as a recent safety copy first.'), btn('Use cloud version', () => resolve('use-cloud'))),
      h('div', { className: 'cwrow' }, h('div', { className: 'grow' }, h('b', { text: 'Keep mine ' }), '— make this computer’s version the newest. The other version stays in Version history.'), btn('Keep mine…', () => { if (confirm('Replace the newer version from ' + dev + ' with the one on this computer? You can get it back from Version history.')) resolve('keep-local'); }, 'dng')));
    open('conflict', 'This show changed on another computer', body, [btn('Decide later', closeModal)]);
    async function resolve(choice) {
      closeModal(); try { if (choice === 'use-cloud') await B.recentSnap('safety', 'Before loading the cloud version'); const r = await eng.resolveConflict(choice); if (choice === 'use-cloud' && r && r.ok) reportOpen(r, 'Loaded the cloud version'); else toast(r && r.ok ? 'Saved' : 'Resolved locally; will sync when the cloud is reachable'); }
      catch (e) { notice('Could not finish that', [String(e && e.message || e), 'Your work on this computer is unchanged.']); }
    }
  }

  /* ---------- sign-in: claim wizard, resume offer, deleted elsewhere, sign out ---------- */
  function choose(title, body, buttons) { return new Promise(res => { open('choice', title, body, buttons.map(b => btn(b[0], () => { closeModal(); res(b[1]); }, b[2]))); }); }
  async function claimWizard(info, uid) {
    const bits = []; if (info.show) bits.push('the show “' + info.show.name + '” (' + info.show.scenes + ' scene' + (info.show.scenes === 1 ? '' : 's') + ')'); if (info.images) bits.push(info.images + ' saved image(s)'); if (info.videos) bits.push(info.videos + ' video/GIF file(s)'); if (info.settings) bits.push('your saved settings');
    let pick = 'claim'; const mk = (v, t, d) => h('label', { className: 'cwrow', style: 'cursor:pointer' }, h('input', { type: 'radio', name: 'claim', checked: v === 'claim', on: { change: () => { pick = v; } } }), h('div', { className: 'grow' }, h('b', { text: t }), h('div', { className: 'hint', text: d })));
    const body = h('div', { className: 'cwbox' }, h('div', { text: 'This browser already holds work from before you signed in: ' + bits.join(', ') + '.' }), h('div', { className: 'hint', text: 'Signing in as ' + userEmail() + '. Nothing is deleted either way.' }),
      mk('claim', 'Add it to my account', 'It moves into this account and syncs to the cloud. Others who sign in on this computer will not see it.'), mk('separate', 'Keep it separate', 'It stays here, not linked to your account, and comes back when no one is signed in. Your account starts with its own cloud show.'));
    const r = await choose('Use this browser’s existing work?', body, [['Continue', 'go', 'pri'], ['Cancel sign-in', 'cancel']]);
    return r === 'cancel' ? 'cancel' : pick;
  }
  let signingIn = false;
  async function onSignedIn(uid) {
    if (signingIn) return; signingIn = true;
    try {
      if (B.ns() === uid) { if (eng.uid() !== uid || !eng.record()) await startEngine(); return; }
      let claim = ls.get('wx.studio.claim.' + uid + '.v1');
      if (!B.ns() && !claim) {
        const info = await B.legacyInfo(); info.settings = ['wx.mapbox.token', 'wx_fxpresets', 'wx.studio.defaultMap.v1'].filter(k => ls.get(k) !== null).length;
        if (info.show || info.images || info.videos || info.settings) {
          const pick = await claimWizard(info, uid);
          if (pick === 'cancel') { await P.signOut(); paintChip(); return; }
          claim = pick; ls.set('wx.studio.claim.' + uid + '.v1', claim);
          if (claim === 'claim') { try { await B.claimLegacy(uid); } catch (e) { notice('Could not move everything', ['Some items stay in this browser: ' + (e && e.message || e)]); } }
        }
      }
      B.setNamespace(uid); location.reload();
    } finally { signingIn = false; }
  }
  async function resumeOffer(r, name) {
    const body = h('div', { className: 'cwbox' }, h('div', { text: 'Your cloud workspace has “' + (name || 'a show') + '”' + (r.deviceName ? ' (last open on ' + r.deviceName + ')' : '') + '.' }), h('div', { className: 'hint', text: 'This computer already has work of its own, which has not been touched. Open the cloud show, or keep working on what is here — it syncs as its own show.' }));
    const pick = await choose('Resume your cloud show?', body, [['Open the cloud show', 'open', 'pri'], ['Keep this computer’s show', 'keep']]);
    if (pick === 'open') { try { await B.recentSnap('safety', 'Before resuming your cloud show'); const x = await eng.openShow(r.showId, { sceneId: r.sceneId, reason: 'resume' }); reportOpen(x, 'Opened your cloud show'); } catch (e) { notice('Could not open the cloud show', [String(e && e.message || e), 'Your work on this computer is unchanged.']); } }
    else eng.markDirty();
  }
  function deletedElsewhere() {
    const body = h('div', { className: 'cwbox' }, h('div', { text: 'The cloud copy of this show was deleted from another computer.' }), h('div', { className: 'hint', text: 'Your work here is safe. You can save it again as a new cloud show, or bring back the deleted one from Deleted shows.' }));
    open('deleted', 'This show was deleted elsewhere', body, [btn('Save it again as a new show', async () => { closeModal(); await eng.newIdentity('import'); toast('Saving as a new cloud show…'); }, 'pri'), btn('Deleted shows…', () => myShows(true)), btn('Not now', closeModal)]);
  }
  function signOutDialog() {
    const st = eng.status(), uid = eng.uid(); let pick = 'keep';
    const mk = (v, t, d) => h('label', { className: 'cwrow', style: 'cursor:pointer' }, h('input', { type: 'radio', name: 'so', checked: v === pick, on: { change: () => { pick = v; } } }), h('div', { className: 'grow' }, h('b', { text: t }), h('div', { className: 'hint', text: d })));
    const body = h('div', { className: 'cwbox' }, h('div', { text: 'Sign out of ' + userEmail() + '?' }), h('div', { className: 'hint', text: 'Your cloud workspace is not affected. Choose what stays on this computer:' }),
      mk('keep', 'Keep this show here', 'The open show stays on this computer as a local copy. Your account’s other local data is hidden until you sign in again. Videos and GIFs stay with your account.'),
      mk('clear', 'Clear my account data from this computer', 'For shared computers: removes this account’s local show, images, videos and recent copies. Anything not yet in the cloud is lost' + (st.dirty ? ' — you have changes that have not synced yet' : '') + '.'));
    open('signout', 'Sign out', body, [btn('Sign out', async () => {
      closeModal();
      try {
        if (st.dirty || st.state === 'failed') { toast('Saving to the cloud first…'); const r = await eng.syncNow({ force: true }); if (!(r && r.ok) && pick === 'clear' && !confirm('Your latest changes could not be saved to the cloud. Clear this account’s data from this computer anyway? They would be lost.')) return; }
        if (pick === 'clear') { await B.clearAccountData(uid, CWm.SETTINGS_KEYS); await eng.forget(); ls.del('wx.studio.claim.' + uid + '.v1'); B.setNamespace(null); await P.signOut(); }
        else { await B.keepLocalCopy(); B.setNamespace(null); await P.signOut(); }
      } catch (e) { notice('Could not sign out cleanly', [String(e && e.message || e)]); return; }
      location.reload();
    }, 'pri'), btn('Cancel', accountDialog)]);
  }

  /* ---------- engine start / events ---------- */
  async function startEngine() {
    await eng.attach(); paintChip(); if (!eng.uid()) return;
    const uid = eng.uid(), rec = eng.record();
    if (!rec.settingsInit && ls.get('wx.studio.claim.' + uid + '.v1') === 'claim') await eng.setClaim('upload');
    try { await eng.pullSettings(); await eng.pushSettings(); } catch (e) { /* retried by the periodic tick */ }
    let res = { action: 'none' }; try { res = await eng.restoreSession(); } catch (e) { toast('Cloud workspace unreachable – working locally'); }
    if (rec.conflict) conflictDialog(rec.conflict);
    else if (res.action === 'opened') reportOpen(res, 'Opened “' + (S.show.name || 'your show') + '” from your cloud workspace');
    else if (res.action === 'resume-offer') { let nm = ''; try { nm = ((await eng.listShows()).find(s => s.id === res.showId) || {}).name; } catch (e) { /* ignore */ } resumeOffer(res, nm); }
    else if (rec.dirty || (!rec.showId && B.hasRealLocalWork())) eng.markDirty();
    paintChip();
  }
  eng.on((type, data) => {
    if (type === 'status') paintChip();
    else if (type === 'conflict') { paintChip(); conflictDialog(data); }
    else if (type === 'show-deleted') deletedElsewhere();
    else if (type === 'remote-newer') { paintChip(); toast('A newer version was saved on ' + (data.device_name || 'another computer') + ' – see the cloud chip to load it'); }
    else if (type === 'notice') toast(data);
    else if (type === 'settings-applied') toast('Settings updated from your account');
  });
  B.hooks.changed = () => { try { eng.markDirty(); } catch (e) { /* never affects autosave */ } };
  B.hooks.beforeReplace = async () => { if (!eng.uid() || !eng.record()) return; const rec = eng.record(); if (rec.dirty || rec.pending || (!rec.showId && B.hasRealLocalWork())) { rec.dirty = true; await Promise.race([eng.syncNow({ force: true, reason: 'manual' }).catch(() => { }), new Promise(r => setTimeout(r, 6000))]); } };   // never holds New/Open hostage to a slow network: the local safety copy follows regardless
  B.hooks.afterReplace = reason => { if (!eng.uid()) return; if (reason === 'restore') eng.noteRestore(); else eng.newIdentity(reason).catch(() => { }); };
  P.onAuthChange(async ev => {
    if (ev.event === 'signed-out') { if (ev.reason === 'user') return; await eng.attach(); paintChip(); toast('Cloud sign-in ended – your work is saved on this computer. Sign in to keep syncing.'); return; }
    await onSignedIn(ev.userId);
  });
  g.addEventListener('online', () => { if (eng.uid()) eng.syncNow({ force: true }).catch(() => { }); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') eng.flushOnClose(); else eng.onVisible(); });
  g.addEventListener('pagehide', () => { eng.flushOnClose(); });
  paintChip();
  g.WXCloudUI.ready = (async () => {
    try { const s = await getSession(); if (s && s.user && s.user.id) await onSignedIn(s.user.id); else { await eng.attach(); paintChip(); } }
    catch (e) { paintChip(); }
  })();
  Object.assign(g.WXCloudUI, { accountDialog, myShows, versions, conflictDialog, signOutDialog, startEngine, chipState });
})(window);
