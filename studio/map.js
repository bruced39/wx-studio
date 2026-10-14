/* WX Studio – bundled-projection US map.
 * State outlines come from the public-domain us-atlas "states-albers-10m" TopoJSON, fetched in the browser
 * (jsDelivr, then unpkg as backup). Coordinates are already Albers-USA projected (975 x 610 units).
 * Everything the studio draws (radar, satellite, model fields, H/L, fronts) shares this projection.     */
(function (g) {
  'use strict';
  const RAD = Math.PI / 180;
  const urls = ['https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json', 'https://unpkg.com/us-atlas@3/states-albers-10m.json'];

  /* d3.geoAlbersUsa lower-48 parameters used by us-atlas: scale 1300, translate [487.5, 305] */
  const P0 = 29.5 * RAD, P1 = 45.5 * RAD, N = (Math.sin(P0) + Math.sin(P1)) / 2, CC = 1 + Math.sin(P0) * (2 * N - Math.sin(P0)), R0 = Math.sqrt(CC) / N;
  const raw = (lam, phi) => { const r = Math.sqrt(CC - 2 * N * Math.sin(phi)) / N; return [r * Math.sin(lam * N), R0 - r * Math.cos(lam * N)]; };
  const CEN = raw(-0.6 * RAD, 38.7 * RAD), K = 1300, TX = 487.5, TY = 305;
  function project(lon, lat) { const q = raw((lon + 96) * RAD, lat * RAD); return [TX + K * (q[0] - CEN[0]), TY - K * (q[1] - CEN[1])]; }

  /* regions as lon/lat boxes [w, e, s, n] so views work even before the map data loads */
  const REGIONS = {
    conus: ['Continental US', [-125.5, -66.0, 23.8, 49.8], { cx: 490, cy: 308, w: 1030 }],
    northeast: ['Northeast', [-82.0, -66.5, 37.5, 47.8]],
    newengland: ['New England', [-74.2, -66.6, 40.8, 47.6]],
    eastma: ['Eastern Massachusetts', [-72.2, -69.9, 41.45, 43.15]],
    boston: ['Boston / Billerica', [-71.75, -70.55, 42.05, 42.75]],
    midatlantic: ['Mid-Atlantic', [-80.8, -73.2, 36.4, 42.0]],
    southeast: ['Southeast', [-92.5, -75.0, 24.5, 37.6]],
    florida: ['Florida', [-88.0, -79.3, 24.3, 31.5]],
    gulf: ['Gulf Coast', [-98.5, -79.5, 24.5, 33.6]],
    texas: ['Texas / S. Plains', [-107.0, -92.5, 25.5, 37.0]],
    midwest: ['Midwest', [-98.5, -80.0, 36.0, 49.6]],
    greatlakes: ['Great Lakes', [-93.0, -74.0, 40.5, 49.2]],
    plains: ['Northern Plains', [-106.5, -90.0, 28.0, 49.6]],
    west: ['West', [-125.5, -102.0, 31.0, 49.6]]
  };
  function regionView(key, pad) {
    const r = REGIONS[key] || REGIONS.conus, b = r[1]; if (r[2]) return Object.assign({}, r[2]); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const pt = (lo, la) => { const p = project(lo, la); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); };
    for (let i = 0; i <= 24; i++) { const u = i / 24, lo = b[0] + (b[1] - b[0]) * u, la = b[2] + (b[3] - b[2]) * u; pt(lo, b[2]); pt(lo, b[3]); pt(b[0], la); pt(b[1], la); }
    const p = pad == null ? 0.05 : pad, bw = (x1 - x0) * (1 + p * 2), bh = (y1 - y0) * (1 + p * 2), w = Math.max(bw, bh * 16 / 9);
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w };
  }

  /* [name, lon, lat, rank]  rank 0 = home towns (regional views only) */
  const CITIES = [
    ['Billerica', -71.27, 42.56, 0], ['Lowell', -71.32, 42.63, 3], ['Lawrence', -71.17, 42.71, 3], ['Quincy', -71.0, 42.25, 3], ['Plymouth', -70.67, 41.96, 3], ['Hyannis', -70.28, 41.65, 3], ['Nantucket', -70.1, 41.28, 3],
    ['Gloucester', -70.66, 42.61, 3], ['Brockton', -71.02, 42.08, 3], ['Framingham', -71.42, 42.28, 3], ['Nashua', -71.47, 42.77, 3], ['Concord', -71.54, 43.21, 3], ['Portsmouth', -70.76, 43.07, 3], ['Fitchburg', -71.8, 42.58, 3],
    ['New Bedford', -70.93, 41.64, 3], ['Pittsfield', -73.25, 42.45, 3], ['Bangor', -68.77, 44.8, 3], ['Augusta', -69.78, 44.31, 3], ['New Haven', -72.93, 41.31, 3], ['Montpelier', -72.58, 44.26, 3], ['Keene', -72.28, 42.93, 3], ['Lewiston', -70.21, 44.1, 3],
    ['Boston', -71.06, 42.36, 1], ['New York', -74.0, 40.71, 1], ['Chicago', -87.63, 41.88, 1], ['Dallas', -96.8, 32.78, 1], ['Houston', -95.37, 29.76, 1], ['Los Angeles', -118.24, 34.05, 1], ['Seattle', -122.33, 47.61, 1], ['Denver', -104.99, 39.74, 1],
    ['Atlanta', -84.39, 33.75, 1], ['Miami', -80.19, 25.76, 1], ['Minneapolis', -93.27, 44.98, 1], ['Washington', -77.04, 38.91, 1], ['Phoenix', -112.07, 33.45, 1], ['San Francisco', -122.42, 37.77, 1], ['Detroit', -83.05, 42.33, 1], ['Philadelphia', -75.17, 39.95, 1],
    ['Kansas City', -94.58, 39.1, 1], ['New Orleans', -90.07, 29.95, 1], ['Salt Lake City', -111.89, 40.76, 1], ['Charlotte', -80.84, 35.23, 1],
    ['Portland', -70.26, 43.66, 2], ['Burlington', -73.21, 44.48, 2], ['Albany', -73.76, 42.65, 2], ['Hartford', -72.68, 41.76, 2], ['Providence', -71.41, 41.82, 2], ['Worcester', -71.8, 42.26, 2], ['Manchester', -71.46, 42.99, 2], ['Springfield', -72.59, 42.1, 2],
    ['Buffalo', -78.88, 42.89, 2], ['Pittsburgh', -79.99, 40.44, 2], ['Baltimore', -76.61, 39.29, 2], ['Richmond', -77.44, 37.54, 2], ['Norfolk', -76.29, 36.85, 2], ['Raleigh', -78.64, 35.78, 2], ['Charleston', -79.93, 32.78, 2], ['Jacksonville', -81.66, 30.33, 2],
    ['Orlando', -81.38, 28.54, 2], ['Tampa', -82.46, 27.95, 2], ['Key West', -81.78, 24.56, 2], ['Tallahassee', -84.28, 30.44, 2], ['Mobile', -88.04, 30.69, 2], ['Birmingham', -86.8, 33.52, 2], ['Nashville', -86.78, 36.16, 2], ['Memphis', -90.05, 35.15, 2],
    ['St. Louis', -90.2, 38.63, 2], ['Louisville', -85.76, 38.25, 2], ['Cincinnati', -84.51, 39.1, 2], ['Cleveland', -81.69, 41.5, 2], ['Columbus', -83.0, 39.96, 2], ['Indianapolis', -86.16, 39.77, 2], ['Milwaukee', -87.91, 43.04, 2], ['Des Moines', -93.62, 41.59, 2],
    ['Omaha', -95.93, 41.26, 2], ['Oklahoma City', -97.52, 35.47, 2], ['San Antonio', -98.49, 29.42, 2], ['Austin', -97.74, 30.27, 2], ['Albuquerque', -106.65, 35.08, 2], ['Las Vegas', -115.14, 36.17, 2], ['Portland OR', -122.68, 45.52, 2],
    ['Boise', -116.2, 43.62, 2], ['Billings', -108.5, 45.78, 2], ['Fargo', -96.79, 46.88, 2], ['Little Rock', -92.29, 34.75, 2], ['Wichita', -97.34, 37.69, 2]
  ].map(c => ({ name: c[0].replace(' OR', ''), lon: c[1], lat: c[2], rank: c[3], xy: project(c[1], c[2]) }));

  const THEMES = {
    dark:  { bg0: '#0b1a2e', bg1: '#112a46', land: '#1f3a58', line: '#5b82a8', coast: '#86aed6', text: '#e8f1fb', halo: 'rgba(5,14,26,0.85)' },
    radar: { bg0: '#14181d', bg1: '#1c2229', land: '#2a3038', line: '#737f8c', coast: '#a3adb8', text: '#f0f4f8', halo: 'rgba(5,8,12,0.9)' },
    light: { bg0: '#bcd8ee', bg1: '#d7e9f6', land: '#f3efe6', line: '#a8b4c0', coast: '#7e8d9c', text: '#17263a', halo: 'rgba(255,255,255,0.85)' },
    slate: { bg0: '#1b2430', bg1: '#27323f', land: '#3a4756', line: '#77889b', coast: '#a9b9ca', text: '#eef3f8', halo: 'rgba(8,12,18,0.85)' }
  };

  /* ---------- TopoJSON decoding (quantised + delta arcs, shared/reversed arcs) ---------- */
  function decode(topo, objName) {
    const tf = topo.transform;
    const arcs = topo.arcs.map(a => {
      let x = 0, y = 0;
      return a.map(p => { if (tf) { x += p[0]; y += p[1]; return [x * tf.scale[0] + tf.translate[0], y * tf.scale[1] + tf.translate[1]]; } return [p[0], p[1]]; });
    });
    const arcPts = i => i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
    const ring = idx => { let pts = []; idx.forEach((i, k) => { const a = arcPts(i); pts = pts.concat(k ? a.slice(1) : a); }); return pts; };
    const obj = topo.objects[objName || 'states'] || topo.objects[Object.keys(topo.objects)[0]];
    const feats = obj.geometries.map(gm => {
      const polys = gm.type === 'Polygon' ? [gm.arcs.map(ring)] : gm.type === 'MultiPolygon' ? gm.arcs.map(p => p.map(ring)) : [];
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      polys.forEach(p => p.forEach(r => r.forEach(q => { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); })));
      return { id: gm.id, name: gm.properties && gm.properties.name, polys, bbox: [x0, y0, x1, y1] };
    });
    return feats;
  }
  const SKIP = f => f.id === '02' || f.id === '15' || f.id === '72' || /alaska|hawaii|puerto|guam|virgin|samoa|mariana/i.test(f.name || '');
  function ringPath(path, r) { r.forEach((q, i) => i ? path.lineTo(q[0], q[1]) : path.moveTo(q[0], q[1])); path.closePath(); }
  /* one Path2D per polygon (outer ring + holes) so sliver overlaps between neighbours can never cancel out */
  function buildPaths(feats) {
    const polys = [], all = new Path2D();
    feats.forEach(f => { if (SKIP(f)) return; f.polys.forEach(p => { const pp = new Path2D(); p.forEach(r => { ringPath(pp, r); ringPath(all, r); }); polys.push(pp); }); });
    return { polys, all };
  }

  const WDMap = {
    status: 'idle', feats: null, land: null, projOK: null, error: '', REGIONS, THEMES, CITIES, project, regionView,
    regionList: Object.keys(REGIONS).map(k => [k, REGIONS[k][0]]),
    ingest(topo) {
      this.feats = decode(topo, 'states'); const bp = buildPaths(this.feats); this.land = bp.all; this.polys = bp.polys;
      const ma = this.feats.find(f => f.name === 'Massachusetts' || f.id === '25'), b = project(-71.06, 42.36);
      this.projOK = ma ? (b[0] >= ma.bbox[0] && b[0] <= ma.bbox[2] && b[1] >= ma.bbox[1] && b[1] <= ma.bbox[3]) : null;
      if (this.projOK === false) console.warn('[map] projection self-check failed: Boston is outside the Massachusetts bounding box');
      this.status = 'ready';
    },
    async load(extraUrl) {
      if (this.status === 'ready' || this.status === 'loading') return;
      this.status = 'loading';
      for (const u of (extraUrl ? [extraUrl] : urls)) {
        try { const r = await fetch(u, { mode: 'cors' }); if (!r.ok) throw new Error('HTTP ' + r.status); this.ingest(await r.json()); return; }
        catch (e) { this.error = String(e && e.message || e); }
      }
      this.status = 'error';
    },
    countyStatus: 'idle', counties: null,
    async loadCounties(url) {
      if (this.countyStatus !== 'idle') return; this.countyStatus = 'loading';
      for (const u of (url ? [url] : ['https://cdn.jsdelivr.net/npm/us-atlas@3/counties-albers-10m.json', 'https://unpkg.com/us-atlas@3/counties-albers-10m.json'])) {
        try { const r = await fetch(u, { mode: 'cors' }); if (!r.ok) throw new Error('HTTP ' + r.status); const topo = await r.json(), fe = decode(topo, 'counties'), p = new Path2D();
          fe.forEach(f => { if (/^(02|15|72|78|60|66|69)/.test(String(f.id))) return; f.polys.forEach(po => po.forEach(rg => ringPath(p, rg))); }); this.counties = p; this.countyStatus = 'ready'; return; }
        catch (e) { /* try next */ }
      }
      this.countyStatus = 'error';
    },
    /* draw the base map into a W x H canvas context. view = {cx, cy, w} in projection units */
    draw(c, view, theme, opts) {
      opts = opts || {}; const W = opts.W || 1920, H = opts.H || 1080, th = THEMES[theme] || THEMES.dark;
      const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, th.bg0); gr.addColorStop(1, th.bg1); c.fillStyle = gr; c.fillRect(0, 0, W, H);
      const k = W / view.w;
      if (this.land) {
        c.save(); c.translate(W / 2, H / 2); c.scale(k, k); c.translate(-view.cx, -view.cy);
        c.fillStyle = th.land; this.polys.forEach(p => c.fill(p, 'evenodd'));
        c.lineJoin = 'round';
        if (opts.counties !== false && view.w < 700) {
          if (this.countyStatus === 'idle') this.loadCounties();
          if (this.counties) { c.globalAlpha = 0.45; c.strokeStyle = th.line; c.lineWidth = 1 / k; c.stroke(this.counties); c.globalAlpha = 1; }
        }
        c.strokeStyle = th.line; c.lineWidth = 2 / k; c.stroke(this.land);
        c.restore();
      }
      if (opts.cities !== false && this.projOK !== false) this.drawCities(c, view, th, W, H, k);
    },
    drawCities(c, view, th, W, H, k) {
      const maxRank = view.w > 650 ? 1 : view.w > 300 ? 2 : 3, placed = [];
      const list = CITIES.filter(ci => ci.rank === 0 ? view.w < 420 : ci.rank <= maxRank).sort((a, b) => (a.rank || 0) - (b.rank || 0));
      c.save(); c.textBaseline = 'middle'; c.lineJoin = 'round';
      list.forEach(ci => {
        const x = W / 2 + (ci.xy[0] - view.cx) * k, y = H / 2 + (ci.xy[1] - view.cy) * k; if (x < 20 || x > W - 20 || y < 20 || y > H - 20) return;
        const fs = ci.rank <= 1 ? 27 : ci.rank === 2 ? 23 : 21; c.font = `600 ${fs}px ${(g.Sym && g.Sym.FONT) || 'sans-serif'}`;
        const w = c.measureText(ci.name).width + 16, box = [x + 8, y - fs * 0.6, x + 8 + w, y + fs * 0.6];
        if (placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return; placed.push(box);
        c.fillStyle = ci.rank === 0 ? '#ffd23f' : th.text; c.beginPath(); c.arc(x, y, ci.rank === 0 ? 6.5 : 4.5, 0, 6.2832); c.fill();
        c.lineWidth = 5; c.strokeStyle = th.halo; c.strokeText(ci.name, x + 14, y + 1); c.fillText(ci.name, x + 14, y + 1);
      });
      c.restore();
    }
  };
  g.WDMap = WDMap;
})(typeof window !== 'undefined' ? window : globalThis);
