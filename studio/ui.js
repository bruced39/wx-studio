/* WX Studio – editor UI */
(function (g) {
  'use strict';
  const E = g.Engine, W = E.W, H = E.H, $ = s => document.querySelector(s);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const stage = $('#stage'), sctx = stage.getContext('2d'), ov = $('#overlay'), octx = ov.getContext('2d');
  const S = { show: null, si: 0, oid: null, tool: 'select', opt: { front: 'cold', icon: 'partly-cloudy', hl: 'H', storm: 'H', shape: 'round' }, mode: 'edit', T: 0, play: null, draft: null, editEnd: false, tab: 'scene', hist: [], hp: -1, drag: null, cursor: [0, 0], mapAcc: { sceneSettings: false, background: false, basic: true, base: false, land: false, labels: false, boundaries: false, roads: false, cameraMove: false, titleBanner: false, showBranding: false } };
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
  function autosave() { try { localStorage.setItem(KEY, JSON.stringify(S.show)); } catch (e) { /* quota or blocked */ } }
  function migrateMB(sh) { if (!sh.mbMigrated) { sh.mbMigrated = 1; sh.scenes.forEach(x => { if (x.bg && x.bg.type === 'map') { x.bg.type = 'mapbox'; x.bg.view = null; x.bg.view2 = null; x.bg.mbStyle = x.bg.mbStyle || 'broadcast'; x.bg.proj = x.bg.proj || 'mercator'; } }); } }
  function migrateWDBroadcast(sh){if(!sh.wdBroadcastMapV1){sh.wdBroadcastMapV1=1;(sh.scenes||[]).forEach(x=>{if(x.bg&&x.bg.type==='mapbox'){if(!x.bg.mbStyle||x.bg.mbStyle==='streets-v12')x.bg.mbStyle='broadcast';g.MB.ensureConfig(x.bg);}});}}
  function builtInDefaultMapBg(){
    const bg={type:'mapbox',mbStyle:'broadcast',proj:'mercator',theme:'dark',region:'eastma',view:null,view2:null,grad:'sky',color:'#101820',asset:null,dim:0,kenburns:false};
    g.MB.ensureConfig(bg); return bg;
  }
  function getSavedDefaultMapBg(){
    try{
      const raw=localStorage.getItem(MAP_DEFAULT_KEY); if(!raw)return null;
      const bg=JSON.parse(raw); if(!bg||bg.type!=='mapbox')return null;
      g.MB.ensureConfig(bg); bg.view2=null; return bg;
    }catch(e){return null;}
  }
  function defaultMapBg(){return getSavedDefaultMapBg()||builtInDefaultMapBg();}
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
  function loadShow(sh) { if (!sh || !Array.isArray(sh.scenes) || !sh.scenes.length) throw new Error('not a show file'); sh.assets = sh.assets || {}; sh.accent = sh.accent || '#2f9bff'; migrateMB(sh); migrateWDBroadcast(sh); S.show = sh; S.si = 0; S.oid = null; S.hist = []; S.hp = -1; commit(); refreshAll(); E.preload(sh).then(thumbSoon); }

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
  function newScene(after) { const prev = cur(), sc = E.newScene({ name: 'Scene ' + (S.show.scenes.length + 1), bg: JSON.parse(JSON.stringify(prev.bg)), title: { show: true, text: '', sub: '' } }); sc.bg.view = prev.bg.view ? JSON.parse(JSON.stringify(prev.bg.view)) : null; sc.bg.view2 = null; S.show.scenes.splice(S.si + 1, 0, sc); S.si++; S.oid = null; commit(); refreshAll(); }

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
  const TOOLS = [['select', '⌖ Select'], ['pen', '✎ Pen'], ['arrow', '➚ Arrow'], ['line', '〰 Isobar'], ['front', '▲ Front'], ['hl-H', 'H'], ['hl-L', 'L'], ['icon', '☀ Icon'], ['text', 'T Text'], ['rect', '▭ Box'], ['ellipse', '◯ Oval'], ['pin', '● Pin'], ['storm', '🌀 Storm'], ['barb', '⇶ Wind barb']];
  function buildTools() {
    const t = $('#tools'); t.innerHTML = '';
    TOOLS.forEach(([id, label]) => t.append(h('button', { 'data-tool': id, text: label, title: id, on: { click: () => setTool(id) } })));
    t.append(h('span', { className: 'sep' }));
    const fs = h('select', { id: 'frontKind', title: 'Front type', on: { change: e => { S.opt.front = e.target.value; setTool('front'); } } }, g.Sym.FRONT_KINDS.map(k => h('option', { value: k[0], text: k[1] })));
    t.append(fs, h('button', { text: 'Delete', className: 'dng', on: { click: delObj } }), h('button', { text: 'Duplicate', on: { click: dupObj } }));
    setTool('select');
  }
  function setTool(id) { finishDraft(); S.tool = id; document.querySelectorAll('#tools button[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === id)); ov.style.cursor = id === 'select' ? 'default' : 'crosshair'; }
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
    if (S.tool === 'select') {
      const so = selObj() ? E.toScreen(selObj(), xf) : null;
      if (so) { const hd = handles(so);
        if (hd.verts) { const i = hd.verts.findIndex(v => Math.hypot(v[0] - p[0], v[1] - p[1]) < 16); if (i >= 0) { S.drag = { k: 'vert', i }; return; } }
        if (hd.resize && Math.hypot(hd.resize[0] - p[0], hd.resize[1] - p[1]) < 18) { S.drag = { k: 'resize', last: p, c: [hd.box.x + hd.box.w / 2, hd.box.y + hd.box.h / 2] }; return; } }
      const hit = E.hit(sc, editT(), p[0], p[1]);
      if (hit) { S.oid = hit.id; S.drag = { k: 'move', last: p, moved: false }; if (S.tab !== 'object') setTab('object'); else renderPanels(); }
      else { S.oid = null; renderPanels(); if (xf.map) { if(xf.mb)g.MB.setInteractive(true); S.drag = { k: 'pan', last: p }; } }
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
    else if (d.k === 'move' && o) { E.move(o, p[0] - d.last[0], p[1] - d.last[1], xf); d.last = p; d.moved = true; }
    else if (d.k === 'vert' && o) { const k = (o.geo && xf.map) ? xf.k : 1, q = o.geo && xf.map ? xf.inv(p[0], p[1]) : p; o.pts[d.i] = [q[0], q[1]]; }
    else if (d.k === 'resize' && o) {
      const so = E.toScreen(o, xf), k = (o.geo && xf.map) ? (xf.kOf ? xf.kOf(o) : xf.k) : 1;
      if (o.type === 'shape' || o.type === 'image') { o.w += (p[0] - d.last[0]) / k; o.h += (p[1] - d.last[1]) / k; if (o.type === 'image' && e.shiftKey === false) { /* free resize */ } }
      else if (o.type === 'text') o.size = clamp(o.size + (p[1] - d.last[1]) * 0.6, 12, 400);
      else { const r0 = Math.hypot(d.last[0] - d.c[0], d.last[1] - d.c[1]) || 1, r1 = Math.hypot(p[0] - d.c[0], p[1] - d.c[1]); o.size = clamp((o.size || 100) * r1 / r0, 20, 900); }
      d.last = p;
    }
    else if (d.k === 'pan' && xf.mb) { const v = mapView(sc), q = xf.inv(W / 2 - (p[0] - d.last[0]), H / 2 - (p[1] - d.last[1])); if (q && isFinite(q[0]) && isFinite(q[1])) v.c = [q[0], Math.max(-85, Math.min(85, q[1]))]; d.last = p; }
    else if (d.k === 'pan') { const v = mapView(sc), kk = W / v.w; v.cx -= (p[0] - d.last[0]) / kk; v.cy -= (p[1] - d.last[1]) / kk; d.last = p; }
    else if (d.k === 'pen' && S.draft) { const l = S.draft.pts[S.draft.pts.length - 1]; if (Math.hypot(l[0] - p[0], l[1] - p[1]) > 3) S.draft.pts.push(p); }
    else if (d.k === 'shape' && S.draft) { S.draft.x = Math.min(d.o[0], p[0]); S.draft.y = Math.min(d.o[1], p[1]); S.draft.w = Math.abs(p[0] - d.o[0]); S.draft.h = Math.abs(p[1] - d.o[1]); }
  });
  ov.addEventListener('pointerup', () => { const d = S.drag; S.drag = null; ov.style.cursor = ''; if (!d) return; if(d.k==='orbit'||(d.k==='pan'&&cur().bg.type==='mapbox'))g.MB.setInteractive(false); if (d.k === 'pen' || d.k === 'shape') { finishDraft(); if (S.tool === 'rect' || S.tool === 'ellipse') setTool('select'); return; } if (d.k !== 'move' || d.moved) commit(); });
  ov.addEventListener('pointercancel', () => { const d=S.drag; S.drag = null; ov.style.cursor = ''; if(d&&(d.k==='orbit'||d.k==='pan'))g.MB.setInteractive(false); });
  ov.addEventListener('contextmenu', e => { if (cur().bg.type === 'mapbox') e.preventDefault(); });
  ov.addEventListener('dblclick', () => { if (S.draft && S.draft.pts) { S.draft.pts.pop(); finishDraft(); } });
  ov.addEventListener('wheel', e => { const sc = cur(); if (!isMap(sc.bg)) return; e.preventDefault(); backToEdit(); const p = pt(e);
    if (sc.bg.type === 'mapbox') { g.MB.setInteractive(true); const v = mapView(sc), ll = E.xf(sc, editT()).inv(p[0], p[1]); v.z = clamp(v.z - e.deltaY * 0.0025, 0, 20); const l2 = E.xf(sc, editT()).inv(p[0], p[1]); if (isFinite(ll[0]) && isFinite(l2[0])) v.c = [v.c[0] + ll[0] - l2[0], Math.max(-85, Math.min(85, v.c[1] + ll[1] - l2[1]))]; clearTimeout(ov._wt); ov._wt = setTimeout(()=>{g.MB.setInteractive(false);commit();},180); return; }
    const v = mapView(sc), k = W / v.w, P = [v.cx + (p[0] - W / 2) / k, v.cy + (p[1] - H / 2) / k]; v.w = clamp(v.w * Math.exp(e.deltaY * 0.0012), 18, 1700); const k2 = W / v.w; v.cx = P[0] - (p[0] - W / 2) / k2; v.cy = P[1] - (p[1] - H / 2) / k2; clearTimeout(ov._wt); ov._wt = setTimeout(commit, 400); }, { passive: false });
  ['dragover', 'dragenter'].forEach(ev => stage.parentElement.addEventListener(ev, e => { e.preventDefault(); }));
  stage.parentElement.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files], e.shiftKey ? 'bg' : 'obj'); });
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

  /* ---------- render loop ---------- */
  let last = 0;
  function loop(ts) {
    requestAnimationFrame(loop); const liveMapScene=cur&&cur().bg&&cur().bg.type==='mapbox'; const frameMs=(liveMapScene&&(g.MB.interacting||S.mode!=='edit'))?15:30; if (ts - last < frameMs) return; last = ts;
    try {
      if (S.mode === 'edit') { E.renderScene(sctx, S.show, cur(), clock(), { editing: true, camT: editT(), liveMap: true }); drawOverlay(); }
      else {
        if (S.mode === 'play' && S.play) { S.T = S.play.a + (clock() - S.play.t0); if (S.T >= S.play.b) { S.T = S.play.b - 0.001; E.renderShow(sctx, S.show, S.T, { liveMap: true }); stopPlay(); return; } }
        E.renderShow(sctx, S.show, S.T, { liveMap: true }); octx.clearRect(0, 0, W, H); updateTransport();
      }
    } catch (err) { console.error(err); }
  }
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
    if (sc.bg.type === 'mapbox' && sc.bg.showZoomBadge !== false) {
      const zv=E.viewAt(sc,editT()), txt='ZOOM '+Number(zv.z||0).toFixed(1), x=W-178, y=22, w=154, hh=44;
      octx.save(); E.rrect(octx,x,y,w,hh,8); octx.fillStyle='rgba(8,20,38,.88)'; octx.fill();
      octx.strokeStyle='rgba(100,180,255,.75)'; octx.lineWidth=2; octx.stroke();
      octx.fillStyle='#ffffff'; octx.font='700 23px Barlow, sans-serif'; octx.textAlign='center'; octx.textBaseline='middle'; octx.fillText(txt,x+w/2,y+hh/2+1); octx.restore();
    }
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
    if (T === 'text') { B('text', 'area', { label: 'Text' }); B('size', 'range', { min: 16, max: 300 }); B('color', 'color'); B('weight', 'select', { options: OPT.weight }); B('align', 'select', { options: OPT.align }); B('font', 'select', { options: [['display', 'Condensed'], ['sans', 'Standard']] }); B('box', 'check', { label: 'Background box' }); }
    if (T === 'icon') { B('icon', 'select', { options: g.Icons.list.map(i => [i.id, i.label]) }); B('size', 'range', { min: 60, max: 800 }); }
    if (T === 'hl') { B('kind', 'select', { options: [['H', 'H – High'], ['L', 'L – Low']] }); B('value', 'text', { label: 'Pressure (mb)' }); B('size', 'range', { min: 80, max: 500 }); }
    if (T === 'front') { B('kind', 'select', { options: g.Sym.FRONT_KINDS }); B('size', 'range', { min: 12, max: 70 }); B('flip', 'check', { label: 'Flip side' }); }
    if (T === 'arrow') { B('color', 'color'); B('width', 'range', { min: 3, max: 50 }); B('style', 'select', { options: OPT.style }); B('head', 'check', { label: 'Arrow head' }); }
    if (T === 'line') { B('color', 'color'); B('width', 'range', { min: 2, max: 40 }); B('style', 'select', { options: [['solid', 'Solid'], ['dash', 'Dashed'], ['flow', 'Animated flow']] }); B('closed', 'check', { label: 'Closed loop' }); B('label', 'text', { label: 'Label (e.g. 1008)' }); }
    if (T === 'pen') { B('color', 'color'); B('width', 'range', { min: 2, max: 50 }); }
    if (T === 'shape') { B('shape', 'select', { options: [['rect', 'Rectangle'], ['round', 'Rounded'], ['ellipse', 'Oval']] }); B('fill', 'color'); B('opacity', 'range', { min: 0, max: 1, step: 0.05 }); B('stroke', 'color'); B('lw', 'range', { min: 0, max: 24, label: 'Outline' }); B('radius', 'range', { min: 0, max: 120 }); }
    if (T === 'image') { B('opacity', 'range', { min: 0, max: 1, step: 0.05 }); p.append(h('div', { className: 'btnrow' }, h('button', { text: 'Fit to screen', on: { click: () => { const im = new Image(); im.onload = () => { const k = Math.min(W / im.width, H / im.height); Object.assign(o, { x: (W - im.width * k) / 2, y: (H - im.height * k) / 2, w: im.width * k, h: im.height * k, geo: false }); commit(); }; im.src = S.show.assets[o.asset]; } } }), h('button', { text: 'Use as background', on: { click: () => { cur().bg.type = 'image'; cur().bg.asset = o.asset; delObj(); } } }))); }
    if (T === 'barb') { B('kt', 'range', { min: 0, max: 150, step: 5, label: 'Speed (kt)' }); B('dir', 'range', { min: 0, max: 359, label: 'From (deg)' }); B('size', 'range', { min: 40, max: 300 }); B('color', 'color'); }
    if (T === 'pin') { B('label', 'text'); B('value', 'text'); B('color', 'color'); }
    if (T === 'storm') { B('kind', 'select', { options: [['H', 'Hurricane'], ['TS', 'Tropical storm'], ['TD', 'Depression']] }); B('size', 'range', { min: 60, max: 500 }); B('label', 'text'); }
    if (T === 'pop') { B('value', 'text'); B('size', 'range', { min: 20, max: 120 }); }
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
      bgNodes.push(
        fld('Image', h('select', { on: { change: e => { b.asset = e.target.value; commit(); } } },
          h('option', { value: '', text: '— choose —' }),
          Object.keys(S.show.assets).map((id, i) => h('option', { value: id, text: 'Image ' + (i + 1), selected: id === b.asset })))),
        h('div', { className: 'btnrow' }, h('button', { text: 'Upload background…', on: { click: () => pickImages('bg') } })),
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
        bind(mv, 'z', 'range', { min: 0, max: 18, step: 0.05, label: 'Zoom' }),
        bind(b, 'showZoomBadge', 'check', { label: 'Show zoom level' }),
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
          B('broadcastWaterColor','color',{label:'Water color'}),
          B('showWaterDepth','check',{label:'Show water depth',rerender:true})
        ];
        if(b.showWaterDepth){
          landWater.push(B('waterDepthColor','color',{label:'Depth color'}));
          landWater.push(zoomRangeRow(b,'Water depth','waterDepthMinZoom','waterDepthMaxZoom',{min:0,max:24,step:.5}));
        }

        const parkNodes=[B('showNationalParks','check',{label:'National parks',rerender:true})];
        if(b.showNationalParks){
          parkNodes.push(B('nationalParkColor','color',{label:'Color'}));
          parkNodes.push(zoomRangeRow(b,'National parks','nationalParkMinZoom','nationalParkMaxZoom',{min:0,max:24,step:.5}));
        }
        landWater.push(mapAccordion('nationalParks','National Parks',parkNodes,false));

        const buildingNodes=[
          B('showBuildingFootprints','check',{label:'Building footprints',rerender:true})
        ];
        if(b.showBuildingFootprints)buildingNodes.push(B('buildingFootprintColor','color',{label:'Footprint color'}));
        buildingNodes.push(B('show3DBuildings','check',{label:'3D buildings',rerender:true}));
        if(b.show3DBuildings){
          buildingNodes.push(B('buildingFootprintColor','color',{label:'3D color'}));
          buildingNodes.push(B('building3DHeight','num',{label:'3D height',min:0,max:3,step:.1}));
        }
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

        const boundaries=[
          B('broadcastShowCoastline','check',{label:'Coastline'}),
          B('broadcastCoastlineColor','color',{label:'Coastline color'}),
          B('broadcastCoastlineWidth','range',{label:'Coastline width',min:.5,max:5,step:.25}),
          B('broadcastShowCountryBorders','check',{label:'Country borders'}),
          B('broadcastCountryColor','color',{label:'Country color'}),
          B('broadcastCountryWidth','range',{label:'Country width',min:.5,max:5,step:.25}),
          B('broadcastShowStateBorders','check',{label:'State borders'}),
          B('broadcastStateColor','color',{label:'State color'}),
          B('broadcastStateWidth','range',{label:'State width',min:.5,max:5,step:.25}),
          B('broadcastShowCountyBorders','check',{label:'County borders',rerender:true})
        ];
        if(b.broadcastShowCountyBorders){
          boundaries.push(B('broadcastCountyColor','color',{label:'County color'}));
          boundaries.push(B('broadcastCountyWidth','range',{label:'County width',min:.5,max:4,step:.25}));
        }
        p.append(mapAccordion('boundaries','Boundaries',boundaries,false));

        const roadStyle=(key,title,subtitle,prefix)=>{
          const nodes=[
            h('div',{className:'hint',text:subtitle}),
            B(prefix+'Show','check',{label:'Enabled',rerender:true})
          ];
          if(b[prefix+'Show']!==false){
            nodes.push(B(prefix+'Color','color',{label:'Color'}));
            nodes.push(B(prefix+'Width','num',{label:'Width (px)',min:.05,max:8,step:.1}));
            nodes.push(B(prefix+'Opacity','num',{label:'Opacity',min:0,max:1,step:.05}));
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
          if(b[prefix]){
            nodes.push(B(prefix+'Color','color',{label:'Color'}));
            nodes.push(B(prefix+'LineType','select',{label:'Line type',options:[['solid','Solid'],['dashed','Dashed'],['dotted','Dotted']]}));
            nodes.push(B(prefix+'Width','num',{label:'Width (px)',min:.1,max:6,step:.1}));
            nodes.push(B(prefix+'Opacity','num',{label:'Opacity',min:0,max:1,step:.05}));
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
          B('overlayLatLonMode','select',{label:'Lat / lon grid',rerender:true,options:[['off','Off'],['.5','0.5°'],['1','1°'],['2','2°'],['5','5°'],['10','10°'],['15','15°'],['30','30°']]})
        ];
        if(b.overlayLatLonMode!=='off'){
          gridNodes.push(B('overlayLatLonColor','color',{label:'Color'}));
          gridNodes.push(B('overlayLatLonWidth','num',{label:'Line width',min:.1,max:4,step:.05}));
          gridNodes.push(B('overlayLatLonOpacity','num',{label:'Opacity',min:0,max:1,step:.05}));
          gridNodes.push(B('overlayLatLonAutoSpacing','check',{label:'Auto spacing (zoom)'}));
        }
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

    p.append(mapAccordion('titleBanner','Title Banner',[
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
    p.append(h('div', { className: 'hint', text: 'Click an icon to place it (or swap the selected icon). All icons are animated and export to video.' }));
    const cats = {}; g.Icons.list.forEach(i => (cats[i.cat] = cats[i.cat] || []).push(i));
    Object.keys(cats).forEach(c => { p.append(h('div', { className: 'h', text: c })); const gr = h('div', { className: 'igrid' }); cats[c].forEach(i => { const cv = h('canvas', { width: 120, height: 120 }); cv.dataset.icon = i.id; gr.append(h('div', { className: 'ic' + (S.opt.icon === i.id ? ' on' : ''), title: i.label, on: { click: () => { S.opt.icon = i.id; const o = selObj(); if (o && o.type === 'icon') { o.icon = i.id; commit(); } else setTool('icon'); renderPanels(); } } }, cv, h('div', { text: i.label }))); }); p.append(gr); });
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
  function renderPanels() { const p = $('#panels'), sy = p.scrollTop; p.innerHTML = ''; ({ scene: scenePanel, object: objectPanel, library: libraryPanel, media: mediaPanel })[S.tab](p); p.scrollTop = sy; }
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

  /* ---------- modals ---------- */
  function modal(title, body, buttons) { const m = $('#modal'); m.innerHTML = ''; m.append(h('h3', { text: title }), body, h('div', { className: 'mb' }, buttons || [])); $('#modalBg').style.display = 'flex'; }
  function closeModal() { $('#modalBg').style.display = 'none'; $('#modal').innerHTML = ''; }
  function sevenDay() {
    const days = E.sample7(), meta = { title: '7-Day Forecast', sub: 'Billerica, MA', layout: 'bw' }, tb7 = h('table', { className: 't7' }, h('tr', {}, ['Day', 'Date', 'Icon', 'Phrase', 'High', 'Low', 'PoP %', 'Tag', 'Top tag'].map(x => h('th', { text: x }))));
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
      tb7.append(h('tr', {}, [dayCell, dateCell, sel, ph, inp('hi', 56, 'number'), inp('lo', 56, 'number'), inp('pop', 56, 'number'), inp('tag', 90), inp('tag2', 80)].map((x, ci) => h('td', { className: (i >= 5 && [3, 5, 7, 8].includes(ci)) ? 'dis' : '' }, x)))); });
    startSel.value = AB.indexOf(days[0].day); applyStart();
    const lay = h('select', { onchange: e => { meta.layout = e.target.value; } }, [['bw', 'Billerica Weather template (your background)'], ['classic', 'Classic 7 cards (generic background)']].map(o => h('option', { value: o[0], text: o[1] })));
    const body = h('div', {}, fld('Layout', lay), h('div', { className: 'row' }, h('label', { text: 'Title' }), h('input', { type: 'text', value: meta.title, oninput: e => meta.title = e.target.value })), h('div', { className: 'row' }, h('label', { text: 'Location' }), h('input', { type: 'text', value: meta.sub, oninput: e => meta.sub = e.target.value })), tb7, h('div', { className: 'hint', text: 'Pick the starting weekday in Day 1 and the rest follow in order. In the Billerica Weather layout days 6 and 7 show only icon, high and precip (greyed fields are unused); Sat/Sun get orange headers; lows sit under the gaps between days 1–5. Sample values – replace them with your forecast. Icons animate and each card slides in one after another. Everything stays editable afterwards.' }));
    modal('7-Day Forecast Builder', body, [h('button', { text: 'Cancel', on: { click: closeModal } }), h('button', { className: 'pri', text: 'Create scene', on: { click: () => { const dd = days.map(d => Object.assign({}, d, { hi: Math.round(d.hi), lo: Math.round(d.lo) })); let sc; if (meta.layout === 'bw' && g.WX_BG7DAY) { S.show.assets.bg7day = g.WX_BG7DAY; sc = E.sceneFromBW(dd, 'bg7day'); } else sc = E.sceneFrom7Day(dd, meta.title, meta.sub); S.show.scenes.splice(S.si + 1, 0, sc); S.si++; S.oid = null; closeModal(); commit(); refreshAll(); } } })]);
  }
  function mapboxSettings() {
    const tok = h('input', { type: 'password', value: g.MB.token(), placeholder: 'pk.eyJ1…', style: 'width:100%' }), sc = h('select', {}, [['1', 'Native / sharp (recommended)'], ['1.25', 'Slightly larger labels'], ['1.5', 'Large labels'], ['2', 'Extra large labels']].map(o => h('option', { value: o[0], text: o[1], selected: +o[0] === g.MB.scale })));
    const body = h('div', {}, h('div', { className: 'hint', text: 'Create a free account at mapbox.com, copy your default public token (it starts with pk.) and paste it here. It is stored only in this browser. Keep the page tab visible while exporting a Mapbox video.' }), fld('Public token', tok), fld('Label size', sc), h('div', { className: 'hint', id: 'mbstat', text: g.MB.status === 'error' ? 'Status: ' + g.MB.err : 'Status: ' + g.MB.status }));
    modal('Mapbox settings', body, [h('button', { text: 'Close', on: { click: closeModal } }), h('button', { className: 'pri', text: 'Save & load map', on: { click: () => { const t = tok.value.trim(); if (t && !/^pk\./.test(t)) { toast('Use a public token that starts with pk.'); return; } g.MB.setToken(t); if (+sc.value !== g.MB.scale) g.MB.setScale(+sc.value); closeModal();
      if (t && S.show.scenes.some(x => x.bg.type === 'map') && confirm('Switch your existing basic-map scenes to Mapbox?')) S.show.scenes.forEach(x => { if (x.bg.type === 'map') { x.bg.type = 'mapbox'; x.bg.view = null; x.bg.view2 = null; } });
      g.MB.init().then(() => toast('Mapbox ready')).catch(e => toast(e.message)).then(() => { commit(); refreshAll(); }); } } })]);
  }
  $('#b7').onclick = sevenDay;
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
        msg.textContent = `Done – ${(r.blob.size / 1048576).toFixed(1)} MB. ${r.note}`; res.append(h('video', { src: url, controls: true, style: 'width:100%;max-width:640px;border-radius:8px;margin-top:8px' }), h('div', { className: 'mb' }, h('a', { href: url, download: name }, h('button', { className: 'pri', text: 'Download ' + name }))));
      } catch (e) { msg.textContent = 'Export failed: ' + (e && e.message || e); } go.disabled = false;
    };
    modal('Export video', h('div', {}, fld('Size', size), fld('Quality', br), info, h('div', { className: 'prog' }, bar), msg, res), [h('button', { text: 'Close', on: { click: () => { ac.abort(); closeModal(); } } }), go]);
  }
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
    buildTools(); let sh = null; try { const raw = localStorage.getItem(KEY); if (raw) { sh = JSON.parse(raw); if (!sh.scenes || !sh.scenes.length) sh = null; } } catch (e) { sh = null; }
    if (sh) { migrateMB(sh); migrateWDBroadcast(sh); } S.show = sh || newShowWithDefaultMap(); S.show.assets = S.show.assets || {}; S.hist = []; S.hp = -1; commit(); refreshAll(); if (sh) { toast('Restored your last session'); E.preload(S.show).then(() => thumbSoon(true)); }
    g.MB.onUpdate = () => thumbSoon(true); if (!g.MB.hasToken() && S.show.scenes.some(x => x.bg.type === 'mapbox')) setTimeout(mapboxSettings, 600); if (S.show.scenes.some(x => x.bg.type === 'mapbox') && g.MB.hasToken()) g.MB.init().then(() => thumbSoon(true)).catch(() => { }); g.WDMap.loadPlaces().then(() => thumbSoon(true)); g.WDMap.load().then(() => { thumbSoon(true); if (g.WDMap.status === 'error') toast('Map outlines need internet access – backgrounds and tools still work'); });
    if (document.fonts) { ['800 40px "Barlow Condensed"', '700 40px "Barlow Condensed"', '600 30px "Barlow Condensed"', '600 20px Barlow'].forEach(f => document.fonts.load(f).catch(() => { })); document.fonts.ready.then(() => thumbSoon(true)); }
    requestAnimationFrame(loop);
  }
  g.WX = { S, E, setTool, addObject, newScene, commit, undo, redo, finishDraft, setTab, loadShow, sevenDay, exportDialog };
  boot();
})(window);
