/* WX Studio – engine: show model, scene rendering, transitions, object animation, hit-testing.
 * Everything is drawn on a fixed 1920x1080 canvas as a pure function of show time T, so playback in the
 * browser and frame-by-frame video export use exactly the same code path.                               */
(function (g) {
  'use strict';
  const W = 1920, H = 1080, TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const E = { W, H };
  const FONT = () => (g.Sym && g.Sym.FONT) || 'Arial, sans-serif';
  const SANS = '"Barlow","Segoe UI",Arial,sans-serif';
  let uid = 1; const nid = p => (p || 'o') + (Date.now().toString(36)) + (uid++).toString(36);

  /* ---------- easing ---------- */
  const ease = { out: p => 1 - Math.pow(1 - p, 3), inout: p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2, back: p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); } };
  E.ease = ease;

  /* ---------- model ---------- */
  E.GRADS = { sky: ['#0e2f5e', '#2a73c2'], clear: ['#1d6fd6', '#8fd0ff'], dusk: ['#1b1a4a', '#d9694a'], storm: ['#171f2b', '#4b5566'], night: ['#050b1a', '#17294d'], sunrise: ['#2a3b7a', '#ffb36b'], graphite: ['#12161c', '#2b323c'] };
  E.TRANSITIONS = [['cut', 'Cut'], ['dissolve', 'Dissolve'], ['fade-black', 'Fade through black'], ['swipe', 'Broadcast swipe'], ['wipe-right', 'Wipe →'], ['wipe-left', 'Wipe ←'], ['wipe-up', 'Wipe ↑'], ['push-left', 'Push ←'], ['push-right', 'Push →'], ['zoom', 'Zoom through'], ['iris', 'Iris']];
  E.ANIMS = [['none', 'None (appear)'], ['fade', 'Fade in'], ['pop', 'Pop in'], ['slide-up', 'Slide up'], ['slide-left', 'Slide from right'], ['in-left', 'Slide in from left edge'], ['in-right', 'Slide in from right edge'], ['in-top', 'Slide in from top edge'], ['in-bottom', 'Slide in from bottom edge'], ['zoom', 'Zoom in'], ['draw', 'Draw on (lines / fronts / H-L)']];

  E.newScene = function (o) {
    o = o || {};
    return {
      id: nid('s'), name: o.name || 'Scene', duration: o.duration || 6, transition: o.transition || { type: 'dissolve', dur: 0.8 },
      bg: Object.assign({ type: 'mapbox', mbStyle: 'broadcast', proj: 'mercator', theme: 'dark', region: 'eastma', view: null, view2: null, grad: 'sky', color: '#101820', asset: null, dim: 0, kenburns: false }, o.bg || {}),
      title: Object.assign({ show: true, text: '', sub: '', pos: 'top-left' }, o.title || {}), objects: o.objects || []
    };
  };
  E.newShow = function () {
    const s = E.newScene({ name: 'Scene 1', title: { text: 'Weather Update', sub: 'Eastern Massachusetts' } });
    return { v: 1, name: 'My Weather Show', accent: '#2f9bff', bugText: '', logo: null, assets: {}, scenes: [s] };
  };
  const ANIM_DEFAULT = () => ({ in: 'fade', delay: 0, dur: 0.6 });
  E.newObject = function (type, props) {
    const base = { id: nid('o'), type, geo: false, anim: ANIM_DEFAULT() };
    const D = {
      text: { x: 960, y: 500, text: 'Text', size: 72, color: '#ffffff', weight: 800, align: 'center', box: false, boxColor: 'rgba(8,20,38,0.78)', font: 'display' },
      icon: { x: 960, y: 540, size: 220, icon: 'partly-cloudy' },
      hl: { x: 960, y: 540, size: 200, kind: 'H', value: '1030' },
      front: { pts: [], kind: 'cold', size: 28, flip: false },
      arrow: { pts: [], color: '#ffd23f', width: 12, style: 'flow', head: true },
      line: { pts: [], color: '#d7e8ff', width: 6, style: 'solid', closed: false, label: '' },
      pen: { pts: [], color: '#ffe14d', width: 8 },
      shape: { shape: 'rect', x: 700, y: 400, w: 500, h: 280, fill: 'rgba(255,255,255,0.15)', stroke: '#ffffff', lw: 4, radius: 18 },
      image: { x: 0, y: 0, w: 1920, h: 1080, asset: null, opacity: 1 },
      barb: { x: 960, y: 540, kt: 15, dir: 270, size: 90, color: '#ffffff' },
      pin: { x: 960, y: 540, label: 'Billerica', value: '54°', color: '#ffd23f' },
      storm: { x: 960, y: 540, size: 160, kind: 'H', label: '' },
      pop: { x: 960, y: 540, size: 44, value: '30%' },
      citytemp: { x: 960, y: 540, size: 40, name: 'Boston', value: '54°', colorByTemp: true },
      callout: { x: 960, y: 540, dx: 170, dy: -130, size: 36, label: 'Billerica', value: '54°', color: '#ffd23f' },
      legend: { x: 560, y: 940, w: 800, h: 46, kind: 'radar', title: '', left: 'LIGHT', right: 'HEAVY' },
      flow: { pts: [], color: '#3fa9ff', size: 46, spacing: 2.8, speed: 1, style: 'glossy' },
      jet: { pts: [], color: '#0b4fa8', width: 64, style: 'banded', speed: 1, arrowColor: '#ffffff', outline: true, fade: 0, flowText: 'arrows', words: 'JET STREAM' },
      ticker: { x: 0, y: 960, w: 1920, h: 76, text: 'WIND ADVISORY FOR EASTERN MASSACHUSETTS UNTIL 6 AM SATURDAY', label: 'ALERT', speed: 140, color: '#c01010' }
    };
    return Object.assign(base, JSON.parse(JSON.stringify(D[type] || {})), props || {});
  };

  /* ---------- assets / images ---------- */
  const imgCache = {};
  E.onAsset = null;
  E.img = function (show, id) {
    if (!id || !show.assets[id]) return null;
    let e = imgCache[id];
    if (!e) { e = imgCache[id] = { el: new Image(), ok: false }; e.el.onload = () => { e.ok = true; if (E.onAsset) E.onAsset(); }; e.el.src = show.assets[id]; }
    return e.ok ? e.el : null;
  };
  const blurCache = new WeakMap();
  /* ---------- video backgrounds (uploaded MP4/WebM, kept in this browser) ---------- */
  E.videos = {}; E.exporting = false;
  E.registerVideo = function (id, blob, name) {
    let v = E.videos[id]; if (v && v.blob === blob) return v;
    const el = document.createElement('video'); el.muted = true; el.defaultMuted = true; el.playsInline = true; el.preload = 'auto';
    v = E.videos[id] = { id, name: name || id, blob, el, ok: false, dur: 0, w: 0, h: 0 };
    el.onloadedmetadata = () => { v.ok = true; v.dur = el.duration || 0; v.w = el.videoWidth; v.h = el.videoHeight; if (E.onAsset) E.onAsset(); };
    el.src = URL.createObjectURL(blob); return v;
  };
  /* ---- animated GIF: decoded to frames in memory (works in every browser; deterministic for export) ---- */
  function gifLzw(minCode, data, npix) {
    const clear = 1 << minCode, eoi = clear + 1; let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1;
    const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), stack = new Uint8Array(4097), out = new Uint8Array(npix);
    for (let i = 0; i < clear; i++) suffix[i] = i;
    let op = 0, bits = 0, nb = 0, di = 0, old = -1, first = 0;
    while (op < npix) {
      while (nb < size && di < data.length) { bits |= data[di++] << nb; nb += 8; }
      if (nb < size) break;
      const code = bits & mask; bits >>= size; nb -= size;
      if (code === clear) { size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; old = -1; continue; }
      if (code === eoi) break;
      if (old === -1) { out[op++] = suffix[code]; old = code; first = suffix[code]; continue; }
      let sp = 0, c = code;
      if (code >= next) { stack[sp++] = first; c = old; }
      while (c >= clear) { stack[sp++] = suffix[c]; c = prefix[c]; }
      first = suffix[c]; stack[sp++] = first;
      if (next < 4096) { prefix[next] = old; suffix[next] = first; next++; if ((next & mask) === 0 && next < 4096) { size++; mask = (1 << size) - 1; } }
      old = code;
      while (sp > 0 && op < npix) out[op++] = stack[--sp];
    }
    return out;
  }
  function gifDecode(buf) {
    const d = new Uint8Array(buf); if (d[0] !== 0x47 || d[1] !== 0x49 || d[2] !== 0x46) throw new Error('Not a GIF file');
    let p = 6; const W = d[p] | d[p + 1] << 8, H = d[p + 2] | d[p + 3] << 8, fl = d[p + 4]; p += 7;
    let gct = null; if (fl & 0x80) { const n = 2 << (fl & 7); gct = d.subarray(p, p + n * 3); p += n * 3; }
    const start = p; let count = 0, q = start;           // pass 1: count frames to size the memory budget
    while (q < d.length) { const b = d[q++]; if (b === 0x3B) break; if (b === 0x21) { q++; let s; while ((s = d[q++])) q += s; } else if (b === 0x2C) { const pk = d[q + 8]; q += 9; if (pk & 0x80) q += (2 << (pk & 7)) * 3; q++; let s; while ((s = d[q++])) q += s; count++; } else break; }
    if (!count) throw new Error('No frames in GIF');
    const scale = Math.min(1, 1920 / W, Math.sqrt(260e6 / (4 * W * H * count))), sw = Math.max(1, Math.round(W * scale)), sh = Math.max(1, Math.round(H * scale));
    const comp = document.createElement('canvas'); comp.width = W; comp.height = H; const cx = comp.getContext('2d', { willReadFrequently: true });
    const tmp = document.createElement('canvas'), tx = tmp.getContext('2d'); const frames = [], delays = [];
    let gce = null, prevDisp = 0, prevRect = null, saved = null; p = start;
    while (p < d.length) {
      const b = d[p++]; if (b === 0x3B) break;
      if (b === 0x21) { const lab = d[p++]; if (lab === 0xF9) gce = { disp: (d[p + 1] >> 2) & 7, trans: (d[p + 1] & 1) ? d[p + 4] : -1, delay: (d[p + 2] | d[p + 3] << 8) * 10 }; let s; while ((s = d[p++])) p += s; }
      else if (b === 0x2C) {
        const fx = d[p] | d[p + 1] << 8, fy = d[p + 2] | d[p + 3] << 8, fw = d[p + 4] | d[p + 5] << 8, fh = d[p + 6] | d[p + 7] << 8, pk = d[p + 8]; p += 9;
        let ct = gct; if (pk & 0x80) { const n = 2 << (pk & 7); ct = d.subarray(p, p + n * 3); p += n * 3; }
        const minCode = d[p++], chunks = []; let tot = 0, s; while ((s = d[p++])) { chunks.push(d.subarray(p, p + s)); p += s; tot += s; }
        const data = new Uint8Array(tot); let o = 0; chunks.forEach(c => { data.set(c, o); o += c.length; });
        let idx = gifLzw(minCode, data, fw * fh);
        if (pk & 0x40) { const re = new Uint8Array(fw * fh); let r = 0; for (const [st, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = st; y < fh; y += step, r++) re.set(idx.subarray(r * fw, (r + 1) * fw), y * fw); idx = re; }
        if (prevDisp === 2 && prevRect) cx.clearRect(prevRect.x, prevRect.y, prevRect.w, prevRect.h); else if (prevDisp === 3 && saved) cx.putImageData(saved, 0, 0);
        if (gce && gce.disp === 3) saved = cx.getImageData(0, 0, W, H);
        const im = new ImageData(fw, fh), px = im.data, tr = gce ? gce.trans : -1;
        for (let i = 0; i < idx.length; i++) { const v = idx[i], j = i * 4; if (v === tr || !ct) { px[j + 3] = 0; continue; } px[j] = ct[v * 3]; px[j + 1] = ct[v * 3 + 1]; px[j + 2] = ct[v * 3 + 2]; px[j + 3] = 255; }
        tmp.width = fw; tmp.height = fh; tx.putImageData(im, 0, 0); cx.drawImage(tmp, fx, fy);
        const fc = document.createElement('canvas'); fc.width = sw; fc.height = sh; fc.getContext('2d').drawImage(comp, 0, 0, sw, sh);
        let dl = gce ? gce.delay : 100; if (dl < 20) dl = 100; frames.push(fc); delays.push(dl);
        prevDisp = gce ? gce.disp : 0; prevRect = { x: fx, y: fy, w: fw, h: fh }; gce = null;
      } else break;
    }
    return { w: sw, h: sh, frames, delays };
  }
  E.registerGif = function (id, blob, name) {
    let v = E.videos[id]; if (v && v.blob === blob) return v;
    v = E.videos[id] = { id, name: name || id, blob, gif: true, ok: false, dur: 0, w: 0, h: 0, frames: [], starts: [] };
    blob.arrayBuffer().then(buf => { const g2 = gifDecode(buf); let t = 0; v.starts = g2.delays.map(dl => { const s = t; t += dl; return s; }); v.frames = g2.frames; v.dur = t / 1000; v.w = g2.w; v.h = g2.h; v.ok = true; if (E.onAsset) E.onAsset(); }).catch(err => { v.err = String(err && err.message || err); if (E.onAsset) E.onAsset(); });
    return v;
  };
  const gifFrame = (v, tt) => { tt = tt * 1000 + 0.5; let lo = 0, hi = v.starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (v.starts[m] <= tt) lo = m; else hi = m - 1; } return v.frames[lo]; };
  E.vid = id => (id && E.videos[id] && E.videos[id].ok && E.videos[id].w) ? E.videos[id] : null;
  const vidTime = (b, v, t) => { const d = Math.max(0.1, v.dur), s = clamp(+b.vidStart || 0, 0, d), x = s + Math.max(0, t); return b.vidLoop ? x % d : Math.min(x, d - 0.04); };
  E.seekVideo = function (b, t) {
    const v = E.vid(b.vid); if (!v || v.gif) return Promise.resolve(); const tt = vidTime(b, v, t), el = v.el;
    return new Promise(res => { let fin = false; const done = () => { if (fin) return; fin = true; el.removeEventListener('seeked', done); res(); }; el.addEventListener('seeked', done); if (!el.paused) el.pause(); el.currentTime = tt; setTimeout(done, 1500); });
  };
  function syncVideo(b, v, t, opts) {
    if ((opts && opts.thumb) || E.exporting) return;
    const el = v.el, tt = vidTime(b, v, t), atEnd = !b.vidLoop && tt >= v.dur - 0.05;
    if (opts && opts.editing) { if (!el.paused) el.pause(); if (!el.seeking && Math.abs(el.currentTime - tt) > 0.04) el.currentTime = tt; }
    else if (atEnd) { if (!el.paused) el.pause(); if (!el.seeking && Math.abs(el.currentTime - tt) > 0.1) el.currentTime = tt; }
    else if (el.paused) { el.currentTime = tt; el.play().catch(() => { /* needs a user gesture */ }); }
    else if (Math.abs(el.currentTime - tt) > 0.35) el.currentTime = tt;
  }
  let vsm = null;
  function drawVideoFit(c, el, iw, ih, b) {
    const fit = b.fit || 'blur';
    if (fit === 'stretch') c.drawImage(el, 0, 0, W, H);
    else if (fit === 'solid') { c.fillStyle = b.fitColor || '#0a1a3a'; c.fillRect(0, 0, W, H); const s = Math.min(W / iw, H / ih); c.drawImage(el, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s); }
    else if (fit === 'blur') {
      if (!vsm) vsm = document.createElement('canvas'); vsm.width = 64; vsm.height = Math.max(8, Math.round(64 * ih / iw)); const sx = vsm.getContext('2d'); sx.imageSmoothingQuality = 'high'; sx.drawImage(el, 0, 0, vsm.width, vsm.height);
      const cs = Math.max(W / vsm.width, H / vsm.height) * 1.08; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(vsm, (W - vsm.width * cs) / 2, (H - vsm.height * cs) / 2, vsm.width * cs, vsm.height * cs);
      c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(0, 0, W, H); const s = Math.min(W / iw, H / ih); c.drawImage(el, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    } else { const s = Math.max(W / iw, H / ih); c.drawImage(el, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s); }
  }
  E.preload = function (show) {
    const ids = Object.keys(show.assets || {});
    return Promise.all(ids.map(id => new Promise(res => { E.img(show, id); const e = imgCache[id]; if (!e) return res(); if (e.ok) return res(); e.el.onload = () => { e.ok = true; res(); }; e.el.onerror = () => res(); })));
  };

  /* ---------- map camera + geo transform ---------- */
  E.viewAt = function (scene, t) {
    const b = scene.bg, M = g.WDMap;
    if (b.type === 'mapbox') {
      const a = b.view || g.MB.regionCam(b.region); if (!b.view2 || !b.camDur) return a;
      const p = ease.inout(clamp((t - (b.camDelay || 0)) / b.camDur, 0, 1)), z = b.view2, L = (x, y) => x + (y - x) * p;
      return { c: [L(a.c[0], z.c[0]), L(a.c[1], z.c[1])], z: L(a.z, z.z), b: L(a.b || 0, z.b || 0), p: L(a.p || 0, z.p || 0) };
    }
    const v1 = b.view || (M ? M.regionView(b.region) : { cx: 487, cy: 305, w: 975 });
    if (!b.view2 || !b.camDur) return v1;
    const p = ease.inout(clamp((t - (b.camDelay || 0)) / b.camDur, 0, 1));
    const lw = Math.log(v1.w) + (Math.log(b.view2.w) - Math.log(v1.w)) * p;
    return { cx: v1.cx + (b.view2.cx - v1.cx) * p, cy: v1.cy + (b.view2.cy - v1.cy) * p, w: Math.exp(lw) };
  };
  E.xf = function (scene, t) {
    if (scene.bg.type === 'mapbox') {
      const v = E.viewAt(scene, t), m = g.MB.xf(scene.bg, v), off = () => [-1e5, -1e5];
      return { k: 1, map: true, mb: true, v, kOf: o => Math.pow(2, v.z - (o.z0 != null ? o.z0 : v.z)), fwd: m ? m.fwd : off, inv: m ? m.inv : off };
    }
    if (scene.bg.type !== 'map') return { k: 1, fwd: (x, y) => [x, y], inv: (x, y) => [x, y], map: false };
    const v = E.viewAt(scene, t), k = W / v.w;
    return { k, map: true, v, fwd: (x, y) => [W / 2 + (x - v.cx) * k, H / 2 + (y - v.cy) * k], inv: (x, y) => [(x - W / 2) / k + v.cx, (y - H / 2) / k + v.cy] };
  };
  const GEO_SCALED = { shape: 1, image: 1 };
  const GEO_SIZE = { flow: 'size', jet: 'width' };          // pts-only objects whose arrow size / band width zoom with a pinned map
  function toScreen(o, xf) {
    if (!o.geo || !xf.map) return o;
    const s = Object.assign({}, o);
    if (o.pts) s.pts = o.pts.map(p => xf.fwd(p[0], p[1]));
    if (o.x != null && o.y != null) { const p = xf.fwd(o.x, o.y), kk = xf.kOf ? xf.kOf(o) : xf.k; s.x = p[0]; s.y = p[1]; if (GEO_SCALED[o.type]) { s.w = o.w * kk; s.h = o.h * kk; } }
    if (GEO_SIZE[o.type] && o[GEO_SIZE[o.type]] != null && (xf.kOf ? o.z0 != null : true)) s[GEO_SIZE[o.type]] = o[GEO_SIZE[o.type]] * (xf.kOf ? xf.kOf(o) : xf.k);
    return s;
  }
  E.toScreen = toScreen;
  /* convert an object between screen space and map space (for the "pin to map" toggle) */
  E.setGeo = function (o, scene, t, on) {
    const xf = E.xf(scene, t); if (!xf.map || !!o.geo === !!on) { o.geo = !!on && xf.map; return; }
    if (xf.mb) {
      if (on) { if (o.pts) o.pts = o.pts.map(p => xf.inv(p[0], p[1])); if (o.x != null) { const p = xf.inv(o.x, o.y); o.x = p[0]; o.y = p[1]; o.z0 = xf.v.z; } else if (GEO_SIZE[o.type]) o.z0 = xf.v.z; }
      else { const kk = xf.kOf(o); if (GEO_SIZE[o.type] && o.z0 != null && o[GEO_SIZE[o.type]] != null) o[GEO_SIZE[o.type]] *= kk; if (o.pts) o.pts = o.pts.map(p => xf.fwd(p[0], p[1])); if (o.x != null) { const p = xf.fwd(o.x, o.y); o.x = p[0]; o.y = p[1]; if (GEO_SCALED[o.type]) { o.w *= kk; o.h *= kk; } } delete o.z0; }
      o.geo = !!on; return;
    }
    if (GEO_SIZE[o.type] && o[GEO_SIZE[o.type]] != null) o[GEO_SIZE[o.type]] = on ? o[GEO_SIZE[o.type]] / xf.k : o[GEO_SIZE[o.type]] * xf.k;
    if (on) { // screen -> map
      if (o.pts) o.pts = o.pts.map(p => xf.inv(p[0], p[1]));
      if (o.x != null) { const p = xf.inv(o.x, o.y); o.x = p[0]; o.y = p[1]; if (GEO_SCALED[o.type]) { o.w /= xf.k; o.h /= xf.k; } }
    } else {
      if (o.pts) o.pts = o.pts.map(p => xf.fwd(p[0], p[1]));
      if (o.x != null) { const p = xf.fwd(o.x, o.y); o.x = p[0]; o.y = p[1]; if (GEO_SCALED[o.type]) { o.w *= xf.k; o.h *= xf.k; } }
    }
    o.geo = !!on;
  };

  /* ---------- measurement / bounds (screen space) ---------- */
  const mctx = (typeof document !== 'undefined') ? document.createElement('canvas').getContext('2d') : null;
  function fontFor(o) { return `${o.weight || 700} ${o.size || 40}px ${o.font === 'sans' ? SANS : FONT()}`; }
  function wrapLines(lines, wrapW) {      // uses the font already set on mctx
    const out = []; lines.forEach(ln => { let cur = ''; ln.split(/\s+/).forEach(wd => { const t2 = cur ? cur + ' ' + wd : wd; if (cur && mctx.measureText(t2).width > wrapW) { out.push(cur); cur = wd; } else cur = t2; }); out.push(cur); }); return out;
  }
  /* v0.10.1.2 "fit box" text (used by the bar templates): o.x is the CENTRE x and o.y the CENTRE y of the text block, o.wrapW the box width and
     o.fitH the box height. With autoFit (default) the size shrinks until the text fits in maxLines lines (default 2) inside the box; o.size is the
     largest size it may use. The block is centred on the capital letters, not on the line box, so it looks centred in the bar. */
  const fitCache = new Map();
  function fitResolve(o) {
    if (!o.fitBox || !mctx) return o;
    const txt = String(autoText(o)), maxL = o.maxLines > 0 ? o.maxLines : 2, bw = o.wrapW > 0 ? o.wrapW : 1000, bh = o.fitH > 0 ? o.fitH : 1e9, s0 = Math.max(10, o.size || 40), auto = o.autoFit !== false;
    const key = [txt, s0, bw, bh, maxL, o.weight, o.font, auto].join('\u0001'); let hit = fitCache.get(key);
    if (!hit) {
      let sz = s0, lines = [];
      for (; sz >= 10; sz--) {
        mctx.font = fontFor({ weight: o.weight, size: sz, font: o.font }); lines = wrapLines(txt.split('\n'), bw);
        if (!auto) break;
        const widest = Math.max(...lines.map(l => mctx.measureText(l).width));
        if (lines.length <= maxL && widest <= bw + 0.5 && lines.length * sz * 1.15 <= bh) break;
      }
      mctx.textBaseline = 'top'; const hm = mctx.measureText('H'), cH = (hm.actualBoundingBoxAscent != null) ? ((hm.actualBoundingBoxDescent || 0) - hm.actualBoundingBoxAscent) / 2 : sz * 0.55;
      mctx.textBaseline = 'alphabetic';
      hit = { size: sz, n: lines.length, cH }; if (fitCache.size > 300) fitCache.clear(); fitCache.set(key, hit);
    }
    return Object.assign({}, o, { size: hit.size, wrapW: bw, fitBox: false, y: o.y - hit.cH - (hit.n - 1) * hit.size * 1.15 / 2 });
  }
  E.fontFor = fontFor;
  E.effectiveText = fitResolve;      // text object as drawn (fit-box objects resolved to their real size and top)
  function textMetrics(o) {
    let lines = String(autoText(o)).split('\n'); mctx.font = fontFor(o);
    if (o.wrapW > 0) lines = wrapLines(lines, o.wrapW);
    const w = o.wrapW > 0 ? o.wrapW : Math.max(10, ...lines.map(l => mctx.measureText(l).width)), lh = o.size * 1.15;
    return { lines, w, h: lines.length * lh, lh };
  }
  function mixHex(a, b, t) { const pa = hexRGB(a), pb = hexRGB(b); return 'rgb(' + [0, 1, 2].map(i => Math.round(pa[i] + (pb[i] - pa[i]) * t)).join(',') + ')'; }
  function hexRGB(h) { h = String(h || '#ffffff'); if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; const m = /^#([0-9a-f]{6})/i.exec(h); if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; } const r = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(h); return r ? [+r[1], +r[2], +r[3]] : [255, 255, 255]; }
  function drawTextBox(c, o, b) {
    const st = o.boxStyle || 'plain', r = o.size * 0.25; c.save();
    if (st === 'titlebar') {
      const gr = c.createLinearGradient(0, b.y, 0, b.y + b.h); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#dfe6f0'); gr.addColorStop(1, '#b9c5d6');
      c.fillStyle = gr; rrect(c, b.x, b.y, b.w, b.h, r * 0.4); c.fill(); c.lineWidth = Math.max(2, o.size * 0.04); c.strokeStyle = '#0b3a8f'; c.stroke();
      c.fillStyle = '#1b6dff'; c.fillRect(b.x + 3, b.y + b.h - Math.max(5, o.size * 0.09), b.w - 6, Math.max(3, o.size * 0.06));
    } else if (st === 'red') {
      const gr = c.createLinearGradient(0, b.y, 0, b.y + b.h); gr.addColorStop(0, '#ff6050'); gr.addColorStop(0.5, '#d01414'); gr.addColorStop(1, '#8a0000');
      c.fillStyle = gr; rrect(c, b.x, b.y, b.w, b.h, r * 0.9); c.fill(); c.lineWidth = Math.max(2, o.size * 0.05); c.strokeStyle = '#f2b24a'; c.stroke();
      const g2 = c.createLinearGradient(0, b.y, 0, b.y + b.h * 0.5); g2.addColorStop(0, 'rgba(255,255,255,0.38)'); g2.addColorStop(1, 'rgba(255,255,255,0.02)'); c.fillStyle = g2; rrect(c, b.x + 3, b.y + 3, b.w - 6, b.h * 0.5, r * 0.8); c.fill();
    } else if (st === 'glass') {
      c.fillStyle = 'rgba(255,255,255,0.16)'; rrect(c, b.x, b.y, b.w, b.h, r * 0.3); c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.4)'; c.stroke();
    } else { c.fillStyle = o.boxColor; rrect(c, b.x, b.y, b.w, b.h, r); c.fill(); }
    c.restore();
  }
  E.TEXT_PRESETS = [['', 'Choose a style…'], ['plain', 'Plain'], ['titlebar', 'Title bar (silver, navy text)'], ['red', 'Red alert panel (glossy)'], ['glass', 'Glass panel'], ['outline', 'White text, dark outline'], ['gold', 'Gold gradient + gloss'], ['chrome', 'Chrome gloss']];
  E.applyTextPreset = function (o, k) {
    const base = { box: false, boxStyle: 'plain', grad: false, gloss: false, strokeW: 0 };
    const P = { plain: {}, titlebar: { box: true, boxStyle: 'titlebar', color: '#0b2a5e', weight: 800 }, red: { box: true, boxStyle: 'red', color: '#ffffff', weight: 800 }, glass: { box: true, boxStyle: 'glass', color: '#ffffff', weight: 800 }, outline: { color: '#ffffff', strokeW: Math.max(3, o.size * 0.06), strokeColor: '#0a1a33', weight: 800 }, gold: { color: '#ffe27a', color2: '#d98a00', grad: true, gloss: true, strokeW: Math.max(2, o.size * 0.04), strokeColor: '#4a2a00', weight: 800 }, chrome: { color: '#f4f8ff', color2: '#7f93b0', grad: true, gloss: true, strokeW: Math.max(2, o.size * 0.04), strokeColor: '#0a1a33', weight: 800 } };
    if (P[k]) Object.assign(o, base, P[k]);
  };
  /* ---------- data-driven / broadcast widgets ---------- */
  function autoText(o) {
    if (!o.auto) return o.text == null ? '' : o.text;
    const d = new Date(), P = {}; try { new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }).formatToParts(d).forEach(x => { P[x.type] = x.value; }); } catch (e) { return String(o.text || ''); }
    const tm = P.hour + ':' + P.minute + (P.dayPeriod || '').replace(/\s/g, ''), tz = P.timeZoneName || '';
    if (o.auto === 'valid') return 'Valid: ' + P.weekday + ' ' + tm + ' ' + tz;
    if (o.auto === 'date') return P.weekday + ' ' + P.month + ' ' + P.day;
    if (o.auto === 'clock') return tm + ' ' + tz;
    if (o.auto === 'datetime') return P.weekday + ' ' + P.month + ' ' + P.day + '  ' + tm + ' ' + tz;
    return String(o.text || '');
  }
  const mctx2 = document.createElement('canvas').getContext('2d');
  function cityLayout(o) { const sz = o.size || 40; mctx2.font = `800 ${sz}px ${FONT()}`; const vw = mctx2.measureText(o.value || '').width; mctx2.font = `800 ${sz * 0.78}px ${FONT()}`; const nw = o.name ? mctx2.measureText(o.name).width : 0; const bw = vw + sz * 0.8, bh = sz * 1.25, nh = o.name ? sz * 0.95 : 0; return { w: Math.max(bw, nw) + 8, h: bh + nh + sz * 0.38, bw, bh, nh, sz }; }
  function calloutLayout(o) { const sz = o.size || 36; mctx2.font = `700 ${sz}px ${FONT()}`; const lw = o.label ? mctx2.measureText(o.label).width : 0; mctx2.font = `800 ${sz * 1.15}px ${FONT()}`; const vw = o.value ? mctx2.measureText(o.value).width : 0; const bw = lw + vw + (o.label && o.value ? sz * 1.1 : sz * 0.8), bh = sz * 1.6; const bx = o.x + (o.dx || 0) - (o.dx < 0 ? bw : 0), by = o.y + (o.dy || 0) - bh / 2; return { bx, by, bw, bh, lw, vw }; }
  const LEGENDS = { radar: [[0, '#00e676'], [0.2, '#0a9a3a'], [0.38, '#ffee00'], [0.55, '#ff9a00'], [0.7, '#e60000'], [0.85, '#ff33cc'], [1, '#ffffff']], precip: [[0, '#ffffff'], [0.2, '#9fd6ff'], [0.45, '#2f8bff'], [0.7, '#6a2bd8'], [1, '#ff2fd0']], snow: [[0, '#d8f0ff'], [0.35, '#6fb7ff'], [0.7, '#2a56d8'], [1, '#a02bd8']], temp: [[0, '#9b6bff'], [0.2, '#4aa3ff'], [0.4, '#6fd3ff'], [0.55, '#6fe3b0'], [0.7, '#ffe066'], [0.85, '#ffa63d'], [1, '#ff5a3d']] };
  E.LEGEND_KINDS = [['radar', 'Radar (light → heavy)'], ['precip', 'Precipitation'], ['snow', 'Snowfall'], ['temp', 'Temperature']];
  function drawWidget(c, o, t) {
    if (o.type === 'citytemp') {
      const L = cityLayout(o), sz = L.sz, bx = o.x - L.bw / 2, by = o.y - L.h + L.nh;
      c.save(); c.textAlign = 'center'; c.textBaseline = 'middle';
      if (o.name) { c.font = `800 ${sz * 0.78}px ${FONT()}`; c.lineJoin = 'round'; c.lineWidth = sz * 0.2; c.strokeStyle = 'rgba(5,15,35,0.9)'; c.strokeText(o.name, o.x, by - sz * 0.42); c.fillStyle = '#fff'; c.fillText(o.name, o.x, by - sz * 0.42); }
      const num = parseFloat(String(o.value).replace(/[^0-9.\-]/g, '')), col = o.colorByTemp && isFinite(num) ? E.tempColor(num) : '#1f4fd8', dark = o.colorByTemp && isFinite(num);
      c.beginPath(); c.moveTo(o.x - sz * 0.18, by + L.bh - 1); c.lineTo(o.x, o.y); c.lineTo(o.x + sz * 0.18, by + L.bh - 1); c.closePath(); c.fillStyle = col; c.fill();
      const gr = c.createLinearGradient(0, by, 0, by + L.bh); gr.addColorStop(0, col); gr.addColorStop(1, mixHex(col, '#000000', 0.35)); c.fillStyle = gr; rrect(c, bx, by, L.bw, L.bh, sz * 0.28); c.fill(); c.lineWidth = Math.max(2, sz * 0.07); c.strokeStyle = '#fff'; c.stroke();
      c.font = `800 ${sz}px ${FONT()}`; c.fillStyle = dark ? '#06152e' : '#fff'; c.fillText(o.value || '', o.x, by + L.bh / 2 + sz * 0.04); c.restore(); return;
    }
    if (o.type === 'callout') {
      const L = calloutLayout(o), sz = o.size || 36; c.save();
      const ax = L.bx + (o.dx < 0 ? L.bw : 0), ay = L.by + L.bh / 2; c.strokeStyle = '#fff'; c.lineWidth = Math.max(3, sz * 0.09); c.lineCap = 'round'; c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(ax, ay); c.stroke();
      const gr = c.createLinearGradient(0, L.by, 0, L.by + L.bh); gr.addColorStop(0, '#2a5fc4'); gr.addColorStop(1, '#0b2a66'); c.fillStyle = gr; rrect(c, L.bx, L.by, L.bw, L.bh, sz * 0.22); c.fill(); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
      c.textBaseline = 'middle'; c.textAlign = 'left'; let tx = L.bx + sz * 0.4; if (o.label) { c.font = `700 ${sz}px ${FONT()}`; c.fillStyle = '#fff'; c.fillText(o.label, tx, L.by + L.bh / 2 + 2); tx += L.lw + sz * 0.3; } if (o.value) { c.font = `800 ${sz * 1.15}px ${FONT()}`; c.fillStyle = o.color || '#ffd23f'; c.fillText(o.value, tx, L.by + L.bh / 2 + 2); }
      c.beginPath(); c.arc(o.x, o.y, Math.max(8, sz * 0.26), 0, TAU); c.fillStyle = o.color || '#ffd23f'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke(); c.restore(); return;
    }
    if (o.type === 'legend') {
      const b = E.bounds(o), st = LEGENDS[o.kind] || LEGENDS.radar; c.save();
      c.fillStyle = 'rgba(25,70,150,0.88)'; rrect(c, b.x, b.y, b.w, b.h, 6); c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(190,215,255,0.8)'; c.stroke();
      const by = b.y + b.h - o.h - 14, gx = o.x + 14, gw = o.w - 28; mctx2.font = `700 ${o.h * 0.5}px ${FONT()}`;
      c.textBaseline = 'middle'; c.font = `700 ${o.h * 0.5}px ${FONT()}`; c.fillStyle = '#fff'; c.textAlign = 'left'; const lw = o.left ? c.measureText(o.left).width + 10 : 0; c.textAlign = 'right'; const rw = o.right ? c.measureText(o.right).width + 10 : 0;
      const bx0 = gx + lw, bw0 = gw - lw - rw, gr = c.createLinearGradient(bx0, 0, bx0 + bw0, 0); st.forEach(s2 => gr.addColorStop(s2[0], s2[1])); c.fillStyle = gr; rrect(c, bx0, by + o.h * 0.15, bw0, o.h * 0.7, o.h * 0.2); c.fill(); c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,0.7)'; c.stroke();
      c.fillStyle = '#fff'; c.textAlign = 'left'; if (o.left) c.fillText(o.left, gx, by + o.h / 2 + 1); c.textAlign = 'right'; if (o.right) c.fillText(o.right, gx + gw, by + o.h / 2 + 1);
      if (o.title) { c.textAlign = 'center'; c.font = `800 ${o.h * 0.6}px ${FONT()}`; c.fillText(o.title, o.x + o.w / 2, b.y + o.h * 0.55 + 4); } c.restore(); return;
    }
    if (o.type === 'ticker') {
      c.save(); const gr = c.createLinearGradient(0, o.y, 0, o.y + o.h); gr.addColorStop(0, '#12306a'); gr.addColorStop(1, '#061a42'); c.fillStyle = gr; c.fillRect(o.x, o.y, o.w, o.h); c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(o.x, o.y, o.w, 3);
      const fs = o.h * 0.5; c.font = `800 ${fs}px ${FONT()}`; c.textBaseline = 'middle'; c.textAlign = 'left'; const lab = o.label || '', lw = lab ? c.measureText(lab).width + o.h * 0.9 : 0;
      c.save(); c.beginPath(); c.rect(o.x + lw, o.y, o.w - lw, o.h); c.clip(); c.fillStyle = '#fff'; const txt = String(o.text || ''), tw = c.measureText(txt).width, gap = o.w * 0.25, per = tw + gap, off = ((t * (o.speed || 140)) % per);
      for (let x = o.x + lw + 24 - off; x < o.x + o.w; x += per) c.fillText(txt, x, o.y + o.h / 2 + 2); c.restore();
      if (lab) { const g2 = c.createLinearGradient(0, o.y, 0, o.y + o.h); g2.addColorStop(0, '#ff5a4a'); g2.addColorStop(1, o.color || '#a00000'); c.fillStyle = g2; c.fillRect(o.x, o.y + 3, lw, o.h - 3); c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(lab, o.x + lw / 2, o.y + o.h / 2 + 2); }
      c.restore(); return;
    }
  }
  function ptsBox(pts, pad) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; pts.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); if (x0 > x1) return { x: 0, y: 0, w: 1, h: 1 }; return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }; }
  E.bounds = function (o) {
    switch (o.type) {
      case 'text': { o = fitResolve(o); const m = textMetrics(o), p = o.box ? o.size * 0.35 : 4; const x0 = o.align === 'center' ? o.x - m.w / 2 : o.align === 'right' ? o.x - m.w : o.x; return { x: x0 - p, y: o.y - p, w: m.w + p * 2, h: m.h + p * 2 }; }
      case 'icon': return { x: o.x - o.size / 2, y: o.y - o.size / 2, w: o.size, h: o.size };
      case 'hl': return g.Sym.hlBounds(o.x, o.y, o.size);
      case 'front': return ptsBox(o.pts, o.size * 1.2);
      case 'arrow': case 'line': case 'pen': return ptsBox(o.pts, (o.width || 8) * 1.8 + 6);
      case 'flow': return ptsBox(o.pts, (o.size || 46) * 1.1 + 6);
      case 'jet': return ptsBox(o.pts, (o.width || 64) * 0.95 + 8);
      case 'shape': case 'image': return { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) };
      case 'barb': return { x: o.x - o.size, y: o.y - o.size, w: o.size * 2, h: o.size * 2 };
      case 'pin': return { x: o.x - 24, y: o.y - 24, w: 300, h: 70 };
      case 'storm': return { x: o.x - o.size / 2, y: o.y - o.size / 2, w: o.size, h: o.size };
      case 'pop': return { x: o.x - o.size * 0.6, y: o.y - o.size * 0.7, w: o.size * 3.2, h: o.size * 1.4 };
      case 'citytemp': { const L = cityLayout(o); return { x: o.x - L.w / 2, y: o.y - L.h, w: L.w, h: L.h }; }
      case 'callout': { const L = calloutLayout(o), x0 = Math.min(o.x - 14, L.bx), y0 = Math.min(o.y - 14, L.by), x1 = Math.max(o.x + 14, L.bx + L.bw), y1 = Math.max(o.y + 14, L.by + L.bh); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
      case 'legend': return { x: o.x, y: o.y - (o.title ? o.h * 0.9 : 0) - 10, w: o.w, h: o.h + (o.title ? o.h * 0.9 : 0) + 40 };
      case 'ticker': return { x: o.x, y: o.y, w: o.w, h: o.h };
    }
    return { x: 0, y: 0, w: 10, h: 10 };
  };

  /* ---------- object drawing ---------- */
  function rrect(c, x, y, w, h, r) { r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  E.rrect = rrect;
  function dropGlyph(c, x, y, s, col) { c.save(); c.translate(x, y); c.fillStyle = col || '#58b0ff'; c.beginPath(); c.moveTo(0, -s * 0.55); c.bezierCurveTo(s * 0.5, s * 0.05, s * 0.45, s * 0.55, 0, s * 0.55); c.bezierCurveTo(-s * 0.45, s * 0.55, -s * 0.5, s * 0.05, 0, -s * 0.55); c.fill(); c.fillStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.ellipse(-s * 0.14, s * 0.18, s * 0.07, s * 0.14, 0.3, 0, TAU); c.fill(); c.restore(); }
  function drawObj(c, o, t, p, show) {
    switch (o.type) {
      case 'text': {
        if (E.editingId && E.editingId === o.id) break;
        o = fitResolve(o); const m = textMetrics(o); c.save(); c.font = fontFor(o); c.textBaseline = 'top'; c.textAlign = o.align || 'left';
        if (o.box) drawTextBox(c, o, E.bounds(o));
        let fill = o.color;
        if (o.grad || o.gloss) { const gr = c.createLinearGradient(0, o.y, 0, o.y + m.h), c2 = o.color2 || o.color; if (o.gloss) { gr.addColorStop(0, mixHex(o.color, '#ffffff', 0.65)); gr.addColorStop(0.46, o.color); gr.addColorStop(0.5, mixHex(c2, '#000000', 0.18)); gr.addColorStop(1, c2); } else { gr.addColorStop(0, o.color); gr.addColorStop(1, c2); } fill = gr; }
        c.lineJoin = 'round'; c.miterLimit = 2;
        if (o.fx) { E.drawFxLines(c, m.lines, o.x, o.y, m.lh, o.fx, fill, o.size); c.restore(); break; }
        m.lines.forEach((l, i) => { if (o.strokeW > 0) { c.lineWidth = o.strokeW * 2; c.strokeStyle = o.strokeColor || '#000000'; c.strokeText(l, o.x, o.y + i * m.lh); } c.fillStyle = fill; c.fillText(l, o.x, o.y + i * m.lh); });
        c.restore(); break;
      }
      case 'citytemp': case 'callout': case 'legend': case 'ticker': drawWidget(c, o, t); break;
      case 'icon': g.Icons.draw(c, o.icon, o.x, o.y, o.size, t); break;
      case 'hl': g.Sym.drawHL(c, o.kind, o.x, o.y, o.size, o.value, t, { progress: o.animMode === 'draw' ? p : 1 }); break;
      case 'front': g.Sym.drawFront(c, o.kind, o.pts, o.size, t, { flip: o.flip, progress: o.animMode === 'draw' ? p : 1 }); break;
      case 'arrow': g.Sym.drawPath(c, o.pts, { color: o.color, width: o.width, style: o.style, head: o.head, t, progress: o.animMode === 'draw' ? p : 1 }); break;
      case 'flow': g.Sym.drawFlow(c, o.pts, { color: o.color, size: o.size, spacing: o.spacing, speed: o.speed, style: o.style, t, progress: o.animMode === 'draw' ? p : 1 }); break;
      case 'jet': g.Sym.drawJet(c, o.pts, { color: o.color, width: o.width, outline: o.outline, fade: o.fade, flowText: o.flowText, words: o.words, style: o.style, speed: o.speed, arrowColor: o.arrowColor, label: o.label, t, progress: o.animMode === 'draw' ? p : 1 }); break;
      case 'line': g.Sym.drawPath(c, o.pts, { color: o.color, width: o.width, style: o.style, closed: o.closed, label: o.label, t, progress: o.animMode === 'draw' ? p : 1 }); break;
      case 'pen': g.Sym.drawPath(c, o.pts, { color: o.color, width: o.width, raw: true, glow: false, t, progress: o.animMode === 'draw' ? p : 1 }); break;
      case 'shape': {
        c.save(); c.globalAlpha *= o.opacity == null ? 1 : o.opacity;
        if (o.shape === 'ellipse') { c.beginPath(); c.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), Math.abs(o.h / 2), 0, 0, TAU); } else rrect(c, Math.min(o.x, o.x + o.w), Math.min(o.y, o.y + o.h), Math.abs(o.w), Math.abs(o.h), o.shape === 'rect' ? 0 : o.radius);
        if (o.fill && o.fill !== 'none') { c.fillStyle = o.fill; c.fill(); }
        if (o.lw > 0 && o.stroke && o.stroke !== 'none') { c.lineWidth = o.lw; c.strokeStyle = o.stroke; c.stroke(); } c.restore(); break;
      }
      case 'image': { const im = E.img(show, o.asset); if (im) { c.save(); c.globalAlpha *= o.opacity == null ? 1 : o.opacity; c.drawImage(im, o.x, o.y, o.w, o.h); c.restore(); } else { c.save(); c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(o.x, o.y, o.w, o.h); c.restore(); } break; }
      case 'barb': g.Sym.drawBarb(c, o.x, o.y, o.kt, o.dir, o.size, o.color); break;
      case 'pin': {
        c.save(); const ph = (t * 0.7) % 1; c.strokeStyle = o.color; c.globalAlpha *= 1 - ph; c.lineWidth = 3; c.beginPath(); c.arc(o.x, o.y, 10 + ph * 26, 0, TAU); c.stroke(); c.globalAlpha /= (1 - ph || 1);
        c.fillStyle = o.color; c.shadowColor = o.color; c.shadowBlur = 14; c.beginPath(); c.arc(o.x, o.y, 9, 0, TAU); c.fill(); c.shadowBlur = 0;
        const lab = o.label || '', val = o.value || ''; c.font = `700 32px ${FONT()}`; const lw = lab ? c.measureText(lab).width : 0; c.font = `800 40px ${FONT()}`; const vw = val ? c.measureText(val).width : 0;
        const bw = lw + vw + (lab && val ? 44 : 28), bx = o.x + 22, by = o.y - 26; c.fillStyle = 'rgba(8,20,38,0.85)'; rrect(c, bx, by, bw, 52, 12); c.fill(); c.textBaseline = 'middle';
        let tx = bx + 14; if (lab) { c.font = `700 32px ${FONT()}`; c.fillStyle = '#fff'; c.fillText(lab, tx, o.y + 1); tx += lw + 16; } if (val) { c.font = `800 40px ${FONT()}`; c.fillStyle = o.color; c.fillText(val, tx, o.y + 1); } c.restore(); break;
      }
      case 'storm': { g.Icons.hurricaneSymbol(c, o.x, o.y, o.size / 2, t, o.kind === 'TD' ? 'TD' : o.kind); if (o.label) g.Sym.pill(c, o.label, o.x, o.y + o.size * 0.62, 28, 'rgba(8,20,38,0.85)', '#fff'); break; }
      case 'pop': { dropGlyph(c, o.x, o.y, o.size, '#58b0ff'); c.save(); c.font = `700 ${o.size}px ${FONT()}`; c.fillStyle = '#d6ecff'; c.textBaseline = 'middle'; c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 6; c.fillText(o.value, o.x + o.size * 0.7, o.y + o.size * 0.04); c.restore(); break; }
    }
  }
  const PATHY = { front: 1, arrow: 1, line: 1, pen: 1, hl: 1 };
  /* ---------- drop shadows (composited per object so glows/effects keep working) ---------- */
  const SHADOW_OFF = { shape: 1, image: 1, ticker: 1 };
  E.shadowOf = function (o) {
    const s = o.shadow; if (s === false) return null;
    if (s && typeof s === 'object') return s.on === false ? null : s;
    return SHADOW_OFF[o.type] ? null : { on: true, blur: 12, dist: 7, alpha: 0.6 };
  };
  let shadowCv = null;
  /* ---------- Layer Style for any non-text object (works from the object's silhouette) ---------- */
  let tintCv = null;
  function drawFxObj(c, o, o0, t, p, show, fx) {
    let b; try { b = E.bounds(o); } catch (e) { b = null; }
    const st = fx.stroke || {}, sh = fx.shadow || {}, gl = fx.glow || {}, co = fx.coverlay || {}, go = fx.goverlay || {};
    const pad = Math.ceil(Math.max(gl.on ? (gl.size || 0) * 2 : 0, sh.on ? (sh.size || 0) * 2 + (sh.dist || 0) : 0, st.on ? (st.size || 0) : 0) + 80 + (o.size || 0) * 0.3);
    const tr = c.getTransform(), W2 = c.canvas.width, H2 = c.canvas.height;
    if (!b || !isFinite(b.x + b.y + b.w + b.h) || tr.a !== 1 || tr.d !== 1 || tr.b !== 0 || tr.c !== 0) { drawObj(c, o, t, p, show); return; }
    const x0 = Math.max(0, Math.floor(b.x - pad)), y0 = Math.max(0, Math.floor(b.y - pad)), x1 = Math.min(W2, Math.ceil(b.x + b.w + pad)), y1 = Math.min(H2, Math.ceil(b.y + b.h + pad)), w = x1 - x0, h2 = y1 - y0;
    if (w <= 0 || h2 <= 0) { drawObj(c, o, t, p, show); return; }
    if (!shadowCv || shadowCv.width !== W2 || shadowCv.height !== H2) { shadowCv = document.createElement('canvas'); shadowCv.width = W2; shadowCv.height = H2; }
    if (!tintCv || tintCv.width !== W2 || tintCv.height !== H2) { tintCv = document.createElement('canvas'); tintCv.width = W2; tintCv.height = H2; }
    const sc = shadowCv.getContext('2d'); sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(x0, y0, w, h2);
    sc.save(); sc.beginPath(); sc.rect(x0, y0, w, h2); sc.clip(); sc.setTransform(tr); sc.globalAlpha = 1; drawObj(sc, o, t, p, show); sc.restore();
    const tint = fill => { const q = tintCv.getContext('2d'); q.setTransform(1, 0, 0, 1, 0, 0); q.clearRect(x0, y0, w, h2); q.globalCompositeOperation = 'source-over'; q.drawImage(shadowCv, x0, y0, w, h2, x0, y0, w, h2); q.globalCompositeOperation = 'source-atop'; q.fillStyle = fill; q.fillRect(x0, y0, w, h2); q.globalCompositeOperation = 'source-over'; return tintCv; };
    const OFF = 6000, A = c.globalAlpha;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    const ghost = (dx, dy, color, op, blur, twice) => { c.save(); c.shadowColor = rgba(color, op); c.shadowBlur = blur; c.shadowOffsetX = OFF + dx; c.shadowOffsetY = dy; c.drawImage(shadowCv, x0, y0, w, h2, x0 - OFF, y0, w, h2); if (twice) c.drawImage(shadowCv, x0, y0, w, h2, x0 - OFF, y0, w, h2); c.restore(); };
    if (gl.on) ghost(0, 0, gl.color, gl.opacity, Math.max(1, gl.size) * 2, true);
    if (sh.on) { const a = (sh.angle || 0) * Math.PI / 180, d = sh.dist || 0; ghost(-Math.cos(a) * d, Math.sin(a) * d, sh.color, sh.opacity, Math.max(0, sh.size || 0), false); }
    if (st.on && st.size > 0) { const r = st.pos === 'center' ? st.size / 2 : st.size, ts = tint(st.color || '#000000'); c.save(); c.globalAlpha = A * clamp((st.opacity == null ? 100 : st.opacity) / 100, 0, 1); for (let i = 0; i < 24; i++) { const an = i / 24 * Math.PI * 2; c.drawImage(ts, x0, y0, w, h2, x0 + Math.cos(an) * r, y0 + Math.sin(an) * r, w, h2); } c.restore(); }
    c.drawImage(shadowCv, x0, y0, w, h2, x0, y0, w, h2);
    if (co.on) { const ts = tint(co.color || '#ffffff'); c.save(); c.globalAlpha = A * clamp((co.opacity == null ? 100 : co.opacity) / 100, 0, 1); c.drawImage(ts, x0, y0, w, h2, x0, y0, w, h2); c.restore(); }
    if (go.on) { const a = (go.angle == null ? 90 : go.angle) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), cx = b.x + b.w / 2, cy = b.y + b.h / 2, rr = (Math.abs(dx) * b.w + Math.abs(dy) * b.h) / 2 || 1, gr = c.createLinearGradient(cx - dx * rr, cy - dy * rr, cx + dx * rr, cy + dy * rr); gr.addColorStop(0, go.c1 || '#ffffff'); gr.addColorStop(1, go.c2 || '#9fb4d6'); const ts = tint(gr); c.save(); c.globalAlpha = A * clamp((go.opacity == null ? 100 : go.opacity) / 100, 0, 1); c.drawImage(ts, x0, y0, w, h2, x0, y0, w, h2); c.restore(); }
    c.restore();
  }
  function drawShadowed(c, o, o0, t, p, show) {
    if (o0.fx && o0.type !== 'text') { drawFxObj(c, o, o0, t, p, show, o0.fx); return; }
    const sh = E.shadowOf(o0);
    if (!sh) { drawObj(c, o, t, p, show); return; }
    let b; try { b = E.bounds(o); } catch (e) { b = null; }
    if (!b || !isFinite(b.x + b.y + b.w + b.h)) { drawObj(c, o, t, p, show); return; }
    const blur = Math.max(0, +sh.blur || 0), dist = Math.max(0, +sh.dist || 0), pad = Math.ceil(blur * 2 + dist + 80 + (o.size || 0) * 0.3);
    const tr = c.getTransform(), W2 = c.canvas.width, H2 = c.canvas.height;
    if (!shadowCv || shadowCv.width !== W2 || shadowCv.height !== H2) { shadowCv = document.createElement('canvas'); shadowCv.width = W2; shadowCv.height = H2; }
    const x0 = Math.max(0, Math.floor(b.x - pad)), y0 = Math.max(0, Math.floor(b.y - pad)), x1 = Math.min(W2, Math.ceil(b.x + b.w + pad)), y1 = Math.min(H2, Math.ceil(b.y + b.h + pad));
    if (x1 <= x0 || y1 <= y0 || (tr.a !== 1 || tr.d !== 1 || tr.b !== 0 || tr.c !== 0)) { drawObj(c, o, t, p, show); return; }
    const tc = shadowCv.getContext('2d'); tc.setTransform(1, 0, 0, 1, 0, 0); tc.clearRect(x0, y0, x1 - x0, y1 - y0);
    tc.save(); tc.beginPath(); tc.rect(x0, y0, x1 - x0, y1 - y0); tc.clip(); tc.setTransform(tr); tc.globalAlpha = 1; drawObj(tc, o, t, p, show); tc.restore();
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    c.shadowColor = 'rgba(0,0,0,' + clamp(sh.alpha == null ? 0.6 : sh.alpha, 0, 1) + ')'; c.shadowBlur = blur; c.shadowOffsetX = dist * 0.55; c.shadowOffsetY = dist;
    c.drawImage(shadowCv, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0); c.restore();
  }
  /* ---------- motion path: A -> B -> C -> D ... (stops are screen-pixel offsets from the object's own spot = A) ---------- */
  E.moveDefault = () => ({ on: true, pts: [[220, -90]], start: 0.6, dur: 3, ease: 'inout', smooth: true, loop: false });
  E.moveSamples = function (m) {
    const P = [[0, 0]].concat((m.pts || []).filter(q => q && isFinite(q[0] + q[1]))); if (P.length < 2) return [[0, 0]];
    const out = [];
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)], n = m.smooth === false ? 1 : 24;
      for (let k = 0; k < n; k++) { const u = k / n; if (m.smooth === false) { out.push([p1[0], p1[1]]); continue; }
        const u2 = u * u, u3 = u2 * u, f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3); out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]); }
    }
    out.push(P[P.length - 1]); return out;
  };
  E.moveOffset = function (o, t) {
    const m = o.move; if (!m || !m.on || !m.pts || !m.pts.length) return [0, 0];
    const S = E.moveSamples(m); if (S.length < 2) return [0, 0];
    const dur = Math.max(0.1, m.dur || 3); let u = (t - (m.start || 0)) / dur;
    if (m.loop && u > 1) { const cyc = 1 + 0.5 / dur; u = (u % cyc); u = Math.min(1, u); }
    u = clamp(u, 0, 1); u = m.ease === 'linear' ? u : m.ease === 'out' ? ease.out(u) : ease.inout(u);
    let L = 0; const cum = [0]; for (let i = 1; i < S.length; i++) { L += Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]); cum.push(L); }
    if (L <= 0) return [0, 0]; const d = u * L; let i = 1; while (i < S.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1, f = clamp((d - cum[i - 1]) / seg, 0, 1);
    return [S[i - 1][0] + (S[i][0] - S[i - 1][0]) * f, S[i - 1][1] + (S[i][1] - S[i - 1][1]) * f];
  };
  function drawObjectAnimated(c, o0, scene, xf, t, show, editing) {
    let o = toScreen(o0, xf); const a = o0.anim || ANIM_DEFAULT();
    const mvSrc = (o0.move && o0.move.on) ? o0 : (o0.moveWith ? (scene.objects.find(q => q.id === o0.moveWith && q.move && q.move.on) || null) : null);
    if (!editing && mvSrc) { const mo = E.moveOffset(mvSrc, t); if (mo[0] || mo[1]) { o = Object.assign({}, o); if (o.pts) o.pts = o.pts.map(q => [q[0] + mo[0], q[1] + mo[1]]); if (o.x != null) { o.x += mo[0]; o.y += mo[1]; } } }
    let p = 1, vis = true;
    if (!editing) { if (t < (a.delay || 0)) return; p = clamp((t - (a.delay || 0)) / Math.max(0.01, a.dur || 0.01), 0, 1); }
    const mode = a.in || 'none'; c.save();
    if (mode === 'draw' && PATHY[o.type]) { const o2 = Object.assign({}, o, { animMode: 'draw' }); drawShadowed(c, o2, o0, t, ease.out(p), show); c.restore(); return; }
    const pe = mode === 'none' ? 1 : ease.out(p);
    if (mode === 'fade' || mode === 'draw') c.globalAlpha *= pe;
    else if (mode === 'pop' || mode === 'zoom' || mode === 'slide-up' || mode === 'slide-left' || mode === 'in-left' || mode === 'in-right' || mode === 'in-top' || mode === 'in-bottom') {
      const b = E.bounds(o), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      if (mode === 'pop') { const s = 0.4 + 0.6 * ease.back(p); c.globalAlpha *= clamp(p * 3, 0, 1); c.translate(cx, cy); c.scale(s, s); c.translate(-cx, -cy); }
      else if (mode === 'zoom') { const s = 1.7 - 0.7 * pe; c.globalAlpha *= pe; c.translate(cx, cy); c.scale(s, s); c.translate(-cx, -cy); }
      else if (mode === 'slide-up') { c.globalAlpha *= pe; c.translate(0, (1 - pe) * 70); }
      else if (mode === 'in-left') c.translate(-(1 - pe) * (b.x + b.w + 20), 0);
      else if (mode === 'in-right') c.translate((1 - pe) * (W - b.x + 20), 0);
      else if (mode === 'in-top') c.translate(0, -(1 - pe) * (b.y + b.h + 20));
      else if (mode === 'in-bottom') c.translate(0, (1 - pe) * (H - b.y + 20));
      else { c.globalAlpha *= pe; c.translate((1 - pe) * 120, 0); }
    }
    drawShadowed(c, o, o0, t, 1, show); c.restore();
  }

  /* ---------- scene chrome: background, title, logo ---------- */
  function drawBackground(c, show, scene, t, ct, opts) {
    const b = scene.bg; if (ct == null) ct = t;
    if (b.type === 'mapbox') {
      const cam=E.viewAt(scene,ct), fr=(opts&&opts.liveMap&&g.MB.liveFrame)?g.MB.liveFrame(b,cam):g.MB.frame(b,cam);
      if (fr) c.drawImage(fr, 0, 0, W, H); else { c.fillStyle = '#0b1a2e'; c.fillRect(0, 0, W, H); }
      c.save(); c.font = `600 26px ${SANS}`; c.textAlign = 'center';
      if (!fr || g.MB.status !== 'ready') { c.fillStyle = g.MB.status === 'error' || !g.MB.hasToken() ? '#ffb4a8' : 'rgba(255,255,255,0.6)'; c.fillText(g.MB.status === 'error' ? 'Mapbox: ' + g.MB.err : (!g.MB.hasToken() ? 'Add your Mapbox token: Scene panel → Mapbox settings' : 'Loading Mapbox map…'), W / 2, H / 2); }
      c.textAlign = 'left'; c.font = `500 15px ${SANS}`; c.fillStyle = 'rgba(255,255,255,0.78)'; c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 4; c.fillText('© Mapbox  © OpenStreetMap contributors', 14, H - 12); c.restore();
    } else if (b.type === 'map') {
      g.WDMap.draw(c, E.viewAt(scene, ct), b.theme, { W, H, cities: b.cities !== false, counties: b.counties !== false, density: b.cityDensity || 1 });
      if (g.WDMap.status !== 'ready') { c.save(); c.fillStyle = 'rgba(255,255,255,0.18)'; c.font = `600 26px ${SANS}`; c.textAlign = 'center'; c.fillText(g.WDMap.status === 'error' ? 'Map data could not be loaded (needs internet) – backgrounds still work' : 'Loading map…', W / 2, H - 40); c.restore(); }
    } else if (b.type === 'image') {
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H); const im = E.img(show, b.asset);
      if (im) { const kb = b.kenburns ? 1 + 0.06 * clamp(t / Math.max(1, scene.duration), 0, 1) : 1;
        const fit = b.fit || 'blur'; if (fit === 'stretch') { const w = W * kb, h = H * kb; c.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); }
        else if (fit === 'solid') { c.fillStyle = b.fitColor || '#0a1a3a'; c.fillRect(0, 0, W, H); const s = Math.min(W / im.width, H / im.height) * kb, w = im.width * s, h = im.height * s; c.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); }
        else if (fit === 'blur') {
          let sm = blurCache.get(im); if (!sm) { sm = document.createElement('canvas'); sm.width = 64; sm.height = Math.max(8, Math.round(64 * im.height / im.width)); const sx = sm.getContext('2d'); sx.imageSmoothingQuality = 'high'; sx.drawImage(im, 0, 0, sm.width, sm.height); blurCache.set(im, sm); }
          const cs = Math.max(W / sm.width, H / sm.height) * 1.08; c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(sm, (W - sm.width * cs) / 2, (H - sm.height * cs) / 2, sm.width * cs, sm.height * cs);
          c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(0, 0, W, H);
          const s = Math.min(W / im.width, H / im.height) * kb, w = im.width * s, h = im.height * s; c.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
        } else { const s = Math.max(W / im.width, H / im.height) * kb; const w = im.width * s, h = im.height * s; c.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); } }
    } else if (b.type === 'video') {
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H); const v = E.vid(b.vid);
      if (v && v.gif) { try { drawVideoFit(c, gifFrame(v, vidTime(b, v, t)), v.w, v.h, b); } catch (err2) { /* ignore */ } }
      else if (v) { syncVideo(b, v, t, opts); try { drawVideoFit(c, v.el, v.w, v.h, b); } catch (err2) { /* frame not ready yet */ } }
      else { c.save(); c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = `600 28px ${SANS}`; c.textAlign = 'center'; c.fillText(E.videos[b.vid] ? (E.videos[b.vid].err ? 'GIF could not be read: ' + E.videos[b.vid].err : 'Loading video…') : 'Video not found in this browser – add it again in Assets → Videos', W / 2, H / 2); c.restore(); }
    } else if (b.type === 'solid') { c.fillStyle = b.color || '#101820'; c.fillRect(0, 0, W, H); }
    else {
      const gc = E.GRADS[b.grad] || E.GRADS.sky, gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, gc[0]); gr.addColorStop(1, gc[1]); c.fillStyle = gr; c.fillRect(0, 0, W, H);
      const gx = W * (0.3 + 0.08 * Math.sin(t * 0.25)), gl = c.createRadialGradient(gx, H * 0.15, 40, gx, H * 0.15, W * 0.7); gl.addColorStop(0, 'rgba(255,255,255,0.14)'); gl.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gl; c.fillRect(0, 0, W, H);
    }
    if (b.dim > 0) { c.fillStyle = `rgba(0,0,0,${b.dim})`; c.fillRect(0, 0, W, H); }
  }

  /* ---------- layer-style text effects (Photopea-like) + Title banner #2 ---------- */
  E.fxDefault = () => ({
    stroke: { on: true, size: 2, pos: 'outside', color: '#1f2f57', opacity: 100 },
    shadow: { on: true, color: '#000000', opacity: 67, angle: 90, dist: 3, size: 6 },
    coverlay: { on: false, color: '#ffffff', opacity: 100 },
    goverlay: { on: false, c1: '#ffffff', c2: '#9fb4d6', angle: 90, opacity: 100 },
    glow: { on: false, color: '#7fb4ff', opacity: 75, size: 12 }
  });
  const rgba = (hex, op) => { const q = hexRGB(hex); return 'rgba(' + q[0] + ',' + q[1] + ',' + q[2] + ',' + clamp((op == null ? 100 : op) / 100, 0, 1) + ')'; };
  E.drawFxLines = function (c, lines, x, y, lh, fx, baseFill, size) {
    fx = fx || E.fxDefault(); const st = fx.stroke || {}, sh = fx.shadow || {}, gl = fx.glow || {}, co = fx.coverlay || {}, go = fx.goverlay || {};
    c.save(); c.lineJoin = 'round'; c.miterLimit = 2;
    const each = fn => lines.forEach((l, i) => fn(l, y + i * lh));
    if (gl.on) { c.save(); c.shadowColor = rgba(gl.color, gl.opacity); c.shadowBlur = Math.max(1, gl.size) * 2; c.fillStyle = rgba(gl.color, gl.opacity); each((l, yy) => { c.fillText(l, x, yy); c.fillText(l, x, yy); }); c.restore(); }
    if (sh.on) {
      c.save(); const a = (sh.angle || 0) * Math.PI / 180, d = sh.dist || 0;
      c.shadowColor = rgba(sh.color, sh.opacity); c.shadowBlur = Math.max(0, sh.size || 0); c.shadowOffsetX = -Math.cos(a) * d; c.shadowOffsetY = Math.sin(a) * d;
      if (st.on && st.size > 0 && st.pos !== 'inside') { c.lineWidth = (st.pos === 'center' ? st.size : st.size * 2); c.strokeStyle = rgba(st.color, 100); each((l, yy) => c.strokeText(l, x, yy)); } else { c.fillStyle = baseFill; each((l, yy) => c.fillText(l, x, yy)); }
      c.restore();
    }
    if (st.on && st.size > 0 && st.pos !== 'center') { c.lineWidth = st.pos === 'inside' ? st.size : st.size * 2; c.strokeStyle = rgba(st.color, st.opacity); if (st.pos !== 'inside') each((l, yy) => c.strokeText(l, x, yy)); }
    c.fillStyle = baseFill; each((l, yy) => c.fillText(l, x, yy));
    if (co.on) { c.save(); c.fillStyle = rgba(co.color, co.opacity); each((l, yy) => c.fillText(l, x, yy)); c.restore(); }
    if (go.on) { c.save(); const a = (go.angle == null ? 90 : go.angle) * Math.PI / 180, h2 = lines.length * lh, tw = Math.max(...lines.map(l => c.measureText(l).width)), al = c.textAlign, cx = al === 'center' ? x : al === 'right' || al === 'end' ? x - tw / 2 : x + tw / 2, dx = Math.cos(a), dy = Math.sin(a), rr = (Math.abs(dx) * tw + Math.abs(dy) * h2) / 2, cy = y + h2 / 2 - (c.textBaseline === 'middle' ? lh / 2 : 0), gr = c.createLinearGradient(cx - dx * rr, cy - dy * rr, cx + dx * rr, cy + dy * rr); gr.addColorStop(0, rgba(go.c1, go.opacity)); gr.addColorStop(1, rgba(go.c2, go.opacity)); c.fillStyle = gr; each((l, yy) => c.fillText(l, x, yy)); c.restore(); }
    if (st.on && st.size > 0 && (st.pos === 'center' || st.pos === 'inside')) { c.lineWidth = st.size; c.strokeStyle = rgba(st.color, st.opacity); each((l, yy) => c.strokeText(l, x, yy)); }
    c.restore();
  };
  E.title2Default = () => ({ show: true, text: '7 DAY FORECAST', pos: 'ul', width: 1150, y: 40, dx: 0, autoWidth: true, height: 154, minW: 0, logo: true, logoScale: 1.05, align: 'center', size: 0, upper: true, color: '#07345a', font: 'Roboto Condensed', weight: 700, anim: 'auto', delay: 0.2, fx: E.fxDefault() });
  const tb2Imgs = {};
  function tb2Img(k) { const A = g.WX_TB2 && g.WX_TB2[k]; if (!A) return null; let e = tb2Imgs[k]; if (!e) { e = tb2Imgs[k] = { el: new Image(), ok: false }; e.el.onload = () => { e.ok = true; if (E.onAsset) E.onAsset(); }; e.el.src = A.src; } return e.ok ? e.el : null; }
  /* Banner artwork geometry (source pixels of the 1100×264 bar image). The silver ("white") panel sits at 7.7%–76% of the banner height (centre ≈ 43%) and
     starts 14 px inside the box. For a wider/narrower banner the two plain stretches [260,480] and [600,860] are widened/narrowed while the caps, glow
     dots and the end under the logo keep their shape and height (so the banner never gets taller or shorter because of its length). */
  const TB2 = { cuts: [0, 260, 480, 600, 860, 1100], zones: [1, 3], boxL: 18, silverInset: 14, silverCY: 0.43 };
  /* v0.10.1.2: "text only" banner (T.textOnly): the banner artwork is already in the scene background (the bar templates), so only the title text is
     drawn - centred in T.region (the silver panel: l, r, cy, h) and shrunk to fit its width. Same fonts, layer style, entrance and offsets as banner #2. */
  E.title2Layout = function (T, c) {
    const R = T.region || { l: 186, r: 1272, cy: 102, h: 88 }; let txt = String(T.text || ''); if (T.upper !== false) txt = txt.toUpperCase();
    const fam = '"' + (T.font || 'Roboto Condensed') + '", "Barlow", "Barlow Condensed", Arial Narrow, sans-serif', weight = T.weight || 700;
    const dx = T.dx || 0, pad = R.pad != null ? R.pad : 0.03 * (R.r - R.l), availL = R.l + dx + pad, availR = R.r + dx - pad, availW = Math.max(40, availR - availL);
    let size = T.size > 0 ? T.size : R.h * 0.9; c.save(); c.font = `${weight} ${size}px ${fam}`; let tw = txt ? c.measureText(txt).width : 0;
    if (tw > availW) { size = size * availW / tw; c.font = `${weight} ${size}px ${fam}`; tw = c.measureText(txt).width; }
    c.textBaseline = 'middle'; c.textAlign = 'left'; const mh = c.measureText('H'), capShift = ((mh.actualBoundingBoxAscent || size * 0.35) - (mh.actualBoundingBoxDescent || 0)) / 2; c.restore();
    const tx = T.align === 'left' ? availL : T.align === 'right' ? availR - tw : availL + (availW - tw) / 2;
    return { R, txt, fam, weight, size, tw, tx, ty: R.cy + (T.ty || 0) + capShift, availL, availR, availW };
  };
  function drawTitle2Text(c, T, t, editing) {
    if (E.editingTitle2) return; const L = E.title2Layout(T, c); if (!L.txt) return;
    let p = 1; if (!editing) { const d = T.delay == null ? 0.2 : T.delay; if (t < d) return; p = ease.out(clamp((t - d) / 0.7, 0, 1)); }
    const mode = (!T.anim || T.anim === 'auto') ? 'fade' : T.anim, R = L.R; c.save(); c.font = `${L.weight} ${L.size}px ${L.fam}`; c.textBaseline = 'middle'; c.textAlign = 'left';
    if (mode === 'fade') c.globalAlpha *= p; else if (mode === 'in-left') c.translate(-(1 - p) * (L.availR + 200), 0); else if (mode === 'in-right') c.translate((1 - p) * (W - L.availL + 200), 0); else if (mode === 'in-top') c.translate(0, -(1 - p) * (R.cy + R.h + 300));
    E.drawFxLines(c, [L.txt], L.tx, L.ty, L.size * 1.1, T.fx, T.color || '#07345a', L.size); c.restore();
  }
  function drawTitle2(c, show, scene, t, editing) {
    const T = scene.title2; if (!T || !T.show) return; if (T.textOnly) { drawTitle2Text(c, T, t, editing); return; } const A = g.WX_TB2; if (!A) return; const bar = tb2Img('bar'), logo = tb2Img('logo'); if (!bar) return;
    const m = show.safe != null ? show.safe : 48, bb = A.bar.box, bw0 = bb[2] - bb[0], bh0 = bb[3] - bb[1], fixedBox = 584, zoneSrc = 480;
    const stretch = !!T.autoWidth || T.height > 0;       // old shows (neither set) keep the original uniform scaling exactly
    const maxW = W - 2 * m;
    let width, sb, chh;
    if (!stretch) { width = T.pos === 'full' ? maxW : (T.width || 1150); sb = width / bw0; chh = bh0 * sb; }
    else { chh = T.height > 0 ? T.height : bh0 * ((T.pos === 'full' ? maxW : (T.width || 1150)) / bw0); sb = chh / bh0; width = T.pos === 'full' ? maxW : (T.width || 1150); }
    const inset = TB2.silverInset * sb;
    let lw = 0, lb = A.logo.box, sl = 0;
    if (T.logo !== false && logo) { const lbw = lb[2] - lb[0], lbh = lb[3] - lb[1]; sl = chh * (T.logoScale || 1.05) / lbh; lw = lbw * sl; }
    // ---- text (measured first: with "fit to text" the banner length follows it)
    let txt = String(T.text || ''); if (T.upper !== false) txt = txt.toUpperCase();
    const fam = '"' + (T.font || 'Roboto Condensed') + '", "Barlow Condensed", Arial Narrow, sans-serif', weight = T.weight || 700;
    let size = T.size > 0 ? T.size : chh * 0.53, tw = 0;
    if (txt) { c.save(); c.font = `${weight} ${size}px ${fam}`; tw = c.measureText(txt).width; c.restore(); }
    const pad = 0.3 * chh, minWb = sb * (fixedBox + 0.02 * zoneSrc);
    if (T.autoWidth && T.pos !== 'full') {
      width = tw + 2 * pad + (lw > 0 ? lw - 0.02 * chh : 0) + (lw > 0 ? 1 : 2) * inset;
      width = Math.max(width, T.minW || 0, minWb); if (width > maxW) width = maxW;       // too long even at full width: the text shrinks below
    } else if (stretch) width = Math.max(width, minWb);
    const barL0 = T.pos === 'ur' ? W - m - width : m, barL = barL0 + (T.dx || 0), barT = T.y == null ? 40 : T.y;
    let p = 1; const mode = T.anim === 'auto' ? (T.pos === 'ur' ? 'in-right' : T.pos === 'full' ? 'in-top' : 'in-left') : (T.anim || 'none');
    if (!editing) { const d = T.delay == null ? 0.2 : T.delay; if (t < d) return; p = ease.out(clamp((t - d) / 0.7, 0, 1)); }
    c.save();
    if (mode === 'fade') c.globalAlpha *= p; else if (mode === 'in-left') c.translate(-(1 - p) * (barL + width + 200), 0); else if (mode === 'in-right') c.translate((1 - p) * (W - barL + 200), 0); else if (mode === 'in-top') c.translate(0, -(1 - p) * (barT + chh + 300));
    const top = barT - bb[1] * sb, dh = A.bar.h * sb;
    if (!stretch) c.drawImage(bar, barL - bb[0] * sb, top, A.bar.w * sb, A.bar.h * sb);
    else {
      const f = Math.max(0.02, (width / sb - fixedBox) / zoneSrc), cuts = TB2.cuts; let dx = barL - TB2.boxL * sb;   // dest x of source x=0
      for (let i = 0; i < cuts.length - 1; i++) {
        const sx = cuts[i], sw = cuts[i + 1] - sx, k = TB2.zones.includes(i) ? f * sb : sb, dw = sw * k, over = i < cuts.length - 2 ? 0.8 : 0;   // 0.8 px overlap hides hairline seams
        c.drawImage(bar, sx, 0, sw + over / k, A.bar.h, dx, top, dw + over, dh); dx += dw;
      }
    }
    let logoL = barL + width;
    if (lw > 0) { logoL = barL + width + chh * 0.02 - lw; const lbh = lb[3] - lb[1], ly = barT + chh / 2 - (lbh * sl) / 2; c.drawImage(logo, logoL - lb[0] * sl, ly - lb[1] * sl, A.logo.w * sl, A.logo.h * sl); }
    // text: centred in the silver panel — horizontally between its left edge and the logo, vertically on the panel's centre line
    const whiteL = barL + inset, whiteR = lw > 0 ? logoL : barL + width - inset, availL = whiteL + pad * 0.55, availR = whiteR - pad * 0.55, availW = Math.max(40, availR - availL);
    if (txt) {
      c.font = `${weight} ${size}px ${fam}`; tw = c.measureText(txt).width; if (tw > availW) { size = size * availW / tw; c.font = `${weight} ${size}px ${fam}`; tw = c.measureText(txt).width; }
      c.textBaseline = 'middle'; c.textAlign = 'left'; const mh = c.measureText('H'), capShift = ((mh.actualBoundingBoxAscent || size * 0.35) - (mh.actualBoundingBoxDescent || 0)) / 2;
      const tx = T.align === 'left' ? availL : T.align === 'right' ? availR - tw : whiteL + (whiteR - whiteL - tw) / 2, ty = barT + chh * TB2.silverCY + capShift;
      E.drawFxLines(c, [txt], tx, ty, size * 1.1, T.fx, T.color || '#07345a', size);
    }
    c.restore();
  }

  function drawTitle(c, show, scene, t, editing) {
    const T = scene.title; if (!T || !T.show || (!T.text && !T.sub)) return;
    const a = editing ? 1 : ease.out(clamp(t / 0.8, 0, 1)); if (a <= 0) return;
    const ts = T.size || 66, ss = Math.round(ts * 0.46); c.save();
    c.font = `800 ${ts}px ${FONT()}`; const tw = T.text ? c.measureText(T.text.toUpperCase()).width : 0; c.font = `600 ${ss}px ${FONT()}`; const sw = T.sub ? c.measureText(T.sub).width : 0;
    const w = Math.max(tw, sw) + 90, h = (T.text ? ts * 1.05 : 0) + (T.sub ? ss * 1.5 : 0) + 34, x = 60, y = (T.pos === 'bottom-left') ? H - 56 - h : 52, rw = w * a;
    c.beginPath(); c.rect(x, y - 10, rw, h + 20); c.clip();
    c.fillStyle = 'rgba(7,18,34,0.80)'; rrect(c, x, y, w, h, 8); c.fill();
    c.fillStyle = show.accent || '#2f9bff'; c.fillRect(x, y, 14, h);
    c.textBaseline = 'top'; c.globalAlpha = clamp((a - 0.35) / 0.65, 0, 1);
    let ty = y + 14; if (T.text) { c.font = `800 ${ts}px ${FONT()}`; c.fillStyle = '#fff'; c.fillText(T.text.toUpperCase(), x + 40, ty); ty += ts * 1.05; }
    if (T.sub) { c.font = `600 ${ss}px ${FONT()}`; c.fillStyle = '#b9d6f5'; c.fillText(T.sub, x + 40, ty + 2); }
    c.restore();
  }
  function drawBug(c, show) {
    const lg = show.logo && E.img(show, show.logo);
    if (lg) { const s = Math.min(240 / lg.width, 120 / lg.height); c.save(); c.globalAlpha = 0.95; c.drawImage(lg, W - 56 - lg.width * s, 46, lg.width * s, lg.height * s); c.restore(); }
    else if (show.bugText) { c.save(); c.font = `800 38px ${FONT()}`; const w = c.measureText(show.bugText.toUpperCase()).width + 44; c.fillStyle = 'rgba(7,18,34,0.78)'; rrect(c, W - 56 - w, 50, w, 62, 8); c.fill(); c.fillStyle = show.accent; c.fillRect(W - 56 - w, 50, 8, 62); c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.fillText(show.bugText.toUpperCase(), W - 56 - w + 24, 82); c.restore(); }
  }
  E.renderScene = function (c, show, scene, t, opts) {
    opts = opts || {}; const editing = !!opts.editing, ct = opts.camT != null ? opts.camT : t, xf = E.xf(scene, ct);
    c.save(); c.clearRect(0, 0, W, H);
    const guard = (fn) => { try { fn(); } catch (err) { c.restore(); c.save(); E.lastErr = err; if (E.onDrawError) E.onDrawError(err); } };
    // Select decoded frame BEFORE drawing Mapbox. It is inserted as a
    // raster layer inside Mapbox, below all label/line overlays. WXData.draw
    // must never paint over city names on the completed 2D canvas.
    if(g.WXData?.useMapboxUnderlay)
      guard(() => g.WXData.useMapboxUnderlay(scene,t,opts));
    guard(() => drawBackground(c, show, scene, t, ct, opts));
    if (scene.dataLoop && scene.dataLoop.on && g.WXData) guard(() => g.WXData.draw(c, scene, t, opts, xf));
    scene.objects.forEach(o => { if (!o.hidden) guard(() => drawObjectAnimated(c, o, scene, xf, t, show, editing)); });
    if (scene.dataLoop && scene.dataLoop.on && g.WXData) guard(() => g.WXData.drawBar(c, scene, t, opts));
    guard(() => drawTitle(c, show, scene, t, editing)); guard(() => drawTitle2(c, show, scene, t, editing)); guard(() => drawBug(c, show));
    c.restore();
  };

  /* ---------- schedule + transitions ---------- */
  E.starts = show => { let s = 0; return show.scenes.map(sc => { const a = s; s += sc.duration; return a; }); };
  E.total = show => show.scenes.reduce((a, s) => a + s.duration, 0);
  let bufA = null, bufB = null;
  function buf(i) { const mk = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; return cv; }; if (i === 0) return bufA || (bufA = mk()); return bufB || (bufB = mk()); }
  function accentBar(c, x, y0, y1, accent, skew) { c.save(); c.fillStyle = accent; c.beginPath(); c.moveTo(x, y0); c.lineTo(x + 90, y0); c.lineTo(x + 90 - skew, y1); c.lineTo(x - skew, y1); c.closePath(); c.fill(); c.fillStyle = '#fff'; c.fillRect(x + 100, 0, 6, 0); c.restore(); }
  function composite(c, A, B, type, p, accent) {
    const e = ease.inout(p); c.save();
    switch (type) {
      case 'fade-black': c.fillStyle = '#000'; c.fillRect(0, 0, W, H); if (e < 0.5) { c.globalAlpha = 1 - e * 2; c.drawImage(A, 0, 0); } else { c.globalAlpha = (e - 0.5) * 2; c.drawImage(B, 0, 0); } break;
      case 'wipe-right': c.drawImage(A, 0, 0); c.save(); c.beginPath(); c.rect(0, 0, W * e, H); c.clip(); c.drawImage(B, 0, 0); c.restore(); c.fillStyle = accent; c.fillRect(W * e - 4, 0, 8, H); break;
      case 'wipe-left': c.drawImage(A, 0, 0); c.save(); c.beginPath(); c.rect(W * (1 - e), 0, W * e, H); c.clip(); c.drawImage(B, 0, 0); c.restore(); c.fillStyle = accent; c.fillRect(W * (1 - e) - 4, 0, 8, H); break;
      case 'wipe-up': c.drawImage(A, 0, 0); c.save(); c.beginPath(); c.rect(0, H * (1 - e), W, H * e); c.clip(); c.drawImage(B, 0, 0); c.restore(); c.fillStyle = accent; c.fillRect(0, H * (1 - e) - 4, W, 8); break;
      case 'push-left': c.drawImage(A, -W * e, 0); c.drawImage(B, W * (1 - e), 0); break;
      case 'push-right': c.drawImage(A, W * e, 0); c.drawImage(B, -W * (1 - e), 0); break;
      case 'zoom': { const s1 = 1 + e * 0.6; c.globalAlpha = 1 - e; c.translate(W / 2, H / 2); c.scale(s1, s1); c.translate(-W / 2, -H / 2); c.drawImage(A, 0, 0); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = e; const s2 = 0.82 + e * 0.18; c.translate(W / 2, H / 2); c.scale(s2, s2); c.translate(-W / 2, -H / 2); c.drawImage(B, 0, 0); break; }
      case 'iris': c.drawImage(A, 0, 0); c.save(); c.beginPath(); c.arc(W / 2, H / 2, e * Math.hypot(W, H) / 2, 0, TAU); c.clip(); c.drawImage(B, 0, 0); c.restore(); c.strokeStyle = accent; c.lineWidth = 8; c.beginPath(); c.arc(W / 2, H / 2, e * Math.hypot(W, H) / 2, 0, TAU); c.stroke(); break;
      case 'swipe': {                                   // broadcast swipe: slanted accent bar sweeping left→right
        const skew = 220, x = -260 + e * (W + 620); c.drawImage(A, 0, 0);
        c.save(); c.beginPath(); c.moveTo(0, 0); c.lineTo(x, 0); c.lineTo(x - skew, H); c.lineTo(0, H); c.closePath(); c.clip(); c.drawImage(B, 0, 0); c.restore();
        c.fillStyle = accent; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 70, 0); c.lineTo(x + 70 - skew, H); c.lineTo(x - skew, H); c.closePath(); c.fill();
        c.fillStyle = '#fff'; c.beginPath(); c.moveTo(x + 70, 0); c.lineTo(x + 88, 0); c.lineTo(x + 88 - skew, H); c.lineTo(x + 70 - skew, H); c.closePath(); c.fill(); break;
      }
      default: c.drawImage(A, 0, 0); c.globalAlpha = e; c.drawImage(B, 0, 0);
    }
    c.restore();
  }
  /* export helper: make sure every Mapbox frame needed at show time T is rendered before the synchronous draw */
  E.prepareFrame = async function (show, T) {
    const hasMb = g.MB && show.scenes.some(s => s.bg.type === 'mapbox'), hasVid = show.scenes.some(s => s.bg.type === 'video'), hasData = !!g.WXData && show.scenes.some(s => s.dataLoop && s.dataLoop.on);
    if (!hasMb && !hasVid && !hasData) return;
    const st = E.starts(show), tot = E.total(show); T = clamp(T, 0, Math.max(0, tot - 0.0001));
    let i = 0; while (i + 1 < st.length && T >= st[i + 1]) i++;
    const sc = show.scenes[i], t = T - st[i], tr = sc.transition || { type: 'cut', dur: 0 }, need = [];
    if (i > 0 && tr.type !== 'cut' && t < tr.dur) { need.push([show.scenes[i - 1], show.scenes[i - 1].duration + t]); need.push([sc, t]); } else need.push([sc, t]);
    for (const [s, tt] of need) {
      // Load a REAL image frame first, then render the Mapbox raster below
      // labels. Previously Mapbox snapped before data was loaded, and the
      // data was pasted ON TOP of text during export.
      if (hasData && s.dataLoop && s.dataLoop.on) await g.WXData.ensure(s);
      if (g.WXData?.useMapboxUnderlay)g.WXData.useMapboxUnderlay(s,tt,{editing:false});
      if (hasMb && s.bg.type === 'mapbox') await g.MB.snap(s.bg, E.viewAt(s, tt));
      if (s.bg.type === 'video') await E.seekVideo(s.bg, tt);
    }
  };
  E.renderShow = function (c, show, T, opts) {
    const st = E.starts(show), tot = E.total(show); T = clamp(T, 0, Math.max(0, tot - 0.0001));
    let i = 0; while (i + 1 < st.length && T >= st[i + 1]) i++;
    const sc = show.scenes[i], t = T - st[i], tr = sc.transition || { type: 'cut', dur: 0 };
    if (i > 0 && tr.type !== 'cut' && t < tr.dur) {
      const prev = show.scenes[i - 1], A = buf(0), B = buf(1);
      E.renderScene(A.getContext('2d'), show, prev, prev.duration + t, opts); E.renderScene(B.getContext('2d'), show, sc, t, opts);
      c.clearRect(0, 0, W, H); composite(c, A, B, tr.type, t / tr.dur, show.accent || '#2f9bff');
    } else E.renderScene(c, show, sc, t, opts);
    return i;
  };

  /* ---------- hit-testing & editing helpers ---------- */
  E.hit = function (scene, t, sx, sy) {
    const xf = E.xf(scene, t);
    for (let i = scene.objects.length - 1; i >= 0; i--) {
      const o = scene.objects[i]; if (o.hidden || o.locked) continue; const s = toScreen(o, xf), b = E.bounds(s);
      if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) {
        if (s.pts && s.pts.length > 1 && (o.type === 'pen' || o.type === 'line' || o.type === 'arrow' || o.type === 'front' || o.type === 'flow' || o.type === 'jet')) {  // precise: near the polyline
          const poly = g.Sym.catmull(s.pts, !!s.closed, 6), tol = Math.max(14, (s.width || s.size || 8)); let ok = false;
          for (let j = 1; j < poly.length && !ok; j++) { const a = poly[j - 1], bb = poly[j], dx = bb[0] - a[0], dy = bb[1] - a[1], l2 = dx * dx + dy * dy || 1, u = clamp(((sx - a[0]) * dx + (sy - a[1]) * dy) / l2, 0, 1); ok = Math.hypot(sx - (a[0] + u * dx), sy - (a[1] + u * dy)) <= tol + (o.type === 'front' ? o.size : 0); }
          if (!ok) continue;
        }
        return o;
      }
    }
    return null;
  };
  /* move an object by a screen-space delta */
  E.move = function (o, dx, dy, xf) {
    if (o.geo && xf.mb) { const mv = p => xf.inv(xf.fwd(p[0], p[1])[0] + dx, xf.fwd(p[0], p[1])[1] + dy); if (o.pts) o.pts = o.pts.map(mv); if (o.x != null) { const q = mv([o.x, o.y]); o.x = q[0]; o.y = q[1]; } return; }
    const k = (o.geo && xf.map) ? xf.k : 1, mx = dx / k, my = dy / k;
    if (o.pts) o.pts = o.pts.map(p => [p[0] + mx, p[1] + my]); if (o.x != null) { o.x += mx; o.y += my; }
  };

  /* ---------- 7-day forecast scene builder ---------- */
  const TSTOPS = [[-10, [155, 107, 255]], [10, [74, 163, 255]], [32, [111, 211, 255]], [50, [111, 227, 176]], [65, [255, 224, 102]], [80, [255, 166, 61]], [95, [255, 90, 61]]];
  E.tempColor = function (v) {
    v = Number(v); if (!isFinite(v)) return '#ffffff'; if (v <= TSTOPS[0][0]) return `rgb(${TSTOPS[0][1].join(',')})`; if (v >= TSTOPS[TSTOPS.length - 1][0]) return `rgb(${TSTOPS[TSTOPS.length - 1][1].join(',')})`;
    for (let i = 1; i < TSTOPS.length; i++) if (v <= TSTOPS[i][0]) { const a = TSTOPS[i - 1], b = TSTOPS[i], u = (v - a[0]) / (b[0] - a[0]); return `rgb(${a[1].map((x, j) => Math.round(x + (b[1][j] - x) * u)).join(',')})`; }
  };
  E.sample7 = function () {
    const names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], d0 = new Date(); d0.setDate(d0.getDate() + 1);
    const S = [['sunny', 'Sunny', 62, 44, 0, 'MILD'], ['partly-cloudy', 'Partly Sunny', 65, 47, 10, 'BREEZY'], ['cloudy', 'Increasing Clouds', 61, 49, 20, ''], ['showers-day', 'Showers Likely', 58, 46, 60, ''], ['rain', 'Rain', 55, 44, 80, 'WINDY'], ['mostly-sunny', 'Clearing, Cooler', 52, 38, 10, 'COOL'], ['sunny', 'Sunny', 54, 36, 0, '']];
    return S.map((s, i) => { const d = new Date(d0); d.setDate(d.getDate() + i); return { day: names[d.getDay()], date: `${d.getMonth() + 1}/${d.getDate()}`, icon: s[0], phrase: s[1], hi: s[2], lo: s[3], pop: s[4], tag: s[5], tag2: s[6] || '' }; });
  };
  function wrapText(txt, size, maxW) {
    txt = String(txt || ''); if (!mctx || txt.indexOf('\n') >= 0) return txt; mctx.font = `600 ${size}px ${FONT()}`;
    if (mctx.measureText(txt).width <= maxW) return txt;
    const w = txt.split(' '); let best = txt, bestMax = 1e9;
    for (let i = 1; i < w.length; i++) { const l1 = w.slice(0, i).join(' '), l2 = w.slice(i).join(' '), m = Math.max(mctx.measureText(l1).width, mctx.measureText(l2).width); if (m < bestMax) { bestMax = m; best = l1 + '\n' + l2; } }
    return best;
  }
  E.build7Day = function (days, o) {
    o = o || {}; const objs = [], n = days.length, M = 60, G = 18, cw = (W - M * 2 - G * (n - 1)) / n, y0 = 250, ch = 710;
    days.forEach((d, i) => {
      const x = M + i * (cw + G), cx = x + cw / 2, dl = i * 0.14;
      const add = (type, props, ex) => { const ob = E.newObject(type, props); ob.anim = { in: 'slide-up', delay: dl + (ex || 0), dur: 0.55 }; objs.push(ob); return ob; };
      add('shape', { shape: 'round', x, y: y0, w: cw, h: ch, fill: 'rgba(7,18,34,0.72)', stroke: 'rgba(255,255,255,0.14)', lw: 2, radius: 22 });
      add('shape', { shape: 'round', x, y: y0, w: cw, h: 86, fill: 'rgba(47,155,255,0.92)', stroke: 'none', lw: 0, radius: 22 });
      add('shape', { shape: 'rect', x, y: y0 + 60, w: cw, h: 26, fill: 'rgba(47,155,255,0.92)', stroke: 'none', lw: 0 });
      add('text', { x: cx, y: y0 + 8, text: d.day, size: 60, align: 'center', color: '#fff', weight: 800 }, 0.05);
      if (d.date) add('text', { x: cx, y: y0 + 94, text: d.date, size: 28, align: 'center', color: '#9fc4ea', weight: 600 }, 0.08);
      if (d.tag) add('text', { x: cx, y: y0 + 134, text: d.tag, size: 26, align: 'center', color: '#ffd23f', weight: 800, box: true, boxColor: 'rgba(255,210,63,0.16)' }, 0.3);
      add('icon', { x: cx, y: y0 + 250, size: cw * 0.8, icon: d.icon }, 0.1);
      add('text', { x: cx, y: y0 + 350, text: wrapText(d.phrase, 28, cw - 24), size: 28, align: 'center', color: '#e6f1ff', weight: 600, font: 'display' }, 0.15);
      add('text', { x: cx, y: y0 + 428, text: 'HIGH', size: 22, align: 'center', color: '#8fb4dc', weight: 700 }, 0.2);
      add('text', { x: cx, y: y0 + 446, text: String(d.hi) + '°', size: 94, align: 'center', color: E.tempColor(d.hi), weight: 800 }, 0.2);
      add('text', { x: cx, y: y0 + 556, text: 'LOW', size: 22, align: 'center', color: '#8fb4dc', weight: 700 }, 0.25);
      add('text', { x: cx, y: y0 + 574, text: String(d.lo) + '°', size: 62, align: 'center', color: E.tempColor(d.lo), weight: 700 }, 0.25);
      if (Number(d.pop) > 0) add('pop', { x: cx - 50, y: y0 + 672, size: 38, value: d.pop + '%' }, 0.3);
    });
    return objs;
  };

  /* ---------- Billerica Weather 7-day layout (fits the supplied template background) ---------- */
  /* Visible art of an icon, as fractions of its box: top edge and width (solid pixels only, so glow/rain mist is ignored). */
  const iconBoxCache = {};
  function iconVis(name) {
    if (name in iconBoxCache) return iconBoxCache[name];
    let r = { top: 0.12, w: 0.62, h: 0.62 };
    try {
      const size = 200, pad = 100, N = size + pad * 2, cv = document.createElement('canvas'); cv.width = N; cv.height = N; const cx = cv.getContext('2d', { willReadFrequently: true });
      g.Icons.draw(cx, name, N / 2, N / 2, size, 0.5); const d = cx.getImageData(0, 0, N, N).data; let minY = -1, maxY = -1, minX = N, maxX = -1;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3] > 130) { if (minY < 0) minY = y; maxY = y; if (x < minX) minX = x; if (x > maxX) maxX = x; }
      if (minY >= 0 && maxX > minX) r = { top: (minY - (N / 2 - size / 2)) / size, w: (maxX - minX + 1) / size, h: (maxY - minY + 1) / size };
    } catch (err) { /* keep fallback */ }
    return (iconBoxCache[name] = r);
  }
  /* One consistent visual size for every icon: match the art's overall mass (geometric mean of its visible width and height),
     so a round sun, a wide flat cloud and a cloud with falling rain all look about the same size. */
  function iconFit(name, colW) { const v = iconVis(name), mass = Math.sqrt(Math.max(0.05, v.w) * Math.max(0.05, v.h)), sz = Math.max(colW * 0.5, Math.min(colW * 1.2, colW * 0.62 / mass)); return { sz: Math.round(sz), off: v.top * sz }; }
  E.build7DayBW = function (days) {
    const f = 1920 / 1672, S = v => v * f, objs = [];
    const COLS = [[25, 281], [298, 553], [573, 828], [846, 1102], [1119, 1375]], RC = [1394, 1650], LOWS = [[206, 370], [480, 643], [754, 917], [1029, 1192]];
    const NAVY = 'rgba(8,36,92,0.97)', ORANGE = '#f28a1c', GREEN = '#25d450', LOWC = '#7fcfff';
    const MAGENTA = 'rgba(255,0,198,0.65)';
    const mk = (d, i, x0, x1, y0, y1, delay, panelB) => {
      const add = (type, props, ex) => { const ob = E.newObject(type, props); ob.anim = { in: 'slide-up', delay: delay + (ex || 0), dur: 0.5 }; objs.push(ob); return ob; };
      const wk = /^(SAT|SUN)/i.test(d.day), x = S(x0), w = S(x1 - x0), cx = x + w / 2;
      if (d.hl) add('shape', { shape: 'rect', x: x, y: S(y0) + S(72), w, h: panelB - S(y0) - S(72), fill: MAGENTA, stroke: 'rgba(255,255,255,0.55)', lw: 2 }, 0);
      add('shape', { shape: 'rect', x, y: S(y0), w, h: S(72), fill: wk ? ORANGE : NAVY, stroke: 'rgba(255,255,255,0.8)', lw: 2 });
      add('shape', { shape: 'rect', x, y: S(y0), w, h: S(36), fill: 'rgba(255,255,255,0.12)', stroke: 'none', lw: 0 });
      add('text', { x: cx, y: S(y0 + 36) - 34, text: d.day, size: 76, align: 'center', color: '#fff', weight: 800 }, 0.04);
      return { add, cx, w, x };
    };
    days.slice(0, 5).forEach((d, i) => {
      const [x0, x1] = COLS[i], c = mk(d, i, x0, x1, 168, 240, i * 0.14, 948), add = c.add, cx = c.cx;
      { const f2 = iconFit(d.icon, c.w), top = S(240) + 13 + 44; add('icon', { x: cx, y: top - f2.off + f2.sz / 2, size: f2.sz, icon: d.icon }, 0.1); }
      if (d.tag2) add('text', { x: cx, y: S(468) - 26, text: String(d.tag2).toUpperCase(), size: 48, align: 'center', color: '#bfe6ff', weight: 800 }, 0.25);
      add('text', { x: cx, y: S(500), text: wrapText(String(d.phrase || '').toUpperCase(), 30, c.w - 30), size: 30, align: 'center', color: '#ffffff', weight: 700, font: 'display' }, 0.15);
      if (d.tag) add('text', { x: cx, y: S(677) - 44, text: String(d.tag).toUpperCase(), size: 52, align: 'center', color: '#ffd23f', weight: 800 }, 0.3);
      add('text', { x: cx, y: S(727) - 36, text: (Number(d.pop) || 0) + '%', size: 36, align: 'center', color: GREEN, weight: 800 }, 0.3);
      add('text', { x: cx, y: S(782) - 60, text: String(d.hi) + '°', size: 112, align: 'center', color: '#eef3fb', weight: 800 }, 0.2);
      if (i < 4 && days[i].lo != null && days[i].lo !== '') { const lx = S(LOWS[i][0] + LOWS[i][1]) / 2; const o = E.newObject('text', { x: lx, y: S(879) - 43, text: String(days[i].lo) + '°', size: 74, align: 'center', color: LOWC, weight: 800 }); o.anim = { in: 'slide-up', delay: i * 0.14 + 0.35, dur: 0.5 }; objs.push(o); }
    });
    [[5, 168, 243], [6, 556, 630]].forEach(([i, hy, by], n) => {
      const d = days[i]; if (!d) return; const c = mk(d, i, RC[0], RC[1], hy, hy + 72, 0.7 + n * 0.14, n ? 1070 : 628), add = c.add, cx = c.cx;
      { const f2 = iconFit(d.icon, c.w), top = S(hy + 72) + 13 + 14; add('icon', { x: cx, y: top - f2.off + f2.sz / 2, size: f2.sz, icon: d.icon }, 0.1); }
      add('text', { x: cx, y: S(by + 226) - 34, text: (Number(d.pop) || 0) + '%', size: 36, align: 'center', color: GREEN, weight: 800 }, 0.25);
      add('text', { x: cx, y: S(by + 276) - 44, text: String(d.hi) + '°', size: 84, align: 'center', color: '#eef3fb', weight: 800 }, 0.2);
    });
    return objs;
  };
  E.sceneFromBW = function (days, assetId) {
    return E.newScene({ name: '7-Day Forecast', duration: 10, bg: { type: 'image', asset: assetId, kenburns: false }, title: { show: false, text: '', sub: '' }, objects: E.build7DayBW(days) });
  };
  E.sceneFrom7Day = function (days, titleText, sub) {
    return E.newScene({ name: '7-Day Forecast', duration: 10, bg: { type: 'gradient', grad: 'sky' }, title: { show: true, text: titleText || '7-Day Forecast', sub: sub || 'Billerica, MA' }, objects: E.build7Day(days) });
  };


  /* ---------- scene templates ---------- */
  /* v0.10.1.2: the headline / storm templates use your finished artwork (studio/tpl_art.js, `WX_TPL`): the banner and the four bars are part of the
     background picture, and the title and the bar text are live text laid over it - centred, shrunk to fit and wrapped to two lines.
     Geometry is in 1920x1080 stage pixels (measured from the artwork). */
  const STD_BANNER = { l: 186, r: 1272, cy: 102, h: 88 };
  const barRows = (x, w, h, ys) => ys.map(y => ({ x, y, w, h }));
  E.TPL_ART = {
    'hl-sky': { asset: 'tpl_hl_sky', title: 'Weather Headlines', banner: { l: 258, r: 1318, cy: 110, h: 88 }, titleSize: 84, bars: barRows(349, 1220, 136, [290, 472, 653, 842]), padX: 46, padY: 16, textSize: 54, kind: 'glass' },
    'hl-night': { asset: 'tpl_hl_night', title: 'Weather Headlines', banner: STD_BANNER, titleSize: 84, bars: barRows(418, 1085, 169, [250, 452, 655, 858]), padX: 74, padY: 18, textSize: 64, kind: 'blue' },
    'hl-day': { asset: 'tpl_hl_day', title: 'Weather Headlines', banner: STD_BANNER, titleSize: 84, bars: barRows(418, 1085, 169, [250, 452, 655, 858]), padX: 74, padY: 18, textSize: 64, kind: 'blue' },
    'storm-night': { asset: 'tpl_storm_night', title: 'Storm Update', banner: STD_BANNER, titleSize: 84, bars: barRows(415, 1089, 169, [250, 452, 655, 858]), padX: 76, padY: 18, textSize: 64, kind: 'red' },
    'storm-day': { asset: 'tpl_storm_day', title: 'Storm Update', banner: STD_BANNER, titleSize: 84, bars: barRows(415, 1089, 169, [250, 452, 655, 858]), padX: 76, padY: 18, textSize: 64, kind: 'red' }
  };
  E.TEMPLATES = [['hl-sky', 'Weather Headlines – sky (glass boxes)'], ['hl-night', 'Weather Headlines – night (blue bars)'], ['hl-day', 'Weather Headlines – day (blue bars)'],
    ['storm-night', 'Storm Update – night (red bars)'], ['storm-day', 'Storm Update – day (red bars)'], ['impacts', 'Storm Impacts (over current map)']];
  E.sharedBarSize = function (art, lines) {
    const max = art.textSize; if (!mctx || !lines.length) return max;
    for (let sz = max; sz > 14; sz--) {
      mctx.font = fontFor({ weight: 800, size: sz, font: 'sans' });
      if (lines.every((ln, i) => { const b = art.bars[i], bw = b.w - 2 * art.padX, ls = wrapLines(String(ln).toUpperCase().split('\n'), bw); return ls.length <= 2 && ls.length * sz * 1.15 <= b.h - 2 * art.padY && Math.max(...ls.map(l => mctx.measureText(l).width)) <= bw; })) return sz;
    }
    return 14;
  };
  E.buildTemplate = function (kind, o) {
    const objs = [], lines = (o.lines || []).filter(x => String(x).trim()), m = o.safe || 48;
    const add = (type, props, delay) => { const ob = E.newObject(type, props); ob.anim = { in: props.anim || 'fade', delay: delay || 0, dur: 0.6 }; delete ob.anim.undefined; objs.push(ob); return ob; };
    const art = E.TPL_ART[kind];
    if (art) {
      // every bar gets the SAME size: the number given, or (blank/0) the largest size at which all the lines fit on two lines
      const use = lines.slice(0, art.bars.length), sz = o.size > 0 ? o.size : E.sharedBarSize(art, use);
      use.forEach((ln, i) => {
        const b = art.bars[i], t = add('text', { x: b.x + b.w / 2, y: b.y + b.h / 2, text: String(ln).toUpperCase(), size: sz, align: 'center', font: 'sans', color: '#ffffff', weight: 800, wrapW: b.w - 2 * art.padX, fitBox: true, fitH: b.h - 2 * art.padY, maxLines: 2, autoFit: true, anim: 'fade' }, 0.5 + i * 0.35);
        t.fx = E.fxDefault(); t.fx.stroke.on = false; t.fx.shadow = Object.assign({}, t.fx.shadow, { on: true, color: '#000000', opacity: art.kind === 'glass' ? 55 : 70, angle: 90, dist: 3, size: 6 });
      });
      return objs;
    }
    const title = add('text', { x: m, y: m - 4, text: (o.title || 'STORM UPDATE').toUpperCase(), size: 110, align: 'left', anim: 'in-left' }, 0); E.applyTextPreset(title, 'titlebar');
    if (kind === 'storm' || kind === 'headlines') {
      const y0 = 260, step = lines.length > 4 ? 150 : 200;
      lines.slice(0, 6).forEach((ln, i) => { const t = add('text', { x: 1000, y: y0 + i * step, text: String(ln).toUpperCase(), size: kind === 'storm' ? 48 : 58, align: 'center', wrapW: kind === 'storm' ? 1300 : 1400, anim: 'in-bottom' }, 0.5 + i * 0.35); E.applyTextPreset(t, kind === 'storm' ? 'red' : 'glass'); t.box = true; });
    } else {
      if (lines[0]) { const t = add('text', { x: m, y: 1080 - m - 80, text: String(lines[0]).toUpperCase(), size: 60, align: 'left' }, 0.4); E.applyTextPreset(t, 'glass'); }
      lines.slice(1, 5).forEach((ln, i) => { const t = add('text', { x: 1920 - m - 400, y: 280 + i * 190, text: String(ln).toUpperCase(), size: 48, align: 'center', wrapW: 700, anim: 'in-right' }, 0.6 + i * 0.35); E.applyTextPreset(t, 'red'); t.box = true; });
      add('text', { x: 1920 - m, y: 1080 - m - 70, text: 'Valid', auto: 'valid', size: 40, align: 'right' }, 0.3);
    }
    return objs;
  };
  E.sceneFromTemplate = function (kind, o, bg) {
    const art = E.TPL_ART[kind], nm = (E.TEMPLATES.find(t => t[0] === kind) || [0, 'Template'])[1].replace(/ –.*| \(.*/, '');
    const sc = E.newScene({ name: art ? nm + (/night/.test(kind) ? ' (night)' : /day/.test(kind) ? ' (day)' : '') : nm, duration: 10, bg: art ? { type: 'image', asset: art.asset, kenburns: false, fit: 'fill' } : (bg || { type: 'image', asset: 'bgdefault', kenburns: false, fit: 'fill' }), title: { show: false, text: '', sub: '' }, objects: E.buildTemplate(kind, o) });
    if (art) sc.title2 = Object.assign(E.title2Default(), { show: true, textOnly: true, region: Object.assign({}, art.banner), text: o.title || art.title, size: o.titleSize > 0 ? o.titleSize : art.titleSize, font: 'Barlow', align: 'center', anim: 'fade', delay: 0.1 });
    return sc;
  };

  g.Engine = E;
})(typeof window !== 'undefined' ? window : globalThis);
