'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../studio/mapbox.js'),'utf8');
function harness(){
 const a=source.indexOf('  let snapshotBusy=false'),
       b=source.indexOf('  MB.setInteractive = function',a),
       c=source.indexOf('  async function doSnap(',b),
       d=source.indexOf('  MB.snap = function(',c),
       e=source.indexOf('  MB.liveFrame=function',d),
       f=source.indexOf('  /* ---- lng/lat',e);
 assert.ok(a>0&&a<b&&b<c&&c<d&&d<e&&e<f,'preview guard is installed');
 const listeners=new Map(),trace=[];
 let settleResult;
 const canvas=()=>({width:1920,height:1080,imageTag:0,
   getContext(){return {drawImage:image=>{this.imageTag=image.imageTag;}};}});
 const D={canvas:{width:1920,height:1080,imageTag:1},
   getCanvas(){return this.canvas;},
   jumpTo({center}){this.canvas.imageTag=center[0];trace.push(center[0]);},
   loaded(){return true;},isMoving(){return false;},triggerRepaint(){},
   on(event,fn){listeners.set(event,fn);},
   off(event,fn){if(listeners.get(event)===fn)listeners.delete(event);},
   emit(event){listeners.get(event)?.();}};
 const MB={status:'ready',interacting:false,cache:new Map(),last:null,
   init:async()=>{},hasToken:()=>true,onUpdate:()=>{}};
 const script=[
   'let liveKey=null,renderGeneration=0,want=null,busy=false;',
   source.slice(a,b),source.slice(c,d),'function pump(){}',
   source.slice(e,f),
   'return {doSnap,state:()=>({snapshotBusy,previewRestorePending,hasHold:!!previewHold})};'
 ].join('\n');
 const api=new Function('MB','D','document','W','H','norm','visualConfigReady',
   'keyOf','cloneBg','withTimeout','setup','settle','styleOf','projOf',script)(
   MB,D,{createElement:canvas},1920,1080,x=>x,()=>true,
   (bg,cam)=>bg.name+'|'+cam.c[0],x=>({...x}),p=>p,
   async()=>{},()=>new Promise(resolve=>{settleResult=resolve;}),
   ()=>'broadcast',()=>'globe');
 return {MB,D,api,trace,resolve:()=>settleResult};
}
const edit={name:'editor'},thumb={name:'thumbnail'},
 camEdit={c:[1,0],z:6.2,b:0,p:0},camThumb={c:[2,0],z:4.3,b:0,p:0};
async function startSnapshot(h){
 const snap=h.api.doSnap(thumb,camThumb,'thumbnail|2');
 for(let i=0;i<40&&!h.resolve();i++)await Promise.resolve();
 assert.ok(h.resolve(),'thumbnail reached snapshot render');
 return {snap};
}
test('the editor never displays a thumbnail camera while a snapshot is active',async()=>{
 const h=harness();
 assert.equal(h.MB.liveFrame(edit,camEdit).imageTag,1);
 const {snap}=await startSnapshot(h);
 assert.equal(h.D.canvas.imageTag,2,'Mapbox GL switched to snapshot camera');
 assert.equal(h.MB.liveFrame(edit,camEdit).imageTag,1,
   'live editor shows the held correct camera');
 assert.equal(h.api.state().snapshotBusy,true);
 h.resolve()(true);
 await snap;
 assert.equal(h.MB.liveFrame(edit,camEdit).imageTag,1,
   'hold lasts until Mapbox renders the editor camera');
 assert.equal(h.api.state().hasHold,true);
 // NOAA tile loading must not keep the correct preview frozen forever.
 h.D.loaded=()=>false;
 h.D.emit('render');
 assert.equal(h.api.state().hasHold,false);
 assert.equal(h.MB.liveFrame(edit,camEdit).imageTag,1);
 assert.deepEqual(h.trace,[1,2,1]);
});
test('unrelated completed snapshots are never used as live or other-scene fallback',async()=>{
 const h=harness();h.MB.liveFrame(edit,camEdit);
 const {snap}=await startSnapshot(h);h.resolve()(true);await snap;
 assert.equal(h.MB.lastKey,'thumbnail|2');
 assert.equal(h.MB.frame({name:'unrelated'},camEdit),null);
 assert.equal(h.MB.liveFrame(edit,camEdit).imageTag,1);
});
test('cancelled snapshots release the editor camera safely',async()=>{
 const h=harness();h.MB.liveFrame(edit,camEdit);
 const {snap}=await startSnapshot(h);h.resolve()(false);
 assert.equal(await snap,null);
 assert.equal(h.api.state().snapshotBusy,false);
 assert.equal(h.MB.liveFrame(edit,camEdit).imageTag,1);
 h.D.emit('render');
 assert.equal(h.api.state().hasHold,false);
});
