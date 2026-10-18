'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../studio/ui.js'),'utf8');
function build(){
 const a=source.indexOf('  /* ---------- thumbnails ---------- */'),
       b=source.indexOf('  E.onAsset = () => thumbSoon(true);',a);
 assert.ok(a>0&&b>a,'thumbnail source exists');
 const copies=[],renders=[],timers=[];
 const stage={width:1920,height:1080,tag:'live-editor'};
 const thumb={width:0,height:0,tag:'rendered-thumbnail',getContext(){return {drawImage(){}};}};
 const cv=[0,1].map(i=>({width:192,height:108,getContext(){return {
   drawImage(img){copies.push({target:i,tag:img.tag});}
 }}}));
 const document={createElement:()=>thumb,querySelector:selector=>{
  const index=/data-i="(\d+)"/.exec(selector);
  return index?cv[+index[1]]:null;
 }};
 const S={si:0,mode:'edit',show:{scenes:[
  {bg:{type:'mapbox'},duration:6},{bg:{type:'image'},duration:6}]}};
 const E={renderScene(...args){renders.push(args);thumb.tag='rendered-other-scene';}};
 const api=new Function('document','stage','W','H','E','S','setTimeout','clearTimeout',
  source.slice(a,b)+';return {drawThumb,thumbSoon,copyActiveMapThumb};')(
  document,stage,1920,1080,E,S,(fn,ms)=>{timers.push({fn,ms});return timers.length;},()=>{});
 return {api,S,stage,copies,renders,timers};
}
test('active map thumbnails copy the finished editor stage without initiating a GL snapshot',()=>{
 const o=build();
 o.api.drawThumb(0);
 assert.deepEqual(o.copies,[{target:0,tag:'live-editor'}]);
 assert.equal(o.renders.length,0);
 o.stage.tag='latest-user-camera';
 o.api.drawThumb(0);
 assert.deepEqual(o.copies.at(-1),{target:0,tag:'latest-user-camera'});
 assert.equal(o.renders.length,0,'no Mapbox frame/snapshot requested');
});
test('explicit other-scene thumbnail and non-edit modes retain their rendering',()=>{
 const o=build();
 o.api.drawThumb(1);
 assert.equal(o.renders.length,1);
 assert.equal(o.renders[0][2],o.S.show.scenes[1]);
 o.S.mode='play';o.api.drawThumb(0);
 assert.equal(o.renders.length,2);
});
test('Mapbox snapshot completion cannot call thumbSoon and trigger another snapshot',()=>{
 assert.equal(source.includes('g.MB.onUpdate = () => thumbSoon(true)'),false);
 assert.ok(source.includes('g.MB.onUpdate = null;'));
 const o=build();
 o.api.thumbSoon(true);
 assert.equal(o.timers.length,1,'explicit scene edits can still schedule thumbnails');
 assert.equal(o.timers[0].ms,450);
});
test('editor updates active thumbnail after stage rendering, never by snapshot completion',()=>{
 const a=source.indexOf('  function loop(ts) {'),
       b=source.indexOf('  let lastDrawErr',a);
 assert.ok(a>0&&b>a);
 const block=source.slice(a,b);
 const paint=block.indexOf('E.renderScene(sctx, S.show, cur(), clock()'),
       thumb=block.indexOf('copyActiveMapThumb();'),
       overlay=block.indexOf('drawOverlay();');
 assert.ok(paint>=0&&thumb>paint&&overlay>thumb);
 assert.ok(block.includes('ts-lastActiveMapThumbPaint>1100'));
 assert.equal(block.includes('thumbSoon('),false);
});
