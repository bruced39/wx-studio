/* Real NOAA scientific processor -> existing WX Studio data loop bridge.
 * No synthetic scans, never test live NOAA network on CI.
 */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../studio/weather/processor_bridge.js'),'utf8');
const NOW=Date.now();
const products=[
 {product:'goes-east-conus-C02',earliestObservationUtc:NOW-3600000,latestObservationUtc:NOW-120000,frameCount:15},
 {product:'goes-west-meso1-C02',earliestObservationUtc:NOW-3600000,latestObservationUtc:NOW-60000,frameCount:12},
 {product:'goes-east-full-C13',earliestObservationUtc:NOW-3600000,latestObservationUtc:NOW-60000,frameCount:8},
 {product:'mrms-reflectivity',earliestObservationUtc:NOW-4*3600000,latestObservationUtc:NOW-30000,frameCount:45},
 {product:'nexrad-reflectivity-KBOX',earliestObservationUtc:NOW-2*3600000,latestObservationUtc:NOW-180000,frameCount:6}
];
function harness({catalog=products,timestamps=[]}={}){
 const D={sources:{},state:new WeakMap(),registerSource(def){this.sources[def.id]=def}};
 const list=timestamps.length?timestamps:Array.from({length:40},(_,i)=>NOW-3600000+i*90000);
 const frame=id=>list.map(t=>({t,bbox:[-82,35.5,-64.5,49],crs:'4326',
  url:'https://processor.example/frames/'+id+'/'+t+'.png'}));
 const request=[];
 async function fetch(url){
  request.push(url);
  let doc;
  if(url.endsWith('/catalog'))doc={schema:'wxstudio.frames.v1',products:catalog};
  else {
   const id=/\/manifests\/([a-z0-9-]+)\.json/.exec(url)?.[1];
   doc={schema:'wxstudio.frames.v1',product:id,frames:frame(id)};
  }
  return {ok:true,json:async()=>doc};
 }
 const env={WX_WEATHER_PROCESSOR_URL:'https://processor.example',WXData:D,
  fetch,Date,URL,AbortController,setTimeout,clearTimeout,
  setInterval(){return 0},console,WeakMap,Promise};
 env.window=env;
 vm.runInNewContext(source,env);
 return {env,D,request,refresh:()=>env.WXWeatherProcessorBridge.refresh()};
}
test('only actual decoded GOES/Level II native products appear as distinct menu choices',async()=>{
 const {D,refresh}=harness();await refresh();
 for(const id of ['goes-east-conus-C02','goes-west-meso1-C02','goes-east-full-C13',
  'mrms','nexrad','goes']) assert.ok(D.sources[id],id+' registered');
 assert.match(D.sources['goes-east-conus-C02'].label,/GOES-19 East.*Visible 0.5 km/);
 assert.match(D.sources['goes-west-meso1-C02'].label,/GOES-18 West.*Mesoscale 1/);
 assert.deepEqual(Array.from(D.sources['goes-east-full-C13'].lengths),[1]);
 assert.deepEqual(Array.from(D.sources.mrms.lengths),[1,2,4]);
 assert.equal(D.sources.nexrad.defaultSite,'KBOX');
 assert.equal(D.sources.rtma,undefined,'NO RTMA before user selects variables');
});
test('an absent native product is not displayed as connected',async()=>{
 const {D,refresh}=harness({catalog:products.slice(0,1)});
 await refresh();
 assert.ok(D.sources['goes-east-conus-C02']);
 assert.equal(D.sources['goes-west-meso1-C02'],undefined);
 assert.equal(D.sources.mrms,undefined);
 assert.equal(D.sources.nexrad,undefined);
});
test('large native GOES frames use a bounded, time-spaced subset of REAL timestamps',async()=>{
 const {D,refresh}=harness();await refresh();
 const frames=await D.sources['goes-east-conus-C02'].list({hours:1});
 assert.equal(frames.length,8,'never eagerly decode dozens of 0.5 km bitmaps');
 assert.equal(frames[0].t,NOW-3600000);
 assert.equal(frames.at(-1).t,NOW-3600000+39*90000);
 for(const f of frames){
  assert.equal(f.crs,'4326');
  assert.match(f.url,/^https:\/\/processor\.example\/frames\/goes-east-conus-C02\/\d{13}\.png$/);
 }
 const mrms=await D.sources.mrms.list({hours:1});
 assert.equal(mrms.length,24);
});
test('fake third-party-frame URLs are refused and never displayed',async()=>{
 const {env,D,refresh}=harness();await refresh();
 // Frame validation is done at each list invocation, and must reject any
 // image located off the configured processor origin.
 const orig=env.fetch;
 env.fetch=async url=>{
  if(url.includes('/manifests/'))return {ok:true,json:async()=>({
   schema:'wxstudio.frames.v1',product:'goes-east-conus-C02',
   frames:[{t:NOW-60000,bbox:[-82,35.5,-64.5,49],crs:'4326',
    url:'https://unknown.example/frames/goes-east-conus-C02/'+(NOW-60000)+'.png'}]
  })};
  return orig(url);
 };
 const result=await D.sources['goes-east-conus-C02'].list({hours:1});
 assert.equal(result.length,0);
});
