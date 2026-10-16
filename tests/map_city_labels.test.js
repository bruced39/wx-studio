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
 ';return {settlementLayer,tierAppearance,addLabelDots,applyLabelBackground,tierFilter};')(fontStack,padding);
const maker=labels.settlementLayer;
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
  'installTransportation','installOverlays','settlementLayer','wdFontStack','labelPadding','tierAppearance','addLabelDots','applyLabelBackground',
  nativeCode+';return addBroadcastCartography;')(()=> 'composite',()=>{},()=>{},()=>{},()=>{},()=>{},maker,fontStack,padding,
    labels.tierAppearance,labels.addLabelDots,()=>{});
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
  'installTransportation','installOverlays','settlementLayer','wdFontStack','labelPadding','tierAppearance','addLabelDots','applyLabelBackground',
  nativeCode+';return addBroadcastCartography;')(()=> 'composite',()=>{},()=>{},()=>{},()=>{},()=>{},maker,fontStack,padding,
    labels.tierAppearance,labels.addLabelDots,()=>{});
 // Simulate a Mapbox Streets v12 stock filter: these real built-in
 // constraints MUST survive every WX Studio rank/density setting.
 const stockMajor=['all',
   ['match',['get','class'],['settlement','disputed_settlement'],true,false],
   ['<=',['get','filterrank'],3],
   ['<=',['get','symbolrank'],6]];
 const nativeSort=['step',['get','symbolrank'],18,6,16,7,14];
 const orig=id=>({id,type:'symbol',source:'composite','source-layer':'place_label',
  minzoom:2,maxzoom:15,
  filter:id==='settlement-major-label'?JSON.parse(JSON.stringify(stockMajor)):null,
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
 assert.equal(evalFilter(map.getLayer('settlement-major-label').filter,baselineOnly),true,
  'original Mapbox disputed/city type is preserved by baseline OR');
 const restoredFilter=map.getLayer('settlement-major-label').filter;
 assert.deepEqual(restoredFilter[1],stockMajor,'stock filter was cached unmodified');
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
 assert.equal(model.DEFAULTS.broadcastCityFont,'DIN Pro Bold');
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
