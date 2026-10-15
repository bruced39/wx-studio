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

  /* WXfusion Weather Director broadcast-map defaults. These extend Claude's
     Mapbox renderer without changing the studio's stage/layout/render pipeline. */
  const WD_DEFAULTS = {
    broadcastBase:'satellite', atmosphere:'broadcast', terrain:false, terrainExaggeration:1,
    broadcastWaterColor:'#15223a', broadcastLandColor:'#27452d', broadcastWaterTintOpacity:.35, broadcastLandTintOpacity:.15,
    broadcastSatelliteSaturation:0, broadcastSatelliteContrast:.15,
    broadcastShowCities:true, broadcastUppercaseLabels:true, broadcastPlaceDensity:'towns', broadcastKeepMajorCities:true, broadcastMajorCityRank:9,
    broadcastLabelFont:'DIN Pro Bold', broadcastLabelDensity:'normal', broadcastLabelOpacity:1, broadcastLabelSpacing:1.25,
    broadcastCitySize:20, broadcastTownSize:16, broadcastVillageSize:13, broadcastCityMinZoom:3, broadcastTownMinZoom:5, broadcastVillageMinZoom:7,
    broadcastLabelColor:'#ffffff', broadcastLabelHaloColor:'#101820', broadcastLabelHaloWidth:2,
    broadcastShowPOI:false, broadcastShowRoadLabels:false, broadcastShowNaturalLabels:false,
    broadcastShowCoastline:true, broadcastCoastlineColor:'#050505', broadcastCoastlineWidth:1.5,
    broadcastShowCountryBorders:true, broadcastCountryColor:'#101010', broadcastCountryWidth:2.5,
    broadcastShowStateBorders:true, broadcastStateColor:'#171717', broadcastStateWidth:2,
    broadcastShowCountyBorders:false, broadcastCountyColor:'#89939d', broadcastCountyWidth:1,
    showZoomBadge:true,
    broadcastShowRoads:true, broadcastRoadColor:'#e5e7eb', broadcastRoadOpacity:.8, broadcastRoadWidth:1,
    broadcastMainRoadMinZoom:3, broadcastMainRoadMaxZoom:16,
    broadcastStateRoadMinZoom:5, broadcastStateRoadMaxZoom:24,
    broadcastOtherRoadMinZoom:7, broadcastOtherRoadMaxZoom:24,
    broadcastShowRoadShields:false, broadcastRoadShieldDensity:3, broadcastRoadShieldSize:1, broadcastRoadShieldMinZoom:7, broadcastRoadShieldMaxZoom:24,
    broadcastRoadLabelMinZoom:3, broadcastRoadLabelMaxZoom:16
  };
  MB.DEFAULTS = WD_DEFAULTS;
  MB.ensureConfig = bg => {
    bg = bg || {};
    Object.keys(WD_DEFAULTS).forEach(k => { if (bg[k] == null) bg[k] = WD_DEFAULTS[k]; });
    if (!bg.mbStyle) bg.mbStyle = 'broadcast';
    return bg;
  };
  const wdConfigKey = bg => {
    MB.ensureConfig(bg);
    return bg.mbStyle === 'broadcast' ? JSON.stringify(Object.keys(WD_DEFAULTS).map(k => bg[k])) : '';
  };
  function atmosphereFor(name){
    if(name==='none')return null;
    if(name==='dark')return {color:'rgb(30,42,55)','high-color':'rgb(18,34,80)','horizon-blend':.03,'space-color':'rgb(3,5,12)','star-intensity':.75};
    if(name==='natural')return {color:'rgb(190,215,235)','high-color':'rgb(45,100,210)','horizon-blend':.08,'space-color':'rgb(9,12,24)','star-intensity':.35};
    return {color:'rgb(164,205,232)','high-color':'rgb(24,83,176)','horizon-blend':.025,'space-color':'rgb(4,10,22)','star-intensity':.55};
  }
  function wdFontStack(name){
    const m={
      'DIN Pro Bold':['DIN Pro Bold','Arial Unicode MS Bold'],'DIN Pro Medium':['DIN Pro Medium','Arial Unicode MS Regular'],
      'Roboto Bold':['Roboto Bold','Arial Unicode MS Bold'],'Roboto Medium':['Roboto Medium','Arial Unicode MS Regular'],
      'Open Sans Bold':['Open Sans Bold','Arial Unicode MS Bold'],'Open Sans Semibold':['Open Sans Semibold','Arial Unicode MS Regular']
    };
    return m[name]||['DIN Pro Bold','Arial Unicode MS Bold'];
  }
  const labelPadding=(d,s)=>Math.max(0,(d==='sparse'?16:d==='dense'?5:d==='maximum'?2:9)*Math.max(.5,Math.min(3,+s||1)));
  function streetsSource(map){
    const st=map.getStyle();if(!st)return null;
    for(const l of st.layers||[])if(['place_label','admin','road'].includes(l['source-layer'])&&l.source)return l.source;
    for(const [id,src] of Object.entries(st.sources||{}))if(src&&src.type==='vector'&&String(src.url||'').includes('mapbox-streets'))return id;
    return null;
  }
  function settlementLayer(id,cfg,source,types,size,minzoom,rankMode,maxzoom){
    const density=cfg.broadcastLabelDensity||'normal',major=rankMode==='major',spacing=+cfg.broadcastLabelSpacing||1.25;
    const cityD=density==='sparse'?1:density==='dense'?4:density==='maximum'?5:3,townD=density==='sparse'?1:density==='dense'?3:density==='maximum'?5:2,smallD=density==='sparse'?1:density==='dense'?2:density==='maximum'?5:1;
    const densityRank=types.includes('city')?cityD:types.includes('town')?townD:smallD,rank=+cfg.broadcastMajorCityRank||9;
    const filter=['all',['==',['get','class'],'settlement'],['match',['get','type'],types,true,false],['<=',['coalesce',['get','filterrank'],5],densityRank]];
    if(rankMode==='major')filter.push(['<=',['coalesce',['get','symbolrank'],99],rank]);
    const layer={id,type:'symbol',source,'source-layer':'place_label',minzoom:+minzoom||0,filter,
      layout:{'text-field':['coalesce',['get','name_en'],['get','name']],'text-font':wdFontStack(cfg.broadcastLabelFont),
        'text-transform':cfg.broadcastUppercaseLabels===false?'none':'uppercase','text-size':+size||14,'symbol-sort-key':['coalesce',['get','symbolrank'],99],
        'text-anchor':'center','text-justify':'center','text-allow-overlap':false,'text-ignore-placement':false,'text-padding':major?Math.max(2,4*spacing):labelPadding(density,spacing)},
      paint:{'text-color':cfg.broadcastLabelColor||'#fff','text-opacity':Math.max(0,Math.min(1,+cfg.broadcastLabelOpacity||0)),
        'text-halo-color':cfg.broadcastLabelHaloColor||'#101820','text-halo-width':Math.max(0,+cfg.broadcastLabelHaloWidth||0),'text-halo-blur':.15}};
    if(maxzoom!=null&&isFinite(+maxzoom))layer.maxzoom=+maxzoom;
    return layer;
  }
  function installBaseTints(map,cfg,source){
    ['wd-land-tint','wd-water-tint','wd-coastline-outline'].forEach(id=>{try{if(map.getLayer(id))map.removeLayer(id);}catch{}});
    if(!source)return;
    const layers=map.getStyle().layers||[],before=(layers.find(l=>l.type==='symbol')||{}).id;
    try{
      if(!map.getSource('wd-world-tint'))map.addSource('wd-world-tint',{type:'geojson',data:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]]]}}]}});
      if(+cfg.broadcastLandTintOpacity>0){const l={id:'wd-land-tint',type:'fill',source:'wd-world-tint',paint:{'fill-color':cfg.broadcastLandColor,'fill-opacity':Math.max(0,Math.min(.6,+cfg.broadcastLandTintOpacity))}};before?map.addLayer(l,before):map.addLayer(l);}
    }catch(e){}
    try{if(+cfg.broadcastWaterTintOpacity>0){const l={id:'wd-water-tint',type:'fill',source,'source-layer':'water',paint:{'fill-color':cfg.broadcastWaterColor,'fill-opacity':Math.max(0,Math.min(.8,+cfg.broadcastWaterTintOpacity))}};before?map.addLayer(l,before):map.addLayer(l);}}catch(e){}
    try{if(cfg.broadcastShowCoastline!==false){const w=Math.max(.5,+cfg.broadcastCoastlineWidth||1.5),l={id:'wd-coastline-outline',type:'line',source,'source-layer':'water',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':cfg.broadcastCoastlineColor||'#050505','line-width':['interpolate',['linear'],['zoom'],3,w*.7,7,w,11,w*1.35]}};before?map.addLayer(l,before):map.addLayer(l);}}catch(e){}
  }
  function applyTerrain(map,cfg){
    try{
      if(cfg.terrain){
        if(!map.getSource('wd-terrain-dem'))map.addSource('wd-terrain-dem',{type:'raster-dem',url:'mapbox://mapbox.mapbox-terrain-dem-v1',tileSize:512,maxzoom:14});
        map.setTerrain({source:'wd-terrain-dem',exaggeration:Math.max(0,Math.min(3,+cfg.terrainExaggeration||1))});
      }else if(map.setTerrain)map.setTerrain(null);
    }catch(e){}
  }
  function addBroadcastCartography(map,cfg){
    if(!map||cfg.mbStyle!=='broadcast')return;
    const layers=map.getStyle().layers||[];
    if(!map.__wdOriginalZoomRanges)map.__wdOriginalZoomRanges={};
    for(const l of layers){
      const id=String(l.id||'').toLowerCase(),sl=String(l['source-layer']||'').toLowerCase(); if(id.startsWith('wd-'))continue;
      try{
        if(l.type==='symbol'){
          const adminPlace=sl==='place_label'&&(id.includes('state')||id.includes('province')||id.includes('country')||id.includes('continent')||id.includes('region'));
          const place=sl==='place_label'||id.includes('settlement')||id.includes('place-label');
          const shield=id.includes('road-number')||id.includes('road-shield')||id.includes('shield');
          const roadLabel=sl==='road'||id.includes('road-label')||shield;
          const poi=sl==='poi_label'||id.includes('poi'),natural=sl==='natural_label'||id.includes('natural')||id.includes('water-label');
          if(adminPlace||place)map.setLayoutProperty(l.id,'visibility','none');
          else if(roadLabel){
            const vis=shield?!!cfg.broadcastShowRoadShields:!!cfg.broadcastShowRoadLabels;map.setLayoutProperty(l.id,'visibility',vis?'visible':'none');
            if(!map.__wdOriginalZoomRanges[l.id])map.__wdOriginalZoomRanges[l.id]={min:+l.minzoom||0,max:l.maxzoom==null?24:+l.maxzoom};
            const zr=map.__wdOriginalZoomRanges[l.id],
              min=shield?Math.max(0,+cfg.broadcastRoadShieldMinZoom||7):Math.max(0,+cfg.broadcastRoadLabelMinZoom||3),
              requestedMax=shield?(+cfg.broadcastRoadShieldMaxZoom||24):(+cfg.broadcastRoadLabelMaxZoom||16),
              mx=Math.max(min+.5,requestedMax);
            try{map.setLayerZoomRange(l.id,Math.max(zr.min,min),Math.max(Math.max(zr.min,min)+.01,Math.min(zr.max,mx)));}catch(e){}
            if(vis&&shield){const d=Math.max(1,Math.min(5,+cfg.broadcastRoadShieldDensity||3)),sp=[900,700,520,350,220][d-1],sz=Math.max(.6,Math.min(2,+cfg.broadcastRoadShieldSize||1));try{map.setLayoutProperty(l.id,'symbol-spacing',sp);}catch(e){}try{map.setLayoutProperty(l.id,'icon-size',sz);}catch(e){}}
            else if(vis&&!shield){try{map.setLayoutProperty(l.id,'text-font',wdFontStack(cfg.broadcastLabelFont));}catch(e){}try{map.setPaintProperty(l.id,'text-color',cfg.broadcastLabelColor);}catch(e){}try{map.setPaintProperty(l.id,'text-halo-color',cfg.broadcastLabelHaloColor);}catch(e){}}
          }else if(poi)map.setLayoutProperty(l.id,'visibility',cfg.broadcastShowPOI?'visible':'none');
          else if(natural)map.setLayoutProperty(l.id,'visibility',cfg.broadcastShowNaturalLabels?'visible':'none');
          else map.setLayoutProperty(l.id,'visibility','none');
        }else if(l.type==='line'){
          const road=sl==='road'||id.includes('road')||id.includes('street')||id.includes('motorway'),boundary=sl==='admin'||id.includes('boundary')||id.includes('admin');
          if(road){
            const vis=cfg.broadcastShowRoads!==false;map.setLayoutProperty(l.id,'visibility',vis?'visible':'none');
            if(!map.__wdOriginalZoomRanges[l.id])map.__wdOriginalZoomRanges[l.id]={min:+l.minzoom||0,max:l.maxzoom==null?24:+l.maxzoom};
            const zr=map.__wdOriginalZoomRanges[l.id],sig=(id+' '+JSON.stringify(l.filter||[])).toLowerCase(),tier=(sig.includes('motorway')||sig.includes('trunk')||sig.includes('freeway'))?'main':(sig.includes('primary')||sig.includes('secondary'))?'state':'other';
            const min=tier==='main'?+cfg.broadcastMainRoadMinZoom:tier==='state'?+cfg.broadcastStateRoadMinZoom:+cfg.broadcastOtherRoadMinZoom;
            const requestedMax=tier==='main'?+cfg.broadcastMainRoadMaxZoom:tier==='state'?+cfg.broadcastStateRoadMaxZoom:+cfg.broadcastOtherRoadMaxZoom;
            const max=Math.min(zr.max,Math.max((min||0)+.5,requestedMax||24));
            try{map.setLayerZoomRange(l.id,Math.max(zr.min,min||0),Math.max(Math.max(zr.min,min||0)+.01,max));}catch(e){}
            if(vis){try{map.setPaintProperty(l.id,'line-color',cfg.broadcastRoadColor);}catch(e){}try{map.setPaintProperty(l.id,'line-opacity',Math.max(0,Math.min(1,+cfg.broadcastRoadOpacity)));}catch(e){}
              const s=Math.max(.25,+cfg.broadcastRoadWidth||1);try{map.setPaintProperty(l.id,'line-width',['interpolate',['linear'],['zoom'],3,.8*s,5,1.2*s,7,1.8*s,9,2.8*s,11,4.2*s]);}catch(e){}}
          }else if(boundary){
            const country=id.includes('admin-0')||id.includes('country')||id.includes('national'),county=id.includes('admin-2')||id.includes('county');
            const vis=country?cfg.broadcastShowCountryBorders!==false:county?!!cfg.broadcastShowCountyBorders:cfg.broadcastShowStateBorders!==false;
            const color=country?cfg.broadcastCountryColor:county?cfg.broadcastCountyColor:cfg.broadcastStateColor,width=country?+cfg.broadcastCountryWidth:county?+cfg.broadcastCountyWidth:+cfg.broadcastStateWidth;
            map.setLayoutProperty(l.id,'visibility',vis?'visible':'none');if(vis){try{map.setPaintProperty(l.id,'line-color',color);}catch(e){}try{map.setPaintProperty(l.id,'line-width',Math.max(.5,width||1));}catch(e){}}
          }
        }else if(l.type==='raster'&&cfg.broadcastBase==='satellite'){
          try{map.setPaintProperty(l.id,'raster-saturation',+cfg.broadcastSatelliteSaturation||0);}catch(e){}
          try{map.setPaintProperty(l.id,'raster-contrast',+cfg.broadcastSatelliteContrast||0);}catch(e){}
        }
      }catch(e){}
    }
    const source=streetsSource(map);installBaseTints(map,cfg,source);
    ['wd-major-city-labels','wd-city-labels','wd-town-labels','wd-small-place-labels'].forEach(id=>{try{if(map.getLayer(id))map.removeLayer(id);}catch{}});
    if(source&&cfg.broadcastShowCities!==false){
      const d=cfg.broadcastPlaceDensity||'towns',cityMin=Math.max(0,+cfg.broadcastCityMinZoom||3),add=l=>{try{map.addLayer(l);}catch(e){}};
      if(d==='villages'||d==='all')add(settlementLayer('wd-small-place-labels',cfg,source,d==='all'?['village','hamlet','suburb','neighborhood']:['village'],cfg.broadcastVillageSize,cfg.broadcastVillageMinZoom));
      if(d!=='cities')add(settlementLayer('wd-town-labels',cfg,source,['town'],cfg.broadcastTownSize,cfg.broadcastTownMinZoom));
      add(settlementLayer('wd-city-labels',cfg,source,['city'],cfg.broadcastCitySize,cityMin));
      if(cfg.broadcastKeepMajorCities!==false&&cityMin>0)add(settlementLayer('wd-major-city-labels',cfg,source,['city'],Math.max(10,+cfg.broadcastCitySize+2),0,'major',cityMin));
    }
  }

  MB.token = () => String(g.WX_MAPBOX_TOKEN || ls.get('wx.mapbox.token') || '').trim();
  MB.hasToken = () => /^pk\./.test(MB.token());
  MB.scale = num(+ls.get('wx.mapbox.scale'), 1.5) || 1.5;
  MB.STYLES = [['broadcast','Weather Director Broadcast'],['streets-v12', 'Streets'], ['outdoors-v12', 'Outdoors'], ['light-v11', 'Light'], ['dark-v11', 'Dark'], ['satellite-streets-v12', 'Satellite + streets'], ['navigation-day-v1', 'Navigation (road signs)']];
  MB.PROJ = [['mercator', 'Mercator (flat)'], ['globe', 'Globe']];
  const R = {
    conus: ['Continental US', { c: [-96.5, 38.6], z: 3.3 }], northamerica: ['North America', { c: [-98, 41], z: 2.2 }], northeast: ['Northeast', { c: [-73.8, 42.7], z: 5.2 }], newengland: ['New England', { c: [-71.6, 43.3], z: 5.7 }],
    eastma: ['Eastern Massachusetts', { c: [-71.2689, 42.5584], z: 8.0 }], boston: ['Boston / Billerica', { c: [-71.18, 42.48], z: 9.4 }], tropical: ['Atlantic basin', { c: [-60, 25], z: 2.7 }], world: ['World', { c: [-40, 28], z: 1.3 }]
  };
  MB.regionList = Object.keys(R).map(k => [k, R[k][0]]);
  MB.regionCam = key => Object.assign({ b: 0, p: 0 }, (R[key] || R.newengland)[1], { c: (R[key] || R.newengland)[1].c.slice() });
  const styleOf = bg => { MB.ensureConfig(bg); return bg.mbStyle==='broadcast'?(bg.broadcastBase==='satellite'?'satellite-streets-v12':'outdoors-v12'):(bg.mbStyle||'streets-v12'); }, projOf = bg => (bg && bg.proj === 'globe') ? 'globe' : 'mercator';
  const norm = cam => ({ c: [num(cam.c[0], 0), clampLat(num(cam.c[1], 0))], z: Math.max(0, Math.min(22, num(cam.z, 3))), b: num(cam.b, 0), p: Math.max(0, Math.min(75, num(cam.p, 0))) });
  const clampLat = v => Math.max(-85, Math.min(85, v));
  const cloneBg = bg => { MB.ensureConfig(bg); const o={mbStyle:bg.mbStyle,proj:bg.proj};Object.keys(WD_DEFAULTS).forEach(k=>o[k]=bg[k]);return o; };
  const keyOf = (bg, cam) => { const k = norm(cam); return [bg.mbStyle||'',styleOf(bg),projOf(bg),wdConfigKey(bg),MB.scale,k.c[0].toFixed(5),k.c[1].toFixed(5),k.z.toFixed(3),k.b.toFixed(2),k.p.toFixed(1)].join('|'); };
  MB.keyOf = keyOf;

  /* ---- library + maps ---- */
  let D = null, P = null, host = null, initP = null, curStyle = null, curStyleKey = null, curCfgKey = null, curProj = null, pProj = null, pKey = null;
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
        curStyle = 'streets-v12'; curStyleKey='stock|streets-v12'; curCfgKey=null; curProj = 'mercator'; pProj = 'mercator'; MB.status = 'ready';
      } catch (e) { MB.status = 'error'; MB.err = e.message || String(e); initP = null; throw e; }
    })();
    return initP;
  };
  MB.reset = function () { try { if (D) D.remove(); if (P) P.remove(); if (host) host.remove(); } catch (e) { /* ignore */ } D = P = host = initP = null; curStyle = curStyleKey = curCfgKey = curProj = pProj = pKey = null; MB.cache.clear(); MB.last = null; MB.status = 'idle'; MB.err = ''; MB.queue = Promise.resolve(); };
  MB.setToken = function (t) { ls.set('wx.mapbox.token', String(t || '').trim()); MB.reset(); };
  MB.setScale = function (s) { MB.scale = s; ls.set('wx.mapbox.scale', String(s)); MB.reset(); };

  function fog(bg) { try { D.setFog(atmosphereFor(bg.mbStyle==='broadcast'?(bg.atmosphere||'broadcast'):(projOf(bg)==='globe'?'natural':'none'))); } catch (e) { /* ignore */ } }
  async function setup(bg) {
    MB.ensureConfig(bg);const st=styleOf(bg),pr=projOf(bg),styleKey=(bg.mbStyle||'stock')+'|'+st,cfgKey=wdConfigKey(bg);
    if(styleKey!==curStyleKey){D.setStyle('mapbox://styles/mapbox/'+st);await once(D,'style.load');curStyle=st;curStyleKey=styleKey;curCfgKey=null;curProj=null;D.__wdOriginalZoomRanges={};}
    if(pr!==curProj){D.setProjection(pr);curProj=pr;}
    fog(bg);applyTerrain(D,bg);
    if(bg.mbStyle==='broadcast'&&cfgKey!==curCfgKey){addBroadcastCartography(D,bg);curCfgKey=cfgKey;}
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
  MB.snap = function (bg, cam) { const key = keyOf(bg, cam), b = cloneBg(bg); if (MB.cache.has(key)) return Promise.resolve(MB.cache.get(key)); const p = MB.queue.then(() => doSnap(b, cam, key)); MB.queue = p.catch(() => { }); return p; };
  /* synchronous accessor for the live preview: returns the right frame if cached, else asks for it and returns the last one */
  let busy = false, want = null;
  function pump() {
    if (busy || !want) return; busy = true; const w = want; want = null;
    MB.snap(w.bg, w.cam).catch(() => { }).then(() => { busy = false; if (MB.onUpdate) MB.onUpdate(); pump(); });
  }
  MB.frame = function (bg, cam) {
    if (!MB.hasToken()) return null; const key = keyOf(bg, cam), c = MB.cache.get(key); if (c) return c;
    want = { bg: cloneBg(bg), cam: norm(cam) }; pump(); return MB.last;
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
