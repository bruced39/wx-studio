/* WX Studio – Mapbox background.
 * A hidden Mapbox GL JS map (1920x1080 output pixels) is rendered for each camera position and copied into a
 * canvas that the studio draws as the scene background. A second, style-less "projector" map converts between
 * longitude/latitude and screen pixels so pinned drawings (fronts, arrows, H/L...) follow the map.
 * Camera = { c:[lng,lat], z:zoom, b:bearing, p:pitch }.  Styles keep Mapbox's own zoom rules, so cities, towns,
 * roads and road shields pop in and out exactly as they do on mapbox.com.                                   */
(function (g) {
  'use strict';
  const W = 1920, H = 1080, VER = 'v3.9.0';
  const MB = { W, H, status: 'idle', err: '', scale: 1.5, last: null, onUpdate: null, cache: new Map() };
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;

  MB.token = () => String(g.WX_MAPBOX_TOKEN || ls.get('wx.mapbox.token') || '').trim();
  MB.hasToken = () => /^pk\./.test(MB.token());
  MB.scale = num(+ls.get('wx.mapbox.scale'), 1.5) || 1.5;
  MB.STYLES = [['streets-v12', 'Streets (default)'], ['outdoors-v12', 'Outdoors'], ['light-v11', 'Light'], ['dark-v11', 'Dark'], ['satellite-streets-v12', 'Satellite + streets'], ['navigation-day-v1', 'Navigation (road signs)']];
  MB.PROJ = [['mercator', 'Mercator (flat)'], ['globe', 'Globe']];
  const R = {
    conus: ['Continental US', { c: [-96.5, 38.6], z: 3.3 }], northeast: ['Northeast', { c: [-74.5, 43.0], z: 5.0 }], newengland: ['New England', { c: [-71.6, 43.3], z: 5.7 }],
    eastma: ['Eastern Mass.', { c: [-71.15, 42.45], z: 8.3 }], boston: ['Boston area', { c: [-71.06, 42.37], z: 10.6 }], tropical: ['Atlantic basin', { c: [-60, 25], z: 2.7 }], world: ['World', { c: [-40, 28], z: 1.3 }]
  };
  MB.regionList = Object.keys(R).map(k => [k, R[k][0]]);
  MB.regionCam = key => Object.assign({ b: 0, p: 0 }, (R[key] || R.newengland)[1], { c: (R[key] || R.newengland)[1].c.slice() });
  const styleOf = bg => (bg && bg.mbStyle) || 'streets-v12', projOf = bg => (bg && bg.proj === 'globe') ? 'globe' : 'mercator';
  const norm = cam => ({ c: [num(cam.c[0], 0), clampLat(num(cam.c[1], 0))], z: Math.max(0, Math.min(22, num(cam.z, 3))), b: num(cam.b, 0), p: Math.max(0, Math.min(75, num(cam.p, 0))) });
  const clampLat = v => Math.max(-85, Math.min(85, v));
  const keyOf = (bg, cam) => { const k = norm(cam); return [styleOf(bg), projOf(bg), MB.scale, k.c[0].toFixed(5), k.c[1].toFixed(5), k.z.toFixed(3), k.b.toFixed(2), k.p.toFixed(1)].join('|'); };
  MB.keyOf = keyOf;

  /* ---- library + maps ---- */
  let D = null, P = null, host = null, initP = null, curStyle = null, curProj = null, pProj = null, pKey = null;
  function loadLib() {
    if (g.mapboxgl) return Promise.resolve();
    return new Promise((res, rej) => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `https://api.mapbox.com/mapbox-gl-js/${VER}/mapbox-gl.css`; document.head.appendChild(l);
      const s = document.createElement('script'); s.src = `https://api.mapbox.com/mapbox-gl-js/${VER}/mapbox-gl.js`; s.onload = res; s.onerror = () => rej(new Error('Could not load Mapbox GL JS (needs internet)')); document.head.appendChild(s);
    });
  }
  const once = (m, ev) => new Promise(res => m.once(ev, res));
  MB.init = function () {
    if (initP) return initP;
    initP = (async () => {
      MB.status = 'loading'; MB.err = '';
      try {
        if (!MB.hasToken()) throw new Error('Add your Mapbox public token (starts with pk.) in Scene → Mapbox settings');
        await loadLib(); g.mapboxgl.accessToken = MB.token();
        try { Object.defineProperty(g, 'devicePixelRatio', { configurable: true, get: () => MB.scale }); } catch (e) { /* ignore */ }
        const cw = Math.round(W / MB.scale), ch = Math.round(H / MB.scale);
        host = document.createElement('div'); host.style.cssText = `position:fixed;left:-30000px;top:0;width:${cw}px;height:${ch}px;pointer-events:none;`;
        const de = document.createElement('div'), pe = document.createElement('div'); for (const e of [de, pe]) { e.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px`; host.appendChild(e); } document.body.appendChild(host);
        const c0 = MB.regionCam('newengland');
        D = new g.mapboxgl.Map({ container: de, style: 'mapbox://styles/mapbox/streets-v12', center: c0.c, zoom: c0.z, interactive: false, attributionControl: false, preserveDrawingBuffer: true, fadeDuration: 0, antialias: true, trackResize: false, projection: 'mercator' });
        P = new g.mapboxgl.Map({ container: pe, style: { version: 8, sources: {}, layers: [] }, center: c0.c, zoom: c0.z, interactive: false, attributionControl: false, trackResize: false, projection: 'mercator' });
        D.on('error', e => { const m = e && e.error && e.error.message; if (m && /401|403|token|Unauthorized/i.test(m)) { MB.err = 'Mapbox rejected the token (' + m + ')'; MB.status = 'error'; } });
        await Promise.all([once(D, 'load'), once(P, 'load')]);
        curStyle = 'streets-v12'; curProj = 'mercator'; pProj = 'mercator'; MB.status = 'ready';
      } catch (e) { MB.status = 'error'; MB.err = e.message || String(e); initP = null; throw e; }
    })();
    return initP;
  };
  MB.reset = function () { try { if (D) D.remove(); if (P) P.remove(); if (host) host.remove(); } catch (e) { /* ignore */ } D = P = host = initP = null; curStyle = curProj = pProj = pKey = null; MB.cache.clear(); MB.last = null; MB.status = 'idle'; MB.err = ''; MB.queue = Promise.resolve(); };
  MB.setToken = function (t) { ls.set('wx.mapbox.token', String(t || '').trim()); MB.reset(); };
  MB.setScale = function (s) { MB.scale = s; ls.set('wx.mapbox.scale', String(s)); MB.reset(); };

  function fog(proj) { if (proj === 'globe') { try { D.setFog({ color: 'rgb(186,210,235)', 'high-color': 'rgb(36,92,223)', 'horizon-blend': 0.03, 'space-color': 'rgb(6,10,24)', 'star-intensity': 0.35 }); } catch (e) { /* ignore */ } } else { try { D.setFog(null); } catch (e) { /* ignore */ } } }
  async function setup(bg) {
    const st = styleOf(bg), pr = projOf(bg);
    if (st !== curStyle) { D.setStyle('mapbox://styles/mapbox/' + st); await once(D, 'style.load'); curStyle = st; curProj = null; }
    if (pr !== curProj) { D.setProjection(pr); fog(pr); curProj = pr; }
  }
  function settle(m) {
    return new Promise(res => {
      let ok = 0; const t0 = performance.now();
      const step = () => {
        if (performance.now() - t0 > 20000) return res();
        m.triggerRepaint();
        m.once('render', () => { let done = false; try { done = m.loaded() && !m.isMoving(); } catch (e) { done = true; } if (done) { ok++; if (ok >= 2) return res(); } else ok = 0; setTimeout(step, 16); });
      };
      step();
    });
  }
  MB.queue = Promise.resolve();
  async function doSnap(bg, cam, key) {
    await MB.init(); if (MB.cache.has(key)) return MB.cache.get(key);
    await setup(bg); const k = norm(cam);
    D.jumpTo({ center: k.c, zoom: k.z, bearing: k.b, pitch: k.p }); await settle(D);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').drawImage(D.getCanvas(), 0, 0, W, H);
    MB.cache.set(key, cv); if (MB.cache.size > 14) MB.cache.delete(MB.cache.keys().next().value); MB.last = cv; return cv;
  }
  MB.snap = function (bg, cam) { const key = keyOf(bg, cam), b = { mbStyle: bg.mbStyle, proj: bg.proj }; if (MB.cache.has(key)) return Promise.resolve(MB.cache.get(key)); const p = MB.queue.then(() => doSnap(b, cam, key)); MB.queue = p.catch(() => { }); return p; };
  /* synchronous accessor for the live preview: returns the right frame if cached, else asks for it and returns the last one */
  let busy = false, want = null;
  function pump() {
    if (busy || !want) return; busy = true; const w = want; want = null;
    MB.snap(w.bg, w.cam).catch(() => { }).then(() => { busy = false; if (MB.onUpdate) MB.onUpdate(); pump(); });
  }
  MB.frame = function (bg, cam) {
    if (!MB.hasToken()) return null; const key = keyOf(bg, cam), c = MB.cache.get(key); if (c) return c;
    want = { bg: { mbStyle: bg.mbStyle, proj: bg.proj }, cam: norm(cam) }; pump(); return MB.last;
  };

  /* ---- lng/lat <-> 1920x1080 screen pixels ---- */
  MB.xf = function (bg, cam) {
    if (!P || MB.status !== 'ready') return null;
    const s = MB.scale, k = norm(cam), pr = projOf(bg), key = pr + '|' + k.c[0] + '|' + k.c[1] + '|' + k.z + '|' + k.b + '|' + k.p;
    const sync = () => { if (pKey === key) return; if (pProj !== pr) { P.setProjection(pr); pProj = pr; } P.jumpTo({ center: k.c, zoom: k.z, bearing: k.b, pitch: k.p }); pKey = key; };
    return {
      fwd: (x, y) => { sync(); const q = P.project([x, y]); return [q.x * s, q.y * s]; },
      inv: (x, y) => { sync(); const l = P.unproject([x / s, y / s]); return [l.lng, l.lat]; }
    };
  };
  g.MB = MB;
})(typeof window !== 'undefined' ? window : globalThis);
