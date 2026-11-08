"""WX Studio performance benchmark (v0.10.4). Usage:
   python3 tests/perf/perf_bench.py [--html dist/studio.html] [--label NAME] [--out results.json] [--only switch,idle,anim,memory,export] [--export-seconds 30]
Prints a table and writes JSON. Chromium only here; see docs/PERFORMANCE_REVIEW.md for running it (and real profiling) on your own computer."""
import argparse, json, sys, time, pathlib
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from perf_lib import *

ap = argparse.ArgumentParser()
ap.add_argument('--html', default=str(ROOT / 'dist' / 'studio.html')); ap.add_argument('--label', default='run'); ap.add_argument('--out')
ap.add_argument('--only', default='switch,rapid,idle,anim,memory,export'); ap.add_argument('--export-seconds', type=float, default=30)
ap.add_argument('--browser', default='chromium'); ap.add_argument('--tile-delay', type=float, default=700)
a = ap.parse_args(); only = set(a.only.split(','))
R = {'label': a.label, 'html': a.html, 'browser': a.browser, 'tileDelayMs': a.tile_delay}

SWITCH = r"""async([i,win])=>{
  const P=window.__P;P.log=[];P.lt=[];P.lf=[];
  const el=document.querySelector('.sc[data-i="'+i+'"]');const sid=WX.S.show.scenes[i].id;
  const m0=window.__maps.length,j0=window.__jumps||0,s0=window.__setStyleCalls||0;
  const t0=performance.now();el.click();const t1=performance.now();
  await new Promise(r=>requestAnimationFrame(r));const t2=performance.now();
  await new Promise(r=>setTimeout(r,win));
  const stage=P.log.filter(x=>x.k==='stage'&&x.id===sid),th=P.log.filter(x=>x.k==='thumb'),lf=P.lf.filter(x=>x.ok&&x.t>=t1);
  const big=P.lt.filter(x=>x.s>=t0-1);
  return {type:WX.S.show.scenes[i].bg.type,sync:t1-t0,toFrame:t2-t0,toStage:stage.length?stage[0].b-t0:null,
    toMap:lf.length?lf[0].t-t0:null,stageN:P.log.filter(x=>x.k==='stage').length,stageMs:P.log.filter(x=>x.k==='stage').reduce((s,x)=>s+x.b-x.a,0),
    thumbN:th.length,thumbMs:th.reduce((s,x)=>s+x.b-x.a,0),thumbEnd:th.length?th[th.length-1].b-t0:null,
    longN:big.length,longMax:big.reduce((m,x)=>Math.max(m,x.d),0),longSum:big.reduce((s,x)=>s+x.d,0),
    newMaps:window.__maps.length-m0,jumps:(window.__jumps||0)-j0,styles:(window.__setStyleCalls||0)-s0};}"""

with sync_playwright() as p:
    br, ctx = launch(p, a.browser)
    pg, errs, info = open_page(ctx, a.html, a.tile_delay, 14)
    R['show'] = info; ev = pg.evaluate
    cdp = ctx.new_cdp_session(pg) if a.browser == 'chromium' else None
    def dom_counters():
        if not cdp: return {}
        return cdp.send('Memory.getDOMCounters')
    def heap():
        ev("()=>{if(window.gc)gc()}"); time.sleep(.3); ev("()=>{if(window.gc)gc()}")
        return ev("()=>performance.memory?performance.memory.usedJSHeapSize/1048576:null")

    # ---------- 1. scene switching: cold first visit, then warm; cached vs fresh map tiles ----------
    if 'switch' in only:
        order = list(range(14))
        cold = []
        for i in order:
            r = ev(SWITCH, [i, 1800]); r['i'] = i; cold.append(r); 
        warm = []
        for i in order:
            r = ev(SWITCH, [i, 1800]); r['i'] = i; warm.append(r)
        R['switchCold'] = cold; R['switchWarm'] = warm
        def agg(rows, f, typ=None):
            return summ([r[f] for r in rows if r[f] is not None and (typ is None or (r['type'] == 'mapbox') == (typ == 'map'))])
        for nm, rows in (('cold', cold), ('warm', warm)):
            print('== scene switch (%s visit) ==' % nm)
            for typ in ('map', 'other'):
                print(' %-5s sync %s | toFrame %s | toStage %s%s | thumbMs %s | stageMs %s | long max %s' % (typ, agg(rows, 'sync', typ).get('median'), agg(rows, 'toFrame', typ).get('median'), agg(rows, 'toStage', typ).get('median'),
                      (' | toMapPixels %s' % agg(rows, 'toMap', typ).get('median')) if typ == 'map' else '', agg(rows, 'thumbMs', typ).get('median'), agg(rows, 'stageMs', typ).get('median'), agg(rows, 'longMax', typ).get('max')))

    # ---------- 2. rapid consecutive switching ----------
    if 'rapid' in only:
        r = ev("""async()=>{const P=window.__P;P.log=[];P.lt=[];const m0=window.__maps.length,s0=window.__setStyleCalls||0;const lat=[];const t0=performance.now();
          for(let k=0;k<60;k++){const i=(k*5)%14;const el=document.querySelector('.sc[data-i="'+i+'"]');const a=performance.now();el.click();lat.push(performance.now()-a);await new Promise(r=>setTimeout(r,50));}
          const t1=performance.now();await new Promise(r=>setTimeout(r,1500));
          return {clicks:60,wallMs:t1-t0,handler:lat,renders:P.log.length,thumbN:P.log.filter(x=>x.k==='thumb').length,thumbMs:P.log.filter(x=>x.k==='thumb').reduce((s,x)=>s+x.b-x.a,0),
            stageMs:P.log.filter(x=>x.k==='stage').reduce((s,x)=>s+x.b-x.a,0),longN:P.lt.length,longMax:P.lt.reduce((m,x)=>Math.max(m,x.d),0),newMaps:window.__maps.length-m0,styles:(window.__setStyleCalls||0)-s0};}""")
        R['rapid'] = {k: (summ(v) if k == 'handler' else v) for k, v in r.items()}
        print('== 60 rapid switches (50 ms apart) ==', R['rapid'])

    # ---------- 3. idle (nothing happening) ----------
    if 'idle' in only:
        R['idle'] = {}
        for i, nm in ((0, 'map scene'), (3, '7-day scene'), (7, 'gradient scene')):
            ev(SWITCH, [i, 800])
            r = ev("""async()=>{const P=window.__P;P.log=[];P.lt=[];let frames=0;const raf=()=>{frames++;rq=requestAnimationFrame(raf)};let rq=requestAnimationFrame(raf);
              const t0=performance.now();await new Promise(r=>setTimeout(r,3000));cancelAnimationFrame(rq);const dt=(performance.now()-t0)/1000;
              const st=P.log.filter(x=>x.k==='stage'),th=P.log.filter(x=>x.k==='thumb');
              return {seconds:dt,rafPerSec:frames/dt,stageRendersPerSec:st.length/dt,stageMsPerSec:st.reduce((s,x)=>s+x.b-x.a,0)/dt,thumbMsPerSec:th.reduce((s,x)=>s+x.b-x.a,0)/dt,
                msPerStage:st.length?st.reduce((s,x)=>s+x.b-x.a,0)/st.length:0,longPerSec:P.lt.length/dt};}""")
            R['idle'][nm] = r
            print('== idle: %s == stage renders/s %.1f, %.1f ms each => %.0f ms of main thread per second (%.0f%% busy) | thumb ms/s %.1f | long tasks/s %.2f' % (nm, r['stageRendersPerSec'], r['msPerStage'], r['stageMsPerSec'], r['stageMsPerSec'] / 10, r['thumbMsPerSec'], r['longPerSec']))

    # ---------- 4. playback frame time (editor play of a whole animated scene) ----------
    if 'anim' in only:
        R['anim'] = {}
        for i, nm in ((0, 'map scene (fronts, H/L, 6 icons)'), (3, '7-day'), (7, 'gradient + moving icons')):
            ev(SWITCH, [i, 600])
            r = ev("""async(i)=>{const P=window.__P;P.log=[];P.lt=[];const fr=[];let last=performance.now(),n=0,rq;
              const tick=()=>{const t=performance.now();fr.push(t-last);last=t;n++;rq=requestAnimationFrame(tick)};rq=requestAnimationFrame(tick);
              document.getElementById('bPlayScene').click();await new Promise(r=>setTimeout(r,3500));document.getElementById('bStop').click();cancelAnimationFrame(rq);
              const pl=P.log.filter(x=>x.k==='play'),cost=pl.map(x=>x.b-x.a);return {rafIntervals:fr,renders:cost,longN:P.lt.length,longMax:P.lt.reduce((m,x)=>Math.max(m,x.d),0)};}""", i)
            R['anim'][nm] = {'rafInterval': summ(r['rafIntervals']), 'renderMs': summ(r['renders']), 'longN': r['longN'], 'longMax': r['longMax']}
            print('== play %s == renderScene ms %s | rAF interval ms %s | long tasks %d (max %.0f)' % (nm, R['anim'][nm]['renderMs'], R['anim'][nm]['rafInterval'], r['longN'], r['longMax']))
        # per-object-type cost inside one render (draw 40 times each)
        R['perObject'] = ev("""()=>{const E=WX.E,sc=WX.S.show.scenes[0],show=WX.S.show,cv=document.createElement('canvas');cv.width=1920;cv.height=1080;const c=cv.getContext('2d');const out={};
          const orig=E.renderScene;const types={};sc.objects.forEach(o=>{(types[o.type]=types[o.type]||[]).push(o)});
          const base=Object.assign({},sc,{objects:[]});const t=0;let a=performance.now();for(let i=0;i<30;i++)orig(c,show,base,1+i*.03,{editing:false});const b0=(performance.now()-a)/30;out._empty_scene=b0;
          for(const k of Object.keys(types)){const s2=Object.assign({},sc,{objects:types[k]});a=performance.now();for(let i=0;i<30;i++)orig(c,show,s2,1+i*.03,{editing:false});out[k+' x'+types[k].length]=(performance.now()-a)/30-b0;}
          return out;}""")
        print('== cost per object type on the map scene (ms/frame, beyond empty scene %.1f) ==' % R['perObject']['_empty_scene'], {k: round(v, 2) for k, v in R['perObject'].items() if k != '_empty_scene'})

    # ---------- 5. memory / listeners after many switches ----------
    if 'memory' in only:
        base = {'heapMB': heap(), 'dom': dom_counters(), 'canvases': ev("document.querySelectorAll('canvas').length")}
        rounds = []
        for rnd in range(4):
            ev("""async()=>{for(let k=0;k<50;k++){document.querySelector('.sc[data-i="'+((k*3)%14)+'"]').click();await new Promise(r=>setTimeout(r,30));}await new Promise(r=>setTimeout(r,1200));}""")
            rounds.append({'heapMB': heap(), 'dom': dom_counters(), 'canvases': ev("document.querySelectorAll('canvas').length"),
                           'maps': ev("window.__maps.length"), 'pendingTimers': ev("window.__P.lt.length")})
        R['memory'] = {'base': base, 'rounds': rounds}
        print('== memory over 4 x 50 switches == heap MB:', [round(base['heapMB'], 1)] + [round(r['heapMB'], 1) for r in rounds],
              '| listeners:', [base['dom'].get('jsEventListeners')] + [r['dom'].get('jsEventListeners') for r in rounds],
              '| nodes:', [base['dom'].get('nodes')] + [r['dom'].get('nodes') for r in rounds], '| maps created:', rounds[-1]['maps'])

    # ---------- 6. export (fake encoder, real frame pipeline) ----------
    if 'export' in only:
        EX = r"""async(secs)=>{
          window.__fake={frames:[],n:0};
          window.VideoEncoder=class{constructor(o){this.o=o;this.encodeQueueSize=0}static async isConfigSupported(c){return{supported:true,config:c}}configure(){}
            encode(f){window.__fake.frames.push(f.timestamp);window.__fake.n++;this.o.output({byteLength:4,copyTo:b=>b.set([0,0,0,1]),timestamp:f.timestamp,duration:f.duration,type:'key'},{decoderConfig:{description:new Uint8Array([1,0,0,0,0,0,0,0])}})}async flush(){}close(){}};
          const E=WX.E,show=WX.S.show;const keep=show.scenes.slice();let acc=0;const pick=[];for(const s of keep){if(acc>=secs)break;pick.push(s);acc+=s.duration;}
          const sub=Object.assign({},show,{scenes:pick});const X=window.Exporter;
          const T={prep:0,render:0,yuv:0};const op=E.prepareFrame,orr=E.renderShow,oy=X.rgbaToI420;
          E.prepareFrame=async function(){const a=performance.now();const r=await op.apply(this,arguments);T.prep+=performance.now()-a;return r};
          E.renderShow=function(){const a=performance.now();const r=orr.apply(this,arguments);T.render+=performance.now()-a;return r};
          X.rgbaToI420=function(){const a=performance.now();const r=oy.apply(this,arguments);T.yuv+=performance.now()-a;return r};
          const t0=performance.now();const info=await X.encodeFrames(sub,{width:1920,height:1080,fps:30,bitrate:1e7,codec:'avc1.640028'},()=>{});const dt=performance.now()-t0;
          E.prepareFrame=op;E.renderShow=orr;X.rgbaToI420=oy;
          const ts=window.__fake.frames;let dup=0,gap=0,bad=0;for(let i=1;i<ts.length;i++){const d=ts[i]-ts[i-1];if(d===0)dup++;else if(d>34000||d<32000)gap++;}
          return {seconds:acc,frames:info.frames,encoded:ts.length,expected:Math.round(acc*30),ms:dt,msPerFrame:dt/info.frames,breakdown:T,dup,gap,color:info.color};}"""
        r = ev(EX, a.export_seconds)
        R['export'] = r
        print('== export %.0f s show (fake encoder) == %.1f s wall, %.1f ms/frame (prepare %.1f, render %.1f, YUV %.1f ms/frame) | frames %d/%d dup %d gap %d' % (
            r['seconds'], r['ms'] / 1000, r['msPerFrame'], r['breakdown']['prep'] / r['frames'], r['breakdown']['render'] / r['frames'], r['breakdown']['yuv'] / r['frames'], r['encoded'], r['expected'], r['dup'], r['gap']))
    R['pageErrors'] = errs[:10]
    print('page errors:', errs[:5])
    br.close()
if a.out: pathlib.Path(a.out).write_text(json.dumps(R, indent=1))
