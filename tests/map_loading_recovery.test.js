/* WX Studio map loading reliability regression. Run: node --test tests/map_loading_recovery.test.js */
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const map=fs.readFileSync(path.join(__dirname,'..','studio','mapbox.js'),'utf8');
function block(a,b){
  const i=map.indexOf(a),j=map.indexOf(b,i+a.length);
  assert.ok(i>=0&&j>i,'source section exists: '+a);
  return map.slice(i,j);
}
function clock(){
  let now=0,id=0;const tasks=new Map();
  const set=(fn,ms)=>{const key=++id;tasks.set(key,{fn,at:now+ms});return key};
  const clear=key=>tasks.delete(key);
  const advance=ms=>{
    const end=now+ms;
    for(;;){
      let hit=null,at=Infinity;
      for(const [key,t] of tasks)if(t.at<=end&&t.at<at){at=t.at;hit=key}
      if(hit==null)break;
      now=at;const task=tasks.get(hit);tasks.delete(hit);task.fn();
    }
    now=end;
  };
  return {set,clear,advance,count:()=>tasks.size};
}
function settle(c,m,g=0){
  const source=block('  function settle(m,generation){','\n  function visualConfigReady(');
  return new Function('setTimeout','clearTimeout','MB','renderGeneration',
    source+';return settle;')(c.set,c.clear,{interacting:false},0)(m,g);
}
function testMap(paint){
  const listeners=new Map();
  return {
    listeners,once(ev,fn){listeners.set(ev,fn)},
    off(ev,fn){if(listeners.get(ev)===fn)listeners.delete(ev)},
    triggerRepaint(){if(paint)paint(()=>{
      const cb=listeners.get('render');listeners.delete('render');cb?.()
    })},
    loaded(){return true},isMoving(){return false}
  };
}
test('silent GPU render has a true 14s watchdog, even without render events',async()=>{
  const c=clock(),m=testMap(),p=settle(c,m);
  c.advance(14000);
  await assert.rejects(p,/did not render a frame within 14 seconds/);
  assert.equal(c.count(),0);assert.equal(m.listeners.size,0);
});
test('partially rendered tiles produce best available image after deadline',async()=>{
  const c=clock(),m=testMap(cb=>cb());m.loaded=()=>false;
  const p=settle(c,m);c.advance(14000);
  assert.equal(await p,true);assert.equal(c.count(),0);
});
test('two normal render events settle without waiting on deadline',async()=>{
  const c=clock(),m=testMap(cb=>cb()),p=settle(c,m);
  c.advance(40);assert.equal(await p,true);assert.equal(c.count(),0);
});
test('superseded camera settles false without leaving timers',async()=>{
  const c=clock(),m=testMap(),p=settle(c,m,1);
  assert.equal(await p,false);assert.equal(c.count(),0);
});
test('startup waits for actual base map, not projector, and style has deadline',()=>{
  assert.match(map,/await withTimeout\(once\(D,'load'\),25000/);
  assert.doesNotMatch(map,/Promise\.all\(\[once\(D, 'load'\),once\(P, 'load'\)\]\)/);
  assert.match(map,/await withTimeout\(once\(D,'style\.load'\),12000/);
  assert.match(map,/await withTimeout\(setup\(bg\),17000/);
  assert.match(map,/if\(MB\.status==='error'\)return Promise\.reject/);
  assert.match(map,/if \(busy \|\| !want \|\| MB\.interacting \|\| MB\.status==='error'\) return/);
});
test('failed snapshot latches the error and prevents automatic WebGL retries',async()=>{
  const source=block('  MB.snap = function(bg,cam){','\n\n  /* Live editor preview');
  const MB={status:'ready',err:'',cache:new Map(),queue:Promise.resolve()};
  let attempts=0;
  const snap=new Function('MB','keyOf','cloneBg','doSnap','console',
    source+';return MB.snap;')(MB,()=>'key',x=>x,
      async()=>{attempts++;throw Error('render failure')},{warn(){}});
  await assert.rejects(snap({},{}),/render failure/);
  assert.equal(MB.status,'error');assert.equal(MB.err,'render failure');
  await assert.rejects(snap({},{}),/render failure/);
  assert.equal(attempts,1);
});


test('projector projection state is declared in strict mode before map startup',()=>{
  // Reproduces the v0.9.76 Firefox crash: assignment to undeclared variable pProj.
  const decl=block('  let D = null, P = null,','\n  // NOAA/weather imagery');
  assert.match(decl,/\bpProj\s*=\s*null\b/,
    'projector projection variable must be declared with other Mapbox state');
  const simulate="'use strict';\n"+decl+
    "\nP=null;pProj='mercator';P={setProjection(pr){this.pr=pr}};"+
    "const requested='globe';if(pProj!==requested){P.setProjection(requested);pProj=requested;}"+
    "return [pProj,P.pr];";
  assert.deepEqual(new Function(simulate)(),['globe','globe']);
});
test('Mapbox reset clears projector state even when optional P is unavailable',()=>{
  const decl=block('  let D = null, P = null,','\n  // NOAA/weather imagery');
  // v0.9.90 added these live-preview variables in a later declaration.
  // Simulate the REAL reset closure, not an incomplete copy that raises
  // ReferenceError even though all four bindings exist in production.
  const previewDecl=block(
    '  let snapshotBusy=false,previewHold=null,previewRestorePending=false,previewRestoreKey=null;',
    '\n  function holdEditorFrame(');
  const reset=block('  MB.reset = function () {','\n  MB.setToken =');
  const simulate="'use strict';\n"+decl+"\n"+previewDecl+
    "\nconst MB={interacting:true,cache:{clear(){this.cleared=true}},last:'previous',"+
    "lastKey:'old frame',status:'ready',err:'previous error',queue:Promise.resolve()};"+
    "pProj='globe';pKey='camera';curProj='globe';"+
    "snapshotBusy=true;previewHold='old editor frame';"+
    "previewRestorePending=true;previewRestoreKey='old camera';"+
    "D={remove(){this.removed=true}};P=null;host={remove(){this.removed=true}};\n"+
    reset+"\nMB.reset();return {pProj,pKey,curProj,D,P,host,initP,MB,renderGeneration,"+
    "snapshotBusy,previewHold,previewRestorePending,previewRestoreKey};";
  const result=new Function(simulate)();
  assert.equal(result.pProj,null);
  assert.equal(result.pKey,null);
  assert.equal(result.curProj,null);
  assert.equal(result.D,null);
  assert.equal(result.P,null);
  assert.equal(result.snapshotBusy,false);
  assert.equal(result.previewHold,null);
  assert.equal(result.previewRestorePending,false);
  assert.equal(result.previewRestoreKey,null);
  assert.equal(result.MB.lastKey,null);
  assert.equal(result.MB.status,'idle');
  assert.equal(result.MB.err,'');
  assert.equal(result.renderGeneration,1);
});
