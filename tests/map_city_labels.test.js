// Run: node --test tests/map_city_labels.test.js
// Verifies Mapbox Streets v8 label logic without network, credentials or WebGL.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../studio/mapbox.js'),'utf8');
const ui=fs.readFileSync(path.join(__dirname,'../studio/ui.js'),'utf8');

const between=(a,b)=>{
 const start=source.indexOf(a),end=source.indexOf(b,start);
 assert.ok(start!==-1&&end>start, 'Expected source snippet '+a);
 return source.slice(start,end);
};
const fontStack=name=>name==='Roboto Bold'
 ?['Roboto Bold','Arial Unicode MS Bold']:['DIN Pro Bold','Arial Unicode MS Bold'];
const padding=(density,spacing)=>Math.max(0,
 (density==='sparse'?16:density==='dense'?5:density==='maximum'?2:9)*
 Math.max(.5,Math.min(3,+spacing||1)));
const labels=new Function('wdFontStack','labelPadding',
 between('  function tierAppearance(','  // Natural Earth land polygons')+
 ';return {settlementLayer,tierAppearance,tierTextStyle,addLabelDots,applyLabelBackground,tierFilter};')(fontStack,padding);
const maker=labels.settlementLayer;
const auxLabel=new Function('wdFontStack',
 between('  function applyRecordedAuxLabel(','  function addBroadcastCartography(')+
 ';return applyRecordedAuxLabel;')(fontStack);
const buildCode=between("    ['wd-major-city-labels'",'\n  }\n\n  MB.token');
const build=new Function('cfg','map','source','settlementLayer','tierAppearance','addLabelDots','applyLabelBackground',
  'const nativeOverviewEnabled=false,nativeOverviewEnd=7.5;'+buildCode+';return map.layers;');
function render(cfg){
 const map={layers:[],getLayer(id){return this.layers.find(l=>l.id===id)},
  removeLayer(id){this.layers=this.layers.filter(l=>l.id!==id)},
  addLayer(layer){this.layers.push(layer)}};
 return build(cfg,map,'composite',maker,labels.tierAppearance,labels.addLabelDots,()=>{});
}
const cfg={
 broadcastShowCities:true,broadcastPlaceDensity:'towns',
 broadcastLabelDensity:'normal',broadcastLabelOpacity:1,
 broadcastMajorCityRank:9,broadcastKeepMajorCities:true,
 broadcastCityMinZoom:6,broadcastCityMaxZoom:20,
 broadcastTownMinZoom:5,broadcastTownMaxZoom:21,
 broadcastVillageMinZoom:7,broadcastVillageMaxZoom:18,
 broadcastMajorCityMinZoom:0,
 broadcastCitySize:20,broadcastTownSize:16,broadcastVillageSize:13
};
const evalFilter=(e,p)=>{
 if(!Array.isArray(e))return e;
 const [op,...args]=e;
 if(op==='get')return p[args[0]];
 if(op==='coalesce')return args.map(x=>evalFilter(x,p)).find(x=>x!=null);
 if(op==='all')return args.every(x=>evalFilter(x,p));
 if(op==='any')return args.some(x=>evalFilter(x,p));
 if(op==='==')return evalFilter(args[0],p)===evalFilter(args[1],p);
 if(op==='<=')return evalFilter(args[0],p)<=evalFilter(args[1],p);
 if(op==='match')return args[1].includes(evalFilter(args[0],p))?args[2]:args[3];
 throw Error('Unknown filter '+op);
};
const prominent={class:'settlement',type:'city',filterrank:5,symbolrank:4};
const minor={class:'settlement',type:'city',filterrank:5,symbolrank:16};
test('zoom 0–20 retains prominent cities when city minimum is 6',()=>{
 const layers=render(cfg);
 const city=layers.find(l=>l.id==='wd-city-labels');
 const major=layers.find(l=>l.id==='wd-major-city-labels');
 assert.deepEqual([city.minzoom,city.maxzoom],[6,20]);
 assert.deepEqual([major.minzoom,major.maxzoom],[0,6]);
 assert.ok(evalFilter(city.filter,prominent));
 assert.ok(evalFilter(major.filter,prominent));
 assert.ok(!evalFilter(major.filter,minor));
 for(const zoom of [0,2,4,5,5.9,6,7,12,19.9])
  assert.ok(layers.some(l=>l.minzoom<=zoom&&(l.maxzoom??24)>zoom&&evalFilter(l.filter,prominent)),String(zoom));
});
test('town and village zoom windows follow map settings',()=>{
 const l=render({...cfg,broadcastPlaceDensity:'villages'});
 const town=l.find(x=>x.id==='wd-town-labels');
 const village=l.find(x=>x.id==='wd-small-place-labels');
 assert.deepEqual([town.minzoom,town.maxzoom],[5,21]);
 assert.deepEqual([village.minzoom,village.maxzoom],[7,18]);
});
test('turning off major cities retains intentional sparse settings',()=>{
 const l=render({...cfg,broadcastKeepMajorCities:false});
 assert.equal(l.some(x=>x.id==='wd-major-city-labels'),false);
 const city=l.find(x=>x.id==='wd-city-labels');
 assert.equal(evalFilter(city.filter,prominent),false);
});
test('default city minimum still shows important cities at overview zoom',()=>{
 const l=render({...cfg,broadcastCityMinZoom:3,broadcastCityMaxZoom:24});
 const city=l.find(x=>x.id==='wd-city-labels');
 assert.ok(evalFilter(city.filter,prominent),'prominent city survives changing filterrank');
});
test('UI exposes editable min and max zoom ranges for every place type',()=>{
 for(const name of ['City','Town','Village'])
  for(const edge of ['Min','Max'])
   assert.ok(ui.includes("prefix+'"+edge+"Zoom'"),name+' '+edge);
 assert.ok(ui.includes("B('broadcastMajorCityMinZoom','range'"));
});

test('Mapbox native settlement names remain visible at zoom 6.0; custom labels take over at 7.5',()=>{
 const nativeCode=between('  function addBroadcastCartography(','  MB.token =');
 const fn=new Function('streetsSource','installBaseTints','installHillshade','installLandWaterFeatures',
  'installTransportation','installOverlays','settlementLayer','wdFontStack','labelPadding','tierAppearance','addLabelDots','applyLabelBackground','tierTextStyle','applyRecordedAuxLabel',
  nativeCode+';return addBroadcastCartography;')(()=> 'composite',()=>{},()=>{},()=>{},()=>{},()=>{},maker,fontStack,padding,
    labels.tierAppearance,labels.addLabelDots,()=>{},labels.tierTextStyle,auxLabel);
 const orig=id=>({id,type:'symbol',source:'composite','source-layer':'place_label',
  minzoom:2,maxzoom:15,layout:{visibility:'visible'},paint:{}});
 const map={layers:[orig('settlement-major-label'),orig('settlement-minor-label'),orig('state-label')],
  getStyle(){return {layers:this.layers}},
  getLayer(id){return this.layers.find(l=>l.id===id)},
  setLayoutProperty(id,key,val){this.getLayer(id).layout[key]=val},
  setPaintProperty(id,key,val){this.getLayer(id).paint[key]=val},
  setFilter(id,filter){this.getLayer(id).filter=filter},
  setLayerZoomRange(id,min,max){assert.ok(max>min);Object.assign(this.getLayer(id),{minzoom:min,maxzoom:max})},
  removeLayer(id){this.layers=this.layers.filter(l=>l.id!==id)},
  addLayer(l){this.layers.push(l)}};
 const styles={mbStyle:'broadcast',broadcastBase:'satellite',...cfg};
 fn(map,styles);
 const get=id=>map.getLayer(id);
 assert.equal(get('settlement-major-label').layout.visibility,'visible');
 assert.equal(get('settlement-minor-label').layout.visibility,'visible');
 assert.ok(get('settlement-major-label').minzoom<=6&&get('settlement-major-label').maxzoom>6);
 assert.ok(get('settlement-minor-label').minzoom<=6&&get('settlement-minor-label').maxzoom>6);
 assert.equal(get('wd-city-labels').minzoom,get('settlement-major-label').maxzoom);
 assert.equal(get('state-label').layout.visibility,'none');
 // At zoom 7.0 native Mapbox labels MUST use exactly the same Wx Studio
 // typography as custom labels at zoom 7.5; only placement differs.
 const custom={...styles,broadcastCitySize:29,broadcastTownSize:21,
  broadcastLabelFont:'Roboto Bold',broadcastLabelDensity:'dense',broadcastLabelSpacing:1.7,
  broadcastLabelOpacity:.65,broadcastLabelColor:'#eef6fd',
  broadcastLabelHaloColor:'#020508',broadcastLabelHaloWidth:2.25,
  broadcastUppercaseLabels:false};
 fn(map,custom);
 const city=get('wd-city-labels'),town=get('wd-town-labels'),
  nativeCity=get('settlement-major-label'),nativeTown=get('settlement-minor-label');
 assert.equal(nativeCity.layout['text-size'],29);
 assert.equal(nativeTown.layout['text-size'],21);
 assert.deepEqual(nativeCity.layout['text-font'],city.layout['text-font']);
 assert.deepEqual(nativeTown.layout['text-font'],town.layout['text-font']);
 assert.equal(nativeCity.layout['text-transform'],'none');
 assert.equal(nativeCity.layout['text-padding'],2,'Overview must use its own tight gap');
 assert.equal(nativeTown.layout['text-padding'],2,'Town overview gap');
 assert.ok(city.layout['text-padding']>nativeCity.layout['text-padding'],'High zoom spacing remains independently configurable');
 for(const property of ['text-color','text-halo-color','text-halo-width','text-halo-blur','text-opacity']){
  assert.equal(nativeCity.paint[property],city.paint[property],property+' city');
  assert.equal(nativeTown.paint[property],town.paint[property],property+' town');
 }
 // Changing settings must update native and custom labels together,
 // without waiting until the user zooms through the 7.5 threshold.
 fn(map,{...custom,broadcastCitySize:33,broadcastTownSize:18,broadcastLabelFont:'DIN Pro Bold',broadcastOverviewLabelGap:0});
 assert.equal(get('settlement-major-label').layout['text-padding'],0,'Zero overview gap must work');
 assert.equal(get('settlement-major-label').layout['text-size'],33);
 assert.equal(get('settlement-minor-label').layout['text-size'],18);
 assert.equal(get('wd-city-labels').layout['text-size'],33);
 assert.deepEqual(get('settlement-major-label').layout['text-font'],get('wd-city-labels').layout['text-font']);
 // User saved settings can select city minimum 6; overview should not disappear.
 fn(map,{...styles,broadcastCityMinZoom:6});
 assert.ok(get('settlement-major-label').minzoom<=6&&get('settlement-major-label').maxzoom>6);
 fn(map,{...styles,broadcastShowCities:false});
 assert.equal(get('settlement-major-label').layout.visibility,'none');
 assert.equal(get('wd-city-labels'),undefined);
 fn(map,{...styles,broadcastTownEnabled:false});
 assert.equal(get('settlement-minor-label').layout.visibility,'none');
 assert.equal(get('settlement-major-label').layout.visibility,'visible');
});

test('overview city coverage increases eligible cities without ignoring collisions',()=>{
 const nativeCode=between('  function addBroadcastCartography(','  MB.token =');
 const fn=new Function('streetsSource','installBaseTints','installHillshade','installLandWaterFeatures',
  'installTransportation','installOverlays','settlementLayer','wdFontStack','labelPadding','tierAppearance','addLabelDots','applyLabelBackground','tierTextStyle','applyRecordedAuxLabel',
  nativeCode+';return addBroadcastCartography;')(()=> 'composite',()=>{},()=>{},()=>{},()=>{},()=>{},maker,fontStack,padding,
    labels.tierAppearance,labels.addLabelDots,()=>{},labels.tierTextStyle,auxLabel);
 // Simulate a Mapbox Streets v12 stock filter: these real built-in
 // constraints MUST survive every WX Studio rank/density setting.
 // Streets v12 major and minor divide by symbolrank, NOT city vs town.
 const stockMajor=['all',
   ['match',['get','class'],['settlement','disputed_settlement'],true,false],
   ['<=',['get','filterrank'],3],
   ['<=',['get','symbolrank'],6]];
 const stockMinor=['all',
   ['match',['get','class'],['settlement','disputed_settlement'],true,false],
   ['<=',['get','filterrank'],3],
   ['match',['get','symbolrank'],[7,8,9,10,11,12,13,14,15,16,17,18,19],true,false]];
 const nativeSort=['step',['get','symbolrank'],18,6,16,7,14];
 const orig=id=>({id,type:'symbol',source:'composite','source-layer':'place_label',
  minzoom:2,maxzoom:15,
  filter:JSON.parse(JSON.stringify(id==='settlement-major-label'?stockMajor:stockMinor)),
  layout:{visibility:'visible','text-allow-overlap':false,'text-ignore-placement':false,
    'symbol-sort-key':JSON.parse(JSON.stringify(nativeSort))},paint:{}});
 const map={layers:[orig('settlement-major-label'),orig('settlement-minor-label')],
  getStyle(){return {layers:this.layers}},getLayer(id){return this.layers.find(l=>l.id===id)},
  setLayoutProperty(id,key,value){this.getLayer(id).layout[key]=value},
  setPaintProperty(id,key,value){this.getLayer(id).paint[key]=value},
  setFilter(id,filter){this.getLayer(id).filter=filter},
  setLayerZoomRange(id,min,max){Object.assign(this.getLayer(id),{minzoom:min,maxzoom:max})},
  removeLayer(id){this.layers=this.layers.filter(l=>l.id!==id)},
  addLayer(l){this.layers.push(l)}};
 const conf={...cfg,mbStyle:'broadcast',broadcastBase:'satellite',
  broadcastCityMinZoom:3,broadcastCityMaxZoom:24,broadcastMajorCityRank:9,
  broadcastOverviewLabelGap:2,broadcastLabelSpacing:1.25,
  broadcastKeepMajorCities:true,broadcastShowCities:true};
 const city=n=>({class:'settlement',type:'city',symbolrank:n,filterrank:5});
 const ranks=[];
 for(const [mode,expected] of [['standard',9],['more',14],['many',19]]){
  fn(map,{...conf,broadcastOverviewCityDensity:mode});
  const layer=map.getLayer('settlement-major-label');
  ranks.push([mode,[5,9,10,14,15,19].filter(n=>evalFilter(layer.filter,city(n)))]);
  assert.equal(evalFilter(layer.filter,city(expected)),true,mode+' cap');
  if(expected<19)assert.equal(evalFilter(layer.filter,city(expected+1)),false,mode+' beyond cap');
  assert.ok(layer.minzoom<=5&&layer.maxzoom>5,'native labels appear at zoom 5');
  assert.equal(layer.layout['text-allow-overlap'],false,'no colliding text');
  assert.equal(layer.layout['text-ignore-placement'],false,'do not block other labels');
  assert.equal(layer.layout['text-padding'],2,'tight low zoom gap');
  assert.deepEqual(layer.layout['symbol-sort-key'],nativeSort,
    'must not override native Mapbox placement sorting');
  assert.equal(layer.layout['text-size'],conf.broadcastCitySize,'preserve user city font size');
 }
 // The original Mapbox label must NEVER disappear, even if the user's
 // requested extra rank is below its symbolrank or its type is unusual.
 // This was the exact regression in 0.9.52.
 fn(map,{...conf,broadcastMajorCityRank:1,broadcastOverviewCityDensity:'standard'});
 const preserved={class:'settlement',type:'city',symbolrank:5,filterrank:2};
 assert.equal(evalFilter(map.getLayer('settlement-major-label').filter,preserved),true,
  'original major city remains eligible even with strict extra rank');
 const baselineOnly={class:'disputed_settlement',type:'town',symbolrank:4,filterrank:2};
 assert.equal(evalFilter(map.getLayer('settlement-major-label').filter,baselineOnly),false,
  'a prominent TOWN must not render with City typography in the major layer');
 assert.equal(evalFilter(map.getLayer('settlement-minor-label').filter,baselineOnly),true,
  'a prominent town from the original major layer moves to the Town layer');
 const minorCity={class:'settlement',type:'city',symbolrank:10,filterrank:2};
 assert.equal(evalFilter(map.getLayer('settlement-major-label').filter,minorCity),true,
  'a less prominent CITY from the original minor layer moves to the City layer');
 assert.equal(evalFilter(map.getLayer('settlement-minor-label').filter,minorCity),false,
  'the original minor layer must not render city text with Town typography');
 // Both rank layers and the higher-zoom custom layers must apply the exact
 // user-selected City and Town sizes at the zoom-7.5 handoff.
 assert.equal(map.getLayer('settlement-major-label').layout['text-size'],conf.broadcastCitySize);
 assert.equal(map.getLayer('settlement-minor-label').layout['text-size'],conf.broadcastTownSize);
 assert.equal(map.getLayer('wd-city-labels').layout['text-size'],conf.broadcastCitySize);
 assert.equal(map.getLayer('wd-town-labels').layout['text-size'],conf.broadcastTownSize);
 assert.equal(map.getLayer('settlement-major-label').maxzoom,7.5);
 assert.equal(map.getLayer('wd-city-labels').minzoom,7.5);
 assert.equal(map.getLayer('settlement-minor-label').maxzoom,7.5);
 assert.equal(map.getLayer('wd-town-labels').minzoom,7.5);
 assert.deepEqual(map.__wdOriginalOverviewFilters['settlement-major-label'],stockMajor,
  'original major filter cached unchanged');
 assert.deepEqual(map.__wdOriginalOverviewFilters['settlement-minor-label'],stockMinor,
  'original minor filter cached unchanged');
 // Check repeated slider restyles don't overwrite stock cache with the
 // already-modified filter, allowing standard to become cumulative.
 fn(map,{...conf,broadcastMajorCityRank:9,broadcastOverviewCityDensity:'many'});
 fn(map,{...conf,broadcastMajorCityRank:1,broadcastOverviewCityDensity:'standard'});
 assert.equal(evalFilter(map.getLayer('settlement-major-label').filter,city(19)),false,
  'reducing label density actually removes EXTRA cities again');
 assert.equal(evalFilter(map.getLayer('settlement-major-label').filter,preserved),true,
  'the original stock city survives a full density round trip');
 assert.deepEqual(map.getLayer('settlement-major-label').layout['symbol-sort-key'],nativeSort);
 assert.deepEqual(ranks.map(x=>x[1].length),[2,4,6],'higher mode offers more candidates');
 fn(map,{...conf,broadcastMajorCityRank:13,broadcastOverviewCityDensity:'more'});
 assert.ok(evalFilter(map.getLayer('settlement-major-label').filter,city(18)),
  'increasing Major-city rank actually applies to native low zoom');
 assert.equal(evalFilter(map.getLayer('settlement-minor-label').filter,city(18)),false,
  'minor layer must not duplicate cities');
 fn(map,{...conf,broadcastOverviewCityDensity:'many',broadcastPlaceDensity:'cities'});
 assert.equal(map.getLayer('settlement-minor-label').layout.visibility,'none');
 fn(map,{...conf,broadcastShowCities:false});
 assert.equal(map.getLayer('settlement-major-label').layout.visibility,'none');
});
test('overview controls have stored defaults and visible Settings inputs',()=>{
 assert.ok(source.includes("broadcastOverviewCityDensity:'more'"));
 assert.ok(source.includes('broadcastOverviewLabelGap:2'));
 assert.ok(ui.includes("B('broadcastOverviewCityDensity','select'"));
 assert.ok(ui.includes("B('broadcastOverviewLabelGap','range'"));
 for(const tier of ['City','Town','Village']){
  assert.ok(ui.includes("placeTier('"+tier+"'"),tier+' accordion');
  for(const suffix of ['Font','Size','Color','HaloColor','HaloWidth','DensityPct','Population',
   'TextBackground','DropShadow','Dots','DotColor','DotOutlineColor','DotOutlineWidth',
   'DotSize','DotNameOffset','DotShadow'])
   assert.ok(source.includes(suffix)||ui.includes(suffix),tier+' '+suffix);
 }
});

test('saved legacy typography migrates to all three separate tiers without overwriting it',()=>{
 const start=source.indexOf('  const WD_DEFAULTS = {');
 const end=source.indexOf('  const wdConfigKey = bg =>',start);
 const MB={};const factory=new Function('MB',source.slice(start,end)+';return MB;');
 const model=factory(MB);
 const legacy={broadcastPlaceDensity:'towns',broadcastLabelFont:'Roboto Bold',
  broadcastLabelColor:'#e4f1ff',broadcastLabelHaloColor:'#020409',
  broadcastLabelHaloWidth:2.75,broadcastLabelOpacity:.65,
  broadcastLabelSpacing:1.65,broadcastUppercaseLabels:false,
  broadcastCitySize:22,broadcastTownSize:18,broadcastVillageSize:14};
 model.ensureConfig(legacy);
 for(const tier of ['City','Town','Village']){
  assert.equal(legacy['broadcast'+tier+'Font'],'Roboto Bold');
  assert.equal(legacy['broadcast'+tier+'Color'],'#e4f1ff');
  assert.equal(legacy['broadcast'+tier+'HaloWidth'],2.75);
  assert.equal(legacy['broadcast'+tier+'Uppercase'],false);
  assert.equal(legacy['broadcast'+tier+'Opacity'],.65);
  assert.equal(legacy['broadcast'+tier+'Spacing'],1.65);
 }
 assert.equal(legacy.broadcastVillageEnabled,false);
 legacy.broadcastCityFont='Open Sans Bold';
 legacy.broadcastTownFont='Roboto Medium';
 model.ensureConfig(legacy);
 assert.equal(legacy.broadcastCityFont,'Open Sans Bold');
 assert.equal(legacy.broadcastTownFont,'Roboto Medium');
 assert.equal(legacy.broadcastVillageFont,'Roboto Bold');
 assert.equal(model.DEFAULTS.broadcastCityFont,'Roboto Bold');
});

test('city, town and village paint, font and size settings are independent',()=>{
 const one={...cfg,broadcastPlaceDensity:'all',
  broadcastCityFont:'Roboto Bold',broadcastCitySize:29,broadcastCityColor:'#abcdef',
  broadcastCityHaloColor:'#010101',broadcastCityHaloWidth:3,
  broadcastTownFont:'DIN Pro Bold',broadcastTownSize:13,broadcastTownColor:'#fedcba',
  broadcastVillageFont:'Open Sans Bold',broadcastVillageSize:11,broadcastVillageColor:'#aabbcc',
  broadcastVillageEnabled:true,broadcastCityEnabled:true,broadcastTownEnabled:true};
 const layers=render(one);
 const city=layers.find(x=>x.id==='wd-city-labels'),
   town=layers.find(x=>x.id==='wd-town-labels'),
   village=layers.find(x=>x.id==='wd-small-place-labels');
 assert.equal(city.layout['text-size'],29);
 assert.equal(town.layout['text-size'],13);
 assert.equal(village.layout['text-size'],11);
 assert.equal(city.paint['text-color'],'#abcdef');
 assert.equal(town.paint['text-color'],'#fedcba');
 assert.equal(village.paint['text-color'],'#aabbcc');
 assert.deepEqual(city.layout['text-font'],fontStack('Roboto Bold'));
 assert.deepEqual(town.layout['text-font'],fontStack('DIN Pro Bold'));
 assert.deepEqual(village.layout['text-font'],fontStack('Open Sans Bold'));
 assert.equal(city.paint['text-halo-width'],3);
 assert.equal(city.paint['text-halo-color'],'#010101');
 const noTowns=render({...one,broadcastTownEnabled:false});
 assert.equal(noTowns.some(x=>x.id==='wd-town-labels'),false);
 assert.ok(noTowns.some(x=>x.id==='wd-city-labels'));
 assert.ok(noTowns.some(x=>x.id==='wd-small-place-labels'));
});

test('native low zoom uses independent City and Town fonts without duplicate city-in-town',()=>{
 const code=between('  function addBroadcastCartography(','  MB.token =');
 const install=new Function('streetsSource','installBaseTints','installHillshade','installLandWaterFeatures',
  'installTransportation','installOverlays','settlementLayer','wdFontStack','labelPadding',
  'tierAppearance','addLabelDots','applyLabelBackground','tierTextStyle','applyRecordedAuxLabel',
  code+';return addBroadcastCartography;')(()=> 'composite',()=>{},()=>{},()=>{},()=>{},()=>{},
   labels.settlementLayer,fontStack,padding,labels.tierAppearance,labels.addLabelDots,()=>{},labels.tierTextStyle,auxLabel);
 const native=id=>({id,type:'symbol','source-layer':'place_label',
  filter:['==',['get','class'],'settlement'],layout:{visibility:'visible'},paint:{}});
 const map={layers:[native('settlement-major-label'),native('settlement-minor-label')],
  getStyle(){return {layers:this.layers}},getLayer(id){return this.layers.find(l=>l.id===id)},
  setLayoutProperty(id,k,v){this.getLayer(id).layout[k]=v},
  setPaintProperty(id,k,v){this.getLayer(id).paint[k]=v},
  setFilter(id,v){this.getLayer(id).filter=v},
  setLayerZoomRange(id,a,b){Object.assign(this.getLayer(id),{minzoom:a,maxzoom:b})},
  removeLayer(id){this.layers=this.layers.filter(l=>l.id!==id)},
  addLayer(l){this.layers.push(l)}};
 const settings={...cfg,mbStyle:'broadcast',broadcastCityFont:'Roboto Bold',
  broadcastTownFont:'Open Sans Bold',broadcastCitySize:29,broadcastTownSize:13,
  broadcastCityColor:'#ffedcb',broadcastTownColor:'#123456',
  broadcastCityHaloWidth:3,broadcastTownHaloWidth:1,
  broadcastCityEnabled:true,broadcastTownEnabled:true,
  broadcastCityDensityPct:60,broadcastTownDensityPct:40};
 install(map,settings);
 const city=map.getLayer('settlement-major-label'),town=map.getLayer('settlement-minor-label');
 assert.deepEqual(city.layout['text-font'],fontStack('Roboto Bold'));
 assert.deepEqual(town.layout['text-font'],fontStack('Open Sans Bold'));
 assert.equal(city.layout['text-size'],29);
 assert.equal(town.layout['text-size'],13);
 assert.equal(city.paint['text-color'],'#ffedcb');
 assert.equal(town.paint['text-color'],'#123456');
 assert.equal(city.paint['text-halo-width'],3);
 assert.equal(town.paint['text-halo-width'],1);
 assert.equal(evalFilter(city.filter,{class:'settlement',type:'city',symbolrank:5,filterrank:2}),true);
 assert.equal(evalFilter(town.filter,{class:'settlement',type:'city',symbolrank:5,filterrank:2}),false,
  'a city must not also render in the different-style towns layer');
 assert.equal(evalFilter(town.filter,{class:'settlement',type:'town',symbolrank:5,filterrank:2}),true);
 assert.ok(city.minzoom<=6&&city.maxzoom>6);
 install(map,{...settings,broadcastTownEnabled:false});
 assert.equal(map.getLayer('settlement-minor-label').layout.visibility,'none');
 assert.equal(map.getLayer('settlement-major-label').layout.visibility,'visible');
});
test('optional place dots render at the user-selected size and outline, never by default',()=>{
 const off=render({...cfg,broadcastCityDots:false});
 assert.ok(!off.some(x=>x.id==='wd-city-dots'));
 const on=render({...cfg,broadcastCityDots:true,broadcastCityDotSize:5,
  broadcastCityDotColor:'#ffffff',broadcastCityDotOutlineColor:'#000000',
  broadcastCityDotOutlineWidth:1.5,broadcastCityDotShadow:true});
 const dot=on.find(x=>x.id==='wd-city-dots');
 assert.ok(dot,'city dots must create a Mapbox circle layer');
 assert.equal(dot.paint['circle-radius'],2.5);
 assert.equal(dot.paint['circle-stroke-width'],1.5);
 assert.equal(dot.paint['circle-blur'],.35);
 assert.equal(on.find(x=>x.id==='wd-city-labels').layout['text-offset'][1],-.2);
});

test('floating Map Style popup imports the renamed Place Labels accordion',()=>{
 // Regression: v0.9.54 renamed the source panel to Place Labels, but the
 // popup still looked for City + Town Labels, hiding the whole section.
 const scenePanel=ui.slice(ui.indexOf("        // Aguacero-style independent expandable place-label categories."),
                           ui.indexOf("        // All four boundary width sliders",ui.indexOf("        // Aguacero-style")));
 const popup=ui.slice(ui.indexOf('function renderMapStylePanel('),
                      ui.indexOf("  $('#bMapStyle').onclick",ui.indexOf('function renderMapStylePanel(')));
 assert.ok(scenePanel.includes("p.append(mapAccordion('labels','Place Labels'"));
 assert.ok(popup.includes("addGroup('Place Labels');"),
  'popup must find the source accordion by its real title');
 assert.ok(!popup.includes("addGroup('City + Town Labels'"),
  'outdated title lookup must not silently hide settings');
 for(const tier of ['City','Town','Village','Hamlet'])
  assert.ok(scenePanel.includes("placeTier('"+tier+"'"),tier+' settings should remain nested and collapsible');
});

test('all place text formatting uses the same settings below and above overview handoff',()=>{
 const settings={...cfg,
  broadcastCityEnabled:true,broadcastCityFont:'Roboto Bold',
  broadcastCitySize:27,broadcastCityColor:'#fef3d5',
  broadcastCityHaloColor:'#040505',broadcastCityHaloWidth:2.75,
  broadcastCityUppercase:false,broadcastCityOpacity:.7,broadcastCitySpacing:1.9,
  broadcastTownEnabled:true,broadcastTownFont:'Open Sans Bold',
  broadcastTownSize:17,broadcastTownColor:'#ddeeff',
  broadcastTownHaloColor:'#000000',broadcastTownHaloWidth:1.25,
  broadcastTownUppercase:true,broadcastTownOpacity:.8,
  broadcastOverviewLabelGap:2
 };
 for(const tier of ['City','Town']){
  const low=labels.tierTextStyle(settings,tier,true);
  const custom=labels.tierTextStyle(settings,tier,false);
  for(const key of ['text-field','text-font','text-size','text-transform','text-letter-spacing',
    'text-line-height','text-max-width','text-anchor','text-justify','text-offset']){
   assert.deepEqual(low.layout[key],custom.layout[key],tier+' layout '+key);
  }
  for(const key of ['text-color','text-opacity','text-halo-color','text-halo-width','text-halo-blur'])
   assert.deepEqual(low.paint[key],custom.paint[key],tier+' paint '+key);
  const layer=labels.settlementLayer('test-'+tier,settings,'composite',
    tier==='City'?['city']:['town'],0,7.5,null,24);
  for(const key of ['text-field','text-font','text-size','text-transform','text-letter-spacing',
    'text-line-height','text-max-width','text-anchor','text-justify','text-offset'])
   assert.deepEqual(layer.layout[key],low.layout[key],tier+' rendered custom '+key);
  for(const key of ['text-color','text-opacity','text-halo-color','text-halo-width','text-halo-blur'])
   assert.deepEqual(layer.paint[key],low.paint[key],tier+' rendered custom '+key);
  // Only intentional difference: the existing separately adjustable
  // overview collision buffer versus close-up tier label spacing.
  assert.equal(low.layout['text-padding'],2);
  assert.ok(custom.layout['text-padding']>2);
 }
 const large=labels.settlementLayer('test-major',settings,'composite',['city'],0,3,'major',7.5);
 assert.equal(large.layout['text-size'],27,'major-city fallback must respect exact saved city px size');
});
test('flat-color and dark coasts use saved black color instead of being whitened',()=>{
 const body=between('  function installSeparatedWaterOutlines(','  function installHillshade(');
 const build=new Function('ensureNaturalEarthLines',body+';return installSeparatedWaterOutlines;')(
  (_map,kind)=>'natural-earth-'+kind);
 const baseline={broadcastShowCoastline:true,broadcastCoastlineColor:'#050505',
  broadcastCoastlineWidth:2,broadcastInlandWaterOutlines:false};
 for(const mode of ['custom','dark','satellite']){
  const layers=[];
  build({}, {...baseline,broadcastBase:mode},layer=>layers.push(layer));
  const coasts=layers.filter(l=>l.id==='wd-ocean-coastline'||l.id==='wd-minor-island-coastline');
  assert.equal(coasts.length,2,mode+' includes ocean and minor islands');
  for(const coast of coasts){
   assert.equal(coast.paint['line-color'],'#050505',mode+' black coastline');
   assert.equal(coast.paint['line-width'],2);
  }
  assert.equal(layers.some(l=>l.id==='wd-inland-lakes-outline'),false,
   'inland outlines remain independently disabled');
  const custom=[];
  build({}, {...baseline,broadcastBase:mode,broadcastCoastlineColor:'#aabbcc'},
    layer=>custom.push(layer));
  assert.equal(custom.find(l=>l.id==='wd-ocean-coastline').paint['line-color'],'#aabbcc',
   'explicit saved coastline color must be respected');
 }
});

test('the verified AguaceroWX values are exactly the new-map defaults for all 4 place types',()=>{
 const start=source.indexOf('  const WD_DEFAULTS = {');
 const end=source.indexOf('  const wdConfigKey = bg =>',start);
 const model=new Function('MB',source.slice(start,end)+';return MB;')({});
 const expected={
   City:{DensityPct:97,HaloWidth:2.5,MinZoom:2,MaxZoom:22,DotSize:3.5},
   Town:{DensityPct:96,HaloWidth:2,MinZoom:2,MaxZoom:22,DotSize:3},
   Village:{DensityPct:96,HaloWidth:1.5,MinZoom:6,MaxZoom:22,DotSize:2.5},
   Hamlet:{DensityPct:96,HaloWidth:1,MinZoom:8,MaxZoom:22,DotSize:2}
 };
 for(const [tier,values] of Object.entries(expected)){
  for(const [suffix,value] of Object.entries(values)){
   const key='broadcast'+tier+suffix;
   assert.equal(model.DEFAULTS[key],value,key+' incorrect default');
   assert.equal(model.AGUACERO_PLACE_LABELS[key],value,key+' incorrect restore value');
  }
  for(const [suffix,value] of Object.entries({Enabled:true,Font:'Roboto Bold',Size:16,
    Color:'#ffffff',HaloColor:'#000000',Population:'all',TextBackground:false,
    DropShadow:false,Uppercase:true,Dots:false})){
   const key='broadcast'+tier+suffix;
   assert.equal(model.DEFAULTS[key],value,key+' common default');
   assert.equal(model.AGUACERO_PLACE_LABELS[key],value,key+' restore mismatch');
  }
 }
 assert.equal(model.DEFAULTS.broadcastMajorCityMinZoom,2,'major cities must respect Aguacero City min zoom 2');
 assert.equal(model.AGUACERO_PLACE_LABELS.broadcastMajorCityMinZoom,2,'restore button must reset major city min zoom to 2');
 // New scenes receive the canonical four-tier defaults, not legacy DIN.
 const fresh={broadcastBase:'satellite'};
 model.ensureConfig(fresh);
 for(const key of Object.keys(model.AGUACERO_PLACE_LABELS))
  assert.equal(fresh[key],model.AGUACERO_PLACE_LABELS[key],key+' new-scene value');
});

test('one-click restore button calls EXACT SAME preset and preserves unrelated settings',()=>{
 const start=source.indexOf('  const WD_DEFAULTS = {');
 const end=source.indexOf('  const wdConfigKey = bg =>',start);
 const model=new Function('MB',source.slice(start,end)+';return MB;')({});
 const at=ui.indexOf('        const applyAguaLabels=()=>{'),stop=ui.indexOf("        p.append(mapAccordion('labels'",at);
 assert.ok(at>=0&&stop>at,'restore handler must exist');
 let calls=0;
 const scene={broadcastCityFont:'DIN Pro Medium',broadcastTownSize:30,
   broadcastVillageHaloWidth:5,broadcastHamletMinZoom:10,
   broadcastShowCountryBorders:false,broadcastLandColor:'#123456',
   broadcastBase:'dark'};
 const restore=new Function('g','b','commit','renderPanels','toast',
  ui.slice(at,stop)+';return applyAguaLabels;')({MB:model},scene,()=>calls++,()=>calls++,()=>{});
 restore();
 assert.equal(calls,2,'update and re-render exactly once');
 for(const [key,value] of Object.entries(model.AGUACERO_PLACE_LABELS))
  assert.equal(scene[key],value,'button mismatch: '+key);
 assert.equal(scene.broadcastShowCountryBorders,false,'must preserve boundaries');
 assert.equal(scene.broadcastLandColor,'#123456','must preserve chosen land');
 assert.equal(scene.broadcastBase,'dark','must preserve map mode');
 scene.broadcastTownFont='Open Sans Bold';
 restore();
 assert.equal(scene.broadcastTownFont,model.DEFAULTS.broadcastTownFont,'button must work repeatedly');
 assert.equal(model.AGUACERO_PLACE_LABELS.broadcastHamletMinZoom,8);
});

test('legacy Village settings carry into Hamlet on old saved scenes, then become independent',()=>{
 const start=source.indexOf('  const WD_DEFAULTS = {');
 const end=source.indexOf('  const wdConfigKey = bg =>',start);
 const model=new Function('MB',source.slice(start,end)+';return MB;')({});
 const legacy={
  broadcastCityFont:'Open Sans Bold',broadcastCitySize:21,
  broadcastTownFont:'Roboto Medium',broadcastTownSize:17,
  broadcastVillageFont:'DIN Pro Bold',broadcastVillageSize:15,
  broadcastVillageHaloWidth:3.25,broadcastVillageColor:'#aabbcc',
  broadcastVillageDensityPct:47,broadcastVillageMinZoom:9,broadcastVillageMaxZoom:19,
  broadcastVillageEnabled:true,broadcastVillageDots:true,broadcastVillageDotSize:5
 };
 model.ensureConfig(legacy);
 assert.equal(legacy.broadcastCityFont,'Open Sans Bold');
 assert.equal(legacy.broadcastTownSize,17);
 for(const [suffix,value] of Object.entries({Font:'DIN Pro Bold',Size:15,
    HaloWidth:3.25,Color:'#aabbcc',DensityPct:47,MinZoom:9,MaxZoom:19,
    Enabled:true,Dots:true,DotSize:5}))
  assert.equal(legacy['broadcastHamlet'+suffix],value,'legacy Hamlet migration '+suffix);
 legacy.broadcastHamletFont='Roboto Bold';
 legacy.broadcastVillageFont='Open Sans Semibold';
 model.ensureConfig(legacy);
 assert.equal(legacy.broadcastHamletFont,'Roboto Bold');
 assert.equal(legacy.broadcastVillageFont,'Open Sans Semibold');
});

test('Hamlets are separate from Villages in feature filters, zoom and styling',()=>{
 const base={...cfg,broadcastCityEnabled:true,broadcastTownEnabled:true,
   broadcastVillageEnabled:true,broadcastHamletEnabled:true,
   broadcastVillageFont:'DIN Pro Bold',broadcastVillageSize:14,
   broadcastHamletFont:'Roboto Bold',broadcastHamletSize:16,
   broadcastVillageMinZoom:6,broadcastVillageMaxZoom:22,
   broadcastHamletMinZoom:8,broadcastHamletMaxZoom:22};
 const built=render(base);
 const village=built.find(l=>l.id==='wd-small-place-labels'),
    hamlet=built.find(l=>l.id==='wd-hamlet-labels');
 assert.ok(village,'village labels exist');
 assert.ok(hamlet,'hamlet labels exist');
 assert.equal(village.minzoom,6);
 assert.equal(hamlet.minzoom,8);
 assert.equal(village.layout['text-size'],14);
 assert.equal(hamlet.layout['text-size'],16);
 assert.deepEqual(hamlet.layout['text-font'],fontStack('Roboto Bold'));
 const props=t=>({class:'settlement',type:t,filterrank:1,symbolrank:2});
 assert.equal(evalFilter(village.filter,props('village')),true);
 assert.equal(evalFilter(village.filter,props('hamlet')),false);
 assert.equal(evalFilter(hamlet.filter,props('village')),false);
 assert.equal(evalFilter(hamlet.filter,props('hamlet')),true);
 assert.equal(render({...base,broadcastHamletEnabled:false}).some(l=>l.id==='wd-hamlet-labels'),false);
 assert.ok(render({...base,broadcastHamletEnabled:false}).some(l=>l.id==='wd-small-place-labels'));
});

test('loading older cloud style does not leak another scene Hamlet/City settings',()=>{
 const start=source.indexOf('  const WD_DEFAULTS = {');
 const end=source.indexOf('  const wdConfigKey = bg =>',start);
 const model=new Function('MB',source.slice(start,end)+';return MB;')({});
 const from=ui.indexOf('    // Always discard ONLY the scene');
 const to=ui.indexOf('    if(cfg.proj===',from);
 assert.ok(from>=0&&to>from,'cloud map style import code exists');
 const importStyle=new Function('b','cfg','g',ui.slice(from,to)+';return b;');
 const active={broadcastCityFont:'Roboto Bold',
  broadcastCitySize:37,broadcastHamletFont:'Open Sans Bold',
  broadcastHamletMinZoom:1,broadcastVillageFont:'DIN Pro Medium',
  broadcastVillageMinZoom:3,broadcastLandColor:'#556677'};
 model.ensureConfig(active);
 const older={broadcastCityFont:'DIN Pro Bold',broadcastCitySize:19,
  broadcastTownFont:'Roboto Medium',broadcastVillageFont:'Open Sans Semibold',
  broadcastVillageMinZoom:10,broadcastVillageSize:12,
  broadcastLandColor:'#223344'};
 importStyle(active,older,{MB:model});
 model.ensureConfig(active);
 assert.equal(active.broadcastCitySize,19);
 assert.equal(active.broadcastCityFont,'DIN Pro Bold');
 assert.equal(active.broadcastTownFont,'Roboto Medium');
 assert.equal(active.broadcastVillageFont,'Open Sans Semibold');
 assert.equal(active.broadcastHamletFont,'Open Sans Semibold');
 assert.equal(active.broadcastHamletMinZoom,10);
 assert.equal(active.broadcastHamletSize,12);
 assert.equal(active.broadcastLandColor,'#223344');
 // A new-style preset's own Hamlet choices must survive full import.
 const modern={broadcastCityFont:'Roboto Bold',broadcastHamletFont:'Roboto Medium',
   broadcastHamletMinZoom:9,broadcastHamletSize:14,
   broadcastVillageFont:'DIN Pro Bold',broadcastVillageMinZoom:6};
 importStyle(active,modern,{MB:model});
 model.ensureConfig(active);
 assert.equal(active.broadcastHamletFont,'Roboto Medium');
 assert.equal(active.broadcastHamletMinZoom,9);
 assert.equal(active.broadcastHamletSize,14);
});
