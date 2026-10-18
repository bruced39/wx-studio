/* NOAA MRMS regional browser pilot (non-synthetic data) regression tests.
 * Mocks only the network; never claims actual NOAA browser CORS validation.
 */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'studio/weather/sources.js'),'utf8');
const index=fs.readFileSync(path.join(root,'studio/index.html'),'utf8');
const bridge=fs.readFileSync(path.join(root,'studio/weather/processor_bridge.js'),'utf8');

function setup({times=[],start,end,failQuery=false,failMetadata=false}={}){
 const now=Date.now();
 const observations=times.length?times:Array.from({length:13},(_,i)=>now-(12-i)*300000);
 const a=start??now-90*60000,b=end??now-2*60000;
 const log=[],wx={sources:{},registerSource(def){this.sources[def.id]=def}};
 async function network(url,opts){
  log.push({url:String(url),options:opts});
  if(String(url).includes('/query?')){
   if(failQuery)return {ok:false,status:403};
   return {ok:true,json:async()=>({features:observations.map(t=>({attributes:{idp_validtime:t}}))})};
  }
  if(String(url).endsWith('?f=pjson')){
   if(failMetadata)return {ok:false,status:503};
   return {ok:true,json:async()=>({timeInfo:{timeExtent:[a,b]}})};
  }
  throw Error('Unexpected HTTP URL '+url);
 }
 const win={WXData:wx};
 new Function('window','fetch',source)(win,network);
 return {catalog:win.WXWeatherSources,wx,requests:log};
}
test('real NOAA MRMS preview is registered; GOES and Level II remain unconnected',()=>{
 const {catalog,wx}=setup();
 assert.ok(wx.sources.mrms);
 assert.equal(wx.sources.mrms.nativeData,false);
 assert.deepEqual(wx.sources.mrms.lengths,[1]);
 assert.ok(!wx.sources.goes&&!wx.sources.nexrad);
 assert.match(wx.sources.mrms.label,/test/i);
 assert.equal(catalog.byId('mrms_nws_4hour_image').status,'browser-preview-under-test');
});
test('one-hour preview only uses actual unique NOAA observation times',async()=>{
 const now=Date.now(),five=300000;
 const times=[now-70*60000,now-20*60000,now-20*60000,now-15*60000,
  now-10*60000,now-5*60000,now+30*60000];
 const {wx,requests}=setup({times,start:now-2*3600000,end:now});
 const frames=await wx.sources.mrms.list({hours:1});
 assert.deepEqual(frames.map(f=>f.t),[now-20*60000,now-15*60000,now-10*60000,now-5*60000]);
 assert.ok(frames.every(f=>f.crs==='4326'&&f.bbox.length===4));
 assert.ok(requests.some(x=>x.url.includes('/query?')));
 const q=new URL(requests.find(x=>x.url.includes('/query?')).url);
 assert.equal(q.searchParams.get('returnDistinctValues'),'true');
 assert.equal(q.searchParams.get('outFields'),'idp_validtime');
 assert.equal(five,300000);
});
test('each frame requests NOAA timestamped transparent high-resolution PNG32',async()=>{
 const now=Date.now();
 const {wx}=setup({times:[now-15*60000,now-10*60000,now-5*60000],
 start:now-3600000,end:now});
 const frames=await wx.sources.mrms.list({hours:1});
 for(const f of frames){
  const url=new URL(f.url);
  assert.equal(url.hostname,'mapservices.weather.noaa.gov');
  assert.ok(url.pathname.endsWith('/radar_base_reflectivity_time/ImageServer/exportImage'));
  assert.equal(url.searchParams.get('f'),'image');
  assert.equal(url.searchParams.get('format'),'png32');
  assert.equal(url.searchParams.get('transparent'),'true');
  assert.equal(url.searchParams.get('bboxSR'),'4326');
  assert.equal(url.searchParams.get('imageSR'),'4326');
  assert.equal(url.searchParams.get('size'),'3072,2304');
  assert.equal(Number(url.searchParams.get('time')),f.t);
  assert.deepEqual(f.bbox,[-82,35.5,-64.5,49]);
 }
});
test('never show stale metadata or synthetic/fabricated frames',async()=>{
 const now=Date.now();
 const stale=setup({start:now-3*3600000,end:now-90*60000});
 await assert.rejects(()=>stale.wx.sources.mrms.list({hours:1}),/not current/);
 const noTimes=setup({times:[now-5*60000],end:now});
 await assert.rejects(()=>noTimes.wx.sources.mrms.list({hours:1}),/fewer than two/);
});
test('NOAA service HTTP errors propagate so the loop can show an error',async()=>{
 const meta=setup({failMetadata:true});
 await assert.rejects(()=>meta.wx.sources.mrms.list({hours:1}),/HTTP 503/);
 const catalog=setup({failQuery:true});
 await assert.rejects(()=>catalog.wx.sources.mrms.list({hours:1}),/HTTP 403/);
});
test('registered through existing script order and Mapbox beneath label layers',()=>{
 const a=index.indexOf('src="dataloop.js"'),b=index.indexOf('src="weather/sources.js"');
 assert.ok(a>=0&&b>a,'provider registration after playback registry');
 assert.match(bridge,/D\.useMapboxUnderlay=function/);
 assert.match(bridge,/if\(scene\?\.bg\?\.type==='mapbox'\)return;/);
});
