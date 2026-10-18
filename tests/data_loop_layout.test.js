/* WX Studio regression: exactly one Aguacero-style editor weather bar and
 * safe startup of the Mapbox-backed weather data loop. Node built-in tests.
 */
'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const root=path.join(__dirname,'..');
const data=fs.readFileSync(path.join(root,'studio','dataloop.js'),'utf8');
const map=fs.readFileSync(path.join(root,'studio','mapbox.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'studio','weather','processor_bridge.js'),'utf8');

function makeElement(tag){
  return {
    nodeType:1, tag, id:'', className:'', children:[], listeners:{},
    style:{},hidden:false,textContent:'',
    append(...xs){this.children.push(...xs)},
    appendChild(x){this.children.push(x);return x},
    setAttribute(k,v){this[k]=v},
    addEventListener(k,fn){this.listeners[k]=fn},
    setPointerCapture(){},
    getBoundingClientRect(){return{left:0,width:200}}
  };
}
function mountEditor(scene){
  const stage=makeElement('div'),center=makeElement('div'),head=makeElement('head');
  stage.id='stageWrap';center.id='center';
  const doc={
    readyState:'complete',head,
    createElement:makeElement,
    createTextNode:t=>({nodeType:3,textContent:String(t)}),
    getElementById(id){
      if(id==='stageWrap')return stage;
      if(id==='center')return center;
      return [...head.children,...stage.children].find(e=>e.id===id)||null;
    },
    querySelector(){return null}
  };
  const callbacks=[];
  const win={WX:{S:{si:0,show:{scenes:[scene]},mode:'edit'},commit(){}}};
  new Function('window','document','setTimeout','requestAnimationFrame',data)(
    win,doc,fn=>fn(),fn=>callbacks.push(fn));
  return {stage,center,head,callbacks,win,doc,
    bar:stage.children.find(e=>e.id==='dlBar')};
}
test('one clickable bottom-docked weather bar, no duplicate below the map',()=>{
  const scene={bg:{type:'mapbox'},
    dataLoop:{on:true,source:'demo',hours:1,speed:10,opacity:.85,showBar:true,idx:0}};
  const {stage,center,bar,callbacks}=mountEditor(scene);
  assert.ok(bar,'bar is mounted in the map viewport');
  assert.equal(stage.children.filter(e=>e.id==='dlBar').length,1);
  assert.equal(center.children.length,0,'no second weather bar below viewport');
  assert.equal(bar.hidden,false);
  assert.equal(bar.children.length,2,'compact loop row and hidden settings flyout');
  const row=bar.children.find(e=>e.className==='dl-row');
  assert.ok(row);
  const timeline=row.children.find(e=>e.className==='dl-timeline');
  assert.ok(timeline);
  assert.deepEqual(timeline.children.map(e=>e.className),['dl-stamp','prog'],
    'timestamp is directly above the blue progress line');
  const opts=row.children.find(e=>e.className==='dl-options');
  assert.ok(opts.children.some(e=>e.className==='dl-live'&&e.textContent==='LIVE'));
  assert.ok(opts.children.some(e=>e.className==='dl-source'),'data source menu stays accessible');
  const ctrl=row.children.find(e=>e.className==='dl-ctrl');
  assert.ok(ctrl.children.some(e=>e.className==='pl'),'play/pause remains clickable');
  assert.ok(ctrl.children.some(e=>e.textContent==='‹'));
  assert.ok(ctrl.children.some(e=>e.textContent==='›'));
  const settings=bar.children.find(e=>e.className==='dl-settings');
  assert.ok(settings.hidden,'opacity and include-in-video are behind a gear');
  assert.ok(callbacks.length,'editor date/time updates in the animation loop');
  assert.ok(bar.listeners.pointerdown,'scrubbing cannot trigger map panning');
});
test('bar is map-only and can be enabled on a map without a data loop',()=>{
  const {bar}=mountEditor({bg:{type:'mapbox'}});
  assert.equal(bar.hidden,false);
  assert.ok(bar.children[0].textContent.includes('Enable weather data loop'));
  const {bar:nonMap}=mountEditor({bg:{type:'image'},dataLoop:{on:true}});
  assert.equal(nonMap.hidden,true,'do not obscure image and forecast scenes');
});
test('export shows one bottom bar; live canvas and thumbnails never draw a second',()=>{
  assert.match(data,/if\(opts&&\(opts\.editing\|\|opts\.liveMap\)&&!presenting\)return;/);
  assert.match(data,/y0 = H - 70, bh = 70/,'export bar reaches map bottom');
  assert.match(data,/c\.fillText\(L\.stamp, bx1, y0 \+ 13\)/,
    'frame date/time remains above export progress');
  assert.match(data,/#stageWrap\.present #dlBar\{display:none!important\}/,
    'fullscreen Present hides clickable DOM bar and uses canvas copy');
});
test('Mapbox map remains usable if weather imagery errors; startup errors are explicit',()=>{
  assert.match(map,/try\{applyWeatherUnderlay\(D\)\}catch\(error\)/);
  assert.match(map,/withTimeout\(loadLib\(\),20000/);
  // The visible Mapbox map must not be blocked by a second empty projector.
  assert.match(map,/withTimeout\(once\(D,'load'\),25000/);
  assert.doesNotMatch(map,/Promise\.all\(\[once\(D, 'load'\),once\(P, 'load'\)\]\)/);
  assert.match(map,/function settle\(m,generation\)/);
  assert.match(map,/MB\.status='error';MB\.err=/);
});
test('frame date and scrub position use the exact rendered underlay frame',()=>{
  assert.match(bridge,/rt\.lastIdx=idx;/);
  assert.match(bridge,/frame\._wxUnderlayDataURL=frame\.img\.toDataURL\('image\/png'\)/);
  assert.match(bridge,/if\(!frame\._wxUnderlayDataURL\)/,
    'demo canvas PNG is not re-encoded every animation frame');
});
