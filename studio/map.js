/* WX Studio – bundled-projection US map.
 * State outlines come from the public-domain us-atlas "states-albers-10m" TopoJSON, fetched in the browser
 * (jsDelivr, then unpkg as backup). Coordinates are already Albers-USA projected (975 x 610 units).
 * Everything the studio draws (radar, satellite, model fields, H/L, fronts) shares this projection.     */
(function (g) {
  'use strict';
  const RAD = Math.PI / 180, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
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

  const BIG = { 'New York': 8.3e6, 'Los Angeles': 3.9e6, 'Chicago': 2.7e6, 'Houston': 2.3e6 };
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
  ].map(c => ({ name: c[0].replace(' OR', ''), lon: c[1], lat: c[2], rank: c[3], pop: c[3] === 0 ? 1e12 : c[3] === 1 ? (BIG[c[0]] || 9e5) : c[3] === 2 ? 4e5 : 3e4, xy: project(c[1], c[2]) }));
  /* more towns (name, lat, lon, population in thousands) – New England + nearby; the rest of the US comes from a runtime list */
  const TOWNS = `Burlington,42.50,-71.20,26
Bedford,42.49,-71.28,14
Chelmsford,42.60,-71.37,36
Tewksbury,42.61,-71.23,31
Wilmington,42.55,-71.17,23
Woburn,42.48,-71.15,40
Reading,42.53,-71.10,25
Andover,42.66,-71.14,36
North Andover,42.70,-71.13,30
Haverhill,42.78,-71.08,67
Methuen,42.73,-71.19,53
Lexington,42.45,-71.23,34
Concord MA,42.46,-71.35,19
Acton,42.49,-71.43,24
Westford,42.58,-71.44,24
Carlisle,42.53,-71.35,5
Dracut,42.67,-71.30,32
Tyngsborough,42.68,-71.42,12
Lynn,42.47,-70.95,101
Salem,42.52,-70.90,44
Peabody,42.53,-70.93,54
Beverly,42.56,-70.88,42
Newburyport,42.81,-70.88,18
Ipswich,42.68,-70.84,14
Marblehead,42.50,-70.86,20
Revere,42.41,-71.01,62
Malden,42.43,-71.07,66
Medford,42.42,-71.11,59
Somerville,42.39,-71.10,81
Cambridge,42.37,-71.11,118
Newton,42.34,-71.21,88
Waltham,42.38,-71.24,65
Watertown,42.37,-71.18,35
Brookline,42.33,-71.12,60
Needham,42.28,-71.24,31
Wellesley,42.30,-71.29,29
Natick,42.28,-71.35,37
Weymouth,42.22,-70.94,57
Braintree,42.21,-71.00,39
Dedham,42.24,-71.17,25
Norwood,42.19,-71.20,31
Canton,42.16,-71.14,24
Randolph,42.16,-71.04,34
Milton,42.25,-71.07,28
Hingham,42.24,-70.89,23
Marshfield,42.09,-70.71,26
Taunton,41.90,-71.09,59
Attleboro,41.94,-71.28,46
Franklin,42.08,-71.40,33
Milford,42.14,-71.52,30
Marlborough,42.35,-71.55,41
Hudson,42.39,-71.57,20
Sudbury,42.38,-71.42,19
Wayland,42.36,-71.36,14
Maynard,42.43,-71.45,11
Littleton,42.54,-71.49,10
Leominster,42.52,-71.76,43
Gardner,42.58,-72.00,21
Clinton,42.42,-71.68,14
Shrewsbury,42.30,-71.71,38
Westborough,42.27,-71.62,20
Northborough,42.32,-71.64,15
Grafton,42.21,-71.69,19
Holyoke,42.20,-72.62,38
Chicopee,42.15,-72.61,55
Westfield,42.12,-72.75,41
Northampton,42.33,-72.64,29
Amherst,42.38,-72.52,40
Greenfield,42.59,-72.60,17
Fall River,41.70,-71.16,94
Provincetown,42.05,-70.19,3
Falmouth,41.55,-70.61,32
Orleans,41.79,-69.99,6
Chatham,41.68,-69.96,6
Vineyard Haven,41.45,-70.60,4
Edgartown,41.39,-70.51,4
Salem NH,42.79,-71.20,30
Derry,42.88,-71.33,34
Londonderry,42.87,-71.37,26
Merrimack,42.87,-71.49,27
Hudson NH,42.77,-71.44,25
Dover,43.20,-70.87,33
Rochester NH,43.30,-70.98,32
Laconia,43.53,-71.47,16
Lebanon,43.64,-72.25,14
Hampton,42.94,-70.84,16
Exeter,42.98,-70.95,16
Littleton NH,44.31,-71.77,6
North Conway,44.05,-71.13,2
Berlin,44.47,-71.18,9
Claremont,43.38,-72.35,13
Plymouth NH,43.76,-71.69,6
Franklin NH,43.44,-71.65,8
Peterborough,42.87,-71.95,6
Colebrook,44.89,-71.50,2
Warwick,41.70,-71.42,82
Cranston,41.78,-71.44,82
Pawtucket,41.88,-71.38,75
Newport,41.49,-71.31,25
Westerly,41.38,-71.83,23
Woonsocket,42.00,-71.51,43
Narragansett,41.45,-71.45,15
Stamford,41.05,-73.54,136
Waterbury,41.56,-73.04,114
Norwalk,41.12,-73.41,91
Danbury,41.39,-73.45,86
New London,41.36,-72.10,27
Norwich,41.52,-72.08,40
Meriden,41.54,-72.81,60
New Britain,41.66,-72.78,74
Middletown,41.56,-72.65,47
Torrington,41.80,-73.12,35
Willimantic,41.71,-72.21,17
Mystic,41.35,-71.97,4
Biddeford,43.49,-70.45,22
Brunswick,43.91,-69.96,21
Bath,43.91,-69.82,9
Rockland,44.10,-69.11,7
Bar Harbor,44.39,-68.20,5
Ellsworth,44.54,-68.42,8
Kennebunk,43.38,-70.54,11
Waterville,44.55,-69.63,16
Presque Isle,46.68,-68.02,9
Millinocket,45.66,-68.71,4
Houlton,46.13,-67.84,6
Camden,44.21,-69.06,5
Rumford,44.55,-70.55,6
Skowhegan,44.77,-69.72,8
Farmington,44.67,-70.15,7
Machias,44.72,-67.46,2
Calais,45.19,-67.28,3
Caribou,46.86,-68.01,8
Fort Kent,47.25,-68.59,4
Greenville,45.46,-69.59,2
Rutland,43.61,-72.97,15
Brattleboro,42.85,-72.56,12
Bennington,42.88,-73.20,15
St. Johnsbury,44.42,-72.02,6
Barre,44.20,-72.50,8
Middlebury,44.02,-73.17,9
Newport VT,44.94,-72.20,4
Stowe,44.47,-72.69,5
Springfield VT,43.30,-72.48,9
Woodstock VT,43.62,-72.52,3
Poughkeepsie,41.70,-73.93,30
Kingston,41.93,-74.00,23
Saratoga Springs,43.08,-73.78,28
Glens Falls,43.31,-73.64,14
Plattsburgh,44.70,-73.45,20
Troy,42.73,-73.69,51
Schenectady,42.81,-73.94,67
Syracuse,43.05,-76.15,146
Rochester,43.16,-77.61,211
Utica,43.10,-75.23,60
Binghamton,42.10,-75.91,47
Montauk,41.04,-71.95,4
Riverhead,40.92,-72.66,14
Newburgh,41.50,-74.01,28
White Plains,41.03,-73.76,59
Yonkers,40.93,-73.90,200
Newark,40.74,-74.17,311
Jersey City,40.72,-74.04,292
Trenton,40.22,-74.76,90
Atlantic City,39.36,-74.42,38
Princeton,40.36,-74.67,31`;
  TOWNS.split('\n').forEach(l => { const p = l.split(','); if (!CITIES.some(c => c.name === p[0])) CITIES.push({ name: p[0].replace(/ (MA|NH|VT)$/, ''), lat: +p[1], lon: +p[2], rank: 3, pop: +p[3] * 1000, xy: project(+p[2], +p[1]) }); });

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
    placesStatus: 'idle',
    /* optional extra places (top ~1000 US cities by population) fetched in the browser */
    async loadPlaces(url) {
      if (this.placesStatus !== 'idle') return; this.placesStatus = 'loading';
      for (const u of (url ? [url] : ['https://cdn.jsdelivr.net/gh/plotly/datasets@master/us-cities-top-1k.csv', 'https://raw.githubusercontent.com/plotly/datasets/master/us-cities-top-1k.csv'])) {
        try {
          const r = await fetch(u, { mode: 'cors' }); if (!r.ok) throw new Error('HTTP ' + r.status); const lines = (await r.text()).split(/\r?\n/).filter(Boolean);
          const split = l => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x => x.replace(/^"|"$/g, '').trim()), hd = split(lines[0]).map(x => x.toLowerCase());
          const ix = names => hd.findIndex(h => names.includes(h)), ci = ix(['city', 'name']), pi = ix(['population', 'pop']), la = ix(['lat', 'latitude']), lo = ix(['lon', 'lng', 'long', 'longitude']);
          if (ci < 0 || la < 0 || lo < 0) throw new Error('unexpected columns'); let added = 0;
          lines.slice(1).forEach(l => { const p = split(l), lat = +p[la], lon = +p[lo], pop = pi >= 0 ? +p[pi] : 5e4; if (!isFinite(lat) || !isFinite(lon) || lon > -60 || lon < -128 || lat < 23 || lat > 50) return;
            if (CITIES.some(c => Math.abs(c.lat - lat) < 0.08 && Math.abs(c.lon - lon) < 0.08)) return; CITIES.push({ name: p[ci], lat, lon, rank: 3, pop: pop || 5e4, xy: project(lon, lat) }); added++; });
          this.placesStatus = 'ready'; this.placesAdded = added; return;
        } catch (e) { /* try next */ }
      }
      this.placesStatus = 'error';
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
      if (opts.cities !== false && this.projOK !== false) this.drawCities(c, view, th, W, H, k, opts.density);
    },
    /* Labels appear progressively as you zoom: the population threshold falls with the view width.
       Bigger places are placed first and a label is skipped (or moved to the other side of its dot) if it would overlap. */
    drawCities(c, view, th, W, H, k, density) {
      const dens = density || 1, minPop = clamp(4.5e5 * Math.pow(view.w / 1000, 2.8) / dens, 1200, 2e6), placed = [], out = [];
      const list = CITIES.filter(ci => ci.rank === 0 ? view.w < 420 : ci.pop >= minPop).sort((a, b) => b.pop - a.pop);
      c.save(); c.textBaseline = 'middle'; c.lineJoin = 'round'; const fam = (g.Sym && g.Sym.FONT) || 'sans-serif', hit = (b) => placed.some(q => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
      for (const ci of list) {
        if (out.length >= 160) break;
        const x = W / 2 + (ci.xy[0] - view.cx) * k, y = H / 2 + (ci.xy[1] - view.cy) * k; if (x < 20 || x > W - 20 || y < 20 || y > H - 20) continue;
        const fs = ci.rank === 0 ? 27 : ci.pop >= 5e5 ? 27 : ci.pop >= 1e5 ? 24 : ci.pop >= 3e4 ? 22 : 20; c.font = `600 ${fs}px ${fam}`;
        const w = c.measureText(ci.name).width, m = 5, dot = [x - 7, y - 7, x + 7, y + 7];
        const right = [x + 12 - m, y - fs * 0.62 - m, x + 14 + w + m, y + fs * 0.62 + m], left = [x - 14 - w - m, right[1], x - 12 + m, right[3]];
        if (hit(dot)) continue; let side = 0; if (!hit(right)) side = 1; else if (!hit(left)) side = -1; if (!side) continue;
        placed.push(side > 0 ? right : left, dot); out.push(ci.name);
        c.fillStyle = ci.rank === 0 ? '#ffd23f' : th.text; c.beginPath(); c.arc(x, y, ci.rank === 0 ? 6.5 : ci.pop >= 1e5 ? 5 : 4, 0, 6.2832); c.fill();
        c.textAlign = side > 0 ? 'left' : 'right'; c.lineWidth = 5; c.strokeStyle = th.halo; c.strokeText(ci.name, x + side * 14, y + 1); c.fillText(ci.name, x + side * 14, y + 1);
      }
      this._labels = out; c.restore();
    }
  };
  g.WDMap = WDMap;
})(typeof window !== 'undefined' ? window : globalThis);
