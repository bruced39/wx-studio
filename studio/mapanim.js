/* WX Studio – map scene animation steps (v0.11.0).
 *
 * A scene can carry `scene.anim = { v:1, speed, steps:[...] }`. Step 1 is the scene's own `objects` array (so a scene without `anim`, or an old build that
 * ignores it, behaves exactly as before). Steps 2..n hold full snapshots of the weather graphics (same persistent object ids) plus timing:
 *   hold = seconds the step stays still, dur = seconds of the move INTO the step, ease = 'inout' | 'linear' | 'out'.
 * Everything here is a pure function of the stored data: `objectsAt(scene, t)` returns the objects to draw at scene time `t` (the saved objects are never
 * modified), so the editor, preview/scrub and the frame-by-frame MP4 export all show the same picture. Map-attached objects (`geo:true`) store [lng,lat],
 * so all blending happens in geographic coordinates and stays correct at any zoom / pan / camera move.
 *
 * Only plain data and arithmetic: no canvas, no DOM (unit-testable in Node). */
(function (g) {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clone = v => JSON.parse(JSON.stringify(v));
  const isNum = v => typeof v === 'number' && isFinite(v);
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const r3 = v => Math.round(v * 1000) / 1000;
  const ease = {
    linear: p => p,
    out: p => 1 - Math.pow(1 - p, 3),
    inout: p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
  };
  const EASES = [['inout', 'Smooth'], ['linear', 'Linear'], ['out', 'Ease out']];
  const LIMITS = { hold: [0, 120], dur: [0.2, 60], speed: [0.25, 4], maxSteps: 40, frontPts: 6 };
  const ANGLE_KEYS = { dir: 1, rot: 1, rotation: 1, angle: 1 };
  /* object keys that never take part in blending or cross-fades */
  const SKIP_KEYS = { id: 1, name: 1, anim: 1, move: 1, moveWith: 1, locked: 1, hidden: 1, _a: 1, _s: 1 };
  /* pts-objects drawn as smooth Catmull-Rom curves; `pen` is a raw polyline */
  const RAW = { pen: 1 };
  const FRONT_LIKE = { front: 1 };
  const nowId = () => 'k' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

  /* ---------------- model ---------------- */
  const isAnimated = sc => !!(sc && sc.anim && Array.isArray(sc.anim.steps) && sc.anim.steps.length > 0);
  const stepCount = sc => isAnimated(sc) ? sc.anim.steps.length : 1;
  const stepObjects = (sc, i) => {
    if (!isAnimated(sc) || i <= 0) return sc.objects;
    const st = sc.anim.steps[Math.min(i, sc.anim.steps.length - 1)]; return (st && st.objects) || sc.objects;
  };
  /* every object of every step (media scans: images / icons used by later steps must be saved and uploaded too) */
  const allObjects = sc => { const out = (sc && sc.objects || []).slice(); if (isAnimated(sc)) sc.anim.steps.forEach(st => { if (st.objects) st.objects.forEach(o => out.push(o)); }); return out; };
  const speedOf = sc => clamp(+(sc.anim && sc.anim.speed) || 1, LIMITS.speed[0], LIMITS.speed[1]);

  /* Make the animation block valid (also used on load, so hand-edited / future files cannot break playback). Returns the scene. */
  function normalize(sc) {
    if (!sc || !sc.anim) return sc;
    const a = sc.anim;
    if (!Array.isArray(a.steps) || !a.steps.length) { delete sc.anim; return sc; }
    a.v = 1; a.speed = clamp(+a.speed || 1, LIMITS.speed[0], LIMITS.speed[1]);
    const seen = {};
    a.steps.forEach((st, i) => {
      if (!st.id || seen[st.id]) st.id = nowId() + i; seen[st.id] = 1;
      st.name = String(st.name || ('Step ' + (i + 1)));
      st.hold = clamp(isNum(+st.hold) ? +st.hold : 2, LIMITS.hold[0], LIMITS.hold[1]);
      if (i === 0) { delete st.objects; }
      else {
        if (!Array.isArray(st.objects)) st.objects = clone(sc.objects || []);
        st.dur = clamp(isNum(+st.dur) && +st.dur > 0 ? +st.dur : 3, LIMITS.dur[0], LIMITS.dur[1]);
        if (!ease[st.ease]) st.ease = 'inout';
      }
    });
    syncDuration(sc); return sc;
  }

  /* time line: [{kind:'hold',step,t0,t1} | {kind:'move',from,to,t0,t1,ease}] in scene seconds (already divided by speed) */
  function timeline(sc) {
    if (!isAnimated(sc)) return { segs: [], total: sc ? sc.duration : 0, speed: 1 };
    const sp = speedOf(sc), segs = []; let t = 0;
    sc.anim.steps.forEach((st, i) => {
      if (i > 0) { const d = (+st.dur || 3) / sp; segs.push({ kind: 'move', from: i - 1, to: i, t0: t, t1: t + d, ease: st.ease || 'inout' }); t += d; }
      const hd = (+st.hold || 0) / sp; segs.push({ kind: 'hold', step: i, t0: t, t1: t + hd }); t += hd;
    });
    return { segs, total: t, speed: sp };
  }
  function totalDuration(sc) { return isAnimated(sc) ? Math.max(0.1, r3(timeline(sc).total)) : sc.duration; }
  function syncDuration(sc) { if (isAnimated(sc)) sc.duration = totalDuration(sc); return sc; }
  /* scene time at which step i has just arrived (its hold begins) / its hold ends */
  function stepTimes(sc, i) {
    const tl = timeline(sc), h = tl.segs.find(s => s.kind === 'hold' && s.step === i); return h ? { arrive: h.t0, leave: h.t1 } : { arrive: 0, leave: 0 };
  }
  /* which step is on screen at t (the one being held, or the one being moved toward when > 50 % there) */
  function stepAt(sc, t) {
    if (!isAnimated(sc)) return 0; const tl = timeline(sc);
    for (const s of tl.segs) if (t < s.t1 || s === tl.segs[tl.segs.length - 1]) return s.kind === 'hold' ? s.step : (t - s.t0 >= (s.t1 - s.t0) / 2 ? s.to : s.from);
    return 0;
  }

  /* ---------------- step operations (all keep persistent object ids) ---------------- */
  function enable(sc, o) {
    if (isAnimated(sc)) return sc; o = o || {};
    sc.anim = { v: 1, speed: 1, steps: [{ id: nowId(), name: 'Step 1', hold: clamp(o.hold != null ? o.hold : Math.min(sc.duration || 3, 3), LIMITS.hold[0], LIMITS.hold[1]) }] };
    return normalize(sc);
  }
  /* Few clickable control points: Visvalingam–Whyatt (drop the point whose removal changes the shape least) keeps the overall curve */
  function simplifyPts(pts, maxPts) {
    if (!Array.isArray(pts) || pts.length <= maxPts || maxPts < 2) return pts;
    const P = pts.map(p => [p[0], p[1]]);
    const area = (a, b, c) => Math.abs((a[0] - c[0]) * (b[1] - a[1]) - (a[0] - b[0]) * (c[1] - a[1])) / 2;
    while (P.length > maxPts) {
      let bi = -1, ba = Infinity;
      for (let i = 1; i < P.length - 1; i++) { const ar = area(P[i - 1], P[i], P[i + 1]); if (ar < ba) { ba = ar; bi = i; } }
      if (bi < 0) break; P.splice(bi, 1);
    }
    return P;
  }
  function simplifyFronts(objs, maxPts) { (objs || []).forEach(o => { if (o && FRONT_LIKE[o.type] && Array.isArray(o.pts) && o.pts.length > maxPts) o.pts = simplifyPts(o.pts, maxPts); }); return objs; }

  function addStep(sc, after, o) {
    o = o || {}; enable(sc); const a = sc.anim; if (a.steps.length >= LIMITS.maxSteps) return null;
    const at = clamp(after == null ? a.steps.length - 1 : after, 0, a.steps.length - 1);
    const st = { id: nowId(), name: 'Step ' + (a.steps.length + 1), hold: o.hold != null ? o.hold : 2, dur: o.dur != null ? o.dur : 3, ease: o.ease || 'inout', objects: clone(stepObjects(sc, at)) };
    if (o.simplify !== false) simplifyFronts(st.objects, LIMITS.frontPts);
    a.steps.splice(at + 1, 0, st); normalize(sc); return at + 1;
  }
  function dupStep(sc, i) {
    if (!isAnimated(sc)) return null; const a = sc.anim; if (a.steps.length >= LIMITS.maxSteps) return null;
    const src = a.steps[i], st = { id: nowId(), name: src.name + ' copy', hold: src.hold, dur: src.dur || 3, ease: src.ease || 'inout', objects: clone(stepObjects(sc, i)) };
    a.steps.splice(i + 1, 0, st); normalize(sc); return i + 1;
  }
  function delStep(sc, i) {
    if (!isAnimated(sc)) return null; const a = sc.anim; if (a.steps.length <= 1) return null;
    if (i === 0) { const nx = a.steps[1]; sc.objects = nx.objects; a.steps.shift(); delete a.steps[0].objects; }
    else a.steps.splice(i, 1);
    normalize(sc); return clamp(i, 0, a.steps.length - 1);
  }
  /* reorder: step 1 lives in scene.objects, so rebuild the list as full snapshots and write it back */
  function moveStep(sc, i, to) {
    if (!isAnimated(sc)) return null; const a = sc.anim, n = a.steps.length; to = clamp(to, 0, n - 1); if (i === to || i < 0 || i >= n) return i;
    const all = a.steps.map((st, k) => Object.assign({}, st, { objects: k === 0 ? sc.objects : st.objects }));
    const [m] = all.splice(i, 1); all.splice(to, 0, m);
    sc.objects = all[0].objects; a.steps = all.map((st, k) => { const c = Object.assign({}, st); if (k === 0) delete c.objects; return c; });
    normalize(sc); return to;
  }
  function setStep(sc, i, props) {
    if (!isAnimated(sc)) return; const st = sc.anim.steps[i]; if (!st) return;
    ['name', 'hold', 'dur', 'ease'].forEach(k => { if (props[k] != null) st[k] = props[k]; }); normalize(sc);
  }
  function setSpeed(sc, v) { if (!isAnimated(sc)) return; sc.anim.speed = v; normalize(sc); }
  /* drop the animation, keeping step `keep` as the scene's graphics */
  function flatten(sc, keep) {
    if (!isAnimated(sc)) return sc; const objs = stepObjects(sc, keep || 0), tot = sc.duration;
    sc.objects = objs; delete sc.anim; sc.duration = Math.max(1, tot || 5); return sc;
  }
  function fewerPoints(o, maxPts) { if (o && Array.isArray(o.pts) && o.pts.length > 2) o.pts = simplifyPts(o.pts, Math.max(2, maxPts || Math.max(2, o.pts.length - 1))); return o; }
  /* approximate JSON size of the animation block, for the size warning */
  function sizeBytes(sc) { try { return isAnimated(sc) ? JSON.stringify(sc.anim).length : 0; } catch (e) { return 0; } }

  /* ---------------- geometry ---------------- */
  function catmull(pts, closed, seg) {
    const n = pts.length; if (n < 3 && !closed) return pts.map(p => [p[0], p[1]]); if (n < 2) return pts.map(p => [p[0], p[1]]);
    const P = i => closed ? pts[(i % n + n) % n] : pts[clamp(i, 0, n - 1)], last = closed ? n : n - 1, out = [];
    for (let i = 0; i < last; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let k = 0; k < seg; k++) {
        const u = k / seg, u2 = u * u, u3 = u2 * u, f = j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u3);
        out.push([f(0), f(1)]);
      }
    }
    out.push(closed ? [out[0][0], out[0][1]] : [pts[n - 1][0], pts[n - 1][1]]); return out;
  }
  /* N points spaced evenly by length along the drawn curve (so a longer / shorter front grows or shrinks smoothly) */
  function resample(pts, N, o) {
    const closed = !!(o && o.closed), dense = RAW[o && o.type] ? pts.slice() : catmull(pts, closed, 12);
    const cum = [0]; for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const L = cum[cum.length - 1]; if (!(L > 0)) return Array.from({ length: N }, () => [pts[0][0], pts[0][1]]);
    const out = []; let j = 1;
    for (let k = 0; k < N; k++) {
      const d = (closed ? k / N : k / (N - 1)) * L; while (j < cum.length - 1 && cum[j] < d) j++;
      const seg = cum[j] - cum[j - 1] || 1, f = clamp((d - cum[j - 1]) / seg, 0, 1);
      out.push([dense[j - 1][0] + (dense[j][0] - dense[j - 1][0]) * f, dense[j - 1][1] + (dense[j][1] - dense[j - 1][1]) * f]);
    }
    if (!closed) { out[0] = [dense[0][0], dense[0][1]]; out[N - 1] = [dense[dense.length - 1][0], dense[dense.length - 1][1]]; }
    return out;
  }
  const centroid = o => {
    if (Array.isArray(o.pts) && o.pts.length) { let x = 0, y = 0; o.pts.forEach(p => { x += p[0]; y += p[1]; }); return [x / o.pts.length, y / o.pts.length]; }
    return isNum(o.x) && isNum(o.y) ? [o.x, o.y] : null;
  };

  /* ---------------- colour / value blending ---------------- */
  function parseColor(s) {
    if (typeof s !== 'string') return null; s = s.trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s); if (m) return [...m[1]].map(c => parseInt(c + c, 16)).concat(1);
    m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s); if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), m[2] ? parseInt(m[2], 16) / 255 : 1];
    m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(s);
    if (m) { let a = m[4] == null ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]); return [+m[1], +m[2], +m[3], a]; }
    return null;
  }
  function lerpColor(a, b, u) {
    const A = parseColor(a), B = parseColor(b); if (!A || !B) return null;
    const c = A.map((v, i) => v + (B[i] - v) * u);
    return c[3] >= 0.999 ? 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')' : 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + r3(c[3]) + ')';
  }
  function lerpAngle(a, b, u) { let d = ((b - a) % 360 + 540) % 360 - 180; return a + d * u; }

  /* Blend two values. `st.discrete` is set when something visible cannot be blended (text, icon, kind, font…) so the caller cross-fades. */
  function blend(a, b, u, key, st) {
    if (a === b) return a;
    if (isNum(a) && isNum(b)) return ANGLE_KEYS[key] ? lerpAngle(a, b, u) : a + (b - a) * u;
    if (typeof a === 'string' && typeof b === 'string') { const c = lerpColor(a, b, u); if (c) return c; st.discrete = true; return u < 0.5 ? a : b; }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length === b.length) return a.map((v, i) => blend(v, b[i], u, key, st));
      st.discrete = true; return u < 0.5 ? a : b;
    }
    if (isObj(a) && isObj(b)) {
      const out = {}; Object.keys(a).concat(Object.keys(b)).forEach(k => { if (k in out) return; if (!(k in b)) out[k] = a[k]; else if (!(k in a)) out[k] = b[k]; else out[k] = blend(a[k], b[k], u, k, st); }); return out;
    }
    st.discrete = true; return u < 0.5 ? a : b;
  }

  /* blend two versions of the same object; returns { o, discrete, a: look-A-object, b: look-B-object } */
  function blendObject(A, B, u, N) {
    const st = { discrete: false }, out = {}, discreteKeys = [];
    const keys = Object.keys(A).concat(Object.keys(B).filter(k => !(k in A)));
    keys.forEach(k => {
      if (SKIP_KEYS[k]) return;
      if (k === 'pts' && Array.isArray(A.pts) && Array.isArray(B.pts)) {
        if (A.pts.length === B.pts.length) out.pts = A.pts.map((p, i) => [p[0] + (B.pts[i][0] - p[0]) * u, p[1] + (B.pts[i][1] - p[1]) * u]);
        else if (A.pts.length >= 2 && B.pts.length >= 2) {
          const n = N || clamp(Math.max(A.pts.length, B.pts.length) * 2, 8, 48), ra = resample(A.pts, n, A), rb = resample(B.pts, n, B);
          out.pts = ra.map((p, i) => [p[0] + (rb[i][0] - p[0]) * u, p[1] + (rb[i][1] - p[1]) * u]);
        } else { out.pts = u < 0.5 ? A.pts : B.pts; st.discrete = true; }
        return;
      }
      if (!(k in B)) { out[k] = A[k]; return; } if (!(k in A)) { out[k] = B[k]; return; }
      const before = st.discrete; st.discrete = false; out[k] = blend(A[k], B[k], u, k, st); if (st.discrete) discreteKeys.push(k); st.discrete = before || st.discrete;
    });
    ['id', 'anim', 'move', 'moveWith', 'locked', 'hidden', 'name'].forEach(k => { if (k in B) out[k] = B[k]; else if (k in A) out[k] = A[k]; });
    return { o: out, discrete: st.discrete, discreteKeys };
  }
  /* the two looks of a cross-fade share every blended (continuous) field; only the non-blendable ones differ */
  function lookOf(blended, src, discreteKeys) { const o = Object.assign({}, blended); discreteKeys.forEach(k => { if (k in src) o[k] = src[k]; else delete o[k]; }); return o; }

  /* ---------------- objects at a given time ---------------- */
  const fade = (u, a, b) => clamp((u - a) / (b - a), 0, 1), smooth = x => x * x * (3 - 2 * x);
  /* A -> B at progress u (0..1, already eased). `prev` = the objects of the step before A (used to know which way a leaving object was already moving). */
  function interpolate(A, B, u, prev) {
    const vis = arr => (arr || []).filter(o => o && !o.hidden), a = vis(A), b = vis(B), pv = {};
    vis(prev).forEach(o => { pv[o.id] = o; });
    const mapB = {}; b.forEach(o => { mapB[o.id] = o; }); const inA = {}; a.forEach(o => { inA[o.id] = o; });
    const out = [];
    b.forEach(ob => {
      const oa = inA[ob.id];
      if (!oa) { // appearing: fades in and settles from slightly smaller
        const e = smooth(fade(u, 0.15, 0.85)), o = Object.assign({}, ob, { _a: e, _s: 0.92 + 0.08 * e }); out.push(o); return;
      }
      if (oa.type !== ob.type || !!oa.geo !== !!ob.geo) { // different kind of thing: cross-fade whole objects
        const w = smooth(fade(u, 0.2, 0.8)); out.push(Object.assign({}, oa, { _a: 1 - w })); out.push(Object.assign({}, ob, { _a: w })); return;
      }
      const r = blendObject(oa, ob, u);
      if (!r.discrete) { out.push(r.o); return; }
      const w = smooth(fade(u, 0.2, 0.8)), la = lookOf(r.o, oa, r.discreteKeys), lb = lookOf(r.o, ob, r.discreteKeys);
      la._a = 1 - w; lb._a = w; out.push(la); out.push(lb);
    });
    /* leaving: keep going the way it was already moving while fading out; gone before the move ends */
    const leavers = a.filter(o => !mapB[o.id]);
    leavers.forEach(oa => {
      const e = fade(u, 0, 0.8), al = 1 - smooth(e), o = Object.assign({}, oa, { _a: al, _s: 1 - 0.06 * e });
      const p0 = pv[oa.id], c1 = centroid(oa), c0 = p0 && centroid(p0);
      if (c0 && c1) {
        const dx = c1[0] - c0[0], dy = c1[1] - c0[1], f = 0.5 * ease.out(u);
        if (isNum(dx) && isNum(dy) && (dx || dy)) { if (Array.isArray(o.pts)) o.pts = o.pts.map(p => [p[0] + dx * f, p[1] + dy * f]); if (isNum(o.x) && isNum(o.y)) { o.x += dx * f; o.y += dy * f; } }
      }
      /* keep it in its original place in the stacking order: put it right after the object that was below it */
      const idx = a.indexOf(oa); let at = 0; for (let k = idx - 1; k >= 0; k--) { const j = out.findIndex(q => q.id === a[k].id); if (j >= 0) { at = j + 1; break; } }
      out.splice(at, 0, o);
    });
    return out;
  }

  /* The objects to draw at scene time t. Hold -> the step's own array (not copied, never modified); move -> fresh interpolated copies. */
  function objectsAt(sc, t) {
    if (!isAnimated(sc)) return sc.objects;
    const tl = timeline(sc), segs = tl.segs; if (!segs.length) return sc.objects;
    let s = segs[segs.length - 1]; for (const q of segs) if (t < q.t1) { s = q; break; }
    if (s.kind === 'hold') return stepObjects(sc, s.step);
    const span = s.t1 - s.t0, p = span > 0 ? clamp((t - s.t0) / span, 0, 1) : 1, u = (ease[s.ease] || ease.inout)(p);
    if (u <= 0) return stepObjects(sc, s.from); if (u >= 1) return stepObjects(sc, s.to);
    return interpolate(stepObjects(sc, s.from), stepObjects(sc, s.to), u, s.from > 0 ? stepObjects(sc, s.from - 1) : null);
  }

  const API = { LIMITS, EASES, isAnimated, stepCount, stepObjects, allObjects, normalize, timeline, totalDuration, syncDuration, stepTimes, stepAt, enable, addStep, dupStep, delStep, moveStep, setStep, setSpeed, flatten, simplifyPts, simplifyFronts, fewerPoints, sizeBytes, resample, catmull, centroid, interpolate, objectsAt, blendObject };
  g.MapAnim = API;
  if (g.Engine) { g.Engine.objectsAt = objectsAt; g.Engine.animTimeline = timeline; }
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
