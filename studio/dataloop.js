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
    { id: 'nexrad', label: 'NEXRAD Radar', lengths: [1, 2, 4], sites: [{ id: 'KBOX', label: 'KBOX Boston/Taunton' }], defaultSite: 'KBOX' },
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

  /* built-in demo providers (synthetic test patterns, clearly labelled DEMO). They exist so the bar, menu, palette
   * selector and export can be tried without any feed: 'demo' = scalar dBZ grid, 'demo-ir' = scalar IR temperature grid,
   * 'demo-rgb' = an already-coloured RGB image (like GeoColor) so the "no color table" behaviour can be checked. */
  function demoFrames(hours, kind) {
    const n = Math.min(24, Math.max(2, Math.round(hours * 8))), now = Math.floor(Date.now() / 600000) * 600000, out = [], bbox = [-76, 39, -66, 46], GW = 160, GH = 120;
    for (let i = 0; i < n; i++) {
      const ph = i / n * Math.PI * 2, blobs = []; for (let k = 0; k < 7; k++) blobs.push([GW / 2 + Math.cos(ph + k * 1.1) * (35 + k * 5), GH / 2 + Math.sin(ph + k * 2.1) * (22 + k * 3), 15 + k * 3.5]);
      const val = new Float32Array(GW * GH);
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { let v = 0; for (const b of blobs) { const d = Math.hypot(x - b[0], y - b[1]) / b[2]; v = Math.max(v, Math.exp(-d * d * 1.6)); } val[y * GW + x] = v; }
      const f = { t: now - (n - 1 - i) * Math.round(hours * 3600000 / n), bbox: bbox.slice(), crs: '4326' };
      if (kind === 'dbz') { for (let k = 0; k < val.length; k++) val[k] = val[k] < 0.08 ? NaN : val[k] * 75; f.scalar = { w: GW, h: GH, data: val, units: 'dBZ' }; }
      else if (kind === 'ir') { for (let k = 0; k < val.length; k++) val[k] = 30 - val[k] * 120; f.scalar = { w: GW, h: GH, data: val, units: '°C' }; }
      else { f.load = async () => { const cv = document.createElement('canvas'); cv.width = GW; cv.height = GH; const c = cv.getContext('2d'), id = c.createImageData(GW, GH); for (let k = 0; k < val.length; k++) { const v = val[k]; id.data[k * 4] = 40 + 200 * v; id.data[k * 4 + 1] = 70 + 170 * v; id.data[k * 4 + 2] = 120 + 120 * v; id.data[k * 4 + 3] = 40 + 215 * v; } c.putImageData(id, 0, 0); return cv; }; }
      out.push(f);
    }
    return out;
  }
  D.registerSource({ id: 'demo', label: 'Demo · radar test pattern', demo: true, kind: 'dbz', lengths: [1, 2, 4], list: async ({ hours }) => demoFrames(hours, 'dbz') });
  D.registerSource({ id: 'demo-ir', label: 'Demo · infrared test pattern', demo: true, kind: 'ir', lengths: [1, 2, 4], list: async ({ hours }) => demoFrames(hours, 'ir') });
  D.registerSource({ id: 'demo-rgb', label: 'Demo · RGB image (GeoColor-style)', demo: true, kind: 'rgb', lengths: [1, 2, 4], list: async ({ hours }) => demoFrames(hours, 'rgb') });

  /* ---------- per-scene runtime state ---------- */
  function dlOf(scene) { return scene && scene.dataLoop && scene.dataLoop.on ? scene.dataLoop : null; }
  function rtOf(scene) { let r = D.state.get(scene); if (!r) { r = { key: '', frames: [], loaded: 0, total: 0, status: 'idle', msg: '', playing: false, lastIdx: 0, gen: 0, promise: null }; D.state.set(scene, r); } return r; }
  D.defaults = () => ({ on: true, source: 'demo', site: '', hours: 1, speed: 10, opacity: 0.85, showBar: true, idx: 0 });
  const keyOf = dl => [dl.source, dl.site || '', dl.hours].join('|');

  function loadImage(url) { return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('image failed: ' + url)); im.src = url; }); }

  // Standalone colours ONLY for synthetic scalar DEMOS if the separate weather
  // palette registry has not loaded yet. These are not NOAA tables or a
  // substitute for any real observation product's required colour palette.
  // Pre-coloured demo RGB frames need no palette and use their own loader.
  function paintDemoFallback(sc,kind){
    const cv=document.createElement('canvas');cv.width=sc.w;cv.height=sc.h;
    const c=cv.getContext('2d');
    if(!c)throw Error('Canvas 2D is unavailable for this demo');
    const im=c.createImageData(sc.w,sc.h),d=im.data;
    const stops=kind==='dbz'
      ?[[5,[0,230,235]],[20,[0,205,0]],[35,[255,240,0]],
        [50,[245,0,0]],[65,[236,0,236]],[75,[255,255,255]]]
      :[[-95,[255,255,255]],[-75,[130,75,210]],[-55,[240,75,80]],
        [-35,[250,230,75]],[-15,[75,175,205]],[5,[145,155,170]],
        [40,[10,18,32]]];
    for(let i=0;i<sc.data.length;i++){
      const v=sc.data[i];if(!Number.isFinite(v)||(kind==='dbz'&&v<5))continue;
      let k=0;while(k+1<stops.length&&v>=stops[k+1][0])k++;
      const a=stops[k],b=stops[Math.min(k+1,stops.length-1)];
      const ratio=kind==='dbz'||b===a?0:Math.max(0,Math.min(1,(v-a[0])/(b[0]-a[0])));
      for(let j=0;j<3;j++)d[i*4+j]=Math.round(a[1][j]+(b[1][j]-a[1][j])*ratio);
      d[i*4+3]=255;
    }
    c.putImageData(im,0,0);return cv;
  }

  D.ensure = function (scene) {
    const dl = dlOf(scene); if (!dl) return Promise.resolve();
    const rt = rtOf(scene), key = keyOf(dl);
    // A scalar demo that used emergency colours while the palette module was
    // unavailable should automatically repaint from the correct built-in
    // weather palette once it appears. Do not cache an early failed load for
    // the lifetime of a scene.
    if (rt.key === key && rt.promise && !(rt.demoPaletteFallback && palIdOf(dl))) return rt.promise;
    const src = D.sources[dl.source]; rt.key = key; rt.frames = []; rt.loaded = 0; rt.total = 0;
    rt.demoPaletteFallback = false; rt.gen++; const gen = rt.gen;
    if (!src) { rt.status = 'nosrc'; rt.msg = srcInfo(dl.source).label + ' is not connected yet'; rt.promise = Promise.resolve(); return rt.promise; }
    rt.status = 'loading'; rt.msg = 'Loading frames…';
    rt.promise = (async () => {
      try {
        const list = await src.list({ site: dl.site || src.defaultSite || '', hours: dl.hours });
        if (gen !== rt.gen) return;
        rt.frames = (list || []).map(f => Object.assign({}, f, { img: null })); rt.total = rt.frames.length;
        if (!rt.total) { rt.status = 'empty'; rt.msg = 'No frames available'; return; }
        const pal = palIdOf(dl); rt.failed = 0;
        let next = 0; const worker = async () => { while (next < rt.frames.length) {
          const f = rt.frames[next++];
          try {
            if (f.scalar) {
              // Only the built-in fake radar / IR demos may use emergency
              // colours; live NOAA grids must have a real applicable palette.
              if (!pal && src.demo) {
                f.img = paintDemoFallback(f.scalar, src.kind);
                rt.demoPaletteFallback = true;
              } else {
                try { f.img = paintScalar(f.scalar,pal); }
                catch (e) {
                  if (!src.demo) throw e;
                  f.img = paintDemoFallback(f.scalar,src.kind);
                  // A broken installed palette should not cause endless
                  // relist/retry attempts on every editor animation frame.
                  rt.demoPaletteFallback = !pal;
                  console.warn('WX Studio: demo palette unavailable, displaying synthetic fallback',e);
                }
              }
            } else f.img = f.load ? await f.load() : await loadImage(f.url);
          } catch (e) { f.err = String(e && e.message || e); rt.failed++; }
          if (gen !== rt.gen) return;
          rt.loaded++;
        } };
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (gen !== rt.gen) return;
        rt.status = rt.frames.some(f => f.img) ? 'ready' : 'error';
        const firstError=rt.frames.find(f=>f.err)?.err;
        rt.msg = rt.status !== 'ready'
          ? 'Frames could not be loaded' + (firstError ? ': ' + firstError : '')
          : (rt.failed ? rt.failed + ' of ' + rt.total + ' frames failed to load'
            : rt.demoPaletteFallback ? 'Demo using temporary colours until weather palettes finish loading' : '');
      } catch (e) { if (gen === rt.gen) { rt.status = 'error'; rt.msg = String(e && e.message || e); } }
    })();
    return rt.promise;
  };
  const ready = rt => rt.frames.filter(f => f.img);
  D.curIdx = function (scene, t, editing) {
    const dl = dlOf(scene), rt = rtOf(scene), n = ready(rt).length; if (!dl || !n) return 0;
    const speed = clamp(dl.speed || 10, 1, 60), hold = clamp(+dl.dwell || 0, 0, 5) * speed;   // hold = frames' worth of pause on the newest frame
    if (editing) { const ph = (((dl.idx || 0) % (n + hold)) + (n + hold)) % (n + hold); return Math.min(n - 1, Math.floor(ph + 1e-6)); }
    const ph = (Math.max(0, t) * speed + 1e-6) % (n + hold); return Math.min(n - 1, Math.floor(ph));
  };

  /* ---------- palettes: uses ChatGPT's WXWeatherPalettes registry (no copy of palette data here) ---------- */
  const WP = () => g.WXWeatherPalettes, WSRC = () => g.WXWeatherSources;
  const SAT_RE = /^goes-(east|west)-(conus|full|meso1|meso2)-(C02|C13)$/;
  /* what catalog product a registered source corresponds to (so palette rules come from the catalog, not from here) */
  D.productOf = function (sourceId) {
    const def = D.sources[sourceId], C = WSRC(), by = id => (C && C.byId && C.byId(id)) || null;
    if (def && def.demo) return { id: 'demo:' + def.kind, base: 'demo-' + def.kind, label: def.label, palette: def.kind === 'dbz' ? 'radar/reflectivity' : def.kind === 'ir' ? 'satellite/ir-enhanced' : null, display: def.kind === 'rgb' ? 'already an RGB image' : 'test data grid' };
    let id = null; const m = SAT_RE.exec(sourceId);
    if (m) id = (m[1] === 'east' ? 'g19' : 'g18') + '_' + (m[2] === 'full' ? 'fulldisk' : m[2]) + '_' + (m[3] === 'C02' ? 'abi_c02' : 'abi_c13');
    else if (sourceId === 'goes') id = 'g19_conus_abi_c02';
    else if (sourceId === 'mrms') id = def && def.nativeData === false ? 'mrms_nws_4hour_image' : 'mrms_mosaic_reflectivity';
    else if (sourceId === 'nexrad') id = 'nexrad_level2_base_reflectivity';
    const p = id && by(id); if (!p) return { id: id || sourceId, base: id || sourceId, label: srcInfo(sourceId).label, palette: null, display: '', unknown: true };
    return { id: p.id, base: p.id.replace(/^g\d+_[a-z0-9]+_/, ''), label: p.label, palette: p.palette || null, display: p.display || '', category: p.category };
  };
  const palIdOf = dl => { const pr = D.productOf(dl.source); if (!pr.palette) return null; const want = dl.palette && WP() && WP().get(dl.palette) ? dl.palette : pr.palette; return WP() && WP().get(want) ? want : null; };
  D.paletteFor = scene => { const dl = scene && scene.dataLoop; return dl ? palIdOf(dl) : null; };
  /* palettes that suit a source: built-ins naming this product, plus any custom (e.g. cloud-saved) palette registered for it */
  D.paletteChoices = function (sourceId) {
    const P = WP(), pr = D.productOf(sourceId); if (!P || !pr.palette) return [];
    const cat = (P.get(pr.palette) || {}).category;
    return P.list(cat).filter(x => x.id === pr.palette || (x.productIds || []).includes(pr.base) || (P.custom[x.id] && (!x.productIds || x.productIds.includes(pr.base))));
  };
  const hexRGB = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  /* 1024-step lookup table for a palette (interpolated for continuous palettes, stepped for classed ones like dBZ) */
  D.paletteLut = function (id, steps) {
    const p = WP() && WP().get(id); if (!p) return null; steps = steps || 1024;
    const st = p.stops, lo = st[0][0], hi = st[st.length - 1][0], lut = new Uint8ClampedArray(steps * 4), below = p.belowColor ? hexRGB(p.belowColor) : null;
    for (let i = 0; i < steps; i++) {
      const v = lo + (hi - lo) * i / (steps - 1); let k = 0; while (k + 1 < st.length && v >= st[k + 1][0]) k++;
      const a = hexRGB(st[k][1]); let c = a;
      if (p.continuous && k + 1 < st.length) { const b = hexRGB(st[k + 1][1]), f = (v - st[k][0]) / (st[k + 1][0] - st[k][0]); c = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
      lut[i * 4] = c[0]; lut[i * 4 + 1] = c[1]; lut[i * 4 + 2] = c[2]; lut[i * 4 + 3] = 255;
    }
    return { lut, lo, hi, steps, below, continuous: !!p.continuous, firstClassStart: lo };
  };
  /* colour a scalar grid {w,h,data} with a palette id -> canvas (NaN and values under the first class stay transparent unless the palette defines belowColor) */
  function paintScalar(sc, palId) {
    const L = palId && D.paletteLut(palId); if (!L) throw new Error('No palette available for this data');
    const cv = document.createElement('canvas'); cv.width = sc.w; cv.height = sc.h; const c = cv.getContext('2d'), im = c.createImageData(sc.w, sc.h), d = im.data, span = L.hi - L.lo;
    for (let i = 0; i < sc.data.length; i++) {
      const v = sc.data[i]; if (!isFinite(v)) continue;
      if (v < L.lo) { if (L.below) { d[i * 4] = L.below[0]; d[i * 4 + 1] = L.below[1]; d[i * 4 + 2] = L.below[2]; d[i * 4 + 3] = 255; } continue; }
      const q = Math.min(L.steps - 1, Math.floor((v - L.lo) / span * (L.steps - 1) + 0.5)) * 4; d[i * 4] = L.lut[q]; d[i * 4 + 1] = L.lut[q + 1]; d[i * 4 + 2] = L.lut[q + 2]; d[i * 4 + 3] = 255;
    }
    c.putImageData(im, 0, 0); return cv;
  }
  D.paintScalar = paintScalar;
  /* switch palette: recolour every loaded scalar frame; frames that arrive pre-coloured from a service are NOT recoloured */
  D.setPalette = function (scene, id) {
    const dl = scene && scene.dataLoop; if (!dl) return { ok: false, recoloured: 0 };
    if (id) dl.palette = id; else delete dl.palette;
    const rt = rtOf(scene), pal = palIdOf(dl); let n = 0;
    rt.frames.forEach(f => { if (f.scalar && pal) { try { f.img = paintScalar(f.scalar, pal); delete f._wxUnderlayDataURL; n++; } catch (e) { f.err = String(e.message || e); } } });
    // Mapbox keeps the previous image when the frame id is unchanged; clearing it forces the next draw to push the recoloured frame.
    try { if (n && g.MB && g.MB.setWeatherFrame) g.MB.setWeatherFrame(null); } catch (e) { /* ignore */ }
    return { ok: true, recoloured: n, palette: pal };
  };
  D.paletteApplies = scene => { const dl = scene && scene.dataLoop; if (!dl) return 'none'; if (!D.productOf(dl.source).palette) return 'rgb'; const fr = rtOf(scene).frames; return fr.some(f => f.scalar) ? 'live' : 'saved'; };

  /* ---------- source classification (status + menu category) ---------- */
  D.CATEGORIES = [{ id: 'satellite', label: 'Satellite' }, { id: 'radar-mosaic', label: 'Radar Mosaic' }, { id: 'radar-site', label: 'Single-Site NEXRAD' }, { id: 'rtma', label: 'RTMA' }, { id: 'forecast', label: 'Forecast' }];
  D.classify = function (id) {
    const def = D.sources[id]; let category = 'other';
    if (def && def.demo) category = 'demo'; else if (/^goes/.test(id) || (def && def.category === 'satellite')) category = 'satellite';
    else if (id === 'nexrad') category = 'radar-site'; else if (id === 'mrms' || (def && def.category === 'radar')) category = 'radar-mosaic';
    else if (id === 'rtma' || id === 'forecast') category = id;
    const status = !def ? 'notconnected' : def.demo ? 'demo' : def.nativeData === false ? 'experimental' : 'connected';
    return { id, category, status };
  };
  D.STATUS_TEXT = { connected: 'Connected', experimental: 'Experimental', demo: 'Demo', notconnected: 'Not connected' };
  D.displayName = function (id, dl) {
    const def = D.sources[id]; if (id === 'nexrad') return 'NEXRAD · ' + ((dl && dl.site) || srcInfo('nexrad').defaultSite || 'KBOX');
    return String((def && def.label) || srcInfo(id).label || id).replace(/\s*\((test)\)\s*$/i, '');
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
    const site = dl.source === 'nexrad' ? (dl.site || si.defaultSite || 'KBOX') : '';
    return { stamp: f ? D.fmtStamp(f.t) : '', len: lenLabel(dl.hours), src: (dl.source === 'nexrad' ? 'NEXRAD' : D.displayName(dl.source, dl)) + (site ? ' ' + site : ''), loadedFrac: rt.total ? rt.loaded / rt.total : 0, pos: fr.length > 1 ? clamp(rt.lastIdx, 0, fr.length - 1) / (fr.length - 1) : 0 };
  };

  /* ---------- in-video playback bar (canvas) ---------- */
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  D.drawBar = function (c, scene, t, opts) {
    // Editor bar is now a clickable map overlay; never draw a duplicate
    // into live preview or thumbnails. MP4/PNG and Present still use canvas.
    const presenting=typeof document!=='undefined' &&
      !!document.querySelector('#stageWrap.present');
    if(opts&&(opts.editing||opts.liveMap)&&!presenting)return;
    const dl = dlOf(scene); if (!dl || dl.showBar === false) return;
    const rt = rtOf(scene); if (!ready(rt).length) return;
    // Match the on-screen Aguacero-style dock at the absolute bottom
    // of the 1920×1080 exported frame. Timestamp stays above blue scrub.
    const L = D.barLabels(scene), FONT = '600 25px "Barlow","Inter",system-ui,Arial,sans-serif',
      x0 = 12, x1 = W - 12, y0 = H - 70, bh = 70;
    c.save(); c.font = FONT; c.textBaseline = 'middle';
    // The dock sits over the Mapbox attribution baked into the map frame; Mapbox/OSM credit must stay readable, so repeat it just above the dock.
    if (scene.bg && scene.bg.type === 'mapbox') { c.save(); c.font = '500 15px system-ui,Arial,sans-serif'; c.textAlign = 'left'; c.fillStyle = 'rgba(255,255,255,0.85)'; c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = 4; c.fillText('© Mapbox  © OpenStreetMap contributors', x0 + 6, y0 - 12); c.restore(); }
    c.fillStyle = 'rgba(8,14,26,0.9)'; rr(c, x0, y0, x1 - x0, bh, 14); c.fill();
    c.fillStyle = '#eaf2ff'; c.font = '700 34px system-ui,Arial,sans-serif'; c.textAlign = 'center';
    c.fillText('‹', x0 + 36, y0 + bh / 2 - 2); c.fillText('›', x0 + 100, y0 + bh / 2 - 2);
    c.font = FONT; c.textAlign = 'left'; c.fillStyle = '#9fb4d6'; c.fillText('−', x0 + 140, y0 + bh / 2); c.fillStyle = '#fff'; c.fillText(dl.speed + 'x', x0 + 172, y0 + bh / 2); c.fillStyle = '#9fb4d6'; c.fillText('+', x0 + 236, y0 + bh / 2);
    const bx0 = x0 + 300, bx1 = x1 - 565, by = y0 + bh / 2 + 16;
    c.fillStyle = 'rgba(255,255,255,0.14)'; rr(c, bx0, by - 5, bx1 - bx0, 10, 5); c.fill();
    c.fillStyle = '#2f7bff'; rr(c, bx0, by - 5, Math.max(10, (bx1 - bx0) * L.loadedFrac), 10, 5); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(bx0 + (bx1 - bx0) * L.pos, by, 11, 0, 6.3); c.fill();
    c.fillStyle = '#eaf2ff'; c.textAlign = 'right'; c.font = '600 24px system-ui,Arial,sans-serif'; c.fillText(L.stamp, bx1, y0 + 13);
    c.font = FONT; c.fillStyle = '#ff5d5d'; c.textAlign = 'left'; c.fillText('LIVE', bx1 + 36, y0 + bh / 2); c.fillStyle = '#eaf2ff'; c.fillText(L.len + ' ▾', bx1 + 128, y0 + bh / 2); c.textAlign = 'right'; c.fillText(L.src + ' ▾', x1 - 22, y0 + bh / 2);
    c.restore();
  };

  /* ---------- editor bar (DOM) ---------- */
  function css() {
    if(document.getElementById('dlCss'))return;
    const style=document.createElement('style');style.id='dlCss';
    style.textContent="#stageWrap #dlBar{position:absolute;left:0;right:0;bottom:0;z-index:8;background:rgba(8,14,26,.94);border-top:1px solid #344763;border-radius:0;padding:3px 8px 4px;margin:0;color:#e4eefc;font:600 12px/1.25 Barlow,Arial,sans-serif;box-sizing:border-box}#dlBar[hidden],#stageWrap.present #dlBar{display:none!important}#dlBar *{box-sizing:border-box}#dlBar .dl-row{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;min-height:39px}#dlBar .dl-ctrl{display:flex;align-items:center;gap:3px;flex:0 0 auto}#dlBar button,#dlBar select{background:#151c2c;border:1px solid #25354f;color:#eaf2ff;border-radius:5px;padding:3px 6px;height:27px;min-width:25px;white-space:nowrap;cursor:pointer;font:inherit}#dlBar button:hover,#dlBar select:hover{background:#213249}#dlBar button.pl{height:28px;width:28px;min-width:28px;padding:0;border-radius:50%;background:#4b55f2;color:white;border:0;font-size:15px}#dlBar button.loop-toggle{font-size:13px;min-width:25px}#dlBar select{width:auto!important;min-width:0;max-width:170px}#dlBar select.dl-source{max-width:180px;flex:0 1 auto}#dlBar .spd{min-width:29px;text-align:center;font-weight:800;font-variant-numeric:tabular-nums}#dlBar .dl-timeline{display:flex;flex-direction:column;flex:1;min-width:80px;gap:2px}#dlBar .dl-stamp{font:600 11px/1.1 Barlow,Arial,sans-serif;text-align:right;min-height:12px;color:#e9f2ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#dlBar .prog{position:relative;flex:1;height:7px;background:#29354f;border-radius:6px;cursor:ew-resize;overflow:visible;margin:2px 1px 4px}#dlBar .prog i{position:absolute;left:0;top:0;bottom:0;background:#4b55f2;border-radius:6px;transition:width .12s}#dlBar .prog b{position:absolute;top:-4px;width:15px;height:15px;background:#7387ff;border:1px solid #d4dcff;border-radius:50%;margin-left:-7px}#dlBar .dl-live{color:#ff6565;font-weight:800;letter-spacing:.3px}#dlBar .dl-options{display:flex;gap:5px;align-items:center;flex:0 1 auto;min-width:0}#dlBar .dl-settings{position:absolute;right:8px;bottom:calc(100% + 4px);background:rgba(12,21,37,.97);border:1px solid #344763;border-radius:6px;padding:9px 11px;display:flex;align-items:center;gap:12px;box-shadow:0 3px 12px #020611;max-width:min(95%,550px)}#dlBar .dl-settings[hidden]{display:none!important}#dlBar .dl-settings label{display:inline-flex;gap:5px;align-items:center;white-space:nowrap;cursor:pointer}#dlBar input[type=checkbox]{width:auto!important}#dlBar input[type=range]{width:90px}#dlBar .st{font-weight:400;color:#9eb2cc;font-size:11px;white-space:nowrap}@media(max-width:950px){#stageWrap #dlBar{padding:2px 4px}#dlBar .dl-row{gap:3px}#dlBar select.dl-source{max-width:110px}#dlBar .dl-options{gap:2px}#dlBar button,#dlBar select{padding:2px 4px}}";
    document.head.append(style);
    // Weather Data menu, palette selector and status pills (second sheet keeps the dock rules above untouched).
    const s2=document.createElement('style');s2.id='dlCss2';
    s2.textContent="#dlBar .pill,#dlMenu .pill{display:inline-block;font:800 9px/1 Barlow,Arial,sans-serif;letter-spacing:.5px;text-transform:uppercase;padding:3px 5px;border-radius:9px;white-space:nowrap}.pill.connected{background:#12361f;color:#6ee79a;border:1px solid #1f7a43}.pill.experimental{background:#3a2a08;color:#ffc65c;border:1px solid #8a6310}.pill.demo{background:#17294a;color:#8db4ff;border:1px solid #31508f}.pill.notconnected{background:#2a2f3a;color:#a4afc0;border:1px solid #444e60}#dlBar button.dl-source{display:inline-flex;align-items:center;gap:6px;max-width:240px}#dlBar .dl-srcname{overflow:hidden;text-overflow:ellipsis;max-width:170px}#dlBar .dl-live::before{content:'';display:inline-block;width:7px;height:7px;border-radius:50%;background:#ff4b4b;margin-right:5px;vertical-align:1px}#dlBar .dl-stamp.warn{color:#ffc65c}#dlBar .dl-stamp.load{color:#9ec2ff}#dlBar button.dl-palbtn{padding:0;width:30px}#dlBar .dl-palbtn .sw{display:block;margin:0 auto;width:20px;height:10px;border-radius:3px;background:linear-gradient(90deg,#04e9e7,#02fd02,#fdf802,#fd0000,#f800fd)}#dlBar:focus-visible{outline:2px solid #4b55f2;outline-offset:-2px}#dlBar select.dl-len{max-width:80px}#dlBar .dl-timeline .prog{flex:0 0 8px;height:8px;min-height:8px;margin:3px 1px 5px;background:#26324b}#dlBar .dl-timeline .prog i{background:#3d6dff}#dlBar .dl-timeline .prog b{top:-4px;width:16px;height:16px;margin-left:-8px;background:#fff;border:2px solid #3d6dff}"+
    "#stageWrap #dlMenu{position:absolute;right:8px;bottom:52px;z-index:9;width:min(470px,calc(100% - 16px));max-height:calc(100% - 64px);overflow:auto;background:rgba(10,17,30,.98);border:1px solid #344763;border-radius:9px;box-shadow:0 8px 28px #000c;color:#e4eefc;font:600 12px/1.3 Barlow,Arial,sans-serif;box-sizing:border-box}#dlMenu[hidden]{display:none!important}#dlMenu *{box-sizing:border-box}#dlMenu .dm-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px 4px;font-size:14px}#dlMenu button{font:inherit;color:inherit;cursor:pointer}#dlMenu .dm-x{background:none;border:0;font-size:20px;line-height:1;padding:0 4px}#dlMenu .dm-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:2px 10px 6px;border-bottom:1px solid #223149}#dlMenu .dm-tab{background:#141d2e;border:1px solid #25354f;border-radius:14px;padding:4px 9px}#dlMenu .dm-tab.on,#dlMenu .dm-chip.on{background:#4b55f2;border-color:#4b55f2;color:#fff}#dlMenu .dm-body{padding:8px 10px;display:flex;flex-direction:column;gap:6px}#dlMenu .dm-body.pal{border-top:1px solid #223149}#dlMenu .dm-chips{display:flex;flex-wrap:wrap;gap:4px}#dlMenu .dm-chip{background:#141d2e;border:1px solid #25354f;border-radius:6px;padding:4px 8px}#dlMenu .dm-row{display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;background:#121a2a;border:1px solid #22314a;border-radius:7px;padding:7px 9px}#dlMenu .dm-row:hover:not(.off){background:#1a2640}#dlMenu .dm-row.on{border-color:#4b55f2;box-shadow:inset 0 0 0 1px #4b55f2}#dlMenu .dm-row.off{opacity:.62;cursor:not-allowed}#dlMenu .dm-main{display:flex;flex-direction:column;gap:1px;min-width:0}#dlMenu .dm-main b{font-weight:700}#dlMenu .dm-main i{font-style:normal;font-weight:400;color:#9eb2cc;font-size:11px}#dlMenu .dm-note{font-weight:400;color:#9eb2cc;font-size:11px}#dlMenu .dm-note.rgb{color:#c8d6ee;background:#17223a;border:1px dashed #34476b;border-radius:6px;padding:7px 9px}#dlMenu .dm-h{font:800 11px Barlow,Arial,sans-serif;letter-spacing:.6px;text-transform:uppercase;color:#7f95b8}#dlMenu .dm-filter{background:#0e1626;border:1px solid #25354f;color:#e4eefc;border-radius:6px;padding:5px 7px;font:inherit}#dlMenu .dm-sites{background:#0e1626;border:1px solid #25354f;color:#e4eefc;border-radius:6px;font:inherit;width:100%}#dlMenu .dm-pal{display:flex;flex-direction:column;gap:3px;text-align:left;background:#121a2a;border:1px solid #22314a;border-radius:7px;padding:7px 9px}#dlMenu .dm-pal.on{border-color:#4b55f2;box-shadow:inset 0 0 0 1px #4b55f2}#stageWrap #dlMenu canvas.dm-strip{position:static!important;inset:auto!important;left:auto!important;top:auto!important;width:100%!important;height:12px!important;border-radius:3px;display:block;pointer-events:none}#dlMenu .dm-pm{display:flex;justify-content:space-between;gap:8px}#dlMenu .dm-pm i{font-style:normal;font-weight:400;color:#9eb2cc;font-size:11px}";
    document.head.append(s2);
  }
  function h(tag, a, ...kids) { const e = document.createElement(tag); Object.keys(a || {}).forEach(k => { if (k === 'on') Object.keys(a.on).forEach(ev => e.addEventListener(ev, a.on[ev])); else if (k === 'text') e.textContent = a[k]; else if (k === 'className') e.className = a[k]; else if (k in e && k !== 'list') e[k] = a[k]; else e.setAttribute(k, a[k]); }); kids.flat().forEach(c => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); }); return e; }

  /* ---------- Weather Data menu + palette selector (flyout above the dock) ---------- */
  const ui = D.ui = { open: false, tab: 'satellite', sat: 'east', sector: 'conus', filter: '', cloudMsg: '', wantPalette: false };
  const tabOfSource = id => { const c = D.classify(id).category; return D.CATEGORIES.some(x => x.id === c) ? c : (c === 'demo' ? 'demo' : 'satellite'); };
  D.tabOfSource = tabOfSource;
  const ageText = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 90 ? m + ' min ago' : (m / 60).toFixed(m < 600 ? 1 : 0) + ' h ago'; };

  function mountBar() {
    const WX = g.WX; if (!WX || !WX.S) return false;
    const stage = document.getElementById('stageWrap');
    if (!stage) return false;
    if (document.getElementById('dlBar')) return true;
    css();
    const bar = h('div', { id: 'dlBar', 'aria-label': 'Weather data playback controls' });
    bar.setAttribute('tabindex', '0');
    stage.appendChild(bar);
    // Do not let timeline scrubbing pan or draw on the map below it.
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend', 'wheel'])
      bar.addEventListener(ev, e => e.stopPropagation());
    let lastScene = null, lastSig = '', refs = null, lastT = 0, menu = null;
    const cur = () => WX.S.show.scenes[WX.S.si];
    const dlRaw = () => { const sc = cur(); return sc && sc.dataLoop; };
    const save = () => { try { WX.commit(); } catch (e) { /* ignore */ } };
    const stepFrame = d => { const sc = cur(), dl = dlRaw(), rt = rtOf(sc), n = ready(rt).length; if (!n || !dl) return; rt.playing = false; dl.idx = (((Math.floor(rt.lastIdx) + d) % n) + n) % n; save(); };
    const togglePlay = () => { const sc = cur(), dl = dlRaw(), rt = rtOf(sc); if (!dl) return; rt.playing = !rt.playing; if (rt.playing) dl.idx = rt.lastIdx; };
    const bumpSpeed = d => { const dl = dlRaw(); if (!dl) return; dl.speed = clamp((dl.speed || 10) + d, 1, 30); save(); };
    const pickSource = (id, extra) => {
      const sc = cur(), def = D.sources[id]; if (!sc || !def) return;
      const dl = sc.dataLoop = Object.assign(D.defaults(), sc.dataLoop || {}, { on: true });
      dl.source = id; dl.site = extra && extra.site != null ? extra.site : (def.defaultSite || '');
      const lens = def.lengths || [1]; if (!lens.includes(+dl.hours)) dl.hours = lens[0]; dl.idx = 0; delete dl.palette; save(); build(); renderMenu();
    };

    /* ---- menu rendering ---- */
    const pill = st => h('span', { className: 'pill ' + st, text: D.STATUS_TEXT[st] });
    function srcRow(o) {
      const on = o.selected, off = o.status === 'notconnected';
      return h('button', { className: 'dm-row' + (on ? ' on' : '') + (off ? ' off' : ''), disabled: !!off && !o.force, title: o.title || '', on: { click: () => { if (!off || o.force) o.pick(); } } },
        h('span', { className: 'dm-main' }, h('b', { text: o.name }), h('i', { text: o.sub || '' })), pill(o.status));
    }
    function chips(list, val, set) { return h('div', { className: 'dm-chips' }, list.map(([id, label]) => h('button', { className: 'dm-chip' + (val === id ? ' on' : ''), text: label, on: { click: () => { set(id); renderMenu(); } } }))); }
    function tabSatellite(box, dl) {
      const C = WSRC();
      box.append(chips([['east', 'GOES-19 East'], ['west', 'GOES-18 West']], ui.sat, v => ui.sat = v), chips([['conus', 'CONUS'], ['full', 'Full Disk'], ['meso1', 'Mesoscale 1'], ['meso2', 'Mesoscale 2']], ui.sector, v => ui.sector = v));
      if (!C) { box.append(h('div', { className: 'dm-note', text: 'Source catalog not loaded.' })); return; }
      const prefix = (ui.sat === 'east' ? 'g19' : 'g18') + '_' + (ui.sector === 'full' ? 'fulldisk' : ui.sector) + '_';
      const prods = C.list('satellite').filter(p => p.id.startsWith(prefix));
      if (ui.sector.startsWith('meso')) box.append(h('div', { className: 'dm-note', text: 'Mesoscale sectors move: each scan has its own footprint.' }));
      prods.forEach(p => {
        const m = /(abi_c02|abi_c13)$/.exec(p.id), sid = m ? 'goes-' + ui.sat + '-' + (ui.sector) + '-' + (m[1] === 'abi_c02' ? 'C02' : 'C13') : null, st = sid ? D.classify(sid).status : 'notconnected';
        const rgb = !p.palette, sub = (p.resolutionKm ? p.resolutionKm + ' km · ' : '') + (rgb ? (p.id.endsWith('abi_multichannel') ? 'GeoColor-style RGB (no color table)' : 'grayscale reflectance (no color table)') : 'color table: ' + (p.display || p.palette));
        box.append(srcRow({ name: p.id.endsWith('abi_multichannel') ? 'GeoColor-style RGB (multi-channel)' : p.label.replace(/^ABI /, '').replace(/ — native.*$/, ''), sub, status: st, selected: !!sid && dl && dl.source === sid, title: st === 'notconnected' ? 'Not connected — no decoded NOAA frames are being served for this product yet' : '', pick: () => pickSource(sid) }));
      });
      if (!prods.length) box.append(h('div', { className: 'dm-note', text: 'No catalog entries for this sector.' }));
    }
    function tabMosaic(box, dl) {
      const def = D.sources.mrms, native = def && def.nativeData !== false, exp = def && def.nativeData === false;
      box.append(srcRow({ name: 'MRMS 1 km reflectivity — native', sub: 'NOAA GRIB2 mosaic, color table available', status: native ? 'connected' : 'notconnected', selected: native && dl && dl.source === 'mrms', title: native ? '' : 'Not connected — needs the NOAA processing service', pick: () => pickSource('mrms') }));
      box.append(srcRow({ name: 'NOAA MRMS · Northeast preview', sub: 'NWS server-rendered image, not source-native; colors fixed by NOAA', status: exp ? 'experimental' : 'notconnected', selected: exp && dl && dl.source === 'mrms', pick: () => pickSource('mrms') }));
      box.append(h('div', { className: 'dm-note', text: exp ? 'The Northeast preview is an experimental browser test. Check timestamps and map position before using it on air.' : 'Radar mosaic feeds are not connected.' }));
    }
    function tabSite(box, dl) {
      const def = D.sources.nexrad, planned = D.planned.find(x => x.id === 'nexrad') || {}, sites = (def && def.sites && def.sites.length ? def.sites : planned.sites) || [], site = (dl && dl.source === 'nexrad' && dl.site) || (WXRS() && WXRS().selected) || (def && def.defaultSite) || planned.defaultSite || 'KBOX', conn = def ? 'connected' : 'notconnected';
      const f = h('input', { type: 'text', placeholder: 'Filter stations (KBOX, Boston…)', value: ui.filter, className: 'dm-filter' }), list = h('select', { className: 'dm-sites', size: 6, title: 'NEXRAD station' });
      const fill = () => { list.textContent = ''; const q = ui.filter.trim().toUpperCase(); sites.filter(x => !q || String(x.id + ' ' + (x.label || '')).toUpperCase().includes(q)).slice(0, 400).forEach(x => list.append(h('option', { value: x.id, text: x.label || x.id, selected: x.id === site }))); };
      f.addEventListener('input', () => { ui.filter = f.value; fill(); }); fill();
      list.addEventListener('change', () => { const id = list.value, RS = WXRS(); if (def) pickSource('nexrad', { site: id }); else if (RS && RS.select) { RS.select(id); build(); renderMenu(); } else { const sc = cur(); sc.dataLoop = Object.assign(D.defaults(), sc.dataLoop || {}, { source: 'nexrad', site: id, on: false }); save(); build(); renderMenu(); } });
      box.append(h('div', { className: 'dm-note', text: 'Station: ' + site + (conn === 'notconnected' ? ' — choose a site now; radar frames are Not connected yet.' : '') }), f, list);
      const dots = document.getElementById('wxradar-pick-btn');
      box.append(h('div', { className: 'dm-chips' }, h('button', { className: 'dm-chip', text: dots && dots.getAttribute && dots.getAttribute('aria-pressed') === 'true' ? 'Hide station dots on map' : 'Show station dots on map', title: 'Click a dot on the map to choose a radar', on: { click: () => { if (dots) dots.click(); setTimeout(renderMenu, 30); } } })));
      box.append(srcRow({ name: 'Base reflectivity · Level II', sub: 'native polar gates, color table available', status: conn, selected: !!def && dl && dl.source === 'nexrad', title: def ? '' : 'Not connected', pick: () => pickSource('nexrad', { site }) }));
      box.append(srcRow({ name: 'Radial velocity · Level II', sub: 'not offered by the data service yet', status: 'notconnected', pick: () => 0 }));
    }
    function tabPending(box, id) {
      const C = WSRC(), p = C && C.pending && C.pending.find(x => x.id === id);
      box.append(srcRow({ name: id === 'rtma' ? 'RTMA analysis' : 'Model forecast fields', sub: p ? p.note : 'Not available yet', status: 'notconnected', pick: () => 0 }));
      box.append(h('div', { className: 'dm-note', text: id === 'rtma' ? 'Waiting for you to choose the RTMA variables (for example temperature). Nothing is pre-selected.' : 'Waiting for you to choose the models and fields. Nothing is pre-selected.' }));
    }
    function tabDemo(box, dl) {
      box.append(h('div', { className: 'dm-note', text: 'Synthetic test patterns for trying the bar, palettes and export. They are not weather data.' }));
      ['demo', 'demo-ir', 'demo-rgb'].forEach(id => { const d = D.sources[id]; if (d) box.append(srcRow({ name: d.label, sub: d.kind === 'rgb' ? 'RGB image, no color table' : d.kind === 'ir' ? 'recolorable infrared grid' : 'recolorable reflectivity grid', status: 'demo', selected: dl && dl.source === id, pick: () => pickSource(id) })); });
    }
    const WXRS = () => g.WXWeatherRadarSites;

    function strip(id, w) {
      const cv = document.createElement('canvas'); cv.width = w || 200; cv.height = 12; cv.className = 'dm-strip'; const L = D.paletteLut(id, cv.width);
      if (L) { const c = cv.getContext('2d'), im = c.createImageData(cv.width, 1); for (let i = 0; i < cv.width; i++) { im.data.set(L.lut.subarray(i * 4, i * 4 + 4), i * 4); } for (let y = 0; y < 12; y++) c.putImageData(im, 0, y); }
      return cv;
    }
    function paletteSection(box, dl) {
      box.append(h('div', { className: 'dm-h', text: 'Color palette' + (dl ? ' · ' + D.displayName(dl.source, dl) : '') }));
      if (!dl || !dl.on) { box.append(h('div', { className: 'dm-note', text: 'Choose a weather source to see its palettes.' })); return; }
      const pr = D.productOf(dl.source), P = WP();
      if (!pr.palette || !P) { box.append(h('div', { className: 'dm-note rgb', text: 'This source is already a finished image (' + (pr.display || 'RGB / server-rendered') + '), so no color table applies.' })); return; }
      const cur0 = palIdOf(dl), choices = D.paletteChoices(dl.source), sc = cur();
      choices.forEach(p => box.append(h('button', { className: 'dm-pal' + (p.id === cur0 ? ' on' : ''), on: { click: () => { D.setPalette(sc, p.id === pr.palette ? null : p.id); save(); renderMenu(); } } },
        strip(p.id, 200), h('span', { className: 'dm-pm' }, h('b', { text: p.name }), h('i', { text: p.stops[0][0] + ' → ' + p.stops[p.stops.length - 1][0] + ' ' + (p.units || '') + (P.builtins[p.id] ? '' : ' · mine') })))));
      const cur1 = P.get(cur0); if (cur1 && cur1.note) box.append(h('div', { className: 'dm-note', text: cur1.note }));
      const ap = D.paletteApplies(sc);
      box.append(h('div', { className: 'dm-note ' + ap, text: ap === 'live' ? 'Frames here are recolored instantly when you pick a palette.' : 'Your choice is saved with the scene. Frames from the NOAA service arrive already colored, so they only change once that service applies the palette.' }));
      if (g.WXWeatherPaletteCloud) box.append(h('div', { className: 'dm-chips' }, h('button', { className: 'dm-chip', text: 'Load my saved palettes', on: { click: async () => { ui.cloudMsg = 'Loading…'; renderMenu(); try { const rows = await g.WXWeatherPaletteCloud.list((P.get(pr.palette) || {}).category); let n = 0; rows.forEach(r => { try { P.add({ id: 'my/' + r.category + '/' + String(r.id).toLowerCase(), category: r.category, name: r.name, productIds: [r.product_id], units: r.units || '', continuous: false, stops: r.stops }); n++; } catch (e) { /* skip invalid */ } }); ui.cloudMsg = n + ' saved palette' + (n === 1 ? '' : 's') + ' loaded'; } catch (e) { ui.cloudMsg = String(e.message || e); } renderMenu(); } } })));
      if (ui.cloudMsg) box.append(h('div', { className: 'dm-note', text: ui.cloudMsg }));
    }
    function renderMenu() {
      if (!menu) { menu = h('div', { id: 'dlMenu', role: 'dialog', 'aria-label': 'Weather data' }); menu.hidden = true; stage.appendChild(menu); for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'touchstart']) menu.addEventListener(ev, e => e.stopPropagation()); menu.addEventListener('keydown', e => { if (e.key === 'Escape') { ui.open = false; renderMenu(); } }); }
      menu.hidden = !ui.open; if (!ui.open) return;
      const sc = cur(), dl = sc && sc.dataLoop && sc.dataLoop.on ? sc.dataLoop : null; menu.textContent = '';
      menu.append(h('div', { className: 'dm-head' }, h('b', { text: 'Weather Data' }), h('button', { className: 'dm-x', text: '×', title: 'Close', on: { click: () => { ui.open = false; renderMenu(); } } })));
      const tabs = D.CATEGORIES.concat([{ id: 'demo', label: 'Demo' }]);
      menu.append(h('div', { className: 'dm-tabs' }, tabs.map(t => h('button', { className: 'dm-tab' + (ui.tab === t.id ? ' on' : ''), text: t.label, on: { click: () => { ui.tab = t.id; renderMenu(); } } }))));
      const box = h('div', { className: 'dm-body' });
      ({ satellite: tabSatellite, 'radar-mosaic': tabMosaic, 'radar-site': tabSite, demo: tabDemo, rtma: b => tabPending(b, 'rtma'), forecast: b => tabPending(b, 'forecast') }[ui.tab] || tabSatellite)(box, dl);
      menu.append(box); const pb = h('div', { className: 'dm-body pal' }); paletteSection(pb, dl); menu.append(pb);
      if (ui.wantPalette && pb.scrollIntoView) { ui.wantPalette = false; try { pb.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
    }
    D.openMenu = (tab, pal) => { ui.open = true; if (tab) ui.tab = tab; ui.wantPalette = !!pal; renderMenu(); };
    D.closeMenu = () => { ui.open = false; renderMenu(); };
    if (typeof document.addEventListener === 'function') document.addEventListener('pointerdown', e => { if (ui.open && menu && !(menu.contains && menu.contains(e.target)) && !(bar.contains && bar.contains(e.target)) && !(e.target && e.target.closest && e.target.closest('#wxradar-picker'))) { ui.open = false; renderMenu(); } }, true);

    /* ---- the dock ---- */
    function build() {
      const sc = cur(), dl = sc && sc.dataLoop, on = !!(dl && dl.on), isMap = sc && sc.bg && sc.bg.type === 'mapbox';
      bar.textContent = ''; refs = {};
      bar.hidden = !isMap;
      if (!isMap) { if (ui.open) { ui.open = false; renderMenu(); } return; }
      if (!on) {
        bar.append(h('button', { className: 'loop-toggle', text: '▶ Enable weather data loop', title: 'Turn on weather data for this Mapbox scene', on: { click: () => { sc.dataLoop = Object.assign(D.defaults(), sc.dataLoop || {}, { on: true }); save(); build(); } } }));
        return;
      }
      const row = h('div', { className: 'dl-row' }), controls = h('div', { className: 'dl-ctrl' });
      const toggle = h('button', { className: 'loop-toggle', title: 'Turn weather data off for this scene', text: '●', on: { click: () => { dl.on = false; save(); build(); } } });
      refs.play = h('button', { className: 'pl', title: 'Play / pause loop (Space)', text: '▶' }); refs.play.onclick = togglePlay;
      refs.spd = h('span', { className: 'spd', text: (dl.speed || 10) + 'x', title: 'Loop speed, frames per second' });
      controls.append(toggle, h('button', { text: '−', title: 'Slower ( - )', on: { click: () => bumpSpeed(-1) } }), refs.play, h('button', { text: '+', title: 'Faster ( + )', on: { click: () => bumpSpeed(1) } }), refs.spd,
        h('button', { text: '‹', title: 'Previous frame (←)', on: { click: () => stepFrame(-1) } }), h('button', { text: '›', title: 'Next frame (→)', on: { click: () => stepFrame(1) } }));
      row.append(controls);
      const timeline = h('div', { className: 'dl-timeline' });
      refs.stamp = h('span', { className: 'dl-stamp', text: '' }); refs.fill = h('i'); refs.knob = h('b');
      refs.prog = h('div', { className: 'prog', title: 'Click or drag to scrub weather frames' }, refs.fill, refs.knob);
      let dn = false;
      const scrub = e => { const rt = rtOf(sc), n = ready(rt).length; if (!n) return; const r = refs.prog.getBoundingClientRect(); if (!r.width) return; rt.playing = false; dl.idx = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * (n - 1)); };
      refs.prog.addEventListener('pointerdown', e => { dn = true; refs.prog.setPointerCapture(e.pointerId); scrub(e); });
      refs.prog.addEventListener('pointermove', e => { if (dn) scrub(e); });
      refs.prog.addEventListener('pointerup', () => { dn = false; save(); });
      refs.prog.addEventListener('pointercancel', () => { dn = false; });
      timeline.append(refs.stamp, refs.prog); row.append(timeline);
      const options = h('div', { className: 'dl-options' });
      const mode = h('span', { className: 'dl-live', text: 'LIVE', title: 'Live data only for now (archive comes later)' });
      const src = srcInfo(dl.source), stt = D.classify(dl.source);
      const len = h('select', { className: 'dl-len', title: 'Loop history length' }, (src.lengths || [1, 2, 4]).map(x => h('option', { value: x, text: lenLabel(x), selected: +dl.hours === x })));
      len.onchange = () => { dl.hours = +len.value; save(); };
      const sel = h('button', { className: 'dl-source', title: D.displayName(dl.source, dl) + ' · ' + D.STATUS_TEXT[stt.status] + ' — click to change (satellite, radar mosaic, single-site NEXRAD, RTMA, forecast)', 'aria-haspopup': 'dialog', on: { click: () => { if (ui.open) D.closeMenu(); else D.openMenu(tabOfSource(dl.source)); } } },
        h('span', { className: 'dl-srcname', text: D.displayName(dl.source, dl) + ' ▾' }), h('span', { className: 'pill ' + stt.status, text: D.STATUS_TEXT[stt.status] }));
      options.append(mode, len, sel);
      if (D.productOf(dl.source).palette) options.append(h('button', { className: 'dl-palbtn', title: 'Color palette', 'aria-label': 'Color palette', on: { click: () => D.openMenu(tabOfSource(dl.source), true) } }, h('span', { className: 'sw' })));
      const settings = h('div', { className: 'dl-settings', hidden: true });
      const op = h('input', { type: 'range', min: .1, max: 1, step: .05, value: dl.opacity == null ? .85 : dl.opacity });
      op.oninput = () => { dl.opacity = +op.value; }; op.onchange = save;
      const show = h('input', { type: 'checkbox', checked: dl.showBar !== false });
      show.onchange = () => { dl.showBar = show.checked; save(); };
      const hold = h('select', { title: 'Pause on the newest frame before the loop restarts' }, [[0, 'No pause'], [0.5, '0.5 s'], [1, '1 s'], [2, '2 s'], [3, '3 s']].map(([v, l]) => h('option', { value: v, text: l, selected: +(dl.dwell || 0) === v })));
      hold.onchange = () => { dl.dwell = +hold.value; save(); };
      refs.msg = h('span', { className: 'st' });
      settings.append(h('label', {}, 'Opacity', op), h('label', {}, 'Hold newest frame', hold), h('label', {}, show, 'Include bar in video'), refs.msg);
      const button = h('button', { text: '⚙', title: 'Opacity, loop hold and export bar settings', 'aria-label': 'Loop settings', on: { click: () => { settings.hidden = !settings.hidden; } } });
      options.append(button); row.append(options); bar.append(row, settings);
    }
    bar.addEventListener('keydown', e => {
      const dl = dlRaw(), tg = e.target && e.target.tagName; if (!dl || !dl.on || tg === 'SELECT' || tg === 'INPUT') return;
      const k = e.key, hit = k === 'ArrowLeft' ? () => stepFrame(-1) : k === 'ArrowRight' ? () => stepFrame(1) : k === ' ' ? togglePlay : (k === '+' || k === '=') ? () => bumpSpeed(1) : (k === '-' || k === '_') ? () => bumpSpeed(-1) : null;
      if (hit) { e.preventDefault(); hit(); }
    });

    function tick(ts) {
      try {
        const sc = cur(), dl = dlRaw(), sig = sc ? (dl && dl.on ? [dl.source, dl.hours, dl.site].join('|') : 'off') + '|' + (sc.bg && sc.bg.type) : '';
        if (sc !== lastScene || sig !== lastSig || !refs) { lastScene = sc; lastSig = sig; if (sc) { build(); if (ui.open) renderMenu(); } }
        const on = !!(dl && dl.on);
        if (on) {
          D.ensure(sc); const rt = rtOf(sc), fr = ready(rt), dt = Math.min(0.25, (ts - lastT) / 1000), speed = dl.speed || 10;
          if (rt.playing && fr.length && WX.S.mode === 'edit') { const hold = clamp(+dl.dwell || 0, 0, 5) * speed; dl.idx = ((dl.idx || 0) + dt * speed) % (fr.length + hold); }
          if (WX.S.mode === 'edit') rt.lastIdx = fr.length ? D.curIdx(sc, 0, true) : 0;
          if (refs && refs.prog) {
            const L = D.barLabels(sc); let text = L.stamp, warn = false;
            if (!text) { warn = true; text = rt.status === 'loading' ? 'Loading ' + rt.loaded + ' / ' + rt.total + ' frames…' : rt.status === 'nosrc' ? 'Not connected — ' + D.displayName(dl.source, dl) : rt.status === 'empty' ? 'No frames available' : rt.status === 'error' ? (rt.msg || 'Weather data error') : ''; }
            if (refs.stamp.textContent !== text) refs.stamp.textContent = text; refs.stamp.className = 'dl-stamp' + (warn && text ? (rt.status === 'loading' ? ' load' : ' warn') : '');
            refs.spd.textContent = speed + 'x';
            refs.fill.style.width = Math.round(L.loadedFrac * 100) + '%'; refs.knob.style.left = Math.round(L.pos * 100) + '%'; refs.knob.style.display = fr.length ? '' : 'none'; refs.play.textContent = rt.playing ? '❚❚' : '▶';
            const cf = fr[clamp(rt.lastIdx, 0, Math.max(0, fr.length - 1))];
            refs.prog.title = fr.length ? 'Frame ' + (Math.floor(rt.lastIdx) + 1) + ' of ' + fr.length + (cf && cf.t ? ' · observed ' + ageText(cf.t) : '') + ' — click or drag to scrub' : 'Click or drag to scrub weather frames';
            refs.msg.textContent = rt.status === 'loading' ? 'Loading ' + rt.loaded + ' / ' + rt.total + ' frames…' : (rt.msg || (fr.length + ' frames · Live'));
          }
        }
      } catch (e) { /* never break the editor */ }
      lastT = ts; requestAnimationFrame(tick);
    }
    D.onSources = () => { lastSig = ''; if (ui.open) renderMenu(); };
    // Render the single dock immediately when the editor appears; the
    // animation tick then updates frame timestamps and progress.
    build();
    requestAnimationFrame(tick); return true;
  }
  function boot() { if (!mountBar()) setTimeout(boot, 300); }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(boot, 50)); else setTimeout(boot, 50); }
})(typeof window !== 'undefined' ? window : globalThis);
