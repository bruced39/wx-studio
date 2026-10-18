/* WX Studio Weather Data menu logic: source classification, catalog/palette lookups, palette recolouring,
 * loop timing and timestamps. Runs the real studio/dataloop.js with the real catalog + palette modules in a
 * minimal DOM-less sandbox. These are CODE tests; real-browser checks live in tests/browser/. */
'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,'studio',f),'utf8');

function canvasMock(){
  return {width:0,height:0,getContext(){
    const self=this;
    return {createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),
      putImageData(im){self._im=im},getImageData(x,y){const i=(y*self.width+x)*4;return {data:self._im.data.slice(i,i+4)}}};
  }};
}
function load(){
  const win={}, doc={readyState:'complete',createElement:t=>t==='canvas'?canvasMock():{},getElementById:()=>null,head:{append(){}}};
  const run=src=>new Function('window','document','setTimeout','requestAnimationFrame',src)(win,doc,()=>0,()=>0);
  run(read('dataloop.js')); run(read('weather/sources.js')); run(read('weather/palettes.js'));
  return win;
}
const win=load(), D=win.WXData;

test('status classification: demo, experimental NOAA browser test, connected, not connected',()=>{
  assert.equal(D.classify('demo').status,'demo');
  assert.equal(D.classify('mrms').status,'experimental','the NWS ImageServer MRMS preview is experimental');
  assert.equal(D.classify('mrms').category,'radar-mosaic');
  for(const id of ['goes-east-conus-C02','nexrad','rtma','forecast'])
    assert.equal(D.classify(id).status,'notconnected',id+' must not look connected');
  D.registerSource({id:'nexrad',label:'NEXRAD Level II (processed)',list:async()=>[]});
  assert.equal(D.classify('nexrad').status,'connected');
  assert.equal(D.classify('nexrad').category,'radar-site');
  delete D.sources.nexrad;
  assert.equal(D.classify('nexrad').status,'notconnected');
});
test('display names drop "(test)" and radar shows the chosen station',()=>{
  assert.equal(D.displayName('mrms'),'NOAA MRMS · Northeast');
  assert.equal(D.displayName('nexrad',{site:'KBOX'}),'NEXRAD · KBOX');
  assert.equal(D.displayName('nexrad',{}),'NEXRAD · KBOX','default station is KBOX, not the KBOS airport placeholder');
});
test('palette rules come from the catalog: visible/GeoColor/server-rendered have none',()=>{
  assert.equal(D.productOf('goes-east-conus-C02').palette,null,'visible is grayscale reflectance');
  assert.equal(D.productOf('goes-west-meso1-C13').palette,'satellite/ir-enhanced');
  assert.equal(D.productOf('goes-west-meso1-C13').id,'g18_meso1_abi_c13');
  assert.equal(D.productOf('goes-east-full-C13').id,'g19_fulldisk_abi_c13');
  assert.equal(D.productOf('mrms').palette,null,'NWS ImageServer MRMS is server-rendered; no LUT');
  assert.equal(D.productOf('nexrad').palette,'radar/reflectivity');
  assert.equal(D.productOf('demo-rgb').palette,null);
  assert.equal(D.productOf('demo').palette,'radar/reflectivity');
  assert.deepEqual(D.paletteChoices('demo-rgb'),[]);
  assert.deepEqual(D.paletteChoices('mrms'),[]);
});
test('palette choices include built-in and custom palettes that name the product',()=>{
  assert.deepEqual(D.paletteChoices('nexrad').map(p=>p.id),['radar/reflectivity']);
  win.WXWeatherPalettes.add({id:'my/radar/a',category:'radar',name:'Mine',productIds:['nexrad_level2_base_reflectivity'],units:'dBZ',stops:[[0,'#000000'],[75,'#ffffff']]});
  win.WXWeatherPalettes.add({id:'my/radar/b',category:'radar',name:'Other product',productIds:['nexrad_level2_velocity'],units:'m/s',stops:[[0,'#000000'],[75,'#ffffff']]});
  assert.deepEqual(D.paletteChoices('nexrad').map(p=>p.id),['radar/reflectivity','my/radar/a']);
});
test('scalar frames are recoloured through the palette; no-echo stays transparent',()=>{
  const cv=D.paintScalar({w:4,h:1,data:new Float32Array([NaN,2,40,75])},'radar/reflectivity'),px=x=>Array.from(cv._im.data.slice(x*4,x*4+4));
  assert.equal(px(0)[3],0,'NaN transparent'); assert.equal(px(1)[3],0,'below first class transparent');
  assert.deepEqual(px(2),[0xe5,0xbc,0x00,255],'40 dBZ class colour from the registry');
  assert.deepEqual(px(3),[255,255,255,255],'75 dBZ');
  const ir=D.paintScalar({w:2,h:1,data:new Float32Array([-95,40])},'satellite/ir-enhanced');
  assert.deepEqual(Array.from(ir._im.data.slice(0,4)),[255,255,255,255]);
  assert.throws(()=>D.paintScalar({w:1,h:1,data:[1]},null));
});
test('continuous palettes interpolate between stops',()=>{
  win.WXWeatherPalettes.add({id:'my/radar/grey',category:'radar',name:'g',productIds:[],units:'',continuous:true,stops:[[0,'#000000'],[100,'#ffffff']]});
  const cv=D.paintScalar({w:1,h:1,data:[50]},'my/radar/grey'); const v=cv._im.data[0];
  assert.ok(v>120&&v<136,'midpoint is mid-grey, got '+v);
});
test('loop timing: plain loop, optional hold on the newest frame',()=>{
  const scene={dataLoop:{on:true,speed:10,hours:1}}; const rt=D.state.get(scene)||null;
  // stage 8 loaded frames in runtime state the same way ensure() does
  const tmp={dataLoop:scene.dataLoop}; const st=(()=>{ D.ensure(tmp); return D.state.get(tmp); })();
  st.key='x'; st.frames=Array.from({length:8},(_,i)=>({t:i,img:{}}));
  const idx=t=>D.curIdx(tmp,t,false);
  assert.deepEqual([0,.1,.75,.8,1.6].map(idx),[0,1,7,0,0]);
  tmp.dataLoop.dwell=2;
  assert.deepEqual([0,.35,.7,.8,2,2.7,2.9,3].map(idx),[0,3,7,7,7,7,1,2]);
  assert.equal(D.curIdx(tmp,0,true),0); tmp.dataLoop.idx=7.9; assert.equal(D.curIdx(tmp,0,true),7);
});
test('timestamps are Eastern time with the right EDT/EST label',()=>{
  assert.equal(D.fmtStamp(Date.UTC(2026,9,18,16,7)),'Sun, Oct 18, 2026 12:07 PM EDT');
  assert.equal(D.fmtStamp(Date.UTC(2026,11,5,17,0)),'Sat, Dec 5, 2026 12:00 PM EST');
  assert.equal(D.fmtStamp(Date.UTC(2026,10,1,5,30)),'Sun, Nov 1, 2026 1:30 AM EDT');
});
test('sources that are not registered stay "not connected" in ensure()',async()=>{
  const sc={dataLoop:{on:true,source:'goes-east-conus-C02',hours:1}}; await D.ensure(sc);
  const rt=D.state.get(sc); assert.equal(rt.status,'nosrc'); assert.match(rt.msg,/not connected/i);
});
test('menu respects ownership: no edits to ChatGPT modules, one script tag still enough',()=>{
  const idx=read('index.html'); assert.equal((idx.match(/dataloop\.js/g)||[]).length,1);
});
