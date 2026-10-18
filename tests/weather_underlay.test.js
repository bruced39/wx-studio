/* Weather data underlay regression checks. Run: node --test tests/weather_underlay.test.js */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const mapbox=fs.readFileSync(path.join(root,'studio/mapbox.js'),'utf8');
const engine=fs.readFileSync(path.join(root,'studio/engine.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'studio/weather/processor_bridge.js'),'utf8');
const index=fs.readFileSync(path.join(root,'studio/index.html'),'utf8');
const app=fs.readFileSync(path.join(root,'app.py'),'utf8');
const sample={id:'mrms:1800000000000',url:'https://wx.example/frames/mrms-reflectivity/1800000000000.png',
  bbox:[-76,39,-66,46],crs:'4326',opacity:.8};

function makeMap(){
 const map={
  layers:[{id:'background',type:'background'},{id:'land',type:'fill'},
   {id:'coastline',type:'line'},{id:'city-labels',type:'symbol'}],
  sources:{},paints:{},images:[],repaints:0,
  getStyle(){return {layers:this.layers}},
  getSource(id){return this.sources[id]},
  getLayer(id){return this.layers.find(l=>l.id===id)},
  addSource(id,def){const m=this;this.sources[id]={...def,
   updateImage(next){m.images.push(next);Object.assign(this,next)}}},
  addLayer(layer,before){let idx=this.layers.findIndex(x=>x.id===before);if(idx<0)idx=this.layers.length;this.layers.splice(idx,0,layer)},
  moveLayer(id,before){const l=this.getLayer(id);this.removeLayer(id);this.addLayer(l,before)},
  removeLayer(id){this.layers=this.layers.filter(l=>l.id!==id)},
  removeSource(id){delete this.sources[id]},
  setPaintProperty(id,key,value){this.paints[id+':'+key]=value},
  triggerRepaint(){this.repaints++}
 };
 return map;
}

test('Mapbox frame source is placed below coasts, roads and city names',()=>{
 const begin=mapbox.indexOf('  const WX_FRAME_SOURCE='),end=mapbox.indexOf('  function loadLib()',begin);
 assert.ok(begin>=0&&end>begin,'Mapbox underlay code must exist');
 const map=makeMap(),MB={cache:new Map([['old','canvas']]),status:'ready'};
 // These helpers close over the REAL source/layer algorithm in mapbox.js.
 const lib=new Function('MB','D','let liveKey=null;'+mapbox.slice(begin,end)+
  ';return {update:MB.setWeatherFrame};')(MB,map);
 lib.update(sample);
 assert.deepEqual(map.layers.map(x=>x.id),
  ['background','land','wd-weather-data-raster','coastline','city-labels']);
 assert.equal(map.getSource('wd-weather-data-image').type,'image');
 assert.deepEqual(map.getSource('wd-weather-data-image').coordinates,
  [[-76,46],[-66,46],[-66,39],[-76,39]]);
 assert.equal(map.paints['wd-weather-data-raster:raster-opacity'],undefined);
 assert.equal(map.getLayer('wd-weather-data-raster').paint['raster-opacity'],.8);
 assert.equal(MB.cache.size,0,'old cached maps must be invalidated');
 lib.update({...sample,id:'mrms:1800000300000',
  url:'https://wx.example/frames/mrms-reflectivity/1800000300000.png'});
 assert.equal(map.images.length,1,'next frame must update existing image');
 assert.equal(map.repaints>=2,true);
 lib.update(null);
 assert.equal(map.getLayer('wd-weather-data-raster'),undefined);
 assert.equal(map.getSource('wd-weather-data-image'),undefined);
});

test('weather underlay does not accept unprojected or invalid image URLs',()=>{
 const begin=mapbox.indexOf('  const WX_FRAME_SOURCE='),end=mapbox.indexOf('  function loadLib()',begin);
 const map=makeMap(),MB={cache:new Map(),status:'ready'};
 new Function('MB','D','let liveKey=null;'+mapbox.slice(begin,end))(MB,map);
 MB.setWeatherFrame({...sample,crs:'3857'});
 assert.equal(map.getLayer('wd-weather-data-raster'),undefined);
 MB.setWeatherFrame({...sample,url:'http://insecure.example/frame.png'});
 assert.equal(map.getSource('wd-weather-data-image'),undefined);
});

test('preview and export select image BEFORE the finished map is drawn',()=>{
 const r=engine.indexOf('E.renderScene = function');
 const scene=engine.slice(r,engine.indexOf('  /* ---------- schedule',r));
 assert.ok(scene.indexOf('useMapboxUnderlay(scene,t,opts)')>=0);
 assert.ok(scene.indexOf('useMapboxUnderlay(scene,t,opts)')<
    scene.indexOf('drawBackground(c, show, scene'));
 const p=engine.slice(engine.indexOf('E.prepareFrame = async function'),
   engine.indexOf('E.renderShow =',engine.indexOf('E.prepareFrame = async function')));
 assert.ok(p.indexOf('await g.WXData.ensure(s)')<p.indexOf('await g.MB.snap(s.bg'));
 assert.ok(p.indexOf('useMapboxUnderlay(s,tt')<p.indexOf('await g.MB.snap(s.bg'));
 assert.ok(mapbox.includes('applyWeatherUnderlay(D);'),'must reinstall after style updates');
 assert.ok(mapbox.includes("MB._weatherKey||'no-weather'"),'frame must affect cache key');
});

test('weather source bridge requires an explicitly configured processor',()=>{
 assert.ok(bridge.includes('WX_WEATHER_PROCESSOR_URL'));
 assert.ok(bridge.includes("status:endpoint?'checking':'not-configured'"));
 assert.ok(bridge.includes("if(endpoint){refresh()"),'do not connect fake feeds');
 assert.ok(bridge.includes("return p?manifest(p,hours):Promise.resolve([])"),'do not substitute wrong radar site');
 assert.ok(bridge.includes("if(scene?.bg?.type==='mapbox')return"),
   'no canvas weather overlaid on city labels');
 assert.ok(index.includes('weather/processor_bridge.js'));
 assert.ok(app.includes('WX_WEATHER_PROCESSOR_URL'));
});
