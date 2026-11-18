/* WX Studio – master timeline animation (v0.11.6).
 *
 * A map scene can carry ONE master timeline:   scene.tl = { v:1, duration, tracks:{ [objectId]: { keys:[...], vis? } }, legacy? }
 *   - `duration` is typed by the user (seconds). It is NOT computed from steps, and scene.duration always mirrors it.
 *   - Every object animates on its own track on the same clock. A track is a list of keys sorted by time. A key stores the object's pose
 *     (any of x,y / pts / rot / size / w / h ...) at time `t`, plus how the segment that ARRIVES at the key is played:
 *         e      'linear' (default: constant speed along the route) | 'inout' | 'in' | 'out'
 *         path   'line' (default) | 'curve' (smooth through the keys) ; h1 / h2 = explicit curve handles (offsets from the previous key / from this key)
 *         att    {u,t,n} for objects that are ATTACHED to another object (position along / across the parent)
 *   - Moving between two keys follows the ROUTE (straight or Bezier) at a speed = route length / time (constant speed by arc length), eased if asked.
 *     Moving a curve handle changes the route only - never the keys. Fronts (pts) are split into a route (their centre) and a shape (rotation + scale + residual).
 *   - Links: obj.attach (v0.11.5, rides ON the parent's drawn curve) and obj.follow = {to} (inherits the parent's movement, keeps its own offset).
 *
 * Everything is a pure function of (scene, time): objectsAt(scene, t) never modifies the scene, so live playback, scrubbing, edit mode, thumbnails and the
 * frame-by-frame MP4 export draw the same picture. The editor writes keys through beginEdit()/flush(): it edits a working copy of the objects at the playhead and
 * flush() turns the DIFFERENCE into keys at that time. No change = no keys, so scrubbing can never modify the show.
 * Only plain data and arithmetic: no canvas, no DOM (unit-testable in Node). */
(function (g) {
  'use strict';
  const MA = g.MapAnim || (typeof require !== 'undefined' ? require('./mapanim.js') : null);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const isNum = v => typeof v === 'number' && isFinite(v);
  const clone = v => JSON.parse(JSON.stringify(v));
  const EPS = 0.04;                       // keys closer than this (seconds) are the same key (the playhead moves in 0.1 s steps)
  const LIM = { minDur: 0.5, maxDur: 600, maxKeys: 400 };
  const POSE = ['x', 'y', 'pts', 'rot', 'rotation', 'size', 'w', 'h', 'scale'];
  const NUMPOSE = ['rot', 'rotation', 'size', 'w', 'h', 'scale'];
  const EASES = [['linear', 'Constant speed'], ['inout', 'Ease in & out'], ['out', 'Ease out (slow at end)'], ['in', 'Ease in (slow at start)']];
  const easeFn = { linear: p => p, inout: p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2, out: p => 1 - Math.pow(1 - p, 3), in: p => p * p * p };
  const nid = () => 'q' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
  const hasPts = o => !!o && Array.isArray(o.pts) && o.pts.length >= 2 && o.pts.every(p => Array.isArray(p) && isNum(p[0]) && isNum(p[1]));
  const hasXY = o => !!o && isNum(o.x) && isNum(o.y);
  const ctxOf = sc => ({ lngLat: !!(sc && sc.bg && sc.bg.type === 'mapbox') });
  const enabled = sc => !!(sc && sc.tl && typeof sc.tl === 'object' && sc.tl.v === 1 && sc.tl.tracks && typeof sc.tl.tracks === 'object');
  const objById = (sc, id) => (sc.objects || []).find(o => o && String(o.id) === String(id)) || null;
  const trackOf = (sc, id) => (enabled(sc) && sc.tl.tracks[id]) || null;
  const centroid = pts => { let x = 0, y = 0; pts.forEach(p => { x += p[0]; y += p[1]; }); return [x / pts.length, y / pts.length]; };
  const posOf = o => hasPts(o) ? centroid(o.pts) : hasXY(o) ? [o.x, o.y] : null;
  const kxFor = (o, ctx) => {
    if (!(ctx && ctx.lngLat && o && o.geo)) return 1;
    const lat = hasPts(o) ? centroid(o.pts)[1] : o.y;
    return clamp(Math.cos((isNum(lat) ? lat : 0) * Math.PI / 180), 0.05, 1);
  };

  /* ---------------- pose ---------------- */
  function poseOf(o) {
    const p = {};
    POSE.forEach(k => {
      if (k === 'pts') { if (hasPts(o)) p.pts = o.pts.map(q => [q[0], q[1]]); }
      else if (isNum(o[k])) p[k] = o[k];
    });
    if (p.pts) { delete p.x; delete p.y; }
    return p;
  }
  const poseEq = (a, b) => {
    for (const k of POSE) {
      const x = a[k], y = b[k];
      if (k === 'pts') {
        if (!!x !== !!y) return false;
        if (x) { if (x.length !== y.length) return false; for (let i = 0; i < x.length; i++) if (Math.abs(x[i][0] - y[i][0]) > 1e-9 || Math.abs(x[i][1] - y[i][1]) > 1e-9) return false; }
      } else if (isNum(x) || isNum(y)) { if (!isNum(x) || !isNum(y) || Math.abs(x - y) > 1e-9) return false; }
    }
    return true;
  };
  const restOf = o => { const r = {}; Object.keys(o).forEach(k => { if (POSE.indexOf(k) < 0 && k[0] !== '_') r[k] = o[k]; }); return r; };

  /* ---------------- links (attach / follow) ---------------- */
  function cleanAtt(a) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
    if (!(typeof a.to === 'string' || isNum(a.to)) || a.to === '') return false;
    for (const k of ['u', 't', 'n']) { if (a[k] == null) a[k] = 0; if (!isNum(a[k]) || Math.abs(a[k]) > 1e7) return false; }
    a.u = clamp(a.u, 0, 1); return true;
  }
  /* which links are usable, in which order (parents first). Returns { order:[{c,p,mode}], drop:[{c,why}], byChild:Map } */
  function linkPlan(objs) {
    const plan = { order: [], drop: [], byChild: new Map() };
    if (!Array.isArray(objs)) return plan;
    let any = false; const byId = new Map();
    objs.forEach(o => { if (o && typeof o === 'object') { if (o.id != null && !byId.has(String(o.id))) byId.set(String(o.id), o); if (o.attach !== undefined || o.follow !== undefined) any = true; } });
    if (!any) return plan;
    const live = new Map();
    objs.forEach(c => {
      if (!c || typeof c !== 'object' || (c.attach === undefined && c.follow === undefined)) return;
      let mode = null, to = null;
      if (c.attach !== undefined && cleanAtt(c.attach)) { mode = 'attach'; to = c.attach.to; }
      else if (c.follow !== undefined && c.follow && (typeof c.follow.to === 'string' || isNum(c.follow.to)) && c.follow.to !== '') { mode = 'follow'; to = c.follow.to; }
      const p = mode ? byId.get(String(to)) : null;
      if (!p || p === c) { plan.drop.push({ c, why: 'missing parent' }); return; }
      if (!!p.geo !== !!c.geo) { plan.drop.push({ c, why: 'different positioning' }); return; }
      if (!(hasXY(p) || hasPts(p))) { plan.drop.push({ c, why: 'parent has no position' }); return; }
      if (mode === 'attach' && !(hasXY(c) && !hasPts(c))) { plan.drop.push({ c, why: 'only point-like objects can be attached' }); return; }
      if (mode === 'follow' && !(hasXY(c) || hasPts(c))) { plan.drop.push({ c, why: 'nothing to move' }); return; }
      live.set(c, { p, mode });
    });
    const idx = new Map(); objs.forEach((o, i) => idx.set(o, i));
    for (let guard = 0; guard <= objs.length; guard++) {
      let loop = null;
      for (const start of live.keys()) {
        const path = [], seen = new Set(); let cur = start;
        while (cur && live.has(cur) && !seen.has(cur)) { seen.add(cur); path.push(cur); cur = live.get(cur).p; }
        if (cur && seen.has(cur)) { loop = path.slice(path.indexOf(cur)); break; }
      }
      if (!loop) break;
      const loser = loop.reduce((a, b) => (idx.get(b) > idx.get(a) ? b : a)); live.delete(loser); plan.drop.push({ c: loser, why: 'circular link' });
    }
    const depth = new Map(), dep = c => { if (depth.has(c)) return depth.get(c); const l = live.get(c), d = l && live.has(l.p) ? dep(l.p) + 1 : 0; depth.set(c, d); return d; };
    const kids = Array.from(live.keys()); kids.forEach(dep);
    kids.map((c, i) => [c, i]).sort((a, b) => depth.get(a[0]) - depth.get(b[0]) || a[1] - b[1]).forEach(a => { const l = live.get(a[0]); plan.order.push({ c: a[0], p: l.p, mode: l.mode }); plan.byChild.set(a[0], l); });
    return plan;
  }
  /* can `child` be linked to `parent` (so no loop, same positioning, usable shapes)? */
  function canLink(objs, childId, parentId, mode) {
    const c = (objs || []).find(o => o && String(o.id) === String(childId)), p = (objs || []).find(o => o && String(o.id) === String(parentId));
    if (!c || !p || c === p) return { ok: false, why: 'Pick a different object' };
    if (!!c.geo !== !!p.geo) return { ok: false, why: 'Both must be pinned to the map, or both not' };
    if (!(hasXY(p) || hasPts(p))) return { ok: false, why: 'That object has no position' };
    if (mode === 'attach' && !(hasXY(c) && !hasPts(c))) return { ok: false, why: 'Only icons, text, H/L … can be attached' };
    if (mode === 'follow' && !(hasXY(c) || hasPts(c))) return { ok: false, why: 'Nothing to move' };
    const byId = new Map(); objs.forEach(o => { if (o && o.id != null) byId.set(String(o.id), o); });
    let cur = p; const seen = new Set();
    while (cur && !seen.has(cur)) {
      if (cur === c) return { ok: false, why: 'That would make a circle of links' }; seen.add(cur);
      const to = cur.attach && cleanAtt(Object.assign({}, cur.attach)) ? cur.attach.to : (cur.follow && cur.follow.to != null ? cur.follow.to : null);
      cur = to != null ? byId.get(String(to)) : null;
    }
    return { ok: true };
  }

  /* ---------------- route geometry ---------------- */
  const bez = (P0, P1, P2, P3, t) => { const m = 1 - t, a = m * m * m, b = 3 * m * m * t, c = 3 * m * t * t, d = t * t * t; return [a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0], a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1]]; };
  /* control points of the segment that ARRIVES at keys[i] (positions of the keys supplied by `pos(k)`) */
  function segCtl(keys, i, pos) {
    const a = keys[i - 1], b = keys[i], Pa = pos(a), Pb = pos(b), d = [Pb[0] - Pa[0], Pb[1] - Pa[1]];
    let P1 = [Pa[0] + d[0] / 3, Pa[1] + d[1] / 3], P2 = [Pb[0] - d[0] / 3, Pb[1] - d[1] / 3], curved = false;
    if (b.h1 || b.h2) { curved = true; if (b.h1) P1 = [Pa[0] + b.h1[0], Pa[1] + b.h1[1]]; if (b.h2) P2 = [Pb[0] + b.h2[0], Pb[1] + b.h2[1]]; }
    else if (b.path === 'curve') {
      curved = true; const Pp = i >= 2 ? pos(keys[i - 2]) : Pa, Pn = i + 1 < keys.length ? pos(keys[i + 1]) : Pb;
      P1 = [Pa[0] + (Pb[0] - Pp[0]) / 6, Pa[1] + (Pb[1] - Pp[1]) / 6]; P2 = [Pb[0] - (Pn[0] - Pa[0]) / 6, Pb[1] - (Pn[1] - Pa[1]) / 6];
    }
    return { P0: Pa, P1, P2, P3: Pb, curved };
  }
  const N_TAB = 32;
  function segTable(s, kx) {
    const pts = [], cum = [0]; for (let i = 0; i <= N_TAB; i++) pts.push(bez(s.P0, s.P1, s.P2, s.P3, i / N_TAB));
    for (let i = 1; i <= N_TAB; i++) cum.push(cum[i - 1] + Math.hypot((pts[i][0] - pts[i - 1][0]) * kx, pts[i][1] - pts[i - 1][1]));
    return { cum, L: cum[N_TAB] };
  }
  /* point at fraction f (0..1) of the route LENGTH -> constant speed */
  function atFraction(s, kx, f) {
    if (!s.curved) return [s.P0[0] + (s.P3[0] - s.P0[0]) * f, s.P0[1] + (s.P3[1] - s.P0[1]) * f];
    const tb = segTable(s, kx); if (!(tb.L > 0)) return [s.P0[0], s.P0[1]];
    const d = clamp(f, 0, 1) * tb.L; let j = 1; while (j < N_TAB && tb.cum[j] < d) j++;
    const seg = tb.cum[j] - tb.cum[j - 1] || 1, fr = clamp((d - tb.cum[j - 1]) / seg, 0, 1);
    return bez(s.P0, s.P1, s.P2, s.P3, (j - 1 + fr) / N_TAB);
  }
  const segLength = (s, kx) => s.curved ? segTable(s, kx).L : Math.hypot((s.P3[0] - s.P0[0]) * kx, s.P3[1] - s.P0[1]);

  /* ---------------- front shape morph: rotation + scale + residual ---------------- */
  function morphShape(A, B, u, kx, o) {
    let a = A, b = B;
    if (a.length !== b.length) { const n = Math.max(a.length, b.length, 2); a = MA.resample(a, n, o || {}); b = MA.resample(b, n, o || {}); }
    const ca = centroid(a), cb = centroid(b), n = a.length;
    const Ra = a.map(p => [(p[0] - ca[0]) * kx, p[1] - ca[1]]), Rb = b.map(p => [(p[0] - cb[0]) * kx, p[1] - cb[1]]);
    let sxy = 0, sdot = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i++) { sxy += Ra[i][0] * Rb[i][1] - Ra[i][1] * Rb[i][0]; sdot += Ra[i][0] * Rb[i][0] + Ra[i][1] * Rb[i][1]; na += Ra[i][0] * Ra[i][0] + Ra[i][1] * Ra[i][1]; nb += Rb[i][0] * Rb[i][0] + Rb[i][1] * Rb[i][1]; }
    const th = (na > 1e-18 && nb > 1e-18) ? Math.atan2(sxy, sdot) : 0, sc = (na > 1e-18 && nb > 1e-18) ? Math.sqrt(nb / na) : 1;
    const rot = (v, ang, s) => { const c = Math.cos(ang) * s, si = Math.sin(ang) * s; return [v[0] * c - v[1] * si, v[0] * si + v[1] * c]; };
    const su = Math.pow(sc, u);
    return Ra.map((r, i) => { const rb = rot(Rb[i], -th, 1 / sc), q = [r[0] * (1 - u) + rb[0] * u, r[1] * (1 - u) + rb[1] * u], m = rot(q, th * u, su); return [m[0] / kx, m[1]]; });
  }

  /* ---------------- evaluating a track ---------------- */
  const keyPos = k => k.pts ? centroid(k.pts) : (isNum(k.x) && isNum(k.y) ? [k.x, k.y] : null);
  /* the pose / attach offsets of an object at time T (null when it has no keys) */
  function poseAt(o, tr, T, ctx) {
    const keys = tr && tr.keys; if (!keys || !keys.length) return null;
    const out = {};
    const take = k => { POSE.forEach(p => { if (k[p] !== undefined) out[p] = p === 'pts' ? k.pts.map(q => [q[0], q[1]]) : k[p]; }); if (k.att) out.att = { u: k.att.u, t: k.att.t, n: k.att.n }; };
    if (T <= keys[0].t) { take(keys[0]); return out; }
    const last = keys[keys.length - 1]; if (T >= last.t) { take(last); return out; }
    let i = 1; while (i < keys.length - 1 && keys[i].t <= T) i++;
    const a = keys[i - 1], b = keys[i], span = b.t - a.t, p = span > 0 ? clamp((T - a.t) / span, 0, 1) : 1, u = (easeFn[b.e] || easeFn.linear)(p);
    if (u <= 0) { take(a); return out; } if (u >= 1 - 1e-12 && p >= 1) { take(b); return out; }
    const kx = kxFor(o, ctx);
    const Pa = keyPos(a), Pb = keyPos(b);
    let at = null;                                                     // position along the route at the eased progress
    if (Pa && Pb) at = atFraction(segCtl(keys, i, keyPos), kx, u);
    /* fall back to the keys that do carry a position (a key written before the object had one) */
    NUMPOSE.forEach(k => { const x = a[k], y = b[k]; if (isNum(x) && isNum(y)) out[k] = x + (y - x) * u; else if (isNum(x)) out[k] = x; else if (isNum(y)) out[k] = y; });
    if (a.pts && b.pts) {
      const shape = morphShape(a.pts, b.pts, u, kx, o), c = at || centroid(a.pts), cs = centroid(shape);
      out.pts = shape.map(q => [q[0] - cs[0] + c[0], q[1] - cs[1] + c[1]]);
    } else if (a.pts || b.pts) out.pts = (a.pts || b.pts).map(q => [q[0], q[1]]);
    else if (at) { out.x = at[0]; out.y = at[1]; }
    else { const s = a.x !== undefined ? a : b; if (isNum(s.x)) { out.x = s.x; out.y = s.y; } }
    if (a.att && b.att) out.att = { u: clamp(a.att.u + (b.att.u - a.att.u) * u, 0, 1), t: a.att.t + (b.att.t - a.att.t) * u, n: a.att.n + (b.att.n - a.att.n) * u };
    else if (a.att || b.att) { const s = a.att || b.att; out.att = { u: s.u, t: s.t, n: s.n }; }
    return out;
  }
  function applyPose(o, pose) {
    const c = Object.assign({}, o);
    POSE.forEach(k => { if (pose[k] !== undefined) c[k] = pose[k]; });
    if (pose.pts) { delete c.x; delete c.y; if (!hasPts(o)) c.pts = pose.pts; }
    if (pose.att && c.attach) c.attach = Object.assign({}, c.attach, pose.att);
    return c;
  }
  const visFade = 0.3;
  /* ---------------- resolve every object at time T ---------------- */
  function resolveMap(sc, T, ctx, memoZero) {
    const objs = sc.objects || [], tl = enabled(sc) ? sc.tl : null, out = new Map();
    const plan = linkPlan(objs);
    const linked = new Set(plan.order.map(q => q.c));
    objs.forEach(o => {
      if (!o || typeof o !== 'object') return;
      const tr = tl && tl.tracks[o.id], pose = tr ? poseAt(o, tr, T, ctx) : null;
      let c = pose ? applyPose(o, pose) : o;
      if (tr && tr.vis && isNum(tr.vis.a) || (tr && tr.vis && isNum(tr.vis.b))) {
        const a = tr.vis.a, b = tr.vis.b;
        if ((isNum(a) && T < a - 1e-9) || (isNum(b) && T > b + 1e-9)) { if (c === o) c = Object.assign({}, o); c.hidden = true; }
        else if (isNum(a) && a > 0 && T < a + visFade) { if (c === o) c = Object.assign({}, o); c._a = clamp((T - a) / visFade, 0, 1); }
      }
      if (c === o && linked.has(o)) c = Object.assign({}, o);
      out.set(o, c);
    });
    if (plan.order.length) {
      const zero = (T > 0 && plan.order.some(q => q.mode === 'follow')) ? (memoZero || resolveMap(sc, 0, ctx, null)) : null;
      plan.order.forEach(q => {
        const c = out.get(q.c), p = out.get(q.p); if (!c || !p) return;
        if (q.mode === 'attach') { const pos = MA.attachPos(c.attach, p, ctx); if (isNum(pos[0]) && isNum(pos[1])) { c.x = pos[0]; c.y = pos[1]; } }
        else if (zero) {
          const p0 = zero.get(q.p) || p, a = posOf(p), b = posOf(p0); if (!a || !b) return;
          const dx = a[0] - b[0], dy = a[1] - b[1];
          if (dx || dy) { if (hasPts(c)) c.pts = c.pts.map(v => [v[0] + dx, v[1] + dy]); else if (hasXY(c)) { c.x += dx; c.y += dy; } }
        }
      });
    }
    return out;
  }
  const duration = sc => enabled(sc) ? sc.tl.duration : (sc && sc.duration) || 0;
  /* The objects to draw at scene time t (static objects are returned as they are, never copied; animated ones are fresh copies). */
  function objectsAt(sc, t) {
    if (!enabled(sc)) return sc.objects;
    const T = clamp(+t || 0, 0, sc.tl.duration), m = resolveMap(sc, T, ctxOf(sc), null);
    return (sc.objects || []).map(o => (m.get(o) || o));
  }
  /* parent displacement (used by follow): same maths as above for one object */
  function resolvedPose(sc, id, T) { const m = resolveMap(sc, clamp(T, 0, duration(sc)), ctxOf(sc), null), o = objById(sc, id); return o ? m.get(o) : null; }

  /* ---------------- scene-level model ---------------- */
  function enable(sc, o) {
    o = o || {}; if (enabled(sc)) return sc;
    const d = clamp(+o.duration || +sc.duration || 12, LIM.minDur, LIM.maxDur);
    sc.tl = { v: 1, duration: d, tracks: {} }; sc.duration = d; return sc;
  }
  function setDuration(sc, d) { if (!enabled(sc)) return; d = clamp(isNum(+d) ? +d : sc.tl.duration, LIM.minDur, LIM.maxDur); sc.tl.duration = Math.round(d * 100) / 100; sc.duration = sc.tl.duration; }
  /* base pose of a track's object = the t = 0 key (older builds and the thumbnail read scene.objects) */
  function syncBase(sc, id) {
    const o = objById(sc, id), tr = trackOf(sc, id); if (!o || !tr || !tr.keys.length) return;
    const k0 = tr.keys[0]; POSE.forEach(p => { if (k0[p] !== undefined) o[p] = p === 'pts' ? k0.pts.map(q => [q[0], q[1]]) : k0[p]; });
    if (k0.pts) { delete o.x; delete o.y; }
    if (k0.att && o.attach) o.attach = Object.assign({}, o.attach, { u: k0.att.u, t: k0.att.t, n: k0.att.n });
  }
  function sortKeys(tr) { tr.keys.sort((a, b) => a.t - b.t); }
  /* make the block valid (also on load: hand-edited or future files cannot break playback). Returns the scene. */
  function normalize(sc) {
    if (!sc || sc.tl === undefined) return sc;
    if (!enabled(sc)) { if (sc.tl && !sc.tl.v) { /* unknown future shape: leave alone */ } return sc; }
    const tl = sc.tl; tl.duration = clamp(isNum(+tl.duration) && +tl.duration > 0 ? +tl.duration : (+sc.duration || 12), LIM.minDur, LIM.maxDur); sc.duration = tl.duration;
    const ids = new Set((sc.objects || []).filter(o => o && o.id != null).map(o => String(o.id)));
    Object.keys(tl.tracks).forEach(id => {
      const tr = tl.tracks[id];
      if (!ids.has(String(id)) || !tr || !Array.isArray(tr.keys)) { delete tl.tracks[id]; return; }
      const seen = [];
      tr.keys = tr.keys.filter(k => k && isNum(k.t)).map(k => { k.t = Math.max(0, k.t); if (!k.id) k.id = nid(); if (!easeFn[k.e]) delete k.e; if (k.path !== 'curve') delete k.path;
        ['h1', 'h2'].forEach(h => { if (k[h] && !(Array.isArray(k[h]) && isNum(k[h][0]) && isNum(k[h][1]))) delete k[h]; });
        if (k.pts && !(Array.isArray(k.pts) && k.pts.length >= 2 && k.pts.every(q => Array.isArray(q) && isNum(q[0]) && isNum(q[1])))) delete k.pts;
        POSE.forEach(p => { if (p !== 'pts' && k[p] !== undefined && !isNum(k[p])) delete k[p]; });
        if (k.att && !cleanAtt(Object.assign({ to: 'x' }, k.att))) delete k.att; return k; })
        .sort((a, b) => a.t - b.t).filter(k => { if (seen.some(t => Math.abs(t - k.t) < EPS)) return false; seen.push(k.t); return true; });
      if (tr.keys.length > LIM.maxKeys) tr.keys.length = LIM.maxKeys;
      if (!tr.keys.length) { if (!(tr.vis && (isNum(tr.vis.a) || isNum(tr.vis.b)))) delete tl.tracks[id]; return; }
      if (tr.keys[0].t > EPS) { const o = objById(sc, id); tr.keys.unshift(Object.assign({ id: nid(), t: 0 }, poseOf(o), o.attach ? { att: { u: o.attach.u || 0, t: o.attach.t || 0, n: o.attach.n || 0 } } : {})); }
      else tr.keys[0].t = 0;
      if (tr.vis && !(isNum(tr.vis.a) || isNum(tr.vis.b))) delete tr.vis;
    });
    return sc;
  }
  /* load / import safety: drop links that cannot work, put attached children exactly where their keys say (same objects, nothing else changes) */
  function sanitize(sc) {
    if (!enabled(sc)) return 0; let n = 0;
    const plan = linkPlan(sc.objects || []); plan.drop.forEach(d => { delete d.c.attach; delete d.c.follow; n++; });
    return n;
  }

  /* ---------------- key operations ---------------- */
  const findKey = (tr, t) => tr.keys.find(k => Math.abs(k.t - t) < EPS) || null;
  function ensureTrack(sc, id) {
    enable(sc); const o = objById(sc, id); if (!o) return null;
    let tr = sc.tl.tracks[id];
    if (!tr) { tr = sc.tl.tracks[id] = { keys: [] }; }
    if (!tr.keys.length) tr.keys.push(Object.assign({ id: nid(), t: 0 }, poseOf(o), o.attach ? { att: { u: o.attach.u || 0, t: o.attach.t || 0, n: o.attach.n || 0 } } : {}));
    return tr;
  }
  /* write (create or update) the key of object `id` at time T with `pose` (and att). Returns the key. */
  function setKey(sc, id, T, pose, extra) {
    T = clamp(+T || 0, 0, sc.tl ? sc.tl.duration : 1e9);
    const tr = ensureTrack(sc, id); if (!tr) return null;
    let k = findKey(tr, T);
    if (!k) { if (tr.keys.length >= LIM.maxKeys) return null; k = { id: nid(), t: Math.round(T * 1000) / 1000 }; if (T < EPS) k.t = 0; tr.keys.push(k); sortKeys(tr); }
    POSE.forEach(p => delete k[p]); delete k.att;
    Object.keys(pose || {}).forEach(p => { if (POSE.indexOf(p) >= 0) k[p] = p === 'pts' ? pose.pts.map(q => [q[0], q[1]]) : pose[p]; });
    if (pose && pose.att) k.att = { u: pose.att.u, t: pose.att.t, n: pose.att.n };
    if (extra) Object.assign(k, extra);
    syncBase(sc, id); return k;
  }
  function getKey(sc, id, keyId) { const tr = trackOf(sc, id); return tr ? (tr.keys.find(k => k.id === keyId) || null) : null; }
  function moveKey(sc, id, keyId, T) {
    const tr = trackOf(sc, id), k = tr && tr.keys.find(q => q.id === keyId); if (!k || k === tr.keys[0]) return false;
    T = clamp(Math.round((+T || 0) * 10) / 10, 0, sc.tl.duration); if (T < EPS) return false;
    if (tr.keys.some(q => q !== k && Math.abs(q.t - T) < EPS)) return false;
    k.t = T; sortKeys(tr); return true;
  }
  function delKey(sc, id, keyId) {
    const tr = trackOf(sc, id), k = tr && tr.keys.find(q => q.id === keyId); if (!k) return false;
    if (k === tr.keys[0]) return false;                    // the start pose cannot be deleted (delete the later keys instead)
    tr.keys.splice(tr.keys.indexOf(k), 1);
    if (tr.keys.length === 1 && !(tr.vis)) { syncBase(sc, id); delete sc.tl.tracks[id]; }
    return true;
  }
  function setEase(sc, id, keyId, e) { const k = getKey(sc, id, keyId); if (!k) return false; if (e === 'linear' || !easeFn[e]) delete k.e; else k.e = e; return true; }
  function setPath(sc, id, keyId, path) { const k = getKey(sc, id, keyId); if (!k) return false; delete k.h1; delete k.h2; if (path === 'curve') k.path = 'curve'; else delete k.path; return true; }
  function setHandles(sc, id, keyId, h1, h2) {
    const k = getKey(sc, id, keyId); if (!k) return false;
    if (h1) k.h1 = [h1[0], h1[1]]; if (h2) k.h2 = [h2[0], h2[1]]; delete k.path; return true;
  }
  /* all segments of an object become straight / smooth */
  function setPathAll(sc, id, path) { const tr = trackOf(sc, id); if (!tr) return 0; let n = 0; tr.keys.forEach((k, i) => { if (i > 0) { setPath(sc, id, k.id, path); n++; } }); return n; }
  function setEaseAll(sc, id, e) { const tr = trackOf(sc, id); if (!tr) return 0; let n = 0; tr.keys.forEach((k, i) => { if (i > 0) { setEase(sc, id, k.id, e); n++; } }); return n; }

  /* route of an object, for the editor overlay: dense points, key positions and handles of every segment */
  function routeOf(sc, id) {
    const tr = trackOf(sc, id), o = objById(sc, id); if (!tr || tr.keys.length < 1 || !o) return null;
    const ctx = ctxOf(sc), keys = tr.keys, kx = kxFor(o, ctx), segs = [], keyPts = keys.map(keyPos);
    if (keyPts.some(p => !p)) return null;
    for (let i = 1; i < keys.length; i++) {
      const s = segCtl(keys, i, keyPos), dense = []; for (let j = 0; j <= 24; j++) dense.push(s.curved ? bez(s.P0, s.P1, s.P2, s.P3, j / 24) : [s.P0[0] + (s.P3[0] - s.P0[0]) * j / 24, s.P0[1] + (s.P3[1] - s.P0[1]) * j / 24]);
      segs.push({ key: keys[i].id, ctl: s, dense, length: segLength(s, kx), time: keys[i].t - keys[i - 1].t, curved: s.curved, mid: bez(s.P0, s.P1, s.P2, s.P3, 0.5) });
    }
    return { keys: keys.map((k, i) => ({ id: k.id, t: k.t, pos: keyPts[i] })), segs, kx };
  }
  /* average speed of a segment in map units per second (scaled like the route length) - for the panel / tests */
  function segSpeed(sc, id, keyId) { const r = routeOf(sc, id); if (!r) return 0; const s = r.segs.find(q => q.key === keyId); return s && s.time > 0 ? s.length / s.time : 0; }

  /* ---------------- editing: working copy at the playhead, keys from the difference ---------------- */
  function beginEdit(sc, T, ctx) {
    T = clamp(+T || 0, 0, duration(sc)); ctx = ctx || ctxOf(sc);
    const src = objectsAt(sc, T), objs = src.map(o => clone(o)), snap = new Map();
    objs.forEach(o => { if (o && o.id != null) snap.set(String(o.id), { pose: poseOf(o), rest: JSON.stringify(restOf(o)) }); });
    objs.forEach(o => { delete o._a; });
    return { sc, T, objs, snap, order: objs.map(o => String(o.id)) };
  }
  /* translate an object's whole own-frame path (base + every key) */
  function shiftPath(sc, o, dx, dy) {
    const mv = k => { if (k.pts) k.pts = k.pts.map(q => [q[0] + dx, q[1] + dy]); else if (isNum(k.x) && isNum(k.y)) { k.x += dx; k.y += dy; } };
    mv(o); const tr = trackOf(sc, o.id); if (tr) tr.keys.forEach(mv);
  }
  /* Bake a linked object's visible movement into its own keys (so unlinking changes nothing on screen). Times: its own keys, its parents' keys, the playhead. */
  function bake(sc, id, T) {
    const o = objById(sc, id); if (!o || !enabled(sc)) return false;
    const ctx = ctxOf(sc), plan = linkPlan(sc.objects), ts = new Set([0, Math.round(T * 1000) / 1000]);
    let cur = o; const seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); const tr = trackOf(sc, cur.id); if (tr) tr.keys.forEach(k => ts.add(k.t)); const l = plan.byChild.get(cur); cur = l ? l.p : null; }
    let times = Array.from(ts).sort((a, b) => a - b);
    const withMid = []; times.forEach((t, i) => { withMid.push(t); const nx = times[i + 1]; if (nx != null && nx - t > 1.5) withMid.push(Math.round((t + nx) / 2 * 10) / 10); });
    times = withMid;
    const rows = times.map(t => ({ t, o: resolveMap(sc, t, ctx, null).get(o) }));
    delete o.attach; delete o.follow;
    const tr = trackOf(sc, id), keep = tr ? tr.keys.filter(k => times.every(t => Math.abs(t - k.t) >= EPS)) : [];
    const keys = rows.map(r => { const k = Object.assign({ id: nid(), t: r.t }, poseOf(r.o)); return k; });
    if (tr) {
      const old = tr.keys; keys.forEach(k => { const m = old.find(q => Math.abs(q.t - k.t) < EPS); if (m) { k.id = m.id; if (m.e) k.e = m.e; if (m.path) k.path = m.path; } });
      void keep;
    }
    const t2 = sc.tl.tracks[id] = (tr || { keys: [] }); t2.keys = keys; sortKeys(t2); if (t2.keys.length) t2.keys[0].t = 0;
    if (t2.keys.length === 1 && !t2.vis) { syncBase(sc, id); delete sc.tl.tracks[id]; } else syncBase(sc, id);
    return true;
  }
  /* Turn the edits made in the working copy `ed` into keys. Returns { changed, keys: [[id, keyId]], warn: [] }. Nothing different = nothing written. */
  function flush(sc, ed) {
    const res = { changed: false, keys: [], warn: [] };
    if (!enabled(sc) || !ed || ed.sc !== sc) return res;
    const T = ed.T, ctx = ctxOf(sc), work = ed.objs.filter(o => o && o.id != null), wIds = new Set(work.map(o => String(o.id)));
    const byWork = new Map(work.map(o => [String(o.id), o]));
    /* 1. removed objects */
    Array.from(ed.snap.keys()).forEach(id => {
      if (wIds.has(id)) return; const o = objById(sc, id); if (!o) return;
      (sc.objects || []).forEach(c => { const l = (c.attach && String(c.attach.to) === id) ? 'attach' : (c.follow && String(c.follow.to) === id) ? 'follow' : null; if (l) { bake(sc, c.id, T); } });
      sc.objects.splice(sc.objects.indexOf(o), 1); delete sc.tl.tracks[id]; res.changed = true;
    });
    /* 2. new objects */
    work.forEach(w => {
      if (ed.snap.has(String(w.id)) || objById(sc, w.id)) return;
      const n = clone(w); delete n._a; sc.objects.push(n); res.changed = true;
      if (T > EPS) sc.tl.tracks[w.id] = { keys: [], vis: { a: Math.round(T * 1000) / 1000 } };
    });
    /* 3. changed objects: plain objects first (their keys may move a parent), then linked children (judged in their OWN frame, after the parents are final) */
    const isLinked = o => linkPlan(sc.objects).byChild.has(o);
    const restPass = w => {
      const id = String(w.id), s = ed.snap.get(id), o = objById(sc, id); if (!s || !o) return;
      const restNow = JSON.stringify(restOf(w)); if (restNow === s.rest) return;
      const before = { a: o.attach ? JSON.stringify(o.attach) : '', f: o.follow ? JSON.stringify(o.follow) : '' };
      if ((o.attach || o.follow) && !(w.attach || w.follow)) bake(sc, id, T);                // unlink: freeze what is on screen
      const r = restOf(w); Object.keys(o).forEach(k => { if (POSE.indexOf(k) < 0 && k[0] !== '_' && !(k in r)) delete o[k]; });
      Object.keys(r).forEach(k => { if (k === 'attach' && o.attach && o.attach.to === r.attach.to && isLinkedAtt(sc, id)) return; o[k] = clone(r[k]); });
      if (o.attach && o.follow) delete o.follow;
      const after = { a: o.attach ? JSON.stringify(o.attach) : '', f: o.follow ? JSON.stringify(o.follow) : '' };
      res.changed = true;
      if (before.a !== after.a || before.f !== after.f) {
        const chk = (o.attach || o.follow) ? canLink(sc.objects, id, (o.attach || o.follow).to, o.attach ? 'attach' : 'follow') : { ok: true };
        if (!chk.ok) { delete o.attach; delete o.follow; res.warn.push('Link not made: ' + chk.why); return; }
        if (o.follow && !o.attach) {                                                           // keep the object where it was on screen when it starts to follow
          const got = poseOf(resolveMap(sc, T, ctx, null).get(o) || o), want = s.pose, pw = hasPts(want) ? centroid(want.pts) : [want.x, want.y], pg = hasPts(got) ? centroid(got.pts) : [got.x, got.y];
          if (isNum(pw[0]) && isNum(pg[0])) shiftPath(sc, o, pw[0] - pg[0], pw[1] - pg[1]);
          s.pose = poseOf(w);
        }
      }
    };
    work.forEach(restPass);
    const plan0 = linkPlan(sc.objects);
    work.forEach(w => {                                                                      // phase A: not linked
      const id = String(w.id), s = ed.snap.get(id), o = objById(sc, id); if (!s || !o || plan0.byChild.has(o)) return;
      if (poseEq(s.pose, poseOf(w))) return; res.changed = true;
      if (!trackOf(sc, id) && T < EPS) { POSE.forEach(p => { if (w[p] !== undefined) o[p] = p === 'pts' ? w.pts.map(q => [q[0], q[1]]) : w[p]; }); if (hasPts(w)) { delete o.x; delete o.y; } return; }
      const k = setKey(sc, id, T, poseOf(w)); if (k) res.keys.push([id, k.id]);
    });
    const plan1 = linkPlan(sc.objects), zero = (T > 0 && plan1.order.some(q => q.mode === 'follow')) ? resolveMap(sc, 0, ctx, null) : null, now = resolveMap(sc, T, ctx, null);
    plan1.order.forEach(q => {                                                               // phase B: linked children, parents first
      const w = byWork.get(String(q.c.id)), s = w && ed.snap.get(String(q.c.id)); if (!w || !s) return;
      const id = String(q.c.id), tr = trackOf(sc, id), old = (tr && poseAt(q.c, tr, T, ctx)) || {};
      if (poseEq(s.pose, poseOf(w))) return;                                                // not touched (a moved parent carries it)
      if (q.mode === 'attach') {
        const parent = now.get(q.p) || q.p, a = MA.attachFromPoint(parent, w.x, w.y, ctx), cur = old.att || q.c.attach || { u: 0, t: 0, n: 0 };
        if (Math.abs(a.u - cur.u) < 1e-5 && Math.abs(a.t - cur.t) < 1e-4 && Math.abs(a.n - cur.n) < 1e-4) return;
        res.changed = true; const k = setKey(sc, id, T, { att: a }); if (k) res.keys.push([id, k.id]);
      } else {
        const pN = now.get(q.p) || q.p, p0 = zero ? (zero.get(q.p) || pN) : pN, a = posOf(pN), b = posOf(p0), dx = a[0] - b[0], dy = a[1] - b[1], pose = poseOf(w);
        if (pose.pts) pose.pts = pose.pts.map(v => [v[0] - dx, v[1] - dy]); else if (isNum(pose.x)) { pose.x -= dx; pose.y -= dy; }
        const own = tr ? poseAt(q.c, tr, T, ctx) : poseOf(q.c);
        if (own && poseEq(Object.assign({}, own), pose)) return;
        res.changed = true; const k = setKey(sc, id, T, pose); if (k) res.keys.push([id, k.id]);
      }
    });
    /* 4. stacking order */
    const want = work.map(o => String(o.id)).filter(id => objById(sc, id)), cur = sc.objects.map(o => String(o.id)).filter(id => wIds.has(id));
    if (want.length === cur.length && want.some((id, i) => id !== cur[i])) {
      const map = new Map(sc.objects.map(o => [String(o.id), o])), rest = sc.objects.filter(o => !wIds.has(String(o.id)));
      sc.objects = work.map(w => map.get(String(w.id))).filter(Boolean).concat(rest); res.changed = true;
    }
    if (res.changed) normalize(sc);
    return res;
  }
  const isLinkedAtt = () => false;
  /* While the user drags a parent in the working copy, its attached / following children ride along live (every frame). A child the user drags itself
     stays where it is put (and, for an attached child, learns its new place on the parent in `_att`, which is never saved). Returns the number moved. */
  function liveSync(ed) {
    if (!ed || !Array.isArray(ed.objs)) return 0; const ctx = ctxOf(ed.sc), plan = linkPlan(ed.objs); let n = 0; ed.live = ed.live || new Map();
    plan.order.forEach(q => {
      const c = q.c, p = q.p, m = ed.live.get(c), pp = posOf(p); if (!pp || !hasXY(c) && !hasPts(c)) return; const cp = posOf(c);
      const movedByUser = m && (Math.abs(m.pos[0] - cp[0]) > 1e-9 || Math.abs(m.pos[1] - cp[1]) > 1e-9);
      if (q.mode === 'attach') {
        if (movedByUser) c._att = MA.attachFromPoint(p, c.x, c.y, ctx);
        else if (m) { const pos = MA.attachPos(Object.assign({}, c.attach, c._att || {}), p, ctx); if (isNum(pos[0]) && (Math.abs(pos[0] - c.x) > 1e-9 || Math.abs(pos[1] - c.y) > 1e-9)) { c.x = pos[0]; c.y = pos[1]; n++; } }
      } else if (m && !movedByUser) {
        const dx = pp[0] - m.par[0], dy = pp[1] - m.par[1];
        if (dx || dy) { if (hasPts(c)) c.pts = c.pts.map(v => [v[0] + dx, v[1] + dy]); else { c.x += dx; c.y += dy; } n++; }
      }
      const np = posOf(c); ed.live.set(c, { pos: np, par: pp });
    });
    return n;
  }
  /* did the working copy change (without writing anything)? */
  function dirty(sc, ed) {
    if (!enabled(sc) || !ed) return false;
    const ids = new Set(ed.objs.filter(o => o && o.id != null).map(o => String(o.id)));
    if (ids.size !== ed.snap.size) return true;
    for (const w of ed.objs) { const s = ed.snap.get(String(w.id)); if (!s) return true; if (!poseEq(s.pose, poseOf(w)) || JSON.stringify(restOf(w)) !== s.rest) return true; }
    return ed.order.join() !== ed.objs.map(o => String(o.id)).join();
  }

  /* ---------------- links as editor commands ---------------- */
  /* set / change / remove the link of `id` at playhead T directly on the saved scene (used by tests and non-editor callers; the editor goes through flush()) */
  function link(sc, id, mode, parentId, T) {
    if (!enabled(sc)) enable(sc); const o = objById(sc, id), ctx = ctxOf(sc); if (!o) return { ok: false, why: 'No such object' };
    T = clamp(+T || 0, 0, sc.tl.duration);
    if (mode === 'independent' || !mode) { if (o.attach || o.follow) bake(sc, id, T); return { ok: true }; }
    const chk = canLink(sc.objects, id, parentId, mode); if (!chk.ok) return chk;
    const parent = objById(sc, parentId), here = resolveMap(sc, T, ctx, null), me = here.get(o) || o, wasLinked = !!(o.attach || o.follow);
    if (wasLinked) bake(sc, id, T);
    const m2 = resolveMap(sc, T, ctx, null), me2 = m2.get(o) || o, pp = m2.get(parent) || parent;
    if (mode === 'attach') {
      const a = MA.attachFromPoint(pp, me2.x, me2.y, ctx); delete o.follow; o.attach = Object.assign({ to: parent.id }, a);
      const tr = trackOf(sc, id); if (tr) tr.keys.forEach(k => { k.att = { u: a.u, t: a.t, n: a.n }; }); else { o.x = me2.x; o.y = me2.y; }
    } else {
      delete o.attach; o.follow = { to: parent.id };
      const got = resolveMap(sc, T, ctx, null).get(o) || o, pw = posOf(me2), pg = posOf(got); if (pw && pg) shiftPath(sc, o, pw[0] - pg[0], pw[1] - pg[1]);
    }
    void me; normalize(sc); return { ok: true };
  }

  /* ---------------- v0.11.5 step shows <-> master timeline ---------------- */
  /* explicit, lossless conversion: the original step show is kept inside tl.legacy so "Back to steps" restores it exactly */
  function fromSteps(sc) {
    if (!sc || !MA.isAnimated(sc)) return { ok: false, why: 'This scene has no steps' };
    if (enabled(sc)) return { ok: false, why: 'Already a master timeline' };
    const legacy = { anim: clone(sc.anim), objects: clone(sc.objects || []), duration: sc.duration };
    const tl = MA.timeline(sc), n = sc.anim.steps.length, warn = [], ctx = ctxOf(sc);
    const stepObjs = k => MA.stepObjects(sc, k);
    const first = new Map(), lastIdx = new Map(), appears = new Map(), order = [];
    for (let k = 0; k < n; k++) stepObjs(k).forEach(o => { if (!o || o.id == null) return; const id = String(o.id); if (!first.has(id)) { first.set(id, clone(o)); appears.set(id, k); order.push(id); } lastIdx.set(id, k); });
    const hold = k => tl.segs.find(s => s.kind === 'hold' && s.step === k), move = k => tl.segs.find(s => s.kind === 'move' && s.to === k);
    const tracks = {}, objects = [];
    order.forEach(id => {
      const base = first.get(id), tr = { keys: [] }, a0 = appears.get(id), l0 = lastIdx.get(id); let diff = false;
      for (let k = a0; k <= l0; k++) {
        const o = stepObjs(k).find(q => q && String(q.id) === id); if (!o) continue;
        if (JSON.stringify(restOf(o)) !== JSON.stringify(restOf(base))) diff = true;
        const hd = hold(k), mv = move(k), pose = poseOf(o);
        const e = mv && k > a0 ? (mv.ease === 'inout' ? 'inout' : mv.ease === 'out' ? 'out' : 'linear') : undefined;
        const att = o.attach && cleanAtt(Object.assign({}, o.attach)) ? { att: { u: o.attach.u, t: o.attach.t, n: o.attach.n } } : {};
        const mk = (t, extra) => Object.assign({ id: nid(), t: Math.round(t * 1000) / 1000 }, pose, att, extra || {});
        const kk = mk(hd.t0, e ? { e } : {}); if (e === 'linear' || e === undefined) delete kk.e; tr.keys.push(kk);
        if (hd.t1 - hd.t0 > EPS) tr.keys.push(mk(hd.t1));
      }
      if (diff) warn.push('“' + (base.name || base.type || id) + '” changes style between steps: the first step’s style is used');
      if (a0 > 0) { const mv = move(a0); tr.vis = { a: Math.round((mv ? mv.t0 : 0) * 1000) / 1000 }; }
      if (l0 < n - 1) { const mv = move(l0 + 1); tr.vis = Object.assign(tr.vis || {}, { b: Math.round((mv ? mv.t0 + 0.4 * (mv.t1 - mv.t0) : hold(l0).t1) * 1000) / 1000 }); }
      const moving = tr.keys.some(k => !poseEq(poseOf(k), poseOf(tr.keys[0])) || (k.att && JSON.stringify(k.att) !== JSON.stringify(tr.keys[0].att)));
      const o = clone(base); POSE.forEach(p => { if (tr.keys[0][p] !== undefined) o[p] = tr.keys[0][p]; }); objects.push(o);
      if (moving || tr.vis) { if (!moving) tr.keys = [tr.keys[0]]; tracks[id] = tr; }
    });
    delete sc.anim; sc.objects = objects;
    sc.tl = { v: 1, duration: Math.max(LIM.minDur, Math.round(tl.total * 100) / 100), tracks, legacy };
    normalize(sc); sc.duration = sc.tl.duration; void ctx;
    return { ok: true, warn, keys: Object.keys(tracks).reduce((s, id) => s + tracks[id].keys.length, 0) };
  }
  /* put the original step show back (anything done on the master timeline since the conversion is dropped) */
  function toSteps(sc) {
    if (!enabled(sc) || !sc.tl.legacy || !sc.tl.legacy.anim) return { ok: false, why: 'This timeline was not made from a step show' };
    const l = sc.tl.legacy; sc.anim = clone(l.anim); sc.objects = clone(l.objects); sc.duration = l.duration; delete sc.tl; MA.normalize(sc); return { ok: true };
  }
  const allObjects = sc => (sc && sc.tl && sc.tl.legacy) ? (sc.tl.legacy.objects || []).concat(...((sc.tl.legacy.anim && sc.tl.legacy.anim.steps) || []).map(st => st.objects || [])) : [];
  const stats = sc => { if (!enabled(sc)) return { tracks: 0, keys: 0, bytes: 0 }; const t = Object.keys(sc.tl.tracks); return { tracks: t.length, keys: t.reduce((s, id) => s + sc.tl.tracks[id].keys.length, 0), bytes: JSON.stringify(sc.tl).length }; };

  const API = { EPS, LIM, EASES, POSE, enabled, enable, normalize, sanitize, setDuration, duration, objectsAt, resolvedPose, poseAt, trackOf, ensureTrack, setKey, getKey, moveKey, delKey, setEase, setPath, setHandles, setPathAll, setEaseAll, routeOf, segSpeed,
    beginEdit, flush, dirty, liveSync, syncBase, sortKeys, link, canLink, linkPlan, bake, fromSteps, toSteps, allObjects, stats, poseOf, morphShape, atFraction, segCtl, keyPos, objById };
  g.Timeline = API;
  if (g.Engine) {
    const base = g.Engine.objectsAt; g.Engine.tlObjectsAt = objectsAt;
    g.Engine.objectsAt = (sc, t) => enabled(sc) ? objectsAt(sc, t) : (base ? base(sc, t) : sc.objects);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
