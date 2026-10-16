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
  function ensureBG(sh) { if (g.WX_BGDEFAULT && sh && sh.scenes && sh.scenes.some(x => x.bg && x.bg.asset === 'bgdefault')) { sh.assets = sh.assets || {}; sh.assets.bgdefault = g.WX_BGDEFAULT; } if (g.WX_BG7DAY && sh && sh.scenes && sh.scenes.some(x => x.bg && x.bg.asset === 'bg7day')) { sh.assets = sh.assets || {}; sh.assets.bg7day = g.WX_BG7DAY; } }
  const libHas = (k, v) => { try { return bgList.some(b => b.asset === k && b.data === v); } catch (e) { return false; } };
  function autosave() { try { localStorage.setItem(KEY, JSON.stringify(S.show, (k, v) => ((k === 'bg7day' && v === g.WX_BG7DAY) || (k === 'bgdefault' && v === g.WX_BGDEFAULT) || (typeof v === 'string' && /^(bg|ov)_/.test(k) && libHas(k, v))) ? undefined : v)); } catch (e) { /* quota or blocked */ } }
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
  function loadShow(sh) { if (!sh || !Array.isArray(sh.scenes) || !sh.scenes.length) throw new Error('not a show file'); sh.assets = sh.assets || {}; ensureBG(sh); sh.accent = sh.accent || '#2f9bff'; migrateMB(sh); migrateWDBroadcast(sh); S.show = sh; S.si = 0; S.oid = null; S.hist = []; S.hp = -1; commit(); refreshAll(); E.preload(sh).then(thumbSoon); }

  /* ---------- thumbnails ---------- */
  const tb = document.createElement('canvas'); tb.width = W; tb.height = H; const tbc = tb.getContext('2d'); let tk = null;
  function drawThumb(i) { const sc = S.show.scenes[i], cv = document.querySelector(`.sc[data-i="${i}"] canvas`); if (!cv) return; try { E.renderScene(tbc, S.show, sc, Math.min(2.5, sc.duration), { editing: true, camT: 0 }); const c = cv.getContext('2d'); c.drawImage(tb, 0, 0, cv.width, cv.height); } catch (e) { /* ignore */ } }
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
  const TOOLS = [['pan', '✋ Pan Map'], ['select', '⌖ Select'], ['pen', '✎ Pen'], ['arrow', '➚ Arrow'], ['line', '〰 Isobar'], ['front', '▲ Front'], ['hl-H', 'H'], ['hl-L', 'L'], ['icon', '☀ Icon'], ['text', 'T Text'], ['rect', '▭ Box'], ['ellipse', '◯ Oval'], ['pin', '● Pin'], ['storm', '🌀 Storm'], ['barb', '⇶ Wind barb']];
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
    if(S.show&&['front','arrow','line'].includes(id))toast('Click each point along the line, then double-click (or press Enter) to finish');
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
    if (['arrow', 'line', 'front'].includes(S.tool)) {
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
  ov.addEventListener('dblclick', () => { if (S.draft && S.draft.pts) { S.draft.pts.pop(); finishDraft(); } });
  ov.addEventListener('wheel', e => { const sc = cur(); if (!isMap(sc.bg)) return; e.preventDefault(); backToEdit(); const p = pt(e);
    if (sc.bg.type === 'mapbox') { g.MB.setInteractive(true); const v = mapView(sc), ll = E.xf(sc, editT()).inv(p[0], p[1]); v.z = clamp(v.z - e.deltaY * 0.0025, 0, 20); const l2 = E.xf(sc, editT()).inv(p[0], p[1]); if (isFinite(ll[0]) && isFinite(l2[0])) v.c = [v.c[0] + ll[0] - l2[0], Math.max(-85, Math.min(85, v.c[1] + ll[1] - l2[1]))]; updateZoomBadge(); clearTimeout(ov._wt); ov._wt = setTimeout(()=>{g.MB.setInteractive(false);commit();},180); return; }
    const v = mapView(sc), k = W / v.w, P = [v.cx + (p[0] - W / 2) / k, v.cy + (p[1] - H / 2) / k]; v.w = clamp(v.w * Math.exp(e.deltaY * 0.0012), 18, 1700); const k2 = W / v.w; v.cx = P[0] - (p[0] - W / 2) / k2; v.cy = P[1] - (p[1] - H / 2) / k2; clearTimeout(ov._wt); ov._wt = setTimeout(commit, 400); }, { passive: false });
  ['dragover', 'dragenter'].forEach(ev => stage.parentElement.addEventListener(ev, e => { e.preventDefault(); }));
  stage.parentElement.addEventListener('drop', e => { e.preventDefault(); const ovid = e.dataTransfer && e.dataTransfer.getData('application/x-wx-overlay'); if (ovid) { const b = bgList.find(x => x.id === ovid); if (b) { addOverlay(b, pt(e)); setTool('select'); } return; } const ic = e.dataTransfer && e.dataTransfer.getData('application/x-wx-icon'); if (ic) { const p = pt(e); addObject('icon', { x: p[0], y: p[1], icon: ic }); setTool('select'); const o = selObj(); if (o) { S.oid = o.id; } refreshAll(); return; } if (e.dataTransfer && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files], e.shiftKey ? 'bg' : 'obj'); });
  document.addEventListener('keydown', e => {
    const tg = e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
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
  let last = 0;
  function loop(ts) {
    requestAnimationFrame(loop); const liveMapScene=cur&&cur().bg&&cur().bg.type==='mapbox'; const frameMs=(liveMapScene&&(g.MB.interacting||S.mode!=='edit'))?15:30; if (ts - last < frameMs) return; last = ts;
    try {
      // Keep the zoom text synchronized independently of expensive map frames.
      updateZoomBadge();
      if (S.mode === 'edit') { E.renderScene(sctx, S.show, cur(), clock(), { editing: true, camT: editT(), liveMap: true }); drawOverlay(); }
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
        if (d.type === 'front') g.Sym.drawFront(octx, S.opt.front, pts, 28, clock()); else g.Sym.drawPath(octx, pts, { color: '#ffe14d', width: 8, raw: d.type === 'pen', glow: false, head: d.type === 'arrow', t: clock() });
        octx.fillStyle = '#fff'; d.pts.forEach(p => { octx.beginPath(); octx.arc(p[0], p[1], 6, 0, 6.3); octx.fill(); }); }
    }
    const o = selObj();
    if (o && !d) { const so = E.toScreen(o, xf), hd = handles(so), b = hd.box; octx.strokeStyle = '#2f9bff'; octx.setLineDash([10, 7]); octx.strokeRect(b.x, b.y, b.w, b.h); octx.setLineDash([]); octx.fillStyle = '#fff'; octx.strokeStyle = '#2f9bff';
      if (hd.verts) hd.verts.forEach(v => { octx.beginPath(); octx.arc(v[0], v[1], 9, 0, 6.3); octx.fill(); octx.stroke(); });
      if (hd.resize) { octx.fillRect(hd.resize[0] - 9, hd.resize[1] - 9, 18, 18); octx.strokeRect(hd.resize[0] - 9, hd.resize[1] - 9, 18, 18); } }
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
    if (T === 'text') { B('auto', 'select', { label: 'Auto text', rerender: true, options: [['', 'Manual'], ['valid', 'Valid time'], ['datetime', 'Date + time'], ['date', 'Date'], ['clock', 'Clock']] }); if (!o.auto) B('text', 'area', { label: 'Text' }); B('size', 'range', { min: 16, max: 300 }); B('color', 'color'); B('weight', 'select', { options: OPT.weight }); B('align', 'select', { options: OPT.align }); B('font', 'select', { options: [['display', 'Condensed'], ['sans', 'Standard']] }); B('box', 'check', { label: 'Background box', rerender: true });
      if (o.box) B('boxStyle', 'select', { label: 'Box style', options: [['plain', 'Plain tint'], ['titlebar', 'Title bar'], ['red', 'Red glossy'], ['glass', 'Glass']] });
      p.append(h('div', { className: 'h', text: 'Text style' }), fld('Preset', h('select', { on: { change: e => { E.applyTextPreset(o, e.target.value); commit(); renderPanels(); } } }, E.TEXT_PRESETS.map(x => h('option', { value: x[0], text: x[1] })))));
      if (o.wrapW == null) o.wrapW = 0; B('wrapW', 'range', { min: 0, max: 1800, step: 20, label: 'Wrap width (0=off)' });
      if (o.strokeW == null) o.strokeW = 0; B('strokeW', 'range', { min: 0, max: 24, label: 'Outline' }); if (o.strokeW > 0) B('strokeColor', 'color', { label: 'Outline color' });
      if (!o.color2) o.color2 = o.color; B('grad', 'check', { label: 'Gradient fill', rerender: true }); if (o.grad || o.gloss) B('color2', 'color', { label: 'Bottom color' });
      B('gloss', 'check', { label: 'Gloss highlight', rerender: true });
      p.append(h('div', { className: 'btnrow' }, h('button', { text: 'Layer style… (Photopea-style)', on: { click: () => { if (!o.fx) { o.fx = E.fxDefault(); o.fx.stroke.on = false; o.fx.shadow.on = false; } openFxWindow(o.fx, 'Layer Style – text'); } } }), o.fx ? h('button', { text: 'Remove layer style', on: { click: () => { delete o.fx; commit(); renderPanels(); } } }) : null)); }
    if (T === 'icon') { B('icon', 'select', { options: g.Icons.list.map(i => [i.id, i.label]) }); B('size', 'range', { min: 60, max: 800 }); }
    if (T === 'hl') { B('kind', 'select', { options: [['H', 'H – High'], ['L', 'L – Low']] }); B('value', 'text', { label: 'Pressure (mb)' }); B('size', 'range', { min: 80, max: 500 }); }
    if (T === 'front') { B('kind', 'select', { options: g.Sym.FRONT_KINDS }); B('size', 'range', { min: 12, max: 70 }); B('flip', 'check', { label: 'Flip side' }); }
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
    if (isMap(cur().bg)) p.append(bind(o, 'geo', 'check', { label: 'Pin to map', after: v => { o.geo = !v; E.setGeo(o, cur(), editT(), v); } }), h('div', { className: 'hint', text: 'Pinned objects move and zoom with the map (position only – sizes stay fixed).' }));
    p.append(h('div', { className: 'h', text: 'Arrange' }), h('div', { className: 'btnrow' }, h('button', { text: 'Bring front', on: { click: () => layer('front') } }), h('button', { text: 'Send back', on: { click: () => layer('back') } }), h('button', { text: 'Duplicate', on: { click: dupObj } }), h('button', { text: 'Delete', className: 'dng', on: { click: delObj } })));
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

        p.append(mapAccordion('labels','City + Town Labels',[
          B('broadcastShowCities','check',{label:'Show places'}),
          B('broadcastUppercaseLabels','check',{label:'Uppercase'}),
          B('broadcastPlaceDensity','select',{label:'Place types',options:[['cities','Cities only'],['towns','Cities + towns'],['villages','Cities + towns + villages'],['all','Maximum detail']]}),
          B('broadcastKeepMajorCities','check',{label:'Keep major cities'}),
          B('broadcastMajorCityRank','range',{label:'Major-city rank',min:1,max:16,step:1}),
          B('broadcastLabelFont','select',{label:'Label font',options:[['DIN Pro Bold','DIN Pro Bold'],['DIN Pro Medium','DIN Pro Medium'],['Roboto Bold','Roboto Bold'],['Roboto Medium','Roboto Medium'],['Open Sans Bold','Open Sans Bold'],['Open Sans Semibold','Open Sans Semibold']]}),
          B('broadcastLabelDensity','select',{label:'Label density',options:[['sparse','Sparse'],['normal','Normal'],['dense','Dense'],['maximum','Maximum']]}),
          B('broadcastLabelOpacity','range',{label:'Label opacity',min:0,max:1,step:.05}),
          B('broadcastLabelSpacing','range',{label:'Label spacing',min:.5,max:3,step:.05}),
          B('broadcastLabelColor','color',{label:'Label color'}),
          B('broadcastLabelHaloColor','color',{label:'Label halo'}),
          B('broadcastLabelHaloWidth','range',{label:'Halo width',min:0,max:5,step:.25}),
          B('broadcastCitySize','range',{label:'City size',min:8,max:36,step:1}),
          B('broadcastCityMinZoom','range',{label:'City min zoom',min:0,max:12,step:.5}),
          B('broadcastTownSize','range',{label:'Town size',min:8,max:30,step:1}),
          B('broadcastTownMinZoom','range',{label:'Town min zoom',min:0,max:14,step:.5}),
          B('broadcastVillageSize','range',{label:'Village size',min:7,max:26,step:1}),
          B('broadcastVillageMinZoom','range',{label:'Village min zoom',min:0,max:16,step:.5})
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
    p.append(mapAccordion('titleBanner2', 'Title banner #2 (your banner + logo)', [
      bind(T2, 'show', 'check', { label: 'Show' }),
      bind(T2, 'text', 'text', { label: 'Title' }),
      bind(T2, 'pos', 'select', { label: 'Position', options: [['ul', 'Upper left'], ['ur', 'Upper right'], ['full', 'Full width']] }),
      bind(T2, 'width', 'range', { min: 500, max: 1800, step: 10, label: 'Width (px)' }),
      bind(T2, 'y', 'range', { min: 0, max: 300, label: 'Top offset' }),
      bind(T2, 'logo', 'check', { label: 'Show logo', rerender: true }),
      T2.logo !== false ? bind(T2, 'logoScale', 'range', { min: 0.6, max: 2, step: 0.05, label: 'Logo size' }) : null,
      bind(T2, 'align', 'select', { label: 'Text align', options: [['center', 'Center'], ['left', 'Left'], ['right', 'Right']] }),
      bind(T2, 'size', 'range', { min: 0, max: 160, label: 'Font size (0 = auto)' }),
      bind(T2, 'upper', 'check', { label: 'ALL CAPS' }),
      bind(T2, 'color', 'color', { label: 'Text color' }),
      bind(T2, 'anim', 'select', { label: 'Entrance', options: [['auto', 'Automatic (from its edge)'], ['in-left', 'Slide from left'], ['in-right', 'Slide from right'], ['in-top', 'Slide from top'], ['fade', 'Fade'], ['none', 'None']] }),
      bind(T2, 'delay', 'range', { min: 0, max: 10, step: 0.1, label: 'Delay (s)' }),
      h('div', { className: 'btnrow' }, h('button', { text: 'Text layer style… (stroke, shadow, glow)', on: { click: () => openFxWindow(T2.fx, 'Layer Style – Title banner #2') } }))
    ].filter(Boolean), false));
    p.append(mapAccordion('titleBanner','Title banner #1',[
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
  function bgTx(mode, fn) { return bgDB().then(db => new Promise((res, rej) => { const t = db.transaction('bgs', mode), s = t.objectStore('bgs'), q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); })); }
  function bgLoad() { bgTx('readonly', s => s.getAll()).then(a => { bgList = (a || []).sort((x, y) => x.t - y.t).map(b => Object.assign(b, { asset: (kindOf(b) === 'bg' ? 'bg_' : 'ov_') + b.id })); reattachLib(); if (S.tab === 'bgs') renderPanels(); }).catch(() => { }); }
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
    const tabs = h('div', { className: 'btnrow', style: 'margin-bottom:8px' }, [['bg', 'Backgrounds'], ['banner', 'Banners'], ['graphic', 'Graphics']].map(([k, l]) => h('button', { text: l, className: assetTab === k ? 'pri' : '', on: { click: () => { assetTab = k; renderPanels(); } } })));
    p.append(tabs);
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
    addGroup('City + Town Labels','Labels');
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
    function drawList() { list.innerHTML = ''; ROWS.forEach(([k, l]) => { const cb = h('input', { type: 'checkbox', checked: !!fx[k].on }); cb.onchange = () => { fx[k].on = cb.checked; sel = k; drawList(); drawPane(); changed(); done(); }; list.append(h('div', { style: 'display:flex;align-items:center;gap:8px;padding:7px 8px;cursor:pointer;border-bottom:1px solid #222;' + (sel === k ? 'background:#555' : ''), on: { click: () => { sel = k; drawList(); drawPane(); } } }, cb, h('span', { text: l }))); }); }
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
    const st = { kind: 'storm', title: 'Storm Update', lines: ['Timing: latest track and timing may have slowed the start time for rainfall Fri/Sat AM', 'Change in the track and speed will shift where the heaviest rain occurs', 'Confidence remains high that southeastern MA, Cape & Islands will see the strongest wind gusts', 'Coastal flooding & beach erosion still remain along the coast. Power outages still possible.'] };
    const defs = { storm: ['Storm Update', st.lines], headlines: ['Weather Headlines', ['Bands of rain move in Cape/Islands 11A-12P, Boston 2-3P, Billerica Fri eve', 'Peak wind & rain Friday night into Saturday', 'Widespread 2-4" rainfall in the east, locally higher coast/SE MA', 'Strongest winds Fri night-Sat 40-50+, power outages? 30-40 mph inland']], impacts: ['Storm Impacts', ['Friday-Monday', 'Rain 1.00" west', 'Heavy rain 2-4"+ east', 'Strong winds 40+ mph Cape']] };
    const tIn = h('input', { type: 'text', value: st.title, oninput: e => st.title = e.target.value }), tas = [0, 1, 2, 3, 4].map(i => h('textarea', { rows: 2, value: st.lines[i] || '', oninput: e => { st.lines[i] = e.target.value; } }));
    const kindSel = h('select', { onchange: e => { st.kind = e.target.value; const d = defs[st.kind]; st.title = d[0]; st.lines = d[1].slice(); tIn.value = st.title; tas.forEach((t, i) => { t.value = st.lines[i] || ''; }); } }, E.TEMPLATES.map(t => h('option', { value: t[0], text: t[1] })));
    modal('Scene templates', h('div', {}, fld('Template', kindSel), fld('Title', tIn), h('div', { className: 'hint', text: st.kind === 'impacts' ? 'Impacts: first line is the time frame (lower left); the next lines become red panels. It keeps the current scene background (your map).' : 'One line per panel (up to 5). Text is capitalized automatically. Everything stays editable afterwards.' }), ...tas.map(t => fld('', t, true))),
      [h('button', { text: 'Cancel', on: { click: closeModal } }), h('button', { className: 'pri', text: 'Create scene', on: { click: () => { const bg = st.kind === 'impacts' ? JSON.parse(JSON.stringify(cur().bg)) : null; if (!bg && g.WX_BGDEFAULT) S.show.assets.bgdefault = g.WX_BGDEFAULT; const sc = E.sceneFromTemplate(st.kind, { title: st.title, lines: st.lines, safe: SAFE() }, bg); S.show.scenes.splice(S.si + 1, 0, sc); S.si++; S.oid = null; closeModal(); commit(); refreshAll(); } } })]);
  }
  function mapboxSettings() {
    const tok = h('input', { type: 'password', value: g.MB.token(), placeholder: 'pk.eyJ1…', style: 'width:100%' }), sc = h('select', {}, [['1', 'Native / sharp (recommended)'], ['1.25', 'Slightly larger labels'], ['1.5', 'Large labels'], ['2', 'Extra large labels']].map(o => h('option', { value: o[0], text: o[1], selected: +o[0] === g.MB.scale })));
    const body = h('div', {}, h('div', { className: 'hint', text: 'Create a free account at mapbox.com, copy your default public token (it starts with pk.) and paste it here. It is stored only in this browser. Keep the page tab visible while exporting a Mapbox video.' }), fld('Public token', tok), fld('Label size', sc), h('div', { className: 'hint', id: 'mbstat', text: g.MB.status === 'error' ? 'Status: ' + g.MB.err : 'Status: ' + g.MB.status }));
    modal('Mapbox settings', body, [h('button', { text: 'Close', on: { click: closeModal } }), h('button', { className: 'pri', text: 'Save & load map', on: { click: () => { const t = tok.value.trim(); if (t && !/^pk\./.test(t)) { toast('Use a public token that starts with pk.'); return; } g.MB.setToken(t); if (+sc.value !== g.MB.scale) g.MB.setScale(+sc.value); closeModal();
      if (t && S.show.scenes.some(x => x.bg.type === 'map') && confirm('Switch your existing basic-map scenes to Mapbox?')) S.show.scenes.forEach(x => { if (x.bg.type === 'map') { x.bg.type = 'mapbox'; x.bg.view = null; x.bg.view2 = null; } });
      g.MB.init().then(() => toast('Mapbox ready')).catch(e => toast(e.message)).then(() => { commit(); refreshAll(); }); } } })]);
  }
  $('#b7').onclick = sevenDay; $('#bTpl').onclick = templatesDialog;
  async function exportDialog() {
    const ac = new AbortController(), bar = h('i'), msg = h('div', { className: 'hint', text: '' }), res = h('div');
    const size = h('select', {}, [['1920x1080', '1920×1080 (Full HD)'], ['1280x720', '1280×720 (smaller file)']].map(o => h('option', { value: o[0], text: o[1] }))), br = h('select', {}, [['10', 'Standard quality (10 Mbps)'], ['16', 'High quality (16 Mbps)'], ['6', 'Small file (6 Mbps)']].map(o => h('option', { value: o[0], text: o[1] })));
    const tot = E.total(S.show), go = h('button', { className: 'pri', text: 'Start export' });
    const info = h('div', { className: 'hint', text: `${tot.toFixed(1)} seconds · ${g.Exporter.supportsWebCodecs() ? 'H.264 MP4 export is available in this browser.' : 'This browser lacks WebCodecs; a real-time WebM will be made instead (use Chrome or Edge for MP4).'}` });
    go.onclick = async () => {
      go.disabled = true; const [w, hh] = size.value.split('x').map(Number); stopPlay(); msg.textContent = 'Rendering…'; res.innerHTML = '';
      try {
        const r = await g.Exporter.run(S.show, { width: w, height: hh, bitrate: +br.value * 1e6, fps: 30, signal: ac.signal, onProgress: p => { bar.style.width = (p * 100).toFixed(0) + '%'; msg.textContent = `Rendering… ${(p * 100).toFixed(0)}%`; } });
        const url = URL.createObjectURL(r.blob), name = (S.show.name || 'weather').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.' + r.ext;
        msg.textContent = `Done – ${(r.blob.size / 1048576).toFixed(1)} MB. ${r.note}`; saveFile(r.blob, name); msg.textContent += ' Saved to your Downloads folder.'; res.append(h('video', { src: url, controls: true, style: 'width:100%;max-width:640px;border-radius:8px;margin-top:8px' }), h('div', { className: 'mb' }, h('a', { href: url, download: name }, h('button', { text: 'Download again' }))));
      } catch (e) { msg.textContent = 'Export failed: ' + (e && e.message || e); } go.disabled = false;
    };
    modal('Export video', h('div', {}, fld('Size', size), fld('Quality', br), info, h('div', { className: 'prog' }, bar), msg, res), [h('button', { text: 'Close', on: { click: () => { ac.abort(); closeModal(); } } }), go]);
  }
  /* ---------- still image export (PNG/JPG) for X / Facebook ---------- */
  function saveFile(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); return url; }
  async function imageDialog() {
    const SZ = [['1920x1080', '16:9 – 1920×1080 (X and Facebook, best quality)'], ['1200x675', '16:9 – 1200×675 (smaller file, fine for X)'], ['1080x1080', 'Square 1:1 – 1080×1080 (Facebook feed)'], ['1080x1350', 'Portrait 4:5 – 1080×1350 (tall Facebook post)']];
    const size = h('select', {}, SZ.map(o => h('option', { value: o[0], text: o[1] }))), fmt = h('select', {}, [['png', 'PNG (sharpest text)'], ['jpeg', 'JPG (smaller file)']].map(o => h('option', { value: o[0], text: o[1] }))), what = h('select', {}, [['one', 'Current scene only'], ['all', 'All scenes (one PNG each)']].map(o => h('option', { value: o[0], text: o[1] })));
    const pos = h('input', { type: 'range', min: 0, max: 100, value: 50 }), msg = h('div', { className: 'hint', text: 'Saves the finished look of the scene (everything animated in).' }), res = h('div'), go = h('button', { className: 'pri', text: 'Create image' });
    const hint = h('div', { className: 'hint', text: 'Square and portrait crop the 16:9 scene. The slider picks which part is kept (50 = center).' });
    go.onclick = async () => {
      go.disabled = true; res.innerHTML = ''; stopPlay();
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
      } catch (e) { msg.textContent = 'Image export failed: ' + (e && e.message || e); } go.disabled = false;
    };
    modal('Export image', h('div', {}, fld('Scenes', what), fld('Size', size), fld('Format', fmt), fld('Crop position', pos), hint, msg, res), [h('button', { text: 'Close', on: { click: closeModal } }), go]);
  }
  $('#bImg').onclick = imageDialog;
  $('#bExport').onclick = exportDialog;

  /* ---------- top bar ---------- */
  $('#showName').oninput = e => { S.show.name = e.target.value; }; $('#showName').onchange = commit;
  $('#bNew').onclick = () => { if (confirm('Start a new show? Unsaved changes will be lost.')) { loadShow(newShowWithDefaultMap()); } };
  $('#bSave').onclick = () => { const b = new Blob([JSON.stringify(S.show)], { type: 'application/json' }), a = h('a', { href: URL.createObjectURL(b), download: (S.show.name || 'show').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + '.wxshow.json' }); document.body.append(a); a.click(); a.remove(); toast('Show saved to your downloads'); };
  $('#bOpen').onclick = () => $('#fileOpen').click();
  $('#fileOpen').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { loadShow(JSON.parse(r.result)); toast('Opened ' + f.name); } catch (err) { toast('That file is not a WX Studio show'); } }; r.readAsText(f); e.target.value = ''; };
  $('#bUndo').onclick = undo; $('#bRedo').onclick = redo;
  $('#bAddScene').onclick = () => newScene();

  /* ---------- boot ---------- */
  function boot() {
    bgLoad(); buildTools(); let sh = null; try { const raw = localStorage.getItem(KEY); if (raw) { sh = JSON.parse(raw); if (!sh.scenes || !sh.scenes.length) sh = null; } } catch (e) { sh = null; }
    if(sh){migrateMB(sh);migrateWDBroadcast(sh);}
    S.show=sh||newShowWithDefaultMap();
    const loadedDefault=applySavedDefaultOnStartup(S.show);
    S.show.assets=S.show.assets||{};ensureBG(S.show);S.hist=[];S.hp=-1;
    commit();refreshAll();
    if(S.show.scenes[0]?.bg?.type==='mapbox')setTool('pan');
    if(sh){
      toast(loadedDefault?'Last show restored with saved default Satellite map':'Last show restored; Satellite selected');
      E.preload(S.show).then(()=>thumbSoon(true));
    }
    g.MB.onUpdate = () => thumbSoon(true); if (!g.MB.hasToken() && S.show.scenes.some(x => x.bg.type === 'mapbox')) setTimeout(mapboxSettings, 600); if (S.show.scenes.some(x => x.bg.type === 'mapbox') && g.MB.hasToken()) g.MB.init().then(() => thumbSoon(true)).catch(() => { }); g.WDMap.loadPlaces().then(() => thumbSoon(true)); g.WDMap.load().then(() => { thumbSoon(true); if (g.WDMap.status === 'error') toast('Map outlines need internet access – backgrounds and tools still work'); });
    if (document.fonts) { ['700 40px "Roboto Condensed"', '800 40px "Barlow Condensed"', '700 40px "Barlow Condensed"', '600 30px "Barlow Condensed"', '600 20px Barlow'].forEach(f => document.fonts.load(f).catch(() => { })); document.fonts.ready.then(() => thumbSoon(true)); }
    requestAnimationFrame(loop);
  }
  g.WX = { S, E, setTool, addObject, newScene, commit, undo, redo, finishDraft, setTab, loadShow, sevenDay, exportDialog };
  boot();
})(window);
