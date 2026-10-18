/* Node built-in tests for WX Studio weather foundation (no live NOAA calls). */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','studio','weather');
const env={};
function load(p){
 const js=fs.readFileSync(path.join(root,p),'utf8');
 new Function('window','globalThis',js)(env,env);
 return js;
}
load('sources.js');load('palettes.js');load('nexrad_sites.js');
test('catalog lists both operational GOES satellites and all 4 sectors at native ABI band-2 0.5 km',()=>{
 const goes=env.WXWeatherSources.products.filter(p=>p.category==='satellite');
 assert.ok(goes.length>=36);
 for(const sat of ['g19','g18'])for(const sector of ['conus','fulldisk','meso1','meso2']){
  const id=sat+'_'+sector+'_abi_c02';
  const p=env.WXWeatherSources.byId(id);assert.ok(p,id);
  assert.equal(p.resolutionKm,.5,id+' native ABI visible');
  assert.equal(p.format,'netCDF4');
  assert.equal(p.status,'decoder-needed');
  if(sector.startsWith('meso')){assert.equal(p.cadenceMinutes,1);assert.ok(p.prefix.endsWith('M'));}
 }
 assert.equal(env.WXWeatherSources.byId('g19_meso1_abi_c02').bucket,'noaa-goes19');
 assert.equal(env.WXWeatherSources.byId('g18_meso2_abi_c02').bucket,'noaa-goes18');
});
test('radar catalog distinguishes native Level II from 1-km MRMS, never registers fake feed',()=>{
 const c=env.WXWeatherSources;
 assert.equal(c.byId('mrms_mosaic_reflectivity').resolutionKm,1);
 assert.equal(c.byId('nexrad_level2_base_reflectivity').bucket,'unidata-nexrad-level2');
 assert.equal(c.byId('nexrad_level2_velocity').palette,'radar/velocity');
 assert.equal(c.providerStatus,'catalog-only');
 assert.equal(c.byId('mrms_mosaic_reflectivity').historyHours,null);
 assert.equal(c.byId('mrms_nws_4hour_image').historyHours,4);
 assert.equal(c.byId('mrms_nws_4hour_image').palette,null);
 // The NWS ImageServer is a browser-only experimental preview, not a native decoded NOAA feed.
 assert.equal(c.byId('mrms_nws_4hour_image').status,'browser-preview-under-test');
 assert.ok(!('WXData' in env),'no feed should be auto-registered while decoder unavailable');
});
test('built-in palettes have valid ascending stops and product category assignments',()=>{
 const p=env.WXWeatherPalettes;
 const all=p.list();assert.ok(all.length>=5);
 for(const pal of all)assert.doesNotThrow(()=>p.validate(pal),pal.id);
 assert.equal(p.paint('radar/reflectivity',0),null);
 assert.equal(p.paint('radar/reflectivity',5),'#04e9e7');
 assert.equal(p.paint('radar/reflectivity',100),'#ffffff');
 assert.equal(p.get('satellite/ir-enhanced').units,'°C');
 assert.equal(p.get('satellite/cloud-top-temperature').units,'K');
 assert.equal(p.presetPaths.radar.includes('/radar/'),true);
});
test('custom palettes are separate from built-ins and validate no duplicate/scrambled thresholds',()=>{
 const p=env.WXWeatherPalettes,orig=p.get('radar/reflectivity');
 p.add({id:'custom/my-test',category:'custom',stops:[[0,'#000000'],[2,'#ffffff']]});
 assert.equal(p.paint('custom/my-test',1),'#000000');
 assert.equal(p.get('radar/reflectivity'),orig);
 assert.throws(()=>p.add({id:'custom/bad',category:'custom',stops:[[3,'#000000'],[2,'#ffffff']]}));
});
test('NOAA station locations parsed safely with K-prefixed radar site and correct coordinates',()=>{
 const n=env.WXWeatherRadarSites;
 const stations=n.parse({features:[{attributes:{STATION_ID:'BOX',STATION_NAME:'Boston',LATITUDE:41.96,LONGITUDE:-71.14}},
 {attributes:{STATION_ID:'KOKX',STATION_NAME:'New York',LATITUDE:40.87,LONGITUDE:-72.86}},
 {attributes:{STATION_ID:'BAD!',LATITUDE:0,LONGITUDE:0}}]});
 assert.deepEqual(stations.map(s=>s.id),['KBOX','KOKX']);
 assert.equal(n.nearest(-71.14,41.96,25).id,'KBOX');
 assert.equal(n.nearest(-99,0,25),null);
 assert.equal(n.stations[0].id,'KBOX','regional fallback should show Boston WSR-88D not KBOS');
});
test('all scripts pass JavaScript parse without window or DOM execution',()=>{
 for(const f of ['sources.js','palettes.js','cloud_palettes.js','nexrad_sites.js'])
  assert.doesNotThrow(()=>new Function(fs.readFileSync(path.join(root,f),'utf8')));
});
