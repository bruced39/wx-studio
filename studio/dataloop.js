/* WX Studio – weather data loop layer + playback bar (radar / satellite / RTMA / model loops).
 *
 * This file is self-contained on purpose (the data side is shared with ChatGPT):
 *   - WXData.registerSource(def)  <- data providers plug in here (see AI_HANDOFF.md "Data loop contract")
 *   - scene.dataLoop = { on, source, site, hours, speed, opacity, showBar, idx }   (saved with the show)
 *   - WXData.draw(...)     warps the current frame onto the Mapbox map (called from engine.renderScene)
 *   - WXData.drawBar(...)  optional in-video playback bar (called from engine.renderScene)
 *   - WXData.ensure(scene) loads frames (awaited by engine.prepareFrame so exports are deterministic)
 *   - the editor bar (arrows, speed, progress, menus) is built here and inserted above the tool row.
 */
(function (g) {
  'use strict';
  const D = g.WXData = { sources: {}, state: new WeakMap(), version: 1 };
  const W = 1920, H = 1080, TZ = 'America/New_York';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- source registry ----------
   * def = { id, label, lengths:[hours,...], sites:[{id,label}] (optional), defaultSite,
   *         list: async ({site, hours, signal}) => [ {t:epochMs, bbox:[west,south,east,north], crs:'4326'|'3857', url | load:async()=>drawable}, ... ] oldest -> newest }
   */
  const PLANNED = [
    { id: 'goes', label: 'GOES Satellite', lengths: [1, 2, 4, 12] },
    { id: 'nexrad', label: 'NEXRAD Radar', lengths: [1, 2, 4], sites: [{ id: 'KBOS', label: 'KBOS Boston' }], defaultSite: 'KBOS' },
    { id: 'rtma', label: 'RTMA Temperatures', lengths: [1, 2, 4, 12] },
    { id: 'forecast', label: 'Forecast (model)', lengths: [12, 24, 48] }
  ];
  D.registerSource = function (def) {
    if (!def || !def.id || typeof def.list !== 'function') throw new Error('WXData.registerSource needs {id, list()}');
    D.sources[def.id] = Object.assign({ label: def.id, lengths: [1, 2, 4] }, def);
    if (D.onSources) D.onSources();
  };
  D.planned = PLANNED;
  const srcInfo = id => D.sources[id] || PLANNED.find(p => p.id === id) || { id, label: id, lengths: [1, 2, 4] };

  /* built-in demo provider: synthetic moving "radar" over New England, so the bar and layer can be tried without any data feed */
  D.registerSource({
    id: 'demo', label: 'Demo loop (test pattern)', lengths: [1, 2, 4],
    list: async ({ hours }) => {
      const n = Math.min(24, Math.round(hours * 8)), now = Math.floor(Date.now() / 600000) * 600000, out = [];
      for (let i = 0; i < n; i++) {
        const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480; const c = cv.getContext('2d');
        for (let k = 0; k < 7; k++) { const ph = i / n * Math.PI * 2, x = 320 + Math.cos(ph + k * 1.1) * (140 + k * 20) , y = 240 + Math.sin(ph * 1.0 + k * 2.1) * (90 + k * 12), r = 60 + k * 14;
          const gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,60,40,.85)'); gr.addColorStop(.4, 'rgba(255,210,40,.75)'); gr.addColorStop(.75, 'rgba(40,200,90,.6)'); gr.addColorStop(1, 'rgba(40,200,90,0)'); c.fillStyle = gr; c.fillRect(0, 0, 640, 480); }
        out.push({ t: now - (n - 1 - i) * Math.round(hours * 3600000 / n), bbox: [-76, 39, -66, 46], crs: '4326', load: async () => cv });
      }
      return out;
    }
  });

  /* ---------- per-scene runtime state ---------- */
  function dlOf(scene) { return scene && scene.dataLoop && scene.dataLoop.on ? scene.dataLoop : null; }
  function rtOf(scene) { let r = D.state.get(scene); if (!r) { r = { key: '', frames: [], loaded: 0, total: 0, status: 'idle', msg: '', playing: false, lastIdx: 0, gen: 0, promise: null }; D.state.set(scene, r); } return r; }
  D.defaults = () => ({ on: true, source: 'demo', site: '', hours: 1, speed: 10, opacity: 0.85, showBar: true, idx: 0 });
  const keyOf = dl => [dl.source, dl.site || '', dl.hours].join('|');

  function loadImage(url) { return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('image failed: ' + url)); im.src = url; }); }

  D.ensure = function (scene) {
    const dl = dlOf(scene); if (!dl) return Promise.resolve();
    const rt = rtOf(scene), key = keyOf(dl);
    if (rt.key === key && rt.promise) return rt.promise;
    const src = D.sources[dl.source]; rt.key = key; rt.frames = []; rt.loaded = 0; rt.total = 0; rt.gen++; const gen = rt.gen;
    if (!src) { rt.status = 'nosrc'; rt.msg = srcInfo(dl.source).label + ' is not connected yet'; rt.promise = Promise.resolve(); return rt.promise; }
    rt.status = 'loading'; rt.msg = 'Loading frames…';
    rt.promise = (async () => {
      try {
        const list = await src.list({ site: dl.site || src.defaultSite || '', hours: dl.hours });
        if (gen !== rt.gen) return;
        rt.frames = (list || []).map(f => Object.assign({}, f, { img: null })); rt.total = rt.frames.length;
        if (!rt.total) { rt.status = 'empty'; rt.msg = 'No frames available'; return; }
        let next = 0; const worker = async () => { while (next < rt.frames.length) { const f = rt.frames[next++]; try { f.img = f.load ? await f.load() : await loadImage(f.url); } catch (e) { f.err = String(e && e.message || e); } if (gen !== rt.gen) return; rt.loaded++; } };
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (gen !== rt.gen) return;
        rt.status = rt.frames.some(f => f.img) ? 'ready' : 'error'; rt.msg = rt.status === 'ready' ? '' : 'Frames could not be loaded';
      } catch (e) { if (gen === rt.gen) { rt.status = 'error'; rt.msg = String(e && e.message || e); } }
    })();
    return rt.promise;
  };
  const ready = rt => rt.frames.filter(f => f.img);
  D.curIdx = function (scene, t, editing) {
    const dl = dlOf(scene), rt = rtOf(scene), n = ready(rt).length; if (!dl || !n) return 0;
    if (editing) return ((Math.round(dl.idx || 0) % n) + n) % n;
    return Math.floor(Math.max(0, t) * clamp(dl.speed || 10, 1, 60) + 1e-6) % n;
  };

  /* ---------- warping a frame onto the Mapbox map ---------- */
  const merc = lat => Math.log(Math.tan(Math.PI / 4 + clamp(lat, -85, 85) * Math.PI / 360));
  const invMerc = y => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
  function tri(c, img, iw, ih, p0, p1, p2, t0, t1, t2) {
    const u0 = t0[0] * iw, v0 = t0[1] * ih, u1 = t1[0] * iw, v1 = t1[1] * ih, u2 = t2[0] * iw, v2 = t2[1] * ih;
    const Dd = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0); if (Math.abs(Dd) < 1e-9) return;
    const a = ((p1[0] - p0[0]) * (v2 - v0) - (p2[0] - p0[0]) * (v1 - v0)) / Dd, cc = ((p2[0] - p0[0]) * (u1 - u0) - (p1[0] - p0[0]) * (u2 - u0)) / Dd,
      b = ((p1[1] - p0[1]) * (v2 - v0) - (p2[1] - p0[1]) * (v1 - v0)) / Dd, d = ((p2[1] - p0[1]) * (u1 - u0) - (p1[1] - p0[1]) * (u2 - u0)) / Dd,
      e = p0[0] - a * u0 - cc * v0, f = p0[1] - b * u0 - d * v0, mx = (p0[0] + p1[0] + p2[0]) / 3, my = (p0[1] + p1[1] + p2[1]) / 3, ex = q => { const dx = q[0] - mx, dy = q[1] - my, l = Math.hypot(dx, dy) || 1; return [q[0] + dx / l * 0.4, q[1] + dy / l * 0.4]; };
    const q0 = ex(p0), q1 = ex(p1), q2 = ex(p2);
    c.save(); c.beginPath(); c.moveTo(q0[0], q0[1]); c.lineTo(q1[0], q1[1]); c.lineTo(q2[0], q2[1]); c.closePath(); c.clip(); c.transform(a, b, cc, d, e, f); c.drawImage(img, 0, 0); c.restore();
  }
  function drawMesh(c, img, bbox, crs, xf) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight; if (!iw || !ih) return;
    const w = bbox[0], s = bbox[1], e = bbox[2], n = bbox[3], N = 18, M = 18, ys = merc(s), yn = merc(n);
    const ll = (u, v) => [w + (e - w) * u, crs === '3857' ? invMerc(yn + (ys - yn) * v) : n + (s - n) * v];
    const P = []; for (let j = 0; j <= M; j++) { P[j] = []; for (let i = 0; i <= N; i++) { const q = ll(i / N, j / M), p = xf.fwd(q[0], q[1]); P[j][i] = (p && isFinite(p[0] + p[1]) && Math.abs(p[0]) < 1e4 && Math.abs(p[1]) < 1e4) ? p : null; } }
    for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
      const a = P[j][i], b = P[j][i + 1], cc = P[j + 1][i], d = P[j + 1][i + 1]; if (!a || !b || !cc || !d) continue;
      const ta = [i / N, j / M], tb = [(i + 1) / N, j / M], tc = [i / N, (j + 1) / M], td = [(i + 1) / N, (j + 1) / M];
      tri(c, img, iw, ih, a, b, cc, ta, tb, tc); tri(c, img, iw, ih, b, d, cc, tb, td, tc);
    }
  }
  D.draw = function (c, scene, t, opts, xf) {
    const dl = dlOf(scene); if (!dl) return;
    const rt = rtOf(scene); if (rt.key !== keyOf(dl)) D.ensure(scene);
    const fr = ready(rt); if (!fr.length) return;
    if (!xf || !xf.mb) return;
    const idx = D.curIdx(scene, t, opts && opts.editing), f = fr[idx]; rt.lastIdx = idx;
    if (!D._cv) { D._cv = document.createElement('canvas'); D._cv.width = W; D._cv.height = H; }
    const sx = D._cv.getContext('2d'); sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, W, H);
    try { drawMesh(sx, f.img, f.bbox, f.crs || '4326', xf); } catch (e) { /* ignore */ }
    c.save(); c.globalAlpha = clamp(dl.opacity == null ? 0.85 : dl.opacity, 0, 1); c.drawImage(D._cv, 0, 0); c.restore();
  };

  /* ---------- time formatting (EDT/EST default) ---------- */
  D.fmtStamp = function (ms) {
    if (!ms) return '';
    const p = {}; new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ, timeZoneName: 'short' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
    return p.weekday + ', ' + p.month + ' ' + p.day + ', ' + p.year + ' ' + p.hour + ':' + p.minute + ' ' + (p.dayPeriod || '') + ' ' + p.timeZoneName;
  };
  const lenLabel = h => h + (h === 1 ? ' Hr' : ' Hrs');
  D.barLabels = function (scene) {
    const dl = dlOf(scene), rt = rtOf(scene), fr = ready(rt), f = fr[clamp(rt.lastIdx, 0, Math.max(0, fr.length - 1))], si = srcInfo(dl.source);
    const site = dl.source === 'nexrad' ? (dl.site || si.defaultSite || 'KBOS') : '';
    return { stamp: f ? D.fmtStamp(f.t) : '', len: lenLabel(dl.hours), src: si.label + (site ? ' ' + site : ''), loadedFrac: rt.total ? rt.loaded / rt.total : 0, pos: fr.length > 1 ? clamp(rt.lastIdx, 0, fr.length - 1) / (fr.length - 1) : 0 };
  };

  /* ---------- in-video playback bar (canvas) ---------- */
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  D.drawBar = function (c, scene, t, opts) {
    const dl = dlOf(scene); if (!dl || dl.showBar === false) return;
    const rt = rtOf(scene); if (!ready(rt).length) return;
    const L = D.barLabels(scene), FONT = '600 26px "Barlow","Inter",system-ui,Arial,sans-serif', x0 = 56, x1 = W - 56, y0 = H - 150, bh = 86;
    c.save(); c.font = FONT; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(8,14,26,0.9)'; rr(c, x0, y0, x1 - x0, bh, 14); c.fill();
    c.fillStyle = '#eaf2ff'; c.font = '700 34px system-ui,Arial,sans-serif'; c.textAlign = 'center';
    c.fillText('‹', x0 + 36, y0 + bh / 2 - 2); c.fillText('›', x0 + 100, y0 + bh / 2 - 2);
    c.font = FONT; c.textAlign = 'left'; c.fillStyle = '#9fb4d6'; c.fillText('−', x0 + 140, y0 + bh / 2); c.fillStyle = '#fff'; c.fillText(dl.speed + 'x', x0 + 172, y0 + bh / 2); c.fillStyle = '#9fb4d6'; c.fillText('+', x0 + 236, y0 + bh / 2);
    const bx0 = x0 + 290, bx1 = x1 - 560, by = y0 + bh / 2 + 10;
    c.fillStyle = 'rgba(255,255,255,0.14)'; rr(c, bx0, by - 5, bx1 - bx0, 10, 5); c.fill();
    c.fillStyle = '#2f7bff'; rr(c, bx0, by - 5, Math.max(10, (bx1 - bx0) * L.loadedFrac), 10, 5); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(bx0 + (bx1 - bx0) * L.pos, by, 11, 0, 6.3); c.fill();
    c.fillStyle = '#eaf2ff'; c.textAlign = 'right'; c.font = '600 24px system-ui,Arial,sans-serif'; c.fillText(L.stamp, bx1, y0 + 22);
    c.font = FONT; c.fillStyle = '#ff5d5d'; c.textAlign = 'left'; c.fillText('LIVE', bx1 + 36, y0 + bh / 2); c.fillStyle = '#eaf2ff'; c.fillText(L.len + ' ▾', bx1 + 128, y0 + bh / 2); c.textAlign = 'right'; c.fillText(L.src + ' ▾', x1 - 22, y0 + bh / 2);
    c.restore();
  };

  /* ---------- editor bar (DOM) ---------- */
  function css() {
    if (document.getElementById('dlCss')) return;
    const s = document.createElement('style'); s.id = 'dlCss';
    s.textContent = '#dlBar{background:#0b1322;border:1px solid #1d2c47;border-radius:8px;padding:6px 10px;margin:6px 0 2px;font-size:13px;color:#dbe7fb}#dlBar .r{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#dlBar .r+.r{margin-top:6px}#dlBar label{display:inline-flex;gap:5px;align-items:center;cursor:pointer}#dlBar button{background:#16233b;border:1px solid #2a3d61;color:#dbe7fb;border-radius:6px;padding:3px 9px;cursor:pointer;min-width:30px}#dlBar button:hover{background:#1f3254}#dlBar button.pl{background:#2f7bff;border-color:#2f7bff;color:#fff;border-radius:50%;width:32px;height:32px;padding:0}#dlBar select{width:auto!important;flex:0 0 auto;background:#16233b;color:#dbe7fb;border:1px solid #2a3d61;border-radius:6px;padding:3px 6px}#dlBar .sp{margin-left:auto;color:#9fb4d6}#dlBar .spd{min-width:34px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}#dlBar .prog{position:relative;flex:1;min-width:140px;height:14px;background:#1a2740;border-radius:7px;cursor:pointer;overflow:hidden}#dlBar .prog i{position:absolute;left:0;top:0;bottom:0;background:#2f7bff;border-radius:7px;transition:width .15s}#dlBar .prog b{position:absolute;top:1px;width:12px;height:12px;border-radius:50%;background:#fff;margin-left:-6px}#dlBar .live{color:#ff5d5d;font-weight:700}#dlBar input[type=checkbox]{width:auto!important}#dlBar .st{color:#9fb4d6;font-size:12px}';
    document.head.append(s);
  }
  function h(tag, a, ...kids) { const e = document.createElement(tag); Object.keys(a || {}).forEach(k => { if (k === 'on') Object.keys(a.on).forEach(ev => e.addEventListener(ev, a.on[ev])); else if (k === 'text') e.textContent = a[k]; else if (k === 'className') e.className = a[k]; else if (k in e && k !== 'list') e[k] = a[k]; else e.setAttribute(k, a[k]); }); kids.flat().forEach(c => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); }); return e; }

  function mountBar() {
    const WX = g.WX; if (!WX || !WX.S) return false;
    const center = document.getElementById('center'), tools = document.getElementById('tools'); if (!center || !tools) return false;
    css();
    const bar = h('div', { id: 'dlBar' }); center.insertBefore(bar, tools);
    let lastScene = null, lastSig = '', refs = null, lastT = 0;
    const cur = () => WX.S.show.scenes[WX.S.si];
    const dlRaw = () => { const sc = cur(); return sc && sc.dataLoop; };
    const save = () => { try { WX.commit(); } catch (e) { /* ignore */ } };
    const allSources = () => { const out = Object.values(D.sources).map(s => ({ id: s.id, label: s.label, ok: true })); D.planned.forEach(p => { if (!D.sources[p.id]) out.push({ id: p.id, label: p.label + ' (not connected yet)', ok: false }); }); return out; };

    function build() {
      const sc = cur(), dl = sc.dataLoop, on = !!(dl && dl.on); bar.textContent = ''; refs = {};
      const top = h('div', { className: 'r' });
      const chk = h('input', { type: 'checkbox', checked: on }); chk.addEventListener('change', () => { if (chk.checked) { sc.dataLoop = Object.assign(D.defaults(), sc.dataLoop || {}, { on: true }); } else if (sc.dataLoop) sc.dataLoop.on = false; save(); build(); });
      top.append(h('label', {}, chk, h('b', { text: 'Weather data loop' })), h('span', { className: 'st', text: on ? '' : 'Radar / satellite / model loops on a Mapbox map scene' }));
      if (on && !(sc.bg && sc.bg.type === 'mapbox')) top.append(h('span', { className: 'st', style: 'color:#ffb86b', text: '⚠ needs a Mapbox map scene' }));
      refs.stamp = h('span', { className: 'sp' }); top.append(refs.stamp); bar.append(top);
      if (!on) return;
      const r2 = h('div', { className: 'r' });
      const step = d => { const rt = rtOf(sc), n = ready(rt).length; if (!n) return; rt.playing = false; dl.idx = (((Math.round(rt.lastIdx) + d) % n) + n) % n; save(); };
      refs.play = h('button', { className: 'pl', title: 'Play / pause the loop preview', text: '▶' }); refs.play.onclick = () => { const rt = rtOf(sc); rt.playing = !rt.playing; if (rt.playing) dl.idx = rt.lastIdx; };
      r2.append(h('button', { title: 'Previous frame', text: '‹', on: { click: () => step(-1) } }), refs.play, h('button', { title: 'Next frame', text: '›', on: { click: () => step(1) } }));
      refs.spd = h('span', { className: 'spd' });
      const bump = d => { dl.speed = clamp((dl.speed || 10) + d, 1, 30); save(); };
      r2.append(h('button', { title: 'Slower', text: '−', on: { click: () => bump(-1) } }), refs.spd, h('button', { title: 'Faster', text: '+', on: { click: () => bump(1) } }));
      refs.prog = h('div', { className: 'prog', title: 'Click or drag to scrub the loop' }, refs.fill = h('i'), refs.knob = h('b'));
      const scrub = e => { const rt = rtOf(sc), n = ready(rt).length; if (!n) return; const r = refs.prog.getBoundingClientRect(); rt.playing = false; dl.idx = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * (n - 1)); };
      let dn = false; refs.prog.addEventListener('pointerdown', e => { dn = true; refs.prog.setPointerCapture(e.pointerId); scrub(e); }); refs.prog.addEventListener('pointermove', e => { if (dn) scrub(e); }); refs.prog.addEventListener('pointerup', () => { dn = false; save(); });
      r2.append(refs.prog);
      const mode = h('select', { title: 'Live now; archive comes later' }, h('option', { value: 'live', text: 'LIVE' }), h('option', { value: 'arch', text: 'ARCHIVED (soon)', disabled: true }));
      const src = srcInfo(dl.source);
      const len = h('select', { title: 'How much time the loop covers' }, (src.lengths || [1, 2, 4]).map(x => h('option', { value: x, text: lenLabel(x), selected: +dl.hours === x })));
      len.onchange = () => { dl.hours = +len.value; save(); };
      const sel = h('select', { title: 'Data being looped' }, allSources().map(s => h('option', { value: s.id, text: s.label, disabled: !s.ok, selected: dl.source === s.id })));
      sel.onchange = () => { const ns = srcInfo(sel.value); dl.source = sel.value; dl.site = ns.defaultSite || ''; if (!(ns.lengths || []).includes(+dl.hours)) dl.hours = (ns.lengths || [1])[0]; dl.idx = 0; save(); build(); };
      r2.append(mode, len, sel);
      if (src.sites && src.sites.length) { const si = h('select', { title: 'Radar site' }, src.sites.map(x => h('option', { value: x.id, text: x.label, selected: (dl.site || src.defaultSite) === x.id }))); si.onchange = () => { dl.site = si.value; dl.idx = 0; save(); }; r2.append(si); }
      bar.append(r2);
      const r3 = h('div', { className: 'r' });
      const op = h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: dl.opacity == null ? 0.85 : dl.opacity, style: 'width:110px' }); op.oninput = () => { dl.opacity = +op.value; }; op.onchange = save;
      const sb = h('input', { type: 'checkbox', checked: dl.showBar !== false }); sb.onchange = () => { dl.showBar = sb.checked; save(); };
      refs.msg = h('span', { className: 'st' });
      r3.append(h('label', {}, 'Opacity', op), h('label', {}, sb, 'Show this bar in the video'), refs.msg); bar.append(r3);
    }

    function tick(ts) {
      try {
        const sc = cur(), dl = dlRaw(), sig = sc ? (dl && dl.on ? [dl.source, dl.hours, dl.site].join('|') : 'off') : '';
        if (sc !== lastScene || sig !== lastSig || !refs) { lastScene = sc; lastSig = sig; if (sc) build(); }
        const on = !!(dl && dl.on);
        if (on) {
          D.ensure(sc); const rt = rtOf(sc), fr = ready(rt), dt = Math.min(0.25, (ts - lastT) / 1000);
          if (rt.playing && fr.length && WX.S.mode === 'edit') { dl.idx = ((dl.idx || 0) + dt * (dl.speed || 10)) % fr.length; }
          if (WX.S.mode === 'edit') rt.lastIdx = fr.length ? Math.floor(((dl.idx || 0) % fr.length + fr.length) % fr.length) : 0;
          if (refs && refs.prog) {
            const L = D.barLabels(sc); refs.stamp.textContent = L.stamp ? L.stamp : ''; refs.spd.textContent = (dl.speed || 10) + 'x';
            refs.fill.style.width = Math.round(L.loadedFrac * 100) + '%'; refs.knob.style.left = Math.round(L.pos * 100) + '%'; refs.play.textContent = rt.playing ? '❚❚' : '▶';
            refs.msg.textContent = rt.status === 'loading' ? 'Loading ' + rt.loaded + ' / ' + rt.total + ' frames…' : (rt.msg || (fr.length + ' frames · Live'));
          }
        }
      } catch (e) { /* never break the editor */ }
      lastT = ts; requestAnimationFrame(tick);
    }
    D.onSources = () => { lastSig = ''; };
    requestAnimationFrame(tick); return true;
  }
  function boot() { if (!mountBar()) setTimeout(boot, 300); }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 50)); else setTimeout(boot, 50); }
})(typeof window !== 'undefined' ? window : globalThis);
