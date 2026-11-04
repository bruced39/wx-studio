"""Shared helpers for the WX Studio performance benchmarks (v0.10.4).
Headless Chromium on a software GL stack: absolute GPU numbers are NOT representative, but main-thread CPU time, call counts, memory
growth and object counts are. Mapbox is a stand-in (tests/perf/fake_gl.js) whose tile latency is simulated (window.__tileDelay)."""
import json, pathlib, statistics, sys, time
from playwright.sync_api import sync_playwright
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FAKE_GL = (HERE / 'fake_gl.js').read_text()

INSTRUMENT = r"""
(function(){
  const P=window.__P={log:[],lt:[],lf:[],ev:[],t0:0};
  const E=WX.E,orig=E.renderScene;
  E.renderScene=function(c,show,scene,t,opts){const a=performance.now();const r=orig.apply(this,arguments);const b=performance.now();
    P.log.push({k:(opts&&opts.thumb)?'thumb':(opts&&opts.editing)?'stage':'play',id:scene.id,a,b});return r;};
  try{new PerformanceObserver(l=>{for(const e of l.getEntries())P.lt.push({s:e.startTime,d:e.duration})}).observe({entryTypes:['longtask']});}catch(e){}
  if(window.MB&&MB.liveFrame){const lf=MB.liveFrame;MB.liveFrame=function(){const r=lf.apply(this,arguments);P.lf.push({t:performance.now(),ok:!!r});return r;};}
})();
"""

# A realistic 14-scene show: 3 broadcast map scenes (fronts, highs/lows, icons, temps, flow), two 7-day forecasts, a hi-res photo
# scene (3840x2160 JPEG), and gradient scenes with text, shapes, moving icons and H/L badges.
BUILD = r"""async(n)=>{
  const E=WX.E,mk=(name,o)=>E.newScene(Object.assign({name,duration:5,transition:{type:'dissolve',dur:0.8}},o));
  const ob=(t,p)=>E.newObject(t,p);
  const icons=['sunny','partly-cloudy','cloudy','showers-day','rain','mostly-sunny'];
  const mapObjs=(k)=>{const o=[];
    for(let i=0;i<6;i++){const ic=ob('icon',{x:300+i*250,y:300+(i%2)*260,size:170,icon:icons[(i+k)%6]});if(i%2==0)ic.move=Object.assign(E.moveDefault(),{dur:4});o.push(ic);}
    o.push(ob('front',{kind:'cold',pts:[[260,760],[620,690],[980,720],[1340,600],[1640,520]]}));
    o.push(ob('front',{kind:'warm',pts:[[300,900],[700,860],[1100,880]]}));
    o.push(ob('front',{kind:'occluded',pts:[[1200,880],[1500,800],[1760,700]]}));
    o.push(ob('hl',{kind:'H',x:430,y:470,size:190,value:'1032'}),ob('hl',{kind:'L',x:1480,y:430,size:190,value:'998'}));
    o.push(ob('citytemp',{x:900,y:560,name:'Boston',value:'54°'}),ob('citytemp',{x:1100,y:420,name:'Billerica',value:'51°'}),ob('callout',{x:700,y:640,label:'Worcester',value:'49°'}));
    o.push(ob('flow',{pts:[[200,200],[700,330],[1200,250],[1700,380]]}),ob('arrow',{pts:[[500,980],[900,940],[1300,980]]}));
    return o;};
  const views=[{c:[-71.2,42.4],z:7,b:0,p:0},{c:[-96,38],z:4.2,b:0,p:0},{c:[-73.8,41.6],z:6.2,b:0,p:0}];
  const scenes=[];
  for(let i=0;i<3;i++)scenes.push(mk('Map '+(i+1),{bg:{type:'mapbox',mbStyle:'broadcast',proj:'mercator',view:views[i]},title:{show:true,text:'Weather Map '+(i+1),sub:'Eastern Massachusetts'},objects:mapObjs(i)}));
  scenes.push(E.sceneFrom7Day(E.sample7(),'7 DAY FORECAST','Billerica, MA'));
  // hi-res photo (3840x2160 JPEG) as an image background asset
  const cv=document.createElement('canvas');cv.width=3840;cv.height=2160;const c=cv.getContext('2d');
  const gr=c.createLinearGradient(0,0,3840,2160);gr.addColorStop(0,'#16365e');gr.addColorStop(.5,'#6fa8d8');gr.addColorStop(1,'#f0c27b');c.fillStyle=gr;c.fillRect(0,0,3840,2160);
  for(let i=0;i<900;i++){c.fillStyle='rgba('+(i*37%255)+','+(i*71%255)+','+(i*13%255)+',.18)';c.beginPath();c.arc((i*977)%3840,(i*613)%2160,20+(i%60),0,6.3);c.fill();}
  const asset='perf_photo';
  const assets={};assets[asset]=cv.toDataURL('image/jpeg',.92);
  scenes.push(mk('Photo',{bg:{type:'image',asset,kenburns:true},title:{show:true,text:'Sunrise',sub:'Boston Harbor'},objects:[ob('icon',{x:500,y:400,size:240,icon:'sunny'}),ob('text',{text:'GOOD MORNING',x:960,y:800,size:120})]}));
  scenes.push(E.sceneFrom7Day(E.sample7().reverse(),'WEEKEND OUTLOOK','Eastern MA'));
  const grads=['sky','dusk','storm','night','clear'];
  while(scenes.length<n){const k=scenes.length;
    const o=[ob('text',{text:'Scene '+(k+1),x:960,y:140,size:90}),ob('shape',{x:200,y:300,w:700,h:400}),ob('hl',{kind:k%2?'H':'L',x:1400,y:520,size:210,value:String(1000+k)})];
    for(let i=0;i<8;i++){const ic=ob('icon',{x:240+i*210,y:820,size:150,icon:icons[(i+k)%6]});if(i%3==0)ic.move=Object.assign(E.moveDefault(),{dur:3});o.push(ic);}
    o.push(ob('front',{kind:'cold',pts:[[200,400],[600,330],[1000,380],[1400,300]]}));
    scenes.push(mk('Scene '+(k+1),{bg:{type:'gradient',grad:grads[k%5]},objects:o}));}
  const show={v:1,name:'Perf show',accent:'#2f9bff',bugText:'',logo:null,assets,scenes:scenes.slice(0,n)};
  if(show.scenes[0].bg.type==='mapbox')WX.S.show.mbMigrated=1;
  show.mbMigrated=1;
  WX.loadShow(show);
  return {n:show.scenes.length,types:show.scenes.map(s=>s.bg.type+(s.bg.type==='mapbox'?'':''))};}"""

def launch(pw, browser='chromium', tile_delay=0):
    args = ['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc']
    br = getattr(pw, browser).launch(args=args)
    ctx = br.new_context(viewport={'width': 1700, 'height': 960})
    ctx.add_init_script(FAKE_GL)
    return br, ctx

def open_page(ctx, html, tile_delay=0, n=14):
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console.error: ' + m.text) if m.type == 'error' else None)
    pg.goto(pathlib.Path(html).resolve().as_uri()); pg.wait_for_function("window.WX&&window.WX.S&&window.MB", timeout=30000)
    pg.evaluate("()=>{const m=document.getElementById('modalBg');if(m)m.style.display='none'}")
    pg.evaluate("t=>{window.__tileDelay=t}", tile_delay)
    info = pg.evaluate(BUILD, n)
    pg.evaluate("async()=>{await window.MB.init()}")
    pg.wait_for_timeout(500)
    pg.evaluate(INSTRUMENT)
    return pg, errs, info

def pct(v, q):
    if not v: return None
    v = sorted(v); k = (len(v) - 1) * q; f = int(k); c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)
def summ(v):
    if not v: return {'n': 0}
    return {'n': len(v), 'median': round(statistics.median(v), 1), 'p95': round(pct(v, .95), 1), 'max': round(max(v), 1), 'mean': round(sum(v) / len(v), 1)}
