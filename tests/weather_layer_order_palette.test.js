'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const mapbox=read('studio/mapbox.js');
const bridge=read('studio/weather/processor_bridge.js');
const workspace=read('studio/weather_workspace.js');
const cloud=read('studio/weather/cloud_palettes.js');
function makeMap(){
 const map={layers:[
  {id:'land',type:'fill'},{id:'coastline',type:'line'},
  {id:'settlement-major-label',type:'symbol'},{id:'wd-city-labels',type:'symbol'}
 ],sources:{},paints:{},updates:0,
 getStyle(){return {layers:this.layers}},
 getLayer(id){return this.layers.find(l=>l.id===id)},
 getSource(id){return this.sources[id]},
 addSource(id,def){this.sources[id]={...def,updateImage(spec){Object.assign(this,spec);map.updates++}}},
 removeSource(id){delete this.sources[id]},
 addLayer(layer,before){const p=this.layers.findIndex(l=>l.id===before);
  if(p<0)this.layers.push(layer);else this.layers.splice(p,0,layer)},
 removeLayer(id){this.layers=this.layers.filter(l=>l.id!==id)},
 moveLayer(id,before){const layer=this.getLayer(id);this.removeLayer(id);this.addLayer(layer,before)},
 setPaintProperty(id,name,value){this.paints[id+':'+name]=value},
 triggerRepaint(){}
 };
 return map;
}
function setup(){
 const map=makeMap(),MB={status:'ready',cache:new Map([['old','old']])};
 const a=mapbox.indexOf('  const WX_FRAME_SOURCE=');
 const b=mapbox.indexOf('  function loadLib()',a);
 assert.ok(a>0&&b>a,'weather block exists');
 new Function('MB','D','var liveKey=null;\n'+mapbox.slice(a,b))(MB,map);
 return {map,MB};
}
const frame=(order='below-labels',id='a')=>({
 url:'https://example.test/frame.png',bbox:[-75,35,-65,45],crs:'4326',
 opacity:.75,id,order
});
test('below-labels raster is below coastline and all city text',()=>{
 const {map,MB}=setup();
 assert.equal(MB.weatherLayerPositionSupported,true);
 MB.setWeatherFrame(frame());
 assert.ok(map.layers.findIndex(l=>l.id==='wd-weather-data-raster')<
  map.layers.findIndex(l=>l.id==='coastline'));
 assert.ok(map.layers.findIndex(l=>l.id==='wd-weather-data-raster')<
  map.layers.findIndex(l=>l.id==='wd-city-labels'));
 assert.equal(MB.cache.size,0,'new frame invalidates screenshot cache');
});
test('switching above/below reorders an existing raster and reuses source',()=>{
 const {map,MB}=setup();
 MB.setWeatherFrame(frame());
 MB.setWeatherFrame(frame('above-labels'));
 assert.equal(map.layers.at(-1).id,'wd-weather-data-raster');
 assert.equal(map.layers.filter(l=>l.id==='wd-weather-data-raster').length,1);
 MB.setWeatherFrame(frame());
 assert.ok(map.layers.findIndex(l=>l.id==='wd-weather-data-raster')<
  map.layers.findIndex(l=>l.id==='settlement-major-label'));
});
test('weather opacity and frame revision update raster without resetting style',()=>{
 const {map,MB}=setup();MB.setWeatherFrame(frame());
 MB.setWeatherFrame({...frame(),'opacity':.25,id:'new-palette:revision2'});
 assert.equal(map.paints['wd-weather-data-raster:raster-opacity'],.25);
 assert.ok(map.updates>=1,'new ID forces image-source update');
 MB.setWeatherFrame(null);
 assert.equal(map.getLayer('wd-weather-data-raster'),undefined);
 assert.equal(map.getSource('wd-weather-data-image'),undefined);
});
test('workspace only enables layer buttons if Mapbox supports positioning',()=>{
 assert.ok(workspace.includes('!!g.MB?.weatherLayerPositionSupported'));
 assert.ok(workspace.includes("raw.order === 'above-labels'"));
 assert.ok(bridge.includes("order:dl.order==='above-labels'?'above-labels':'below-labels'"));
 assert.ok(bridge.includes("dl.palette||''"));
 assert.ok(bridge.includes("frame.revision||''"));
});
test('cloud palette save sends continuous boolean and list receives it',async()=>{
 assert.ok(cloud.includes('continuous:continuous===true'));
 const requests=[],row={id:'sample',continuous:true,stops:[[0,'#000000'],[10,'#ffffff']]};
 const g={
  WX_CLOUD_CONFIG:{url:'https://example.supabase.co',publishableKey:'public-test'},
  WXCloudPresets:{ensureSession:async()=>({user:{id:'owner'},access_token:'test'})},
  WXWeatherPalettes:{validate:()=>{}}
 };
 const fetch=async(url,opt)=>{requests.push({url,opt});
  return {ok:true,json:async()=>opt?.method==='POST'?[row]:[row]};};
 vm.runInNewContext(cloud,{window:g,fetch,console});
 const saved=await g.WXWeatherPaletteCloud.save({
  category:'satellite',productId:'abi_c13',name:'Smooth IR',
  continuous:true,stops:row.stops
 });
 assert.equal(saved.continuous,true);
 const sent=JSON.parse(requests[0].opt.body);
 assert.equal(sent.continuous,true);
 assert.equal(sent.product_id,'abi_c13');
 const listed=await g.WXWeatherPaletteCloud.list('satellite');
 assert.equal(listed[0].continuous,true);
});
test('workspace cloud editor sends smooth flag and does not warn it is lost',()=>{
 assert.ok(workspace.includes('continuous: e.continuous === true'));
 assert.ok(workspace.includes('row.continuous === true'));
 assert.ok(!workspace.includes('Smooth blending is not stored in the cloud yet'));
});
