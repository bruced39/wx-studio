/* WX Studio – editor UI */
(function (g) {
  'use strict';
  const E = g.Engine, W = E.W, H = E.H, $ = s => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const stage = $('#stage'), sctx = stage.getContext('2d'), ov = $('#overlay'), octx = ov.getContext('2d');
  const S = { show: null, si: 0, oid: null, tool: 'select', opt: { front: 'cold', icon: 'partly-cloudy', hl: 'H', storm: 'H', shape: 'round' }, mode: 'edit', T: 0, play: null, draft: null, editEnd: false, tab: 'scene', hist: [], hp: -1, drag: null, cursor: [0, 0], mapAcc: { sceneSettings: false, background: false, basic: true, base: false, land: false, labels: false, boundaries: false, roads: false, cameraMove: false, titleBanner: false, showBranding: false } };
  const MS = {open:false,tab:'customize',scroll:0,cloudChecked:false,cloudReady:false,
    cloudLoaded:false,cloudLoading:false,cloudBusy:false,cloudPresets:[],cloudMessage:''};
  const MAP_STYLES_KEY = 'wx.studio.mapStylePresets.v1';
  const KEY = 'wx.studio.autosave.v1';
  /* v0.10.2: per-account local storage. NS is the signed-in account whose work this browser currently shows (null = the original,
     pre-account storage). It only changes on an explicit sign-in/sign-out (the page reloads), never because a token expired. */
  const NS_KEY = 'wx.studio.ns.v1'; let NS = null; try { NS = localStorage.getItem(NS_KEY) || null; } catch (e) { /* storage blocked */ }
  const akey = () => (NS ? KEY + ':u:' + NS : KEY), touchKey = () => akey() + ':touched'; const HK = {}; let booted = false, bootHadAutosave = false, touched = false;
  const markTouched = () => { if (touched) return; touched = true; try { localStorage.setItem(touchKey(), '1'); } catch (e) { /* ignore */ } };
  const MAP_DEFAULT_KEY = 'wx.studio.defaultMap.v1';
  const cur = () => S.show.scenes[S.si];
  const selObj = () => cur().objects.find(o => o.id === S.oid) || null;
  const isMap = bg => bg.type === 'map' || bg.type === 'mapbox';
  const editT = () => (S.editEnd && cur().bg.view2) ? (cur().bg.camDelay || 0) + (cur().bg.camDur || 3) + 0.01 : 0;
  const clock = () => performance.now() / 1000;
  function h(tag, a, ...kids) { const e = document.createElement(tag); Object.keys(a || {}).forEach(k => { if (k === 'on') Object.keys(a.on).forEach(ev => e.addEventListener(ev, a.on[ev])); else if (k === 'text') e.textContent = a[k]; else if (k === 'style') e.style.cssText = a[k]; else if (k in e && k !== 'list') e[k] = a[k]; else e.setAttribute(k, a[k]); }); kids.flat().forEach(c => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); }); return e; }
  function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.k); toast.k = setTimeout(() => t.style.display = 'none', 2600); }
  const toHex = c => { if (!c) return '#ffffff'; if (c[0] === '#') return c.length === 4 ? '#' + [1, 2, 3].map(i => c[i] + c[i]).join('') : c.slice(0, 7); const m = String(c).match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m ? '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('') : '#ffffff'; };

  /* ---------- history / persistence ---------- */
  const snap = () => JSON.stringify({ name: S.show.name, accent: S.show.accent, bugText: S.show.bugText, logo: S.show.logo, scenes: S.show.scenes });
  function commit() { const s = snap(); if (S.hist[S.hp] === s) return; S.hist = S.hist.slice(0, S.hp + 1); S.hist.push(s); if (S.hist.length > 120) S.hist.shift(); S.hp = S.hist.length - 1; autosave(); thumbSoon(); }
  function restore(s) { const o = JSON.parse(s); Object.assign(S.show, { name: o.name, accent: o.accent, bugText: o.bugText, logo: o.logo, scenes: o.scenes }); S.si = clamp(S.si, 0, S.show.scenes.length - 1); if (!selObj()) S.oid = null; refreshAll(); autosave(); }
  const undo = () => { if (S.hp > 0) { S.hp--; restore(S.hist[S.hp]); } };
  const redo = () => { if (S.hp < S.hist.length - 1) { S.hp++; restore(S.hist[S.hp]); } };
  /* Bundled artwork that ships inside the app (default sky, 7-day template, headline / storm backgrounds). v0.10.2: also the list the cloud client uses to
     recognise bundled images (they are never uploaded). keepCustom (cloud open) never replaces a different image that merely reuses a bundled id. */
  function builtinBGs() { const o = {}; if (g.WX_BGDEFAULT) o.bgdefault = g.WX_BGDEFAULT; if (g.WX_BG7DAY) o.bg7day = g.WX_BG7DAY; if (g.WX_TPL) Object.keys(g.WX_TPL).forEach(k => { o[k] = g.WX_TPL[k]; }); return o; }
  function ensureBG(sh, opt) {
    if (!sh || !sh.scenes) return; const B = builtinBGs();
    Object.keys(B).forEach(k => { if (!sh.scenes.some(x => x.bg && x.bg.asset === k)) return; sh.assets = sh.assets || {}; if (opt && opt.keepCustom && sh.assets[k] && sh.assets[k] !== B[k]) return; sh.assets[k] = B[k]; });
  }
  const libHas = (k, v) => { try { return bgList.some(b => b.asset === k && b.data === v); } catch (e) { return false; } };
  /* v0.10.0: autosave reports its outcome. A failed write (storage full or blocked) used to be swallowed silently. */
  function saveStatus(ok, why) {      // ok = true: why may be 'ext' (saved in the larger browser database because the small autosave slot is full)
    const el = $('#saveState'); if (!el) return;
    if (ok) { const d = new Date(); el.textContent = 'Saved ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); el.style.color = '#7f93ad'; el.style.cursor = 'pointer'; el.style.textDecoration = 'underline dotted'; el.title = (why === 'ext' ? 'Autosaved in this browser’s larger storage (the show is too big for the small autosave slot). ' : 'Autosaved in this browser. ') + 'Click to see recent autosaves and restore an earlier copy. Use Save to keep a file.'; el.onclick = recentDialog; el.dataset.state = 'saved'; saveStatus.warned = false; }
    else { el.textContent = '⚠ Not saved'; el.style.color = '#ff6b6b'; el.style.cursor = 'pointer'; el.style.textDecoration = ''; el.title = 'Autosave failed: ' + why + ' Click to download a copy of your show now.'; el.onclick = () => $('#bSave').click(); el.dataset.state = 'failed'; if (!saveStatus.warned) { saveStatus.warned = true; toast('Autosave failed – ' + why + ' Use Save to keep your work.'); } }
  }
  /* Built-in and library images are re-attached on load, so autosave and recent-autosave copies leave them out. */
  const slimReplacer = (k, v) => ((k === 'bg7day' && v === g.WX_BG7DAY) || (k === 'bgdefault' && v === g.WX_BGDEFAULT) || (g.WX_TPL && /^tpl_/.test(k) && g.WX_TPL[k] === v) || (typeof v === 'string' && /^(bg|ov)_/.test(k) && libHas(k, v))) ? undefined : v;
  /* v0.10.2 (storage fix): the small localStorage autosave slot (about 5 MB per site) fills up as soon as a show holds a few large images. A full slot
     used to (1) lose the autosave AND (2) skip the cloud notification that came after it, so the cloud kept an out-of-date copy while showing "Saved".
     Now: the change is ALWAYS announced to the cloud engine first; localStorage stays the normal place (unchanged format, so nothing migrates); when it
     refuses, the same JSON goes to a separate IndexedDB database ('wxstudio-autosave') and a tiny marker key tells the next start to read it from there.
     Nothing is deleted: the older localStorage copy stays as it was, and a stale database record is simply ignored until it is overwritten.          */
  let chgSeq = 0; const stashQ = { busy: false, json: null, n: 0, why: '' }, STUB = '{"wxIdbStub":1}', idbFlag = () => akey() + ':idb';
  const isQuota = e => !!e && (/quota/i.test(e.name || '') || e.code === 22 || e.code === 1014);
  const autoDB = () => new Promise((res, rej) => { try { const r = indexedDB.open('wxstudio-autosave', 1); r.onupgradeneeded = () => r.result.createObjectStore('cur', { keyPath: 'key' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked')); } catch (e) { rej(e); } });
  const autoTx = async (mode, fn) => { const d = await autoDB(); return new Promise((res, rej) => { let out; const t = d.transaction('cur', mode); try { out = fn(t.objectStore('cur')); } catch (e) { d.close(); rej(e); return; } t.oncomplete = () => { d.close(); res(out && out.result); }; t.onerror = t.onabort = () => { d.close(); rej(t.error || new Error('aborted')); }; }); };
  const autoPut = (key, json) => autoTx('readwrite', s2 => s2.put({ key, json, t: Date.now(), size: json.length }));
  const autoGet = key => autoTx('readonly', s2 => s2.get(key));
  const autoDel = key => autoTx('readwrite', s2 => s2.delete(key));
  /* Put the JSON into the larger database and leave the marker; the newest request wins, writes never overlap. */
  function stash(json, n, why) {
    stashQ.json = json; stashQ.n = n; stashQ.why = why; if (stashQ.busy) return; stashQ.busy = true;
    (async () => {
      while (stashQ.json !== null) {
        const j = stashQ.json, k = stashQ.n, w = stashQ.why, key = akey(), flag = idbFlag(); stashQ.json = null;
        try {
          await autoPut(key, j);
          if (k !== chgSeq) continue;                                  // a newer change arrived (and either was stashed too, or fitted into localStorage)
          let marked = false;
          try { localStorage.setItem(flag, String(Date.now())); marked = true; }
          catch (e) { try { localStorage.setItem(key, STUB); marked = true; } catch (e2) { /* nothing more can be done here */ } }   // a smaller value always fits: it frees space
          if (marked) saveStatus(true, 'ext'); else saveStatus(false, w);
        } catch (e) { if (k === chgSeq) saveStatus(false, w); }
      }
      stashQ.busy = false;
    })();
  }
  function autosave() {
    const n = ++chgSeq; let json = null, ok = false, why = 'this browser is blocking storage.';
    try { json = JSON.stringify(S.show, slimReplacer); } catch (e) { why = 'the show could not be prepared for saving.'; }
    if (json !== null) {
      try { localStorage.setItem(akey(), json); ok = true; try { localStorage.removeItem(idbFlag()); } catch (e) { /* ignore */ } }
      catch (e) { if (isQuota(e)) why = 'this browser’s storage is full.'; }
    }
    if (ok) saveStatus(true); else if (json !== null) stash(json, n, why); else saveStatus(false, why);
    try { recentSoon(); } catch (e) { /* ignore */ }
    try { if (S.hp > 0) markTouched(); } catch (e) { /* ignore */ }
    try { if (HK.changed) HK.changed(); } catch (e) { /* cloud must never break autosave */ }   // ALWAYS announced: the cloud copy does not depend on this browser's local storage
  }
  function migrateMB(sh) { if (!sh.mbMigrated) { sh.mbMigrated = 1; sh.scenes.forEach(x => { if (x.bg && x.bg.type === 'map') { x.bg.type = 'mapbox'; x.bg.view = null; x.bg.view2 = null; x.bg.mbStyle = x.bg.mbStyle || 'broadcast'; x.bg.proj = x.bg.proj || 'mercator'; } }); } }
  function migrateWDBroadcast(sh){if(!sh.wdBroadcastMapV1){sh.wdBroadcastMapV1=1;(sh.scenes||[]).forEach(x=>{if(x.bg&&x.bg.type==='mapbox'){if(!x.bg.mbStyle||x.bg.mbStyle==='streets-v12')x.bg.mbStyle='broadcast';g.MB.ensureConfig(x.bg);}});}}
  function builtInDefaultMapBg(){
    const bg={type:'mapbox',mbStyle:'broadcast',broadcastBase:'satellite',proj:'mercator',theme:'dark',region:'eastma',view:null,view2:null,grad:'sky',color:'#101820',asset:null,dim:0,kenburns:false};
    g.MB.ensureConfig(bg); return bg;
  }
  function getSavedDefaultMapBg(){
    try{
      const raw=localStorage.getItem(MAP_DEFAULT_KEY); if(!raw)return null;
      const bg=JSON.parse(raw); if(!bg||bg.type!=='mapbox')return null;
      g.MB.ensureConfig(bg);bg.mbStyle='broadcast';bg.broadcastBase='satellite';
      bg.view2=null;return bg;
    }catch(e){return null;}
  }
  function defaultMapBg(){return getSavedDefaultMapBg()||builtInDefaultMapBg();}
  function applySavedDefaultOnStartup(show){
    const scene=show?.scenes?.[0];
    if(!scene||scene.bg?.type!=='mapbox')return false;
    const saved=getSavedDefaultMapBg();
    if(saved){
      // The saved camera wins over the recent autosaved camera, without
      // replacing any other scenes or weather graphics in this show.
      scene.bg=JSON.parse(JSON.stringify(saved));
      return true;
    }
    // Without a saved default, retain the last session's actual camera.
    g.MB.ensureConfig(scene.bg);
    scene.bg.mbStyle='broadcast';scene.bg.broadcastBase='satellite';
    return false;
  }
  function currentMapDefaultBg(sc){
    const bg=JSON.parse(JSON.stringify(sc.bg)); g.MB.ensureConfig(bg);
    const v=JSON.parse(JSON.stringify(E.viewAt(sc,editT())));
    bg.type='mapbox'; bg.view=v; bg.view2=null; delete bg.camDur; delete bg.camDelay;
    return bg;
  }
  function saveCurrentMapDefault(){
    const sc=cur(); if(sc.bg.type!=='mapbox')return;
    try{
      localStorage.setItem(MAP_DEFAULT_KEY,JSON.stringify(currentMapDefaultBg(sc)));
      toast('Current map saved as the default starting map');
    }catch(e){toast('Could not save the default map');}
  }
  function loadDefaultMap(){
    const sc=cur(),keepDim=sc.bg.dim;
    sc.bg=JSON.parse(JSON.stringify(defaultMapBg()));
    if(sc.bg.dim==null)sc.bg.dim=keepDim||0;
    S.editEnd=false; commit(); renderPanels(); thumbSoon(true);
    toast(getSavedDefaultMapBg()?'Saved default map restored':'Built-in Eastern Massachusetts map restored');
  }
  function resetMapOrientation(){
    const sc=cur(); if(sc.bg.type!=='mapbox')return;
    const v=mapView(sc); v.b=0; v.p=0; commit(); renderPanels(); thumbSoon(true);
    toast('Map reset to north-up and flat');
  }
  function newShowWithDefaultMap(){
    const sh=E.newShow(); if(sh.scenes&&sh.scenes[0]&&sh.scenes[0].bg&&sh.scenes[0].bg.type==='mapbox')sh.scenes[0].bg=JSON.parse(JSON.stringify(defaultMapBg()));
    return sh;
  }
  function loadShow(sh, opt) { if (!sh || !Array.isArray(sh.scenes) || !sh.scenes.length) throw new Error('not a show file'); if (booted) markTouched(); sh.assets = sh.assets || {}; ensureBG(sh, opt); sh.accent = sh.accent || '#2f9bff'; migrateMB(sh); migrateWDBroadcast(sh); S.show = sh; S.si = 0; S.oid = null; S.hist = []; S.hp = -1; commit(); refreshAll(); E.preload(sh).then(thumbSoon); }

  /* ---------- thumbnails ---------- */
  const tb = document.createElement('canvas'); tb.width = W; tb.height = H; const tbc = tb.getContext('2d'); let tk = null;
  // The live editor and thumbnails share ONE Mapbox GL renderer. In the
  // active Mapbox scene, the already-rendered 2D editor stage is the
  // authoritative thumbnail image. Never call E.renderScene from that
  // thumbnail: it queues another Mapbox snapshot/camera jump and may race
  // the live preview. Other scenes retain their existing thumbnail path.
  function copyActiveMapThumb() {
    if(S.mode!=='edit'||S.show?.scenes?.[S.si]?.bg?.type!=='mapbox')return false;
    const cv=document.querySelector(`.sc[data-i="${S.si}"] canvas`);
    if(!cv||!stage||!stage.width||!stage.height)return false;
    try{cv.getContext('2d').drawImage(stage,0,0,cv.width,cv.height);return true;}
    catch(e){return false;}
  }
  function drawThumb(i) {
    const sc=S.show.scenes[i],cv=document.querySelector(`.sc[data-i="${i}"] canvas`);
    if(!cv)return;
    if(i===S.si&&sc.bg.type==='mapbox'&&copyActiveMapThumb())return;
    try{
      E.renderScene(tbc,S.show,sc,Math.min(2.5,sc.duration),
        {editing:true,camT:0,thumb:true});
      cv.getContext('2d').drawImage(tb,0,0,cv.width,cv.height);
    }catch(e){/* Thumbnail failure cannot disrupt editor. */}
  }
  function thumbSoon(all) { clearTimeout(tk); tk = setTimeout(() => { if (all) S.show.scenes.forEach((_, i) => drawThumb(i)); else drawThumb(S.si); }, 450); }
  E.onAsset = () => thumbSoon(true);

  /* ---------- objects ---------- */
  function addObject(type, props, o) {
    o = o || {}; const ob = E.newObject(type, props), sc = cur();
    if (o.delay != null) ob.anim.delay = o.delay;
    if (!o.noGeo && isMap(sc.bg)) E.setGeo(ob, sc, editT(), true);
    sc.objects.push(ob); S.oid = ob.id; commit(); renderPanels(); return ob;
  }
  function delObj() { const sc = cur(); if (!S.oid) return; sc.objects = sc.objects.filter(o => o.id !== S.oid); S.oid = null; commit(); renderPanels(); }
  function dupObj() { const o = selObj(); if (!o) return; const c = JSON.parse(JSON.stringify(o)); c.id = 'o' + Date.now().toString(36); const xf = E.xf(cur(), editT()); E.move(c, 30, 30, xf); cur().objects.push(c); S.oid = c.id; commit(); renderPanels(); }
  function layer(dir) { const a = cur().objects, i = a.findIndex(o => o.id === S.oid); if (i < 0) return; const j = dir === 'front' ? a.length - 1 : dir === 'back' ? 0 : clamp(i + dir, 0, a.length - 1); const [o] = a.splice(i, 1); a.splice(j, 0, o); commit(); }
  function newScene(after) { const sc = E.newScene({ name: 'Scene ' + (S.show.scenes.length + 1), bg: (() => { const b = bgDefaultSpec(); return b ? { type: 'image', asset: b.asset, kenburns: false, fit: b.asset === 'bgdefault' ? 'fill' : undefined } : { type: 'solid', color: '#101820', kenburns: false }; })(), title: { show: false, text: '', sub: '' } }); { const b = bgAll().find(x => x.asset === sc.bg.asset); if (b) S.show.assets[b.asset] = b.data; } S.show.scenes.splice(S.si + 1, 0, sc); S.si++; S.oid = null; commit(); refreshAll(); }

  /* ---------- assets ---------- */
  function readImage(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onerror = rej; r.onload = () => { const im = new Image(); im.onload = () => { let url = r.result; if (im.width > 2560) { const k = 2560 / im.width, cv = document.createElement('canvas'); cv.width = 2560; cv.height = Math.round(im.height * k); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); url = cv.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9); } const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); S.show.assets[id] = url; res({ id, w: im.width, h: im.height }); }; im.onerror = rej; im.src = r.result; }; r.readAsDataURL(file); });
  }
  async function addFiles(files, mode) {
    for (const f of files) {
      if (!/^image\//.test(f.type)) continue; try {
        const a = await readImage(f); await E.preload(S.show);
        if (mode === 'bg') { cur().bg.type = 'image'; cur().bg.asset = a.id; commit(); renderPanels(); }
        else if (mode === 'logo') { S.show.logo = a.id; commit(); renderPanels(); }
        else if (mode !== 'asset') { const k = Math.min(W / a.w, H / a.h, 1) * (a.w > W || a.h > H ? 1 : 1); addObject('image', { asset: a.id, x: (W - a.w * k) / 2, y: (H - a.h * k) / 2, w: a.w * k, h: a.h * k }, { noGeo: true }); }
        else renderPanels();
      } catch (e) { toast('Could not read ' + f.name); }
    }
    thumbSoon(true);
  }

  /* ---------- tools ---------- */
  const TOOLS = [['pan', '✋ Pan Map'], ['select', '⌖ Select'], ['pen', '✎ Pen'], ['arrow', '➚ Arrow'], ['flow', '➤ Flow arrows'], ['jet', '≋ Jet stream'], ['line', '〰 Isobar'], ['front', '▲ Front'], ['hl-H', 'H'], ['hl-L', 'L'], ['icon', '☀ Icon'], ['text', 'T Text'], ['rect', '▭ Box'], ['ellipse', '◯ Oval'], ['pin', '● Pin'], ['storm', '🌀 Storm'], ['barb', '⇶ Wind barb']];
  function addWidget(k) {
    if (!k) return; const m = SAFE(); let o;
    if (k === 'citytemp') o = addObject('citytemp', {});
    else if (k === 'callout') o = addObject('callout', {});
    else if (k === 'legend') o = addObject('legend', { x: (W - 800) / 2, y: H - m - 190 }, { noGeo: true });
    else if (k === 'ticker') o = addObject('ticker', { y: H - 76 - m / 2 }, { noGeo: true });
    else { const pr = { valid: [W - m, H - m - 160, 'Valid'], clock: [W - m, m, 'Clock'], date: [W - m, m + 70, 'Date'] }[k]; o = addObject('text', { x: pr[0], y: pr[1], text: pr[2], auto: k, size: 44, align: 'right', weight: 800 }, { noGeo: true }); E.applyTextPreset(o, 'glass'); }
    if (o) { o.anim.in = k === 'ticker' ? 'in-bottom' : 'fade'; setTool('select'); setTab('object'); commit(); renderPanels(); }
  }
  function buildTools() {
    const t = $('#tools'); t.innerHTML = '';
    TOOLS.forEach(([id, label]) => t.append(h('button', { 'data-tool': id, text: label, title: id, on: { click: () => setTool(id) } })));
    t.append(h('span', { className: 'sep' }));
    const fs = h('select', { id: 'frontKind', title: 'Front type', on: { change: e => { S.opt.front = e.target.value; setTool('front'); } } }, g.Sym.FRONT_KINDS.map(k => h('option', { value: k[0], text: k[1] })));
    const addSel = h('select', { title: 'Add a broadcast element', on: { change: e => { addWidget(e.target.value); e.target.value = ''; } } }, [['', '＋ Add…'], ['citytemp', 'City temperature'], ['callout', 'Callout pin'], ['legend', 'Legend / color bar'], ['valid', 'Valid-time box'], ['clock', 'Clock bug'], ['date', 'Date bug'], ['ticker', 'Alert ticker']].map(o => h('option', { value: o[0], text: o[1] })));
    t.append(addSel, fs, h('button', { text: 'Delete', className: 'dng', on: { click: delObj } }), h('button', { text: 'Duplicate', on: { click: dupObj } }));
    setTool('select');
  }
  function setTool(id) {
    finishDraft();S.tool=id;
    if(S.show&&['front','arrow','line','flow','jet'].includes(id))toast('Click each point along the line, then double-click (or press Enter) to finish');
    document.querySelectorAll('#tools button[data-tool]').forEach(b=>b.classList.toggle('on',b.dataset.tool===id));
    // Do not access cur() before S.show exists.
    ov.style.cursor=(id==='pan'||(id==='select'&&S.show?.scenes?.[S.si]?.bg?.type==='mapbox'))?'grab':id==='select'?'default':'crosshair';
  }
  function finishDraft() {
    const d = S.draft; S.draft = null; if (!d) return;
    if (d.type === 'shape') { if (Math.abs(d.w) > 8 && Math.abs(d.h) > 8) addObject('shape', { shape: d.shape, x: d.x, y: d.y, w: d.w, h: d.h, fill: '#ffffff', opacity: 0.2, stroke: '#ffffff', lw: 4 }); }
    else if (d.pts.length >= 2) {
      const props = { pts: d.pts.map(p => p.slice()) }; if (d.type === 'front') props.kind = S.opt.front;
      if (d.type === 'pen') { props.pts = simplify(props.pts, 3); }
      addObject(d.type, props); setTool('select');
    }
  }
  function simplify(pts, d) { const o = [pts[0]]; pts.forEach(p => { const l = o[o.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) >= d) o.push(p); }); const e = pts[pts.length - 1]; if (o[o.length - 1] !== e) o.push(e); return o; }

  /* ---------- stage pointer interaction ---------- */
  const pt = e => { const r = ov.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  function handles(so) {
    const b = E.bounds(so), r = { verts: null, resize: null, box: b };
    if (so.pts) r.verts = so.pts; else if (['icon', 'storm', 'hl', 'barb', 'text', 'shape', 'image'].includes(so.type)) r.resize = [b.x + b.w, b.y + b.h];
    return r;
  }
  function backToEdit() { if (S.mode !== 'edit') { S.mode = 'edit'; S.play = null; updateTransport(); } }
  function mapView(sc) { const k = (S.editEnd && sc.bg.view2) ? 'view2' : 'view'; if (!sc.bg[k]) sc.bg[k] = JSON.parse(JSON.stringify(E.viewAt(sc, editT()))); return sc.bg[k]; }
  ov.addEventListener('pointerdown', e => {
    if (S.present) return;
    const p = pt(e), sc = cur();
    if (e.button === 2 && sc.bg.type === 'mapbox') {
      e.preventDefault(); backToEdit(); ov.setPointerCapture(e.pointerId);
      g.MB.setInteractive(true);
      S.drag = { k: 'orbit', last: p, moved: false };
      ov.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    backToEdit(); ov.setPointerCapture(e.pointerId); const xf = E.xf(sc, editT());
    if(S.tool==='pan'&&xf.mb){
      // Pan independent of selectable weather objects covering the map.
      e.preventDefault();g.MB.setInteractive(true);
      S.drag={k:'pan',last:p,start:p,startCam:JSON.parse(JSON.stringify(mapView(sc)))};
      ov.style.cursor='grabbing';
      return;
    }
    if (S.tool === 'select') {
      const so = selObj() ? E.toScreen(selObj(), xf) : null;
      if (so) { const hd = handles(so);
        if (selObj().move && selObj().move.on) { const mb = E.bounds(so), ax = mb.x + mb.w / 2, ay = mb.y + mb.h / 2, i = selObj().move.pts.findIndex(q => Math.hypot(ax + q[0] - p[0], ay + q[1] - p[1]) < 26); if (i >= 0) { S.drag = { k: 'mstop', i }; return; } }
        if (hd.verts) { const i = hd.verts.findIndex(v => Math.hypot(v[0] - p[0], v[1] - p[1]) < 16); if (i >= 0) { S.drag = { k: 'vert', i }; return; } }
        if (hd.resize && Math.hypot(hd.resize[0] - p[0], hd.resize[1] - p[1]) < 18) { S.drag = { k: 'resize', last: p, c: [hd.box.x + hd.box.w / 2, hd.box.y + hd.box.h / 2] }; return; } }
      const hit = E.hit(sc, editT(), p[0], p[1]);
      if (hit) { S.oid = hit.id; S.drag = { k: 'move', last: p, moved: false }; if (S.tab !== 'object') setTab('object'); else renderPanels(); }
      else {
        S.oid=null;renderPanels();
        if(xf.map){
          if(xf.mb){g.MB.setInteractive(true);e.preventDefault();ov.style.cursor='grabbing';}
          S.drag={k:'pan',last:p,start:p,startCam:xf.mb?JSON.parse(JSON.stringify(mapView(sc))):null};
        }
      }
      return;
    }
    if (S.tool === 'pen') { S.draft = { type: 'pen', pts: [p] }; S.drag = { k: 'pen' }; return; }
    if (['arrow', 'line', 'front', 'flow', 'jet'].includes(S.tool)) {
      if (!S.draft) S.draft = { type: S.tool, pts: [p] }; else { const l = S.draft.pts[S.draft.pts.length - 1]; if (Math.hypot(l[0] - p[0], l[1] - p[1]) < 8) { finishDraft(); return; } S.draft.pts.push(p); } return;
    }
    if (S.tool === 'rect' || S.tool === 'ellipse') { S.draft = { type: 'shape', shape: S.tool === 'rect' ? 'round' : 'ellipse', x: p[0], y: p[1], w: 0, h: 0 }; S.drag = { k: 'shape', o: p }; return; }
    if (S.tool === 'hl-H' || S.tool === 'hl-L') addObject('hl', { x: p[0], y: p[1], kind: S.tool.slice(-1), value: S.tool.endsWith('H') ? '1030' : '1000' });
    else if (S.tool === 'icon') addObject('icon', { x: p[0], y: p[1], icon: S.opt.icon });
    else if (S.tool === 'text') addObject('text', { x: p[0], y: p[1] });
    else if (S.tool === 'pin') addObject('pin', { x: p[0], y: p[1] });
    else if (S.tool === 'storm') addObject('storm', { x: p[0], y: p[1], kind: S.opt.storm });
    else if (S.tool === 'barb') addObject('barb', { x: p[0], y: p[1] });
    if (!['pen'].includes(S.tool)) setTool('select'), setTab('object');
  });
  ov.addEventListener('pointermove', e => {
    const p = pt(e); S.cursor = p; const d = S.drag, sc = cur(), xf = E.xf(sc, editT()); if (!d) return;
    const o = selObj();
    if (d.k === 'orbit' && sc.bg.type === 'mapbox') {
      const v = mapView(sc), dx = p[0] - d.last[0], dy = p[1] - d.last[1];
      let bearing = (v.b || 0) + dx * 0.18;
      bearing = ((bearing + 180) % 360 + 360) % 360 - 180;
      v.b = bearing;
      v.p = clamp((v.p || 0) - dy * 0.12, 0, 70);
      d.last = p; d.moved = d.moved || Math.abs(dx) + Math.abs(dy) > 0.5;
    }
    else if (d.k === 'move' && o) {
      if (!SNAP.on) { E.move(o, p[0] - d.last[0], p[1] - d.last[1], xf); S.snapLines = null; }
      else { if (!d.b0) { d.b0 = E.bounds(E.toScreen(o, xf)); d.raw = [0, 0]; }
        d.raw[0] += p[0] - d.last[0]; d.raw[1] += p[1] - d.last[1];
        const cb = E.bounds(E.toScreen(o, xf)), want = { x: d.b0.x + d.raw[0], y: d.b0.y + d.raw[1], w: d.b0.w, h: d.b0.h }, sn = snapBounds(want, o, xf);
        E.move(o, want.x + sn.dx - cb.x, want.y + sn.dy - cb.y, xf); S.snapLines = sn.lines; }
      d.last = p; d.moved = true; }
    else if (d.k === 'mstop' && o && o.move) { const mb = E.bounds(E.toScreen(o, xf)); o.move.pts[d.i] = [p[0] - (mb.x + mb.w / 2), p[1] - (mb.y + mb.h / 2)]; }
    else if (d.k === 'vert' && o) { const k = (o.geo && xf.map) ? xf.k : 1, q = o.geo && xf.map ? xf.inv(p[0], p[1]) : p; o.pts[d.i] = [q[0], q[1]]; }
    else if (d.k === 'resize' && o) {
      const so = E.toScreen(o, xf), k = (o.geo && xf.map) ? (xf.kOf ? xf.kOf(o) : xf.k) : 1;
      if (o.type === 'image') { const r = (o.h / o.w) || 1; o.w = Math.max(20, o.w + (p[0] - d.last[0]) / k); if (e.shiftKey) o.h = Math.max(20, o.h + (p[1] - d.last[1]) / k); else o.h = o.w * r; }
      else if (o.type === 'shape') { o.w += (p[0] - d.last[0]) / k; o.h += (p[1] - d.last[1]) / k; }
      else if (o.type === 'text') o.size = clamp(o.size + (p[1] - d.last[1]) * 0.6, 12, 400);
      else { const r0 = Math.hypot(d.last[0] - d.c[0], d.last[1] - d.c[1]) || 1, r1 = Math.hypot(p[0] - d.c[0], p[1] - d.c[1]); o.size = clamp((o.size || 100) * r1 / r0, 20, 900); }
      d.last = p;
    }
    else if(d.k==='pan'&&xf.mb){
      const v=mapView(sc),deltaX=p[0]-d.start[0],deltaY=p[1]-d.start[1];
      const q=g.MB.panByPixels(sc.bg,d.startCam,deltaX,deltaY);
      if(q&&Number.isFinite(q[0])&&Number.isFinite(q[1]))v.c=q;
      d.last=p;
    }
    else if (d.k === 'pan') { const v = mapView(sc), kk = W / v.w; v.cx -= (p[0] - d.last[0]) / kk; v.cy -= (p[1] - d.last[1]) / kk; d.last = p; }
    else if (d.k === 'pen' && S.draft) { const l = S.draft.pts[S.draft.pts.length - 1]; if (Math.hypot(l[0] - p[0], l[1] - p[1]) > 3) S.draft.pts.push(p); }
    else if (d.k === 'shape' && S.draft) { S.draft.x = Math.min(d.o[0], p[0]); S.draft.y = Math.min(d.o[1], p[1]); S.draft.w = Math.abs(p[0] - d.o[0]); S.draft.h = Math.abs(p[1] - d.o[1]); }
  });
  ov.addEventListener('pointerup', () => { const d = S.drag; S.drag = null; S.snapLines = null; ov.style.cursor = (S.tool==='pan'||(S.tool==='select'&&cur().bg.type==='mapbox'))?'grab':''; if (!d) return; if(d.k==='orbit'||(d.k==='pan'&&cur().bg.type==='mapbox'))g.MB.setInteractive(false); if (d.k === 'pen' || d.k === 'shape') { finishDraft(); if (S.tool === 'rect' || S.tool === 'ellipse') setTool('select'); return; } if (d.k !== 'move' || d.moved) commit(); });
  ov.addEventListener('pointercancel', () => { const d=S.drag; S.drag = null; ov.style.cursor = (S.tool==='pan'||(S.tool==='select'&&cur().bg.type==='mapbox'))?'grab':''; if(d&&(d.k==='orbit'||d.k==='pan'))g.MB.setInteractive(false); });
  ov.addEventListener('contextmenu', e => { if (cur().bg.type === 'mapbox') e.preventDefault(); });
  /* ---------- v0.10.1.3: double-click text on the stage to edit it in place ----------
     A small text box is laid exactly over the text (same font, size and alignment) so you can click to place the cursor, type, delete and press Enter for a
     new line. Esc or clicking elsewhere finishes. The banner title (text-only banner) is single-line: Enter finishes. The right-hand panel is unchanged. */
  let inl = null;
  function endInline() { if (!inl) return; const i = inl; inl = null; E.editingId = null; E.editingTitle2 = false; i.el.remove(); commit(); renderPanels(); }
  function startInline(o, title2) {
    endInline(); const sc = cur(); let ta = document.createElement('textarea'); ta.className = 'wxInline'; ta.spellcheck = false; ta.setAttribute('aria-label', 'Edit text on the stage');
    const wasUpper = title2 ? false : (String(o.text || '') !== '' && String(o.text) === String(o.text).toUpperCase() && /[A-Z]/.test(o.text));
    const lum = col => { const q = (/^#([0-9a-f]{6})/i.exec(String(col || '')) || [])[1]; if (!q) return 1; const n = parseInt(q, 16); return ((n >> 16 & 255) * 0.3 + (n >> 8 & 255) * 0.59 + (n & 255) * 0.11) / 255; };
    function place() {
      const r = ov.getBoundingClientRect(), wr = ov.parentElement.getBoundingClientRect(), k = r.width / W, ox = r.left - wr.left, oy = r.top - wr.top, st = ta.style;
      st.boxSizing = 'border-box'; st.position = 'absolute'; st.margin = '0'; st.resize = 'none'; st.overflow = 'hidden'; st.zIndex = '30'; st.outline = '2px solid #2f9bff'; st.border = '0'; st.lineHeight = title2 ? '' : '1.15';
      if (title2) {
        const L = E.title2Layout(o, octx), R = L.R; st.left = ox + (R.l + (o.dx || 0)) * k + 'px'; st.width = (R.r - R.l) * k + 'px'; st.top = oy + (R.cy - R.h / 2 + (o.ty || 0)) * k + 'px'; st.height = R.h * k + 'px';
        st.font = `${L.weight} ${L.size * k}px ${L.fam}`; st.lineHeight = R.h * k + 'px'; st.textAlign = o.align || 'center'; st.whiteSpace = 'nowrap'; st.padding = '0 6px'; st.color = o.color || '#07345a'; st.textTransform = o.upper !== false ? 'uppercase' : 'none';
        st.background = lum(o.color || '#07345a') > 0.6 ? 'rgba(8,24,52,0.6)' : 'rgba(255,255,255,0.55)';
      } else {
        const so = E.toScreen(o, E.xf(sc, editT())), eff = E.effectiveText(so), b = E.bounds(so), pad = (so.box ? so.size * 0.35 : 4) * k;
        st.left = ox + b.x * k + 'px'; st.top = oy + b.y * k + 'px'; st.width = Math.max(60, b.w * k) + 'px'; st.height = Math.max(20, b.h * k) + 'px'; st.padding = pad + 'px';
        st.font = E.fontFor(eff).replace(/\d+(\.\d+)?px/, eff.size * k + 'px'); st.textAlign = so.align || 'left'; st.whiteSpace = so.wrapW > 0 ? 'pre-wrap' : 'pre'; st.color = so.color || '#fff';
        st.background = lum(so.color) > 0.6 ? 'rgba(8,24,52,0.6)' : 'rgba(255,255,255,0.55)'; st.textShadow = 'none';
      }
    }
    inl = { el: ta, o }; if (title2) E.editingTitle2 = true; else E.editingId = o.id;
    ta.value = String(o.text || ''); ov.parentElement.append(ta); place();
    ta.addEventListener('input', () => { if (wasUpper) { const p = ta.selectionStart; ta.value = ta.value.toUpperCase(); ta.setSelectionRange(p, p); } o.text = ta.value; place(); });
    ta.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); endInline(); }
      else if (e.key === 'Enter' && (title2 || e.ctrlKey || e.metaKey)) { e.preventDefault(); endInline(); }
    });
    ta.addEventListener('blur', () => { if (inl && inl.el === ta) endInline(); });
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); setTimeout(() => { if (inl && inl.el === ta && document.activeElement !== ta) ta.focus(); }, 0);
  }
  ov.addEventListener('dblclick', e => {
    if (S.draft && S.draft.pts) { S.draft.pts.pop(); finishDraft(); return; }
    if (S.tool !== 'select' || !S.show) return; const sc = cur(), p = pt(e), hit = E.hit(sc, editT(), p[0], p[1]);
    if (hit && hit.type === 'text' && !hit.auto) { S.oid = hit.id; if (S.tab !== 'object') setTab('object'); else renderPanels(); startInline(hit, false); return; }
    const T = sc.title2; if (!hit && T && T.show && T.textOnly) { const R = T.region || { l: 186, r: 1272, cy: 102, h: 88 }, dx = T.dx || 0; if (p[0] >= R.l + dx && p[0] <= R.r + dx && Math.abs(p[1] - (R.cy + (T.ty || 0))) <= R.h / 2 + 6) startInline(T, true); }
  });
  ov.addEventListener('wheel', e => { const sc = cur(); if (!isMap(sc.bg)) return; e.preventDefault(); backToEdit(); const p = pt(e);
    if (sc.bg.type === 'mapbox') { g.MB.setInteractive(true); const v = mapView(sc), ll = E.xf(sc, editT()).inv(p[0], p[1]); v.z = clamp(v.z - e.deltaY * 0.0025, 0, 20); const l2 = E.xf(sc, editT()).inv(p[0], p[1]); if (isFinite(ll[0]) && isFinite(l2[0])) v.c = [v.c[0] + ll[0] - l2[0], Math.max(-85, Math.min(85, v.c[1] + ll[1] - l2[1]))]; updateZoomBadge(); clearTimeout(ov._wt); ov._wt = setTimeout(()=>{g.MB.setInteractive(false);commit();},180); return; }
    const v = mapView(sc), k = W / v.w, P = [v.cx + (p[0] - W / 2) / k, v.cy + (p[1] - H / 2) / k]; v.w = clamp(v.w * Math.exp(e.deltaY * 0.0012), 18, 1700); const k2 = W / v.w; v.cx = P[0] - (p[0] - W / 2) / k2; v.cy = P[1] - (p[1] - H / 2) / k2; clearTimeout(ov._wt); ov._wt = setTimeout(commit, 400); }, { passive: false });
  ['dragover', 'dragenter'].forEach(ev => stage.parentElement.addEventListener(ev, e => { e.preventDefault(); }));
  stage.parentElement.addEventListener('drop', e => { e.preventDefault(); const ovid = e.dataTransfer && e.dataTransfer.getData('application/x-wx-overlay'); if (ovid) { const b = bgList.find(x => x.id === ovid); if (b) { addOverlay(b, pt(e)); setTool('select'); } return; } const ic = e.dataTransfer && e.dataTransfer.getData('application/x-wx-icon'); if (ic) { const p = pt(e); addObject('icon', { x: p[0], y: p[1], icon: ic }); setTool('select'); const o = selObj(); if (o) { S.oid = o.id; } refreshAll(); return; } if (e.dataTransfer && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files], e.shiftKey ? 'bg' : 'obj'); });
  document.addEventListener('keydown', e => {
    const tg = e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT' || inl) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dupObj(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); delObj(); }
    else if (e.key === 'Enter') finishDraft();
    else if (e.key === 'Escape') { if (S.present) exitPresent(); else { S.draft = null; setTool('select'); } }
    else if (e.key === ' ') { e.preventDefault(); S.mode === 'edit' ? playFrom(E.starts(S.show)[S.si], E.total(S.show)) : stopPlay(); }
    else if (e.key.startsWith('Arrow') && selObj()) { e.preventDefault(); const st = e.shiftKey ? 10 : 1, xf = E.xf(cur(), editT()); E.move(selObj(), e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0, xf); clearTimeout(S.nt); S.nt = setTimeout(commit, 400); }
  });

  /* ---------- playback ---------- */
  function playFrom(a, b) { S.mode = 'play'; S.play = { a, b, t0: clock() }; }
  function stopPlay() { S.mode = 'edit'; S.play = null; if (S.present) exitPresent(); updateTransport(); }
  function updateTransport() { const tot = E.total(S.show), sc = $('#scrub'); sc.max = tot; const T = S.mode === 'edit' ? E.starts(S.show)[S.si] : S.T; if (document.activeElement !== sc) sc.value = T; $('#tc').textContent = `${T.toFixed(1)} / ${tot.toFixed(1)} s`; }
  $('#scrub').addEventListener('input', e => { S.mode = 'scrub'; S.T = +e.target.value; S.play = null; updateTransport(); });
  $('#bPlayScene').onclick = () => { const st = E.starts(S.show)[S.si]; playFrom(st, st + cur().duration); };
  $('#bPlayShow').onclick = () => playFrom(0, E.total(S.show));
  $('#bStop').onclick = stopPlay;
  function present() { S.present = true; $('#stageWrap').classList.add('present'); try { $('#stageWrap').requestFullscreen && $('#stageWrap').requestFullscreen(); } catch (e) { /* overlay mode */ } playFrom(0, E.total(S.show)); }
  function exitPresent() { S.present = false; $('#stageWrap').classList.remove('present'); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ } S.mode = 'edit'; S.play = null; }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && S.present) exitPresent(); });
  $('#bPresent').onclick = present;
  $('#stageWrap').addEventListener('click', () => { if (S.present) stopPlay(); });

  /* ---------- live camera zoom readout ---------- */
  function updateZoomBadge() {
    const badge=$('#mapZoomBadge');
    if(!badge||!S.show)return;
    const scene=cur();
    if(S.mode!=='edit'||scene.bg.type!=='mapbox'||scene.bg.showZoomBadge!==true){
      badge.hidden=true;
      return;
    }
    const view=E.viewAt(scene,editT()),z=Number(view?.z);
    if(!Number.isFinite(z)){badge.hidden=true;return;}
    badge.hidden=false;
    const label=$('#mapZoomValue'),value='ZOOM '+z.toFixed(1);
    if(label&&label.textContent!==value)label.textContent=value;
  }

  /* ---------- render loop ---------- */
  let last = 0,lastActiveMapThumbPaint=0;
  function loop(ts) {
    requestAnimationFrame(loop); const liveMapScene=cur&&cur().bg&&cur().bg.type==='mapbox'; const frameMs=(liveMapScene&&(g.MB.interacting||S.mode!=='edit'))?15:30; if (ts - last < frameMs) return; last = ts;
    try {
      // Keep the zoom text synchronized independently of expensive map frames.
      updateZoomBadge();
      if (S.mode === 'edit') {
        E.renderScene(sctx, S.show, cur(), clock(),
          {editing:true,camT:editT(),liveMap:true});
        // Keep the active map thumbnail current by copying the FINISHED
        // editor stage, not by rendering a second Mapbox camera. This is
        // intentionally independent of asynchronous MB.onUpdate events.
        if(liveMapScene&&ts-lastActiveMapThumbPaint>1100){
          copyActiveMapThumb();lastActiveMapThumbPaint=ts;
        }
        drawOverlay();
      }
      else {
        if (S.mode === 'play' && S.play) { S.T = S.play.a + (clock() - S.play.t0); if (S.T >= S.play.b) { S.T = S.play.b - 0.001; E.renderShow(sctx, S.show, S.T, { liveMap: true }); stopPlay(); return; } }
        E.renderShow(sctx, S.show, S.T, { liveMap: true }); octx.clearRect(0, 0, W, H); updateTransport();
      }
    } catch (err) { console.error(err); reportDrawErr(err); try { drawOverlay(); } catch (e2) { /* ignore */ } }
  }
  let lastDrawErr = '';
  function reportDrawErr(err) { const m = String(err && err.message || err); if (m !== lastDrawErr) { lastDrawErr = m; toast('Drawing error: ' + m.slice(0, 140)); } }
  E.onDrawError = reportDrawErr;
  function drawOverlay() {
    octx.clearRect(0, 0, W, H); const sc = cur(), xf = E.xf(sc, editT()), d = S.draft;
    octx.save(); octx.lineWidth = 3;
    if (d) {
      octx.setLineDash([]);
      if (d.type === 'shape') { octx.strokeStyle = '#2f9bff'; octx.strokeRect(d.x, d.y, d.w, d.h); }
      else { const pts = d.type === 'pen' ? d.pts : d.pts.concat([S.cursor]); const o = { pts, color: '#ffe14d', width: 8, kind: S.opt.front, size: 28, style: 'solid' };
        if (d.type === 'front') g.Sym.drawFront(octx, S.opt.front, pts, 28, clock()); else g.Sym.drawPath(octx, pts, { color: '#ffe14d', width: 8, raw: d.type === 'pen', glow: false, head: d.type === 'arrow' || d.type === 'flow' || d.type === 'jet', t: clock() });
        octx.fillStyle = '#fff'; d.pts.forEach(p => { octx.beginPath(); octx.arc(p[0], p[1], 6, 0, 6.3); octx.fill(); }); }
    }
    const o = selObj();
    if (o && !d) { const so = E.toScreen(o, xf), hd = handles(so), b = hd.box; octx.strokeStyle = '#2f9bff'; octx.setLineDash([10, 7]); octx.strokeRect(b.x, b.y, b.w, b.h); octx.setLineDash([]); octx.fillStyle = '#fff'; octx.strokeStyle = '#2f9bff';
      if (hd.verts) hd.verts.forEach(v => { octx.beginPath(); octx.arc(v[0], v[1], 9, 0, 6.3); octx.fill(); octx.stroke(); });
      if (hd.resize) { octx.fillRect(hd.resize[0] - 9, hd.resize[1] - 9, 18, 18); octx.strokeRect(hd.resize[0] - 9, hd.resize[1] - 9, 18, 18); } }
    if (o && !d && o.move && o.move.on) { const mb = E.bounds(E.toScreen(o, xf)), ax = mb.x + mb.w / 2, ay = mb.y + mb.h / 2, sm = E.moveSamples(o.move); octx.save(); octx.strokeStyle = '#ffe14d'; octx.lineWidth = 4; octx.setLineDash([14, 9]); octx.beginPath(); sm.forEach((q, i) => i ? octx.lineTo(ax + q[0], ay + q[1]) : octx.moveTo(ax + q[0], ay + q[1])); octx.stroke(); octx.setLineDash([]);
      [[0, 0]].concat(o.move.pts).forEach((q, i) => { const x = ax + q[0], y = ay + q[1]; octx.fillStyle = i ? '#ffe14d' : '#2f9bff'; octx.strokeStyle = '#08142a'; octx.lineWidth = 3; octx.beginPath(); octx.arc(x, y, 20, 0, 6.3); octx.fill(); octx.stroke(); octx.fillStyle = '#08142a'; octx.font = '800 24px sans-serif'; octx.textAlign = 'center'; octx.textBaseline = 'middle'; octx.fillText(MLET(i), x, y + 1); }); octx.restore(); }
    if ((SNAP.guides || (S.drag && S.drag.k === 'move' && S.drag.moved)) && S.mode === 'edit') { const m = SAFE(); octx.save(); octx.setLineDash([14, 10]); octx.lineWidth = 2; octx.strokeStyle = 'rgba(255,255,255,0.35)'; octx.strokeRect(m, m, W - 2 * m, H - 2 * m); octx.strokeStyle = 'rgba(255,255,255,0.18)'; octx.beginPath(); octx.moveTo(W / 2, 0); octx.lineTo(W / 2, H); octx.moveTo(0, H / 2); octx.lineTo(W, H / 2); octx.stroke(); octx.restore(); }
    if (S.snapLines && S.snapLines.length) { octx.save(); octx.strokeStyle = '#ff2fd0'; octx.lineWidth = 2; octx.setLineDash([]); S.snapLines.forEach(l => { octx.beginPath(); if (l.x != null) { octx.moveTo(l.x, 0); octx.lineTo(l.x, H); } else { octx.moveTo(0, l.y); octx.lineTo(W, l.y); } octx.stroke(); }); octx.restore(); }
    if (isMap(sc.bg) && sc.bg.view2) { octx.fillStyle = 'rgba(8,20,38,.8)'; octx.fillRect(W - 330, H - 52, 310, 36); octx.fillStyle = '#9fd0ff'; octx.font = '600 22px sans-serif'; octx.fillText('Editing camera ' + (S.editEnd ? 'END' : 'START') + ' view', W - 318, H - 27); }
    octx.restore();
  }

  /* ---------- inspector helpers ---------- */
  function fld(label, el, full) { return h('div', { className: 'row' + (full ? ' full' : '') }, full ? null : h('label', { text: label }), el); }
  function bind(obj, key, kind, o) {
    o = o || {}; let el; const get = () => obj[key], set = v => { obj[key] = v; if (o.after) o.after(v); };
    if (kind === 'range') { el = h('input', { type: 'range', min: o.min, max: o.max, step: o.step || 1, value: get() }); el.addEventListener('input', () => set(+el.value)); el.addEventListener('change', commit); }
    else if (kind === 'num') { el = h('input', { type: 'number', min: o.min, max: o.max, step: o.step || 1, value: get() }); el.addEventListener('input', () => set(+el.value)); el.addEventListener('change', () => { if (o.rerender) renderPanels(); commit(); }); }
    else if (kind === 'color') { el = h('input', { type: 'color', value: toHex(get()) }); el.addEventListener('input', () => set(el.value)); el.addEventListener('change', commit); }
    else if (kind === 'check') { el = h('input', { type: 'checkbox', checked: !!get() }); el.addEventListener('change', () => { set(el.checked); commit(); if (o.rerender) renderPanels(); }); }
    else if (kind === 'select') { el = h('select', {}, o.options.map(op => h('option', { value: op[0], text: op[1], selected: String(op[0]) === String(get()) }))); el.addEventListener('change', () => { set(el.value); commit(); if (o.rerender) renderPanels(); }); }
    else if (kind === 'area') { el = h('textarea', { rows: 2, value: get() == null ? '' : get() }); el.addEventListener('input', () => set(el.value)); el.addEventListener('change', commit); }
    else { el = h('input', { type: 'text', value: get() == null ? '' : get() }); el.addEventListener('input', () => set(el.value)); el.addEventListener('change', commit); }
    return fld(o.label || key, el);
  }
  function mapAccordion(key, title, nodes, defaultOpen) {
    const open = S.mapAcc[key] == null ? !!defaultOpen : !!S.mapAcc[key];
    const box = h('details', { className: 'mapacc', open },
      h('summary', { text: title }),
      h('div', { className: 'mapaccbody' }, ...(nodes || [])));
    box.addEventListener('toggle', () => { S.mapAcc[key] = box.open; });
    return box;
  }
  function zoomRangeRow(obj,label,minKey,maxKey,o){
    o=o||{}; const lo=o.min==null?0:o.min, hi=o.max==null?24:o.max, step=o.step||.5;
    const make=(key,caption)=>{
      const el=h('input',{type:'number',min:lo,max:hi,step,value:obj[key]});
      el.addEventListener('input',()=>{obj[key]=+el.value;});
      el.addEventListener('change',commit);
      return h('div',{className:'zoomrangebox'},h('span',{text:caption}),el);
    };
    return h('div',{className:'row zoomrangerow'},h('label',{text:label}),h('div',{className:'zoomrangepair'},make(minKey,'Min'),make(maxKey,'Max')));
  }
  const OPT = { weight: [[500, 'Medium'], [700, 'Bold'], [800, 'Extra bold']], align: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], style: [['flow', 'Animated flow'], ['solid', 'Solid'], ['dash', 'Dashed']] };
  function objectPanel(p) {
    const o = selObj(); if (!o) { p.append(h('div', { className: 'hint', text: 'Select an object on the stage, or pick a tool below the stage and draw. Click a polyline object to edit its points; drag the square handle to resize.' })); return; }
    p.append(h('div', { className: 'h', text: o.type.toUpperCase() }));
    const T = o.type, B = (k, kind, op) => p.append(bind(o, k, kind, op));
    if (T === 'text') { B('auto', 'select', { label: 'Auto text', rerender: true, options: [['', 'Manual'], ['valid', 'Valid time'], ['datetime', 'Date + time'], ['date', 'Date'], ['clock', 'Clock']] }); if (!o.auto) B('text', 'area', { label: 'Text' }); B('size', 'num', { min: 10, max: 400, label: 'Size' }); B('color', 'color'); B('weight', 'select', { options: OPT.weight }); B('align', 'select', { options: OPT.align }); B('font', 'select', { options: [['display', 'Condensed'], ['sans', 'Standard']] }); B('box', 'check', { label: 'Background box', rerender: true });
      if (o.box) B('boxStyle', 'select', { label: 'Box style', options: [['plain', 'Plain tint'], ['titlebar', 'Title bar'], ['red', 'Red glossy'], ['glass', 'Glass']] });
      p.append(h('div', { className: 'h', text: 'Text style' }), fld('Preset', h('select', { on: { change: e => { E.applyTextPreset(o, e.target.value); commit(); renderPanels(); } } }, E.TEXT_PRESETS.map(x => h('option', { value: x[0], text: x[1] })))));
      if (o.fitBox) { if (o.autoFit == null) o.autoFit = true; B('autoFit', 'check', { label: 'Auto-fit text to its bar (size = largest allowed)', rerender: true }); if (o.autoFit !== false) B('maxLines', 'range', { min: 1, max: 4, label: 'Max lines' }); B('wrapW', 'range', { min: 100, max: 1800, step: 10, label: 'Text width (px)' }); B('fitH', 'range', { min: 30, max: 400, step: 2, label: 'Text height (px)' }); }
      else { if (o.wrapW == null) o.wrapW = 0; B('wrapW', 'range', { min: 0, max: 1800, step: 20, label: 'Wrap width (0=off)' }); }
      if (o.strokeW == null) o.strokeW = 0; B('strokeW', 'range', { min: 0, max: 24, label: 'Outline' }); if (o.strokeW > 0) B('strokeColor', 'color', { label: 'Outline color' });
      if (!o.color2) o.color2 = o.color; B('grad', 'check', { label: 'Gradient fill', rerender: true }); if (o.grad || o.gloss) B('color2', 'color', { label: 'Bottom color' });
      B('gloss', 'check', { label: 'Gloss highlight', rerender: true });
      p.append(h('div', { className: 'btnrow' }, h('button', { text: 'Layer style… (Photopea-style)', on: { click: () => { if (!o.fx) { o.fx = E.fxDefault(); o.fx.stroke.on = false; o.fx.shadow.on = false; } openFxWindow(o.fx, 'Layer Style – text'); } } }), o.fx ? h('button', { text: 'Remove layer style', on: { click: () => { delete o.fx; commit(); renderPanels(); } } }) : null)); }
    if (T === 'icon') { B('icon', 'select', { options: g.Icons.list.map(i => [i.id, i.label]) }); B('size', 'range', { min: 60, max: 800 }); }
    if (T === 'hl') { B('kind', 'select', { options: [['H', 'H – High'], ['L', 'L – Low']] }); B('value', 'text', { label: 'Pressure (mb)' }); B('size', 'range', { min: 80, max: 500 }); }
    if (T === 'front') { B('kind', 'select', { options: g.Sym.FRONT_KINDS }); B('size', 'range', { min: 12, max: 70 }); B('flip', 'check', { label: 'Flip side' }); }
    if (T === 'flow') { B('style', 'select', { label: 'Look', options: [['glossy', 'Glossy arrows with tails'], ['streak', 'Curved streak arrows'], ['block', '3-D block arrows'], ['chevron', 'Outlined chevrons  >>'], ['plain', 'Plain arrows']] }); B('color', 'color'); B('size', 'num', { min: 10, max: 200, label: 'Arrow size' }); B('spacing', 'range', { min: 1.4, max: 8, step: 0.1, label: 'Spacing' }); B('speed', 'range', { min: 0, max: 4, step: 0.1, label: 'Speed (0 = still)' }); }
    if (T === 'jet') { if (o.outline == null) o.outline = true; if (o.fade == null) o.fade = 0; const JC = { ribbon: '#d5dbe6', banded: '#0b4fa8' }; B('style', 'select', { label: 'Look', options: [['banded', 'Banded (dark band, white edge)'], ['ribbon', 'Ribbon (soft band, big head)']], after: v => { if (o.color === JC.ribbon || o.color === JC.banded) o.color = JC[v]; }, rerender: true }); B('color', 'color', { label: 'Band color' }); B('flowText', 'select', { label: 'Moving in the band', rerender: true, options: [['arrows', 'Arrows'], ['text', 'Words (JET STREAM)']] }); if (o.flowText === 'text') B('words', 'text', { label: 'Words' }); B('arrowColor', 'color', { label: o.flowText === 'text' ? 'Word / arrow color' : 'Arrow color' }); B('width', 'num', { min: 10, max: 300, label: 'Band width' }); B('outline', 'check', { label: 'Edge line (white outline)' }); B('fade', 'range', { min: 0, max: 95, step: 5, label: 'Soft edges (0 = sharp)' }); B('speed', 'range', { min: 0, max: 4, step: 0.1, label: 'Speed (0 = still)' }); B('label', 'text', { label: 'Label (optional)' }); }
    if (T === 'arrow') { B('color', 'color'); B('width', 'range', { min: 3, max: 50 }); B('style', 'select', { options: OPT.style }); B('head', 'check', { label: 'Arrow head' }); }
    if (T === 'line') { B('color', 'color'); B('width', 'range', { min: 2, max: 40 }); B('style', 'select', { options: [['solid', 'Solid'], ['dash', 'Dashed'], ['flow', 'Animated flow']] }); B('closed', 'check', { label: 'Closed loop' }); B('label', 'text', { label: 'Label (e.g. 1008)' }); }
    if (T === 'pen') { B('color', 'color'); B('width', 'range', { min: 2, max: 50 }); }
    if (T === 'shape') { B('shape', 'select', { options: [['rect', 'Rectangle'], ['round', 'Rounded'], ['ellipse', 'Oval']] }); B('fill', 'color'); B('opacity', 'range', { min: 0, max: 1, step: 0.05 }); B('stroke', 'color'); B('lw', 'range', { min: 0, max: 24, label: 'Outline' }); B('radius', 'range', { min: 0, max: 120 }); }
    if (T === 'image') { B('opacity', 'range', { min: 0, max: 1, step: 0.05 }); p.append(h('div', { className: 'h', text: 'Position' }), h('div', { className: 'btnrow' }, POS.map(([k, l]) => h('button', { text: l, title: 'Move to ' + l.toLowerCase(), on: { click: () => { movePos(o, k); renderPanels(); } } })))); p.append(h('div', { className: 'btnrow' }, h('button', { text: 'Fit to screen', on: { click: () => { const im = new Image(); im.onload = () => { const k = Math.min(W / im.width, H / im.height); Object.assign(o, { x: (W - im.width * k) / 2, y: (H - im.height * k) / 2, w: im.width * k, h: im.height * k, geo: false }); commit(); }; im.src = S.show.assets[o.asset]; } } }), h('button', { text: 'Use as background', on: { click: () => { cur().bg.type = 'image'; cur().bg.asset = o.asset; delObj(); } } }))); }
    if (T === 'barb') { B('kt', 'range', { min: 0, max: 150, step: 5, label: 'Speed (kt)' }); B('dir', 'range', { min: 0, max: 359, label: 'From (deg)' }); B('size', 'range', { min: 40, max: 300 }); B('color', 'color'); }
    if (T === 'pin') { B('label', 'text'); B('value', 'text'); B('color', 'color'); }
    if (T === 'storm') { B('kind', 'select', { options: [['H', 'Hurricane'], ['TS', 'Tropical storm'], ['TD', 'Depression']] }); B('size', 'range', { min: 60, max: 500 }); B('label', 'text'); }
    if (T === 'pop') { B('value', 'text'); B('size', 'range', { min: 20, max: 120 }); }
    if (T === 'citytemp') { B('name', 'text', { label: 'City' }); B('value', 'text', { label: 'Value' }); B('size', 'range', { min: 22, max: 90 }); B('colorByTemp', 'check', { label: 'Color by temperature' }); }
    if (T === 'callout') { B('label', 'text'); B('value', 'text'); B('size', 'range', { min: 22, max: 80 }); B('dx', 'range', { min: -600, max: 600, label: 'Offset X' }); B('dy', 'range', { min: -500, max: 500, label: 'Offset Y' }); B('color', 'color', { label: 'Value color' }); }
    if (T === 'legend') { B('kind', 'select', { options: E.LEGEND_KINDS }); B('title', 'text'); B('left', 'text', { label: 'Left label' }); B('right', 'text', { label: 'Right label' }); B('w', 'range', { min: 300, max: 1600, label: 'Width' }); B('h', 'range', { min: 30, max: 100, label: 'Height' }); }
    if (T === 'ticker') { B('text', 'area', { label: 'Message' }); B('label', 'text', { label: 'Tag' }); B('speed', 'range', { min: 40, max: 400, label: 'Speed' }); B('h', 'range', { min: 50, max: 140, label: 'Height' }); }
    if (o.type !== 'text') p.append(h('div', { className: 'h', text: 'Layer style' }), h('div', { className: 'btnrow' }, h('button', { text: 'Layer style… (stroke, shadow, glow, overlay)', on: { click: () => { if (!o.fx) { o.fx = E.fxDefault(); o.fx.stroke.on = false; o.fx.shadow = { on: true, color: '#000000', opacity: 60, angle: 90, dist: 6, size: 10 }; } openFxWindow(o.fx, 'Layer Style – ' + o.type); } } }), o.fx ? h('button', { text: 'Remove layer style', on: { click: () => { delete o.fx; commit(); renderPanels(); } } }) : null));
    { const sh0 = E.shadowOf(o), sh = (o.shadow && typeof o.shadow === 'object') ? o.shadow : (o.shadow = sh0 || { on: false, blur: 12, dist: 7, alpha: 0.6 }); sh.on = !!sh0;
      p.append(h('div', { className: 'h', text: 'Shadow' }), bind(sh, 'on', 'check', { label: 'Drop shadow' }), bind(sh, 'blur', 'range', { min: 0, max: 40, label: 'Softness' }), bind(sh, 'dist', 'range', { min: 0, max: 40, label: 'Distance' }), bind(sh, 'alpha', 'range', { min: 0, max: 1, step: 0.05, label: 'Opacity' })); }
    p.append(h('div', { className: 'h', text: 'Animation' }));
    B2(p, o.anim, 'in', 'select', { label: 'Entrance', options: E.ANIMS }); B2(p, o.anim, 'delay', 'range', { min: 0, max: 20, step: 0.1, label: 'Delay (s)' }); B2(p, o.anim, 'dur', 'range', { min: 0.1, max: 5, step: 0.1, label: 'Duration (s)' });
    movePanel(p, o);
    if (isMap(cur().bg)) p.append(bind(o, 'geo', 'check', { label: 'Pin to map', after: v => { o.geo = !v; E.setGeo(o, cur(), editT(), v); } }), h('div', { className: 'hint', text: 'Pinned objects move and zoom with the map (position only – sizes stay fixed).' }));
    p.append(h('div', { className: 'h', text: 'Arrange' }), h('div', { className: 'btnrow' }, h('button', { text: 'Bring front', on: { click: () => layer('front') } }), h('button', { text: 'Send back', on: { click: () => layer('back') } }), h('button', { text: 'Duplicate', on: { click: dupObj } }), h('button', { text: 'Delete', className: 'dng', on: { click: delObj } })));
  }
  const MLET = i => String.fromCharCode(65 + i);
  function movePanel(p, o) {
    const m = o.move; p.append(h('div', { className: 'h', text: 'Motion path (A → B → C …)' }));
    p.append(bind({ on: !!(m && m.on) }, 'on', 'check', { label: 'Move along a path', rerender: true, after: v => { if (v) { if (!o.move) o.move = E.moveDefault(); o.move.on = true; } else if (o.move) o.move.on = false; } }));
    if (!m || !m.on) { p.append(h('div', { className: 'hint', text: 'Turn on, then drag the B handle on the map where it should end up. Press Add stop for C, D and more.' })); return; }
    p.append(h('div', { className: 'hint', text: 'A is where the object sits now. Drag the lettered handles on the map to place each stop; the yellow line is the route it will glide along.' }));
    m.pts.forEach((q, i) => p.append(h('div', { className: 'btnrow' }, h('span', { text: 'Stop ' + MLET(i + 1) + '  ', style: 'color:#ffe14d;font-weight:700;align-self:center' }), h('button', { text: 'Remove', on: { click: () => { m.pts.splice(i, 1); if (!m.pts.length) m.on = false; commit(); renderPanels(); } } }))));
    p.append(h('div', { className: 'btnrow' }, h('button', { text: '+ Add stop (' + MLET(m.pts.length + 1) + ')', on: { click: () => { const l = m.pts[m.pts.length - 1] || [0, 0], pv = m.pts[m.pts.length - 2] || [0, 0], dx = l[0] - pv[0], dy = l[1] - pv[1], d = Math.hypot(dx, dy) || 1; m.pts.push([l[0] + (dx / d) * 200, l[1] + (dy / d) * 200]); commit(); renderPanels(); } } })));
    { const others = cur().objects.filter(q => q.id !== o.id && !(q.move && q.move.on));
      if (others.length) { p.append(h('div', { className: 'h', text: 'Move together with (stay linked as drawn)' }), h('div', { className: 'hint', text: 'Tick the fronts, lows or labels that belong to this one. They glide along the exact same path at the same time and keep their drawn spacing.' }));
        others.forEach(q => { const nm = (q.type === 'front' ? (q.kind || 'front') + ' front' : q.type === 'hl' ? (q.kind === 'L' ? 'Low' : 'High') + (q.value ? ' ' + q.value : '') : q.type === 'text' ? 'Text "' + String(q.text || '').slice(0, 14) + '"' : q.type === 'icon' ? 'Icon ' + (q.icon || '') : q.type) + ' #' + (cur().objects.indexOf(q) + 1);
          p.append(bind({ v: q.moveWith === o.id }, 'v', 'check', { label: nm, after: v => { if (v) q.moveWith = o.id; else if (q.moveWith === o.id) delete q.moveWith; } })); }); } }
    B2(p, m, 'start', 'range', { min: 0, max: 30, step: 0.1, label: 'Starts at (s)' }); B2(p, m, 'dur', 'range', { min: 0.3, max: 20, step: 0.1, label: 'Travel time (s)' });
    B2(p, m, 'ease', 'select', { label: 'Speed', options: [['inout', 'Ease in & out'], ['out', 'Slow down at end'], ['linear', 'Constant']] });
    B2(p, m, 'smooth', 'check', { label: 'Smooth curve (off = straight legs)' }); B2(p, m, 'loop', 'check', { label: 'Repeat (A → … → last, again)' });
  }
  function B2(p, obj, k, kind, o) { p.append(bind(obj, k, kind, o)); }

  function scenePanel(p) {
    const sc = cur(), b = sc.bg;

    p.append(mapAccordion('sceneSettings','Scene Settings',[
      bind(sc, 'name', 'text', { label: 'Name', after: () => renderSceneList() }),
      bind(sc, 'duration', 'num', { min: 1, max: 120, step: 0.5, label: 'Duration (s)', rerender: false, after: () => updateTransport() }),
      bind(sc.transition, 'type', 'select', { label: 'Transition in', options: E.TRANSITIONS }),
      bind(sc.transition, 'dur', 'range', { min: 0.2, max: 3, step: 0.1, label: 'Trans. length' })
    ],false));

    const bgNodes=[
      bind(b, 'type', 'select', { label: 'Type', rerender: true, after: () => { b.view = null; b.view2 = null; S.editEnd = false; if (b.type === 'mapbox') g.MB.init().then(() => { refreshAll(); }).catch(() => { refreshAll(); }); }, options: [['mapbox', 'Mapbox map'], ['map', 'US map (basic, offline)'], ['gradient', 'Gradient'], ['solid', 'Solid colour'], ['image', 'Your image']] })
    ];
    if (b.type === 'map') {
      if (b.counties == null) b.counties = true;
      if (b.cityDensity == null) b.cityDensity = 1;
      if (b.cities == null) b.cities = true;
      bgNodes.push(
        bind(b, 'theme', 'select', { label: 'Style', options: [['dark', 'Dark blue'], ['radar', 'Radar grey'], ['slate', 'Slate'], ['light', 'Light']] }),
        bind(b, 'region', 'select', { label: 'Region', options: g.WDMap.regionList, after: () => { b.view = null; b.view2 = null; S.editEnd = false; } }),
        bind(b, 'cities', 'check', { label: 'City labels', after: v => { b.cities = v; } }),
        bind(b, 'counties', 'check', { label: 'County lines (zoomed in)', after: v => { b.counties = v; } }),
        bind(b, 'cityDensity', 'range', { min: 0.3, max: 4, step: 0.1, label: 'Label density' }),
        h('div', { className: 'hint', text: 'Drag the empty map to pan, scroll to zoom. Pinned objects follow the map.' })
      );
    }
    if (b.type === 'gradient') bgNodes.push(bind(b, 'grad', 'select', { label: 'Preset', options: Object.keys(E.GRADS).map(k => [k, k]) }));
    if (b.type === 'solid') bgNodes.push(bind(b, 'color', 'color', { label: 'Colour' }));
    if (b.type === 'image') {
      if (b.fit === 'solid' && !b.fitColor) b.fitColor = '#0a1a3a';
      bgNodes.push(
        fld('Image', h('select', { on: { change: e => { b.asset = e.target.value; commit(); } } },
          h('option', { value: '', text: '— choose —' }),
          Object.keys(S.show.assets).map((id, i) => h('option', { value: id, text: 'Image ' + (i + 1), selected: id === b.asset })))),
        h('div', { className: 'btnrow' }, h('button', { text: 'Upload background…', on: { click: () => pickImages('bg') } })),
        bind(b, 'fit', 'select', { label: 'Image fit', rerender: true, options: [['blur', 'Fit whole image + blurred fill'], ['fill', 'Fill (crop edges)'], ['solid', 'Fit whole image + solid color'], ['stretch', 'Stretch to frame']] }),
        ...((b.fit === 'solid') ? [bind(b, 'fitColor', 'color', { label: 'Bar color' })] : []),
        bind(b, 'kenburns', 'check', { label: 'Slow zoom' })
      );
    }
    bgNodes.push(bind(b, 'dim', 'range', { min: 0, max: 0.85, step: 0.05, label: 'Darken' }));
    p.append(mapAccordion('background','Background',bgNodes,false));

    if (b.type === 'mapbox') {
      g.MB.ensureConfig(b);
      const mv = (S.editEnd && b.view2) ? b.view2 : (b.view || (b.view = JSON.parse(JSON.stringify(E.viewAt(sc, 0)))));
      const basic = [
        bind(b, 'mbStyle', 'select', { label: 'Map style', rerender:true, options: g.MB.STYLES, after:()=>g.MB.ensureConfig(b) }),
        bind(b, 'proj', 'select', { label: 'Projection', options: g.MB.PROJ }),
        bind(b, 'region', 'select', { label: 'Camera view', options: g.MB.regionList, after: () => { b.view = null; b.view2 = null; S.editEnd = false; renderPanels(); } }),
        bind(mv, 'z', 'range', { min: 0, max: 18, step: 0.05, label: 'Zoom', after:updateZoomBadge }),
        bind(b, 'showZoomBadge', 'check', { label: 'Show zoom level', after:updateZoomBadge }),
        bind(mv, 'b', 'range', { min: -180, max: 180, step: 1, label: 'Rotate' }),
        bind(mv, 'p', 'range', { min: 0, max: 70, step: 1, label: 'Tilt' }),
        h('div', { className: 'btnrow mapviewbtns' },
          h('button', { text: '↥ North Up / Flat', title: 'Keep this location and zoom, but remove rotation and tilt', on: { click: resetMapOrientation } }),
          h('button', { text: '⌂ Default View', title: 'Return to your saved default starting map', on: { click: loadDefaultMap } }),
          h('button', { text: '★ Save Current as Default', title: 'Use the current map and map settings as the starting default', on: { click: saveCurrentMapDefault } })
        ),
        h('div', { className: 'btnrow' }, h('button', { text: g.MB.hasToken() ? 'Mapbox settings…' : 'Add Mapbox token…', className: g.MB.hasToken() ? '' : 'on', on: { click: mapboxSettings } })),
        h('div', { className: 'hint', text: b.mbStyle==='broadcast'?'Mouse: left-drag to pan · right-drag to rotate/tilt · wheel to zoom. Live Mapbox navigation uses the fast preview path; WXfusion Weather Director cartography remains active.':'Mouse: left-drag empty map to pan · right-drag to rotate/tilt · wheel to zoom.' })
      ];
      p.append(mapAccordion('basic','Map + Camera',basic,true));

      if(b.mbStyle==='broadcast'){
        const B=(k,kind,o)=>bind(b,k,kind,o);
        const base=[
          B('broadcastBase','select',{label:'Base',rerender:true,options:[['satellite','Satellite broadcast'],['terrain','Terrain / cartographic']]}),
          B('atmosphere','select',{label:'Atmosphere',options:[['broadcast','Broadcast blue'],['natural','Natural'],['dark','Dark space'],['none','None']]}),
          B('terrain','check',{label:'3D terrain',rerender:true})
        ];
        if(b.terrain)base.push(B('terrainExaggeration','range',{label:'Terrain strength',min:0,max:3,step:.1}));
        if(b.broadcastBase==='satellite'){
          base.push(B('broadcastSatelliteSaturation','range',{label:'Satellite saturation',min:-1,max:1,step:.05}));
          base.push(B('broadcastSatelliteContrast','range',{label:'Satellite contrast',min:-1,max:1,step:.05}));
        }
        p.append(mapAccordion('base','Weather Director Base',base,false));

        const landWater=[
          B('broadcastWaterColor','color',{label:'Ocean color (when On)',after:()=>updateMapStyleCardPreviews(b)}),
          B('broadcastOceanShow','check',{label:'Show ocean on flat maps',rerender:true}),
          B('showWaterDepth','check',{label:'Show water depth',rerender:true})
        ];
        landWater.push(B('waterDepthColor','color',{label:'Depth color'}));
        landWater.push(zoomRangeRow(b,'Water depth','waterDepthMinZoom','waterDepthMaxZoom',{min:0,max:24,step:.5}));

        const parkNodes=[B('showNationalParks','check',{label:'National parks',rerender:true})];
        parkNodes.push(B('nationalParkColor','color',{label:'Color'}));
        parkNodes.push(zoomRangeRow(b,'National parks','nationalParkMinZoom','nationalParkMaxZoom',{min:0,max:24,step:.5}));
        landWater.push(mapAccordion('nationalParks','National Parks',parkNodes,false));

        const buildingNodes=[
          B('showBuildingFootprints','check',{label:'Building footprints',rerender:true})
        ];
        buildingNodes.push(B('buildingFootprintColor','color',{label:'Footprint color'}));
        buildingNodes.push(B('show3DBuildings','check',{label:'3D buildings',rerender:true}));
        buildingNodes.push(B('building3DHeight','range',{label:'3D height (%)',min:0,max:3,step:.05}));
        landWater.push(mapAccordion('buildings','Buildings',buildingNodes,false));
        landWater.push(h('div',{className:'hint',text:'Water depth uses Mapbox Bathymetry v2. National parks and buildings use Mapbox Streets data.'}));
        p.append(mapAccordion('land','Land + Water',landWater,false));

        // Aguacero-style independent expandable place-label categories.
        // Each group owns its font, size, text fill, outline, density,
        // prominence, zoom range, background/shadow and optional city dots.
        // Existing global label properties remain stored for compatibility.
        const placeFonts=[
          ['DIN Pro Bold','DIN Pro Bold'],['DIN Pro Medium','DIN Pro Medium'],
          ['Roboto Bold','Roboto Bold'],['Roboto Medium','Roboto Medium'],
          ['Open Sans Bold','Open Sans Bold'],['Open Sans Semibold','Open Sans Semibold'],
          ['Open Sans Regular','Open Sans Regular']
        ];
        // AguaceroWX-style label editor. Scope presentation ONLY to these
        // label groups; the settings object and the Mapbox render pipeline
        // are deliberately not changed.
        const aguaSlider=(key,label,min,max,step,unit='')=>{
          const value=h('span',{className:'mapstyle-slider-value',text:String(b[key])+unit});
          const input=h('input',{type:'range',min,max,step,value:b[key]});
          const fmt=n=>String(Number((+n).toFixed(3)))+unit;
          input.addEventListener('input',()=>{
            b[key]=+input.value;value.textContent=fmt(input.value);
          });
          input.addEventListener('change',commit);
          return h('div',{className:'row agua-value-row'},
            h('label',{text:label}),h('div',{className:'mapstyle-slider'},input,value));
        };
        const aguaHeaderGroup=(key,title,enableKey,items,defaultOpen=false)=>{
          const toggle=h('input',{type:'checkbox',checked:!!b[enableKey],
            className:'agua-section-toggle','aria-label':'Enable '+title});
          // Checkboxes in an expandable summary must not toggle the heading.
          toggle.addEventListener('click',e=>e.stopPropagation());
          toggle.addEventListener('keydown',e=>e.stopPropagation());
          toggle.addEventListener('change',()=>{
            b[enableKey]=toggle.checked;commit();renderPanels();
          });
          const open=S.mapAcc[key]==null?!!defaultOpen:!!S.mapAcc[key];
          const box=h('details',{className:'mapacc agua-label-group',open},
            h('summary',{className:'agua-label-summary'},
              h('span',{text:title}),toggle),
            h('div',{className:'mapaccbody agua-label-body'},...items));
          box.addEventListener('toggle',()=>{S.mapAcc[key]=box.open;});
          return box;
        };
        const aguaZoom=(title,minKey,maxKey)=>
          h('div',{className:'agua-zoom-section'},
            h('div',{className:'agua-section-title',text:'Zoom range'}),
            zoomRangeRow(b,title+' labels',minKey,maxKey,{min:0,max:24,step:.5}));
        const aguaDotHeader=(tier,title)=>{
          const key='broadcast'+tier+'Dots';
          return h('div',{className:'agua-dot-heading'},
            h('strong',{text:title+' dots'}),
            B(key,'check',{label:'',rerender:true}));
        };
        const placeTier=(tier,title)=>{
          const prefix='broadcast'+tier;
          const items=[
            B(prefix+'Font','select',{label:'Font',options:placeFonts}),
            aguaSlider(prefix+'Size','Size',7,40,1,'px'),
            B(prefix+'Color','color',{label:'Text color'}),
            B(prefix+'HaloColor','color',{label:'Outline color'}),
            aguaSlider(prefix+'HaloWidth','Outline width',0,6,.25,'px'),
            aguaSlider(prefix+'DensityPct','Density',0,100,1,'%'),
            B(prefix+'Population','select',{label:'Population',options:[
              ['all','All'],['major','Major only'],['top','Most prominent']
            ]}),
            B(prefix+'TextBackground','check',{label:'Text background',rerender:true})
          ];
          if(b[prefix+'TextBackground'])
            items.push(B(prefix+'BackgroundColor','color',{label:'Background color'}));
          items.push(
            B(prefix+'DropShadow','check',{label:'Drop shadow'}),
            aguaZoom(tier,prefix+'MinZoom',prefix+'MaxZoom'),
            aguaDotHeader(tier,tier),
            B(prefix+'DotColor','color',{label:'Dot color'}),
            B(prefix+'DotOutlineColor','color',{label:'Outline color'}),
            aguaSlider(prefix+'DotOutlineWidth','Outline width',0,5,.25,'px'),
            aguaSlider(prefix+'DotSize','Size',1,12,.5,'px'),
            aguaSlider(prefix+'DotNameOffset','Name offset',0,20,.5,'px'),
            B(prefix+'DotShadow','check',{label:'Drop shadow'}),
            mapAccordion('agua-advanced-'+tier.toLowerCase(),'Advanced text options',[
              B(prefix+'Uppercase','check',{label:'Uppercase'}),
              aguaSlider(prefix+'Opacity','Text opacity',0,1,.05,''),
              aguaSlider(prefix+'Spacing','Label spacing',0,3,.05,'')
            ],false)
          );
          // Each tier is visible and editable even when disabled, matching
          // the recorded AguaceroWX dialog; no style values are reset.
          return aguaHeaderGroup('places-'+tier.toLowerCase(),title,
            prefix+'Enabled',items,tier==='City');
        };
        const auxLabelTier=(tier,title)=>{
          const prefix='broadcast'+tier+'Label';
          const nodes=[
            B(prefix+'Font','select',{label:'Font',options:placeFonts}),
            aguaSlider(prefix+'Size','Size',7,40,1,'px'),
            B(prefix+'Color','color',{label:'Text color'}),
            B(prefix+'HaloColor','color',{label:'Outline color'}),
            aguaSlider(prefix+'HaloWidth','Outline width',0,6,.25,'px'),
            B(prefix+'DropShadow','check',{label:'Drop shadow'}),
            aguaZoom(tier,prefix+'MinZoom',prefix+'MaxZoom')
          ];
          return aguaHeaderGroup('aux-'+tier.toLowerCase(),title,
            prefix+'Enabled',nodes,false);
        };
        const roadSignControls=()=>aguaHeaderGroup('aux-road-signs','Road Signs',
          'broadcastShowRoadShields',[
            aguaSlider('broadcastRoadShieldSize','Size',.5,2,.05,'×'),
            aguaSlider('broadcastRoadSignDensityPct','Density',0,100,1,'%'),
            B('broadcastRoadSignInterstates','check',{label:'Interstates'}),
            B('broadcastRoadSignUS','check',{label:'U.S. highways'}),
            B('broadcastRoadSignState','check',{label:'State routes'}),
            B('broadcastRoadSignOther','check',{label:'Other signs'}),
            B('broadcastRoadSignExits','check',{label:'Exits'}),
            aguaZoom('Road sign','broadcastRoadShieldMinZoom','broadcastRoadShieldMaxZoom')
          ],false);
        const roadNameControls=()=>aguaHeaderGroup('aux-road-names','Road Names',
          'broadcastShowRoadLabels',[
            B('broadcastRoadNameFont','select',{label:'Font',options:placeFonts}),
            aguaSlider('broadcastRoadNameScale','Size',.5,2,.05,'×'),
            B('broadcastRoadNameColor','color',{label:'Text color'}),
            B('broadcastRoadNameHaloColor','color',{label:'Outline color'}),
            aguaSlider('broadcastRoadNameHaloWidth','Outline width',0,6,.25,'px'),
            aguaSlider('broadcastRoadNameDensityPct','Density',0,100,1,'%'),
            B('broadcastRoadNameTextBackground','check',{label:'Text background'}),
            B('broadcastRoadNameDropShadow','check',{label:'Drop shadow'}),
            aguaZoom('Road name','broadcastRoadLabelMinZoom','broadcastRoadLabelMaxZoom')
          ],false);
        const applyAguaLabels=()=>{
          // Mapbox DEFAULTS, this restore button, and new-map settings all
          // share one verified Aguacero place-label reference. Avoid
          // duplicating numeric values here where they can go out of sync.
          if(!g.MB?.applyAguaceroPlaceLabels){
            toast('AguaceroWX label preset is not loaded; no changes made.');
            return;
          }
          g.MB.applyAguaceroPlaceLabels(b);
          commit();renderPanels();
          toast('AguaceroWX recorded label settings restored (all categories)');
        };
        p.append(mapAccordion('labels','Place Labels',[
          h('div',{className:'btnrow'},h('button',{text:'Apply my AguaceroWX label settings',on:{click:applyAguaLabels}})),
          h('div',{className:'hint',text:'Restores the AguaceroWX settings from your October 17 recording: all four 16 px place categories, plus road names, road signs, airports and disabled auxiliary label groups. No changes to map backgrounds, road geometry, boundaries or scene objects.'}),
          B('broadcastShowCities','check',{label:'Show places',rerender:true}),
          B('broadcastKeepMajorCities','check',{label:'Keep major cities'}),
          B('broadcastOverviewCityDensity','select',{label:'Overview city coverage (below zoom 7.5)',options:[
            ['standard','Standard'],['more','More cities'],['many','Many cities']]}),
          B('broadcastOverviewLabelGap','range',{label:'Overview label gap (px)',min:0,max:20,step:.5}),
          B('broadcastAutoDeclutter','check',{label:'Automatically declutter labels when zoomed out',rerender:true}),
          ...(b.broadcastAutoDeclutter!==false?[
            aguaSlider('broadcastDeclutterStrength','Decluttering strength',0,2,.1,'×'),
            h('div',{className:'hint',text:'Preserves your selected font and 16 px sizes. Increases collision spacing at broad zoom levels so fewer names compete; normal spacing returns as you zoom closer. Lowering City/Town density also works below zoom 7.5.'})
          ]:[]),
          B('broadcastMajorCityRank','range',{label:'Major-city rank — higher shows more',min:1,max:19,step:1}),
          B('broadcastMajorCityMinZoom','range',{label:'Major-city minimum zoom',min:0,max:12,step:.5}),
          B('broadcastHideAllLabels','check',{label:'Hide all labels'}),
          B('broadcastUppercaseLabels','check',{label:'All caps (map labels)'}),
          B('broadcastLabelFade','check',{label:'Fade labels in/out'}),
          roadSignControls(),
          roadNameControls(),
          auxLabelTier('Continent','Continent Labels'),
          auxLabelTier('Country','Country Labels'),
          auxLabelTier('State','State Labels'),
          auxLabelTier('County','County Labels'),
          placeTier('City','Cities'),
          placeTier('Town','Towns'),
          placeTier('Village','Villages'),
          placeTier('Hamlet','Hamlets'),
          auxLabelTier('Airport','Airport Labels'),
          auxLabelTier('POI','Points of Interest'),
          auxLabelTier('Subdivision','Subdivision Labels'),
          auxLabelTier('Water','Water Labels'),
          auxLabelTier('Natural','Natural Feature Labels')
        ],false));

        // All four boundary width sliders share ONE physical pixel scale.
        // A thumb at the same position always means exactly the same width.
        const bw={min:0.25,max:8,step:0.05};
        const boundaries=[
          B('broadcastShowCoastline','check',{label:'Ocean & island coastlines'}),
          B('broadcastCoastlineColor','color',{label:'Ocean coastline color'}),
          B('broadcastCoastlineWidth','range',{label:'Ocean coastline width (px)',...bw}),
          B('broadcastInlandWaterOutlines','check',{label:'Inland water outlines',rerender:true}),
          B('broadcastInlandWaterOutlineColor','color',{label:'Inland outline color'}),
          B('broadcastInlandWaterOutlineWidth','range',{label:'Inland outline width (px)',...bw}),
          B('broadcastShowCountryBorders','check',{label:'Country borders'}),
          B('broadcastCountryColor','color',{label:'Country color'}),
          B('broadcastCountryWidth','range',{label:'Country width (px)',...bw}),
          B('broadcastShowStateBorders','check',{label:'State borders'}),
          B('broadcastStateColor','color',{label:'State color'}),
          B('broadcastStateWidth','range',{label:'State width (px)',...bw}),
          B('broadcastShowCountyBorders','check',{label:'County borders',rerender:true}),
          B('broadcastCountyColor','color',{label:'County color'}),
          B('broadcastCountyWidth','range',{label:'County width (px)',...bw}),
          B('broadcastCountyMinZoom','num',{label:'County min zoom',min:0,max:22,step:.5})
        ];
        p.append(mapAccordion('boundaries','Boundaries',boundaries,false));

        const roadStyle=(key,title,subtitle,prefix)=>{
          const nodes=[
            h('div',{className:'hint',text:subtitle}),
            B(prefix+'Show','check',{label:'Enabled',rerender:true})
          ];
          if(b[prefix+'Show']!==false){
            nodes.push(B(prefix+'Color','color',{label:'Color'}));
            nodes.push(B(prefix+'Width','range',{label:'Width (px)',min:.05,max:8,step:.05}));
            nodes.push(B(prefix+'Opacity','range',{label:'Opacity (%)',min:0,max:1,step:.01}));
            nodes.push(B(prefix+'Outline','check',{label:'Outline',rerender:true}));
            if(b[prefix+'Outline']){
              nodes.push(B(prefix+'OutlineColor','color',{label:'Outline color'}));
              nodes.push(B(prefix+'OutlineWidth','num',{label:'Outline width',min:0,max:4,step:.1}));
            }
            nodes.push(zoomRangeRow(b,'Zoom range',prefix+'MinZoom',prefix+'MaxZoom',{min:0,max:24,step:.5}));
          }
          return mapAccordion(key,title,nodes,false);
        };

        const roads=[
          B('broadcastShowRoads','check',{label:'Roads',rerender:true})
        ];
        if(b.broadcastShowRoads!==false){
          roads.push(h('div',{className:'hint',text:'AguaceroWX road styling · exact colors, widths, opacities and zoom thresholds from your screenshots.'}));
          roads.push(roadStyle('roadInterstate','Interstates','Motorway','roadInterstate'));
          roads.push(roadStyle('roadMajor','Major Highways','Trunk','roadMajor'));
          roads.push(roadStyle('roadState','State Highways','Primary','roadState'));
          roads.push(roadStyle('roadCounty','County & Regional','Secondary','roadCounty'));
          roads.push(roadStyle('roadLocalPaved','Local (Paved)','Tertiary paved','roadLocalPaved'));
          roads.push(roadStyle('roadLocalUnpaved','Local (Unpaved)','Tertiary unpaved / track','roadLocalUnpaved'));
          roads.push(roadStyle('roadResidential','Residential & Minor','Street','roadResidential'));
          roads.push(roadStyle('roadService','Alleys & Service','Service / minor','roadService'));
          roads.push(B('broadcastShowRoadShields','check',{label:'Road shields',rerender:true}));
          if(b.broadcastShowRoadShields){
            roads.push(B('broadcastRoadShieldDensity','num',{label:'Shield density',min:1,max:5,step:1}));
            roads.push(B('broadcastRoadShieldSize','num',{label:'Shield size',min:.6,max:2,step:.1}));
            roads.push(zoomRangeRow(b,'Road shields','broadcastRoadShieldMinZoom','broadcastRoadShieldMaxZoom',{min:0,max:24,step:.5}));
          }
          roads.push(B('broadcastShowRoadLabels','check',{label:'Road names',rerender:true}));
          if(b.broadcastShowRoadLabels)roads.push(zoomRangeRow(b,'Road names','broadcastRoadLabelMinZoom','broadcastRoadLabelMaxZoom',{min:0,max:24,step:.5}));
        }

        const airportNodes=[
          B('airportRunwaysShow','check',{label:'Airports',rerender:true})
        ];
        if(b.airportRunwaysShow!==false){
          airportNodes.push(B('airportRunwaysColor','color',{label:'Runway color'}));
          airportNodes.push(B('airportRunwaysWidth','num',{label:'Runway width',min:.05,max:8,step:.1}));
          airportNodes.push(zoomRangeRow(b,'Airport runways','airportRunwaysMinZoom','airportRunwaysMaxZoom',{min:0,max:24,step:.5}));
        }
        roads.push(mapAccordion('airports','Airports',airportNodes,false));
        roads.push(B('broadcastShowPOI','check',{label:'POI labels'}));
        roads.push(B('broadcastShowNaturalLabels','check',{label:'Natural labels'}));
        p.append(mapAccordion('roads','Transportation',roads,false));

        const overlayLine=(key,title,prefix)=>{
          const nodes=[B(prefix,'check',{label:title,rerender:true})];
          {
            nodes.push(B(prefix+'Color','color',{label:'Color'}));
            nodes.push(B(prefix+'LineType','select',{label:'Line type',options:[['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']]}));
            nodes.push(B(prefix+'Width','range',{label:'Width (px)',min:.1,max:6,step:.1}));
            nodes.push(B(prefix+'Opacity','range',{label:'Opacity (%)',min:0,max:1,step:.01}));
            nodes.push(zoomRangeRow(b,title,prefix+'MinZoom',prefix+'MaxZoom',{min:0,max:24,step:.5}));
          }
          return mapAccordion('ov-'+key,title,nodes,false);
        };
        const overlays=[
          B('overlayDayNight','check',{label:'Day / night cycle'}),
          overlayLine('cwa','NWS Forecast Areas (CWA)','overlayCWA'),
          overlayLine('public','NWS Public Zones','overlayPublicZones'),
          overlayLine('fire','NWS Fire Weather Zones','overlayFireZones'),
          overlayLine('marine','NWS Coastal Marine Zones','overlayMarineZones'),
          overlayLine('tz','Time Zone Boundaries','overlayTimeZones')
        ];
        const gridNodes=[
          B('overlayLatLonMode','select',{label:'Lat / lon grid',rerender:true,options:[['off','Off'],['on','On'],['ocean','Ocean Only']]}),
          B('overlayLatLonColor','color',{label:'Color'}),
          B('overlayLatLonWidth','range',{label:'Line width (px)',min:.1,max:4,step:.05}),
          B('overlayLatLonOpacity','range',{label:'Opacity (%)',min:0,max:1,step:.01}),
          B('overlayLatLonAutoSpacing','check',{label:'Auto spacing (zoom)',rerender:true})
        ];
        if(!b.overlayLatLonAutoSpacing)
          gridNodes.push(B('overlayLatLonManualSpacing','select',{label:'Grid interval',options:[['.5','0.5°'],['1','1°'],['2','2°'],['5','5°'],['10','10°'],['15','15°'],['30','30°']]}));
        overlays.push(mapAccordion('ov-grid','Lat / Lon Grid',gridNodes,false));
        overlays.push(h('div',{className:'hint',text:'NWS boundaries load from NOAA/NWS reference-map data for the current map area. Time zones use U.S. DOT/BTS boundary data.'}));
        p.append(mapAccordion('overlays','Overlays',overlays,false));
      }
    }

    if (b.type === 'map' || b.type === 'mapbox') {
      const cameraNodes=[h('div', { className: 'btnrow' },
        h('button', { text: 'Edit START view', className: S.editEnd ? '' : 'on', on: { click: () => { S.editEnd = false; renderPanels(); } } }),
        h('button', { text: 'Edit END view', className: S.editEnd ? 'on' : '', on: { click: () => { if (!b.view2) { b.view2 = JSON.parse(JSON.stringify(E.viewAt(sc, 0))); b.camDur = 3; b.camDelay = 0.5; } S.editEnd = true; renderPanels(); } } }),
        b.view2 ? h('button', { text: 'Clear', className: 'dng', on: { click: () => { b.view2 = null; S.editEnd = false; commit(); renderPanels(); } } }) : null)];
      if(b.view2){
        cameraNodes.push(bind(b, 'camDelay', 'range', { min: 0, max: 20, step: 0.1, label: 'Start at (s)' }));
        cameraNodes.push(bind(b, 'camDur', 'range', { min: 0.5, max: 20, step: 0.1, label: 'Move length (s)' }));
      }
      p.append(mapAccordion('cameraMove','Camera Move',cameraNodes,false));
    }

    if (S.show.safe == null) S.show.safe = 48;
    p.append(mapAccordion('layout', 'Layout & Guides', [
      h('div', { className: 'row' }, h('label', { text: 'Snap to guides' }), h('input', { type: 'checkbox', checked: SNAP.on, onchange: e => { SNAP.on = e.target.checked; saveSnap(); } })),
      h('div', { className: 'row' }, h('label', { text: 'Show guides' }), h('input', { type: 'checkbox', checked: SNAP.guides, onchange: e => { SNAP.guides = e.target.checked; saveSnap(); } })),
      bind(S.show, 'safe', 'range', { min: 0, max: 160, step: 4, label: 'Safe margin (px)' }),
      h('div', { className: 'btnrow' }, h('button', { text: 'Align & distribute…', on: { click: alignDialog } }))
    ], false));
    if (!sc.title2) sc.title2 = Object.assign(E.title2Default(), { show: false });
    const T2 = sc.title2; if (!T2.fx) T2.fx = E.fxDefault();
    if (T2.textOnly) p.append(mapAccordion('titleBanner2', 'Banner title (text on your banner artwork)', [
      bind(T2, 'show', 'check', { label: 'Show' }),
      bind(T2, 'text', 'text', { label: 'Title' }),
      bind(T2, 'align', 'select', { label: 'Text align', options: [['center', 'Center'], ['left', 'Left'], ['right', 'Right']] }),
      bind(T2, 'size', 'num', { min: 0, max: 300, label: 'Font size (largest; shrinks to fit, 0 = auto)' }),
      bind(T2, 'font', 'select', { label: 'Font', options: [['Barlow', 'Standard'], ['Roboto Condensed', 'Condensed']] }),
      bind(T2, 'dx', 'range', { min: -600, max: 600, step: 2, label: 'Left / right offset' }),
      bind(T2, 'ty', 'range', { min: -60, max: 60, step: 1, label: 'Up / down offset' }),
      bind(T2, 'upper', 'check', { label: 'ALL CAPS' }),
      bind(T2, 'color', 'color', { label: 'Text color' }),
      bind(T2, 'anim', 'select', { label: 'Entrance', options: [['auto', 'Fade'], ['in-left', 'Slide from left'], ['in-right', 'Slide from right'], ['in-top', 'Slide from top'], ['fade', 'Fade'], ['none', 'None']] }),
      bind(T2, 'delay', 'range', { min: 0, max: 10, step: 0.1, label: 'Delay (s)' }),
      h('div', { className: 'btnrow' }, h('button', { text: 'Text layer style… (stroke, shadow, glow)', on: { click: () => openFxWindow(T2.fx, 'Layer Style – Banner title') } }))
    ], true));
    else p.append(mapAccordion('titleBanner2', 'Banner & Logo', [
      bind(T2, 'show', 'check', { label: 'Show' }),
      bind(T2, 'text', 'text', { label: 'Title' }),
      bind(T2, 'pos', 'select', { label: 'Position', options: [['ul', 'Upper left'], ['ur', 'Upper right'], ['full', 'Full width']] }),
      bind(T2, 'autoWidth', 'check', { label: 'Fit banner to text', rerender: true, after: v => { if (v && !(T2.height > 0)) T2.height = Math.round(142 * ((T2.pos === 'full' ? 1824 : (T2.width || 1150)) / 1064)); } }),
      T2.autoWidth ? bind(T2, 'minW', 'range', { min: 0, max: 1800, step: 10, label: 'Minimum width (px, 0 = none)' }) : bind(T2, 'width', 'range', { min: 500, max: 1800, step: 10, label: 'Width (px)' }),
      bind(T2, 'height', 'range', { min: 0, max: 300, label: 'Banner height (px, 0 = original)' }),
      bind(T2, 'y', 'range', { min: 0, max: 300, label: 'Top offset' }),
      bind(T2, 'dx', 'range', { min: -1000, max: 1000, step: 2, label: 'Left / right offset' }),
      bind(T2, 'logo', 'check', { label: 'Show logo', rerender: true }),
      T2.logo !== false ? bind(T2, 'logoScale', 'range', { min: 0.6, max: 2, step: 0.05, label: 'Logo size' }) : null,
      bind(T2, 'align', 'select', { label: 'Text align', options: [['center', 'Center'], ['left', 'Left'], ['right', 'Right']] }),
      bind(T2, 'size', 'num', { min: 0, max: 300, label: 'Font size (0 = auto)' }),
      bind(T2, 'upper', 'check', { label: 'ALL CAPS' }),
      bind(T2, 'color', 'color', { label: 'Text color' }),
      bind(T2, 'anim', 'select', { label: 'Entrance', options: [['auto', 'Automatic (from its edge)'], ['in-left', 'Slide from left'], ['in-right', 'Slide from right'], ['in-top', 'Slide from top'], ['fade', 'Fade'], ['none', 'None']] }),
      bind(T2, 'delay', 'range', { min: 0, max: 10, step: 0.1, label: 'Delay (s)' }),
      h('div', { className: 'btnrow' }, h('button', { text: 'Text layer style… (stroke, shadow, glow)', on: { click: () => openFxWindow(T2.fx, 'Layer Style – Banner & Logo') } }))
    ].filter(Boolean), false));
    p.append(mapAccordion('titleBanner','Standard Banner',[
      bind(sc.title, 'show', 'check', { label: 'Show' }),
      bind(sc.title, 'text', 'text', { label: 'Title' }),
      bind(sc.title, 'sub', 'text', { label: 'Subtitle' }),
      bind(sc.title, 'pos', 'select', { label: 'Position', options: [['top-left', 'Top left'], ['bottom-left', 'Bottom left']] })
    ],false));

    const showNodes=[
      bind(S.show, 'accent', 'color', { label: 'Accent colour' }),
      bind(S.show, 'bugText', 'text', { label: 'Corner tag text' }),
      fld('Logo', h('div', { className: 'btnrow' },
        h('button', { text: S.show.logo ? 'Replace logo…' : 'Upload logo…', on: { click: () => pickImages('logo') } }),
        S.show.logo ? h('button', { text: 'Remove', on: { click: () => { S.show.logo = null; commit(); renderPanels(); } } }) : null))
    ];
    p.append(mapAccordion('showBranding','Show + Branding',showNodes,false));
  }

  function libraryPanel(p) {
    p.append(h('div', { className: 'hint', text: 'Click an icon to place it (or swap the selected icon). Animated icons export to video (the 7-Day builder uses these); Static copies are the same artwork frozen for other projects.' }));
    const cats = {}; g.Icons.list.forEach(i => (cats[i.cat] = cats[i.cat] || []).push(i));
    Object.keys(cats).forEach(c => { p.append(h('div', { className: 'h', text: c })); const gr = h('div', { className: 'igrid' }); cats[c].forEach(i => { const cv = h('canvas', { width: 120, height: 120 }); cv.dataset.icon = i.id; gr.append(h('div', { className: 'ic' + (S.opt.icon === i.id ? ' on' : ''), title: i.label, draggable: true, ondragstart: ev => { ev.dataTransfer.setData('application/x-wx-icon', i.id); ev.dataTransfer.effectAllowed = 'copy'; }, on: { click: () => { S.opt.icon = i.id; const o = selObj(); if (o && o.type === 'icon') { o.icon = i.id; commit(); } else setTool('icon'); renderPanels(); } } }, cv, h('div', { text: i.label }))); }); p.append(gr); });
  }
  /* ---------- saved backgrounds ---------- */
  const BGD_KEY = 'wx_bg_default'; let bgList = [], bgDefault = 'sky';
  try { bgDefault = localStorage.getItem(BGD_KEY) || 'sky'; } catch (e) { /* ignore */ }
  const builtinBgs = () => [{ id: 'sky', name: 'Default sky', data: g.WX_BGDEFAULT, asset: 'bgdefault', builtin: true }, { id: 't7', name: 'Billerica 7-Day template', data: g.WX_BG7DAY, asset: 'bg7day', builtin: true }].filter(b => b.data);
  const bgAll = () => builtinBgs().concat(bgList);
  function bgDB() { return new Promise((res, rej) => { try { const r = indexedDB.open('wxstudio-bgs', 1); r.onupgradeneeded = () => r.result.createObjectStore('bgs', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }); }
  const ownStore = s => ({ put: r => s.put(NS ? Object.assign({}, r, { owner: NS }) : r), delete: k => s.delete(k), getAll: () => s.getAll(), get: k => s.get(k) }), mine = r => (r.owner || null) === NS;
  function bgTx(mode, fn) { return bgDB().then(db => new Promise((res, rej) => { const t = db.transaction('bgs', mode), s = t.objectStore('bgs'), q = fn(ownStore(s)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); })); }
  function bgLoad() { bgTx('readonly', s => s.getAll()).then(a => { bgList = (a || []).filter(mine).sort((x, y) => x.t - y.t).map(b => Object.assign(b, { asset: (kindOf(b) === 'bg' ? 'bg_' : 'ov_') + b.id })); reattachLib(); if (S.tab === 'bgs') renderPanels(); }).catch(() => { }); }
  function reattachLib() { if (!S.show) return; let ch = false; S.show.scenes.forEach(sc => [sc.bg && sc.bg.asset].concat(sc.objects.map(o => o.asset)).forEach(id => { if (id && !S.show.assets[id]) { const b = bgList.find(x => x.asset === id); if (b) { S.show.assets[id] = b.data; ch = true; } } })); if (ch) E.preload(S.show).then(() => thumbSoon(true)); }
  function bgScale(file, keepAlpha) { return new Promise((res, rej) => { const r = new FileReader(); r.onerror = rej; r.onload = () => { const im = new Image(); im.onerror = rej; im.onload = () => { const k = Math.min(1, 2560 / im.width); if (keepAlpha && k === 1 && /png/i.test(file.type)) return res(r.result); const cv = document.createElement('canvas'); cv.width = Math.round(im.width * (keepAlpha ? k : Math.min(1, 1920 / im.width))); cv.height = Math.round(im.height * (cv.width / im.width)); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); res(keepAlpha ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.88)); }; im.src = r.result; }; r.readAsDataURL(file); }); }
  const kindOf = b => b.kind || 'bg';
  async function bgAdd(files, kind) {
    kind = kind || 'bg';
    for (const f of files) {
      if(kind!=='bg'&&!(/\.png$/i.test(f.name)&&(!f.type||f.type==='image/png'))){
        toast('Banners and graphics must be PNG files to keep transparency.');continue;
      }
      if(kind!=='bg'&&f.size>8*1024*1024){toast(f.name+': PNG exceeds the 8 MB limit.');continue;}
      if(kind==='bg'&&!/^image\//.test(f.type))continue;
      try {
        // Keep original banner/graphic PNG bytes intact. Never canvas-resize,
        // recompress or convert them to JPEG as with background photos.
        const data=kind==='bg'?await bgScale(f,false):await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=()=>resolve(reader.result);
          reader.onerror=()=>reject(reader.error||Error('PNG read failed'));
          reader.readAsDataURL(f);
        });
        const b = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: f.name.replace(/\.[^.]+$/, ''), data, t: Date.now(), kind }; b.asset = (kind === 'bg' ? 'bg_' : 'ov_') + b.id; bgList.push(b); await bgTx('readwrite', s => s.put({ id: b.id, name: b.name, data, t: b.t, kind })).catch(() => toast('Saved for this session only (browser storage unavailable)')); } catch (e) { toast('Could not read ' + f.name); } }
    renderPanels();
  }

  /* ---- Private Supabase cloud Assets. Keep local IndexedDB independent. ---- */
  const ASSET_CLOUD=()=>g.WXCloudAssets;
  const AC={checked:false,uid:null,rows:{},loaded:{},attempted:{},loading:null,busy:false,
    status:'',thumbs:new Map()};
  const cloudKind=k=>k==='bg'?'background':k;
  const localKind=k=>k==='background'?'bg':k;
  const assetsVisible=()=>S.show&&S.tab==='bgs';
  const cloudFail=e=>String(e?.message||e||'Cloud unavailable');
  const renderAssetCloud=()=>{if(assetsVisible())renderPanels();};
  async function loadCloudAssets(kind){
    if(!ASSET_CLOUD()?.configured()||AC.loading===kind)return;
    AC.loading=kind;AC.status='';
    try{
      const user=await ASSET_CLOUD().session();
      if(AC.uid!==user.user.id){
        AC.uid=user.user.id;AC.rows={};AC.loaded={};AC.attempted={};AC.thumbs.clear();
      }
      AC.attempted[kind]=true;
      AC.rows[kind]=await ASSET_CLOUD().list(kind);
      AC.loaded[kind]=true;
    }catch(e){AC.attempted[kind]=true;AC.status='Could not load cloud assets: '+cloudFail(e);AC.loaded[kind]=false;}
    finally{AC.loading=null;renderAssetCloud();}
  }
  async function cloudUploadPng(b){
    // Existing JPG/photo background files stay unchanged in IndexedDB.
    // Only a cloud BACKGROUND copy may be encoded as PNG; banner and
    // graphic PNG bytes are returned untouched.
    if(kindOf(b)!=='bg'||/^data:image\/png;base64,/i.test(b.data))return b.data;
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onerror=()=>reject(Error('Could not read background image for cloud PNG upload.'));
      img.onload=()=>{
        try{
          const cv=document.createElement('canvas');cv.width=img.naturalWidth;cv.height=img.naturalHeight;
          const context=cv.getContext('2d');if(!context)throw Error('Canvas unavailable.');
          context.drawImage(img,0,0);resolve(cv.toDataURL('image/png'));
        }catch(e){reject(e);}
      };
      img.src=b.data;
    });
  }
  async function saveAssetCloud(b,silent){
    const k=cloudKind(kindOf(b));
    try{
      const rows=await ASSET_CLOUD().list(k);
      if(!silent&&rows.some(x=>x.name===b.name)&&
         !confirm('Replace cloud '+k+' named "'+b.name+'"? Your local copy will be kept.'))return false;
      await ASSET_CLOUD().save({name:b.name,kind:k,data:await cloudUploadPng(b)});
      AC.loaded[k]=false;AC.thumbs.clear();
      return true;
    }catch(e){if(!silent)toast('Cloud upload failed: '+cloudFail(e));throw e;}
  }
  async function uploadOneCloud(b){
    if(AC.busy)return;
    AC.busy=true;AC.status='Uploading "'+b.name+'"…';renderAssetCloud();
    try{
      if(await saveAssetCloud(b,false)){
        AC.status='Saved "'+b.name+'" to your private cloud library.';
        await loadCloudAssets(cloudKind(kindOf(b)));
      }else AC.status='Upload canceled.';
    }catch(e){AC.status='Cloud upload failed: '+cloudFail(e);}
    finally{AC.busy=false;renderAssetCloud();}
  }
  async function uploadAllCloud(kind){
    if(AC.busy)return;
    const local=bgList.filter(b=>kindOf(b)===localKind(kind));
    if(!local.length)return;
    if(!confirm('Upload '+local.length+' local '+kind+'(s) to cloud? Files with matching names will be replaced. Your browser copies stay intact.'))return;
    AC.busy=true;let done=0,skipped=0;
    try{
      for(const item of local){
        AC.status='Uploading '+(done+skipped+1)+' of '+local.length+': '+item.name;
        renderAssetCloud();
        try{await saveAssetCloud(item,true);done++;}
        catch(e){skipped++;AC.status='Skipped '+item.name+': '+cloudFail(e);}
      }
      AC.status='Uploaded '+done+' '+kind+'(s). '+(skipped?skipped+' failed or skipped. ':'')+'Local copies kept.';
      await loadCloudAssets(kind);
    }catch(e){AC.status='Cloud upload interrupted: '+cloudFail(e);}
    finally{AC.busy=false;renderAssetCloud();}
  }
  async function downloadCloudAsset(row){
    if(AC.busy)return;AC.busy=true;AC.status='Downloading '+row.name+'…';renderAssetCloud();
    try{
      const existing=bgList.find(b=>b.cloudId===row.id);
      if(existing){AC.status='"'+row.name+'" is already in this browser. The local copy was not changed.';return;}
      const data=await ASSET_CLOUD().download(row);
      const k=localKind(row.kind),id=Date.now().toString(36)+Math.random().toString(36).slice(2,9);
      // IMPORTANT: local overlay identities are unchanged: ov_<local id>.
      const b={id,name:row.name,data,t:Date.now(),kind:k,cloudId:row.id,
        asset:(k==='bg'?'bg_':'ov_')+id};
      bgList.push(b);
      try{await bgTx('readwrite',store=>store.put({
        id:b.id,name:b.name,data:b.data,t:b.t,kind:b.kind,cloudId:b.cloudId
      }));}catch(e){toast('Downloaded for this session; IndexedDB save failed.');}
      reattachLib();AC.status='"'+row.name+'" downloaded. Click it in your local library to use it.';
    }catch(e){AC.status='Cloud download failed: '+cloudFail(e);}
    finally{AC.busy=false;renderAssetCloud();}
  }
  async function deleteCloudAsset(row){
    if(AC.busy||!confirm('Delete "'+row.name+'" from your cloud account? Browser copies will NOT be deleted.'))return;
    AC.busy=true;
    try{
      await ASSET_CLOUD().remove(row);
      AC.rows[row.kind]=(AC.rows[row.kind]||[]).filter(r=>r.id!==row.id);
      AC.thumbs.clear();AC.status='Deleted cloud copy of "'+row.name+'".';
    }catch(e){AC.status='Cloud delete failed: '+cloudFail(e);}
    finally{AC.busy=false;renderAssetCloud();}
  }
  async function renameCloudAsset(row){
    if(AC.busy)return;
    const name=prompt('Rename cloud '+row.kind+':',row.name);
    if(name==null||!name.trim()||name.trim()===row.name)return;
    AC.busy=true;
    try{
      const updated=await ASSET_CLOUD().rename(row,name.trim());
      Object.assign(row,updated||{name:name.trim()});
      AC.status='Cloud asset renamed. Existing local copies are unchanged.';
    }catch(e){AC.status='Cloud rename failed: '+cloudFail(e);}
    finally{AC.busy=false;renderAssetCloud();}
  }
  function cloudThumb(row,img){
    const key=row.id+'@'+row.updated_at;
    const existing=AC.thumbs.get(key);
    if(existing?.url){img.src=existing.url;return;}
    if(existing?.pending)return;
    AC.thumbs.set(key,{pending:true});
    ASSET_CLOUD().signedThumbnail(row).then(url=>{
      AC.thumbs.set(key,{url,pending:false});
      if(img.isConnected)img.src=url;
      else renderAssetCloud();
    }).catch(()=>{AC.thumbs.delete(key);});
  }
  function cloudAssetsPanel(p,localTab){
    const kind=cloudKind(localTab);
    p.append(h('div',{style:'font-weight:700;margin:14px 0 6px',text:'☁ Cloud library — '+(localTab==='bg'?'Backgrounds':localTab==='banner'?'Banners':'Graphics')}));
    if(!ASSET_CLOUD()?.configured()){
      p.append(h('div',{className:'hint',text:'Cloud is unavailable. All local assets still work.'}));return;
    }
    const user=g.WXCloudPresets?.user();
    if(!user?.id){
      p.append(h('div',{className:'hint',text:'To use cloud assets, sign in at Map Style → Saved Styles → Cloud Presets. Local assets remain available without signing in.'}));
      if(!AC.checked){
        AC.checked=true;
        ASSET_CLOUD().session().then(()=>{
          AC.loaded={};renderAssetCloud();
        }).catch(()=>{}); // signed-out is expected, no popup
      }
      return;
    }
    if(AC.uid!==user.id){
      AC.uid=user.id;AC.loaded={};AC.rows={};AC.attempted={};AC.thumbs.clear();
    }
    p.append(h('div',{className:'hint',text:'Private to '+(user.email||'your account')+'. Click Download to add an item to this browser; your show uses the normal local asset ID.'}));
    const buttons=h('div',{className:'btnrow',style:'margin:8px 0'},
      h('button',{className:'sm',text:'Refresh cloud',on:{click:()=>loadCloudAssets(kind)}}),
      h('button',{className:'sm pri',text:'Upload all local items to cloud',on:{click:()=>uploadAllCloud(kind)}}));
    p.append(buttons);
    // Try automatically once per account/tab. On a network failure, wait
    // for Refresh cloud instead of infinite fetch/re-render retries.
    if(!AC.attempted[kind]&&AC.loading!==kind)Promise.resolve().then(()=>loadCloudAssets(kind));
    if(AC.loading===kind)p.append(h('div',{className:'hint',text:'Loading cloud library…'}));
    const rows=AC.rows[kind]||[];
    if(AC.loaded[kind]&&!rows.length)p.append(h('div',{className:'hint',text:'Nothing in your cloud '+kind+' library yet.'}));
    const gr=h('div',{style:'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px'});
    rows.forEach(row=>{
      const image=h('img',{alt:row.name,style:'width:100%;aspect-ratio:16/9;object-fit:contain;border-radius:5px;display:block;background:repeating-conic-gradient(#2a3342 0% 25%,#1c2430 0% 50%) 0 0/16px 16px'});
      cloudThumb(row,image);
      gr.append(h('div',{style:'padding:6px;border:1px solid #42516a;border-radius:6px;min-width:0;cursor:pointer',
        title:'Download "'+row.name+'" to this browser',
        on:{click:()=>downloadCloudAsset(row)}},
        image,h('div',{className:'hint',text:row.name,style:'margin:5px 0;overflow-wrap:anywhere'}),
        h('button',{className:'sm pri',text:'Download',on:{click:e=>{e.stopPropagation();downloadCloudAsset(row);}}}),
        h('button',{className:'sm',text:'Rename',on:{click:e=>{e.stopPropagation();renameCloudAsset(row);}}}),
        h('button',{className:'sm dng',text:'Delete',on:{click:e=>{e.stopPropagation();deleteCloudAsset(row);}}})
      ));
    });
    p.append(gr);
    if(AC.status)p.append(h('div',{className:'hint',style:'margin-top:8px;overflow-wrap:anywhere',text:AC.status}));
  }

  /* ---------- video library (MP4/WebM backgrounds; stored in this browser's IndexedDB) ---------- */
  let vidList = [];
  const vidDB = () => new Promise((res, rej) => { try { const r = indexedDB.open('wxstudio-vids', 1); r.onupgradeneeded = () => r.result.createObjectStore('v', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
  const vidTx = async (mode, fn) => { const d = await vidDB(); return new Promise((res, rej) => { const t = d.transaction('v', mode), s = t.objectStore('v'), q = fn(ownStore(s)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  async function restoreVideos() { try { vidList = ((await vidTx('readonly', s => s.getAll())) || []).filter(mine); vidList.sort((a, b) => b.t - a.t); vidList.forEach(r => (r.kind === 'gif' ? E.registerGif : E.registerVideo)(r.id, r.blob, r.name)); if (S.tab === 'bgs') renderPanels(); } catch (e) { /* IndexedDB unavailable */ } }
  async function addVideoFiles(files) {
    for (const f of files) {
      const isGif = f.type === 'image/gif' || /\.gif$/i.test(f.name);
      if (!isGif && !/^video\//.test(f.type) && !/\.(mp4|m4v|mov|webm)$/i.test(f.name)) { toast('Not a video or GIF file: ' + f.name); continue; }
      const rec = { id: 'vid_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: f.name.replace(/\.[^.]+$/, ''), blob: f, t: Date.now(), kind: isGif ? 'gif' : 'video' };
      (isGif ? E.registerGif : E.registerVideo)(rec.id, f, rec.name); vidList.unshift(rec);
      try { await vidTx('readwrite', s => s.put(rec)); } catch (e) { toast('Could not save the video in this browser (it will work until you reload)'); }
    }
    renderPanels();
  }
  function useVideo(rec) {
    const sc = cur(), v = E.videos[rec.id]; if (v.err) { toast('This GIF could not be read: ' + v.err); return; } const go = () => { const asp = v.w / v.h; sc.bg = Object.assign({}, sc.bg, { type: 'video', vid: rec.id, vidStart: 0, vidLoop: !!v.gif, fit: Math.abs(asp - 16 / 9) < 0.04 ? 'fill' : 'blur', kenburns: false }); if (v.dur > 0) sc.duration = Math.max(1, Math.round(v.dur * 10) / 10); commit(); refreshAll(); toast('Video set as this scene’s background (scene length matched to the video)'); };
    if (v.ok) go(); else if (v.gif) { toast('Reading GIF frames…'); const iv = setInterval(() => { if (v.ok) { clearInterval(iv); go(); } else if (v.err) { clearInterval(iv); toast('This GIF could not be read: ' + v.err); } }, 150); } else { toast('Loading video…'); v.el.addEventListener('loadedmetadata', () => setTimeout(go, 50), { once: true }); }
  }
  function videosPanel(p) {
    p.append(h('div', { className: 'hint', text: 'Upload an MP4 or an animated GIF (for example a satellite/radar loop from AguaceroWX) and use it as a scene background. GIFs keep looping for as long as the scene lasts. Videos are kept in this browser. When you Save, a show that uses videos or GIFs is packaged into one .wxshow file that carries them, so it opens on another computer. Sound is not included.' }));
    const fi = h('input', { type: 'file', accept: 'video/*,image/gif,.mp4,.m4v,.mov,.webm,.gif', multiple: true, style: 'display:none', onchange: e => { addVideoFiles([...e.target.files]); e.target.value = ''; } });
    const dz = h('div', { id: 'drop', text: 'Upload videos or animated GIFs: click to browse or drop files here' }); dz.onclick = () => fi.click();
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('hov'); })); dz.addEventListener('dragleave', () => dz.classList.remove('hov'));
    dz.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('hov'); addVideoFiles([...e.dataTransfer.files]); });
    p.append(fi, dz);
    const sc = cur(), b = sc.bg;
    if (b.type === 'video') {
      const v = E.videos[b.vid]; p.append(h('div', { className: 'h', text: 'This scene’s video' }), h('div', { className: 'hint', text: (v ? v.name + (v.dur ? ' – ' + v.dur.toFixed(1) + ' s, ' + v.w + '×' + v.h : '') : 'Video not found in this browser') }),
        bind(b, 'fit', 'select', { label: 'Video fit', rerender: true, options: [['fill', 'Fill (crop edges)'], ['blur', 'Fit whole video + blurred fill'], ['solid', 'Fit whole video + solid color'], ['stretch', 'Stretch to frame']] }),
        ...((b.fit === 'solid') ? [bind(b, 'fitColor', 'color', { label: 'Bar color' })] : []),
        bind(b, 'vidStart', 'num', { label: 'Start at (seconds)', min: 0, max: 600, step: 0.1 }), bind(b, 'vidLoop', 'check', { label: 'Loop if the scene is longer' }),
        h('div', { className: 'btnrow' }, h('button', { text: 'Match scene length to video', on: { click: () => { if (v && v.dur) { sc.duration = Math.max(1, Math.round((v.dur - (+b.vidStart || 0)) * 10) / 10); commit(); refreshAll(); } } } })));
    }
    if (!vidList.length) { p.append(h('div', { className: 'hint', text: 'No videos yet.' })); return; }
    const list = h('div', { style: 'display:grid;gap:8px;margin-top:10px' });
    vidList.forEach(rec => { const v = E.videos[rec.id];
      list.append(h('div', { style: 'padding:8px;border:1px solid #42516a;border-radius:6px' }, h('div', { text: rec.name, style: 'font-weight:600;overflow-wrap:anywhere' }), h('div', { className: 'hint', text: v && v.ok ? v.dur.toFixed(1) + ' s · ' + v.w + '×' + v.h + ' · ' + (rec.blob.size / 1048576).toFixed(1) + ' MB' : (rec.blob.size / 1048576).toFixed(1) + ' MB' }),
        h('div', { className: 'btnrow' }, h('button', { className: 'sm pri', text: 'Use as this scene’s background', on: { click: () => useVideo(rec) } }), h('button', { className: 'sm dng', text: 'Delete', on: { click: async () => { if (!confirm('Delete this video from this browser?')) return; vidList = vidList.filter(x => x.id !== rec.id); try { await vidTx('readwrite', s => s.delete(rec.id)); } catch (e) { /* ignore */ } renderPanels(); } } }))));
    });
    p.append(list);
  }
  restoreVideos();
  function bgApply(b) { const sc = cur(); S.show.assets[b.asset] = b.data; sc.bg = Object.assign({}, sc.bg, { type: 'image', asset: b.asset, kenburns: false, fit: b.asset === 'bgdefault' ? 'fill' : sc.bg.fit }); E.preload(S.show).then(() => thumbSoon(true)); commit(); refreshAll(); }
  function bgDefaultSpec() { const b = bgAll().filter(x => kindOf(x) === 'bg').find(x => x.id === bgDefault) || builtinBgs()[0]; return b; }

  /* ---- overlays (banners / graphics with transparent backgrounds) ---- */
  const SAFE = () => (S.show && S.show.safe != null ? S.show.safe : 48);
  const POS = [['ul', 'Upper left'], ['ur', 'Upper right'], ['ll', 'Lower left'], ['lr', 'Lower right'], ['tc', 'Top center'], ['bc', 'Bottom center'], ['c', 'Center']];
  const OV_SIZES = [['orig', 'Original size'], ['0.75', '75% of frame width'], ['0.5', '50% of frame width'], ['0.33', '33% of frame width'], ['0.2', '20% of frame width']];
  const OV_ANIMS = [['in-left', 'Slide in from left'], ['in-right', 'Slide in from right'], ['in-top', 'Slide in from top'], ['in-bottom', 'Slide in from bottom'], ['fade', 'Fade in'], ['pop', 'Pop in'], ['none', 'None (appear)']];
  let ovOpt = { pos: 'ul', size: 'orig', anim: 'auto' };
  try { Object.assign(ovOpt, JSON.parse(localStorage.getItem('wx_ov_opt') || '{}')); } catch (e) { /* ignore */ }
  const saveOvOpt = () => { try { localStorage.setItem('wx_ov_opt', JSON.stringify(ovOpt)); } catch (e) { /* ignore */ } };
  function placeXY(pos, w, h) { const m = SAFE(); return { ul: [m, m], ur: [W - m - w, m], ll: [m, H - m - h], lr: [W - m - w, H - m - h], tc: [(W - w) / 2, m], bc: [(W - w) / 2, H - m - h], c: [(W - w) / 2, (H - h) / 2] }[pos] || [m, m]; }
  function movePos(o, pos) { const b = E.bounds(o), xy = placeXY(pos, b.w, b.h); o.x += xy[0] - b.x; o.y += xy[1] - b.y; o.geo = false; commit(); }
  function defaultInFor(pos) { return { ul: 'in-left', ll: 'in-left', ur: 'in-right', lr: 'in-right', tc: 'in-top', bc: 'in-bottom', c: 'fade' }[pos] || 'fade'; }
  function addOverlay(b, at) {
    S.show.assets[b.asset] = b.data;
    const im = new Image(); im.onload = () => {
      let w = im.width, h = im.height; const tgt = ovOpt.size === 'orig' ? Math.min(w, W - 2 * SAFE()) : W * (+ovOpt.size); const k = tgt / w; w *= k; h *= k; if (h > H - 2 * SAFE()) { const k2 = (H - 2 * SAFE()) / h; w *= k2; h *= k2; }
      const xy = at ? [at[0] - w / 2, at[1] - h / 2] : placeXY(ovOpt.pos, w, h);
      const ob = addObject('image', { asset: b.asset, x: xy[0], y: xy[1], w, h }, { noGeo: true }); ob.geo = false; ob.anim.in = ovOpt.anim === 'auto' ? defaultInFor(ovOpt.pos) : ovOpt.anim; ob.anim.dur = 0.7; E.preload(S.show).then(() => thumbSoon(true)); commit(); renderPanels();
    }; im.src = b.data;
  }
  let assetTab = 'bg';
  function backgroundsPanel(p) {
    const tabs = h('div', { className: 'btnrow', style: 'margin-bottom:8px' }, [['bg', 'Backgrounds'], ['banner', 'Banners'], ['graphic', 'Graphics'], ['video', 'Videos']].map(([k, l]) => h('button', { text: l, className: assetTab === k ? 'pri' : '', on: { click: () => { assetTab = k; renderPanels(); } } })));
    p.append(tabs);
    if (assetTab === 'video') { videosPanel(p); return; }
    const kind = assetTab, isBg = kind === 'bg';
    p.append(h('div', { className: 'hint', text: isBg ? 'Click a background to apply it to the current scene. The star marks the background used by + Scene. Uploads are saved in this browser (resized to 1920 px wide).' : 'Upload PNGs with transparent backgrounds (kept as-is). Click an item to add it to the current scene using the placement below, or drag it onto the stage. Afterwards move and resize it like any object.' }));
    if (!isBg) {
      const sel = (key, opts) => h('select', { on: { change: e => { ovOpt[key] = e.target.value; saveOvOpt(); } } }, opts.map(o => h('option', { value: o[0], text: o[1], selected: ovOpt[key] === o[0] })));
      p.append(fld('Place at', sel('pos', POS)), fld('Size', sel('size', OV_SIZES)), fld('Entrance', sel('anim', [['auto', 'Automatic (from nearest edge)']].concat(OV_ANIMS))));
    }
    const fi = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none', onchange: e => { bgAdd([...e.target.files], kind); e.target.value = ''; } });
    const dz = h('div', { id: 'drop', text: isBg ? 'Upload backgrounds: click to browse or drop images here' : 'Upload ' + (kind === 'banner' ? 'banners' : 'graphics') + ': click to browse or drop PNGs here' }); dz.onclick = () => fi.click();
    ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('hov'); })); dz.addEventListener('dragleave', () => dz.classList.remove('hov'));
    dz.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('hov'); bgAdd([...e.dataTransfer.files], kind); });
    p.append(fi, dz);
    const gr = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px' });
    const items = (isBg ? builtinBgs() : []).concat(bgList.filter(b => kindOf(b) === kind));
    if (!items.length) p.append(h('div', { className: 'hint', text: 'Nothing saved here yet.' }));
    items.forEach(b => {
      const kids = [h('img', { src: b.data, draggable: false, style: 'width:100%;aspect-ratio:16/9;object-fit:' + (isBg ? 'cover' : 'contain') + ';border-radius:6px;display:block;' + (isBg ? '' : 'background:repeating-conic-gradient(#2a3342 0% 25%,#1c2430 0% 50%) 0 0/16px 16px') }), h('div', { className: 'hint', text: b.name, style: 'margin:2px 0 0' })];
      if (isBg) kids.push(h('button', { text: bgDefault === b.id ? '★' : '☆', title: 'Use for new scenes (+ Scene)', style: 'position:absolute;top:4px;left:4px;padding:0 6px', on: { click: e => { e.stopPropagation(); bgDefault = b.id; try { localStorage.setItem(BGD_KEY, b.id); } catch (x) { /* ignore */ } renderPanels(); } } }));
      if (!b.builtin && !isBg) kids.push(h('button', { className:'sm', text:'☁ Save to cloud', title:'Save PNG to your private cloud account', style:'margin-top:4px;width:100%', on:{click:e=>{e.stopPropagation();uploadOneCloud(b);}} }));
      if (!b.builtin) kids.push(h('button', { text: '✕', title: 'Delete', style: 'position:absolute;top:4px;right:4px;padding:0 6px', on: { click: e => { e.stopPropagation(); if (!confirm('Delete this saved item?')) return; bgList = bgList.filter(x => x !== b); if (bgDefault === b.id) bgDefault = 'sky'; bgTx('readwrite', s => s.delete(b.id)).catch(() => { }); renderPanels(); } } }));
      gr.append(h('div', { style: 'position:relative;cursor:pointer', draggable: !isBg, ondragstart: ev => { ev.dataTransfer.setData('application/x-wx-overlay', b.id); ev.dataTransfer.effectAllowed = 'copy'; }, on: { click: () => (isBg ? bgApply(b) : addOverlay(b)) } }, kids));
    });
    p.append(gr);
    cloudAssetsPanel(p,kind);
  }
  function mediaPanel(p) {
    const dz = h('div', { id: 'drop', text: 'Drop your own graphics here (PNG, JPG, WebP) – or click to browse' });
    dz.onclick = () => pickImages('asset'); ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('hov'); })); dz.addEventListener('dragleave', () => dz.classList.remove('hov')); dz.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('hov'); addFiles([...e.dataTransfer.files], 'asset'); });
    p.append(dz); const ids = Object.keys(S.show.assets); if (!ids.length) p.append(h('div', { className: 'hint', text: 'Your uploads appear here. They are saved inside the show file.' }));
    const gr = h('div', { className: 'agrid' }); ids.forEach(id => gr.append(h('div', { className: 'as' }, h('img', { src: S.show.assets[id] }), h('div', {}, h('button', { className: 'sm', text: 'Add', on: { click: () => { const im = new Image(); im.onload = () => { const k = Math.min(W / im.width, H / im.height, 1); addObject('image', { asset: id, x: (W - im.width * k) / 2, y: (H - im.height * k) / 2, w: im.width * k, h: im.height * k }, { noGeo: true }); }; im.src = S.show.assets[id]; } } }), h('button', { className: 'sm', text: 'BG', title: 'Use as scene background', on: { click: () => { cur().bg.type = 'image'; cur().bg.asset = id; commit(); renderPanels(); } } }), h('button', { className: 'sm dng', text: '✕', on: { click: () => { delete S.show.assets[id]; S.show.scenes.forEach(s => { s.objects = s.objects.filter(o => o.asset !== id); if (s.bg.asset === id) s.bg.asset = null; }); if (S.show.logo === id) S.show.logo = null; commit(); renderPanels(); } } }))))); p.append(gr);
  }
  function pickImages(mode) { const f = $('#fileImg'); f.onchange = () => { addFiles([...f.files], mode); f.value = ''; }; f.click(); }

  function setTab(t) { S.tab = t; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); renderPanels(); }
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.t));
  function renderPanels() {
    const p=$('#panels'),sy=p.scrollTop;
    p.innerHTML='';
    ({ scene: scenePanel, object: objectPanel, library: libraryPanel, media: mediaPanel, bgs: backgroundsPanel })[S.tab](p);
    // Map styling now lives in the Map Style flyout, not in Scene settings.
    if(S.tab==='scene' && cur().bg.type==='mapbox'){
      const moved=['Map + Camera','Weather Director Base','Land + Water','City + Town Labels','Boundaries','Transportation','Overlays'];
      Array.from(p.children).forEach(e=>{
        if(e.matches('details.mapacc')&&moved.includes(e.querySelector(':scope > summary')?.textContent))e.remove();
      });
      p.append(h('div',{className:'hint',text:'Map styling has moved to the camera / Map Style button in the top toolbar.'}),
        h('div',{className:'btnrow'},h('button',{text:'▣ Open Map Style',on:{click:()=>openMapStyle()}})));
    }
    p.scrollTop=sy;
    if(MS.open)renderMapStylePanel();
  }

  /* ---------- Aguacero-inspired floating Map Style panel ---------- */
  function readMapStylePresets(){
    try{const p=JSON.parse(localStorage.getItem(MAP_STYLES_KEY)||'[]');return Array.isArray(p)?p:[];}catch(e){return [];}
  }
  function saveMapStylePresets(p){try{localStorage.setItem(MAP_STYLES_KEY,JSON.stringify(p));}catch(e){toast('Cannot save styles: browser storage is unavailable');}}
  const CLOUD=()=>g.WXCloudPresets;
  const cloudEnabled=()=>!!CLOUD()?.configured();
  function cloudError(err){return String(err?.message||err||'Unknown error');}
  async function loadCloudPresets(){
    if(!cloudEnabled()||!CLOUD().user()||MS.cloudLoading)return;
    MS.cloudLoading=true;MS.cloudMessage='';if(MS.open)renderMapStylePanel();
    try{
      MS.cloudPresets=await CLOUD().list();
      MS.cloudLoaded=true;
    }catch(e){MS.cloudMessage='Could not load cloud presets: '+cloudError(e);MS.cloudLoaded=false;}
    finally{MS.cloudLoading=false;if(MS.open)renderMapStylePanel();}
  }
  async function cloudAccountAction(kind,email,password){
    if(MS.cloudBusy)return;
    if(!email||!email.includes('@')||password.length<8){
      MS.cloudMessage='Enter a valid email and a password of at least 8 characters.';
      renderMapStylePanel();return;
    }
    MS.cloudBusy=true;MS.cloudMessage='';
    try{
      if(kind==='signup'){
        const result=await CLOUD().signUp(email,password);
        if(result.confirmationRequired){
          MS.cloudMessage='Account created. Check your email for a confirmation link, then sign in here. If the link opens another page, return to WX Studio afterward.';
        }else{
          MS.cloudMessage='Cloud account ready.';
          await loadCloudPresets();
        }
      }else{
        await CLOUD().signIn(email,password);
        MS.cloudPresets=[];MS.cloudLoaded=false;
        await loadCloudPresets();
        MS.cloudMessage='Signed in. Your presets are available on this device.';
      }
    }catch(e){MS.cloudMessage='Cloud sign-in: '+cloudError(e);}
    finally{MS.cloudBusy=false;if(MS.open)renderMapStylePanel();}
  }
  async function cloudSignOut(){
    if(MS.cloudBusy)return;
    MS.cloudBusy=true;
    try{await CLOUD().signOut();MS.cloudPresets=[];MS.cloudLoaded=false;MS.cloudMessage='Signed out of cloud sync.';}
    catch(e){MS.cloudMessage='Sign-out issue: '+cloudError(e);}
    finally{MS.cloudBusy=false;renderMapStylePanel();}
  }
  async function uploadLocalPresets(){
    const local=readMapStylePresets();
    if(!local.length||!cloudEnabled()||!CLOUD().user())return;
    if(!confirm('Upload '+local.length+' local preset(s) to your private cloud account? Cloud presets with the same names will be replaced. Your browser copies will be kept.'))return;
    if(MS.cloudBusy)return;MS.cloudBusy=true;
    let count=0;
    try{
      for(const item of local){await CLOUD().save(item);count++;}
      MS.cloudMessage='Uploaded '+count+' local presets. Browser copies were kept.';
      MS.cloudLoaded=false;await loadCloudPresets();
    }catch(e){MS.cloudMessage='Uploaded '+count+' preset(s) before error: '+cloudError(e);}
    finally{MS.cloudBusy=false;if(MS.open)renderMapStylePanel();}
  }
  async function deleteCloudPreset(item){
    if(MS.cloudBusy||!confirm('Delete the cloud preset "'+item.name+'"? This cannot be undone.'))return;
    MS.cloudBusy=true;
    try{await CLOUD().remove(item.id);MS.cloudMessage='Deleted cloud preset: '+item.name;
      MS.cloudPresets=MS.cloudPresets.filter(p=>p.id!==item.id);
    }catch(e){MS.cloudMessage='Cloud delete failed: '+cloudError(e);}
    finally{MS.cloudBusy=false;if(MS.open)renderMapStylePanel();}
  }
  function closeMapStyle(){
    MS.open=false;
    $('#mapStyleFlyout').classList.remove('open');
    $('#bMapStyle').classList.remove('active');
    $('#bMapStyle').setAttribute('aria-expanded','false');
  }
  function openMapStyle(){
    if(MS.open){closeMapStyle();return;}
    MS.open=true;MS.tab='customize';
    $('#mapStyleFlyout').classList.add('open');
    $('#bMapStyle').classList.add('active');
    $('#bMapStyle').setAttribute('aria-expanded','true');
    renderMapStylePanel(true);
  }
  function saveCurrentStyle(){
    const b=cur().bg;
    if(b.type!=='mapbox')return toast('Select a Mapbox background first');
    const name=prompt('Name this map view and style preset:', 'My Map View');
    if(!name||!name.trim())return;
    const settings={};
    g.MB.ensureConfig(b);
    for(const k of Object.keys(g.MB.DEFAULTS))settings[k]=b[k];
    settings.proj=b.proj;settings.mbStyle=b.mbStyle;
    // Capture the same active camera the viewer sees. Saving a preset should
    // not modify the scene or its animated camera move.
    const active=E.viewAt(cur(),editT());
    const camera=JSON.parse(JSON.stringify({
      c:active.c,z:active.z,b:active.b||0,p:active.p||0
    }));
    const item={name:name.trim(),settings,camera,created:new Date().toISOString()};
    if(cloudEnabled()&&CLOUD().user()){
      if(MS.cloudPresets.some(p=>p.name===item.name) &&
         !confirm('Replace existing cloud preset "'+item.name+'"?'))return;
      CLOUD().save(item).then(()=>{
        toast('Saved "'+item.name+'" in your cloud account');
        MS.cloudLoaded=false;loadCloudPresets();
      }).catch(e=>toast('Cloud save failed: '+cloudError(e)));
      return;
    }
    const list=readMapStylePresets();
    const existing=list.findIndex(x=>x.name===item.name);
    if(existing>=0){if(!confirm('Replace saved style "'+item.name+'"?'))return;list[existing]=item;}
    else list.unshift(item);
    saveMapStylePresets(list);
    toast('Saved in this browser (sign in under Saved Styles for cloud sync)');
    renderMapStylePanel();
  }
  function applySavedMapStyle(item){
    const b=cur().bg;
    if(!b||b.type!=='mapbox')return;
    const cfg=item.settings||{};
    // Always discard ONLY the scene's old tier-label values before
    // importing this saved style. Otherwise a v0.9.58 preset without an
    // independent Hamlet tier can retain an unrelated Hamlet font/zoom
    // from the scene that happened to be open. Imported modern styles
    // restore all their own saved values; older styles are losslessly
    // migrated by MB.ensureConfig() from their saved shared/Village values.
    for(const tier of ['City','Town','Village','Hamlet'])
      for(const suffix of ['Enabled','Font','Size','Color','HaloColor','HaloWidth',
        'DensityPct','Population','TextBackground','BackgroundColor','DropShadow',
        'Uppercase','Opacity','Spacing','MinZoom','MaxZoom','Dots','DotColor',
        'DotOutlineColor','DotOutlineWidth','DotSize','DotNameOffset','DotShadow'])
        delete b['broadcast'+tier+suffix];
    for(const k of Object.keys(g.MB.DEFAULTS))if(Object.prototype.hasOwnProperty.call(cfg,k))b[k]=cfg[k];
    if(cfg.proj==='globe'||cfg.proj==='mercator')b.proj=cfg.proj;
    b.mbStyle='broadcast';g.MB.ensureConfig(b);
    // Legacy style-only presets remain valid; leave the camera untouched for
    // those. New presets restore the exact saved location/zoom/tilt/bearing.
    const cam=item.camera;
    if(cam&&Array.isArray(cam.c)&&cam.c.length===2&&cam.c.every(Number.isFinite)
       &&Number.isFinite(cam.z)){
      b.view={c:cam.c.slice(),z:cam.z,b:Number.isFinite(cam.b)?cam.b:0,
        p:Number.isFinite(cam.p)?cam.p:0};
      b.view2=null;delete b.camDur;delete b.camDelay;
      S.editEnd=false;
    }
    commit();renderPanels();thumbSoon(true);
    toast((cam?'Map view and style':'Map style')+' loaded: '+item.name);
  }
  function mapStyleButton(label,fn,cls){return h('button',{text:label,className:cls||'',on:{click:fn}});}
  // Crisp vector previews for color maps; satellite pulls a real @2x Mapbox
  // Static image with SVG preview underneath as an offline fallback.
  function mapStyleCardBackground(key,b){
    const isSat=key==='satellite';
    const land=isSat?'#365840':toHex(key==='dark'?b.broadcastDarkColor:b.broadcastCustomColor);
    const water=isSat?'#366274':toHex(b.broadcastWaterColor);
    const edge=isSat?'#f0eedf':'#e7ebf2';
    const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 142">'+
      '<rect width="280" height="142" fill="'+water+'"/>'+
      '<path d="M-3 -3H198L178 13 184 23 172 34 187 46 166 55 170 69 153 76 158 91 140 99 146 108 130 122 134 145H-3Z" fill="'+land+'" stroke="'+edge+'" stroke-width="1.6"/>'+
      '<path d="M163 114l12-4 5 8-7 7 4 10-10 3-9-12z M207 91l5-4 5 5-3 8-6-1z M234 58l6-1 5 5-6 6-5-2z" fill="'+land+'" stroke="'+edge+'" stroke-width="1.2"/>'+
      '<path d="M20 0L30 140M68 0L68 142M115 0L111 140M2 29L184 30M0 70L159 69M0 110L145 109M38 10L141 120M7 86L143 13" stroke="'+edge+'" stroke-width=".9" opacity=".48" fill="none"/>'+
      '<text x="30" y="50" fill="#fff" stroke="#111" stroke-width="2" paint-order="stroke" font-family="Arial" font-size="12" font-weight="bold">BOSTON</text>'+
      '<text x="38" y="96" fill="#fff" stroke="#111" stroke-width="2" paint-order="stroke" font-family="Arial" font-size="12" font-weight="bold">NEW YORK</text></svg>';
    const fallback='url("data:image/svg+xml,'+encodeURIComponent(svg)+'") center / cover no-repeat';
    if(isSat&&g.MB.hasToken()){
      const url='https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/-71.5,42.4,6/280x142@2x?access_token='+encodeURIComponent(g.MB.token());
      return 'url("'+url+'") center / cover no-repeat, '+fallback;
    }
    return fallback;
  }
  function updateMapStyleCardPreviews(b){
    const p=$('#mapStyleScroll');if(!p)return;
    p.querySelectorAll('.mapstyle-card[data-base]').forEach(card=>{
      const swatch=card.querySelector('.swatch');
      if(swatch)swatch.style.background=mapStyleCardBackground(card.getAttribute('data-base'),b);
    });
  }
  function mapStyleCards(b){
    const box=h('div',{className:'mapstyle-cards'});
    const selected=b.broadcastBase==='dark'?'dark':b.broadcastBase==='satellite'?'satellite':'custom';
    for(const [key,title] of [['custom','Custom Color'],['dark','Dark'],['satellite','Satellite']]){
      const btn=h('button',{className:'mapstyle-card'+(selected===key?' active':''),title:title+' map base','data-base':key,
        on:{click:()=>{b.mbStyle='broadcast';b.broadcastBase=key;commit();renderPanels();}}},
        h('span',{className:'swatch',style:'background:'+mapStyleCardBackground(key,b)}),
        h('span',{className:'caption',text:title}));
      box.append(btn);
    }
    return box;
  }
  function addMapStyleValues(scroll){
    // Keep the native range inputs while displaying Aguacero-style units.
    scroll.querySelectorAll('.row input[type="range"]').forEach(input=>{
      const row=input.closest('.row'),key=(row?.querySelector('label')?.textContent||'').toLowerCase();
      if(!row||input.parentElement?.classList.contains('mapstyle-slider'))return;
      const holder=h('div',{className:'mapstyle-slider'});
      input.replaceWith(holder);holder.append(input);
      const value=h('span',{className:'mapstyle-slider-value'});holder.append(value);
      const percent=/opacity|intensity|strength|density|saturation|contrast|lift|ceiling/i.test(key) &&
        +input.max<=1;
      const pctScale=/3d exaggeration/i.test(key);
      const pixels=/width|size|offset|halo/i.test(key);
      const show=()=>{
        const v=+input.value;
        value.textContent=percent||pctScale?Math.round(v*(pctScale?100:100))+'%':
          pixels?(+v.toFixed(2))+'px':(+v.toFixed(2)).toString();
      };
      input.addEventListener('input',show);
      show();
    });
  }
  function renderMapStylePanel(fresh){
    if(!MS.open)return;
    $('#mapStyleSave').textContent=cloudEnabled()&&CLOUD().user()?'Save to Cloud':'Save Style';
    const scroll=$('#mapStyleScroll'),sy=fresh?0:scroll.scrollTop;
    scroll.innerHTML='';
    document.querySelectorAll('#mapStyleTabs button').forEach(btn=>btn.classList.toggle('on',btn.dataset.mt===MS.tab));
    const sc=cur(),b=sc.bg;
    if(MS.tab==='saved'){
      const local=readMapStylePresets();
      const description=item=>
        item.camera&&Number.isFinite(item.camera.z)
          ? 'Zoom '+item.camera.z.toFixed(1)+' · '+(item.settings?.proj==='globe'?'Globe':'Mercator')+
            ' · '+(item.settings?.broadcastBase||'Satellite')
          : 'Style-only preset (location unchanged)';
      const card=(item,isCloud)=>{
        scroll.append(h('div',{className:'mapacc',style:'padding:10px'},
          h('div',{style:'font-weight:700;margin-bottom:4px',text:item.name}),
          h('div',{className:'hint',style:'margin-bottom:8px',text:description(item)}),
          h('div',{className:'btnrow'},
            mapStyleButton('Load Preset',()=>applySavedMapStyle(item),'pri'),
            mapStyleButton('Delete',()=>isCloud?deleteCloudPreset(item):(()=>{
              if(!confirm('Delete local preset "'+item.name+'"?'))return;
              saveMapStylePresets(readMapStylePresets().filter(x=>x.name!==item.name));
              renderMapStylePanel();
            })(),'dng'))));
      };
      scroll.append(h('div',{className:'hint',text:'Presets restore a starting location, zoom, map colors and overlays. You can pan, zoom and edit freely afterward; the saved preset does not change.'}));
      scroll.append(h('div',{style:'font-size:15px;font-weight:700;margin:14px 0 7px',text:'Cloud Presets'}));
      if(!cloudEnabled()){
        scroll.append(h('div',{className:'hint',text:'Cloud sync is awaiting the Streamlit Supabase URL and publishable key in app secrets. Your local presets below still work.'}));
      }else{
        if(!MS.cloudChecked){
          MS.cloudChecked=true;
          CLOUD().initialize().then(()=>{
            MS.cloudReady=true;
            if(CLOUD().user())loadCloudPresets();
            else if(MS.open)renderMapStylePanel();
          }).catch(e=>{MS.cloudMessage='Cloud setup: '+cloudError(e);
            MS.cloudReady=true;if(MS.open)renderMapStylePanel();});
        }
        if(!MS.cloudReady)scroll.append(h('div',{className:'hint',text:'Checking saved cloud sign-in…'}));
        else if(CLOUD().user()){
          scroll.append(h('div',{className:'hint',text:'Signed in as '+(CLOUD().user()?.email||'cloud user')}));
          scroll.append(h('div',{className:'btnrow'},
            mapStyleButton('Refresh Cloud',()=>loadCloudPresets()),
            mapStyleButton('Sign Out',cloudSignOut)));
          if(MS.cloudLoading)scroll.append(h('div',{className:'hint',text:'Loading cloud presets…'}));
          else if(!MS.cloudLoaded)scroll.append(h('div',{className:'hint',text:'Cloud presets not loaded. Click Refresh Cloud to retry.'}));
          else if(!MS.cloudPresets.length)scroll.append(h('div',{className:'hint',text:'No cloud presets yet. Set your view and click Save Style.'}));
          if(MS.cloudLoaded)MS.cloudPresets.forEach(item=>card(item,true));
          if(local.length)scroll.append(h('div',{className:'btnrow'},
            mapStyleButton('Upload Local Presets to Cloud',uploadLocalPresets,'pri')));
        }else{
          scroll.append(h('div',{className:'hint',text:'Sign in on each device with the same account to access private synced presets. Use Create Account once; a confirmation email may be required.'}));
          const email=h('input',{type:'email',placeholder:'Email address',autocomplete:'email',
            style:'margin-bottom:7px;width:100%'});
          const password=h('input',{type:'password',placeholder:'Password (8+ characters)',autocomplete:'current-password',
            style:'margin-bottom:7px;width:100%'});
          scroll.append(email,password,h('div',{className:'btnrow'},
            mapStyleButton('Sign In',()=>cloudAccountAction('login',email.value.trim(),password.value),'pri'),
            mapStyleButton('Create Account',()=>cloudAccountAction('signup',email.value.trim(),password.value))));
        }
        if(MS.cloudMessage)scroll.append(h('div',{className:'hint',style:'margin:8px 0',text:MS.cloudMessage}));
      }
      scroll.append(h('div',{style:'font-size:15px;font-weight:700;margin:16px 0 7px',text:'This Browser — Local Presets'}));
      if(!local.length)scroll.append(h('div',{className:'hint',text:'No browser-only presets saved.'}));
      local.forEach(item=>card(item,false));
      scroll.scrollTop=sy;return;
    }
    if(b.type!=='mapbox'){
      scroll.append(h('div',{className:'hint',text:'This scene is not using a Mapbox background.'}),
        mapStyleButton('Use a Mapbox map',()=>{
          b.type='mapbox';b.mbStyle='broadcast';b.view=null;b.view2=null;
          g.MB.ensureConfig(b);commit();renderPanels();
        },'pri'));
      return;
    }
    g.MB.ensureConfig(b);
    const B=(key,type,opt)=>bind(b,key,type,opt);
    scroll.append(mapStyleButton('Reset all to defaults',()=>{
      if(!confirm('Reset all map-style settings in this scene? The map camera and scene objects will be kept.'))return;
      const keep={view:b.view,view2:b.view2,region:b.region,proj:b.proj};
      Object.assign(b,JSON.parse(JSON.stringify(g.MB.DEFAULTS)),keep);
      b.mbStyle='broadcast';commit();renderPanels();
    }),mapStyleCards(b));
    if(b.broadcastBase==='custom')scroll.append(B('broadcastCustomColor','color',{label:'Land color',after:()=>updateMapStyleCardPreviews(b)}));
    if(b.broadcastBase==='dark')scroll.append(B('broadcastDarkColor','color',{label:'Land color',after:()=>updateMapStyleCardPreviews(b)}));
    if(b.broadcastBase!=='satellite'){
      scroll.append(B('broadcastOceanShow','check',{label:'Show ocean color',rerender:true}));
      if(b.broadcastOceanShow)
        scroll.append(B('broadcastWaterColor','color',{label:'Ocean color',after:()=>updateMapStyleCardPreviews(b)}));
      scroll.append(h('div',{className:'hint',text:'When ocean color is Off, land and ocean share one background color. Coastlines remain visible; inland lakes and rivers are hidden.'}));
    }
    const proj=h('div',{className:'mapstyle-choices'});
    for(const [key,label] of [['mercator','Mercator'],['globe','Globe']])
      proj.append(mapStyleButton(label,()=>{b.proj=key;commit();renderPanels();},b.proj===key?'active':''));
    scroll.append(proj,B('showZoomBadge','check',{label:'Show zoom',after:updateZoomBadge}));
    const extras=h('div',{className:'mapstyle-actions'},
      mapStyleButton('Mapbox Token / Quality…',mapboxSettings),
      mapStyleButton('Save Default View',saveCurrentMapDefault));
    scroll.append(extras);
    const search=h('input',{type:'text',placeholder:'⌕ Search settings (water, roads, labels, zoom…)',style:'width:100%;margin:7px 0 8px'});
    scroll.append(search);

    // Reuse the studio's already functional settings controls. They keep the
    // same saved keys and map render behavior instead of introducing clones.
    const temp=h('div');scenePanel(temp);
    const byTitle=title=>Array.from(temp.children).find(el=>el.matches('details.mapacc')&&el.querySelector(':scope > summary')?.textContent===title);
    const addGroup=(title,display)=>{
      const box=byTitle(title);
      if(box){if(display)box.querySelector(':scope > summary').textContent=display;scroll.append(box);}
    };
    addGroup('Overlays');

    scroll.append(mapAccordion('styleGlobe','Globe',[
      B('globeAtmosphereEnabled','check',{label:'Atmosphere'}),
      B('globeAtmosphereStrength','range',{label:'Atmosphere strength (%)',min:0,max:1,step:.01}),
      B('globeStarsEnabled','check',{label:'Stars'}),
      B('globeStarIntensity','range',{label:'Star intensity (%)',min:0,max:1,step:.01}),
      B('globeBackgroundColor','color',{label:'Background color'})
    ],false));
    scroll.append(mapAccordion('styleSatellite','Satellite Imagery',[
      B('broadcastSatelliteSaturation','range',{label:'Saturation',min:-1,max:1,step:.05}),
      B('broadcastSatelliteContrast','range',{label:'Contrast',min:-1,max:1,step:.05}),
      B('broadcastSatelliteShadowLift','range',{label:'Shadow lift',min:0,max:1,step:.01}),
      B('broadcastSatelliteHighlightCeiling','range',{label:'Highlight ceiling',min:.01,max:1,step:.01})
    ],false));
    addGroup('Land + Water');
    addGroup('Transportation');
    addGroup('Boundaries');
    scroll.append(mapAccordion('styleWaterFeatures','Water Features',[
      B('waterwaysShow','check',{label:'Waterways',rerender:true}),
      B('waterwaysColor','color',{label:'Color'}),
      B('waterwaysWidth','range',{label:'Width (px)',min:.1,max:6,step:.1}),
      B('waterwaysOpacity','range',{label:'Opacity (%)',min:0,max:1,step:.01}),
      zoomRangeRow(b,'Waterways','waterwaysMinZoom','waterwaysMaxZoom',{min:0,max:24,step:.5})
    ],false));
    // The source scene accordion is now titled Place Labels (v0.9.54).
    // The floating Map Style popup must import that same accordion name.
    addGroup('Place Labels');
    scroll.append(mapAccordion('styleTerrain','Terrain',[
      B('terrainHillshadeShow','check',{label:'Show Terrain / hillshade'}),
      B('terrainHillshadeIntensity','range',{label:'Intensity (%)',min:0,max:1,step:.01}),
      B('terrain','check',{label:'3D Terrain'}),
      B('terrainExaggeration','range',{label:'3D exaggeration (%)',min:0,max:3,step:.05}),
      B('terrainHillshadeShadow','color',{label:'Shadow color'}),
      B('terrainHillshadeHighlight','color',{label:'Highlight color'}),
      B('terrainHillshadeAccent','color',{label:'Accent color'})
    ],false));
    addGroup('Map + Camera');

    search.addEventListener('input',()=>{
      const needle=search.value.trim().toLowerCase();
      Array.from(scroll.children).filter(e=>e.matches('details.mapacc')).forEach(el=>{
        const match=!needle||el.textContent.toLowerCase().includes(needle);
        el.hidden=!match;
        if(needle&&match)el.open=true;
      });
    });
    addMapStyleValues(scroll);
    scroll.scrollTop=sy;
  }
  $('#bMapStyle').onclick=openMapStyle;
  $('#mapStyleClose').onclick=closeMapStyle;
  $('#mapStyleSave').onclick=saveCurrentStyle;
  document.querySelectorAll('#mapStyleTabs button').forEach(btn=>btn.onclick=()=>{
    MS.tab=btn.dataset.mt;renderMapStylePanel(true);
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&MS.open){closeMapStyle();}
  });

  function renderSceneList() {
    const l = $('#sceneList'); l.innerHTML = '';
    S.show.scenes.forEach((sc, i) => {
      const cv = h('canvas', { width: 192, height: 108 });
      const card = h('div', { className: 'sc' + (i === S.si ? ' on' : ''), 'data-i': i, on: { click: () => { backToEdit(); S.si = i; S.oid = null; S.editEnd = false; refreshAll(); } } }, cv,
        h('div', { className: 'nm' }, h('span', { text: (i + 1) + '. ' + sc.name }), h('span', { className: 'meta', text: sc.duration + 's' })),
        h('div', { className: 'meta', text: i ? (E.TRANSITIONS.find(t => t[0] === sc.transition.type) || [0, ''])[1] : 'Start' }),
        h('div', { className: 'acts' },
          h('button', { className: 'sm', text: '↑', on: { click: ev => { ev.stopPropagation(); mv(i, -1); } } }), h('button', { className: 'sm', text: '↓', on: { click: ev => { ev.stopPropagation(); mv(i, 1); } } }),
          h('button', { className: 'sm', text: '⧉', on: { click: ev => { ev.stopPropagation(); const c = JSON.parse(JSON.stringify(sc)); c.id = 's' + Date.now().toString(36); c.name += ' copy'; S.show.scenes.splice(i + 1, 0, c); S.si = i + 1; commit(); refreshAll(); } } }),
          h('button', { className: 'sm dng', text: '✕', on: { click: ev => { ev.stopPropagation(); if (S.show.scenes.length < 2) return toast('A show needs at least one scene'); S.show.scenes.splice(i, 1); S.si = clamp(S.si, 0, S.show.scenes.length - 1); commit(); refreshAll(); } } })));
      l.append(card);
    }); thumbSoon(true);
  }
  function mv(i, d) { const j = i + d, a = S.show.scenes; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; S.si = j; commit(); refreshAll(); }
  function refreshAll() { $('#showName').value = S.show.name; renderSceneList(); renderPanels(); updateTransport(); const fk = $('#frontKind'); if (fk) fk.value = S.opt.front; }

  /* ---------- icon thumbnails animation ---------- */
  setInterval(() => { if (S.tab !== 'library') return; document.querySelectorAll('canvas[data-icon]').forEach(cv => { const c = cv.getContext('2d'); c.clearRect(0, 0, 120, 120); g.Icons.draw(c, cv.dataset.icon, 60, 62, 100, clock()); }); }, 66);

  /* ---------- snapping, guides, align ---------- */
  const SNAP = { on: true, guides: false };
  try { const q = JSON.parse(localStorage.getItem('wx_snap') || '{}'); if (q.on != null) SNAP.on = !!q.on; if (q.guides != null) SNAP.guides = !!q.guides; } catch (e) { /* ignore */ }
  const saveSnap = () => { try { localStorage.setItem('wx_snap', JSON.stringify(SNAP)); } catch (e) { /* ignore */ } };
  function snapBounds(b, o, xf) {
    const T = 12, m = SAFE(), xs = [0, m, W / 2, W - m, W], ys = [0, m, H / 2, H - m, H];
    cur().objects.forEach(q => { if (q === o || q.hidden) return; let r; try { r = E.bounds(E.toScreen(q, xf)); } catch (e) { return; } if (!isFinite(r.x + r.y + r.w + r.h) || r.w > W * 1.5) return; xs.push(r.x, r.x + r.w / 2, r.x + r.w); ys.push(r.y, r.y + r.h / 2, r.y + r.h); });
    const best = (edges, targets) => { let bd = T + 1, bo = 0, bt = null; edges.forEach(e => targets.forEach(t => { const d = t - e; if (Math.abs(d) < Math.abs(bd) && Math.abs(d) <= T) { bd = d; bo = d; bt = t; } })); return bt == null ? { off: 0, t: null } : { off: bo, t: bt }; };
    const sx = best([b.x, b.x + b.w / 2, b.x + b.w], xs), sy = best([b.y, b.y + b.h / 2, b.y + b.h], ys), lines = [];
    if (sx.t != null) lines.push({ x: sx.t }); if (sy.t != null) lines.push({ y: sy.t });
    return { dx: sx.off, dy: sy.off, lines };
  }
  function alignDialog() {
    const sc = cur(), xf = E.xf(sc, editT()), items = sc.objects.map((o, i) => ({ o, i })).filter(x => !x.o.hidden), checks = [];
    const label = o => o.type + (o.text ? ': ' + String(o.text).slice(0, 22) : o.icon ? ': ' + o.icon : o.value ? ': ' + o.value : '');
    const list = h('div', { style: 'max-height:240px;overflow:auto;margin:6px 0;border:1px solid #2a3a52;border-radius:6px;padding:4px' }, items.map(x => { const cb = h('input', { type: 'checkbox', checked: x.o.id === S.oid }); checks.push([cb, x.o]); return h('label', { style: 'display:block;padding:2px 4px;cursor:pointer' }, cb, ' ' + (x.i + 1) + '. ' + label(x.o)); }));
    const rel = h('select', {}, [['sel', 'Align to the selection'], ['frame', 'Align to the frame safe area']].map(o => h('option', { value: o[0], text: o[1] })));
    const sel = () => checks.filter(c => c[0].checked).map(c => c[1]);
    const bnd = o => E.bounds(E.toScreen(o, xf));
    const doAlign = k => { const os = sel(); if (!os.length) return toast('Tick the objects to align'); const bs = os.map(bnd), m = SAFE();
      const L = rel.value === 'frame' ? m : Math.min(...bs.map(b => b.x)), R = rel.value === 'frame' ? W - m : Math.max(...bs.map(b => b.x + b.w)), Tp = rel.value === 'frame' ? m : Math.min(...bs.map(b => b.y)), Bt = rel.value === 'frame' ? H - m : Math.max(...bs.map(b => b.y + b.h));
      os.forEach((o, i) => { const b = bs[i]; let dx = 0, dy = 0; if (k === 'l') dx = L - b.x; if (k === 'r') dx = R - (b.x + b.w); if (k === 'c') dx = (L + R) / 2 - (b.x + b.w / 2); if (k === 't') dy = Tp - b.y; if (k === 'b') dy = Bt - (b.y + b.h); if (k === 'm') dy = (Tp + Bt) / 2 - (b.y + b.h / 2); E.move(o, dx, dy, xf); }); commit(); };
    const doDist = ax => { const os = sel(); if (os.length < 3) return toast('Tick at least 3 objects to distribute'); const rows = os.map(o => ({ o, b: bnd(o) })).sort((a, b) => ax === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y); const first = rows[0].b, last = rows[rows.length - 1].b;
      const tot = rows.reduce((s2, r) => s2 + (ax === 'h' ? r.b.w : r.b.h), 0), span = ax === 'h' ? (last.x + last.w - first.x) : (last.y + last.h - first.y), gap = (span - tot) / (rows.length - 1); let pos = ax === 'h' ? first.x : first.y;
      rows.forEach(r => { const cp = ax === 'h' ? r.b.x : r.b.y; if (ax === 'h') E.move(r.o, pos - cp, 0, xf); else E.move(r.o, 0, pos - cp, xf); pos += (ax === 'h' ? r.b.w : r.b.h) + gap; }); commit(); };
    const btn = (t, f) => h('button', { text: t, on: { click: f } });
    modal('Align & distribute', h('div', {}, h('div', { className: 'hint', text: 'Tick the objects, choose what to align to, then click an action.' }), list, fld('Reference', rel), h('div', { className: 'btnrow' }, btn('⇤ Left', () => doAlign('l')), btn('↔ Center', () => doAlign('c')), btn('⇥ Right', () => doAlign('r'))), h('div', { className: 'btnrow' }, btn('⤒ Top', () => doAlign('t')), btn('↕ Middle', () => doAlign('m')), btn('⤓ Bottom', () => doAlign('b'))), h('div', { className: 'btnrow' }, btn('Distribute horizontally', () => doDist('h')), btn('Distribute vertically', () => doDist('v')))), [h('button', { className: 'pri', text: 'Done', on: { click: closeModal } })]);
  }
  /* ---------- Layer Style window (Photopea-like) ---------- */
  function openFxWindow(fx, title, afterChange) {
    const old = document.getElementById('fxwin'); if (old) old.remove();
    const snap = JSON.stringify(fx), W2 = h('div', { id: 'fxwin', style: 'position:fixed;right:310px;top:70px;width:640px;z-index:80;background:#3d3d3d;color:#e6e6e6;border:1px solid #1e1e1e;border-radius:6px;box-shadow:0 12px 40px rgba(0,0,0,.6);font:13px sans-serif' });
    let sel = 'stroke'; const body = h('div', { style: 'display:flex;gap:10px;padding:10px' }), list = h('div', { style: 'width:190px;background:#2f2f2f;border:1px solid #1e1e1e' }), pane = h('div', { style: 'flex:1;background:#444;border:1px solid #2a2a2a;padding:10px;min-height:300px' });
    const changed = () => { if (afterChange) afterChange(); thumbSoon(); }, done = () => commit();
    const ROWS = [['stroke', 'Stroke'], ['shadow', 'Drop Shadow'], ['coverlay', 'Color Overlay'], ['goverlay', 'Gradient Overlay'], ['glow', 'Outer Glow']];
    fx.stroke = fx.stroke || {}; fx.shadow = fx.shadow || {}; fx.coverlay = fx.coverlay || {}; fx.goverlay = fx.goverlay || {}; fx.glow = fx.glow || {};
    const num = (o, k, min, max, label, suf, step) => { const r = h('input', { type: 'range', min, max, step: step || 1, value: o[k] == null ? min : o[k], style: 'flex:1' }), n = h('input', { type: 'number', min, max, step: step || 1, value: o[k] == null ? min : o[k], style: 'width:60px;background:#222;color:#fff;border:1px solid #111' }); r.oninput = () => { o[k] = +r.value; n.value = r.value; changed(); }; n.oninput = () => { o[k] = +n.value; r.value = n.value; changed(); }; r.onchange = n.onchange = done; return h('div', { style: 'display:flex;align-items:center;gap:8px;margin:7px 0' }, h('span', { text: label, style: 'width:78px' }), r, n, h('span', { text: suf || '', style: 'width:22px' })); };
    const col = (o, k, label) => { const i = h('input', { type: 'color', value: o[k] || '#000000' }); i.oninput = () => { o[k] = i.value; changed(); }; i.onchange = done; return h('div', { style: 'display:flex;align-items:center;gap:8px;margin:7px 0' }, h('span', { text: label, style: 'width:78px' }), i); };
    const pick = (o, k, label, opts) => { const sl = h('select', { style: 'background:#222;color:#fff;border:1px solid #111' }, opts.map(x => h('option', { value: x[0], text: x[1], selected: (o[k] || opts[0][0]) === x[0] }))); sl.onchange = () => { o[k] = sl.value; changed(); done(); }; return h('div', { style: 'display:flex;align-items:center;gap:8px;margin:7px 0' }, h('span', { text: label, style: 'width:78px' }), sl); };
    function drawPane() {
      pane.innerHTML = ''; pane.append(h('div', { text: (ROWS.find(r => r[0] === sel) || [0, ''])[1], style: 'font-weight:700;border-bottom:1px solid #222;padding-bottom:6px;margin-bottom:8px' }));
      if (sel === 'stroke') pane.append(num(fx.stroke, 'size', 0, 30, 'Size', 'px'), pick(fx.stroke, 'pos', 'Position', [['outside', 'Outside'], ['center', 'Center']]), num(fx.stroke, 'opacity', 0, 100, 'Opacity', '%'), col(fx.stroke, 'color', 'Color'));
      if (sel === 'shadow') pane.append(col(fx.shadow, 'color', 'Color'), num(fx.shadow, 'opacity', 0, 100, 'Opacity', '%'), num(fx.shadow, 'angle', -180, 180, 'Angle', '°'), num(fx.shadow, 'dist', 0, 60, 'Distance', 'px'), num(fx.shadow, 'size', 0, 60, 'Size', 'px'));
      if (sel === 'coverlay') pane.append(col(fx.coverlay, 'color', 'Color'), num(fx.coverlay, 'opacity', 0, 100, 'Opacity', '%'));
      if (sel === 'goverlay') pane.append(col(fx.goverlay, 'c1', 'Color 1'), col(fx.goverlay, 'c2', 'Color 2'), num(fx.goverlay, 'angle', -180, 180, 'Angle', '°'), num(fx.goverlay, 'opacity', 0, 100, 'Opacity', '%'), h('div', { className: 'hint', text: 'Angle 90° = color 1 at the top, color 2 at the bottom.' }));
      if (sel === 'glow') pane.append(col(fx.glow, 'color', 'Color'), num(fx.glow, 'opacity', 0, 100, 'Opacity', '%'), num(fx.glow, 'size', 0, 60, 'Size', 'px'));
    }
    function drawList() { list.innerHTML = ''; ROWS.forEach(([k, l]) => { const cb = h('input', { type: 'checkbox', checked: !!fx[k].on }); cb.onclick = e => e.stopPropagation();   /* v0.10.1.5: the row's click rebuilt the list and removed this checkbox before its change event, so ticking an effect did nothing */
    cb.onchange = () => { fx[k].on = cb.checked; sel = k; drawList(); drawPane(); changed(); done(); }; list.append(h('div', { style: 'display:flex;align-items:center;gap:8px;padding:7px 8px;cursor:pointer;border-bottom:1px solid #222;' + (sel === k ? 'background:#555' : ''), on: { click: () => { sel = k; drawList(); drawPane(); } } }, cb, h('span', { text: l }))); }); }
    const head = h('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #222;cursor:move;font-size:15px;font-weight:700', text: title || 'Layer Style' }, h('span', { text: '✕', style: 'cursor:pointer', on: { click: () => { done(); W2.remove(); } } }));
    let dr = null; head.onpointerdown = e => { dr = [e.clientX, e.clientY, W2.offsetLeft, W2.offsetTop]; head.setPointerCapture(e.pointerId); }; head.onpointermove = e => { if (dr) { W2.style.left = dr[2] + e.clientX - dr[0] + 'px'; W2.style.top = dr[3] + e.clientY - dr[1] + 'px'; W2.style.right = 'auto'; } }; head.onpointerup = () => { dr = null; };
    const btns = h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;padding:0 10px 10px' }, h('button', { text: 'Reset (Photopea style)', on: { click: () => { Object.keys(fx).forEach(k => delete fx[k]); Object.assign(fx, E.fxDefault()); drawList(); drawPane(); changed(); done(); } } }), h('button', { text: 'Cancel', on: { click: () => { Object.keys(fx).forEach(k => delete fx[k]); Object.assign(fx, JSON.parse(snap)); changed(); done(); W2.remove(); } } }), h('button', { className: 'pri', text: 'OK', on: { click: () => { done(); W2.remove(); } } }));
    const PK = 'wx_fxpresets', lp = () => { try { return JSON.parse(localStorage.getItem(PK) || '{}'); } catch (e) { return {}; } }, sp = v => { try { localStorage.setItem(PK, JSON.stringify(v)); } catch (e) { toast('Could not save style'); } };
    const psel = h('select', { style: 'background:#222;color:#fff;border:1px solid #111;max-width:200px' });
    const fillP = () => { psel.innerHTML = ''; psel.append(h('option', { value: '', text: 'Saved styles…' })); Object.keys(lp()).forEach(k => psel.append(h('option', { value: k, text: k }))); };
    psel.onchange = () => { const v = lp()[psel.value]; if (!v) return; Object.keys(fx).forEach(k => delete fx[k]); Object.assign(fx, JSON.parse(JSON.stringify(v))); drawList(); drawPane(); changed(); done(); };
    const prow = h('div', { style: 'display:flex;gap:8px;align-items:center;padding:8px 10px 0' }, psel, h('button', { text: 'Save style as…', on: { click: () => { const n = prompt('Name this style (e.g. Billerica title):'); if (!n) return; const all = lp(); all[n] = JSON.parse(JSON.stringify(fx)); sp(all); fillP(); psel.value = n; toast('Style saved'); } } }), h('button', { text: 'Delete', on: { click: () => { if (!psel.value) return; const all = lp(); delete all[psel.value]; sp(all); fillP(); } } })); fillP();
    body.append(list, pane); W2.append(head, prow, body, btns); document.body.append(W2); drawList(); drawPane();
  }
  /* ---------- modals ---------- */
  function modal(title, body, buttons) { const m = $('#modal'); m.innerHTML = ''; m.append(h('h3', { text: title }), body, h('div', { className: 'mb' }, buttons || [])); $('#modalBg').style.display = 'flex'; }
  function closeModal() { $('#modalBg').style.display = 'none'; $('#modal').innerHTML = ''; }
  function sevenDay() {
    const days = E.sample7(), meta = { title: '7-Day Forecast', sub: 'Billerica, MA', layout: 'bw' }, tb7 = h('table', { className: 't7' }, h('tr', {}, ['Day', 'Date', 'Icon', 'Phrase', 'High', 'Low', 'PoP %', 'Tag', 'Top tag', 'Magenta'].map(x => h('th', { text: x }))));
    const prev = h('canvas', { width: 64, height: 64 });
    const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], AB = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], rows = [];
    const startSel = h('select', { style: 'width:100px' }, FULL.map((n, k) => h('option', { value: k, text: n, selected: AB[k] === days[0].day })));
    function applyStart() { const k0 = +startSel.value, t = new Date(); t.setHours(12, 0, 0, 0); const off = (k0 - t.getDay() + 7) % 7;
      days.forEach((d, i) => { const dt = new Date(t); dt.setDate(t.getDate() + off + i); d.day = AB[(k0 + i) % 7]; d.date = `${dt.getMonth() + 1}/${dt.getDate()}`; if (i > 0) rows[i].day.value = d.day; rows[i].date.value = d.date; }); }
    startSel.onchange = applyStart;
    days.forEach((d, i) => { const sel = h('select', { style: 'width:150px' }, g.Icons.list.map(i => h('option', { value: i.id, text: i.label, selected: i.id === d.icon })));
      const ph = h('input', { type: 'text', value: d.phrase, style: 'width:150px' }); sel.onchange = () => { if (ph.value === g.Icons.label(d.icon)) ph.value = g.Icons.label(sel.value); d.icon = sel.value; if (!ph.value) ph.value = g.Icons.label(d.icon); d.phrase = ph.value; };
      ph.oninput = () => d.phrase = ph.value; const inp = (k, w, t) => { const i = h('input', { type: t || 'text', value: d[k], style: 'width:' + w + 'px' }); i.oninput = () => d[k] = t === 'number' ? +i.value : i.value; return i; };
      d.phrase = d.phrase || g.Icons.label(d.icon);
      const dayCell = i === 0 ? startSel : (rows[i] = h('input', { type: 'text', value: d.day, readOnly: true, style: 'width:50px;opacity:.75' })), dateCell = inp('date', 56); rows[i] = { day: dayCell, date: dateCell };
      tb7.append(h('tr', {}, [dayCell, dateCell, sel, ph, inp('hi', 56, 'number'), inp('lo', 56, 'number'), inp('pop', 56, 'number'), inp('tag', 90), inp('tag2', 80), (() => { const c = h('input', { type: 'checkbox', title: 'Magenta panel behind this day' }); c.onchange = () => { d.hl = c.checked; }; return c; })()].map((x, ci) => h('td', { className: (i >= 5 && [3, 5, 7, 8].includes(ci)) ? 'dis' : '' }, x)))); });
    startSel.value = AB.indexOf(days[0].day); applyStart();
    const lay = h('select', { onchange: e => { meta.layout = e.target.value; } }, [['bw', 'Billerica Weather template (your background)'], ['classic', 'Classic 7 cards (generic background)']].map(o => h('option', { value: o[0], text: o[1] })));
    const body = h('div', {}, fld('Layout', lay), h('div', { className: 'row' }, h('label', { text: 'Title' }), h('input', { type: 'text', value: meta.title, oninput: e => meta.title = e.target.value })), h('div', { className: 'row' }, h('label', { text: 'Location' }), h('input', { type: 'text', value: meta.sub, oninput: e => meta.sub = e.target.value })), tb7, h('div', { className: 'hint', text: 'Pick the starting weekday in Day 1 and the rest follow in order. In the Billerica Weather layout days 6 and 7 show only icon, high and precip (greyed fields are unused); Sat/Sun get orange headers; tick Magenta to tint that day panel (semi-transparent, your background still shows through); lows sit under the gaps between days 1–5. Sample values – replace them with your forecast. Icons animate and each card slides in one after another. Everything stays editable afterwards.' }));
    modal('7-Day Forecast Builder', body, [h('button', { text: 'Cancel', on: { click: closeModal } }), h('button', { className: 'pri', text: 'Create scene', on: { click: () => { const dd = days.map(d => Object.assign({}, d, { hi: Math.round(d.hi), lo: Math.round(d.lo) })); let sc; if (meta.layout === 'bw' && g.WX_BG7DAY) { S.show.assets.bg7day = g.WX_BG7DAY; sc = E.sceneFromBW(dd, 'bg7day'); } else sc = E.sceneFrom7Day(dd, meta.title, meta.sub); S.show.scenes.splice(S.si + 1, 0, sc); S.si++; S.oid = null; closeModal(); commit(); refreshAll(); } } })]);
  }
  function templatesDialog() {
    const STORM = ['Timing: latest track and timing may have slowed the start time for rainfall Fri/Sat AM', 'Change in the track and speed will shift where the heaviest rain occurs', 'Confidence remains high that southeastern MA, Cape & Islands will see the strongest wind gusts', 'Coastal flooding & beach erosion still remain along the coast. Power outages still possible.'];
    const HEAD = ['Bands of rain move in Cape/Islands 11A-12P, Boston 2-3P, Billerica Fri eve', 'Peak wind & rain Friday night into Saturday', 'Widespread 2-4" rainfall in the east, locally higher coast/SE MA', 'Strongest winds Fri night-Sat 40-50+, power outages? 30-40 mph inland'];
    const defs = { 'hl-sky': ['Weather Headlines', HEAD], 'hl-night': ['Weather Headlines', HEAD], 'hl-day': ['Weather Headlines', HEAD], 'storm-night': ['Storm Update', STORM], 'storm-day': ['Storm Update', STORM], impacts: ['Storm Impacts', ['Friday-Monday', 'Rain 1.00" west', 'Heavy rain 2-4"+ east', 'Strong winds 40+ mph Cape']] };
    const st = { kind: 'storm-night', title: defs['storm-night'][0], lines: defs['storm-night'][1].slice(), size: 0, titleSize: 0 };
    const tIn = h('input', { type: 'text', value: st.title, oninput: e => st.title = e.target.value }), tas = [0, 1, 2, 3, 4].map(i => h('textarea', { rows: 2, value: st.lines[i] || '', oninput: e => { st.lines[i] = e.target.value; } }));
    const hint = h('div', { className: 'hint' }), hintFor = () => { hint.textContent = st.kind === 'impacts' ? 'Impacts: first line is the time frame (lower left); the next lines become red panels. It keeps the current scene background (your map).' : 'One line per bar (4 bars). The banner and bars come from your artwork; the title sits centred in the white banner area and each line is centred in its bar, shrinking to fit on up to 2 lines. Text is capitalized automatically and everything stays editable afterwards.'; tas.forEach((t, i) => { t.style.display = (E.TPL_ART[st.kind] && i > 3) ? 'none' : ''; const lab = t.parentElement; if (lab && lab.style) lab.style.display = t.style.display; }); };
    const kindSel = h('select', { onchange: e => { st.kind = e.target.value; const d = defs[st.kind]; st.title = d[0]; st.lines = d[1].slice(); tIn.value = st.title; tas.forEach((t, i) => { t.value = st.lines[i] || ''; }); hintFor(); } }, E.TEMPLATES.map(t => h('option', { value: t[0], text: t[1], selected: t[0] === st.kind })));
    const szIn = h('input', { type: 'number', min: 0, max: 300, step: 1, placeholder: 'auto', style: 'width:90px', title: 'Blank or 0 = the largest size at which all four bars fit on two lines. Every bar gets this same size.', oninput: e => { st.size = +e.target.value || 0; } });
    const tzIn = h('input', { type: 'number', min: 0, max: 300, step: 1, placeholder: '84', style: 'width:90px', oninput: e => { st.titleSize = +e.target.value || 0; } });
    modal('Scene templates', h('div', {}, fld('Template', kindSel), fld('Title', tIn), fld('Title size', tzIn), fld('Bar text size', szIn), hint, ...tas.map(t => fld('', t, true))),
      [h('button', { text: 'Cancel', on: { click: closeModal } }), h('button', { className: 'pri', text: 'Create scene', on: { click: () => {
        const art = E.TPL_ART[st.kind]; if (art && !(g.WX_TPL && g.WX_TPL[art.asset])) { toast('Template artwork is missing from this build.'); return; }
        const bg = st.kind === 'impacts' ? JSON.parse(JSON.stringify(cur().bg)) : null; S.show.assets = S.show.assets || {};
        if (art) S.show.assets[art.asset] = g.WX_TPL[art.asset]; else if (!bg && g.WX_BGDEFAULT) S.show.assets.bgdefault = g.WX_BGDEFAULT;
        const sc = E.sceneFromTemplate(st.kind, { title: st.title, lines: st.lines, safe: SAFE(), size: st.size, titleSize: st.titleSize }, bg); S.show.scenes.splice(S.si + 1, 0, sc); S.si++; S.oid = null; closeModal(); commit(); refreshAll(); } } })]);
    hintFor();
  }
  function mapboxSettings() {
    const tok = h('input', { type: 'password', value: g.MB.token(), placeholder: 'pk.eyJ1…', style: 'width:100%' }), sc = h('select', {}, [['1', 'Native / sharp (recommended)'], ['1.25', 'Slightly larger labels'], ['1.5', 'Large labels'], ['2', 'Extra large labels']].map(o => h('option', { value: o[0], text: o[1], selected: +o[0] === g.MB.scale })));
    const body = h('div', {}, h('div', { className: 'hint', text: 'Create a free account at mapbox.com, copy your default public token (it starts with pk.) and paste it here. It is stored only in this browser. Keep the page tab visible while exporting a Mapbox video.' }), fld('Public token', tok), fld('Label size', sc), h('div', { className: 'hint', id: 'mbstat', text: g.MB.status === 'error' ? 'Status: ' + g.MB.err : 'Status: ' + g.MB.status }));
    modal('Mapbox settings', body, [h('button', { text: 'Close', on: { click: closeModal } }), h('button', { className: 'pri', text: 'Save & load map', on: { click: () => { const t = tok.value.trim(); if (t && !/^pk\./.test(t)) { toast('Use a public token that starts with pk.'); return; } g.MB.setToken(t); if (+sc.value !== g.MB.scale) g.MB.setScale(+sc.value); closeModal();
      if (t && S.show.scenes.some(x => x.bg.type === 'map') && confirm('Switch your existing basic-map scenes to Mapbox?')) S.show.scenes.forEach(x => { if (x.bg.type === 'map') { x.bg.type = 'mapbox'; x.bg.view = null; x.bg.view2 = null; } });
      g.MB.init().then(() => toast('Mapbox ready')).catch(e => toast(e.message)).then(() => { commit(); refreshAll(); }); } } })]);
  }
  $('#b7').onclick = sevenDay; $('#bTpl').onclick = templatesDialog;
  /* ---------- video export dialog (v0.10.0): X / Facebook / Custom presets, preflight checklist, file check ---------- */
  const EXP_KEY = 'wx.export.v1', EXP_DEF = { preset: 'x', size: '1920x1080', mbps: '10' };
  function expPrefs() { try { return Object.assign({}, EXP_DEF, JSON.parse(localStorage.getItem(EXP_KEY) || '{}')); } catch (e) { return Object.assign({}, EXP_DEF); } }
  function expSave(p) { try { localStorage.setItem(EXP_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ } }
  function expBtnTitle() { const p = expPrefs(), st = g.Exporter.presetSettings(p.preset, { size: p.size, mbps: p.mbps }); const b = $('#bExport'); if (b) b.title = `Export a finished MP4 – last used: ${st.title}`; }
  async function exportDialog() {
    const X = g.Exporter, ac = new AbortController(), bar = h('i'), msg = h('div', { className: 'hint', text: '' }), res = h('div'), pf = h('div', { className: 'expcheck' }), sum = h('div', { className: 'hint' });
    const prefs = expPrefs(); if (!['x', 'facebook', 'custom'].includes(prefs.preset)) prefs.preset = 'x';
    const size = h('select', {}, X.CUSTOM_SIZES.map(o => h('option', { value: o[0], text: o[1], selected: o[0] === prefs.size }))), br = h('select', {}, X.CUSTOM_QUALITY.map(o => h('option', { value: o[0], text: o[1], selected: o[0] === String(prefs.mbps) })));
    const customRows = h('div', {}, fld('Size', size), fld('Quality', br)), go = h('button', { className: 'pri', text: 'Start export' }), test = h('button', { text: 'Test export (2 s)', title: 'Makes a 2-second test video to check this browser can encode and play MP4' });
    let busy = false, token = 0, cur = null, tot = E.total(S.show);
    /* v0.10.1.5: choose what to render – the whole show (default, as before), only the scene you are on, or a range of scenes. */
    const nmOf = i => `${i + 1} · ${(S.show.scenes[i] && S.show.scenes[i].name) || 'Scene'}`, nScenes = S.show.scenes.length, here = Math.min(S.si, nScenes - 1);
    const scope = h('select', {}, [['all', `Whole show (${nScenes} scene${nScenes === 1 ? '' : 's'})`], ['one', 'This scene only – ' + nmOf(here)]].concat(nScenes > 1 ? [['range', 'A range of scenes…']] : []).map(o => h('option', { value: o[0], text: o[1] })));
    const opts = sel => S.show.scenes.map((sc, i) => h('option', { value: i, text: nmOf(i), selected: i === sel })), from = h('select', {}, opts(here)), to = h('select', {}, opts(here));
    const rangeRow = h('div', { style: 'display:none;gap:8px' }, h('div', { style: 'flex:1' }, fld('From scene', from)), h('div', { style: 'flex:1' }, fld('To scene', to)));
    function target() {
      const sc = S.show.scenes, n = sc.length; let a = 0, b = n - 1;
      if (scope.value === 'one') a = b = here; else if (scope.value === 'range') { a = +from.value; b = +to.value; if (a > b) { const t = a; a = b; b = t; } }
      const whole = a === 0 && b === n - 1, sub = whole ? S.show : Object.assign({}, S.show, { scenes: sc.slice(a, b + 1) });
      const clean = x => String(x || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_'), showName = clean(S.show.name) || 'weather';
      const stem = whole ? showName : a === b ? (clean(sc[a].name) || 'scene_' + (a + 1)) : showName + '_scenes_' + (a + 1) + '-' + (b + 1);
      return { show: sub, a, b, whole, stem, text: whole ? '' : a === b ? `Scene ${a + 1} only · ` : `Scenes ${a + 1}–${b + 1} · ` };
    }
    const btns = X.PRESETS.map(p => ({ id: p.id, label: p.label })).concat([{ id: 'custom', label: 'Custom' }]).map(o => h('button', { text: o.label, 'data-preset': o.id, style: 'flex:1;padding:10px 6px;font-weight:700', on: { click: () => { if (busy) return; prefs.preset = o.id; expSave(prefs); sync(); } } }));
    const settings = () => X.presetSettings(prefs.preset, { size: prefs.size, mbps: prefs.mbps });
    const ICON = { ok: ['✓', '#4cd08a'], info: ['ℹ', '#7fb2e6'], warn: ['⚠', '#ffc24a'], error: ['✖', '#ff6b6b'] };
    async function refreshChecks() {
      const my = ++token, st = settings(); pf.innerHTML = ''; pf.append(h('div', { className: 'hint', text: 'Checking…' })); go.disabled = true;
      let items; try { const tg = target(); tot = E.total(tg.show); items = X.preflightItems(await X.gatherFacts(tg.show, st, tg.a), st, tot); } catch (e) { items = [{ level: 'warn', text: 'Could not run the checks: ' + (e && e.message || e) }]; }
      if (my !== token) return; cur = items; pf.innerHTML = '';
      items.forEach(it => pf.append(h('div', { style: 'display:flex;gap:8px;margin:3px 0;font-size:13px;line-height:1.35' }, h('span', { text: ICON[it.level][0], style: 'color:' + ICON[it.level][1] + ';font-weight:700;width:14px;flex:none' }), h('span', { text: it.text }))));
      go.disabled = busy || !X.canExport(items);
      if (!X.canExport(items) && items.some(i => /H\.264|encode MP4/.test(i.text) && i.level === 'error')) offerWebM();
    }
    function offerWebM() { if (res.querySelector('.webmoffer')) return; res.append(h('div', { className: 'webmoffer hint', style: 'margin-top:8px' }, 'If you only need a quick draft to look at, this browser can record a WebM. It is not suitable for posting to X or Facebook. ', h('button', { text: 'Make a WebM draft', on: { click: () => run(true) } }))); }
    function sync() {
      btns.forEach(b => b.className = b.dataset.preset === prefs.preset ? 'pri' : '');
      customRows.style.display = prefs.preset === 'custom' ? '' : 'none'; rangeRow.style.display = scope.value === 'range' ? 'flex' : 'none'; const st = settings(), tg = target(); tot = E.total(tg.show);
      sum.textContent = `${tg.text}${st.width}×${st.height} · ${st.fps} fps · ${(st.bitrate / 1e6)} Mbps · H.264 MP4 · ${X.fmtDuration(tot)} (${tot.toFixed(1)} s)`; expBtnTitle(); refreshChecks();
    }
    scope.onchange = from.onchange = to.onchange = () => { if (!busy) sync(); };
    size.onchange = () => { prefs.size = size.value; expSave(prefs); sync(); }; br.onchange = () => { prefs.mbps = br.value; expSave(prefs); sync(); };
    async function run(draft) {
      busy = true; go.disabled = true; test.disabled = true; const st = settings(), tg = target(); stopPlay(); msg.textContent = 'Rendering…'; msg.style.color = ''; res.innerHTML = ''; bar.style.width = '0%';
      try {
        const r = await X.run(tg.show, { width: st.width, height: st.height, bitrate: st.bitrate, fps: st.fps, signal: ac.signal, allowWebM: !!draft, onProgress: p => { bar.style.width = (p * 100).toFixed(0) + '%'; msg.textContent = `Rendering… ${(p * 100).toFixed(0)}%`; } });
        const url = URL.createObjectURL(r.blob), name = tg.stem + (r.kind === 'mp4' ? '_' + st.id : '_draft') + '.' + r.ext;
        msg.textContent = `Done – ${(r.blob.size / 1048576).toFixed(1)} MB. ${r.note}`; saveFile(r.blob, name); msg.textContent += ' Saved to your Downloads folder.';
        const chk = h('div', { className: 'hint', text: r.kind === 'mp4' ? 'Checking the finished file…' : 'This is a draft recording – not checked.' }); res.append(chk, h('video', { src: url, controls: true, style: 'width:100%;max-width:640px;border-radius:8px;margin-top:8px' }), h('div', { className: 'mb' }, h('a', { href: url, download: name }, h('button', { text: 'Download again' }))));
        if (r.kind === 'mp4') { const v = await X.verify(r.blob, { width: r.width, height: r.height, duration: r.seconds, fps: r.fps }); chk.textContent = v.text; chk.style.color = v.status === 'verified' ? '#4cd08a' : v.status === 'failed' ? '#ff6b6b' : '#ffc24a'; chk.dataset.status = v.status; }
        else { chk.style.color = '#ffc24a'; }
      } catch (e) {
        if (e && e.code === 'NO_H264') { msg.textContent = e.message; msg.style.color = '#ff6b6b'; offerWebM(); } else if (e && e.message === 'cancelled') msg.textContent = 'Export cancelled.'; else { msg.textContent = 'Export failed: ' + (e && e.message || e); msg.style.color = '#ff6b6b'; }
      }
      busy = false; test.disabled = false; go.disabled = cur ? !X.canExport(cur) : false;
    }
    go.onclick = () => run(false);
    test.onclick = async () => {
      busy = true; go.disabled = true; test.disabled = true; msg.textContent = 'Running a 2-second test export…'; msg.style.color = ''; res.innerHTML = '';
      const r = await X.selfTest(p => { bar.style.width = (p * 100).toFixed(0) + '%'; }); msg.textContent = r.text; msg.style.color = r.ok ? '#4cd08a' : '#ff6b6b'; if (r.code === 'NO_H264') offerWebM();
      busy = false; test.disabled = false; go.disabled = cur ? !X.canExport(cur) : false;
    };
    modal('Export video', h('div', {}, h('div', { style: 'display:flex;gap:6px;margin-bottom:8px' }, btns), customRows, fld('Scenes to export', scope), rangeRow, sum, pf, h('div', { className: 'prog' }, bar), msg, res), [h('button', { text: 'Close', on: { click: () => { ac.abort(); token++; closeModal(); } } }), test, go]);
    sync();
  }
  /* ---------- still image export (PNG/JPG) for X / Facebook ---------- */
  function saveFile(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); return url; }
  async function imageDialog() {
    const SZ = [['1920x1080', '16:9 – 1920×1080 (X and Facebook, best quality)'], ['1200x675', '16:9 – 1200×675 (smaller file, fine for X)'], ['1080x1080', 'Square 1:1 – 1080×1080 (Facebook feed)'], ['1080x1350', 'Portrait 4:5 – 1080×1350 (tall Facebook post)']];
    const size = h('select', {}, SZ.map(o => h('option', { value: o[0], text: o[1] }))), fmt = h('select', {}, [['png', 'PNG (sharpest text)'], ['jpeg', 'JPG (smaller file)']].map(o => h('option', { value: o[0], text: o[1] }))), what = h('select', {}, [['one', 'Current scene only'], ['all', 'All scenes (one PNG each)']].map(o => h('option', { value: o[0], text: o[1] })));
    const pos = h('input', { type: 'range', min: 0, max: 100, value: 50 }), msg = h('div', { className: 'hint', text: 'Saves the finished look of the scene (everything animated in).' }), res = h('div'), go = h('button', { className: 'pri', text: 'Create image' });
    const hint = h('div', { className: 'hint', text: 'Square and portrait crop the 16:9 scene. The slider picks which part is kept (50 = center).' });
    go.onclick = async () => {
      go.disabled = true; res.innerHTML = ''; stopPlay(); E.exporting = true;
      try {
        const [w, hh] = size.value.split('x').map(Number), type = fmt.value === 'png' ? 'image/png' : 'image/jpeg', ext = fmt.value === 'png' ? 'png' : 'jpg', starts = E.starts(S.show), warn = [], idx = what.value === 'all' ? S.show.scenes.map((_, i) => i) : [S.si], files = [];
        const cv = document.createElement('canvas'); cv.width = E.W; cv.height = E.H; const c = cv.getContext('2d'), out = document.createElement('canvas'); out.width = w; out.height = hh; const oc = out.getContext('2d'); oc.imageSmoothingQuality = 'high';
        const ar = w / hh, sw = Math.min(E.W, E.H * ar), sh = sw / ar, sx = (E.W - sw) * (+pos.value / 100);
        for (const i of idx) {
          const sc = S.show.scenes[i], lt = Math.max(0.1, sc.duration - 0.05); msg.textContent = `Rendering scene ${i + 1}/${S.show.scenes.length}…`;
          try { await E.prepareFrame(S.show, starts[i] + lt); } catch (e2) { warn.push((i + 1) + ': ' + (e2 && e2.message || e2)); } E.renderScene(c, S.show, sc, lt, { editing: false });
          oc.fillStyle = '#000'; oc.fillRect(0, 0, w, hh); oc.drawImage(cv, sx, (E.H - sh) / 2, sw, sh, 0, 0, w, hh);
          const blob = await new Promise(r => out.toBlob(r, type, 0.92)); files.push({ name: String(i + 1).padStart(2, '0') + '_' + (sc.name || 'scene').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.' + ext, blob });
        }
        const base = (S.show.name || 'weather').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
        let last = null; for (const f of files) { last = saveFile(f.blob, base + '_' + f.name); await new Promise(r => setTimeout(r, 400)); }
        msg.textContent = `Saved ${files.length} image${files.length > 1 ? 's' : ''} to your Downloads folder.` + (warn.length ? ' Note – map not ready for scene ' + warn.join('; ') : '');
        if (files.length === 1) res.append(h('img', { src: last, style: 'width:100%;max-width:560px;border-radius:8px;margin-top:8px' }));
      } catch (e) { msg.textContent = 'Image export failed: ' + (e && e.message || e); } E.exporting = false; go.disabled = false;
    };
    modal('Export image', h('div', {}, fld('Scenes', what), fld('Size', size), fld('Format', fmt), fld('Crop position', pos), hint, msg, res), [h('button', { text: 'Close', on: { click: closeModal } }), go]);
  }
  $('#bImg').onclick = imageDialog;
  $('#bAddMap').onclick = () => { const cs = cur(), other = S.show.scenes.find(x => isMap(x.bg)), fresh = isMap(cs.bg) ? null : (other ? null : defaultMapBg()), srcBg = isMap(cs.bg) ? cs.bg : (other ? other.bg : fresh); const sc = E.newScene({ name: 'Map ' + (S.show.scenes.length + 1), bg: JSON.parse(JSON.stringify(srcBg)), title: { show: false, text: '', sub: '' } }); S.show.scenes.splice(S.si + 1, 0, sc); S.si++; S.oid = null; commit(); refreshAll(); toast(isMap(cs.bg) ? 'New scene with the same map – draw on it' : (other ? 'New map scene (copied from your other map scene) – draw on it' : 'New map scene with your default map – draw on it')); };
  $('#bExport').onclick = exportDialog; expBtnTitle();

  /* ---------- top bar ---------- */
  $('#showName').oninput = e => { S.show.name = e.target.value; }; $('#showName').onchange = commit;
  /* ---------- v0.10.1: portable show file (Save / Open) and recent autosaves ---------- */
  const WF = g.WXShowFile, appVer = () => (($('#ver') || {}).textContent || '').replace(/^v/, '').split(' ')[0];
  const fmtMB = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  const showFileName = () => (S.show.name || 'show').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'show';
  function downloadBlob(blob, name) { const u = URL.createObjectURL(blob), a = h('a', { href: u, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }
  function notice(title, lines) { modal(title, h('div', { style: 'display:grid;gap:8px;max-width:520px;line-height:1.4' }, lines.map(t => h('div', { text: t }))), [h('button', { className: 'pri', text: 'OK', on: { click: closeModal } })]); }
  let fileBusy = false;
  async function saveShowFile() {
    if (fileBusy) return; if (!WF) { toast('Save is unavailable (showfile.js did not load)'); return; }
    const inv = WF.inventory(S.show, E.videos), btn = $('#bSave');
    if (inv.missing.length) {
      const names = inv.missing.slice(0, 4).map(m => m.name + ' (' + m.scenes.join(', ') + ')').join('; ');
      if (!confirm(inv.missing.length + ' video/GIF file(s) used by this show are not in this browser, so they cannot be put in the saved file: ' + names + '.\n\nThose scenes will show “not found” when the file is opened. Save anyway?')) return;
    }
    fileBusy = true; btn.disabled = true;
    try {
      if (!inv.present.length) { downloadBlob(new Blob([WF.legacyJson(S.show, { appVersion: appVer() })], { type: 'application/json' }), showFileName() + '.wxshow.json'); toast('Show saved to your downloads'); }
      else {
        toast('Packing ' + inv.present.length + ' video/GIF file(s) into the show…');
        const r = await WF.pack(S.show, { videos: E.videos, appVersion: appVer() });
        downloadBlob(r.blob, showFileName() + '.wxshow');
        toast('Saved ' + showFileName() + '.wxshow (' + fmtMB(r.blob.size) + ', includes ' + inv.present.length + ' video/GIF file' + (inv.present.length > 1 ? 's' : '') + ')');
      }
    } catch (e) { notice('Could not save the show', [String(e && e.message || e), 'Your work is still open and autosaved in this browser.']); }
    finally { fileBusy = false; btn.disabled = false; }
  }
  /* Put media from an opened file into this browser's video library (never overwrites a different file with the same id). */
  async function installMedia(media) {
    const remap = {}; let unsaved = 0;
    for (const m of media) {
      const have = vidList.find(x => x.id === m.id) || (E.videos[m.id] && E.videos[m.id].blob ? { id: m.id, blob: E.videos[m.id].blob } : null);
      if (have && have.blob.size === m.blob.size) continue;
      let id = m.id; if (have) { id = 'vid_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); remap[m.id] = id; }
      const rec = { id, name: m.name, blob: m.blob, t: Date.now(), kind: m.kind === 'gif' ? 'gif' : 'video' };
      (rec.kind === 'gif' ? E.registerGif : E.registerVideo)(id, m.blob, m.name); vidList.unshift(rec);
      try { await vidTx('readwrite', s => s.put(rec)); } catch (e) { unsaved++; }
    }
    return { remap, unsaved };
  }
  function remapMedia(show, remap) { const f = o => { if (o && remap[o.vid]) o.vid = remap[o.vid]; }; show.scenes.forEach(sc => { f(sc.bg); (sc.objects || []).forEach(f); }); }
  async function openShowFile(f) {
    if (!WF) { toast('Open is unavailable (showfile.js did not load)'); return; }
    let r; toast('Opening ' + f.name + '…');
    try { r = await WF.unpack(f, { onProgress: (p, n) => toast('Checking ' + n + '…') }); } catch (err) { notice('Could not open ' + f.name, [String(err && err.message || err)]); return; }
    await recentSnap('safety', 'Before opening ' + f.name);
    const inst = await installMedia(r.media); if (Object.keys(inst.remap).length) remapMedia(r.show, inst.remap);
    try { loadShow(r.show); } catch (err) { notice('Could not open ' + f.name, ['That file is not a WX Studio show.']); return; }
    if (HK.afterReplace) HK.afterReplace('import');
    const lines = r.warnings.slice();
    if (r.damaged.length) lines.push('These files inside the show were damaged and were skipped: ' + r.damaged.map(d => d.name + ' (' + d.why + ')').join(', ') + '.');
    const stillMissing = WF.inventory(r.show, E.videos).missing;
    if (stillMissing.length) lines.push(stillMissing.length + ' video/GIF file(s) used by this show are not available here' + (r.kind === 'json' ? ' (this older-style file does not contain videos or GIFs)' : '') + ': ' + stillMissing.slice(0, 5).map(m => m.name + ' – ' + m.scenes.join(', ')).join('; ') + '. Add them in the Videos tab and re-select them for those scenes.');
    if (inst.unsaved) lines.push(inst.unsaved + ' video/GIF file(s) could not be stored in this browser and will work only until you reload. Save the show again to keep them.');
    if (lines.length) notice('Opened ' + f.name, ['The show is open, with notes:'].concat(lines)); else toast('Opened ' + f.name + (r.media.length ? ' (' + r.media.length + ' video/GIF file' + (r.media.length > 1 ? 's' : '') + ' restored)' : ''));
  }
  /* Recent autosaves: copies of the working show kept in this browser's IndexedDB (separate from the single autosave slot).
     'auto' = at most one per 5 minutes of editing and one when you leave the tab; 'safety' = taken before Open, New or Restore replace your work. */
  const REC_MAX = { auto: 12, safety: 8 };
  const recDB = () => new Promise((res, rej) => { try { const r = indexedDB.open('wxstudio-recent', 1); r.onupgradeneeded = () => r.result.createObjectStore('snaps', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
  const recTx = async (mode, fn) => { const d = await recDB(); return new Promise((res, rej) => { const t = d.transaction('snaps', mode), s = t.objectStore('snaps'); let out; try { out = fn(s); } catch (e) { rej(e); return; } t.oncomplete = () => { d.close(); res(out && out.result); }; t.onerror = () => { d.close(); rej(t.error); }; t.onabort = () => { d.close(); rej(t.error); }; }); };
  const recMeta = async () => { const d = await recDB(); return new Promise((res, rej) => { const out = [], c = d.transaction('snaps', 'readonly').objectStore('snaps').openCursor(); c.onsuccess = () => { const cur2 = c.result; if (!cur2) { d.close(); res(out.sort((a, b) => b.t - a.t)); return; } const v = cur2.value; if ((v.owner || null) !== NS) { cur2.continue(); return; } out.push({ id: v.id, t: v.t, kind: v.kind, label: v.label, name: v.name, scenes: v.scenes, size: v.size, sig: v.sig }); cur2.continue(); }; c.onerror = () => { d.close(); rej(c.error); }; }); };
  const sigOf = str => { let x = 2166136261; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return str.length + ':' + (x >>> 0).toString(36); };
  const recLast = { auto: '', safety: '' }; let recT = 0;
  async function recentSnap(kind, label) {
    try {
      const json = JSON.stringify(S.show, slimReplacer), sig = sigOf(json);   // captured now, before any later change
      if (kind === 'safety' && HK.beforeReplace) { try { await HK.beforeReplace(); } catch (e) { /* the local safety copy below still happens */ } }
      if (recLast[kind] === sig) return; recLast[kind] = sig;
      const rec = { owner: NS || undefined, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t: Date.now(), kind, label, name: S.show.name || 'Untitled show', scenes: S.show.scenes.length, size: json.length, sig, json };
      await recTx('readwrite', s => s.put(rec));
      const mine = (await recMeta()).filter(x => x.kind === kind); const drop = mine.slice(REC_MAX[kind] || 10);
      if (drop.length) await recTx('readwrite', s => { drop.forEach(x => s.delete(x.id)); });
    } catch (e) { /* recent copies are a convenience; the normal autosave still runs */ }
  }
  function recentSoon() { if (recT) return; recT = setTimeout(() => { recT = 0; recentSnap('auto', 'Autosave'); }, 5 * 60 * 1000); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') recentSnap('auto', 'When you left the page'); });
  g.addEventListener('pagehide', () => { recentSnap('auto', 'When you left the page'); });
  recMeta().then(a => { ['auto', 'safety'].forEach(k => { const m = a.find(x => x.kind === k); if (m) recLast[k] = m.sig; }); }).catch(() => { });
  async function restoreRecent(id) {
    try {
      const rec = await recTx('readonly', s => s.get(id)); if (!rec) { toast('That copy is no longer available'); return; }
      await recentSnap('safety', 'Before restoring “' + rec.name + '”');
      loadShow(JSON.parse(rec.json)); closeModal(); if (HK.afterReplace) HK.afterReplace('restore');
      const missing = WF ? WF.inventory(S.show, E.videos).missing : []; toast('Restored “' + rec.name + '” from ' + new Date(rec.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (missing.length ? ' – ' + missing.length + ' video/GIF file(s) not in this browser' : ''));
    } catch (e) { toast('Could not restore that copy'); }
  }
  async function recentDialog() {
    let list = []; try { list = await recMeta(); } catch (e) { /* IndexedDB unavailable */ }
    const body = h('div', { style: 'display:grid;gap:8px;min-width:min(520px,80vw);max-height:60vh;overflow:auto' });
    body.append(h('div', { className: 'hint', text: 'Copies of your work kept in this browser only. “Before…” copies are taken automatically just before Open, New or Restore replace your show. Use Save to keep a file you can move to another computer.' }));
    if (!list.length) body.append(h('div', { className: 'hint', text: 'Nothing here yet. A copy is made after about five minutes of editing, when you leave the page, and before a show is replaced.' }));
    list.forEach(m => body.append(h('div', { style: 'display:flex;gap:8px;align-items:center;padding:8px;border:1px solid #42516a;border-radius:6px' },
      h('div', { style: 'flex:1;min-width:0' }, h('div', { text: m.label + (m.kind === 'safety' ? ' · safety copy' : ''), style: 'font-weight:600;overflow-wrap:anywhere' }), h('div', { className: 'hint', text: new Date(m.t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' · ' + m.name + ' · ' + m.scenes + ' scene' + (m.scenes === 1 ? '' : 's') + ' · ' + fmtMB(m.size) })),
      h('button', { className: 'sm pri', text: 'Restore', on: { click: () => { if (confirm('Replace the show that is open with this copy? Your current show is kept as a safety copy first.')) restoreRecent(m.id); } } }),
      h('button', { className: 'sm dng', text: 'Delete', on: { click: async () => { try { await recTx('readwrite', s => s.delete(m.id)); } catch (e) { /* ignore */ } recentDialog(); } } }))));
    modal('Recent autosaves', body, [h('button', { text: 'Close', on: { click: closeModal } })]);
  }
  $('#bNew').onclick = async () => { if (confirm('Start a new show? Unsaved changes will be lost.')) { await recentSnap('safety', 'Before starting a new show'); loadShow(newShowWithDefaultMap()); if (HK.afterReplace) HK.afterReplace('import'); } };
  $('#bSave').onclick = saveShowFile;
  $('#bOpen').onclick = () => $('#fileOpen').click();
  $('#fileOpen').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) openShowFile(f); };
  $('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
  $('#bAddScene').onclick = () => newScene();

  /* ---------- boot ---------- */
  function boot() {
    bgLoad(); buildTools(); let sh = null, needExt = false;
    try { const raw = localStorage.getItem(akey()); if (raw) { const p = JSON.parse(raw); if (p && p.wxIdbStub) needExt = true; else if (p && p.scenes && p.scenes.length) sh = p; } if (localStorage.getItem(idbFlag())) needExt = true; } catch (e) { sh = null; }
    if (!needExt) return bootWith(sh, false);
    /* The newest autosave lives in the larger database (the small slot was full). Read it before anything is committed; if it cannot be read, fall back to the localStorage copy. */
    Promise.race([autoGet(akey()).catch(() => null), new Promise(r => setTimeout(() => r(null), 4000))]).then(rec => {
      let x = null; try { x = rec && JSON.parse(rec.json); if (!x || !x.scenes || !x.scenes.length) x = null; } catch (e) { x = null; }
      if (!x && !sh) setTimeout(() => toast('The large autosave could not be read in this browser – check Recent autosaves in the Saved menu.'), 1200);
      bootWith(x || sh, !!x);
    });
  }
  function bootWith(sh, fromExt) {
    if(sh){migrateMB(sh);migrateWDBroadcast(sh);}
    S.show=sh||newShowWithDefaultMap();
    const loadedDefault=applySavedDefaultOnStartup(S.show);
    S.show.assets=S.show.assets||{};ensureBG(S.show);S.hist=[];S.hp=-1;
    bootHadAutosave=!!sh;
    commit();refreshAll();
    if(!sh){try{if(localStorage.getItem(touchKey())===null)localStorage.setItem(touchKey(),'0');}catch(e){/* ignore */}}
    if(S.show.scenes[0]?.bg?.type==='mapbox')setTool('pan');
    if(sh){
      toast(fromExt?'Last show restored from this browser’s larger storage':loadedDefault?'Last show restored with saved default Satellite map':'Last show restored; Satellite selected');
      E.preload(S.show).then(()=>thumbSoon(true));
    }
    // The editor already paints its current Mapbox frame continuously.
    // Do NOT call thumbSoon() from Mapbox snapshot completion: thumbnails
    // themselves call Mapbox, causing a self-sustaining snapshot loop and
    // repeated full-screen "Loading Mapbox map…" flashes while idle.
    g.MB.onUpdate = null;
    if (!g.MB.hasToken() && S.show.scenes.some(x => x.bg.type === 'mapbox')) setTimeout(mapboxSettings, 600); if (S.show.scenes.some(x => x.bg.type === 'mapbox') && g.MB.hasToken()) g.MB.init().then(() => thumbSoon(true)).catch(() => { }); g.WDMap.loadPlaces().then(() => thumbSoon(true)); g.WDMap.load().then(() => { thumbSoon(true); if (g.WDMap.status === 'error') toast('Map outlines need internet access – backgrounds and tools still work'); });
    if (document.fonts) { ['700 40px "Roboto Condensed"', '800 40px "Barlow Condensed"', '700 40px "Barlow Condensed"', '600 30px "Barlow Condensed"', '600 20px Barlow'].forEach(f => document.fonts.load(f).catch(() => { })); document.fonts.ready.then(() => thumbSoon(true)); }
    requestAnimationFrame(loop);
    booted = true;
  }
  /* ---------- v0.10.2 cloud workspace bridge (used by cloud_workspace_ui.js; nothing here talks to the network) ---------- */
  const touchFlag = () => { try { return localStorage.getItem(touchKey()); } catch (e) { return null; } };
  const hasRealLocalWork = () => S.hp > 0 || touchFlag() === '1' || (touchFlag() === null && bootHadAutosave);
  const idbAll = async (dbf, store) => { const d = await dbf(); return new Promise((res, rej) => { const q = d.transaction(store, 'readonly').objectStore(store).getAll(); q.onsuccess = () => { d.close(); res(q.result || []); }; q.onerror = () => { d.close(); rej(q.error); }; }); };
  const idbPut = async (dbf, store, recs) => { if (!recs.length) return; const d = await dbf(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'), o = t.objectStore(store); recs.forEach(r => o.put(r)); t.oncomplete = () => { d.close(); res(); }; t.onerror = () => { d.close(); rej(t.error); }; t.onabort = () => { d.close(); rej(t.error); }; }); };
  const idbDel = async (dbf, store, ids) => { if (!ids.length) return; const d = await dbf(); return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'), o = t.objectStore(store); ids.forEach(i => o.delete(i)); t.oncomplete = () => { d.close(); res(); }; t.onerror = () => { d.close(); rej(t.error); }; t.onabort = () => { d.close(); rej(t.error); }; }); };
  const LIBS = [[bgDB, 'bgs'], [vidDB, 'v'], [recDB, 'snaps']];
  /* What this browser holds from before accounts existed (only meaningful while NS is null). */
  async function legacyInfo() {
    const out = { show: null, images: 0, videos: 0, recents: 0 }; if (NS) return out;
    try {
      const raw = localStorage.getItem(KEY); let sh = null;
      if (raw && (touchFlag() === '1' || touchFlag() === null)) { sh = JSON.parse(raw); if (sh && sh.wxIdbStub) sh = null; }
      if ((!sh || localStorage.getItem(KEY + ':idb')) && (raw || localStorage.getItem(KEY + ':idb'))) { const r = await autoGet(KEY).catch(() => null); if (r) { try { const x = JSON.parse(r.json); if (x && x.scenes && x.scenes.length) sh = x; } catch (e) { /* ignore */ } } }   // the newest copy may live in the larger database
      if (sh && sh.scenes && sh.scenes.length) out.show = { name: sh.name || 'Untitled show', scenes: sh.scenes.length };
    } catch (e) { /* ignore */ }
    try { out.images = (await idbAll(bgDB, 'bgs')).filter(r => !r.owner).length; } catch (e) { /* ignore */ }
    try { out.videos = (await idbAll(vidDB, 'v')).filter(r => !r.owner).length; } catch (e) { /* ignore */ }
    try { out.recents = (await idbAll(recDB, 'snaps')).filter(r => !r.owner).length; } catch (e) { /* ignore */ }
    return out;
  }
  /* Explicit claim: move the pre-account autosave, library and recent copies to this account. Nothing is deleted; it is re-labelled. */
  async function claimLegacy(uid) {
    const raw = localStorage.getItem(KEY), dest = KEY + ':u:' + uid;
    if (raw && localStorage.getItem(dest) === null) { localStorage.setItem(dest, raw); localStorage.setItem(dest + ':touched', '1'); localStorage.removeItem(KEY); localStorage.removeItem(KEY + ':touched'); }
    try { const ext = await autoGet(KEY), had = await autoGet(dest); if (ext && !had) { await autoPut(dest, ext.json); if (localStorage.getItem(KEY + ':idb')) { localStorage.setItem(dest + ':idb', localStorage.getItem(KEY + ':idb')); localStorage.removeItem(KEY + ':idb'); } } } catch (e) { /* the copy in the larger database stays where it is */ }
    for (const [dbf, st] of LIBS) { const recs = (await idbAll(dbf, st)).filter(r => !r.owner); await idbPut(dbf, st, recs.map(r => Object.assign({}, r, { owner: uid }))); }
  }
  /* Shared-computer cleanup: removes everything this browser stored for one account. */
  async function clearAccountData(uid, settingsKeys) {
    try { localStorage.removeItem(KEY + ':u:' + uid); localStorage.removeItem(KEY + ':u:' + uid + ':touched'); localStorage.removeItem(KEY + ':u:' + uid + ':idb'); (settingsKeys || []).forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
    for (const [dbf, st] of LIBS) { try { const ids = (await idbAll(dbf, st)).filter(r => r.owner === uid).map(r => r.id); await idbDel(dbf, st, ids); } catch (e) { /* ignore */ } }
    try { await autoDel(KEY + ':u:' + uid); } catch (e) { /* ignore */ }
  }
  /* Sign-out with "keep a local copy": the open show becomes the pre-account local copy; whatever was there is kept as a recent safety copy first. */
  async function keepLocalCopy() {
    const prev = localStorage.getItem(KEY), mine = JSON.stringify(S.show);
    if (prev && prev !== mine) { try { const sh = JSON.parse(prev); await idbPut(recDB, 'snaps', [{ id: 'pre' + Date.now().toString(36), t: Date.now(), kind: 'safety', label: 'Before sign-out copy', name: sh.name || 'Untitled show', scenes: (sh.scenes || []).length, size: prev.length, sig: sigOf(prev), json: prev }]); } catch (e) { /* ignore */ } }
    try { localStorage.setItem(KEY, mine); localStorage.removeItem(KEY + ':idb'); }
    catch (e) { await autoPut(KEY, mine); try { localStorage.setItem(KEY + ':idb', String(Date.now())); } catch (e2) { localStorage.setItem(KEY, STUB); } }   // too big for the small slot: kept in the larger database
    localStorage.setItem(KEY + ':touched', '1');
  }
  function setNamespace(uid) { try { if (uid) localStorage.setItem(NS_KEY, uid); else localStorage.removeItem(NS_KEY); } catch (e) { /* ignore */ } }
  function loadCloudShow(sh, o) {
    loadShow(sh, { keepCustom: true }); const id = o && o.sceneId; if (id != null) { const i = S.show.scenes.findIndex(x => String(x.id) === String(id)); if (i > 0) { S.si = i; S.oid = null; refreshAll(); } }
  }
  g.WX = { S, E, setTool, addObject, newScene, commit, undo, redo, finishDraft, setTab, loadShow, sevenDay, exportDialog,
    cloud: { hooks: HK, changeSeq: () => chgSeq, ns: () => NS, setNamespace, hasRealLocalWork, legacyInfo, claimLegacy, clearAccountData, keepLocalCopy, loadCloudShow, builtinAssets: builtinBGs, sceneId: () => (S.show.scenes[S.si] || {}).id, renameShow: n => { S.show.name = n; commit(); }, recentDialog, modal, closeModal, notice, toast, h, fmtMB, recentSnap, videos: () => E.videos } };
  boot();
})(window);
