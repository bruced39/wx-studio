/* WX Studio — Weather Data workspace (front-end only).
 *
 * An expandable, AguaceroWX-style side panel that replaces the dock's small data flyout:
 *   Weather layer (visibility / opacity / loop length / playback / palette / layer position)
 *   Satellite · Radar (MRMS + NEXRAD sites) · RTMA · Forecast Models
 *   Weather Color Palettes (preview, select, import, export, edit copies, cloud sync)
 *   Cloud & data status (is the NOAA cloud processor really connected?)
 *   Demo patterns (synthetic, never labelled as NOAA)
 *
 * It owns NO data, NO processing and NO storage. It only reads what ChatGPT's modules already publish:
 *   WXData (sources, state, classify, productOf, setPalette, paletteChoices)   — studio/dataloop.js
 *   WXWeatherSources (catalog) · WXWeatherPalettes · WXWeatherPaletteCloud · WXWeatherRadarSites
 *   WXWeatherProcessorBridge (status of the cloud processor)
 * and writes only the same scene fields the dock already writes (scene.dataLoop.*).
 * Loaded AFTER dataloop.js and weather/*.js. If anything here throws, the dock's original flyout is used instead.
 */
(function (g) {
  'use strict';
  const W = g.WXWeatherWorkspace = { version: 1,
    capabilities: { layerPosition: !!g.MB?.weatherLayerPositionSupported },
    ui: null, util: {} };
  const U = W.util;

  /* ====================== pure helpers (unit-tested without a browser) ====================== */
  U.normHex = function (s) {
    s = String(s == null ? '' : s).trim();
    let m = /^#?([0-9a-f]{6})$/i.exec(s); if (m) return '#' + m[1].toLowerCase();
    m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s); if (m) return ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase();
    m = /^(?:rgb\()?\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)?$/i.exec(s);
    if (m && [1, 2, 3].every(i => +m[i] <= 255)) return '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('');
    return null;
  };
  U.slug = (s, n) => String(s || 'palette').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n || 40) || 'palette';
  /* Accepts: our JSON export, a bare JSON array of stops, [{value,color}], or text lines "value,#hex" / "value #hex" / "value r g b". */
  U.parsePalette = function (text) {
    const t = String(text == null ? '' : text).replace(/^﻿/, '').trim(); if (!t) throw new Error('The file is empty.');
    let meta = {}, raw;
    if (t[0] === '{' || t[0] === '[') {
      let j; try { j = JSON.parse(t); } catch (e) { throw new Error('This is not valid JSON.'); }
      if (Array.isArray(j)) raw = j; else { meta = { name: j.name, category: j.category, productId: j.productId || j.product_id, units: j.units, continuous: j.continuous }; raw = j.stops; }
      if (!Array.isArray(raw)) throw new Error('No "stops" list found.');
    } else {
      raw = []; t.split(/\r?\n/).forEach((line, i) => {
        line = line.trim(); if (!line || line[0] === '#' || line[0] === '/') return;
        const tok = line.split(/[,;\t ]+/).filter(Boolean), v = Number(tok[0]);
        if (!Number.isFinite(v)) { if (raw.length === 0) return; throw new Error('Line ' + (i + 1) + ': "' + tok[0] + '" is not a number.'); }
        raw.push([v, tok.length >= 4 ? tok.slice(1, 4).join(',') : tok[1]]);
      });
    }
    const stops = raw.map((s, i) => {
      const v = Array.isArray(s) ? Number(s[0]) : Number(s && (s.value != null ? s.value : s.v)), c = U.normHex(Array.isArray(s) ? s[1] : s && (s.color || s.c || s.hex));
      if (!Number.isFinite(v)) throw new Error('Stop ' + (i + 1) + ' has no numeric value.');
      if (!c) throw new Error('Stop ' + (i + 1) + ' has an unreadable color (use #RRGGBB).');
      return [v, c];
    }).sort((a, b) => a[0] - b[0]);
    if (stops.length < 2) throw new Error('A palette needs at least 2 color stops.');
    if (stops.length > 256) throw new Error('A palette can have at most 256 color stops.');
    for (let i = 1; i < stops.length; i++) if (stops[i][0] === stops[i - 1][0]) throw new Error('Two stops share the value ' + stops[i][0] + '.');
    return Object.assign(meta, { stops });
  };
  const hexRGB = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  /* RGBA lookup (steps entries) across the palette's value range: stepped like the NWS legends, or blended when `continuous`. */
  U.lutFromStops = function (stops, continuous, steps) {
    steps = steps || 200; const lo = stops[0][0], hi = stops[stops.length - 1][0], out = new Uint8ClampedArray(steps * 4);
    for (let i = 0; i < steps; i++) {
      const v = lo + (hi - lo) * i / (steps - 1); let k = 0; while (k + 1 < stops.length && v >= stops[k + 1][0]) k++;
      const a = hexRGB(stops[k][1]); let c = a;
      if (continuous && k + 1 < stops.length) { const b = hexRGB(stops[k + 1][1]), f = (v - stops[k][0]) / (stops[k + 1][0] - stops[k][0]); c = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
      out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
    }
    return out;
  };
  /* Palette categories → readable group names, in menu order. */
  U.PAL_CATEGORIES = [['radar', 'Radar'], ['satellite', 'Satellite'], ['rtma', 'RTMA'], ['models', 'Forecast Models'], ['custom', 'Custom']];
  /* group palettes by category then by the product they belong to; palettes naming no product go under "All products". */
  U.groupPalettes = function (list, labelOf) {
    const out = {}; list.forEach(p => {
      const cat = out[p.category] = out[p.category] || {}, keys = p.productIds && p.productIds.length ? p.productIds : ['*'];
      keys.forEach(k => { (cat[k] = cat[k] || { key: k, label: k === '*' ? 'All ' + p.category + ' products' : (labelOf ? labelOf(k) : k), items: [] }).items.push(p); });
    });
    return out;
  };
  /* What the NOAA cloud processor bridge is really doing, in words a person can trust. Never says "connected" unless it has fresh products. */
  U.bridgeSummary = function (BR, now) {
    if (!BR) return { state: 'missing', pill: 'notconnected', title: 'Not connected', short: 'Not loaded', detail: 'The cloud processor module is not loaded.' };
    const when = BR.lastCheck ? ' · checked ' + new Date(BR.lastCheck).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    switch (BR.status) {
      case 'available': return { state: 'online', pill: 'connected', title: 'Connected', short: (BR.products || []).length + ' NOAA product' + ((BR.products || []).length === 1 ? '' : 's') + ' listed', detail: (BR.products || []).length + ' NOAA product' + ((BR.products || []).length === 1 ? '' : 's') + ' listed by the processor' + when };
      case 'no-fresh-data': return { state: 'nofresh', pill: 'experimental', title: 'No fresh data', short: 'Reachable, no current observations', detail: 'The processor answered but has no current NOAA observations yet' + when };
      case 'checking': return { state: 'checking', pill: 'notconnected', title: 'Checking…', short: 'Contacting processor…', detail: 'Contacting the cloud processor' };
      case 'unavailable': return { state: 'unavailable', pill: 'notconnected', title: 'Not connected', short: 'Processor unreachable', detail: 'The processor could not be reached' + (BR.error ? ' (' + BR.error + ')' : '') + when };
      default: return { state: 'notconfigured', pill: 'notconnected', title: 'Not connected', short: 'No processor set up yet', detail: 'No cloud processor address is set yet (WX_WEATHER_PROCESSOR_URL), so no processed NOAA radar or satellite is available.' };
    }
  };

  /* ====================== data-source diagnostics: pure logic (unit-tested, no DOM) ======================
   * One question answered per source: "can I trust this on air?"  LIVE is shown ONLY when a real frame from the processor
   * has been downloaded AND decoded (by the Verify check, or by the active weather loop itself) and is recent enough. */
  const SAT_ID = /^goes-(east|west)-(conus|full|meso1|meso2)-(C02|C13)$/;
  const SECT = { conus: 'CONUS', full: 'Full Disk', meso1: 'Mesoscale 1', meso2: 'Mesoscale 2' };
  U.SAT_PRODUCTS = []; ['east', 'west'].forEach(s => ['conus', 'full', 'meso1', 'meso2'].forEach(x => ['C02', 'C13'].forEach(c => U.SAT_PRODUCTS.push('goes-' + s + '-' + x + '-' + c))));
  U.STATE_LABEL = { live: 'LIVE · verified', connected: 'Connected · not verified', stale: 'Stale', waiting: 'Waiting', unavailable: 'Unavailable', notconnected: 'Not connected', experimental: 'Experimental preview', demo: 'Demo · synthetic' };
  /* short words for the dock badge and the exported bar (long words would collide with the next label) */
  U.BADGE = { live: 'LIVE', connected: 'UNVERIFIED', stale: 'STALE', waiting: 'WAITING', unavailable: 'UNAVAILABLE', notconnected: 'OFFLINE', experimental: 'PREVIEW', demo: 'DEMO' };
  U.BADGE_COLOR = { live: '#ff5d5d', demo: '#b9a4ff', experimental: '#f5be4e', stale: '#f5be4e', waiting: '#8fb4ff', unavailable: '#ff9b9b', connected: '#9fb3cf', notconnected: '#8397b3' };
  /* Which family a processor product id belongs to, and a readable name. ONLY the ids the processor backend really produces are recognised
   * (GOES East/West C02/C13 sectors, MRMS reflectivity, NEXRAD reflectivity/velocity). RTMA and forecast-model ids are not established yet,
   * so they are NOT guessed: anything else is family 'other' (shown as unsupported, never as a source). */
  U.parseProduct = function (pid) {
    pid = String(pid || ''); let m = SAT_ID.exec(pid);
    if (m) return { family: 'satellite', kind: 'goes', sector: m[2], label: (m[1] === 'east' ? 'GOES-19 East' : 'GOES-18 West') + ' · ' + SECT[m[2]] + ' · ' + (m[3] === 'C02' ? 'Visible 0.5 km' : 'Clean IR 2 km') };
    if (pid === 'mrms-reflectivity') return { family: 'radar', kind: 'mrms', label: 'MRMS reflectivity · 1 km national mosaic' };
    m = /^nexrad-(reflectivity|velocity)-(K[A-Z0-9]{3})$/.exec(pid); if (m) return { family: 'radar', kind: 'nexrad', site: m[2], label: 'NEXRAD ' + m[2] + (m[2] === 'KBOX' ? ' (Boston)' : '') + ' · ' + (m[1] === 'reflectivity' ? 'base reflectivity' : 'radial velocity') + ' · Level II' };
    return { family: 'other', kind: 'other', label: pid };
  };
  /* FRESHNESS LIMITS — minutes the newest observation may be old before the product is called Stale.
   * PROVISIONAL (roughly 3x the normal scan interval plus latency). This table is the one place to adjust them.
   * The processor itself drops anything older than 50 minutes from /catalog. */
  U.FRESH_MINUTES = { mrms: 15, nexrad: 20, goesConus: 20, goesFull: 30, goesMeso: 10, other: 30 };
  U.freshWindowMin = function (pid) {
    const i = U.parseProduct(pid), T = U.FRESH_MINUTES;
    if (i.kind === 'mrms') return T.mrms; if (i.kind === 'nexrad') return T.nexrad;
    if (i.kind === 'goes') return i.sector === 'full' ? T.goesFull : i.sector === 'conus' ? T.goesConus : T.goesMeso;
    return T.other;
  };
  U.fmtAge = function (ms) {
    if (!Number.isFinite(ms)) return 'unknown'; const m = Math.round(ms / 60000); if (m < 1) return 'just now'; if (m < 90) return m + ' min ago';
    const h = Math.floor(m / 60); return h + ' h ' + (m % 60) + ' min ago';
  };
  /* input: { proc:{configured,local,reach:'ok'|'fail'|'unknown',error,healthStatus}, meta:{latest,earliest,count}|null (as listed by /catalog),
   *          registered, verify:{ok,t,error}|null, loop:{n,newest,status,error}|null, dropped, windowMin, now } */
  U.sourceState = function (i) {
    const now = i.now == null ? Date.now() : i.now, P = i.proc || {}, win = i.windowMin || 30;
    const out = (state, why, extra) => Object.assign({ state, label: U.STATE_LABEL[state], why: why || '', windowMin: win, ageMin: null, verified: false }, extra);
    if (!P.configured) return out('notconnected', 'No NOAA processor is enabled, so there is no data source for this product.');
    if (P.reach === 'fail') return P.local
      ? out('waiting', 'The local NOAA processor is not answering' + (P.error ? ' (' + P.error + ')' : '') + '. Start it, then run diagnostics again.', { label: 'Waiting for local processor' })
      : out('unavailable', 'The NOAA processor cannot be reached' + (P.error ? ' (' + P.error + ')' : '') + '.');
    if (P.reach !== 'ok') return out('waiting', 'Contacting the processor…', { label: 'Checking…' });
    const v = i.verify, lp = i.loop, meta = i.meta;
    if (v && v.ok === false) return out('unavailable', 'Frame check failed: ' + v.error);
    if (lp && lp.status === 'error') return out('unavailable', lp.error || 'The weather loop could not load frames.');
    const cand = [v && v.ok ? v.t : null, lp && lp.n > 0 ? lp.newest : null].filter(Number.isFinite), vt = cand.length ? Math.max.apply(null, cand) : null;
    if (vt == null && lp && lp.status === 'loading') return out('connected', 'Downloading and decoding frames…', { label: 'Loading frames' });
    if (!meta && vt == null) {
      if (i.dropped) return out('stale', 'This product was listed earlier, but no new observation has arrived for over 50 minutes.');
      return out('waiting', P.healthStatus === 'waiting-for-real-noaa-frames'
        ? 'The processor is running but has not published fresh decoded observations yet (first downloads can take several minutes).'
        : 'The processor has no fresh observation for this product yet (not downloaded or decoded, or NOAA has not published one).', { label: 'Waiting for NOAA frames' });
    }
    const newest = vt != null ? vt : meta.latest, age = (now - newest) / 60000, listedAge = meta ? (now - meta.latest) / 60000 : null;
    if (vt != null) {
      if (age <= win) return out('live', 'The newest frame was downloaded and decoded successfully and is recent.', { verified: true, ageMin: age });
      if (listedAge != null && listedAge <= win) return out('connected', 'A newer observation is listed than the one checked (' + Math.round(age) + ' min old). Press Verify frame.', { ageMin: listedAge });
      return out('stale', 'The newest decoded frame is ' + Math.round(age) + ' min old (fresh window ' + win + ' min).', { ageMin: age });
    }
    return age <= win
      ? out('connected', 'Listed by the processor with a recent observation. No frame has been downloaded and checked yet — press Verify frame.', { ageMin: age })
      : out('stale', 'The newest listed observation is ' + Math.round(age) + ' min old (fresh window ' + win + ' min).', { ageMin: age });
  };
  /* input: { endpoint, bridgeStatus, bridgeError, health:{ok,status,freshProducts,error}|null, catalog:{ok,products,error}|null } */
  U.processorState = function (i) {
    const ep = i.endpoint || '', local = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(ep), h = i.health, c = i.catalog;
    let reach = 'unknown', err = '';
    const out = (state, pill, title, short, detail) => ({ state, pill, title, short, detail, err, mode: !ep ? 'none' : local ? 'local' : 'hosted', local });
    if (!ep) return out('notconfigured', 'notconnected', 'Not connected', 'No processor enabled', 'No NOAA processor is enabled. Demo patterns work without one; for real NOAA data, start the free local processor on this computer (see "Connect local NOAA processor") and tick its checkbox in the Streamlit sidebar.');
    if (h || c) { reach = (h && h.ok) || (c && c.ok) ? 'ok' : 'fail'; err = (h && h.error) || (c && c.error) || ''; }
    else if (i.bridgeStatus === 'unavailable') { reach = 'fail'; err = i.bridgeError || ''; }
    else if (i.bridgeStatus === 'available' || i.bridgeStatus === 'no-fresh-data') reach = 'ok';
    if (reach === 'unknown') return out('checking', 'waiting', 'Checking…', 'Contacting processor…', 'Contacting ' + ep + ' …');
    if (reach === 'fail') return local
      ? out('waiting-local', 'waiting', 'Waiting for local processor', 'Waiting for local processor', 'Cannot reach ' + ep + (err ? ' (' + err + ')' : '') + '. Start the processor on this computer (see "Connect local NOAA processor"), then press Run diagnostics.')
      : out('unavailable', 'unavailable', 'Unavailable', 'Processor unreachable', 'Cannot reach the NOAA processor at ' + ep + (err ? ' (' + err + ')' : '') + '.');
    if (c && c.ok === false && c.error) return out('unavailable', 'unavailable', 'Unavailable', 'Processor error', 'The processor answered, but its catalog could not be used: ' + c.error + '.');
    const n = c && c.ok ? c.products.length : (i.bridgeStatus === 'available' ? null : 0);
    if (n === 0 || (h && h.ok && h.status === 'waiting-for-real-noaa-frames' && !n)) return out('waiting', 'waiting', 'Waiting for NOAA frames', 'Waiting for NOAA frames', 'The processor is running, but it has not published fresh decoded NOAA observations yet. First downloads can take several minutes; watch the processor window (Docker: "docker logs -f wxstudio-noaa-local").');
    return out('online', 'connected', 'Connected', n == null ? 'Processor online' : n + ' product' + (n === 1 ? '' : 's') + ' listed', (n == null ? 'The processor is online' : n + ' product' + (n === 1 ? ' is' : 's are') + ' listed with fresh observations') + '. A product counts as LIVE only after its newest frame has been downloaded and decoded (Verify frame, or the active weather loop).');
  };
  /* Plain-text report to paste into a chat or an issue. */
  U.buildReport = function (m) {
    const L = [], t = x => Number.isFinite(x) ? new Date(x).toISOString().replace(/\.\d+Z$/, 'Z') : 'n/a';
    L.push('WX Studio data diagnostics' + (m.version ? ' · v' + m.version : '') + ' · ' + t(m.at));
    L.push('Processor: ' + (m.proc.endpoint || 'none') + ' (' + m.proc.mode + ') — ' + m.proc.title + ' — ' + m.proc.detail);
    if (m.health) L.push('/health: ' + (m.health.ok ? 'ok · status=' + m.health.status + ' · freshProducts=' + m.health.freshProducts : 'FAILED · ' + m.health.error));
    if (m.catalog) L.push('/catalog: ' + (m.catalog.ok ? m.catalog.products.length + ' product(s)' : 'FAILED · ' + m.catalog.error));
    if (m.unrecognized && m.unrecognized.length) L.push('Unrecognized products listed by the processor (ignored, not shown as sources): ' + m.unrecognized.join(', '));
    (m.rows || []).forEach(r => {
      if (r.state === 'notconnected' && !r.meta) return;
      let line = '- ' + r.pid + ' [' + r.label + ']';
      if (r.meta) line += ' · newest ' + t(r.meta.latest) + ' · ' + r.meta.count + ' frame(s)';
      if (r.verify && r.verify.ok) line += ' · verified ' + r.verify.w + 'x' + r.verify.h + ' ' + Math.round(r.verify.bytes / 1024) + ' KB';
      if (r.why && /unavailable|stale|waiting/.test(r.state)) line += ' · ' + r.why;
      L.push(line);
    });
    return L.join('\n');
  };
  /* ---- shaping raw processor replies (the processor is a separate program; never trust its shape) ---- */
  U.parseHealth = function (d, ms) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, error: 'unexpected /health reply' };
    return { ok: true, status: String(d.status || ''), freshProducts: Number.isFinite(d.freshProducts) ? d.freshProducts : null, service: String(d.service || ''), ms: ms || 0 };
  };
  U.parseCatalog = function (d) {
    if (!d || d.schema !== 'wxstudio.frames.v1' || !Array.isArray(d.products)) return { ok: false, error: 'unexpected /catalog format' };
    const products = [], bad = [];
    d.products.forEach(p => {
      const latest = Number(p && p.latestObservationUtc), earliest = Number(p && p.earliestObservationUtc), count = Number(p && p.frameCount);
      if (!p || typeof p.product !== 'string' || !(latest > 0)) { bad.push(String(p && p.product || '?')); return; }
      products.push({ pid: p.product, latest, earliest: earliest > 0 ? earliest : latest, count: Number.isFinite(count) && count >= 0 ? count : 0, attribution: typeof p.attribution === 'string' ? p.attribution : '' });
    });
    return { ok: true, products, bad };
  };
  /* Which processor product a weather-loop source id refers to (null when it is not a processor product). */
  /* The generic 'goes' source exists only so older saved scenes keep working. It resolves to goes-east-conus-C02; if that product is not
   * listed the bridge falls back to the first listed GOES product, and that is reported explicitly (fallback:true), never silently. */
  U.GOES_ALIAS_PREFERRED = 'goes-east-conus-C02';
  U.resolveGoesAlias = function (products) {
    const list = (products || []).filter(x => SAT_ID.test(x)); if (!list.length) return null;
    const pref = list.indexOf(U.GOES_ALIAS_PREFERRED) >= 0; return { pid: pref ? U.GOES_ALIAS_PREFERRED : list[0], fallback: !pref, preferred: U.GOES_ALIAS_PREFERRED };
  };
  U.loopProduct = function (dl, products) {
    if (!dl) return null; const id = dl.source; products = products || [];
    if (U.SAT_PRODUCTS.indexOf(id) >= 0) return id;
    if (id === 'mrms') return 'mrms-reflectivity';
    if (id === 'nexrad') return 'nexrad-reflectivity-' + (dl.site || 'KBOX');
    if (id === 'goes') { const a = U.resolveGoesAlias(products); return a ? a.pid : null; }
    return null;
  };
  U.procInput = function (pm, health) {
    return { configured: pm.state !== 'notconfigured', local: !!pm.local, error: pm.err || '', healthStatus: health && health.ok ? health.status : '',
      reach: { online: 'ok', waiting: 'ok', 'waiting-local': 'fail', unavailable: 'fail' }[pm.state] || 'unknown' };
  };

  const D = g.WXData;
  if (!D || typeof document === 'undefined') return;

  /* ====================== state ====================== */
  const KEY = 'wxws.sections.v1';
  const defaults = { layer: true, satellite: false, radar: false, rtma: false, models: false, palettes: false, status: false, connect: false, demo: false };
  const ui = W.ui = { open: false, sections: Object.assign({}, defaults), sat: {}, grp: {}, filter: '', cloudIds: {}, pal: { editor: null, msg: '', kind: '', busy: false, confirm: '' }, diag: { busy: false, at: 0, health: null, catalog: null, verify: {}, verifying: {}, seen: {}, dropped: {}, msg: '', report: '' } };
  const dg = ui.diag;
  try { Object.assign(ui.sections, JSON.parse(g.localStorage.getItem(KEY) || '{}')); } catch (e) { /* storage may be blocked: sections just start collapsed */ }
  const remember = () => { try { g.localStorage.setItem(KEY, JSON.stringify(ui.sections)); } catch (e) { /* ignore */ } };

  const P = () => g.WXWeatherPalettes, C = () => g.WXWeatherSources, PC = () => g.WXWeatherPaletteCloud, BR = () => g.WXWeatherProcessorBridge, RS = () => g.WXWeatherRadarSites;
  const cur = () => { const WX = g.WX; return WX && WX.S && WX.S.show ? WX.S.show.scenes[WX.S.si] : null; };
  const save = () => { try { g.WX.commit(); } catch (e) { /* ignore */ } };
  const rtOf = sc => (sc && D.state.get(sc)) || null;
  const readyFrames = r => (r ? r.frames.filter(f => f.img) : []);
  const stt = id => D.classify(id).status;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ====================== tiny DOM helper ====================== */
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (k === 'on') { for (const e in v) n.addEventListener(e, v[e]); } else if (k === 'text') n.textContent = v;
      else if (k === 'attrs') { for (const a in v) n.setAttribute(a, v[a]); } else if (v !== undefined && v !== null) n[k] = v;
    }
    kids.flat().forEach(c => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  }
  const pill = st => el('span', { className: 'ws-pill ' + st, text: D.STATUS_TEXT[st] || st });

  /* ====================== styles ====================== */
  function css() {
    if (document.getElementById('wxwsCss')) return;
    const s = document.createElement('style'); s.id = 'wxwsCss';
    s.textContent = `
#stageWrap #wxws{position:absolute;top:8px;right:8px;bottom:60px;z-index:9;width:min(410px,calc(100% - 16px));display:flex;flex-direction:column;background:rgba(10,17,30,.985);border:1px solid #344763;border-radius:10px;color:#dbe6f5;font:13px/1.35 Barlow,Arial,sans-serif;box-shadow:0 10px 36px rgba(0,0,0,.55);overflow:hidden}
#wxws[hidden]{display:none!important}
#wxws *{box-sizing:border-box}
#wxws button{font:inherit;color:inherit;cursor:pointer}
#wxws .ws-head{display:flex;align-items:center;gap:8px;padding:9px 10px 8px 12px;border-bottom:1px solid #243349}
#wxws .ws-head b{font:800 15px/1 Barlow Condensed,Barlow,Arial,sans-serif;letter-spacing:.6px;text-transform:uppercase;flex:1}
#wxws .ws-x{background:none;border:0;font-size:20px;line-height:1;padding:0 4px;color:#9fb3cf}
#wxws .ws-x:hover{color:#fff}
#wxws .ws-cloud{display:flex;align-items:center;gap:8px;padding:6px 12px;background:#0b1424;border-bottom:1px solid #243349;font-size:12px}
#wxws .ws-cloud span.t{flex:1;min-width:0;color:#9fb3cf;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#wxws .ws-scroll{flex:1;overflow:auto;padding:4px 0 10px}
#wxws .ws-sec{border-bottom:1px solid #1b2a40}
#wxws .ws-sh{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;padding:9px 12px;text-align:left}
#wxws .ws-sh:hover{background:#101c31}
#wxws .ws-sh .ar{width:10px;color:#6f86a6;font-size:10px;transition:transform .12s}
#wxws .ws-sec.open>.ws-sh .ar{transform:rotate(90deg)}
#wxws .ws-sh b{flex:1;font-weight:700;letter-spacing:.2px}
#wxws .ws-sh i{font-style:normal;color:#8da2bf;font-size:11px}
#wxws .ws-sb{display:none;padding:2px 12px 12px}
#wxws .ws-sec.open>.ws-sb{display:block}
#wxws .ws-sub{margin:10px 0 5px;font:700 11px/1 Barlow,Arial,sans-serif;letter-spacing:.8px;text-transform:uppercase;color:#7f95b4}
#wxws .ws-note{margin:6px 0;color:#8da2bf;font-size:12px}
#wxws .ws-note.warn{color:#f2b64a}
#wxws .ws-pill{display:inline-block;font:800 9px/1 Barlow,Arial,sans-serif;letter-spacing:.5px;text-transform:uppercase;padding:3px 6px;border-radius:9px;white-space:nowrap;border:1px solid transparent}
#wxws .ws-pill.connected{background:#0f3b24;color:#5ee69a;border-color:#1f7a49}
#wxws .ws-pill.experimental{background:#42300a;color:#f5be4e;border-color:#8a6416}
#wxws .ws-pill.demo{background:#2a1f4d;color:#b9a4ff;border-color:#5b47a8}
#wxws .ws-pill.notconnected{background:#18222f;color:#8397b3;border-color:#2c3b50}
#wxws .ws-row{display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;margin:3px 0;background:#0d1729;border:1px solid #243349;border-radius:7px;text-align:left}
#wxws .ws-row:hover:not(:disabled){border-color:#5d7aa5}
#wxws .ws-row.on{border-color:#3b82f6;background:#10264a}
#wxws .ws-row:disabled{cursor:not-allowed;opacity:.62}
#wxws .ws-row .m{flex:1;min-width:0;display:flex;flex-direction:column}
#wxws .ws-row .m b{font-weight:600}
#wxws .ws-row .m i{font-style:normal;color:#8da2bf;font-size:11px}
#wxws .ws-sector{margin:5px 0 8px}
#wxws .ws-sech{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px}
#wxws .ws-sech b{font-weight:700}
#wxws .ws-sech i{font-style:normal;color:#7f95b4;font-size:11px}
#wxws .ws-chips{display:flex;flex-wrap:wrap;gap:5px}
#wxws .ws-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:14px;background:#0d1729;border:1px solid #2a3b55;font-size:12px}
#wxws .ws-chip:hover:not(:disabled){border-color:#5d7aa5}
#wxws .ws-chip.on{background:#173a72;border-color:#3b82f6;color:#fff}
#wxws .ws-chip:disabled{cursor:not-allowed;color:#7288a6}
#wxws .ws-chip .d{width:7px;height:7px;border-radius:50%;background:#53657e}
#wxws .ws-chip .d.connected{background:#34d27b}
#wxws .ws-chip .d.experimental{background:#f5be4e}
#wxws .ws-chip .d.demo{background:#a78bfa}
#wxws .ws-card{background:#0d1729;border:1px solid #243349;border-radius:8px;padding:10px;margin:8px 0}
#wxws .ws-card .nm{display:flex;align-items:center;gap:8px}
#wxws .ws-card .nm b{flex:1;font-size:14px}
#wxws .ws-live{color:#9fb3cf;font-size:12px;margin-top:3px;min-height:16px}
#wxws .ws-ctl{display:flex;align-items:center;gap:10px;margin-top:9px}
#wxws .ws-ctl label{flex:0 0 74px;color:#9fb3cf;font-size:12px}
#wxws .ws-ctl input[type=range]{flex:1;accent-color:#3b82f6}
#wxws .ws-ctl select{width:96px;flex:none}
#wxws .ws-ctl .v{width:38px;text-align:right;color:#dbe6f5}
#wxws select,#wxws input[type=text],#wxws input[type=number]{background:#0a1220;color:#dbe6f5;border:1px solid #2a3b55;border-radius:6px;padding:5px 7px;font:inherit}
#wxws input[type=color]{width:34px;height:26px;padding:0;border:1px solid #2a3b55;border-radius:5px;background:none}
#wxws .ws-btn{background:#16233a;border:1px solid #2f4466;border-radius:6px;padding:5px 10px}
#wxws .ws-btn:hover:not(:disabled){border-color:#5d7aa5;background:#1b2c49}
#wxws .ws-btn.pri{background:#1d4ed8;border-color:#3b82f6;color:#fff}
#wxws .ws-btn.danger{border-color:#7a2a2a;color:#ff9b9b}
#wxws .ws-btn:disabled{opacity:.5;cursor:not-allowed}
#wxws .ws-btns{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}
#wxws .sw{position:relative;display:inline-block;width:36px;height:20px;flex:none}
#wxws .sw input{opacity:0;width:0;height:0;position:absolute}
#wxws .sw span{position:absolute;inset:0;background:#2a3b55;border-radius:10px;transition:.12s;cursor:pointer}
#wxws .sw span:before{content:"";position:absolute;width:14px;height:14px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.12s}
#wxws .sw input:checked+span{background:#2563eb}
#wxws .sw input:checked+span:before{transform:translateX(16px)}
#wxws .sw input:focus-visible+span{outline:2px solid #93c5fd}
#wxws canvas.ws-strip{display:block;width:100%;height:14px;border-radius:3px;border:1px solid #2a3b55;position:static!important}
#wxws .ws-pal{display:flex;gap:8px;align-items:stretch;padding:7px 8px;margin:4px 0;background:#0d1729;border:1px solid #243349;border-radius:7px}
#wxws .ws-pal.on{border-color:#3b82f6;background:#10264a}
#wxws .ws-pal .pm{flex:1;min-width:0}
#wxws .ws-pal .pm b{display:block;font-weight:600}
#wxws .ws-pal .pm i{display:block;font-style:normal;color:#8da2bf;font-size:11px;margin-top:2px}
#wxws .ws-pal .ac{display:flex;flex-direction:column;gap:3px;flex:none}
#wxws .ws-pal .ac button{padding:2px 8px;font-size:11px}
#wxws .ws-badge{display:inline-block;font-size:10px;padding:1px 6px;border-radius:8px;background:#1b2c49;color:#9fc0ff;margin-left:6px}
#wxws .ws-badge.cloud{background:#0f3b24;color:#5ee69a}
#wxws .ws-badge.local{background:#42300a;color:#f5be4e}
#wxws .ws-grp>button{display:flex;gap:6px;width:100%;background:none;border:0;padding:5px 0;text-align:left;color:#b8c9e2;font-weight:600}
#wxws .ws-edit label{display:block;margin:7px 0 3px;color:#9fb3cf;font-size:12px}
#wxws .ws-edit input[type=text],#wxws .ws-edit select{width:100%}
#wxws .ws-stop{display:flex;gap:6px;align-items:center;margin:3px 0}
#wxws .ws-stop input[type=number]{width:96px}
#wxws .ws-stack{margin-top:10px;border:1px solid #243349;border-radius:7px;overflow:hidden}
#wxws .ws-stack div{display:flex;align-items:center;gap:8px;padding:6px 9px;border-bottom:1px solid #1b2a40;font-size:12px;color:#8da2bf}
#wxws .ws-stack div:last-child{border:0}
#wxws .ws-stack div.me{background:#10264a;color:#fff;font-weight:600}
#wxws .ws-stack div span{flex:1}
#wxws .ws-stack button{padding:0 7px;line-height:20px}
#wxws .ws-kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12px;margin-top:6px}
#wxws .ws-kv span:nth-child(odd){color:#7f95b4}
#wxws .ws-pill.waiting{background:#14284a;color:#8fb4ff;border-color:#2f4f8a}
#wxws .ws-pill.unavailable,#wxws .ws-pill.st-unavailable{background:#3a1717;color:#ff9b9b;border-color:#7a2a2a}
#wxws .ws-pill.st-live{background:#0f3b24;color:#5ee69a;border-color:#1f7a49}
#wxws .ws-pill.st-connected{background:#15233a;color:#9fb8e0;border-color:#344d75}
#wxws .ws-pill.st-stale{background:#42300a;color:#f5be4e;border-color:#8a6416}
#wxws .ws-pill.st-waiting{background:#14284a;color:#8fb4ff;border-color:#2f4f8a}
#wxws .ws-pill.st-notconnected{background:#18222f;color:#8397b3;border-color:#2c3b50}
#wxws .ws-pill.st-experimental{background:#42300a;color:#f5be4e;border-color:#8a6416}
#wxws .ws-pill.st-demo{background:#2a1f4d;color:#b9a4ff;border-color:#5b47a8}
#wxws .ws-drow{margin:3px 0;padding:7px 9px;background:#0d1729;border:1px solid #243349;border-radius:7px}
#wxws .ws-drow.live{border-color:#1f7a49}
#wxws .ws-drow .hd{display:flex;align-items:center;gap:8px}
#wxws .ws-drow .hd b{flex:1;min-width:0;font-weight:600}
#wxws .ws-drow .mt{margin-top:3px;color:#8da2bf;font-size:11.5px}
#wxws .ws-drow .mt.bad{color:#f2a0a0}
#wxws .ws-drow .mt.warn{color:#f2b64a}
#wxws .ws-drow .ws-btns{margin:5px 0 0}
#wxws .ws-drow .ws-btn{padding:3px 8px;font-size:12px}
#wxws .ws-code{display:flex;align-items:flex-start;gap:6px;margin:5px 0}
#wxws .ws-code code{flex:1;min-width:0;display:block;padding:6px 8px;background:#060d19;border:1px solid #243349;border-radius:6px;color:#cfe0fa;font:12px/1.35 Consolas,Menlo,monospace;white-space:pre-wrap;word-break:break-all}
#wxws ol.ws-steps{margin:6px 0;padding-left:20px;color:#c3d3ea}
#wxws ol.ws-steps li{margin:6px 0}
#wxws textarea.ws-report{width:100%;min-height:120px;background:#060d19;color:#cfe0fa;border:1px solid #243349;border-radius:6px;font:11.5px/1.35 Consolas,Menlo,monospace}
#wxws .ws-grp .ct{margin-left:auto;color:#8da2bf;font-size:11px}
@media (max-width:640px){#stageWrap #wxws{left:8px;width:auto}}`;
    document.head.appendChild(s);
  }

  /* ====================== selecting a source (same fields the dock writes) ====================== */
  function pick(id, extra) {
    if (typeof D.pickSource === 'function') return D.pickSource(id, extra);   // preferred if dataloop ever exposes it
    const sc = cur(), def = D.sources[id]; if (!sc || !def) return;
    const dl = sc.dataLoop = Object.assign(D.defaults(), sc.dataLoop || {}, { on: true });
    dl.source = id; dl.site = extra && extra.site != null ? extra.site : (def.defaultSite || '');
    const lens = def.lengths || [1]; if (!lens.includes(+dl.hours)) dl.hours = lens[0];
    dl.idx = 0; delete dl.palette; save();
  }

  /* ====================== building blocks ====================== */
  function section(id, title, summary, build) {
    const open = !!ui.sections[id];
    const head = el('button', { className: 'ws-sh', attrs: { 'aria-expanded': String(open), 'aria-controls': 'wxws-' + id }, on: { click: () => { ui.sections[id] = !ui.sections[id]; remember(); W.render(); } } }, el('span', { className: 'ar', text: '▶' }), el('b', { text: title }), summary ? el('i', { text: summary }) : null);
    const body = el('div', { className: 'ws-sb', id: 'wxws-' + id }); if (open) build(body);
    return el('div', { className: 'ws-sec' + (open ? ' open' : '') }, head, body);
  }
  function srcRow(o) {
    const off = o.status === 'notconnected';
    return el('button', { className: 'ws-row' + (o.selected ? ' on' : ''), disabled: off, title: o.title || (off ? 'Not connected — no data is being served for this product yet' : ''), on: { click: () => { if (!off) { o.pick(); W.render(); } } } },
      el('span', { className: 'm' }, el('b', { text: o.name }), o.sub ? el('i', { text: o.sub }) : null), pill(o.status));
  }
  function drawStrip(cv, stops, continuous) {
    const c = cv.getContext('2d'), n = cv.width, lut = U.lutFromStops(stops, continuous, n), im = c.createImageData(n, 1);
    im.data.set(lut); for (let y = 0; y < cv.height; y++) c.putImageData(im, 0, y);
  }
  function strip(stops, continuous) { const cv = el('canvas', { className: 'ws-strip', width: 240, height: 14 }); try { drawStrip(cv, stops, continuous); } catch (e) { /* preview only */ } return cv; }
  const catalogLabel = base => {
    const cat = C(); if (!cat) return base;
    const p = cat.byId(base) || cat.products.find(x => x.id.replace(/^g\d+_[a-z0-9]+_/, '') === base);
    return p ? String(p.label).replace(/ — native.*$/, '').replace(/^ABI /, '') : base;
  };
  const curDl = () => { const sc = cur(); return sc && sc.dataLoop && sc.dataLoop.on ? sc.dataLoop : null; };
  /* the bridge also registers a generic 'goes' alias for old saved scenes; hide it once the specific sectors exist so nothing is listed twice */
  const legacyAlias = id => id === 'goes' && Object.keys(D.sources).some(k => /^goes-/.test(k));
  const SAT_SHORT = { abi_c02: 'Visible 0.5 km', abi_c13: 'Clean IR 2 km', abi_multichannel: 'GeoColor RGB', abi_cloud_top_temp: 'Cloud-top temp', abi_cloud_top_height: 'Cloud-top height' };

  /* ====================== data-source diagnostics (runtime) ======================
   * Read-only GET probes of the processor's own /health, /catalog and /manifests; nothing is written anywhere and no
   * credentials are involved. Everything shown comes from what the processor really answered. */
  const bridgeEp = () => (BR() && BR().endpoint) || '';
  const isLocalUrl = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(u || '');
  const friendly = e => { const m = String((e && e.message) || e); if (e && e.name === 'AbortError') return 'timed out after 12 s'; if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return 'no response (not running, wrong address, or blocked by the browser)'; return m; };
  async function getRaw(url, as) {
    const ep = bridgeEp(), ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000), t0 = performance.now();
    try {
      const o = { mode: 'cors', signal: ctl.signal, cache: 'no-store' }; if (isLocalUrl(ep)) o.targetAddressSpace = 'loopback';
      const r = await fetch(url, o); if (!r.ok) throw new Error('HTTP ' + r.status);
      return { ok: true, data: as === 'blob' ? await r.blob() : await r.json(), ms: Math.round(performance.now() - t0) };
    } catch (e) { return { ok: false, error: friendly(e) }; } finally { clearTimeout(to); }
  }
  const bridgeProducts = () => { const b = BR(); return (b && b.products) || []; };
  const procModel = () => { const b = BR() || {}; return U.processorState({ endpoint: b.endpoint || '', bridgeStatus: b.status, bridgeError: b.error, health: dg.health, catalog: dg.catalog }); };
  const metaMap = () => { const m = {}; if (dg.catalog && dg.catalog.ok) dg.catalog.products.forEach(x => { m[x.pid] = x; }); return m; };
  const fmtZ = t => new Date(t).toISOString().slice(11, 16) + 'Z';
  function loopFor(pid) {
    const sc = cur(), dl = sc && sc.dataLoop; if (!dl || !dl.on) return null;
    const b = BR(); if (U.loopProduct(dl, (b && b.products) || []) !== pid) return null;
    const def = D.sources[dl.source]; if (!def || def.demo || def.nativeData === false) return null;
    const r = rtOf(sc); if (!r) return null; const fr = readyFrames(r);
    return { n: fr.length, newest: fr.reduce((a, f) => Math.max(a, f.t || 0), 0) || null, status: r.status, error: r.status === 'error' ? (r.msg || '') : '' };
  }
  function evalPid(pid) {
    const pm = procModel(), pin = U.procInput(pm, dg.health), lp = loopFor(pid);
    if (!dg.catalog && !dg.health && !(lp && lp.n)) pin.reach = pin.reach === 'ok' ? 'unknown' : pin.reach;   // not asked yet: say "checking", never guess
    return U.sourceState({ proc: pin, meta: metaMap()[pid] || null, verify: dg.verify[pid] || null, loop: lp, dropped: !!dg.dropped[pid], windowMin: U.freshWindowMin(pid) });
  }
  /* state of whatever the active scene's weather layer shows: used for the dock badge and the exported bar */
  function layerState(dl) {
    if (!dl || !dl.on) return null; const def = D.sources[dl.source];
    if (!def) return { state: 'notconnected', why: 'This source is not connected.' };
    if (def.demo) return { state: 'demo', why: 'Synthetic test pattern — not NOAA data.' };
    if (def.nativeData === false) return { state: 'experimental', why: 'NOAA-rendered preview pulled directly by the browser — not decoded source data.' };
    const b = BR(), pid = U.loopProduct(dl, (b && b.products) || []);
    if (!pid) return { state: 'connected', why: 'Registered by the data service, but not a verifiable NOAA processor product.' };
    const st = evalPid(pid);
    if (dl.source === 'goes') { const a = U.resolveGoesAlias((b && b.products) || []); st.why = 'Generic GOES (older scenes) is showing ' + pid + (a && a.fallback ? ' — FALLBACK: ' + a.preferred + ' is not listed' : '') + '. ' + (st.why || ''); }
    return st;
  }
  async function runDiag(opts) {
    opts = opts || {}; const ep = bridgeEp(); if (dg.busy) return;
    if (!ep) { dg.health = dg.catalog = null; dg.at = Date.now(); if (!opts.quiet) W.render(); return; }
    dg.busy = true; if (!opts.quiet) W.render();
    try {
      const [h, c] = await Promise.all([getRaw(ep + '/health'), getRaw(ep + '/catalog')]);
      dg.health = h.ok ? U.parseHealth(h.data, h.ms) : { ok: false, error: h.error };
      dg.catalog = c.ok ? U.parseCatalog(c.data) : { ok: false, error: c.error };
      if (dg.catalog.ok) {
        const now = {}; dg.catalog.products.forEach(x => { now[x.pid] = 1; });
        Object.keys(dg.seen).forEach(k => { if (!now[k]) dg.dropped[k] = true; });
        Object.keys(now).forEach(k => { dg.seen[k] = 1; delete dg.dropped[k]; });
      }
      dg.at = Date.now();
      if (opts.manual && BR() && BR().refresh) { try { await BR().refresh(); } catch (e) { /* its own status reports it */ } }
    } finally { dg.busy = false; }
    W.render();
  }
  async function verifyFrame(pid) {
    const ep = bridgeEp(); if (!ep || dg.verifying[pid]) return; dg.verifying[pid] = true; W.render();
    let res;
    try {
      const m = await getRaw(ep + '/manifests/' + encodeURIComponent(pid) + '.json'); if (!m.ok) throw new Error('manifest: ' + m.error);
      const d = m.data; if (!d || d.schema !== 'wxstudio.frames.v1' || d.product !== pid || !Array.isArray(d.frames)) throw new Error('the manifest has an unexpected format');
      const fr = d.frames.filter(f => f && Number.isFinite(f.t) && typeof f.url === 'string').sort((a, b) => b.t - a.t)[0]; if (!fr) throw new Error('the manifest lists no frames');
      const u = new URL(fr.url, ep + '/'); if (u.origin !== new URL(ep).origin) throw new Error('the frame address points to a different server');
      const f = await getRaw(u.href, 'blob'); if (!f.ok) throw new Error('frame: ' + f.error);
      let w = 0, h = 0;
      if (typeof createImageBitmap === 'function') { const bm = await createImageBitmap(f.data); w = bm.width; h = bm.height; if (bm.close) bm.close(); }
      else { const url = URL.createObjectURL(f.data); try { const im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('the image could not be decoded')); i.src = url; }); w = im.naturalWidth; h = im.naturalHeight; } finally { URL.revokeObjectURL(url); } }
      if (!(w > 0 && h > 0)) throw new Error('the image decoded to an empty picture');
      res = { ok: true, t: fr.t, w, h, bytes: f.data.size, at: Date.now() };
    } catch (e) { res = { ok: false, error: friendly(e), at: Date.now() }; }
    dg.verify[pid] = res; delete dg.verifying[pid]; W.render();
  }
  function rowsForReport() {
    const out = [], seen = {}, add = pid => { if (seen[pid]) return; seen[pid] = 1; const st = evalPid(pid), meta = metaMap()[pid] || null; out.push({ pid, state: st.state, label: st.label, why: st.why, meta, verify: dg.verify[pid] || null }); };
    U.SAT_PRODUCTS.forEach(add); add('mrms-reflectivity'); Object.keys(metaMap()).filter(k => U.parseProduct(k).family !== 'other').forEach(add); return out;
  }
  const unrecognizedIds = () => Object.keys(metaMap()).filter(k => U.parseProduct(k).family === 'other').sort();
  function makeReport() {
    const pm = procModel();
    return U.buildReport({ at: Date.now(), version: (g.WX_VERSION || (g.WX && g.WX.VERSION) || ''), proc: { endpoint: bridgeEp(), mode: pm.mode, title: pm.title, detail: pm.detail }, health: dg.health, catalog: dg.catalog, rows: rowsForReport(), unrecognized: unrecognizedIds() });
  }
  async function copyText(text) {
    try { if (g.navigator && g.navigator.clipboard && g.navigator.clipboard.writeText) { await g.navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall through */ }
    try { const t = el('textarea', { value: text, style: 'position:fixed;left:-9999px;top:0' }); document.body.append(t); t.select(); const ok = document.execCommand && document.execCommand('copy'); t.remove(); return !!ok; } catch (e) { return false; }
  }
  /* strip + section header text */
  function overall() {
    const pm = procModel(), live = rowsForReport().filter(r => r.state === 'live').length;
    return { pm, live, short: pm.state === 'online' ? pm.short + (live ? ' · ' + live + ' verified live' : ' · none verified yet') : pm.short };
  }

  /* ====================== sections ====================== */
  function secLayer(box) {
    const sc = cur(), raw = sc && sc.dataLoop, dl = curDl();
    if (!raw) { box.append(el('div', { className: 'ws-note', text: 'No weather layer on this scene yet.' }), el('div', { className: 'ws-btns' }, el('button', { className: 'ws-btn pri', text: 'Turn on weather layer', on: { click: () => { sc.dataLoop = Object.assign(D.defaults(), { on: true }); save(); W.render(); } } }))); return; }
    const def = D.sources[raw.source], info = D.classify(raw.source), pr = D.productOf(raw.source);
    const card = el('div', { className: 'ws-card' });
    card.append(el('div', { className: 'nm' }, el('b', { text: D.displayName(raw.source, raw) }), pill(info.status)));
    card.append(el('div', { className: 'ws-live', attrs: { 'data-live': '1' } }));
    // visibility
    const vis = el('input', { type: 'checkbox', checked: !!raw.on, attrs: { 'aria-label': 'Show weather layer' } });
    vis.addEventListener('change', () => { raw.on = vis.checked; if (!raw.on) { const r = rtOf(sc); if (r) r.playing = false; } save(); W.render(); });
    card.append(el('div', { className: 'ws-ctl' }, el('label', { text: 'Visible' }), el('span', { className: 'sw' }, vis, el('span')), el('span', { className: 'ws-note', style: 'margin:0', text: raw.on ? 'Shown on the map' : 'Hidden — nothing is drawn or exported' })));
    // opacity
    const op = el('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: raw.opacity == null ? 0.85 : raw.opacity, disabled: !raw.on, attrs: { 'aria-label': 'Weather layer opacity' } }), ov = el('span', { className: 'v', text: Math.round((raw.opacity == null ? 0.85 : raw.opacity) * 100) + '%' });
    op.addEventListener('input', () => { raw.opacity = +op.value; ov.textContent = Math.round(op.value * 100) + '%'; }); op.addEventListener('change', save);
    card.append(el('div', { className: 'ws-ctl' }, el('label', { text: 'Opacity' }), op, ov));
    // loop length
    const lens = (def && def.lengths) || [1, 2, 4], len = el('select', { disabled: !raw.on, attrs: { 'aria-label': 'Loop history length' } }, lens.map(x => el('option', { value: x, text: x + ' hr', selected: +raw.hours === x })));
    len.addEventListener('change', () => { raw.hours = +len.value; save(); });
    card.append(el('div', { className: 'ws-ctl' }, el('label', { text: 'History' }), len, el('span', { className: 'ws-note', style: 'margin:0', text: lens.length < 2 ? 'Only this length is available' : 'Longest the source offers: ' + Math.max.apply(null, lens) + ' hr' })));
    // mini playback (the full timeline stays in the bar below)
    const play = el('button', { className: 'ws-btn', text: '▶', title: 'Play / pause', disabled: !raw.on, on: { click: () => { const r = rtOf(sc); if (!r) return; r.playing = !r.playing; if (r.playing) raw.idx = r.lastIdx; } } });
    const step = d => () => { const r = rtOf(sc), n = readyFrames(r).length; if (!n) return; r.playing = false; raw.idx = (((Math.floor(r.lastIdx) + d) % n) + n) % n; save(); };
    card.append(el('div', { className: 'ws-ctl' }, el('label', { text: 'Playback' }), el('span', { className: 'ws-btns', style: 'margin:0' }, el('button', { className: 'ws-btn', text: '‹', title: 'Previous frame', disabled: !raw.on, on: { click: step(-1) } }), play, el('button', { className: 'ws-btn', text: '›', title: 'Next frame', disabled: !raw.on, on: { click: step(1) } })), el('span', { className: 'ws-note', style: 'margin:0', text: 'Full timeline is in the bar below' })));
    play.setAttribute('data-play', '1');
    // palette
    const palId = D.paletteFor(sc), P0 = P();
    const palRow = el('div', { className: 'ws-ctl' }, el('label', { text: 'Palette' }));
    if (!pr.palette) palRow.append(el('span', { className: 'ws-note', style: 'margin:0', text: 'Finished image — no color table applies' }));
    else if (P0 && palId && P0.get(palId)) { const p = P0.get(palId); palRow.append(el('div', { style: 'flex:1;min-width:0' }, strip(p.stops, !!p.continuous), el('div', { className: 'ws-note', style: 'margin:3px 0 0', text: p.name })), el('button', { className: 'ws-btn', text: 'Change', on: { click: () => { ui.sections.palettes = true; remember(); W.render(); scrollTo('palettes'); } } })); }
    else palRow.append(el('span', { className: 'ws-note', style: 'margin:0', text: 'No palette registered for this product' }));
    card.append(palRow);
    box.append(card);
    // layer stack / position
    const can = !!W.capabilities.layerPosition, above = raw.order === 'above-labels';
    const setOrder = v => { raw.order = v; save(); W.render(); };
    const mk = (label, extra) => el('div', { className: extra || '' }, el('span', { text: label }));
    const me = el('div', { className: 'me' }, el('span', { text: 'Weather data' }),
      el('button', { className: 'ws-btn', text: '▲', title: can ? 'Move above map labels' : 'Not available yet — the map currently draws weather under the labels', disabled: !can || above, on: { click: () => setOrder('above-labels') } }),
      el('button', { className: 'ws-btn', text: '▼', title: can ? 'Move below map labels' : 'Not available yet — the map currently draws weather under the labels', disabled: !can || !above, on: { click: () => setOrder('below-labels') } }));
    const stack = el('div', { className: 'ws-stack', attrs: { 'aria-label': 'Layer order, top to bottom' } }, mk('Your graphics — fronts, icons, text, titles'), above ? me : mk('Map labels — cities, roads'), above ? mk('Map labels — cities, roads') : me, mk('Base map'));
    box.append(el('div', { className: 'ws-sub', text: 'Layer order (top → bottom)' }), stack, el('div', { className: 'ws-note', text: can ? 'Weather can sit under or over the map labels.' : 'Weather currently sits under the map labels and above the base map. Re-ordering unlocks when the Mapbox layer supports it.' }));
  }

  function secSatellite(box, dl) {
    const cat = C(); if (!cat) { box.append(el('div', { className: 'ws-note', text: 'Source catalog is not loaded.' })); return; }
    [['g19', 'east', 'GOES-19 East'], ['g18', 'west', 'GOES-18 West']].forEach(([gid, key, name]) => {
      box.append(el('div', { className: 'ws-sub', text: name }));
      [['conus', 'CONUS'], ['fulldisk', 'Full Disk'], ['meso1', 'Mesoscale 1'], ['meso2', 'Mesoscale 2']].forEach(([sec, label]) => {
        const prods = cat.list('satellite').filter(p => p.id.startsWith(gid + '_' + sec + '_'));
        const cadence = prods[0] && prods[0].cadenceMinutes ? 'every ' + prods[0].cadenceMinutes + ' min' : '';
        const chips = el('div', { className: 'ws-chips' });
        prods.forEach(p => {
          const suffix = p.id.slice((gid + '_' + sec + '_').length), m = /^abi_(c02|c13)$/.exec(suffix), sid = m ? 'goes-' + key + '-' + (sec === 'fulldisk' ? 'full' : sec) + '-' + m[1].toUpperCase() : null, st = sid ? stt(sid) : 'notconnected';
          chips.append(el('button', { className: 'ws-chip' + (dl && sid && dl.source === sid ? ' on' : ''), disabled: st === 'notconnected', title: (SAT_SHORT[suffix] ? p.label : p.label) + (st === 'notconnected' ? ' — Not connected' : ' — ' + D.STATUS_TEXT[st]), on: { click: () => { pick(sid); W.render(); } } }, el('span', { className: 'd ' + st }), SAT_SHORT[suffix] || p.label));
        });
        box.append(el('div', { className: 'ws-sector' }, el('div', { className: 'ws-sech' }, el('b', { text: label }), el('i', { text: cadence + (sec.startsWith('meso') ? ' · sector moves' : '') })), chips));
      });
    });
    const known = /^goes-(east|west)-(conus|full|meso1|meso2)-(C02|C13)$/;
    const extra = Object.keys(D.sources).filter(id => D.classify(id).category === 'satellite' && !known.test(id) && !legacyAlias(id));
    if (extra.length) { box.append(el('div', { className: 'ws-sub', text: 'Other registered satellite sources' })); extra.forEach(id => box.append(srcRow({ name: D.displayName(id), sub: 'registered by the data service', status: stt(id), selected: !!dl && dl.source === id, pick: () => pick(id) }))); }
    box.append(el('div', { className: 'ws-note', text: 'Grey dots are catalog products that are not connected yet. Green means the NOAA processor lists a fresh observation for it — open Data Source Status to verify the frames.' }));
  }

  function secRadar(box, dl) {
    const cat = C(), mr = cat && cat.byId('mrms_mosaic_reflectivity');
    box.append(el('div', { className: 'ws-sub', text: 'MRMS national mosaic' }));
    const def = D.sources.mrms, native = !!def && def.nativeData !== false, exp = !!def && def.nativeData === false;
    box.append(srcRow({ name: 'MRMS reflectivity — native', sub: (mr ? (mr.resolutionKm || 1) + ' km · CONUS · every ' + (mr.cadenceMinutes || 2) + ' min · ' : '') + 'color table available', status: native ? 'connected' : 'notconnected', selected: native && !!dl && dl.source === 'mrms', pick: () => pick('mrms') }));
    box.append(srcRow({ name: 'NOAA MRMS · Northeast preview', sub: 'NWS server-rendered image, colors fixed by NOAA, not source-native', status: exp ? 'experimental' : 'notconnected', selected: exp && !!dl && dl.source === 'mrms', pick: () => pick('mrms') }));
    if (exp) box.append(el('div', { className: 'ws-note warn', text: 'Experimental browser test. Check the time stamp and map position before using it on air.' }));
    box.append(el('div', { className: 'ws-sub', text: 'Individual NEXRAD radar sites' }));
    const nx = D.sources.nexrad, planned = (D.planned || []).find(x => x.id === 'nexrad') || {}, sites = (nx && nx.sites && nx.sites.length ? nx.sites : planned.sites) || [];
    const site = (dl && dl.source === 'nexrad' && dl.site) || (RS() && RS().selected) || (nx && nx.defaultSite) || planned.defaultSite || 'KBOX', conn = nx ? 'connected' : 'notconnected';
    const f = el('input', { type: 'text', placeholder: 'Find a station (KBOX, Boston…)', value: ui.filter, attrs: { 'aria-label': 'Filter radar stations' }, style: 'width:100%;margin:2px 0 5px' });
    const list = el('select', { size: 6, style: 'width:100%', attrs: { 'aria-label': 'NEXRAD station' } });
    const fill = () => { list.textContent = ''; const q = ui.filter.trim().toUpperCase(); sites.filter(x => !q || (x.id + ' ' + (x.label || '')).toUpperCase().includes(q)).slice(0, 400).forEach(x => list.append(el('option', { value: x.id, text: x.label || x.id, selected: x.id === site }))); };
    f.addEventListener('input', () => { ui.filter = f.value; fill(); }); fill();
    list.addEventListener('change', () => { const id = list.value, rs = RS(); if (nx) pick('nexrad', { site: id }); else if (rs && rs.select) rs.select(id); else { const sc = cur(); sc.dataLoop = Object.assign(D.defaults(), sc.dataLoop || {}, { source: 'nexrad', site: id, on: false }); save(); } W.render(); });
    const dots = document.getElementById('wxradar-pick-btn');
    box.append(el('div', { className: 'ws-note', text: 'Station: ' + site + (conn === 'notconnected' ? ' — you can choose a site now; radar frames are Not connected yet.' : '') }), f, list,
      el('div', { className: 'ws-btns' }, el('button', { className: 'ws-btn', text: dots && dots.getAttribute('aria-pressed') === 'true' ? 'Hide station dots on map' : 'Show station dots on map', disabled: !dots, title: dots ? 'Then click a dot on the map to choose a radar' : 'Radar dots are not available in this build', on: { click: () => { if (dots) dots.click(); setTimeout(() => W.render(), 40); } } })));
    box.append(srcRow({ name: 'Base reflectivity · Level II', sub: 'native polar gates, color table available', status: conn, selected: !!nx && !!dl && dl.source === 'nexrad', pick: () => pick('nexrad', { site }) }));
    box.append(srcRow({ name: 'Radial velocity · Level II', sub: 'not offered by the data service yet', status: 'notconnected', pick: () => 0 }));
  }

  /* RTMA / Forecast models: datasets are not chosen yet. Only a source that explicitly registers category 'rtma' / 'models', or a catalog entry in that category, appears here — ids are never guessed. */
  function secPending(box, dl, kind) {
    const cat = C(), pend = cat && cat.pending && cat.pending.find(x => x.id === (kind === 'rtma' ? 'rtma' : 'models')) || (cat && cat.pending && cat.pending.find(x => x.id === 'forecast'));
    const inKind = id => { const d = D.sources[id]; return d && !d.demo && d.category === kind; };
    const regs = Object.keys(D.sources).filter(inKind), prods = (cat && cat.list(kind)) || [], shown = new Set();
    regs.forEach(id => { shown.add(id); box.append(srcRow({ name: D.displayName(id), sub: D.sources[id].provider || 'registered by the data service', status: stt(id), selected: !!dl && dl.source === id, pick: () => pick(id) })); });
    prods.filter(p => !shown.has(p.id)).forEach(p => box.append(srcRow({ name: p.label, sub: p.note || p.display || '', status: 'notconnected', pick: () => 0 })));
    if (!regs.length && !prods.length) box.append(srcRow({ name: kind === 'rtma' ? 'RTMA analysis products' : 'Forecast model fields', sub: pend ? pend.note : 'Not available yet', status: 'notconnected', pick: () => 0 }));
    box.append(el('div', { className: 'ws-note', text: kind === 'rtma' ? 'No RTMA variables are selected yet — you and ChatGPT will choose them. Nothing here is live data.' : 'No models or fields are selected yet — you and ChatGPT will choose them. Nothing here is live data.' }));
  }

  function secDemo(box, dl) {
    box.append(el('div', { className: 'ws-note warn', text: 'Synthetic test patterns for trying the bar, palettes and video export. They are NOT weather data.' }));
    ['demo', 'demo-ir', 'demo-rgb'].forEach(id => { const d = D.sources[id]; if (d) box.append(srcRow({ name: d.label, sub: d.kind === 'rgb' ? 'finished RGB image, no color table' : d.kind === 'ir' ? 'recolorable infrared grid' : 'recolorable reflectivity grid', status: 'demo', selected: !!dl && dl.source === id, pick: () => pick(id) })); });
  }

  /* the same honest state words as the rows above, for a registered source id */
  function statePill(id) {
    const k = stt(id); if (k === 'demo' || k === 'experimental') return el('span', { className: 'ws-pill st-' + k, text: U.STATE_LABEL[k] });
    const b = BR(), pid = U.loopProduct({ source: id }, (b && b.products) || []); if (!pid) return pill(k);
    const st = evalPid(pid); return el('span', { className: 'ws-pill st-' + st.state, text: st.label });
  }
  function aliasText() { const b = BR(), a = U.resolveGoesAlias((b && b.products) || []); return a ? 'goes → ' + a.pid + (a.fallback ? ' (fallback: ' + a.preferred + ' is not listed)' : ' (compatibility alias for older scenes)') : 'goes (compatibility alias; no GOES product listed)'; }
  function secStatus(box) {
    secDiag(box);
    box.append(el('div', { className: 'ws-sub', text: 'What the labels mean' }));
    const kv = el('div', { className: 'ws-kv' });
    [['LIVE · verified', 'A real frame was downloaded and decoded from the NOAA processor, and its observation is recent.'], ['Connected · not verified', 'The processor lists a recent observation, but no frame has been downloaded and checked yet.'], ['Stale', 'The newest observation is older than the product’s fresh window.'], ['Waiting', 'The processor is not answering, or has not published fresh NOAA frames yet.'], ['Unavailable', 'The processor or a frame check reported an error.'], ['Experimental', 'NOAA-rendered preview fetched by the browser; not decoded source data.'], ['Demo', 'Synthetic test pattern, never NOAA data.'], ['Not connected', 'No processor is enabled, or the product is not offered yet.']].forEach(([k, v]) => kv.append(el('span', { text: k }), el('span', { text: v })));
    box.append(kv);
    box.append(el('div', { className: 'ws-sub', text: 'Registered sources' }));
    Object.keys(D.sources).forEach(id => box.append(el('div', { className: 'ws-row', style: 'cursor:default' }, el('span', { className: 'm' }, el('b', { text: D.displayName(id) }), el('i', { text: id === 'goes' ? aliasText() : id })), statePill(id))));
    box.append(el('div', { className: 'ws-note', text: 'Palettes: built-in starters work offline. Your cloud palettes need a sign-in (Map Style → Saved Styles).' }));
  }
  /* ---------- data source status / diagnostics ---------- */
  function grpOpen(key, dflt) { return ui.grp[key] == null ? dflt : !!ui.grp[key]; }
  function diagRow(pid, o) {
    o = o || {}; const st = evalPid(pid), meta = metaMap()[pid], v = dg.verify[pid], lp = loopFor(pid), pm = procModel();
    const row = el('div', { className: 'ws-drow ' + st.state, attrs: { 'data-pid': pid, 'data-state': st.state } });
    row.append(el('div', { className: 'hd' }, el('b', { text: o.name || U.parseProduct(pid).label }), el('span', { className: 'ws-pill st-' + st.state, text: st.label })));
    if (meta) row.append(el('div', { className: 'mt', text: 'Newest ' + fmtZ(meta.latest) + ' · ' + U.fmtAge(Date.now() - meta.latest) + ' · ' + meta.count + ' frame' + (meta.count === 1 ? '' : 's') + ' available' }));
    if (v && v.ok) row.append(el('div', { className: 'mt', text: 'Frame check passed: ' + v.w + '×' + v.h + ' px image, ' + Math.round(v.bytes / 1024) + ' KB, observed ' + fmtZ(v.t) }));
    if (lp && lp.n) row.append(el('div', { className: 'mt', text: 'Weather loop: ' + lp.n + ' frame' + (lp.n === 1 ? '' : 's') + ' downloaded and decoded' }));
    if (/^(connected|stale|unavailable)$/.test(st.state) && st.why) row.append(el('div', { className: 'mt ' + (st.state === 'unavailable' ? 'bad' : st.state === 'stale' ? 'warn' : ''), text: st.why }));
    const btns = el('div', { className: 'ws-btns' });
    if (meta && pm.state !== 'unavailable' && pm.state !== 'waiting-local') btns.append(el('button', { className: 'ws-btn', text: dg.verifying[pid] ? 'Checking…' : (v ? 'Check again' : 'Verify frame'), disabled: !!dg.verifying[pid], title: 'Download the newest frame and confirm it decodes as an image', on: { click: () => verifyFrame(pid) } }));
    const reg = o.reg && D.sources[o.reg] ? o.reg : null;
    if (reg && !legacyAlias(reg)) { const dl = curDl(); btns.append(el('button', { className: 'ws-btn', text: dl && dl.source === reg && (reg !== 'nexrad' || !o.site || dl.site === o.site) ? 'In use' : 'Use', disabled: !!dl && dl.source === reg && (reg !== 'nexrad' || !o.site || dl.site === o.site), on: { click: () => { pick(reg, o.site ? { site: o.site } : undefined); W.render(); } } })); }
    if (btns.childNodes.length) row.append(btns);
    return row;
  }
  function diagGroup(key, title, rows, dflt) {
    const open = grpOpen(key, dflt), g1 = el('div', { className: 'ws-grp' }, el('button', { attrs: { 'aria-expanded': String(open) }, on: { click: () => { ui.grp[key] = !open; W.render(); } } }, el('span', { text: open ? '▾' : '▸' }), el('span', { text: title }), el('span', { className: 'ct', text: rows.length + (rows.length === 1 ? ' source' : ' sources') })));
    if (open) rows.forEach(r => g1.append(r)); return g1;
  }
  function secDiag(box) {
    const pm = procModel(), ep = bridgeEp(), m = metaMap();
    // ---- processor card ----
    const hlth = !ep ? 'not checked — no processor enabled' : dg.health ? (dg.health.ok ? '✓ answered · status “' + dg.health.status + '”' + (dg.health.freshProducts != null ? ' · ' + dg.health.freshProducts + ' fresh product' + (dg.health.freshProducts === 1 ? '' : 's') : '') + (dg.health.ms ? ' · ' + dg.health.ms + ' ms' : '') : '✗ ' + dg.health.error) : 'not checked yet';
    const ctlg = !ep ? 'not checked — no processor enabled' : dg.catalog ? (dg.catalog.ok ? '✓ ' + dg.catalog.products.length + ' product' + (dg.catalog.products.length === 1 ? '' : 's') + ' with a fresh observation (the processor lists only observations under 50 minutes old)' : '✗ ' + dg.catalog.error) : 'not checked yet';
    const card = el('div', { className: 'ws-card', attrs: { 'data-diag': 'processor', 'data-state': pm.state } },
      el('div', { className: 'nm' }, el('b', { text: 'NOAA processor' }), el('span', { className: 'ws-pill ' + pm.pill, text: pm.title })),
      el('div', { className: 'ws-note', style: 'margin:6px 0 2px', text: pm.detail }));
    const kv = el('div', { className: 'ws-kv' });
    [['Address', ep ? ep + (pm.mode === 'local' ? '  (this computer)' : '  (hosted)') : 'none'], ['/health', hlth], ['/catalog', ctlg], ['Last check', dg.at ? new Date(dg.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : 'never']].forEach(([k, v]) => kv.append(el('span', { text: k }), el('span', { text: v, style: 'word-break:break-word' })));
    card.append(kv);
    card.append(el('div', { className: 'ws-btns' },
      el('button', { className: 'ws-btn pri', text: dg.busy ? 'Checking…' : 'Run diagnostics', disabled: dg.busy || !ep, title: ep ? 'Ask the processor what it has right now' : 'No processor is enabled', on: { click: () => runDiag({ manual: true }) } }),
      el('button', { className: 'ws-btn', text: 'Copy report', title: 'Copy these results as text to send to someone', on: { click: async () => { const t = makeReport(); dg.report = t; dg.msg = (await copyText(t)) ? 'Report copied.' : 'Copy was blocked — select the text below.'; W.render(); } } }),
      el('button', { className: 'ws-btn', text: 'How to connect', on: { click: () => { ui.sections.connect = true; remember(); W.render(); scrollTo('connect'); } } })));
    if (dg.msg) card.append(el('div', { className: 'ws-note', text: dg.msg, attrs: { role: 'status' } }));
    if (dg.report) card.append(el('textarea', { className: 'ws-report', readOnly: true, value: dg.report, attrs: { 'aria-label': 'Diagnostics report' } }));
    box.append(card);
    // ---- satellite ----
    box.append(el('div', { className: 'ws-sub', text: 'Satellite · GOES' }));
    const cur0 = curDl();
    ['east', 'west'].forEach(sat => {
      const pids = U.SAT_PRODUCTS.filter(x => x.indexOf('goes-' + sat + '-') === 0), any = pids.some(x => m[x]) || (cur0 && pids.indexOf(cur0.source) >= 0);
      const rows = pids.map(pid => { const i = U.parseProduct(pid); return diagRow(pid, { name: i.label.replace(/^GOES-\d+ (East|West) · /, ''), reg: pid }); });
      box.append(diagGroup('diag-' + sat, sat === 'east' ? 'GOES-19 East' : 'GOES-18 West', rows, any));
    });
    if (D.sources.goes) { const a = U.resolveGoesAlias(bridgeProducts()); box.append(el('div', { className: 'ws-note' + (a && a.fallback ? ' warn' : ''), attrs: { 'data-alias': a ? (a.fallback ? 'fallback' : 'preferred') : 'none' }, text: 'Generic “GOES” (kept so older saved scenes still load): ' + (a ? 'currently shows ' + U.parseProduct(a.pid).label + (a.fallback ? ' — FALLBACK, because ' + a.preferred + ' is not listed. Pick a specific sector above to be explicit.' : '.') : 'no GOES product is listed.') })); }
    // ---- radar ----
    box.append(el('div', { className: 'ws-sub', text: 'Radar' }));
    const site = (cur0 && cur0.source === 'nexrad' && cur0.site) || (RS() && RS().selected) || 'KBOX', rids = ['mrms-reflectivity', 'nexrad-reflectivity-' + site, 'nexrad-velocity-' + site];
    Object.keys(m).filter(k => U.parseProduct(k).kind === 'nexrad' && rids.indexOf(k) < 0).sort().forEach(k => rids.push(k));
    const radarRows = rids.map(pid => { const i = U.parseProduct(pid); return diagRow(pid, { reg: i.kind === 'mrms' ? 'mrms' : (/velocity/.test(pid) ? null : 'nexrad'), site: i.site }); });
    box.append(diagGroup('diag-radar', 'MRMS mosaic and NEXRAD site ' + site, radarRows, true));
    // ---- anything the processor lists that this interface does not recognise (never shown as a source) ----
    const other = unrecognizedIds();
    if (other.length) {
      box.append(el('div', { className: 'ws-sub', text: 'Listed by the processor, not supported here yet' }));
      other.forEach(k => box.append(el('div', { className: 'ws-drow notconnected', attrs: { 'data-pid': k, 'data-state': 'unsupported' } }, el('div', { className: 'hd' }, el('b', { text: k }), el('span', { className: 'ws-pill st-notconnected', text: 'Not supported yet' })), el('div', { className: 'mt', text: 'Newest ' + fmtZ(m[k].latest) + ' · ' + m[k].count + ' frame' + (m[k].count === 1 ? '' : 's') + '. This interface does not recognise the product id, so nothing is drawn from it and it is never called live.' }))));
    }
    // ---- previews and demo (never NOAA decoded data) ----
    const ids = Object.keys(D.sources), exp = ids.filter(id => stt(id) === 'experimental'), demo = ids.filter(id => stt(id) === 'demo');
    if (exp.length || demo.length) {
      box.append(el('div', { className: 'ws-sub', text: 'Not decoded NOAA observations' }));
      const mk = (id, state, why) => { const dl = curDl(); return el('div', { className: 'ws-drow ' + state, attrs: { 'data-pid': id, 'data-state': state } }, el('div', { className: 'hd' }, el('b', { text: D.displayName(id) }), el('span', { className: 'ws-pill st-' + state, text: U.STATE_LABEL[state] })), el('div', { className: 'mt', text: why }), el('div', { className: 'ws-btns' }, el('button', { className: 'ws-btn', text: dl && dl.source === id ? 'In use' : 'Use', disabled: !!dl && dl.source === id, on: { click: () => { pick(id); W.render(); } } }))); };
      exp.forEach(id => box.append(mk(id, 'experimental', 'NOAA-rendered picture fetched directly by the browser. Real imagery, but not decoded source data, and it is never labeled LIVE.')));
      demo.forEach(id => box.append(mk(id, 'demo', 'Synthetic test pattern for trying the bar, palettes and export. It is NOT weather data.')));
    }
    // ---- future products: placeholders only; ids are not established, so nothing is recognised or activated ----
    box.append(el('div', { className: 'ws-sub', text: 'Planned products' }));
    [['rtma', 'RTMA analysis'], ['models', 'Forecast models']].forEach(([fam, name]) => box.append(el('div', { className: 'ws-drow notconnected', attrs: { 'data-future': fam } }, el('div', { className: 'hd' }, el('b', { text: name }), el('span', { className: 'ws-pill st-notconnected', text: 'Not connected' })), el('div', { className: 'mt', text: 'Not available yet. No product ids are established, so nothing is listed, drawn or called live.' }))));
  }

  function cmd(text) { return el('div', { className: 'ws-code' }, el('code', { text }), el('button', { className: 'ws-btn', text: 'Copy', on: { click: async e => { const b = e.currentTarget, ok = await copyText(text); b.textContent = ok ? 'Copied' : 'Select'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); } } })); }
  function secConnect(box) {
    const pm = procModel(), ep = bridgeEp();
    box.append(el('div', { className: 'ws-note', text: 'Real NOAA satellite and radar come from a small free program that downloads and decodes NOAA data. It can run on this Windows computer (no paid server). Demo patterns work without it.' }));
    box.append(el('div', { className: 'ws-card', attrs: { 'data-diag': 'connect-status' } }, el('div', { className: 'nm' }, el('b', { text: 'This studio is pointed at' }), el('span', { className: 'ws-pill ' + pm.pill, text: pm.title })), el('div', { className: 'ws-note', style: 'margin:6px 0 0', text: ep ? ep + (pm.mode === 'local' ? ' — the NOAA processor on this computer' : ' — a hosted NOAA processor') : 'nothing yet (step 4 below turns it on)' })));
    const li = (...k) => el('li', null, ...k);
    box.append(el('ol', { className: 'ws-steps' },
      li('Keep a copy of the ', el('b', { text: 'bruced39/wx-studio' }), ' folder on this computer (git clone or ZIP).'),
      li(el('b', { text: 'Start the processor' }), ' — option A needs no Docker. In PowerShell, inside that folder (first time only, add ', el('code', { text: '-InstallMicromamba' }), '; later runs leave it off):', cmd('powershell -ExecutionPolicy Bypass -File .\\weather_processor\\start_no_docker_windows.ps1 -InstallMicromamba'),
        el('span', { className: 'ws-note', text: 'The first setup downloads several GB into %LOCALAPPDATA%\\WXStudioNOAA (your system Python is not changed). Keep that window open; Ctrl+C stops it. Short on memory? Add  -Products "mrms-reflectivity"  to try one product first.' }),
        el('span', { className: 'ws-note', text: 'Option B, with Docker Desktop (free for personal use) running:' }), cmd('powershell -ExecutionPolicy Bypass -File .\\weather_processor\\start_local_windows.ps1')),
      li('Check it on the same computer: open ', el('a', { href: 'http://127.0.0.1:8080/health', target: '_blank', rel: 'noopener', text: 'http://127.0.0.1:8080/health' }), ' — at first it says “waiting-for-real-noaa-frames”, then “ready” once real NOAA scans are decoded. Then open ', el('a', { href: 'http://127.0.0.1:8080/catalog', target: '_blank', rel: 'noopener', text: '/catalog' }), ' — it lists each product with its newest observation time.'),
      li('In this Streamlit app, open the sidebar and tick ', el('b', { text: 'Use free local NOAA processor on this computer' }), '. The page reloads.'),
      li('If the browser asks to allow access to local devices or the local network, allow it for this site. Then press ', el('b', { text: 'Run diagnostics' }), ' in Data Source Status.')));
    box.append(el('div', { className: 'ws-note', text: 'If PowerShell says “Cannot find the ecCodes library”, update your wx-studio folder to v0.9.95 or newer and run the start command again (try  -Products "mrms-reflectivity"  first). Details are in weather_processor/NO_DOCKER_WINDOWS.md.' }));
    box.append(el('div', { className: 'ws-sub', text: 'Docker option: handy commands' }), cmd('docker logs -f wxstudio-noaa-local'), cmd('docker stop wxstudio-noaa-local'), cmd('docker start wxstudio-noaa-local'));
    box.append(el('div', { className: 'ws-note', text: 'The website itself never contacts your computer — your browser does. The computer must stay on for live data. A source shows LIVE only after a real frame has been downloaded and decoded, and is recent.' }));
    box.append(el('div', { className: 'ws-note warn', text: 'Not verified yet by us: running the processor on your Windows PC, and your browser’s permission for loopback access from the hosted page. If it is blocked, Data Source Status will say “no response”.' }));
    box.append(el('div', { className: 'ws-btns' }, el('button', { className: 'ws-btn pri', text: 'Run diagnostics', disabled: !ep || dg.busy, title: ep ? '' : 'Enable the processor first (step 4)', on: { click: () => runDiag({ manual: true }) } })));
  }

  /* ---------- palettes ---------- */
  const setMsg = (msg, kind) => { ui.pal.msg = msg; ui.pal.kind = kind || ''; };
  const cloudIdOf = p => ui.cloudIds[p.id] || ((/^my\/[a-z]+\/([0-9a-f]{8}-[0-9a-f-]{20,})$/.exec(p.id) || [])[1] || null);
  const isMine = p => !!(P() && P().custom[p.id]) && !(P().builtins[p.id]);
  function registerRow(r) {
    const id = 'my/' + r.category + '/' + String(r.id).toLowerCase();
    P().add({ id, category: r.category, name: r.name, productIds: r.product_id ? [r.product_id] : undefined, units: r.units || '', continuous: r.continuous === true, note: 'Saved in your cloud palettes.', stops: r.stops });
    ui.cloudIds[id] = r.id; return id;
  }
  function registerLocal(e) {
    const id = 'my/' + e.category + '/local-' + U.slug(e.name, 30) + '-' + Date.now().toString(36);
    P().add({ id, category: e.category, name: e.name, productIds: e.productId ? [e.productId] : undefined, units: e.units || '', continuous: !!e.continuous, note: 'Only in this editing session — not saved to the cloud.', stops: e.stops });
    return id;
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exportPalette(p) { download(U.slug(p.name) + '.wxpalette.json', JSON.stringify({ schema: 'wxstudio.palette.v1', name: p.name, category: p.category, productId: (p.productIds || [])[0] || null, units: p.units || '', continuous: !!p.continuous, stops: p.stops }, null, 2)); setMsg('Exported “' + p.name + '”.', 'ok'); }
  function openEditor(p, mode) {
    const dl = curDl(), pr = dl ? D.productOf(dl.source) : null, base0 = p ? (p.productIds || [])[0] : (pr && pr.palette ? pr.base : ''), base = /^demo-/.test(base0 || '') ? '' : base0;   // demo patterns are not real products
    const cat = p ? p.category : (pr && pr.palette && P().get(pr.palette) ? P().get(pr.palette).category : 'custom');
    ui.pal.editor = { mode, cloudId: mode === 'edit' && p ? cloudIdOf(p) : null, paletteId: mode === 'edit' && p ? p.id : null, name: p ? (mode === 'copy' ? p.name + ' (copy)' : p.name) : 'My palette', category: cat, productId: base || '', units: p ? p.units || '' : '', continuous: p ? !!p.continuous : false, stops: p ? p.stops.map(s => s.slice()) : [[0, '#000000'], [100, '#ffffff']] };
    setMsg('', ''); W.render();
  }
  function productOptions(cat) {
    const c = C(), seen = new Set(), out = []; if (!c) return out;
    c.list(cat).forEach(p => { if (!p.palette) return; const base = cat === 'satellite' ? p.id.replace(/^g\d+_[a-z0-9]+_/, '') : p.id; if (seen.has(base)) return; seen.add(base); out.push([base, catalogLabel(base)]); });
    return out;
  }
  async function saveEditor(toCloud) {
    const e = ui.pal.editor, pal = P(), cloud = PC();
    try {
      e.name = String(e.name || '').trim(); if (!e.name) throw new Error('Give the palette a name.');
      const stops = e.stops.map(s => [Number(s[0]), U.normHex(s[1])]).sort((a, b) => a[0] - b[0]);
      pal.validate({ id: 'custom/check', category: e.category, stops });
      if (toCloud) {
        if (!cloud) throw new Error('Cloud palette storage is not available in this build.');
        if (/^demo-/.test(e.productId || '')) throw new Error('Demo patterns are not real products. Choose the weather product this palette belongs to.');
        if (!/^[a-z0-9_-]{1,90}$/i.test(e.productId || '')) throw new Error('Choose the weather product this palette belongs to.');
        ui.pal.busy = true; setMsg('Saving to your cloud palettes…', ''); W.render();
        const row = await cloud.save({ category: e.category, productId: e.productId, name: e.name, stops, units: e.units || '', continuous: e.continuous === true, id: e.cloudId || null });
        if (e.paletteId) delete pal.custom[e.paletteId];
        const id = registerRow(Object.assign({}, row, { continuous: row.continuous === true, stops: row.stops || stops })); setMsg('Saved “' + e.name + '” to your cloud palettes.', 'ok');
        ui.pal.editor = null; useIfFits(id);
      } else {
        e.stops = stops; if (e.paletteId) delete pal.custom[e.paletteId];
        const id = registerLocal(Object.assign({}, e, { productId: e.productId || '' })); setMsg('Added “' + e.name + '” for this session only. Use “Save to cloud” to keep it.', 'ok'); ui.pal.editor = null; useIfFits(id);
      }
    } catch (err) { setMsg(String(err && err.message || err), 'err'); }
    ui.pal.busy = false; W.render();
  }
  function useIfFits(id) { const sc = cur(), dl = curDl(); if (dl && D.paletteChoices(dl.source).some(x => x.id === id)) { D.setPalette(sc, id); save(); } }
  async function syncCloud() {
    const cloud = PC(); if (!cloud) { setMsg('Cloud palette storage is not available in this build.', 'err'); return W.render(); }
    ui.pal.busy = true; setMsg('Loading your saved palettes…', ''); W.render();
    try { const rows = await cloud.list(); let n = 0; rows.forEach(r => { try { registerRow(r); n++; } catch (e) { /* skip invalid rows */ } }); setMsg(n ? n + ' saved palette' + (n === 1 ? '' : 's') + ' loaded.' : 'You have no saved palettes yet.', 'ok'); }
    catch (e) { setMsg(String(e && e.message || e), 'err'); }
    ui.pal.busy = false; W.render();
  }
  async function deletePalette(p) {
    if (ui.pal.confirm !== p.id) { ui.pal.confirm = p.id; W.render(); setTimeout(() => { if (ui.pal.confirm === p.id) { ui.pal.confirm = ''; W.render(); } }, 4000); return; }
    ui.pal.confirm = '';
    try { const cid = cloudIdOf(p); if (cid && PC()) await PC().remove(cid); delete P().custom[p.id]; const sc = cur(); if (sc && sc.dataLoop && sc.dataLoop.palette === p.id) { D.setPalette(sc, null); save(); } setMsg('Deleted “' + p.name + '”.', 'ok'); }
    catch (e) { setMsg(String(e && e.message || e), 'err'); }
    W.render();
  }
  function importFile(file) {
    if (!file) return; const rd = new FileReader();
    rd.onload = () => {
      try {
        const j = U.parsePalette(String(rd.result)), dl = curDl(), pr = dl ? D.productOf(dl.source) : null;
        ui.pal.editor = { mode: 'new', cloudId: null, paletteId: null, name: j.name || file.name.replace(/\.[^.]+$/, ''), category: U.PAL_CATEGORIES.some(c => c[0] === j.category) ? j.category : (pr && pr.palette && P().get(pr.palette) ? P().get(pr.palette).category : 'custom'), productId: j.productId || (pr && pr.palette && !/^demo-/.test(pr.base) ? pr.base : ''), units: j.units || '', continuous: !!j.continuous, stops: j.stops };
        setMsg('Imported ' + j.stops.length + ' color stops from “' + file.name + '”. Check the product, then save.', 'ok');
      } catch (e) { setMsg('Could not import “' + file.name + '”: ' + (e.message || e), 'err'); }
      W.render();
    };
    rd.onerror = () => { setMsg('Could not read that file.', 'err'); W.render(); }; rd.readAsText(file);
  }
  function palRow(p, dl) {
    const fits = !!dl && D.paletteChoices(dl.source).some(x => x.id === p.id), inUse = !!dl && D.paletteFor(cur()) === p.id, mine = isMine(p), cid = cloudIdOf(p);
    const meta = p.stops[0][0] + ' → ' + p.stops[p.stops.length - 1][0] + (p.units ? ' ' + p.units : '') + ' · ' + p.stops.length + ' stops · ' + (p.continuous ? 'smooth' : 'stepped');
    const ac = el('div', { className: 'ac' });
    ac.append(el('button', { className: 'ws-btn' + (inUse ? '' : ' pri'), text: inUse ? 'In use' : 'Use', disabled: inUse || !fits, title: fits ? 'Use on the current weather layer' : 'This palette is for a different product than the current layer', on: { click: () => { const sc = cur(), pr = D.productOf(dl.source); D.setPalette(sc, p.id === pr.palette ? null : p.id); save(); W.render(); } } }));
    ac.append(el('button', { className: 'ws-btn', text: 'Copy & edit', title: 'Make your own editable copy', on: { click: () => openEditor(p, 'copy') } }));
    ac.append(el('button', { className: 'ws-btn', text: 'Export', on: { click: () => exportPalette(p) } }));
    if (mine) { ac.append(el('button', { className: 'ws-btn', text: 'Edit', on: { click: () => openEditor(p, 'edit') } })); ac.append(el('button', { className: 'ws-btn danger', text: ui.pal.confirm === p.id ? 'Confirm' : 'Delete', on: { click: () => deletePalette(p) } })); }
    return el('div', { className: 'ws-pal' + (inUse ? ' on' : '') },
      el('div', { className: 'pm' }, strip(p.stops, !!p.continuous), el('b', { style: 'margin-top:5px' }, p.name, el('span', { className: 'ws-badge ' + (mine ? (cid ? 'cloud' : 'local') : ''), text: mine ? (cid ? 'My palette · cloud' : 'This session only') : 'Built-in starter' })), el('i', { text: meta }), p.note && !mine ? el('i', { text: p.note }) : null), ac);
  }
  function editorView(box) {
    const e = ui.pal.editor, ps = el('div', { className: 'ws-edit' });
    const pv = el('div'), redraw = () => { pv.textContent = ''; try { const st = e.stops.map(s => [Number(s[0]), U.normHex(s[1]) || '#000000']).sort((a, b) => a[0] - b[0]); if (st.length >= 2 && st.every((s, i) => i === 0 || s[0] > st[i - 1][0])) pv.append(strip(st, e.continuous)); else pv.append(el('div', { className: 'ws-note warn', text: 'Values must increase from top to bottom.' })); } catch (x) { /* preview only */ } };
    const name = el('input', { type: 'text', value: e.name, maxLength: 120 }); name.addEventListener('input', () => e.name = name.value);
    const cats = el('select', {}, U.PAL_CATEGORIES.map(([id, l]) => el('option', { value: id, text: l, selected: e.category === id }))); cats.addEventListener('change', () => { e.category = cats.value; e.productId = ''; W.render(); });
    const opts = productOptions(e.category), prod = opts.length ? el('select', {}, el('option', { value: '', text: 'Choose a product…' }), opts.map(([id, l]) => el('option', { value: id, text: l, selected: e.productId === id })), (e.productId && !opts.some(o => o[0] === e.productId)) ? el('option', { value: e.productId, text: e.productId, selected: true }) : null) : el('input', { type: 'text', placeholder: 'product id (letters, numbers, - _)', value: e.productId });
    prod.addEventListener(opts.length ? 'change' : 'input', () => e.productId = prod.value.trim());
    const units = el('input', { type: 'text', value: e.units, placeholder: 'dBZ, °C, K…' }); units.addEventListener('input', () => e.units = units.value);
    ps.append(el('div', { className: 'ws-sub', text: e.mode === 'edit' ? 'Edit palette' : 'New palette' }), el('label', { text: 'Name' }), name, el('label', { text: 'Weather category' }), cats, el('label', { text: 'Weather product it colors' }), prod, el('label', { text: 'Units' }), units);
    ps.append(el('label', { text: 'Preview' }), pv, el('label', { text: 'Color stops (value → color)' }));
    e.stops.forEach((s, i) => {
      const v = el('input', { type: 'number', step: 'any', value: s[0], attrs: { 'aria-label': 'Stop ' + (i + 1) + ' value' } }), c = el('input', { type: 'color', value: U.normHex(s[1]) || '#000000', attrs: { 'aria-label': 'Stop ' + (i + 1) + ' color' } });
      v.addEventListener('input', () => { s[0] = v.value === '' ? NaN : +v.value; redraw(); }); c.addEventListener('input', () => { s[1] = c.value; redraw(); });
      ps.append(el('div', { className: 'ws-stop' }, v, c, el('button', { className: 'ws-btn', text: '✕', title: 'Remove this stop', disabled: e.stops.length <= 2, on: { click: () => { e.stops.splice(i, 1); W.render(); } } })));
    });
    ps.append(el('div', { className: 'ws-btns' }, el('button', { className: 'ws-btn', text: '+ Add stop', disabled: e.stops.length >= 256, on: { click: () => { const last = e.stops[e.stops.length - 1]; e.stops.push([(Number(last[0]) || 0) + 5, '#ffffff']); W.render(); } } })));
    if (e.continuous) ps.append(el('div', { className: 'ws-note', text: 'Smooth color blending is saved with this palette. NOAA frames already colored by the processor will not change until scalar/recolored frames are supported.' }));
    ps.append(el('div', { className: 'ws-btns' }, el('button', { className: 'ws-btn pri', text: e.cloudId ? 'Save changes to cloud' : 'Save to my cloud palettes', disabled: ui.pal.busy, on: { click: () => saveEditor(true) } }), el('button', { className: 'ws-btn', text: 'Use this session only', disabled: ui.pal.busy, on: { click: () => saveEditor(false) } }), el('button', { className: 'ws-btn', text: 'Cancel', on: { click: () => { ui.pal.editor = null; setMsg('', ''); W.render(); } } })));
    box.append(ps); redraw();
  }
  function secPalettes(box, dl) {
    const pal = P(); if (!pal) { box.append(el('div', { className: 'ws-note', text: 'The palette registry is not loaded.' })); return; }
    const file = el('input', { type: 'file', accept: '.json,.csv,.txt,application/json,text/plain', style: 'display:none', attrs: { 'aria-label': 'Import a palette file' } });
    file.addEventListener('change', () => { importFile(file.files[0]); file.value = ''; });
    box.append(el('div', { className: 'ws-btns' },
      el('button', { className: 'ws-btn', text: 'Sync my cloud palettes', disabled: ui.pal.busy, title: 'Load the palettes you saved to your account', on: { click: syncCloud } }),
      el('button', { className: 'ws-btn', text: 'Import…', title: 'Import a .json palette, or a text/CSV list of value,#color', on: { click: () => file.click() } }),
      el('button', { className: 'ws-btn', text: 'New palette', on: { click: () => openEditor(null, 'new') } }), file));
    if (ui.pal.msg) box.append(el('div', { className: 'ws-note' + (ui.pal.kind === 'err' ? ' warn' : ''), text: ui.pal.msg, attrs: { role: 'status' } }));
    if (ui.pal.editor) { editorView(box); return; }
    const pr = dl ? D.productOf(dl.source) : null;
    if (dl && pr) {
      box.append(el('div', { className: 'ws-sub', text: 'For this layer · ' + D.displayName(dl.source, dl) }));
      if (!pr.palette) box.append(el('div', { className: 'ws-note', text: 'This source is already a finished image' + (pr.display ? ' (' + pr.display + ')' : '') + ', so no color table applies. Palettes can be managed below for other products.' }));
      else {
        D.paletteChoices(dl.source).forEach(p => box.append(palRow(p, dl)));
        const ap = D.paletteApplies(cur());
        box.append(el('div', { className: 'ws-note', text: ap === 'live' ? 'Frames here are recolored instantly when you pick a palette.' : 'Your choice is saved with the scene. Frames from the NOAA service arrive already colored, so they change only once the cloud service applies the palette.' }));
      }
    }
    box.append(el('div', { className: 'ws-sub', text: 'All palettes by product' }));
    const groups = U.groupPalettes(pal.list(), catalogLabel);
    U.PAL_CATEGORIES.forEach(([cid, label]) => {
      const byProd = groups[cid]; if (!byProd) return; const n = Object.values(byProd).reduce((a, x) => a + x.items.length, 0), open = !!ui.grp[cid];
      const g1 = el('div', { className: 'ws-grp' }, el('button', { attrs: { 'aria-expanded': String(open) }, on: { click: () => { ui.grp[cid] = !open; W.render(); } } }, el('span', { text: open ? '▾' : '▸' }), el('span', { text: label + ' · ' + n })));
      if (open) Object.values(byProd).forEach(pg => { g1.append(el('div', { className: 'ws-note', style: 'margin:6px 0 0', text: pg.label })); pg.items.forEach(p => g1.append(palRow(p, dl))); });
      box.append(g1);
    });
  }

  /* ====================== panel ====================== */
  let panel = null, scroller = null;
  function ensurePanel() {
    if (panel && panel.isConnected) return panel;
    const stage = document.getElementById('stageWrap'); if (!stage) return null;
    css();
    panel = el('div', { id: 'wxws', role: 'dialog', hidden: true, tabIndex: -1, attrs: { 'aria-label': 'Weather data' } });
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'touchstart']) panel.addEventListener(ev, e => e.stopPropagation());
    panel.addEventListener('keydown', e => { if (e.key === 'Escape' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) W.close(); });
    stage.appendChild(panel); return panel;
  }
  function scrollTo(id) { setTimeout(() => { const n = document.getElementById('wxws-' + id); if (n && n.scrollIntoView) { try { n.scrollIntoView({ block: 'start' }); } catch (e) { /* ignore */ } } }, 30); }
  function summaries() {
    const ids = Object.keys(D.sources), conn = f => ids.filter(id => f(id) && stt(id) === 'connected').length, exp = ids.filter(id => stt(id) === 'experimental').length;
    const sat = conn(id => D.classify(id).category === 'satellite' && !legacyAlias(id)), rad = conn(id => id === 'mrms' || id === 'nexrad');
    const word = (n, e) => n ? n + ' connected' : (e ? 'experimental' : 'Not connected');
    return { satellite: word(sat), radar: word(rad, exp), rtma: 'Not connected', models: 'Not connected', palettes: P() ? P().list().length + ' palettes' : '', status: overall().short };
  }
  W.render = function () {
    const p = ensurePanel(); if (!p) return;
    p.hidden = !ui.open; if (!ui.open) return;
    const keep = scroller ? scroller.scrollTop : 0, dl = curDl(), sum = summaries(), ov = overall();
    p.textContent = '';
    p.append(el('div', { className: 'ws-head' }, el('b', { text: 'Weather Data' }), el('button', { className: 'ws-x', text: '×', title: 'Close (Esc)', attrs: { 'aria-label': 'Close weather data' }, on: { click: () => W.close() } })));
    p.append(el('div', { className: 'ws-cloud', attrs: { 'data-state': ov.pm.state } }, el('span', { text: 'NOAA processor' }), el('span', { className: 't', text: ov.short, title: ov.pm.detail }), el('span', { className: 'ws-pill ' + ov.pm.pill, text: ov.pm.title })));
    scroller = el('div', { className: 'ws-scroll' });
    scroller.append(section('layer', 'Weather layer', dl ? D.displayName(dl.source, dl) : 'off', b => secLayer(b)),
      section('satellite', 'Satellite', sum.satellite, b => secSatellite(b, dl)),
      section('radar', 'Radar', sum.radar, b => secRadar(b, dl)),
      section('rtma', 'RTMA', sum.rtma, b => secPending(b, dl, 'rtma')),
      section('models', 'Forecast Models', sum.models, b => secPending(b, dl, 'models')),
      section('palettes', 'Weather Color Palettes', sum.palettes, b => secPalettes(b, dl)),
      section('status', 'Data Source Status', sum.status, b => secStatus(b)),
      section('connect', 'Connect local NOAA processor', '', b => secConnect(b)),
      section('demo', 'Demo test patterns', 'not weather data', b => secDemo(b, dl)));
    p.append(scroller); scroller.scrollTop = keep; lastSig = signature(); W.live();
  };
  /* cheap per-frame text: current frame, observation time and loading state */
  W.live = function () {
    if (!panel || !ui.open) return; const sc = cur(), n = panel.querySelector('[data-live]'); if (!n) return;
    const raw = sc && sc.dataLoop, r = rtOf(sc), fr = readyFrames(r);
    let t = '';
    if (!raw || !raw.on) t = 'Weather layer hidden';
    else if (fr.length) { const L = D.barLabels(sc); t = 'Frame ' + (Math.floor(r.lastIdx) + 1) + ' of ' + fr.length + (L && L.stamp ? ' · ' + L.stamp : ''); }
    else if (r && r.status === 'loading') t = 'Loading ' + r.loaded + ' / ' + r.total + ' frames…';
    else if (r && r.status === 'nosrc') t = 'Not connected — ' + D.displayName(raw.source, raw);
    else if (r && r.status === 'empty') t = 'No frames available';
    else if (r && r.status === 'error') t = r.msg || 'Weather data error';
    if (n.textContent !== t) n.textContent = t;
    const pl = panel.querySelector('[data-play]'); if (pl) pl.textContent = r && r.playing ? '❚❚' : '▶';
  };
  function signature() {
    const sc = cur(), dl = sc && sc.dataLoop, r = rtOf(sc), b = BR();
    return JSON.stringify([WX_si(), dl && [dl.on, dl.source, dl.site, dl.hours, dl.palette, dl.order], r && [r.status, r.total], Object.keys(D.sources).map(id => id + ':' + stt(id)).join(), b && [b.status, (b.products || []).length, b.lastCheck], RS() && RS().selected, P() ? P().list().length : 0, sc && sc.bg && sc.bg.type, dg.at, dg.busy, dg.msg, Object.keys(dg.verify).map(k => k + (dg.verify[k].at || 0)).join(), Object.keys(dg.verifying).join(), Math.floor(Date.now() / 60000), rtOf(sc) && readyFrames(rtOf(sc)).length]);
  }
  const WX_si = () => (g.WX && g.WX.S ? g.WX.S.si : -1);
  let lastSig = '';
  setInterval(function () {
    try {
      if (!ui.open || !panel) return;
      const sc = cur(); if (!sc || !sc.bg || sc.bg.type !== 'mapbox') { W.close(); return; }
      const a = document.activeElement, typing = a && panel.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
      if (!typing && signature() !== lastSig) W.render(); else W.live();
    } catch (e) { /* never disturb the editor */ }
  }, 350);

  const SECTION_OF = { satellite: 'satellite', 'radar-mosaic': 'radar', 'radar-site': 'radar', radar: 'radar', rtma: 'rtma', forecast: 'models', models: 'models', demo: 'demo', palettes: 'palettes' };
  W.open = function (tab, pal) {
    ui.open = true; const sec = pal ? 'palettes' : SECTION_OF[tab]; if (sec) { ui.sections[sec] = true; remember(); }
    W.render(); if (pal) scrollTo('palettes');
    if (bridgeEp() && Date.now() - dg.at > 15000) runDiag({ quiet: true });
  };
  W.close = function () { ui.open = false; if (panel) panel.hidden = true; };
  setInterval(function () { try { if (ui.open && bridgeEp() && !dg.busy) runDiag({ quiet: true }); } catch (e) { /* never disturb the editor */ } }, 60000);

  /* ====================== status label hook ======================
   * dataloop.js draws the dock badge, the editor message and the exported-bar label from D.liveStatus(scene). This provider says what
   * has actually been verified for the scene's source; LIVE only for a decoded, fresh real NOAA frame. Cached briefly because the dock
   * asks every animation frame. */
  let memo = null;
  D.setStatusProvider && D.setStatusProvider(function (scene) {
    const dl = scene && scene.dataLoop, key = dl ? [dl.on, dl.source, dl.site].join('|') : '', t = Date.now();
    if (memo && memo.scene === scene && memo.key === key && Math.abs(t - memo.t) < 400) return memo.res;
    const ls = layerState(dl), res = ls ? { state: ls.state, text: U.BADGE[ls.state], color: U.BADGE_COLOR[ls.state], title: U.STATE_LABEL[ls.state] + (ls.why ? ' — ' + ls.why : '') } : null;
    memo = { scene, key, t, res }; return res;
  });
  W.diag = { state: dg, run: runDiag, verify: verifyFrame, layerState, evalPid, report: makeReport };

  document.addEventListener('pointerdown', e => {
    if (!ui.open || !panel) return; const t = e.target;
    if (panel.contains(t) || (t.closest && (t.closest('#dlBar') || t.closest('#wxradar-picker')))) return; W.close();
  }, true);

  /* Take over the dock's source/palette buttons once dataloop has mounted them. Falls back to the old flyout if this panel ever fails. */
  let hooked = false, tries = 0;
  const hook = setInterval(function () {
    if (hooked || ++tries > 1200) return clearInterval(hook);
    if (typeof D.openMenu !== 'function' || !document.getElementById('dlBar')) return;
    const origOpen = D.openMenu, origClose = D.closeMenu; hooked = true; clearInterval(hook);
    D.openMenu = function (tab, pal) {
      try { if (ui.open && !pal) { W.close(); return; } W.open(tab, pal); }
      catch (e) { try { console.error('Weather workspace failed; using the original menu', e); } catch (x) { /* ignore */ } ui.open = false; if (panel) panel.hidden = true; origOpen.apply(D, arguments); }
    };
    D.closeMenu = function () { W.close(); try { origClose && origClose.apply(D, arguments); } catch (e) { /* ignore */ } };
    D.openMenu.workspace = true; W.original = { openMenu: origOpen, closeMenu: origClose };
  }, 150);
})(typeof window !== 'undefined' ? window : globalThis);
