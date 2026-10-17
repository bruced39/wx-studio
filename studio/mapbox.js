/* WX Studio – Mapbox background.
 * A hidden Mapbox GL JS map (1920x1080 output pixels) is rendered for each camera position and copied into a
 * canvas that the studio draws as the scene background. A second, style-less "projector" map converts between
 * longitude/latitude and screen pixels so pinned drawings (fronts, arrows, H/L...) follow the map.
 * Camera = { c:[lng,lat], z:zoom, b:bearing, p:pitch }.  Styles keep Mapbox's own zoom rules, so cities, towns,
 * roads and road shields pop in and out exactly as they do on mapbox.com.                                   */
(function (g) {
  'use strict';
  const W = 1920, H = 1080, VER = 'v3.9.0';
  const MB = { W, H, status: 'idle', err: '', scale: 1.5, last: null, onUpdate: null, cache: new Map(), interacting: false };
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } } };
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;

  /* WXfusion Weather Director broadcast-map defaults. These extend Claude's
     Mapbox renderer without changing the studio's stage/layout/render pipeline. */
  const WD_DEFAULTS = {
    broadcastBase:'satellite', broadcastDarkColor:'#151a21', broadcastCustomColor:'#18304a', broadcastOceanShow:false,
    atmosphere:'broadcast', terrain:false, terrainExaggeration:1, globeAtmosphereEnabled:true, globeAtmosphereStrength:.1, globeStarsEnabled:true, globeStarIntensity:.6, globeBackgroundColor:'#000000',
    broadcastSatelliteShadowLift:0, broadcastSatelliteHighlightCeiling:1,
    waterwaysShow:true, waterwaysColor:'#a9dbec', waterwaysWidth:.7, waterwaysOpacity:1, waterwaysMinZoom:8, waterwaysMaxZoom:24,
    terrainHillshadeShow:false, terrainHillshadeIntensity:.2, terrainHillshadeShadow:'#000000', terrainHillshadeHighlight:'#ffffff', terrainHillshadeAccent:'#000000',
    broadcastWaterColor:'#1d253a', broadcastLandColor:'#27452d', broadcastWaterTintOpacity:1, broadcastLandTintOpacity:.15,
    showWaterDepth:false, waterDepthColor:'#000000', waterDepthMinZoom:0, waterDepthMaxZoom:24,
    showNationalParks:false, nationalParkColor:'#252525', nationalParkMinZoom:0, nationalParkMaxZoom:24,
    showBuildingFootprints:false, buildingFootprintColor:'#242424',
    show3DBuildings:false, building3DHeight:1,

    overlayDayNight:false,
    overlayCWA:false, overlayCWAColor:'#8056bb', overlayCWALineType:'solid', overlayCWAWidth:1.2, overlayCWAOpacity:1, overlayCWAMinZoom:3, overlayCWAMaxZoom:12,
    overlayPublicZones:false, overlayPublicZonesColor:'#e3b952', overlayPublicZonesLineType:'solid', overlayPublicZonesWidth:1, overlayPublicZonesOpacity:1, overlayPublicZonesMinZoom:4, overlayPublicZonesMaxZoom:16,
    overlayFireZones:false, overlayFireZonesColor:'#e17f30', overlayFireZonesLineType:'solid', overlayFireZonesWidth:1, overlayFireZonesOpacity:1, overlayFireZonesMinZoom:4, overlayFireZonesMaxZoom:16,
    overlayMarineZones:false, overlayMarineZonesColor:'#67a8df', overlayMarineZonesLineType:'solid', overlayMarineZonesWidth:1.2, overlayMarineZonesOpacity:1, overlayMarineZonesMinZoom:3, overlayMarineZonesMaxZoom:16,
    overlayTimeZones:false, overlayTimeZonesColor:'#209e84', overlayTimeZonesLineType:'solid', overlayTimeZonesWidth:1.2, overlayTimeZonesOpacity:1, overlayTimeZonesMinZoom:2, overlayTimeZonesMaxZoom:8,
    overlayLatLonMode:'off', overlayLatLonColor:'#b9b9b9', overlayLatLonWidth:.75, overlayLatLonOpacity:.45, overlayLatLonAutoSpacing:true, overlayLatLonManualSpacing:5,
    broadcastSatelliteSaturation:0, broadcastSatelliteContrast:.15,
    broadcastShowCities:true, broadcastUppercaseLabels:true, broadcastPlaceDensity:'towns', broadcastKeepMajorCities:true, broadcastMajorCityRank:9, broadcastOverviewCityDensity:'more', broadcastOverviewLabelGap:2,
    broadcastLabelFont:'DIN Pro Bold', broadcastLabelDensity:'normal', broadcastLabelOpacity:1, broadcastLabelSpacing:1.25,
    broadcastCitySize:20, broadcastTownSize:16, broadcastVillageSize:13,
    broadcastCityMinZoom:3, broadcastCityMaxZoom:24, broadcastTownMinZoom:5, broadcastTownMaxZoom:24,
    broadcastVillageMinZoom:7, broadcastVillageMaxZoom:24, broadcastMajorCityMinZoom:0,
    broadcastLabelColor:'#ffffff', broadcastLabelHaloColor:'#101820', broadcastLabelHaloWidth:2,
    broadcastShowPOI:false, broadcastShowRoadLabels:false, broadcastShowNaturalLabels:false,
    broadcastShowCoastline:true, broadcastCoastlineColor:'#050505', broadcastCoastlineWidth:1.5,
    broadcastInlandWaterOutlines:false, broadcastInlandWaterOutlineColor:'#050505', broadcastInlandWaterOutlineWidth:1,
    broadcastShowCountryBorders:true, broadcastCountryColor:'#101010', broadcastCountryWidth:2.5,
    broadcastShowStateBorders:true, broadcastStateColor:'#171717', broadcastStateWidth:2,
    broadcastShowCountyBorders:false, broadcastCountyColor:'#89939d', broadcastCountyWidth:1, broadcastCountyMinZoom:6,
    showZoomBadge:true,
    broadcastShowRoads:true, broadcastRoadColor:'#e5e7eb', broadcastRoadOpacity:.8, broadcastRoadWidth:1,
    broadcastMainRoadMinZoom:3, broadcastMainRoadMaxZoom:16,
    broadcastStateRoadMinZoom:5, broadcastStateRoadMaxZoom:24,
    broadcastOtherRoadMinZoom:7, broadcastOtherRoadMaxZoom:24,
    broadcastShowRoadShields:false, broadcastRoadShieldDensity:3, broadcastRoadShieldSize:1, broadcastRoadShieldMinZoom:7, broadcastRoadShieldMaxZoom:24,
    broadcastRoadLabelMinZoom:3, broadcastRoadLabelMaxZoom:16,

    /* AguaceroWX-style transportation */
    roadInterstateShow:true, roadInterstateColor:'#e5e5e5', roadInterstateWidth:2.2, roadInterstateOpacity:.75, roadInterstateOutline:true, roadInterstateOutlineColor:'#000000', roadInterstateOutlineWidth:.5, roadInterstateMinZoom:5, roadInterstateMaxZoom:22,
    roadMajorShow:true, roadMajorColor:'#cacaca', roadMajorWidth:1.8, roadMajorOpacity:.75, roadMajorOutline:true, roadMajorOutlineColor:'#000000', roadMajorOutlineWidth:.5, roadMajorMinZoom:6, roadMajorMaxZoom:22,
    roadStateShow:true, roadStateColor:'#a4a4a4', roadStateWidth:1.2, roadStateOpacity:.65, roadStateOutline:true, roadStateOutlineColor:'#000000', roadStateOutlineWidth:.3, roadStateMinZoom:7, roadStateMaxZoom:22,
    roadCountyShow:true, roadCountyColor:'#7e7e7e', roadCountyWidth:.8, roadCountyOpacity:.55, roadCountyOutline:false, roadCountyOutlineColor:'#000000', roadCountyOutlineWidth:.3, roadCountyMinZoom:9.5, roadCountyMaxZoom:22,
    roadLocalPavedShow:true, roadLocalPavedColor:'#888888', roadLocalPavedWidth:.7, roadLocalPavedOpacity:.45, roadLocalPavedOutline:false, roadLocalPavedOutlineColor:'#000000', roadLocalPavedOutlineWidth:.3, roadLocalPavedMinZoom:10.5, roadLocalPavedMaxZoom:22,
    roadLocalUnpavedShow:true, roadLocalUnpavedColor:'#887d73', roadLocalUnpavedWidth:.5, roadLocalUnpavedOpacity:.40, roadLocalUnpavedOutline:false, roadLocalUnpavedOutlineColor:'#000000', roadLocalUnpavedOutlineWidth:.3, roadLocalUnpavedMinZoom:11.5, roadLocalUnpavedMaxZoom:22,
    roadResidentialShow:true, roadResidentialColor:'#747474', roadResidentialWidth:.3, roadResidentialOpacity:.20, roadResidentialOutline:false, roadResidentialOutlineColor:'#000000', roadResidentialOutlineWidth:.3, roadResidentialMinZoom:13, roadResidentialMaxZoom:22,
    roadServiceShow:true, roadServiceColor:'#5e5e5e', roadServiceWidth:.3, roadServiceOpacity:.30, roadServiceOutline:false, roadServiceOutlineColor:'#000000', roadServiceOutlineWidth:.3, roadServiceMinZoom:14, roadServiceMaxZoom:22,
    airportRunwaysShow:true, airportRunwaysColor:'#b3b3b3', airportRunwaysWidth:.6, airportRunwaysMinZoom:0, airportRunwaysMaxZoom:24
  };
  // Independent label tiers. Legacy map styles with a single Label Font /
  // Label Color are migrated in ensureConfig BEFORE defaults are applied.
  // This preserves saved user typography rather than silently resetting it.
  // Single verified AguaceroWX *place-label* preset for both NEW map
  // defaults and the user-operated Restore button. Do not duplicate these
  // numbers in ui.js: differences between defaults and button caused user
  // confusion in v0.9.58. These values were recorded from the reference
  // City/Town/Village/Hamlet panels; roads, boundaries, other assets are
  // intentionally outside this preset.
  const LABEL_TIERS=['City','Town','Village','Hamlet'];
  const AGUACERO_PLACE_LABELS={};
  const reference={
    City:{HaloWidth:2.5,DensityPct:97,MinZoom:2,MaxZoom:22,DotSize:3.5},
    Town:{HaloWidth:2,DensityPct:96,MinZoom:2,MaxZoom:22,DotSize:3},
    Village:{HaloWidth:1.5,DensityPct:96,MinZoom:6,MaxZoom:22,DotSize:2.5},
    Hamlet:{HaloWidth:1,DensityPct:96,MinZoom:8,MaxZoom:22,DotSize:2}
  };
  const common={
    Enabled:true,Font:'Roboto Bold',Size:16,Color:'#ffffff',
    HaloColor:'#000000',Population:'all',TextBackground:false,
    DropShadow:false,Uppercase:true,Dots:false,
    DotColor:'#ffffff',DotOutlineColor:'#000000',DotOutlineWidth:1,
    DotNameOffset:4,DotShadow:false,Opacity:1,Spacing:1.25,
    BackgroundColor:'#101820'
  };
  for(const tier of LABEL_TIERS){
    for(const [suffix,value] of Object.entries({...common,...reference[tier]}))
      AGUACERO_PLACE_LABELS['broadcast'+tier+suffix]=value;
  }
  AGUACERO_PLACE_LABELS.broadcastShowCities=true;
  AGUACERO_PLACE_LABELS.broadcastUppercaseLabels=true;
  AGUACERO_PLACE_LABELS.broadcastKeepMajorCities=true;
  // Respect the reference City minimum even for the native overview
  // fallback. A user can explicitly lower this separately afterwards.
  AGUACERO_PLACE_LABELS.broadcastMajorCityMinZoom=2;
  Object.assign(WD_DEFAULTS,AGUACERO_PLACE_LABELS);
  MB.AGUACERO_PLACE_LABELS=Object.freeze(AGUACERO_PLACE_LABELS);
  MB.applyAguaceroPlaceLabels=cfg=>{
    if(!cfg||typeof cfg!=='object')return cfg;
    Object.assign(cfg,AGUACERO_PLACE_LABELS);
    return cfg;
  };
  MB.DEFAULTS = WD_DEFAULTS;
  MB.ensureConfig = bg => {
    bg = bg || {};
    // Existing saved shows may store a degree interval in the old mode selector.
    // Convert that to On and retain its fixed spacing when Auto spacing is disabled.
    if(bg.overlayLatLonMode != null && !['off','on','ocean'].includes(String(bg.overlayLatLonMode))){
      const legacy=+bg.overlayLatLonMode;
      if([.5,1,2,5,10,15,30].includes(legacy)){
        if(bg.overlayLatLonManualSpacing==null)bg.overlayLatLonManualSpacing=legacy;
        bg.overlayLatLonMode='on';
      }else bg.overlayLatLonMode='off';
    }
    // New independent-tier fields inherit ALL existing saved user settings
    // once, before filling missing defaults. Repeated calls are idempotent:
    // changing Cities never changes Towns or Villages afterwards.
    const legacyPct={sparse:20,normal:60,dense:80,maximum:100};
    const placeType=bg.broadcastPlaceDensity||WD_DEFAULTS.broadcastPlaceDensity;
    // A completely NEW map has no persisted place-label keys: do not
    // manufacture old DIN font settings from compatibility fallbacks before
    // the canonical Aguacero defaults are inserted below. Old saved maps
    // DO contain label properties, and still require lossless migration.
    const legacyHasLabels=[
      'broadcastLabelFont','broadcastLabelColor','broadcastLabelHaloColor',
      'broadcastLabelHaloWidth','broadcastLabelOpacity','broadcastLabelSpacing',
      'broadcastLabelDensity','broadcastPlaceDensity','broadcastUppercaseLabels',
      'broadcastCitySize','broadcastTownSize','broadcastVillageSize'
    ].some(k=>Object.prototype.hasOwnProperty.call(bg,k))||
      LABEL_TIERS.some(t=>['Enabled','Font','Size','Color','MinZoom'].some(
        suffix=>Object.prototype.hasOwnProperty.call(bg,'broadcast'+t+suffix)));
    if(legacyHasLabels)for(const tier of LABEL_TIERS){
      const p='broadcast'+tier;
      const oldVillage=tier==='Hamlet'?'broadcastVillage':null;
      // Old scene/preset labels must remain unchanged. Prior to the Hamlet
      // category, hamlets were rendered with Village settings and zoom;
      // copy those exact saved values rather than imposing new defaults.
      const migrate=(suffix,fallback)=>oldVillage&&bg[oldVillage+suffix]!=null
        ?bg[oldVillage+suffix]:fallback;
      const inherited={
        Enabled:migrate('Enabled',tier==='City'||(tier==='Town'&&placeType!=='cities')||
          ((tier==='Village'||tier==='Hamlet')&&(placeType==='villages'||placeType==='all'))),
        Font:migrate('Font',bg.broadcastLabelFont??WD_DEFAULTS.broadcastLabelFont),
        Color:migrate('Color',bg.broadcastLabelColor??WD_DEFAULTS.broadcastLabelColor),
        HaloColor:migrate('HaloColor',bg.broadcastLabelHaloColor??WD_DEFAULTS.broadcastLabelHaloColor),
        HaloWidth:migrate('HaloWidth',bg.broadcastLabelHaloWidth??WD_DEFAULTS.broadcastLabelHaloWidth),
        Uppercase:migrate('Uppercase',bg.broadcastUppercaseLabels??WD_DEFAULTS.broadcastUppercaseLabels),
        Opacity:migrate('Opacity',bg.broadcastLabelOpacity??WD_DEFAULTS.broadcastLabelOpacity),
        Spacing:migrate('Spacing',bg.broadcastLabelSpacing??WD_DEFAULTS.broadcastLabelSpacing),
        DensityPct:migrate('DensityPct',legacyPct[bg.broadcastLabelDensity]??60),
        Size:migrate('Size',bg[p+'Size']??WD_DEFAULTS[p+'Size'])
      };
      if(oldVillage){
        // Preserve all extra Village appearance and the inherited zoom range
        // on old saved shows that never had an independent Hamlet panel.
        for(const suffix of ['MinZoom','MaxZoom','Population','TextBackground',
          'BackgroundColor','DropShadow','Dots','DotColor','DotOutlineColor',
          'DotOutlineWidth','DotSize','DotNameOffset','DotShadow']){
          if(bg[p+suffix]==null&&bg[oldVillage+suffix]!=null)
            bg[p+suffix]=bg[oldVillage+suffix];
        }
      }
      for(const [suffix,value] of Object.entries(inherited))
        if(bg[p+suffix]==null)bg[p+suffix]=value;
    }
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
  function tierAppearance(cfg,tier){
    const p='broadcast'+tier;
    const val=(key,fallback)=>cfg[p+key]??fallback;
    const oldDensity=cfg.broadcastLabelDensity||'normal';
    const pctDefaults={sparse:20,normal:60,dense:80,maximum:100};
    const pct=Math.max(0,Math.min(100,+val('DensityPct',pctDefaults[oldDensity]??60)));
    const place=cfg.broadcastPlaceDensity||'towns';
    return {tier,
      enabled:!!val('Enabled',tier==='City'||(tier==='Town'&&place!=='cities')||
        ((tier==='Village'||tier==='Hamlet')&&(place==='villages'||place==='all'))),
      font:val('Font',cfg.broadcastLabelFont||'DIN Pro Bold'),
      size:+val('Size',tier==='City'?20:tier==='Town'?16:13),
      color:val('Color',cfg.broadcastLabelColor||'#ffffff'),
      halo:val('HaloColor',cfg.broadcastLabelHaloColor||'#101820'),
      haloWidth:+val('HaloWidth',cfg.broadcastLabelHaloWidth??2),
      uppercase:!!val('Uppercase',cfg.broadcastUppercaseLabels!==false),
      opacity:Math.max(0,Math.min(1,+val('Opacity',cfg.broadcastLabelOpacity??1))),
      spacing:+val('Spacing',cfg.broadcastLabelSpacing??1.25),
      pct,population:val('Population','all'),
      background:!!val('TextBackground',false),
      backgroundColor:val('BackgroundColor','#101820'),
      shadow:!!val('DropShadow',false),
      dots:!!val('Dots',false),
      dotColor:val('DotColor','#ffffff'),
      dotOutline:val('DotOutlineColor','#000000'),
      dotOutlineWidth:+val('DotOutlineWidth',1),
      dotSize:+val('DotSize',3.5),
      nameOffset:+val('DotNameOffset',4),
      dotShadow:!!val('DotShadow',false)
    };
  }
  function tierFilter(cfg,tier,types,rankMode){
    const t=tierAppearance(cfg,tier);
    const dens=Math.ceil(5*t.pct/100);
    const filter=['all',['match',['get','class'],['settlement','disputed_settlement'],true,false],
      ['match',['get','type'],types,true,false]];
    if(t.population!=='all'){
      const cap=t.population==='top'?4:9;
      filter.push(['<=',['coalesce',['get','symbolrank'],99],cap]);
    }
    const prominence=['<=',['coalesce',['get','symbolrank'],99],
      Math.max(1,Math.min(19,+cfg.broadcastMajorCityRank||9))];
    if(rankMode==='major')filter.push(prominence);
    else if(tier==='City'&&cfg.broadcastKeepMajorCities!==false)
      filter.push(['any',['<=',['coalesce',['get','filterrank'],5],dens],prominence]);
    else filter.push(['<=',['coalesce',['get','filterrank'],5],dens]);
    return filter;
  }
  // ONE typography source for both built-in Mapbox overview settlements
  // (<7.5) and the custom WX Studio place layers (>=7.5). The old native
  // symbols inherited stock Mapbox letter spacing, line wrapping, anchors
  // and text-field values even after their font/size were overridden.
  // This made the SAME place-label tier look different across zoom.
  function tierTextStyle(cfg,tier,overview=false){
    const t=tierAppearance(cfg,tier),
      requestedSize=Number.isFinite(t.size)&&t.size>0?t.size:(tier==='City'?20:tier==='Town'?16:13),
      overviewGap=Number.isFinite(+cfg.broadcastOverviewLabelGap)
        ?Math.max(0,Math.min(20,+cfg.broadcastOverviewLabelGap)):2,
      padding=overview?overviewGap:labelPadding(cfg.broadcastLabelDensity||'normal',t.spacing);
    return {
      layout:{
        'text-field':['coalesce',['get','name_en'],['get','name']],
        'text-font':wdFontStack(t.font),
        'text-size':requestedSize,
        'text-transform':t.uppercase?'uppercase':'none',
        'text-letter-spacing':0,
        'text-line-height':1.2,
        'text-max-width':10,
        'text-anchor':'center',
        'text-justify':'center',
        'text-offset':t.dots?[0,-Math.max(0,t.nameOffset)/Math.max(8,requestedSize)]:[0,0],
        'text-padding':padding
      },
      paint:{
        'text-color':t.color,
        'text-opacity':t.opacity,
        'text-halo-color':t.halo,
        'text-halo-width':t.haloWidth,
        'text-halo-blur':t.shadow?1.3:.15
      }
    };
  }
  function settlementLayer(id,cfg,source,types,size,minzoom,rankMode,maxzoom){
    const tier=types.includes('city')?'City':types.includes('town')?'Town':
      types.includes('hamlet')?'Hamlet':'Village',
      style=tierTextStyle(cfg,tier,false),
      layer={id,type:'symbol',source,'source-layer':'place_label',minzoom:+minzoom||0,
        filter:tierFilter(cfg,tier,types,rankMode),
        layout:{
          ...style.layout,
          'symbol-sort-key':['coalesce',['get','symbolrank'],99],
          'text-allow-overlap':false,'text-ignore-placement':false
        },
        paint:{...style.paint}};
    // A major-city fallback MUST NOT increase the user's saved city-size
    // value by 2px (the old behavior caused another zoom-size jump).
    if(maxzoom!=null&&isFinite(+maxzoom))layer.maxzoom=+maxzoom;
    return layer;
  }
  function addLabelDots(map,cfg,source,tier,types,minz,maxz){
    const t=tierAppearance(cfg,tier);
    if(!t.enabled||!t.dots||!source||maxz<=minz)return;
    const layer={id:'wd-'+tier.toLowerCase()+'-dots',type:'circle',source,
      'source-layer':'place_label',minzoom:minz,maxzoom:maxz,
      filter:tierFilter(cfg,tier,types,null),
      paint:{'circle-radius':Math.max(.25,t.dotSize/2),
        'circle-color':t.dotColor,'circle-opacity':t.opacity,
        'circle-stroke-color':t.dotOutline,
        'circle-stroke-width':Math.max(0,t.dotOutlineWidth),
        'circle-blur':t.dotShadow?.35:0}};
    try{map.addLayer(layer);}catch(e){console.warn('WX Studio '+tier+' dots',e);}
  }
  function labelBackground(map,cfg,tier){
    const t=tierAppearance(cfg,tier);
    if(!t.background)return null;
    const id='wd-text-bg-'+tier.toLowerCase()+'-'+String(t.backgroundColor).replace(/[^0-9a-f]/gi,'').toLowerCase();
    if(map.getImage&&map.getImage(id))return id;
    try{
      const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;
      const c=canvas.getContext('2d');if(!c)return null;
      c.fillStyle=t.backgroundColor;c.globalAlpha=.8;
      c.beginPath();c.roundRect(1,1,22,22,4);c.fill();
      map.addImage(id,c.getImageData(0,0,24,24),{
        stretchX:[[8,16]],stretchY:[[8,16]],content:[5,5,19,19],pixelRatio:1});
      return id;
    }catch(e){console.warn('WX Studio label background',e);return null;}
  }
  function applyLabelBackground(map,layerId,cfg,tier){
    const id=labelBackground(map,cfg,tier);
    const layout=id?{'icon-image':id,'icon-text-fit':'both','icon-text-fit-padding':[4,7,4,7]}:
      {'icon-image':'','icon-text-fit':'none'};
    for(const [key,value] of Object.entries(layout))
      try{map.setLayoutProperty(layerId,key,value);}catch(e){}
  }
  // Natural Earth land polygons preserve continent and island coastline shapes
  // without the lakes/ponds that Mapbox Streets merges into its water polygons.
  // Data is loaded once on demand for non-satellite styles; the published
  // Natural Earth dataset is CC0 (public-domain equivalent).
  const FLAT_LAND_URL='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson';
  let flatLandPromise=null, flatLandData=null;
  const flatLandEmpty=()=>({type:'FeatureCollection',features:[]});
  function prepareFlatLand(data){
    if(!data||data.type!=='FeatureCollection'||!Array.isArray(data.features))throw Error('Invalid land geometry');
    return {type:'FeatureCollection',features:data.features.map(f=>{
      const g=f.geometry;if(!g)return f;
      // A hole in Natural Earth land represents an inland lake. For the clean
      // broadcast look, keep only outer rings; leave islands and seas intact.
      const geometry=g.type==='Polygon'?{type:'Polygon',coordinates:g.coordinates.slice(0,1)}:
        g.type==='MultiPolygon'?{type:'MultiPolygon',coordinates:g.coordinates.map(p=>p.slice(0,1))}:g;
      return {type:'Feature',properties:{},geometry};
    })};
  }
  function loadFlatLand(map){
    // The newly added source already starts with cached geometry. Avoid
    // re-parsing the entire world each time a color/checkbox is changed.
    if(flatLandData)return;
    if(!flatLandPromise)flatLandPromise=fetch(FLAT_LAND_URL,{cache:'force-cache'})
      .then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();})
      .then(prepareFlatLand)
      .then(data=>{flatLandData=data;return data;})
      .catch(err=>{console.warn('WX Studio coastlines unavailable',err);flatLandPromise=null;return null;});
    flatLandPromise.then(data=>{
      if(!data)return;
      try{const src=map.getSource('wd-flat-land-data');if(src)src.setData(data);
        MB.cache.clear();if(MB.onUpdate&&!MB.interacting)MB.onUpdate();
      }catch(e){console.warn('WX Studio coastline update',e);}
    });
  }
  /* Ocean coastline is NOT the Mapbox Streets "water" polygon boundary:
   * Streets v8 merges ocean, rivers and every inland lake into one polygon
   * per tile, so drawing its line cannot separate the two groups.
   * Natural Earth 10m coastline is ocean/island shoreline only. Lakes and
   * rivers use independent physical datasets, loaded only if enabled.
   * Shared downloads are cached, keeping globe/map restyles inexpensive. */
  const NATURAL_EARTH_LINES={
    coast:{url:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson',source:'wd-ocean-coast-data'},
    islands:{url:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_minor_islands_coastline.geojson',source:'wd-minor-islands-data'},
    lakes:{url:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson',source:'wd-inland-lakes-data'},
    rivers:{url:'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson',source:'wd-inland-rivers-data'}
  };
  const naturalEarthLineCache={};
  function ensureNaturalEarthLines(map,kind){
    const spec=NATURAL_EARTH_LINES[kind];if(!spec)return null;
    const entry=naturalEarthLineCache[kind]||(naturalEarthLineCache[kind]={data:null,promise:null});
    try{if(!map.getSource(spec.source))map.addSource(spec.source,{type:'geojson',data:entry.data||flatLandEmpty()});}
    catch(e){console.warn('WX Studio natural earth source',kind,e);return null;}
    if(entry.data)return spec.source;
    if(!entry.promise){
      entry.promise=fetch(spec.url,{cache:'force-cache'})
        .then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();})
        .then(data=>{
          if(!data||data.type!=='FeatureCollection'||!Array.isArray(data.features))
            throw Error('Invalid Natural Earth '+kind+' geometry');
          entry.data=data;return data;
        }).catch(e=>{
          entry.promise=null;
          console.warn('WX Studio '+kind+' geometry unavailable',e);
          return null;
        });
    }
    entry.promise.then(data=>{
      if(!data)return;
      try{
        const src=map.getSource(spec.source);
        if(src&&src.setData)src.setData(data);
        MB.cache.clear();
        if(MB.onUpdate&&!MB.interacting)MB.onUpdate();
      }catch(e){console.warn('WX Studio '+kind+' data update',e);}
    });
    return spec.source;
  }

  function installBaseTints(map,cfg,source){
    ['wd-color-base','wd-land-tint','wd-water-tint','wd-coastline-outline','wd-flat-land-fill','wd-flat-coastline',
      'wd-ocean-coastline','wd-minor-island-coastline','wd-inland-lakes-outline','wd-inland-rivers-outline']
      .forEach(id=>{try{if(map.getLayer(id))map.removeLayer(id);}catch(e){}});
    if(!source)return;
    const layers=map.getStyle().layers||[],before=(layers.find(l=>l.type==='symbol')||{}).id;
    const add=l=>{try{before?map.addLayer(l,before):map.addLayer(l);}catch(e){console.warn('WX Studio map base',e);}};
    if(!map.getSource('wd-world-tint'))map.addSource('wd-world-tint',{type:'geojson',data:{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]]]}}]}});
    if(cfg.broadcastBase!=='satellite'){
      const land=cfg.broadcastBase==='dark'?cfg.broadcastDarkColor:cfg.broadcastCustomColor;
      const ocean=cfg.broadcastOceanShow!==false?cfg.broadcastWaterColor:land;
      add({id:'wd-color-base',type:'fill',source:'wd-world-tint',
        paint:{'fill-color':ocean||land||'#151a21','fill-opacity':1}});
      if(!map.getSource('wd-flat-land-data'))map.addSource('wd-flat-land-data',{type:'geojson',data:flatLandData||flatLandEmpty()});
      add({id:'wd-flat-land-fill',type:'fill',source:'wd-flat-land-data',paint:{'fill-color':land||'#151a21','fill-opacity':1}});
      installSeparatedWaterOutlines(map,cfg,add);
      loadFlatLand(map);
      return;
    }
    if(+cfg.broadcastLandTintOpacity>0)
      add({id:'wd-land-tint',type:'fill',source:'wd-world-tint',
        paint:{'fill-color':cfg.broadcastLandColor,'fill-opacity':Math.max(0,Math.min(.6,+cfg.broadcastLandTintOpacity))}});
    if(+cfg.broadcastWaterTintOpacity>0)
      add({id:'wd-water-tint',type:'fill',source,'source-layer':'water',
        paint:{'fill-color':cfg.broadcastWaterColor,'fill-opacity':Math.max(0,Math.min(.8,+cfg.broadcastWaterTintOpacity))}});
    installSeparatedWaterOutlines(map,cfg,add);
  }
  function installSeparatedWaterOutlines(map,cfg,add){
    // Restore coastlines without tracing inland Mapbox water polygons.
    if(cfg.broadcastShowCoastline!==false){
      // Use the SAME explicit coastline color on Satellite, Dark, and Custom
      // Color maps. The previous flat-map special case silently replaced
      // the user's near-black '#050505' default with white '#e0e4eb'.
      const color=cfg.broadcastCoastlineColor||'#050505';
      const width=Math.max(.25,Math.min(8,+cfg.broadcastCoastlineWidth||1.5));
      for(const [kind,id] of [['coast','wd-ocean-coastline'],['islands','wd-minor-island-coastline']]){
        const ocean=ensureNaturalEarthLines(map,kind);
        if(ocean)add({id,type:'line',source:ocean,
          layout:{'line-cap':'round','line-join':'round'},
          paint:{'line-color':color,
            'line-width':width,'line-opacity':1,'line-blur':0}});
      }
    }
    // Deliberately OFF by default: only add inland outlines if enabled.
    // Lakes and rivers have their OWN datasets instead of a merged
    // world-ocean water source. This is independent of water fill colors.
    if(cfg.broadcastInlandWaterOutlines===true){
      const color=cfg.broadcastInlandWaterOutlineColor||'#050505',
        width=Math.max(.25,Math.min(8,+cfg.broadcastInlandWaterOutlineWidth||1));
      for(const [kind,id] of [['lakes','wd-inland-lakes-outline'],
                              ['rivers','wd-inland-rivers-outline']]){
        const src=ensureNaturalEarthLines(map,kind);
        if(src)add({id,type:'line',source:src,
          layout:{'line-cap':'round','line-join':'round'},
          paint:{'line-color':color,'line-width':width,'line-opacity':1,'line-blur':0}});
      }
    }
  }

  function installHillshade(map,cfg){
    try{if(map.getLayer('wd-terrain-hillshade'))map.removeLayer('wd-terrain-hillshade');}catch(e){}
    if(!cfg.terrainHillshadeShow)return;
    try{
      if(!map.getSource('wd-terrain-dem'))map.addSource('wd-terrain-dem',{type:'raster-dem',url:'mapbox://mapbox.mapbox-terrain-dem-v1',tileSize:512,maxzoom:14});
      const firstSymbol=(map.getStyle().layers||[]).find(l=>l.type==='symbol')?.id;
      const layer={id:'wd-terrain-hillshade',type:'hillshade',source:'wd-terrain-dem',
        paint:{
          'hillshade-exaggeration':Math.max(0,Math.min(1,+cfg.terrainHillshadeIntensity||0)),
          'hillshade-shadow-color':cfg.terrainHillshadeShadow||'#000000',
          'hillshade-highlight-color':cfg.terrainHillshadeHighlight||'#ffffff',
          'hillshade-accent-color':cfg.terrainHillshadeAccent||'#000000'
        }};
      firstSymbol?map.addLayer(layer,firstSymbol):map.addLayer(layer);
    }catch(e){console.warn('WX Studio hillshade',e);}
  }
  function applyTerrain(map,cfg){
    try{
      if(cfg.terrain){
        if(!map.getSource('wd-terrain-dem'))map.addSource('wd-terrain-dem',{type:'raster-dem',url:'mapbox://mapbox.mapbox-terrain-dem-v1',tileSize:512,maxzoom:14});
        map.setTerrain({source:'wd-terrain-dem',exaggeration:Math.max(0,Math.min(3,+cfg.terrainExaggeration||1))});
      }else if(map.setTerrain)map.setTerrain(null);
    }catch(e){}
  }

  const UNPAVED_SURFACES=['unpaved','gravel','dirt','earth','ground','sand','grass','compacted','fine_gravel','pebblestone'];
  const classMatch=vals=>['match',['get','class'],vals,true,false];
  const surfaceIsUnpaved=()=>['match',['coalesce',['get','surface'],''],UNPAVED_SURFACES,true,false];

  const TRANSPORT_SPECS=[
    {id:'service',prefix:'roadService',classes:['service','minor','path']},
    {id:'residential',prefix:'roadResidential',classes:['street','street_limited','pedestrian']},
    {id:'local-unpaved',prefix:'roadLocalUnpaved',filter:['any',['all',classMatch(['tertiary','tertiary_link']),surfaceIsUnpaved()],classMatch(['track'])]},
    {id:'local-paved',prefix:'roadLocalPaved',filter:['all',classMatch(['tertiary','tertiary_link']),['match',['coalesce',['get','surface'],''],UNPAVED_SURFACES,false,true]]},
    {id:'county',prefix:'roadCounty',classes:['secondary','secondary_link']},
    {id:'state',prefix:'roadState',classes:['primary','primary_link']},
    {id:'major',prefix:'roadMajor',classes:['trunk','trunk_link']},
    {id:'interstate',prefix:'roadInterstate',classes:['motorway','motorway_link']}
  ];

  function removeTransportationLayers(map){
    const ids=[];
    for(const s of TRANSPORT_SPECS){ids.push('wd-road-'+s.id+'-casing','wd-road-'+s.id);}
    ids.push('wd-airport-runways');
    ids.forEach(id=>{try{if(map.getLayer(id))map.removeLayer(id);}catch(e){}});
  }

  function transportValue(cfg,prefix,suffix,fallback){
    const v=cfg[prefix+suffix]; return v==null?fallback:v;
  }

  function removeLandWaterFeatureLayers(map){
    ['wd-water-depth','wd-national-parks','wd-building-footprints','wd-building-3d'].forEach(id=>{try{if(map.getLayer(id))map.removeLayer(id);}catch(e){}});
  }

  function installLandWaterFeatures(map,cfg,source){
    removeLandWaterFeatureLayers(map);
    if(!source)return;
    const layers=map.getStyle().layers||[], before=(layers.find(l=>l.type==='symbol')||{}).id;
    const add=l=>{try{before?map.addLayer(l,before):map.addLayer(l);}catch(e){}};

    if(cfg.broadcastBase==='satellite'&&cfg.showWaterDepth){
      try{
        if(!map.getSource('wd-bathymetry'))map.addSource('wd-bathymetry',{type:'vector',url:'mapbox://mapbox.mapbox-bathymetry-v2'});
        add({id:'wd-water-depth',type:'fill',source:'wd-bathymetry','source-layer':'depth',
          minzoom:Math.max(0,+cfg.waterDepthMinZoom||0),maxzoom:Math.max((+cfg.waterDepthMinZoom||0)+.01,+cfg.waterDepthMaxZoom||24),
          paint:{'fill-color':cfg.waterDepthColor||'#000000',
            'fill-opacity':['interpolate',['linear'],['coalesce',['get','min_depth'],0],0,.04,200,.08,1000,.14,3000,.22,6000,.30]}});
      }catch(e){}
    }

    if(cfg.broadcastBase==='satellite'&&cfg.showNationalParks){
      add({id:'wd-national-parks',type:'fill',source,'source-layer':'landuse_overlay',
        minzoom:Math.max(0,+cfg.nationalParkMinZoom||0),maxzoom:Math.max((+cfg.nationalParkMinZoom||0)+.01,+cfg.nationalParkMaxZoom||24),
        filter:['==',['get','class'],'national_park'],
        paint:{'fill-color':cfg.nationalParkColor||'#252525','fill-opacity':.55}});
    }

    if(cfg.broadcastBase==='satellite'&&cfg.showBuildingFootprints){
      add({id:'wd-building-footprints',type:'fill',source,'source-layer':'building',minzoom:13,maxzoom:24,
        paint:{'fill-color':cfg.buildingFootprintColor||'#242424','fill-opacity':.72}});
    }

    if(cfg.broadcastBase==='satellite'&&cfg.show3DBuildings){
      const mult=Math.max(0,Math.min(3,+cfg.building3DHeight||1));
      add({id:'wd-building-3d',type:'fill-extrusion',source,'source-layer':'building',minzoom:13,
        filter:['==',['get','extrude'],true],
        paint:{
          'fill-extrusion-color':cfg.buildingFootprintColor||'#242424',
          'fill-extrusion-height':['*',['coalesce',['get','height'],8],mult],
          'fill-extrusion-base':['*',['coalesce',['get','min_height'],0],mult],
          'fill-extrusion-opacity':.82
        }});
    }
  }

  function installTransportation(map,cfg,source){
    removeTransportationLayers(map);
    if(!source)return;
    const layers=map.getStyle().layers||[], before=(layers.find(l=>l.type==='symbol')||{}).id;
    const add=l=>{try{before?map.addLayer(l,before):map.addLayer(l);}catch(e){}};

    if(cfg.broadcastBase==='satellite'&&cfg.broadcastShowRoads!==false){
      for(const spec of TRANSPORT_SPECS){
        const p=spec.prefix, show=transportValue(cfg,p,'Show',true); if(!show)continue;
        const width=Math.max(.05,+transportValue(cfg,p,'Width',1)||1), opacity=Math.max(0,Math.min(1,+transportValue(cfg,p,'Opacity',1))),
          color=transportValue(cfg,p,'Color','#888888'), minz=Math.max(0,+transportValue(cfg,p,'MinZoom',0)||0), maxz=Math.max(minz+.01,+transportValue(cfg,p,'MaxZoom',22)||22),
          filter=spec.filter||classMatch(spec.classes||[]);
        const outline=!!transportValue(cfg,p,'Outline',false), ow=Math.max(0,+transportValue(cfg,p,'OutlineWidth',0)||0);
        if(outline&&ow>0){
          add({id:'wd-road-'+spec.id+'-casing',type:'line',source,'source-layer':'road',minzoom:minz,maxzoom:maxz,filter,
            layout:{'line-cap':'round','line-join':'round'},
            paint:{'line-color':transportValue(cfg,p,'OutlineColor','#000000'),'line-width':width+ow*2,'line-opacity':1}});
        }
        add({id:'wd-road-'+spec.id,type:'line',source,'source-layer':'road',minzoom:minz,maxzoom:maxz,filter,
          layout:{'line-cap':'round','line-join':'round'},
          paint:{'line-color':color,'line-width':width,'line-opacity':opacity}});
      }
    }

    try{if(map.getLayer('wd-waterways'))map.removeLayer('wd-waterways');}catch(e){}
    if(cfg.broadcastBase==='satellite'&&cfg.waterwaysShow){
      add({id:'wd-waterways',type:'line',source,'source-layer':'waterway',
        minzoom:Math.max(0,+cfg.waterwaysMinZoom||0),maxzoom:Math.max((+cfg.waterwaysMinZoom||0)+.01,+cfg.waterwaysMaxZoom||24),
        layout:{'line-join':'round','line-cap':'round'},
        paint:{'line-color':cfg.waterwaysColor,'line-width':Math.max(.1,+cfg.waterwaysWidth||.7),'line-opacity':Math.max(0,Math.min(1,+cfg.waterwaysOpacity))}});
    }
    if(cfg.broadcastBase==='satellite'&&cfg.airportRunwaysShow!==false){
      const minz=Math.max(0,+cfg.airportRunwaysMinZoom||0),maxz=Math.max(minz+.01,+cfg.airportRunwaysMaxZoom||24);
      add({id:'wd-airport-runways',type:'line',source,'source-layer':'aeroway',minzoom:minz,maxzoom:maxz,
        filter:['any',['==',['get','type'],'runway'],['==',['get','class'],'runway']],
        layout:{'line-cap':'round','line-join':'round'},
        paint:{'line-color':cfg.airportRunwaysColor||'#b3b3b3','line-width':Math.max(.05,+cfg.airportRunwaysWidth||.6),'line-opacity':1}});
    }
  }

  const NWS_REF='https://mapservices.weather.noaa.gov/static/rest/services/nws_reference_maps/nws_reference_map/MapServer';
  const TZ_QUERY='https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_Time_Zones/FeatureServer/0/query?where=1%3D1&outFields=zone&returnGeometry=true&outSR=4326&f=geojson';
  const emptyFC=()=>({type:'FeatureCollection',features:[]});
  let overlayRefreshTimer=null, activeOverlayCfg=null, oceanWaterTilesChanged=false;

  function lineDash(type){
    return type==='dashed'?[4,3]:type==='dotted'?[1,2]:[1,0];
  }
  function removeOverlayLayers(map){
    ['wd-day-night','wd-nws-cwa','wd-nws-public','wd-nws-fire','wd-nws-marine','wd-time-zones','wd-latlon-grid'].forEach(id=>{try{if(map.getLayer(id))map.removeLayer(id);}catch(e){}});
  }
  function ensureGeoSource(map,id,data){
    try{
      if(!map.getSource(id))map.addSource(id,{type:'geojson',data:data||emptyFC()});
      else if(data)map.getSource(id).setData(data);
      return map.getSource(id);
    }catch(e){return null;}
  }
  function addOverlayLine(map,id,source,color,width,opacity,minz,maxz,lineType){
    const before=(map.getStyle().layers||[]).find(l=>l.type==='symbol')?.id;
    const layer={id,type:'line',source,minzoom:+minz||0,maxzoom:Math.max((+minz||0)+.01,+maxz||24),
      layout:{'line-cap':'round','line-join':'round'},
      paint:{'line-color':color,'line-width':Math.max(.1,+width||1),'line-opacity':Math.max(0,Math.min(1,+opacity||0))}};
    const d=lineDash(lineType); if(!(d[0]===1&&d[1]===0))layer.paint['line-dasharray']=d;
    try{before?map.addLayer(layer,before):map.addLayer(layer);}catch(e){}
  }

  function nwsGeoUrl(layer,map){
    const b=map.getBounds(),padLng=Math.max(.5,(b.getEast()-b.getWest())*.15),padLat=Math.max(.5,(b.getNorth()-b.getSouth())*.15);
    const xmin=Math.max(-180,b.getWest()-padLng),ymin=Math.max(-90,b.getSouth()-padLat),xmax=Math.min(180,b.getEast()+padLng),ymax=Math.min(90,b.getNorth()+padLat);
    const geom=[xmin,ymin,xmax,ymax].join(',');
    return NWS_REF+'/'+layer+'/query?where=1%3D1&outFields=*&returnGeometry=true&geometryType=esriGeometryEnvelope&geometry='+encodeURIComponent(geom)+'&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&f=geojson';
  }
  async function fetchOverlayGeo(id,url,map){
    try{
      const r=await fetch(url,{cache:'force-cache'}); if(!r.ok)throw new Error('HTTP '+r.status);
      const data=await r.json(); if(data&&data.type==='FeatureCollection'&&map.getSource(id))map.getSource(id).setData(data);
    }catch(e){console.warn('WX Studio overlay '+id,e);}
  }

  function gridSpacing(cfg,map){
    if(!cfg.overlayLatLonAutoSpacing)return Math.max(.5,Math.min(30,+cfg.overlayLatLonManualSpacing||5));
    const z=map.getZoom();
    if(z<2.5)return 30;if(z<4)return 15;if(z<5.5)return 10;if(z<7)return 5;if(z<8.5)return 2;if(z<10)return 1;return .5;
  }
  // Intersect a parallel or meridian with Mapbox Streets water polygons.
  // Outer rings add water; interior rings (islands) remove it. This keeps
  // ocean-mode lines off land without painting over the satellite basemap.
  function waterGridIntervals(water,coord,meridian,low,high){
    const events=[],axis=meridian?0:1,other=meridian?1:0;
    for(const feat of water){
      const geom=feat.geometry||{};
      const polygons=geom.type==='Polygon'?[geom.coordinates]:geom.type==='MultiPolygon'?geom.coordinates:[];
      for(const polygon of polygons)for(let ri=0;ri<polygon.length;ri++){
        const ring=polygon[ri],cuts=[];
        for(let j=0;j<ring.length;j++){
          const a=ring[j],b=ring[(j+1)%ring.length],p=a[axis],q=b[axis];
          if((p<=coord&&q>coord)||(q<=coord&&p>coord))
            cuts.push(a[other]+(coord-p)*(b[other]-a[other])/(q-p));
        }
        cuts.sort((a,b)=>a-b);
        const sign=ri===0?1:-1;
        for(let i=0;i+1<cuts.length;i+=2)events.push([cuts[i],sign],[cuts[i+1],-sign]);
      }
    }
    events.sort((a,b)=>a[0]-b[0]);
    const intervals=[];let count=0,last=null;
    for(const [at,delta] of events){
      if(last!==null&&count>0){
        const a=Math.max(low,last),b=Math.min(high,at);
        if(b-a>1e-7)intervals.push([a,b]);
      }
      count+=delta;last=at;
    }
    return intervals;
  }
  function gridGeoJSON(cfg,map){
    if(cfg.overlayLatLonMode==='off')return emptyFC();
    const s=gridSpacing(cfg,map),features=[];
    if(cfg.overlayLatLonMode==='ocean'){
      // Query the loaded, viewport-local Streets water tiles. The source-data
      // listener below recalculates if the tiles are still loading.
      let water=[];
      try{
        const source=streetsSource(map);
        if(source)water=map.querySourceFeatures(source,{sourceLayer:'water'});
      }catch(e){}
      if(!water.length)return emptyFC();
      const bounds=map.getBounds(),
        west=Math.max(-180,bounds.getWest()-s),east=Math.min(180,bounds.getEast()+s),
        south=Math.max(-80,bounds.getSouth()-s),north=Math.min(80,bounds.getNorth()+s);
      for(let lon=Math.ceil(west/s)*s;lon<=east;lon+=s)
        for(const [a,b] of waterGridIntervals(water,lon,true,south,north))
          features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[lon,a],[lon,b]]}});
      for(let lat=Math.ceil(south/s)*s;lat<=north;lat+=s)
        for(const [a,b] of waterGridIntervals(water,lat,false,west,east))
          features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[a,lat],[b,lat]]}});
      return {type:'FeatureCollection',features};
    }
    for(let lon=Math.ceil(-180/s)*s;lon<=180;lon+=s)features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[lon,-85],[lon,85]]}});
    for(let lat=Math.ceil(-80/s)*s;lat<=80;lat+=s)features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[-180,lat],[180,lat]]}});
    return {type:'FeatureCollection',features};
  }
  function nightGeoJSON(){
    const now=new Date(),start=Date.UTC(now.getUTCFullYear(),0,0),day=(now-start)/86400000;
    const decl=23.44*Math.sin((2*Math.PI/365)*(day-81))*Math.PI/180;
    const h=now.getUTCHours()+now.getUTCMinutes()/60+now.getUTCSeconds()/3600;
    const subLon=180-h*15,coords=[];
    for(let lon=-180;lon<=180;lon+=2){
      const dl=(lon-subLon)*Math.PI/180;
      let lat;
      if(Math.abs(Math.tan(decl))<1e-5)lat=Math.cos(dl)>0?-89:89;
      else lat=Math.atan(-Math.cos(dl)/Math.tan(decl))*180/Math.PI;
      coords.push([lon,Math.max(-89,Math.min(89,lat))]);
    }
    const pole=decl>=0?-89:89;
    coords.push([180,pole],[-180,pole],coords[0]);
    return {type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[coords]}}]};
  }

  function installOverlays(map,cfg){
    removeOverlayLayers(map); activeOverlayCfg=cfg;
    const addNws=(show,id,layer,color,width,opacity,minz,maxz,lineType)=>{
      if(!show)return;
      ensureGeoSource(map,id,emptyFC());addOverlayLine(map,id,id,color,width,opacity,minz,maxz,lineType);
      fetchOverlayGeo(id,nwsGeoUrl(layer,map),map);
    };
    addNws(cfg.overlayCWA,'wd-nws-cwa',1,cfg.overlayCWAColor,cfg.overlayCWAWidth,cfg.overlayCWAOpacity,cfg.overlayCWAMinZoom,cfg.overlayCWAMaxZoom,cfg.overlayCWALineType);
    addNws(cfg.overlayPublicZones,'wd-nws-public',8,cfg.overlayPublicZonesColor,cfg.overlayPublicZonesWidth,cfg.overlayPublicZonesOpacity,cfg.overlayPublicZonesMinZoom,cfg.overlayPublicZonesMaxZoom,cfg.overlayPublicZonesLineType);
    addNws(cfg.overlayFireZones,'wd-nws-fire',9,cfg.overlayFireZonesColor,cfg.overlayFireZonesWidth,cfg.overlayFireZonesOpacity,cfg.overlayFireZonesMinZoom,cfg.overlayFireZonesMaxZoom,cfg.overlayFireZonesLineType);
    addNws(cfg.overlayMarineZones,'wd-nws-marine',5,cfg.overlayMarineZonesColor,cfg.overlayMarineZonesWidth,cfg.overlayMarineZonesOpacity,cfg.overlayMarineZonesMinZoom,cfg.overlayMarineZonesMaxZoom,cfg.overlayMarineZonesLineType);

    if(cfg.overlayTimeZones){
      ensureGeoSource(map,'wd-time-zones',TZ_QUERY);
      addOverlayLine(map,'wd-time-zones','wd-time-zones',cfg.overlayTimeZonesColor,cfg.overlayTimeZonesWidth,cfg.overlayTimeZonesOpacity,cfg.overlayTimeZonesMinZoom,cfg.overlayTimeZonesMaxZoom,cfg.overlayTimeZonesLineType);
    }
    if(cfg.overlayLatLonMode!=='off'){
      ensureGeoSource(map,'wd-latlon-grid',gridGeoJSON(cfg,map));
      addOverlayLine(map,'wd-latlon-grid','wd-latlon-grid',cfg.overlayLatLonColor,cfg.overlayLatLonWidth,cfg.overlayLatLonOpacity,0,24,'solid');
    }
    if(cfg.overlayDayNight){
      ensureGeoSource(map,'wd-day-night',nightGeoJSON());
      const before=(map.getStyle().layers||[]).find(l=>l.type==='symbol')?.id;
      const layer={id:'wd-day-night',type:'fill',source:'wd-day-night',paint:{'fill-color':'#07101f','fill-opacity':.28}};
      try{before?map.addLayer(layer,before):map.addLayer(layer);}catch(e){}
    }
  }

  function refreshDynamicOverlays(map){
    const cfg=activeOverlayCfg;if(!cfg||!map)return;
    clearTimeout(overlayRefreshTimer);overlayRefreshTimer=setTimeout(()=>{
      const tasks=[
        [cfg.overlayCWA,'wd-nws-cwa',1],[cfg.overlayPublicZones,'wd-nws-public',8],
        [cfg.overlayFireZones,'wd-nws-fire',9],[cfg.overlayMarineZones,'wd-nws-marine',5]
      ];
      tasks.forEach(([show,id,layer])=>{if(show&&map.getSource(id))fetchOverlayGeo(id,nwsGeoUrl(layer,map),map);});
      if(cfg.overlayLatLonMode!=='off'&&map.getSource('wd-latlon-grid')){
        map.getSource('wd-latlon-grid').setData(gridGeoJSON(cfg,map));
        if(cfg.overlayLatLonMode==='ocean'&&oceanWaterTilesChanged){
          oceanWaterTilesChanged=false;
          MB.cache.clear();
          if(MB.onUpdate&&!MB.interacting)MB.onUpdate();
        }
      }
      if(cfg.overlayDayNight&&map.getSource('wd-day-night'))map.getSource('wd-day-night').setData(nightGeoJSON());
    },220);
  }

  function addBroadcastCartography(map,cfg){
    if(!map||cfg.mbStyle!=='broadcast')return;
    const layers=map.getStyle().layers||[];
    // The classic Mapbox Streets/Satellite Streets styles already provide
    // carefully tested overview settlement-major/minor symbol layers.
    // Our homegrown place_label filter can be empty at zoom 6 even when
    // matching tiles exist. Keep Mapbox's native overview placement below
    // 7.5 and use WX Studio's customizable layers at closer zooms.
    const cityMinForOverview=Math.max(0,Number.isFinite(+cfg.broadcastCityMinZoom)?+cfg.broadcastCityMinZoom:3);
    const majorMinForOverview=Math.max(0,Number.isFinite(+cfg.broadcastMajorCityMinZoom)?+cfg.broadcastMajorCityMinZoom:0);
    const cityMaxForOverview=Math.max(.01,Number.isFinite(+cfg.broadcastCityMaxZoom)?+cfg.broadcastCityMaxZoom:24);
    const nativeOverviewEnd=Math.min(7.5,cityMaxForOverview);
    const overviewIsMajor=l=>l.type==='symbol'&&l['source-layer']==='place_label'&&/settlement[-_].*major/i.test(l.id||'');
    const overviewIsMinor=l=>l.type==='symbol'&&l['source-layer']==='place_label'&&/settlement[-_].*minor/i.test(l.id||'');
    const hasNativeOverview=layers.some(overviewIsMajor);
    const nativeMajorStart=cfg.broadcastKeepMajorCities!==false
      ?Math.min(cityMinForOverview,majorMinForOverview):cityMinForOverview;
    const nativeTownStart=Math.max(0,Number.isFinite(+cfg.broadcastTownMinZoom)?+cfg.broadcastTownMinZoom:5);
    const nativeOverviewEnabled=hasNativeOverview&&cfg.broadcastShowCities!==false;
    // Streets v8 ranks every available settlement. The stock native
    // settlement layers can be much too selective under zoom 6. Use our own
    // adjustable rank filter while preserving the native layer placement
    // (no forced text overlap) and all of WX Studio's font/size styling.
    const overviewDensity=['standard','more','many'].includes(cfg.broadcastOverviewCityDensity)
      ?cfg.broadcastOverviewCityDensity:'more';
    const rankBase=Math.max(1,Math.min(19,Number.isFinite(+cfg.broadcastMajorCityRank)
      ?+cfg.broadcastMajorCityRank:9));
    const rankCap=overviewDensity==='many'?19:
      Math.min(19,rankBase+(overviewDensity==='more'?5:0));
    const townRank=cfg.broadcastLabelDensity==='sparse'?1:
      cfg.broadcastLabelDensity==='normal'?3:
      cfg.broadcastLabelDensity==='dense'?4:5;
    // Never replace Mapbox's known-good settlement filters wholesale:
    // doing so in v0.9.52 made ALL cities disappear around zoom 6.
    // Preserve the untouched stock style filter as a baseline, then OR in
    // additional eligible settlement features requested by the user.
    // Mapbox's native placement remains in charge of text collisions.
    const nativeOverviewFilter=(original,major)=>{
      const appearance=tierAppearance(cfg,major?'City':'Town');
      const scaledRank=Math.max(1,Math.min(19,Math.round(rankCap*
        (appearance.pct/(major?60:40)))));
      const extras=major
        ?['all',['match',['get','class'],['settlement','disputed_settlement'],true,false],
            ['==',['get','type'],'city'],
            ['<=',['coalesce',['get','symbolrank'],99],scaledRank]]
        :['all',['match',['get','class'],['settlement','disputed_settlement'],true,false],
            ['==',['get','type'],'town'],
            ['<=',['coalesce',['get','filterrank'],5],
              Math.max(1,Math.min(5,Math.ceil(
                (overviewDensity==='standard'?townRank:
                 overviewDensity==='more'?Math.max(4,townRank):5)*
                 (appearance.pct/40))))]];
      const combined=original?['any',original,extras]:extras;
      if(appearance.population!=='all')
        return ['all',combined,['<=',['coalesce',['get','symbolrank'],99],
          appearance.population==='top'?4:9]];
      return combined;
    };
    const nativeOverviewRange=(l)=>{
      const major=overviewIsMajor(l),minor=overviewIsMinor(l);
      if(!nativeOverviewEnabled||(!major&&!minor))return null;
      const appearance=tierAppearance(cfg,major?'City':'Town');
      if(!appearance.enabled||appearance.pct<=0)return null;
      const min=major?nativeMajorStart:nativeTownStart;
      return nativeOverviewEnd>min?{min,max:nativeOverviewEnd,major}:null;
    };
    if(!map.__wdOriginalZoomRanges)map.__wdOriginalZoomRanges={};
    if(!map.__wdOriginalRasterVisibility)map.__wdOriginalRasterVisibility={};
    if(!map.__wdOriginalOverviewFilters)map.__wdOriginalOverviewFilters={};
    // Mapbox's "major" and "minor" layers are split by SYMBOLRANK, not
    // by CITY versus TOWN. Both contain both feature types. First preserve
    // the original filters of BOTH native rank layers, then route features
    // to a SINGLE layer by actual Streets v8 feature.type:
    //   city -> City settings; town -> Town settings.
    // Otherwise a prominent town is drawn using City typography at z7,
    // and Town typography at z8, even if the user never changed settings.
    const originalOverviewLayers=layers.filter(l=>overviewIsMajor(l)||overviewIsMinor(l));
    for(const l of originalOverviewLayers){
      if(!Object.prototype.hasOwnProperty.call(map.__wdOriginalOverviewFilters,l.id))
        map.__wdOriginalOverviewFilters[l.id]=l.filter
          ?JSON.parse(JSON.stringify(l.filter)):null;
    }
    const nativeStockUnion=layer=>{
      const matching=originalOverviewLayers.filter(l=>l.source===layer.source)
        .map(l=>map.__wdOriginalOverviewFilters[l.id]);
      // A native layer with no filter legitimately accepts all places.
      if(!matching.length||matching.some(f=>f==null))return null;
      return matching.length===1?matching[0]:['any',...matching];
    };
    for(const l of layers){
      const id=String(l.id||'').toLowerCase(),sl=String(l['source-layer']||'').toLowerCase(); if(id.startsWith('wd-'))continue;
      try{
        if(l.type==='symbol'){
          const adminPlace=sl==='place_label'&&(id.includes('state')||id.includes('province')||id.includes('country')||id.includes('continent')||id.includes('region'));
          const place=sl==='place_label'||id.includes('settlement')||id.includes('place-label');
          const shield=id.includes('road-number')||id.includes('road-shield')||id.includes('shield');
          const roadLabel=sl==='road'||id.includes('road-label')||shield;
          const poi=sl==='poi_label'||id.includes('poi'),natural=sl==='natural_label'||id.includes('natural')||id.includes('water-label');
          if(adminPlace||place){
            const overview=nativeOverviewRange(l);
            if(overview){
              // Keep the native zoom-aware feature selection and collision
              // logic so major city names do not disappear at zoom 6.
              // But ALWAYS use WX Studio typography (not Mapbox's stock
              // small fonts/sizes below zoom 7.5). Both native and custom
              // labels must honor the same user settings at every zoom.
              try{map.setLayerZoomRange(l.id,overview.min,overview.max);}catch(e){}
              map.setLayoutProperty(l.id,'visibility','visible');
              const kind=overview.major?'city':'town',
                original=nativeStockUnion(l);
              // Use the combined ORIGINAL major+minor rank selection so a
              // city originally in Mapbox's minor layer is not lost, and a
              // town originally in major is reassigned to Town typography.
              // Supplemental density rules only ADD candidates.
              try{
                map.setFilter(l.id,[
                  'all',
                  ['match',['get','class'],['settlement','disputed_settlement'],true,false],
                  ['==',['get','type'],kind],
                  nativeOverviewFilter(original,overview.major)
                ]);
              }catch(e){
                console.warn('WX Studio type-based overview label filter',l.id,e);
                // Safety fallback STILL filters by place type; restoring the
                // original major filter here would recreate mixed fonts.
                try{map.setFilter(l.id,[
                  'all',
                  ['match',['get','class'],['settlement','disputed_settlement'],true,false],
                  ['==',['get','type'],kind]
                ]);}catch(ignore){}
              }
              // Preserve original symbol-sort-key and placement/collision
              // priority so Mapbox's major-city coverage remains reliable.
              // Apply IDENTICAL tier text formatting at all zooms.
              const tier=overview.major?'City':'Town',
                textStyle=tierTextStyle(cfg,tier,true);
              for(const [property,value] of Object.entries(textStyle.layout)){
                try{map.setLayoutProperty(l.id,property,value);}catch(e){
                  console.warn('WX Studio overview label typography',property,e);
                }
              }
              for(const [property,value] of Object.entries(textStyle.paint)){
                try{map.setPaintProperty(l.id,property,value);}catch(e){
                  console.warn('WX Studio overview label paint',property,e);
                }
              }
              applyLabelBackground(map,l.id,cfg,tier);
            }else map.setLayoutProperty(l.id,'visibility','none');
          }
          else if(roadLabel){
            const vis=cfg.broadcastBase==='satellite'&&(shield?!!cfg.broadcastShowRoadShields:!!cfg.broadcastShowRoadLabels);
            map.setLayoutProperty(l.id,'visibility',vis?'visible':'none');
            if(!map.__wdOriginalZoomRanges[l.id])map.__wdOriginalZoomRanges[l.id]={min:+l.minzoom||0,max:l.maxzoom==null?24:+l.maxzoom};
            const zr=map.__wdOriginalZoomRanges[l.id],
              min=shield?Math.max(0,+cfg.broadcastRoadShieldMinZoom||7):Math.max(0,+cfg.broadcastRoadLabelMinZoom||3),
              requestedMax=shield?(+cfg.broadcastRoadShieldMaxZoom||24):(+cfg.broadcastRoadLabelMaxZoom||16),
              mx=Math.max(min+.5,requestedMax);
            try{map.setLayerZoomRange(l.id,Math.max(zr.min,min),Math.max(Math.max(zr.min,min)+.01,Math.min(zr.max,mx)));}catch(e){}
            if(vis&&shield){const d=Math.max(1,Math.min(5,+cfg.broadcastRoadShieldDensity||3)),sp=[900,700,520,350,220][d-1],sz=Math.max(.6,Math.min(2,+cfg.broadcastRoadShieldSize||1));try{map.setLayoutProperty(l.id,'symbol-spacing',sp);}catch(e){}try{map.setLayoutProperty(l.id,'icon-size',sz);}catch(e){}}
            else if(vis&&!shield){try{map.setLayoutProperty(l.id,'text-font',wdFontStack(cfg.broadcastLabelFont));}catch(e){}try{map.setPaintProperty(l.id,'text-color',cfg.broadcastLabelColor);}catch(e){}try{map.setPaintProperty(l.id,'text-halo-color',cfg.broadcastLabelHaloColor);}catch(e){}}
          }else if(poi)map.setLayoutProperty(l.id,'visibility',cfg.broadcastBase==='satellite'&&cfg.broadcastShowPOI?'visible':'none');
          else if(natural)map.setLayoutProperty(l.id,'visibility',cfg.broadcastBase==='satellite'&&cfg.broadcastShowNaturalLabels?'visible':'none');
          else map.setLayoutProperty(l.id,'visibility','none');
        }else if(l.type==='line'){
          const road=sl==='road'||id.includes('road')||id.includes('street')||id.includes('motorway'),aeroway=sl==='aeroway'||id.includes('runway')||id.includes('taxiway')||id.includes('aeroway'),boundary=sl==='admin'||id.includes('boundary')||id.includes('admin');
          if(road||aeroway){
            map.setLayoutProperty(l.id,'visibility','none');
          }else if(boundary){
            // Hide Mapbox's stock dashed admin strokes. WX Studio now
            // draws country/state/county ONCE with solid lines below.
            // This removes duplicate borders, dash artifacts and mixed alpha.
            map.setLayoutProperty(l.id,'visibility','none');
          }else if(sl==='water'||sl==='waterway'){
            // Suppress native Streets water outlines: these trace merged
            // ocean/lake/river shapes regardless of the inland-water toggle.
            // The dedicated ocean and optional inland layers above replace
            // these. Water fill polygons and user waterways styling stay.
            map.setLayoutProperty(l.id,'visibility','none');
          }
        }else if(cfg.broadcastBase!=='satellite'&&
          ((l.type==='fill'&&['water','waterway','landuse','landuse_overlay'].includes(sl))||
           (l.type==='line'&&['waterway','road','aeroway'].includes(sl)))){
          map.setLayoutProperty(l.id,'visibility','none');
        }else if((l.type==='fill'||l.type==='fill-extrusion')&&(sl==='building'||id.includes('building'))){
          try{map.setLayoutProperty(l.id,'visibility','none');}catch(e){}
        }else if(l.type==='fill'&&(sl==='aeroway'||id.includes('runway')||id.includes('taxiway')||id.includes('aeroway'))){
          try{map.setLayoutProperty(l.id,'visibility','none');}catch(e){}
        }else if(l.type==='raster'){
          if(!Object.prototype.hasOwnProperty.call(map.__wdOriginalRasterVisibility,l.id))
            map.__wdOriginalRasterVisibility[l.id]=l.layout?.visibility||'visible';
          map.setLayoutProperty(l.id,'visibility',
            cfg.broadcastBase==='satellite'?map.__wdOriginalRasterVisibility[l.id]:'none');
          if(cfg.broadcastBase==='satellite'){
            try{map.setPaintProperty(l.id,'raster-saturation',+cfg.broadcastSatelliteSaturation||0);}catch(e){}
            try{map.setPaintProperty(l.id,'raster-contrast',+cfg.broadcastSatelliteContrast||0);}catch(e){}
            try{map.setPaintProperty(l.id,'raster-brightness-min',Math.max(0,Math.min(1,+cfg.broadcastSatelliteShadowLift||0)));}catch(e){}
            try{map.setPaintProperty(l.id,'raster-brightness-max',Math.max(.01,Math.min(1,+cfg.broadcastSatelliteHighlightCeiling||1)));}catch(e){}
          }
        }
      }catch(e){}
    }
    const source=streetsSource(map);installBaseTints(map,cfg,source);
    // One source and one solid, antialiased stroke per admin level. Admin
    // levels are 0=country, 1=state/province and 2=county on Streets v8.
    // Explicit full opacity avoids the thin washed-out/dashed appearance.
    for(const id of ['wd-admin-country','wd-admin-state','wd-admin-county','wd-county-boundaries']){
      try{if(map.getLayer(id))map.removeLayer(id);}catch(e){}
    }
    if(source){
      const label=(map.getStyle().layers||[]).find(l=>l.type==='symbol')?.id;
      const layers=[
        ['country',0,cfg.broadcastShowCountryBorders!==false,cfg.broadcastCountryColor,cfg.broadcastCountryWidth,0],
        ['state',1,cfg.broadcastShowStateBorders!==false,cfg.broadcastStateColor,cfg.broadcastStateWidth,0],
        ['county',2,!!cfg.broadcastShowCountyBorders,cfg.broadcastCountyColor,cfg.broadcastCountyWidth,
          cfg.broadcastCountyMinZoom==null?6:+cfg.broadcastCountyMinZoom]
      ];
      for(const [name,level,enabled,color,width,minZoom] of layers){
        if(!enabled)continue;
        const minz=Math.max(0,Math.min(22,Number.isFinite(minZoom)?minZoom:0));
        const layer={id:'wd-admin-'+name,type:'line',source,'source-layer':'admin',
          minzoom:minz,maxzoom:24,
          filter:['all',['==',['get','admin_level'],level],['!=',['get','maritime'],'true']],
          layout:{'line-cap':'round','line-join':'round','visibility':'visible'},
          paint:{'line-color':color||'#e0e4eb',
            'line-width':Math.max(.25,Math.min(8,+width||1)),
            'line-opacity':1,'line-blur':0}
        };
        try{label?map.addLayer(layer,label):map.addLayer(layer);}
        catch(e){console.warn('WX Studio '+name+' boundary',e);}
      }
    }
    installHillshade(map,cfg);installLandWaterFeatures(map,cfg,source);installTransportation(map,cfg,source);installOverlays(map,cfg);
    ['wd-major-city-labels','wd-city-labels','wd-town-labels','wd-small-place-labels',
      'wd-city-dots','wd-town-dots','wd-village-dots','wd-hamlet-dots',
      'wd-hamlet-labels'].forEach(id=>{
      try{if(map.getLayer(id))map.removeLayer(id);}catch{}
    });
    if(source&&cfg.broadcastShowCities!==false){
      const minZoom=(value,fallback)=>Math.max(0,Math.min(23.99,Number.isFinite(+value)?+value:fallback));
      const maxZoom=(value,min)=>Math.max(min+.01,Math.min(24,Number.isFinite(+value)?+value:24));
      const cityMin=minZoom(cfg.broadcastCityMinZoom,3),cityMax=maxZoom(cfg.broadcastCityMaxZoom,cityMin);
      const townMin=minZoom(cfg.broadcastTownMinZoom,5),townMax=maxZoom(cfg.broadcastTownMaxZoom,townMin);
      const villageMin=minZoom(cfg.broadcastVillageMinZoom,6),villageMax=maxZoom(cfg.broadcastVillageMaxZoom,villageMin);
      const hamletMin=minZoom(cfg.broadcastHamletMinZoom,8),hamletMax=maxZoom(cfg.broadcastHamletMaxZoom,hamletMin);
      const majorMin=minZoom(cfg.broadcastMajorCityMinZoom,0);
      const customCityMin=nativeOverviewEnabled?Math.max(cityMin,nativeOverviewEnd):cityMin;
      const customTownMin=nativeOverviewEnabled?Math.max(townMin,nativeOverviewEnd):townMin;
      const add=(layer,tier)=>{
        try{
          map.addLayer(layer);
          applyLabelBackground(map,layer.id,cfg,tier);
        }catch(e){console.warn('WX Studio label layer',layer.id,e);}
      };
      // Dots share each tier's filter, coordinates and configured zoom range.
      addLabelDots(map,cfg,source,'City',['city'],majorMin,cityMax);
      addLabelDots(map,cfg,source,'Town',['town'],townMin,townMax);
      addLabelDots(map,cfg,source,'Village',['village'],villageMin,villageMax);
      addLabelDots(map,cfg,source,'Hamlet',['hamlet'],hamletMin,hamletMax);
      if(tierAppearance(cfg,'Village').enabled)
        add(settlementLayer('wd-small-place-labels',cfg,source,['village'],
          cfg.broadcastVillageSize,villageMin,null,villageMax),'Village');
      if(tierAppearance(cfg,'Hamlet').enabled)
        add(settlementLayer('wd-hamlet-labels',cfg,source,['hamlet'],
          cfg.broadcastHamletSize,hamletMin,null,hamletMax),'Hamlet');
      if(tierAppearance(cfg,'Town').enabled&&townMax>customTownMin)
        add(settlementLayer('wd-town-labels',cfg,source,['town'],
          cfg.broadcastTownSize,customTownMin,null,townMax),'Town');
      if(tierAppearance(cfg,'City').enabled){
        if(cityMax>customCityMin)
          add(settlementLayer('wd-city-labels',cfg,source,['city'],
            cfg.broadcastCitySize,customCityMin,null,cityMax),'City');
        // If a style lacks native overview labels, the synthetic major layer
        // retains city names below the regular city zoom minimum.
        const syntheticMajorMin=nativeOverviewEnabled?Math.max(majorMin,nativeOverviewEnd):majorMin;
        if(cfg.broadcastKeepMajorCities!==false&&syntheticMajorMin<cityMin)
          add(settlementLayer('wd-major-city-labels',cfg,source,['city'],
            cfg.broadcastCitySize,syntheticMajorMin,'major',cityMin),'City');
      }
    }
  }

  MB.token = () => String(g.WX_MAPBOX_TOKEN || ls.get('wx.mapbox.token') || '').trim();
  MB.hasToken = () => /^pk\./.test(MB.token());
  {
    const scaleKey='wx.mapbox.scale', migrationKey='wx.mapbox.nativeScale.v1';
    let saved=+ls.get(scaleKey);
    if(!ls.get(migrationKey)){
      if(!saved || Math.abs(saved-1.5)<0.001){saved=1;ls.set(scaleKey,'1');}
      ls.set(migrationKey,'1');
    }
    MB.scale=num(saved,1)||1;
  }
  MB.STYLES = [['broadcast','Weather Director Broadcast'],['streets-v12', 'Streets'], ['outdoors-v12', 'Outdoors'], ['light-v11', 'Light'], ['dark-v11', 'Dark'], ['satellite-streets-v12', 'Satellite + streets'], ['navigation-day-v1', 'Navigation (road signs)']];
  MB.PROJ = [['mercator', 'Mercator (flat)'], ['globe', 'Globe']];
  const R = {
    conus: ['Continental US', { c: [-96.5, 38.6], z: 3.3 }], northamerica: ['North America', { c: [-98, 41], z: 2.2 }], northeast: ['Northeast', { c: [-73.8, 42.7], z: 5.2 }], newengland: ['New England', { c: [-71.6, 43.3], z: 5.7 }],
    eastma: ['Eastern Massachusetts', { c: [-71.2689, 42.5584], z: 8.0 }], boston: ['Boston / Billerica', { c: [-71.18, 42.48], z: 9.4 }], tropical: ['Atlantic basin', { c: [-60, 25], z: 2.7 }], world: ['World', { c: [-40, 28], z: 1.3 }]
  };
  MB.regionList = Object.keys(R).map(k => [k, R[k][0]]);
  MB.regionCam = key => Object.assign({ b: 0, p: 0 }, (R[key] || R.newengland)[1], { c: (R[key] || R.newengland)[1].c.slice() });
  // Use a single underlying Streets + Satellite vector-style source for
  // all broadcast bases so coastline/settlement/road detail never changes
  // merely because the imagery layer is turned off.
  const styleOf = bg => { MB.ensureConfig(bg); return bg.mbStyle==='broadcast'?'satellite-streets-v12':(bg.mbStyle||'streets-v12'); }, projOf = bg => (bg && bg.proj === 'globe') ? 'globe' : 'mercator';
  const norm = cam => ({ c: [num(cam.c[0], 0), clampLat(num(cam.c[1], 0))], z: Math.max(0, Math.min(22, num(cam.z, 3))), b: num(cam.b, 0), p: Math.max(0, Math.min(75, num(cam.p, 0))) });
  const clampLat = v => Math.max(-85, Math.min(85, v));
  const cloneBg = bg => { MB.ensureConfig(bg); const o={mbStyle:bg.mbStyle,proj:bg.proj};Object.keys(WD_DEFAULTS).forEach(k=>o[k]=bg[k]);return o; };
  const keyOf = (bg, cam) => { const k = norm(cam); return [bg.mbStyle||'',styleOf(bg),projOf(bg),wdConfigKey(bg),MB.scale,k.c[0].toFixed(5),k.c[1].toFixed(5),k.z.toFixed(3),k.b.toFixed(2),k.p.toFixed(1)].join('|'); };
  MB.keyOf = keyOf;

  /* ---- library + maps ---- */
  let D = null, P = null, host = null, initP = null, curStyle = null, curStyleKey = null, curCfgKey = null, curProj = null, pProj = null, pKey = null, liveKey = null, renderGeneration = 0;
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
        D.on('moveend',()=>refreshDynamicOverlays(D));
        D.on('sourcedata',e=>{
          if(activeOverlayCfg?.overlayLatLonMode!=='ocean'||!e.isSourceLoaded)return;
          try{
            if(e.sourceId===streetsSource(D)){
              oceanWaterTilesChanged=true;
              refreshDynamicOverlays(D);
            }
          }catch(err){}
        });
        await Promise.all([once(D, 'load'), once(P, 'load')]);
        curStyle = 'streets-v12'; curStyleKey='stock|streets-v12'; curCfgKey=null; curProj = 'mercator'; pProj = 'mercator'; MB.status = 'ready';
      } catch (e) { MB.status = 'error'; MB.err = e.message || String(e); initP = null; throw e; }
    })();
    return initP;
  };
  MB.reset = function () { try { if (D) D.remove(); if (P) P.remove(); if (host) host.remove(); } catch (e) { /* ignore */ } D = P = host = initP = null; curStyle = curStyleKey = curCfgKey = curProj = pProj = pKey = liveKey = null; renderGeneration++; MB.interacting = false; MB.cache.clear(); MB.last = null; MB.status = 'idle'; MB.err = ''; MB.queue = Promise.resolve(); };
  MB.setToken = function (t) { ls.set('wx.mapbox.token', String(t || '').trim()); MB.reset(); };
  MB.setScale = function (s) { MB.scale = s; ls.set('wx.mapbox.scale', String(s)); MB.reset(); };

  function fog(bg) {
    try{
      if(bg.mbStyle==='broadcast'&&bg.globeAtmosphereEnabled===false){D.setFog(null);return;}
      const fog=atmosphereFor(bg.mbStyle==='broadcast'?(bg.atmosphere||'broadcast'):(projOf(bg)==='globe'?'natural':'none'));
      if(fog&&bg.mbStyle==='broadcast'){
        fog['star-intensity']=bg.globeStarsEnabled===false?0:Math.max(0,Math.min(1,+bg.globeStarIntensity||0));
        fog['horizon-blend']=Math.max(0,Math.min(.2,(+bg.globeAtmosphereStrength||0)*.3));
        fog['space-color']=bg.globeBackgroundColor||'#000000';
      }
      D.setFog(fog);
    }catch(e){}
  }
  async function setup(bg) {
    MB.ensureConfig(bg);const st=styleOf(bg),pr=projOf(bg),styleKey=(bg.mbStyle||'stock')+'|'+st,cfgKey=wdConfigKey(bg);
    if(styleKey!==curStyleKey){D.setStyle('mapbox://styles/mapbox/'+st);await once(D,'style.load');curStyle=st;curStyleKey=styleKey;curCfgKey=null;curProj=null;D.__wdOriginalZoomRanges={};D.__wdOriginalRasterVisibility={};D.__wdOriginalOverviewFilters={};}
    if(pr!==curProj){D.setProjection(pr);curProj=pr;}
    fog(bg);applyTerrain(D,bg);
    if(bg.mbStyle==='broadcast'&&cfgKey!==curCfgKey){addBroadcastCartography(D,bg);curCfgKey=cfgKey;}
  }
  function settle(m, generation) {
    return new Promise(res => {
      let ok = 0; const t0 = performance.now();
      const step = () => {
        if (generation !== renderGeneration || MB.interacting) return res(false);
        if (performance.now() - t0 > 20000) return res(true);
        m.triggerRepaint();
        m.once('render', () => {
          if (generation !== renderGeneration || MB.interacting) return res(false);
          let done = false; try { done = m.loaded() && !m.isMoving(); } catch (e) { done = true; }
          if (done) { ok++; if (ok >= 2) return res(true); } else ok = 0;
          setTimeout(step, 16);
        });
      };
      step();
    });
  }

  function visualConfigReady(bg){
    if(!D||MB.status!=='ready')return false;
    MB.ensureConfig(bg);
    const st=styleOf(bg),pr=projOf(bg),styleKey=(bg.mbStyle||'stock')+'|'+st,cfgKey=wdConfigKey(bg);
    return styleKey===curStyleKey && pr===curProj && (bg.mbStyle!=='broadcast'||cfgKey===curCfgKey);
  }

  function liveCanvas(bg,cam){
    if(!visualConfigReady(bg)){
      // A boundary slider can change cfgKey while the next Mapbox style
      // update is still queued. During a drag, keep the EXISTING live WebGL
      // canvas moving rather than freezing on an obsolete cached snapshot.
      // The queued style update applies once the drag ends.
      const sameStyle=D&&MB.status==='ready'&&
        ((bg.mbStyle||'stock')+'|'+styleOf(bg)===curStyleKey)&&projOf(bg)===curProj;
      if(!(MB.interacting&&sameStyle))return null;
    }
    const k=norm(cam), key=[k.c[0].toFixed(6),k.c[1].toFixed(6),k.z.toFixed(4),k.b.toFixed(3),k.p.toFixed(3)].join('|');
    if(key!==liveKey){
      D.jumpTo({center:k.c,zoom:k.z,bearing:k.b,pitch:k.p});
      D.triggerRepaint();
      liveKey=key;
    }
    return D.getCanvas();
  }

  MB.setInteractive = function(active){
    active=!!active;
    if(MB.interacting===active)return;
    MB.interacting=active;
    renderGeneration++;
    want=null;
    if(!active)liveKey=null;
    if(MB.onUpdate)MB.onUpdate();
  };

  MB.queue = Promise.resolve();
  async function doSnap(bg, cam, key) {
    await MB.init(); if (MB.cache.has(key)) return MB.cache.get(key);
    if(MB.interacting)return null;
    await setup(bg); const k = norm(cam), generation=renderGeneration;
    D.jumpTo({ center: k.c, zoom: k.z, bearing: k.b, pitch: k.p }); liveKey=null;
    const settled=await settle(D,generation);
    if(!settled||generation!==renderGeneration||MB.interacting)return null;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').drawImage(D.getCanvas(), 0, 0, W, H);
    MB.cache.set(key, cv); if (MB.cache.size > 14) MB.cache.delete(MB.cache.keys().next().value); MB.last = cv; return cv;
  }
  MB.snap = function (bg, cam) { const key = keyOf(bg, cam), b = cloneBg(bg); if (MB.cache.has(key)) return Promise.resolve(MB.cache.get(key)); const p = MB.queue.then(() => doSnap(b, cam, key)); MB.queue = p.catch(() => { }); return p; };

  /* Live editor preview: while the user is moving the camera, use Mapbox's
     current WebGL canvas directly instead of waiting for settled snapshots. */
  let busy = false, want = null;
  function pump() {
    if (busy || !want || MB.interacting) return;
    busy = true; const w = want; want = null;
    MB.snap(w.bg, w.cam).catch(() => { }).then(() => { busy = false; if (MB.onUpdate) MB.onUpdate(); pump(); });
  }
  MB.liveFrame = function(bg,cam){
    if(!MB.hasToken())return null;
    const live=liveCanvas(bg,cam);
    if(live)return live;
    const key=keyOf(bg,cam),c=MB.cache.get(key); if(c)return c;
    want={bg:cloneBg(bg),cam:norm(cam)};pump();
    return MB.last;
  };
  MB.frame = function (bg, cam) {
    if (!MB.hasToken()) return null;
    const key = keyOf(bg, cam), c = MB.cache.get(key); if (c) return c;
    want = { bg: cloneBg(bg), cam: norm(cam) }; pump();
    return MB.last;
  };

  /* ---- lng/lat <-> 1920x1080 screen pixels ---- */
  // Stable, absolute pan calculation from the camera at pointer-down. Unlike
  // applying tiny center offsets repeatedly, this remains predictable at
  // low zoom and on a globe as tiles and labels are being redrawn.
  MB.panByPixels = function(bg,startCam,dx,dy){
    if(!Number.isFinite(dx)||!Number.isFinite(dy))return null;
    const k=norm(startCam),s=MB.scale||1,pr=projOf(bg);
    if(P&&MB.status==='ready'){
      try{
        if(pProj!==pr){P.setProjection(pr);pProj=pr;}
        P.jumpTo({center:k.c,zoom:k.z,bearing:k.b,pitch:k.p});
        // panBy specifies the camera's screen offset, opposite to the pointer
        // motion for our preview. Negating both axes makes the map follow
        // the mouse (right drag -> map right; up drag -> map up).
        P.panBy([-dx/s,-dy/s],{duration:0});
        pKey=null;
        const c=P.getCenter();
        if(c&&Number.isFinite(c.lng)&&Number.isFinite(c.lat))
          return [((c.lng+180)%360+360)%360-180,Math.max(-85,Math.min(85,c.lat))];
      }catch(e){pKey=null;}
    }
    // Fallback while the projector isn't ready, for both flat and globe
    // maps. Globe is approximate here; the native pan above is precise.
    const world=512*Math.pow(2,k.z),rad=Math.PI/180,angle=k.b*rad;
    const east=Math.cos(angle)*dx-Math.sin(angle)*dy;
    const south=Math.sin(angle)*dx+Math.cos(angle)*dy;
    if(pr==='globe'){
      const cosLat=Math.max(.18,Math.cos(k.c[1]*rad));
      const wrap=lon=>((lon+180)%360+360)%360-180;
      return [wrap(k.c[0]-east*360/world/cosLat),
        Math.max(-85,Math.min(85,k.c[1]+south*360/world))];
    }
    const wrap=lon=>((lon+180)%360+360)%360-180;
    const lat=Math.max(-85,Math.min(85,k.c[1]));
    const y0=(1-Math.log(Math.tan(Math.PI/4+lat*rad/2))/Math.PI)/2;
    const y1=Math.max(1e-6,Math.min(1-1e-6,y0-south/world));
    const lat1=Math.atan(Math.sinh(Math.PI*(1-2*y1)))/rad;
    return [wrap(k.c[0]-east*360/world),Math.max(-85,Math.min(85,lat1))];
  };
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
