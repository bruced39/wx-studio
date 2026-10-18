/* Regression tests: built-in radar / IR / RGB demo loops do not depend on
 * weather palette registry load timing. The demos are synthetic, not NOAA data. */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..','studio');
const dataloop=fs.readFileSync(path.join(root,'dataloop.js'),'utf8');
const palettes=fs.readFileSync(path.join(root,'weather','palettes.js'),'utf8');

function environment(withPalette=false){
 let canvases=0;
 const document={
   readyState:'loading',
   addEventListener(){ /* do not boot editor in test */ },
   createElement(name){
     assert.equal(name,'canvas');
     canvases++;
     const canvas={width:0,height:0,put:null};
     canvas.getContext=type=>{
       assert.equal(type,'2d');
       return {
         createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
         putImageData:(img)=>{canvas.put=img;}
       };
     };
     return canvas;
   }
 };
 const g={document,console:{warn(){}},Uint8ClampedArray,Float32Array};
 g.window=g;g.globalThis=g;
 const sandbox=vm.createContext(g);
 const loadPalettes=()=>vm.runInContext(palettes,sandbox,{filename:'weather/palettes.js'});
 if(withPalette)loadPalettes();
 vm.runInContext(dataloop,sandbox,{filename:'dataloop.js'});
 return {D:g.WXData,loadPalettes,canvases:()=>canvases};
}
function scene(source){return {dataLoop:{on:true,source,hours:1,speed:10,opacity:.85}};}
function runtime(D,sc){return D.state.get(sc);}
function opaquePixels(frame){
 assert.ok(frame.img?.put,'frame is a painted canvas');
 const bytes=frame.img.put.data;
 let count=0;for(let i=3;i<bytes.length;i+=4)if(bytes[i])count++;
 return count;
}

test('radar dBZ demo renders actual frames without weather palette registry',async()=>{
 const {D}=environment();
 const sc=scene('demo');
 await D.ensure(sc);
 const rt=runtime(D,sc);
 assert.equal(rt.status,'ready');
 assert.equal(rt.frames.length,8);
 assert.equal(rt.frames.filter(f=>f.img).length,8);
 assert.equal(rt.failed,0);
 assert.ok(rt.demoPaletteFallback);
 assert.match(rt.msg,/temporary colours/i);
 assert.ok(opaquePixels(rt.frames[0])>0,'synthetic reflectivity paints non-transparent pixels');
});

test('infrared temperature demo renders without weather palette registry',async()=>{
 const {D}=environment();
 const sc=scene('demo-ir');
 await D.ensure(sc);
 const rt=runtime(D,sc);
 assert.equal(rt.status,'ready');
 assert.equal(rt.frames.length,8);
 assert.equal(rt.failed,0);
 assert.ok(rt.demoPaletteFallback);
 assert.ok(opaquePixels(rt.frames[0])>0);
});

test('RGB GeoColor-style demo works normally without registry',async()=>{
 const {D}=environment();
 const sc=scene('demo-rgb');
 await D.ensure(sc);
 const rt=runtime(D,sc);
 assert.equal(rt.status,'ready');
 assert.equal(rt.frames.length,8);
 assert.equal(rt.failed,0);
 assert.ok(!rt.demoPaletteFallback);
 assert.ok(opaquePixels(rt.frames[0])>0);
});

test('same scene automatically reloads real registry colours when palettes arrive late',async()=>{
 const {D,loadPalettes}=environment();
 const sc=scene('demo-ir');
 await D.ensure(sc);
 const first=runtime(D,sc);
 assert.equal(first.status,'ready');
 assert.ok(first.demoPaletteFallback);
 const oldCanvas=first.frames[0].img;
 loadPalettes();
 assert.equal(D.paletteFor(sc),'satellite/ir-enhanced');
 await D.ensure(sc);
 const latest=runtime(D,sc);
 assert.equal(latest.status,'ready');
 assert.equal(latest.failed,0);
 assert.equal(latest.demoPaletteFallback,false);
 assert.equal(latest.msg,'');
 assert.notEqual(latest.frames[0].img,oldCanvas,'frames repainted after palette installation');
});

test('built-in palette registry colours both scalar demos without fallback',async()=>{
 const {D}=environment(true);
 for(const id of ['demo','demo-ir']){
   const sc=scene(id);
   await D.ensure(sc);
   const rt=runtime(D,sc);
   assert.equal(rt.status,'ready',id);
   assert.equal(rt.failed,0,id);
   assert.equal(rt.demoPaletteFallback,false,id);
   assert.equal(rt.frames.filter(f=>f.img).length,8,id);
   assert.ok(opaquePixels(rt.frames[0])>0,id);
 }
});

test('real scalar sources still report a missing palette instead of using demo colours',async()=>{
 const {D}=environment();
 D.registerSource({id:'test-real-scalar',label:'test live-like feed',
   list:async()=>[{t:Date.now(),bbox:[-76,39,-66,46],crs:'4326',
     scalar:{w:2,h:2,units:'dBZ',data:new Float32Array([5,10,20,40])}}]});
 const sc=scene('test-real-scalar');
 await D.ensure(sc);
 const rt=runtime(D,sc);
 assert.equal(rt.status,'error');
 assert.equal(rt.failed,1);
 assert.match(rt.msg,/No palette available/i);
 assert.equal(rt.frames[0].img,null);
});
