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

test('MRMS preview selects NOAA observation scans across the hour, not repeated catalog timestamps',async()=>{
 const code=fs.readFileSync(path.join(root,'sources.js'),'utf8');
 const NOW=Date.UTC(2026,9,18,18,0,0);
 class FixedDate extends Date {static now(){return NOW;}}
 const actual=[];
 for(let i=0;i<=12;i++){
  const scan=NOW-i*300000;
  // NOAA ArcGIS may expose multiple distinct seconds within the SAME scan.
  // v0.9.84 selected the last twelve catalog rows, making 1:44 repeat.
  for(const offset of [11000,25000,40000])actual.push(scan+offset);
 }
 const catalog=actual.slice().sort((a,b)=>b-a);
 const urls=[],window={};
 const fetch=async url=>{
  urls.push(String(url));
  if(String(url).includes('?f=pjson'))return {ok:true,json:async()=>({
   timeInfo:{timeExtent:[NOW-4*3600000,NOW+40000]}
  })};
  const count=+(new URL(String(url)).searchParams.get('resultRecordCount')||150);
  return {ok:true,json:async()=>({
   features:catalog.slice(0,count).map(t=>({attributes:{idp_validtime:t}}))
  })};
 };
 new Function('window','globalThis','fetch','Date','AbortController',
  'setTimeout','clearTimeout',code)(
   window,window,fetch,FixedDate,AbortController,setTimeout,clearTimeout);
 const source=window.WXWeatherSources.mrmsBrowserTest;
 const frames=await source.list({hours:1});
 assert.equal(frames.length,12,'twelve or fewer genuine five-minute observations');
 assert.ok(frames.every((f,i)=>i===0||f.t>frames[i-1].t),
  'scan time MUST increase chronologically during each pass');
 assert.equal(new Set(frames.map(f=>Math.floor(f.t/300000))).size,frames.length,
  'never show multiple frames for the same five-minute scan slot');
 assert.ok(frames.at(-1).t-frames[0].t>=50*60000,
  'hour selection must cover at least ~50 minutes when NOAA supplies it');
 assert.ok(frames.every(f=>actual.includes(f.t)),
  'only timestamps returned by NOAA are permissible; no fake observations');
 assert.ok(urls.some(u=>u.includes('resultRecordCount=1000')),
  'catalog request must look beyond the nearest 12/150 time records');
 assert.ok(frames.every(f=>f.url.includes('time='+f.t)),
  'displayed timestamp must equal the actual requested NOAA image time');
});

test('MRMS scan picker collapses minutes and never pads a short NOAA history with fake frames',()=>{
 const code=fs.readFileSync(path.join(root,'sources.js'),'utf8');
 const window={};new Function('window','globalThis',code)(window,window);
 const select=window.WXWeatherSources.mrmsBrowserTest.selectScanTimes;
 const end=Date.UTC(2026,9,18,18,0);
 const raw=[];
 for(let m=0;m<=15;m+=5)
  for(const seconds of [3,18,47])raw.push(end-m*60000+seconds*1000);
 const picked=select(raw,end-3600000,end+60000,12);
 assert.equal(picked.length,4,'multiple raster records per scan must collapse');
 assert.equal(new Set(picked.map(t=>Math.floor(t/60000))).size,4);
 assert.equal(picked.at(-1)-picked[0],15*60000);
 assert.ok(picked.every(t=>raw.includes(t)),'only real observation times selected');
});

test('weather playback timestamp warns when only a short portion of requested radar hour loaded',()=>{
 const script=fs.readFileSync(path.join(__dirname,'../studio/dataloop.js'),'utf8');
 const win={};new Function('window','globalThis',script)(win,win);
 const D=win.WXData;
 D.registerSource({id:'mrms',label:'NOAA MRMS Northeast preview',nativeData:false,
  list:async()=>[]});
 const END=Date.UTC(2026,9,18,18,0);
 const scene={dataLoop:{on:true,source:'mrms',hours:1,speed:5,idx:0}};
 const frames=[15,10,5,0].map(x=>({t:END-x*60000,img:{width:1,height:1}}));
 D.state.set(scene,{frames,lastIdx:2,total:4,loaded:4,status:'ready'});
 const l=D.barLabels(scene);
 assert.equal(l.historyShort,true);
 assert.equal(l.availableMinutes,15);
 assert.match(l.stamp,/15m available/);
 assert.equal(l.requestedMinutes,60);
 const full=Array.from({length:12},(_,i)=>({t:END-(11-i)*5*60000,img:{}}));
 D.state.set(scene,{frames:full,lastIdx:7,total:12,loaded:12,status:'ready'});
 const ok=D.barLabels(scene);
 assert.equal(ok.historyShort,false);
 assert.doesNotMatch(ok.stamp,/available/);
});
