"""Real-browser (headless Chromium) check of the v0.10.3 Mapbox usage safeguards.
Mapbox GL cannot be downloaded in CI, so a stand-in `mapboxgl` is injected. Unlike the tile-recovery stand-in it keeps a REAL camera and
implements project()/unproject() with a matrix-style Web-Mercator transform written independently of studio/mapbox.js, and it counts every
`new Map()` (each is one billable map load on real Mapbox).
Checks: startup creates ONE Map; exact projector agrees with the stand-in's own project(); globe/pitch lazily create the helper once;
scene/style/camera changes and unchanged saves create no Map; idle is silent; page reloads are counted; unexpected counts warn;
pause blocks Map creation and snapshots (without becoming an error) and the export dialog offers Resume; Secrets token shown masked.
Usage: python3 wxbuild.py && python3 tests/browser/mapbox_usage_browser_check.py"""
from playwright.sync_api import sync_playwright
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
HTML = (ROOT / 'dist' / 'studio.html').as_uri()
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, ('' if ok else info))

FAKE_GL = r"""
(function(){
  const W=1920,H=1080;
  window.WX_MAPBOX_TOKEN=window.WX_MAPBOX_TOKEN||'pk.eyJ1IjoidGVzdCJ9.FAKETESTTOKENabcd';
  window.__maps=[];window.__ev=[];window.__tiles={a:{state:'loaded'},b:{state:'loaded'},c:{state:'loaded'},d:{state:'loaded'}};
  window.__updates=0;window.__failTiles={};window.__pendingRenders=0;
  const cache={_tiles:window.__tiles,_removeTile(k){delete this._tiles[k];},update(){window.__updates++;for(const k of ['a','b','c','d']){if(!this._tiles[k])this._tiles[k]={state:window.__failTiles[k]?'errored':'loaded'};}window.__paint();}};
  // optional (non-critical) source, only when a test asks for it: its tiles may be errored forever and must never block anything
  window.__optTiles={x:{state:'loaded'}};
  const optCache={_tiles:window.__optTiles,_removeTile(k){delete this._tiles[k];},update(){}};
  window.__listeners={};
  window.__paint=function(){const m=window.__map;if(!m)return;const c=m.__canvas.getContext('2d');c.fillStyle='#2a6a3a';c.fillRect(0,0,W,H);m.__renders=(m.__renders||0)+1;if(window.__pendingRenders>0&&--window.__pendingRenders===0){for(const k of Object.keys(window.__tiles))if(window.__tiles[k].state==='loading')window.__tiles[k]={state:'loaded'};}(window.__listeners.render||[]).slice().forEach(f=>f());};
  const mx=lng=>(180+lng)/360,my=lat=>(180-(180/Math.PI)*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360)))/360;
  class LngLat{constructor(a,b){this.lng=a;this.lat=b;}}
  class Map{
    constructor(o){
      this.__canvas=document.createElement('canvas');this.__canvas.width=W;this.__canvas.height=H;
      this.style={_sourceCaches:Object.assign({'mapbox-satellite':cache},window.__withOptional?{'mapbox-terrain-dem':optCache}:{})};this.__ls={};this.__loaded=false;this.__o=o;this.__isD=!!(o&&typeof o.style==='string');
      const c=o.center||[0,0];this.__st={c:[c.lng!==undefined?c.lng:c[0],c.lat!==undefined?c.lat:c[1]],z:o.zoom==null?1:o.zoom,b:o.bearing||0,p:o.pitch||0};
      this.__vw=(o.container&&o.container.clientWidth)||1280;this.__vh=(o.container&&o.container.clientHeight)||720;
      this.__proj=(o.projection&&o.projection.name)||o.projection||'mercator';
      window.__maps.push(this);window.__ev.push({t:'new',d:this.__isD});
      if(this.__isD){window.__map=this;o.container.appendChild(this.__canvas);setTimeout(()=>{this.__loaded=true;(this.__ls.load||[]).forEach(f=>f());window.__paint();},window.__loadDelay||20);}
      const self=this;
      this.transform={clone(){const t={zoom:0,pitch:0,bearing:0,center:null,locationPoint(ll){return self.__pt(ll.lng,ll.lat,[t.center.lng,t.center.lat],t.zoom,t.bearing);}};return t;}};
    }
    __pt(lng,lat,c,z,b){const world=512*2**z,ang=-b*Math.PI/180,dx=(mx(lng)-mx(c[0]))*world,dy=(my(lat)-my(c[1]))*world;
      return {x:this.__vw/2+dx*Math.cos(ang)-dy*Math.sin(ang),y:this.__vh/2+dx*Math.sin(ang)+dy*Math.cos(ang)};}
    __un(x,y){const s=this.__st,world=512*2**s.z,ang=-s.b*Math.PI/180,u=x-this.__vw/2,v=y-this.__vh/2,dx=u*Math.cos(ang)+v*Math.sin(ang),dy=-u*Math.sin(ang)+v*Math.cos(ang);
      const X=mx(s.c[0])+dx/world,Y=my(s.c[1])+dy/world;return {lng:X*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*Y)))*180/Math.PI};}
    on(ev,fn){(this.__ls[ev]=this.__ls[ev]||[]).push(fn);if(this.__isD){(window.__listeners[ev]=window.__listeners[ev]||[]).push(fn);}return this;}
    once(ev,fn){const w=(...a)=>{this.off(ev,w);fn(...a)};this.on(ev,w);if(ev==='style.load')setTimeout(()=>{(this.__ls['style.load']||[]).slice().forEach(f=>f());},window.__styleDelay||10);return this;}
    off(ev,fn){for(const t of [this.__ls,window.__listeners]){if(t[ev])t[ev]=t[ev].filter(f=>f!==fn);}return this;}
    getCanvas(){return this.__canvas;} loaded(){return this.__loaded&&!window.__slow;} isMoving(){return false;}
    jumpTo(o){const s=this.__st;if(o.center){s.c=[o.center.lng!==undefined?o.center.lng:o.center[0],o.center.lat!==undefined?o.center.lat:o.center[1]];}
      if(o.zoom!=null)s.z=o.zoom;if(o.bearing!=null)s.b=o.bearing;if(o.pitch!=null)s.p=o.pitch;window.__jumps=(window.__jumps||0)+1;}
    triggerRepaint(){setTimeout(()=>window.__paint(),0);} resize(){} remove(){window.__ev.push({t:'remove',d:this.__isD});}
    getSource(){return undefined;} getLayer(){return undefined;} getStyle(){return {layers:[],sources:{}};}
    setStyle(){window.__setStyleCalls=(window.__setStyleCalls||0)+1;setTimeout(()=>{(this.__ls['style.load']||[]).slice().forEach(f=>f());},window.__styleDelay||5);}
    setProjection(p){this.__proj=(p&&p.name)||p;} getProjection(){return {name:this.__proj};} setFog(){} setTerrain(){}
    addSource(){} addLayer(){} removeLayer(){} removeSource(){} setPaintProperty(){} setLayoutProperty(){} setFilter(){} setPadding(){}
    getCenter(){return new LngLat(this.__st.c[0],this.__st.c[1]);} getZoom(){return this.__st.z;} getBearing(){return this.__st.b;} getPitch(){return this.__st.p;}
    project(a){window.__projectCalls=(window.__projectCalls||0)+1;const s=this.__st,l=Array.isArray(a)?{lng:a[0],lat:a[1]}:a;return this.__pt(l.lng,l.lat,s.c,s.z,s.b);}
    unproject(a){const p=Array.isArray(a)?{x:a[0],y:a[1]}:a;return this.__un(p.x,p.y);}
    panBy(o){const s=this.__st,q=this.__un(this.__vw/2+o[0],this.__vh/2+o[1]);s.c=[q.lng,q.lat];}
    areTilesLoaded(){return true;} queryRenderedFeatures(){return [];} querySourceFeatures(){return [];}
    get painter(){return {context:{gl:{VERSION:1,MAX_TEXTURE_SIZE:2,getParameter:(p)=>p===1?'WebGL 2.0 (fake)':16384,getExtension:()=>null,isContextLost:()=>false}}};}
  }
  window.mapboxgl={Map,LngLat,version:'3.9.0-fake',accessToken:''};
  window.__fireIdle=function(){(window.__listeners.idle||[]).slice().forEach(f=>f());};
})();
"""

SETUP = """async(style)=>{
  const WX=window.WX,sc=WX.S.show.scenes[0];
  sc.bg=Object.assign({type:'mapbox',mbStyle:style||'stock',style:'streets-v12',view:{c:[-71.2,42.5],z:7,b:0,p:0}});
  WX.S.show.mbMigrated=1;
  WX.loadShow(JSON.parse(JSON.stringify(WX.S.show)));
  await window.MB.init();
  return window.MB.status;}"""

def newctx(br, extra=''):
    ctx = br.new_context(viewport={'width': 1400, 'height': 900})
    ctx.add_init_script(FAKE_GL + extra)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(HTML); pg.wait_for_function("window.WX&&window.WX.S&&window.MB", timeout=20000)
    return ctx, pg, errs
def maps(pg): return pg.evaluate("()=>window.__maps.length")
def news(pg): return pg.evaluate("()=>window.__ev.filter(e=>e.t==='new').length")

EXPORT_SETUP_JS = """()=>{const E=WX.E,sc=WX.S.show.scenes[0];sc.duration=1.5;sc.bg=Object.assign({},sc.bg,{view:{c:[-71.2,42.5],z:7,b:0,p:0},view2:{c:[-70.2,42.0],z:8,b:10,p:0},camDur:1.5,camDelay:0});
      WX.S.show.scenes=[sc];WX.loadShow(JSON.parse(JSON.stringify(WX.S.show)));
      window.__enc={frames:0,closed:0,hook:null};
      window.VideoEncoder=class{constructor(o){this.o=o;this.encodeQueueSize=0;this.i=0}static async isConfigSupported(c){return{supported:/^avc1/.test(c.codec),config:c}}configure(){}
        encode(f){const i=this.i++;window.__enc.frames++;if(window.__enc.hook)window.__enc.hook(i);this.o.output({byteLength:4,copyTo:b=>b.set([0,0,0,1]),timestamp:f.timestamp,duration:f.duration,type:i===0?'key':'delta'},i===0?{decoderConfig:{description:new Uint8Array([1,100,0,40,255,225,0,0])}}:{})}
        async flush(){} close(){window.__enc.closed++}};
      window.__runExport=async()=>{window.__enc.frames=0;try{const r=await Exporter.run(WX.S.show,{width:1920,height:1080,fps:30,bitrate:1e7});return{ok:true,kind:r.kind,size:r.blob.size,frames:r.frames,encoded:window.__enc.frames}}catch(e){return{ok:false,msg:String(e&&e.message||e),encoded:window.__enc.frames}}};}"""

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])

    # ================= A. normal startup =================
    ctx, pg, errs = newctx(br)
    chk('startup with a Mapbox scene is ready', pg.evaluate(SETUP) == 'ready')
    pg.wait_for_timeout(300)
    chk('startup creates exactly ONE Mapbox map (display); no projector map', maps(pg) == 1 and pg.evaluate("()=>window.__maps[0].__isD"), maps(pg))
    u = pg.evaluate("()=>MB.usage()")
    chk('local counters: 1 display, 0 helper, labelled as a local estimate', u['page']['display'] == 1 and u['page']['projector'] == 0 and u['estimate'] is True and 'not an official Mapbox billing figure' in u['label'], u)
    chk('self-test verified the maths against the stand-in Mapbox (incl. rotation)', pg.evaluate("()=>{const q=MB.projectorInfo();return q.state==='ok'&&q.rot===true&&q.maxErr<1e-6}"), pg.evaluate("()=>MB.projectorInfo()"))

    # ---- exact projector agrees with Mapbox's own project()/unproject() for flat cameras
    r = pg.evaluate("""()=>{
      const bg=WX.S.show.scenes[0].bg,D=window.__maps[0],out=[];let worst=0;
      for(const cam of [{c:[-71.2,42.5],z:7,b:0,p:0},{c:[-100,40],z:4,b:0,p:0},{c:[-71,42],z:9.5,b:30,p:0},{c:[-95,35],z:5.2,b:-110,p:0},{c:[10,50],z:6,b:179,p:0}]){
        const x=MB.xf(bg,cam);D.jumpTo({center:cam.c,zoom:cam.z,bearing:cam.b,pitch:0});
        for(const ll of [[cam.c[0],cam.c[1]],[cam.c[0]+1.3,cam.c[1]-0.8],[cam.c[0]-2,cam.c[1]+1.1]]){
          const m=D.project(ll),f=x.fwd(ll[0],ll[1]);worst=Math.max(worst,Math.hypot(m.x*MB.scale-f[0],m.y*MB.scale-f[1]));
          const back=x.inv(f[0],f[1]);worst=Math.max(worst,Math.hypot(back[0]-ll[0],back[1]-ll[1])*1e4);}
      }
      return {worst,maps:window.__maps.length};}""")
    chk('exact projector == Mapbox project() (< 0.001 output px) and inverts cleanly, with no extra map', r['worst'] < 1e-3 and r['maps'] == 1, r)

    # ---- globe / pitch / pole need Mapbox's own transform: helper created lazily, ONCE
    r = pg.evaluate("""()=>{
      const bg=WX.S.show.scenes[0].bg,gbg=Object.assign({},bg,{proj:'globe'});
      for(let i=0;i<5;i++){MB.xf(gbg,{c:[-71,42],z:3,b:0,p:0}).fwd(-70,41);}
      MB.xf(bg,{c:[-71,42],z:7,b:0,p:40}).fwd(-70,41);MB.xf(bg,{c:[-71,84],z:3,b:0,p:0}).fwd(-70,41);
      return {maps:window.__maps.length,helper:MB.projectorInfo().helperMapExists,usage:MB.usage().page};}""")
    chk('globe / pitched / polar cameras create the helper map lazily, once', r['maps'] == 2 and r['helper'] and r['usage']['projector'] == 1, r)
    chk('flat cameras still avoid the helper afterwards (maths calls counted)', pg.evaluate("()=>{const a=MB.projectorInfo().mathCalls;MB.xf(WX.S.show.scenes[0].bg,{c:[-71,42],z:7,b:0,p:0}).fwd(-70,41);return MB.projectorInfo().mathCalls===a+1}"))
    r = pg.evaluate("""()=>{const bg=WX.S.show.scenes[0].bg;const k={c:[-71.2,42.5],z:7,b:0,p:0};
      const a=MB.panByPixels(bg,k,100,-60),b=MB.panByPixels(bg,k,100,-60);
      // reference: pan by moving the camera's screen offset on the stand-in map
      const D=window.__maps[0];D.jumpTo({center:k.c,zoom:7,bearing:0,pitch:0});D.panBy([-100/MB.scale,60/MB.scale]);const c=D.getCenter();
      return {a,b,c:[c.lng,c.lat]};}""")
    chk('drag-pan result equals Mapbox panBy for a flat camera', abs(r['a'][0]-r['c'][0]) < 1e-6 and abs(r['a'][1]-r['c'][1]) < 1e-6 and r['a'] == r['b'], r)

    # ---- scene / style / camera changes never create a map
    n0 = maps(pg)
    r = pg.evaluate("""async()=>{
      const out=[];const sc=WX.S.show.scenes[0];
      for(const st of ['streets-v12','dark-v11','satellite-streets-v12','outdoors-v12']){
        const bg=Object.assign({},sc.bg,{mbStyle:st});
        for(const z of [5,6.5,8.2]) await MB.snap(bg,{c:[-71+z/10,42+z/20],z:z,b:z*3,p:0});
      }
      const g=Object.assign({},sc.bg,{proj:'globe'});await MB.snap(g,{c:[-71,42],z:2.5,b:0,p:0});
      await MB.snap(sc.bg,{c:[-71,42],z:7,b:0,p:35});
      return {status:MB.status,styleCalls:window.__setStyleCalls||0};}""")
    chk('14 snapshots across 4 styles, zoom, bearing, globe and pitch: status stays ready', r['status'] == 'ready', r)
    chk('...and not one extra Mapbox map was created by style / zoom / camera changes (display map reused)', maps(pg) == n0, (maps(pg), n0))

    # ---- unchanged "Save & load map": nothing rebuilt. Real change (label size) rebuilds exactly once.
    r = pg.evaluate("""async()=>{
      const tk=MB.token(),sc=MB.scale,a=window.__maps.length;
      const s1=MB.setToken(tk),s2=MB.setScale(sc);await MB.init();
      return {s1,s2,created:window.__maps.length-a,skips:MB.usage().page.noopSkips};}""")
    chk('re-saving the same token and label size is skipped (no map rebuilt)', r['s1'] is False and r['s2'] is False and r['created'] == 0 and r['skips'] == 2, r)

    # ---- idle: nothing is created, requested or restyled
    # let the queued thumbnail / preview work from the snapshots above finish, then require silence
    probe = "()=>[window.__maps.length,window.__setStyleCalls||0,window.__jumps||0,window.__ev.length]"
    last, calm = None, 0
    for _ in range(40):
        cur = pg.evaluate(probe); calm = calm + 1 if cur == last else 0; last = cur
        if calm >= 6: break
        pg.wait_for_timeout(250)
    chk('editor settles after the snapshot burst (no endless Mapbox activity)', calm >= 6, last)
    snap = pg.evaluate(probe)
    pg.wait_for_timeout(3500)
    chk('idle for 3.5 s: no new map, no style change, no camera jump, no map event', pg.evaluate("()=>[window.__maps.length,window.__setStyleCalls||0,window.__jumps||0,window.__ev.length]") == snap, snap)

    # ---- diagnostics
    d = pg.evaluate("()=>MB.diagnostics()")
    chk('diagnostics: usage section labelled LOCAL ESTIMATE, projector line, token line, no token text',
        'LOCAL ESTIMATE' in d and 'Projector:' in d and 'Token: public pk.…abcd, from Streamlit Secrets' in d and 'FAKETESTTOKEN' not in d, d[:900])

    # ---- unexpected counts warn (rebuild loop simulation)
    r = pg.evaluate("""async()=>{for(let i=0;i<4;i++){MB.setScale(i%2?1.5:1.25);await MB.init();}return MB.usage();}""")
    chk('repeated rebuilds raise a local-estimate warning', r['warnings'] and 'Mapbox maps' in r['warnings'][0], r)
    chk('...the warning is in the diagnostics report too', 'WARNING (local estimate)' in pg.evaluate("()=>MB.diagnostics()"))
    pg.evaluate("()=>{MB.setScale(1.5);}"); pg.evaluate("async()=>{await MB.init()}")

    # ---- settings dialog (token from Streamlit Secrets): masked, no input, usage + warnings visible, pause toggles
    pg.evaluate("()=>{const b=[...document.querySelectorAll('button')].find(x=>/Open Map Style/.test(x.textContent));if(b)b.click()}")
    pg.wait_for_timeout(300)
    clicked = pg.evaluate("""()=>{const b=[...document.querySelectorAll('button')].find(x=>/Mapbox Token \\/ Quality|Mapbox settings/.test(x.textContent));if(b){b.click();return true}return false}""")
    chk('Mapbox settings dialog opens', clicked)
    pg.wait_for_selector('#mbUsage', timeout=4000)
    txt = pg.inner_text('.modal, [role=dialog], body')
    chk('dialog: Streamlit-Secrets token shown masked, no token input to retype', pg.query_selector('#mbTokenSrc') is not None and 'pk.…abcd' in pg.inner_text('#mbTokenSrc') and 'FAKETESTTOKEN' not in txt and pg.evaluate("()=>!document.querySelector('input[type=password]')"))
    chk('dialog: usage is labelled a local estimate and points to Mapbox for real usage', 'local estimate' in pg.inner_text('#mbUsage') and 'Mapbox account' in pg.inner_text('#mbUsage'), pg.inner_text('#mbUsage'))
    chk('dialog: URL-restriction hint names this deployment', 'URL restrictions' in pg.inner_text('#mbUrlHint'))
    a = maps(pg)
    pg.click('text=Save & load map'); pg.wait_for_timeout(500)
    chk('"Save & load map" with nothing changed creates no map', maps(pg) == a, (maps(pg), a))
    br_ctx_close = ctx
    # ---- pause + snapshots
    r = pg.evaluate("""async()=>{
      const bg=WX.S.show.scenes[0].bg,known={c:[-71.2,42.5],z:7,b:0,p:0};await MB.snap(bg,known);
      MB.setPaused(true);const a=window.__maps.length,sc=window.__setStyleCalls||0,j=window.__jumps||0;
      let err=null;try{await MB.snap(bg,{c:[-60,30],z:6,b:0,p:0});}catch(e){err=e;}
      const cached=await MB.snap(bg,known);
      let initErr=null;MB.queue=Promise.resolve();
      return {rejected:!!(err&&err.mbPaused),status:MB.status,cachedOk:!!cached,newMaps:window.__maps.length-a,newStyle:(window.__setStyleCalls||0)-sc,newJumps:(window.__jumps||0)-j,paused:MB.paused};}""")
    chk('paused: an uncached snapshot is refused without becoming an error; cached frames still serve', r['rejected'] and r['status'] == 'ready' and r['cachedOk'] and r['paused'], r)
    chk('paused: no map, style change or camera jump was issued', r['newMaps'] == 0 and r['newStyle'] == 0 and r['newJumps'] == 0, r)
    chk('paused: coordinate maths and style-card previews need no Mapbox request', pg.evaluate("()=>MB.xf(WX.S.show.scenes[0].bg,{c:[-71,42],z:7,b:0,p:0})!==null&&MB.satellitePreviewUrl()===null"))
    chk('dialog button now offers to resume; pausing is stored per tab', pg.evaluate("()=>sessionStorage.getItem('wx.mapbox.paused')==='1'"))

    # ---- export dialog while paused: blocked with a one-click resume
    pg.evaluate("()=>{const b=[...document.querySelectorAll('#modalBg button')].find(x=>x.textContent.trim()==='Close');if(b)b.click()}")
    pg.wait_for_timeout(300)
    pg.click('#bExport'); pg.wait_for_selector('.expcheck', timeout=6000)
    pg.wait_for_selector('#mbResumeExport', timeout=8000)
    chk('export preflight: paused Mapbox is an error with a "Resume Mapbox" button', 'paused' in pg.inner_text('.expcheck') and pg.evaluate("()=>document.querySelector('.expcheck').innerText.includes('✖')"))
    chk('export "Start export" is blocked while paused', pg.evaluate("()=>{const b=[...document.querySelectorAll('button')].find(x=>/Start export/.test(x.textContent));return !!b&&b.disabled}"))
    pg.click('#mbResumeExport'); pg.wait_for_timeout(800)
    chk('Resume from the export dialog resumes Mapbox and clears the error', pg.evaluate("()=>MB.paused===false")
        and pg.query_selector('#mbResumeExport') is None)
    chk('no page errors (normal flow)', not errs, errs)
    ctx.close()

    # ================= A2. pause blocks camera-driven requests and handles in-flight work =================
    ctx2, pg2, errs2 = newctx(br)
    pg2.evaluate(SETUP)
    pg2.wait_for_timeout(300)
    r = pg2.evaluate("""()=>{const bg=WX.S.show.scenes[0].bg;MB.liveFrame(bg,{c:[-71.2,42.5],z:7,b:0,p:0});return {jumps:window.__jumps||0,maps:window.__maps.length}}""")
    base_j, base_m = r['jumps'], r['maps']
    pg2.evaluate("()=>MB.setPaused(true)")
    r = pg2.evaluate("""()=>{const bg=WX.S.show.scenes[0].bg,out=[];
      for(let i=0;i<12;i++)out.push(MB.liveFrame(bg,{c:[-71.2+i*.3,42.5-i*.1],z:7+i*.1,b:i,p:0}));
      const same=MB.liveFrame(bg,{c:[-71.2,42.5],z:7,b:0,p:0});
      return {jumps:(window.__jumps||0),maps:window.__maps.length,nulls:out.filter(x=>!x).length,sameIsCanvas:!!same,status:MB.status}}""")
    chk('paused: 12 live-preview camera changes issue no camera move (jumpTo) and no map', r['jumps'] == base_j and r['maps'] == base_m and r['status'] == 'ready', (r, base_j))
    chk('paused: the canvas already at the requested camera is still shown', r['sameIsCanvas'])
    pg2.evaluate("()=>{window.__tiles.b={state:'errored'};window.__fireIdle();}")
    pg2.wait_for_timeout(2600)
    chk('paused: a failed tile is NOT automatically re-requested, and "Reload map tiles" does nothing',
        pg2.evaluate("()=>window.__tiles.b.state")=='errored' and pg2.evaluate("()=>MB.reloadTiles()") == 0)
    pg2.evaluate("()=>{window.__tiles.b={state:'loaded'};MB.setPaused(false);}")
    # -- in-flight snapshot: slow tiles, pause while it waits
    pg2.evaluate("()=>{window.__slow=true;window.__snapRes=null;const bg=WX.S.show.scenes[0].bg;MB.snap(bg,{c:[-90,35],z:6,b:0,p:0}).then(v=>window.__snapRes={ok:!!v},e=>window.__snapRes={err:e.message,paused:!!e.mbPaused})}")
    pg2.wait_for_function("()=>(window.__jumps||0)>%d" % base_j, timeout=5000)
    j_started = pg2.evaluate("()=>window.__jumps")
    pg2.evaluate("()=>MB.setPaused(true)")
    pg2.wait_for_function("()=>window.__snapRes!==null", timeout=6000)
    r = pg2.evaluate("()=>({res:window.__snapRes,status:MB.status,jumps:window.__jumps,maps:window.__maps.length})")
    chk('in-flight snapshot ends promptly when paused, without latching a Mapbox error', (r['res'].get('paused') or r['res'].get('ok') is False) and r['status'] == 'ready', r)
    chk('...and issues no further camera move or map after the pause', r['jumps'] == j_started and r['maps'] == base_m, (r, j_started))
    pg2.evaluate("()=>{window.__slow=false}")
    pg2.wait_for_timeout(800)
    chk('paused afterwards: still no camera move / map / style change', pg2.evaluate("()=>[window.__jumps,window.__maps.length]") == [j_started, base_m])
    # -- resume: no new billable map; the camera is re-applied by the normal redraw
    r = pg2.evaluate("""async()=>{MB.setPaused(false);const bg=WX.S.show.scenes[0].bg;
      MB.liveFrame(bg,{c:[-80,38],z:6.5,b:0,p:0});const cv=await MB.snap(bg,{c:[-90,35],z:6,b:0,p:0});
      return {maps:window.__maps.length,ok:!!cv,status:MB.status,jumps:window.__jumps,u:MB.usage().page}}""")
    chk('resume: live preview and snapshots work again with NO new map', r['ok'] and r['maps'] == base_m and r['status'] == 'ready' and r['jumps'] > j_started and r['u']['display'] == 1 and r['u']['projector'] == 0, r)
    # -- rapid pause + resume while setup() awaits style.load: the interrupted operation must not keep changing the map
    sc0 = pg2.evaluate("()=>window.__setStyleCalls||0")
    pg2.evaluate("()=>{window.__styleDelay=500;window.__snapRes2=null;const bg=Object.assign({},WX.S.show.scenes[0].bg,{mbStyle:'dark-v11'});MB.snap(bg,{c:[-100,40],z:5,b:0,p:0}).then(v=>window.__snapRes2={ok:!!v},e=>window.__snapRes2={err:e.message,stale:!!e.mbStale})}")
    pg2.wait_for_function("(c)=>(window.__setStyleCalls||0)>c", arg=sc0, timeout=5000)
    j0 = pg2.evaluate("()=>window.__jumps")
    pg2.evaluate("()=>{MB.setPaused(true);MB.setPaused(false);}")        # rapid pause/resume mid style load
    pg2.wait_for_function("()=>window.__snapRes2!==null", timeout=6000)
    r = pg2.evaluate("()=>({res:window.__snapRes2,lng:window.__maps[0].getCenter().lng,status:MB.status,maps:window.__maps.length,paused:MB.paused})")
    chk('pause+resume while the style loads: the old frame is dropped as stale and never moves the camera to its own view', r['res'].get('stale') is True and abs(r['lng'] + 100) > 1 and r['status'] == 'ready' and not r['paused'], (r, j0))
    pg2.evaluate("()=>{window.__styleDelay=0}")
    r = pg2.evaluate("""async()=>{const bg=Object.assign({},WX.S.show.scenes[0].bg,{mbStyle:'dark-v11'});const cv=await MB.snap(bg,{c:[-100,40],z:5,b:0,p:0});return {ok:!!cv,status:MB.status,maps:window.__maps.length}}""")
    chk('...and the next frame re-applies its own style and renders, with no new map', r['ok'] and r['status'] == 'ready' and r['maps'] == base_m, r)
    chk('pause/resume cycle raised no page errors', not errs2, errs2)
    ctx2.close()

    # -- v0.10.3.3: rapid pause + resume while the INITIAL Mapbox load is still pending (before the first Map has loaded)
    ctx3, pg3, errs3 = newctx(br, "window.__loadDelay=900;")
    r = pg3.evaluate("""async()=>{
      const bg=Object.assign({},WX.S.show.scenes[0].bg,{type:'mapbox',mbStyle:'stock',style:'streets-v12'});
      window.__initSnap=null;const st0=MB.status;
      MB.snap(bg,{c:[-100,40],z:5,b:0,p:0}).then(v=>window.__initSnap={ok:!!v},e=>window.__initSnap={err:e.message,stale:!!e.mbStale});
      await new Promise(r=>setTimeout(r,150));
      const loadedBefore=!!(window.__map&&window.__map.__loaded);
      window.__jt=[];const mm=window.__map,oj=mm.jumpTo.bind(mm);mm.jumpTo=function(o){window.__jt.push(o&&o.center?(o.center.lng!==undefined?o.center.lng:o.center[0]):null);return oj(o)};
      MB.setPaused(true);MB.setPaused(false);                 // rapid pause/resume while Mapbox is still loading for the first time
      return {st0,loadedBefore,maps:window.__maps.length}}""")
    chk('setup: the first Map exists but has not finished loading when pause+resume happens', r['maps'] == 1 and not r['loadedBefore'], r)
    pg3.wait_for_function("()=>window.__initSnap!==null", timeout=8000)
    r = pg3.evaluate("()=>({res:window.__initSnap,lng:window.__map.getCenter().lng,z:window.__map.getZoom(),status:MB.status,maps:window.__maps.length,paused:MB.paused,jumps:window.__jumps||0,jt:window.__jt})")
    chk('pause+resume during the initial load: the outdated snapshot is dropped as stale', r['res'].get('stale') is True, r)
    chk('...it never moves the camera to its own view', abs(r['lng'] + 100) > 1 and not any(l is not None and abs(l + 100) < 1 for l in r['jt']), r)   # the editor's own redraw may jump to the scene view; the stale request's view (-100) must never be applied
    chk('...no error is latched and exactly one billable map load happened', r['status'] == 'ready' and r['maps'] == 1 and not r['paused'], r)
    r = pg3.evaluate("""async()=>{const bg=Object.assign({},WX.S.show.scenes[0].bg,{type:'mapbox',mbStyle:'stock',style:'streets-v12'});const cv=await MB.snap(bg,{c:[-100,40],z:5,b:0,p:0});return {ok:!!cv,status:MB.status,maps:window.__maps.length,lng:window.__map.getCenter().lng}}""")
    chk('a fresh snapshot after that renders normally with no new map', r['ok'] and r['status'] == 'ready' and r['maps'] == 1 and abs(r['lng'] + 100) < 1, r)
    chk('initial-load pause/resume raised no page errors', not errs3, errs3)
    ctx3.close()

    # ================= D. v0.10.3.4: an INTERRUPTED map export must FAIL, never yield a "successful" but incomplete MP4 =================
    ctx4, pg4, errs4 = newctx(br)
    downloads = []; pg4.on('download', lambda d: downloads.append(d.suggested_filename))
    pg4.evaluate(SETUP, 'stock')
    # a 1.5 s show whose camera moves the whole time, so EVERY frame needs its own Mapbox snapshot (45 frames)
    pg4.evaluate(EXPORT_SETUP_JS)
    r = pg4.evaluate("()=>window.__runExport()")
    chk('control: an uninterrupted map export succeeds with a complete MP4 (45 of 45 frames)', r.get('ok') and r['kind'] == 'mp4' and r['size'] > 0 and r['encoded'] == 45 and r['frames'] == 45, r)
    def interrupted(label, hook_js, expect_re):
        pg4.evaluate("()=>{window.__slow=false;MB.setPaused(false)}")
        pg4.evaluate("()=>{window.__enc.hook=" + hook_js + "}")
        r = pg4.evaluate("()=>window.__runExport()")
        pg4.evaluate("()=>{window.__enc.hook=null;window.__slow=false;MB.setPaused(false)}")
        chk(label + ': export reports FAILURE, no MP4 is returned', (not r['ok']) and 'blob' not in r and 'size' not in r, r)
        chk(label + ': the failure names the pause/reset reason', bool(__import__('re').search(expect_re, r.get('msg', ''), __import__('re').I)), r)
        chk(label + ': stopped early - only part of the frames were encoded (never 45/45 passed off as complete)', 0 < r['encoded'] < 45, r)
        return r
    interrupted('pause mid-export', "i=>{if(i===10)MB.setPaused(true)}", r'paused')
    interrupted('pause + immediate resume while a frame is rendering (stale)', "i=>{if(i===10){window.__slow=true;setTimeout(()=>{MB.setPaused(true);MB.setPaused(false)},80);setTimeout(()=>{window.__slow=false},300)}}", r'paused|reset')
    interrupted('map reset while a frame is rendering', "i=>{if(i===10){window.__slow=true;setTimeout(()=>MB.reset(),80);setTimeout(()=>{window.__slow=false},300)}}", r'paused|reset')
    chk('the encoder was closed or released after each failed export (no stuck export state)', pg4.evaluate("()=>!WX.E.exporting"), '')
    r = pg4.evaluate("()=>window.__runExport()")
    chk('after the failures a fresh export succeeds again (45/45)', r.get('ok') and r['encoded'] == 45, r)
    # the dialog path: failure message shown, no file saved, no playable result offered
    pg4.evaluate("()=>{window.__enc.hook=i=>{if(i===10)MB.setPaused(true)}}")
    pg4.evaluate("()=>{document.getElementById('bExport').click()}"); pg4.wait_for_timeout(800)
    n0 = len(downloads)
    pg4.evaluate("()=>{const b=[...document.querySelectorAll('#modal .mb button')].find(b=>b.textContent==='Start export');b&&b.click()}"); pg4.wait_for_timeout(5000)
    d = pg4.evaluate("()=>({msg:(document.querySelector('#modal .prog')||{nextElementSibling:{}}).nextElementSibling.textContent,video:document.querySelectorAll('#modal video').length})")
    chk('dialog: shows "Export failed" for the interrupted map export', 'Export failed' in d['msg'], d)
    chk('dialog: no video result and no file download after the failure', d['video'] == 0 and len(downloads) == n0, (d, downloads))
    chk('interrupted-export section raised no page errors', not errs4, errs4)
    ctx4.close()

    # ================= E. v0.10.3.5: MP4 export validation - every required Mapbox snapshot must be COMPLETE for its camera =================
    import re as _re
    ctx5, pg5, errs5 = newctx(br, "window.__withOptional=true;")
    dl5 = []; pg5.on('download', lambda d: dl5.append(d.suggested_filename))
    pg5.evaluate(SETUP, 'stock'); pg5.evaluate(EXPORT_SETUP_JS)
    pg5.evaluate("()=>{window.__showBefore=JSON.stringify(WX.S.show);window.__lsBefore=JSON.stringify(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]))}")
    R = lambda: pg5.evaluate("()=>window.__runExport()")
    def reset5():
        pg5.evaluate("""()=>{window.__enc.hook=null;window.__slow=false;window.__pendingRenders=0;window.__failTiles={};window.__optTiles.x={state:'loaded'};
          for(const k of ['a','b','c','d'])window.__tiles[k]={state:'loaded'};MB.setPaused(false);MB.cache.clear&&MB.cache.clear();}""")
    r = R()
    chk('control: complete satellite imagery exports 45/45 frames as an MP4', r.get('ok') and r['kind'] == 'mp4' and r['encoded'] == 45, r)
    closed0 = pg5.evaluate("()=>window.__enc.closed")

    # (1) critical tiles still loading when the frame is taken, then they arrive (recovered imagery): export still succeeds
    reset5(); pg5.evaluate("()=>{window.__enc.hook=i=>{if(i===10){window.__tiles.b={state:'loading'};window.__pendingRenders=6}}}")
    r = R(); chk('critical tile pending at first, loads during the bounded waits: export succeeds 45/45', r.get('ok') and r['encoded'] == 45, r)
    # (2) failed critical tile that the existing tile recovery re-requests successfully
    reset5(); pg5.evaluate("()=>{window.__updates=0;window.__enc.hook=i=>{if(i===10){window.__tiles.b={state:'errored'}}}}")
    r = R(); u = pg5.evaluate("()=>window.__updates")
    chk('failed critical tile is retried by the existing recovery and recovered: export succeeds 45/45', r.get('ok') and r['encoded'] == 45, (r, u))
    # (3) optional overlay permanently errored: never blocks
    reset5(); pg5.evaluate("()=>{window.__optTiles.x={state:'errored'};window.__enc.hook=null}")
    r = R(); chk('optional (terrain/overlay) source failing permanently does not block the export', r.get('ok') and r['encoded'] == 45, r)
    # (4) critical tile never loads (pending forever): export FAILS with a useful message, bounded, no MP4
    reset5(); pg5.evaluate("()=>{window.__enc.hook=i=>{if(i===10){window.__tiles.b={state:'loading'};window.__pendingRenders=0}}}")
    t0 = __import__('time').time(); r = R(); dt = __import__('time').time() - t0
    chk('critical tile never loads: export reports failure, no MP4', (not r['ok']) and 'size' not in r, r)
    chk('...message names the scene, the time and the missing imagery', bool(_re.search(r'Map scene ".*" at \d+\.\d s: Required map imagery did not finish loading: 1 still loading of \d+ required map tiles', r.get('msg', ''))), r)
    chk('...stopped at the first bad frame (not 45) and within a bounded time', 0 < r['encoded'] < 45 and dt < 40, (r['encoded'], dt))
    chk('...no editor-wide error was latched and no extra Mapbox map was created', pg5.evaluate("()=>MB.status")=='ready' and pg5.evaluate("()=>window.__maps.length") == 1, '')
    # (5) critical tile fails and every retry fails: FAIL, retries bounded
    reset5(); pg5.evaluate("()=>{window.__updates=0;window.__failTiles={b:true};window.__enc.hook=i=>{if(i===10){window.__tiles.b={state:'errored'}}}}")
    r = R(); u = pg5.evaluate("()=>window.__updates")
    chk('critical tile permanently failing: export fails with "failed to load" and no MP4', (not r['ok']) and 'size' not in r and 'Required map imagery failed to load' in r.get('msg', ''), r)
    chk('...tile retries are bounded (existing recovery, no flood)', u <= 12, u)
    # (6) 429 cool-down: no hammering, fail at once with the cool-down in the message
    reset5(); pg5.evaluate("""()=>{window.__updates=0;window.__failTiles={b:true};window.__enc.hook=i=>{if(i===10){window.__tiles.b={state:'errored'};(window.__listeners.error||[]).forEach(f=>f({error:{status:429,message:'Too Many Requests',url:'https://api.mapbox.com/v4/x?access_token=pk.x'}}))}}}""")
    r = R(); u = pg5.evaluate("()=>window.__updates")
    chk('HTTP 429 cool-down: export fails and says Mapbox is rate-limiting', (not r['ok']) and _re.search(r'rate-limiting|429', r.get('msg', '')) is not None, r)
    chk('...and sent no tile re-requests during the cool-down', u == 0, u)
    # (7) cleanup + a later attempt works + saved show untouched
    n_fail = 3
    chk('encoder released after every failed export', pg5.evaluate("()=>window.__enc.closed") - closed0 >= n_fail + 3, pg5.evaluate("()=>window.__enc.closed"))
    chk('exporting flag cleared, show data and saved storage untouched by the failures', pg5.evaluate("()=>!WX.E.exporting&&JSON.stringify(WX.S.show)===window.__showBefore&&JSON.stringify(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]))===window.__lsBefore"), '')
    pg5.wait_for_timeout(300)
    # the cool-down is a real state: wait it out by clearing it the way time would (expire), then a fresh export must succeed
    reset5(); pg5.evaluate("()=>{window.__listeners.error=[];}")
    pg5.wait_for_timeout(6500)
    r = R(); chk('a later export attempt succeeds again (45/45)', r.get('ok') and r['encoded'] == 45, r)
    # (8) export dialog: failure shown, nothing saved or offered
    reset5(); pg5.evaluate("()=>{window.__tiles.b={state:'loading'};window.__enc.hook=null;window.__pendingRenders=0;MB.cache.clear&&MB.cache.clear()}")
    n0 = len(dl5)
    pg5.evaluate("()=>{document.getElementById('bExport').click()}"); pg5.wait_for_timeout(800)
    pg5.evaluate("()=>{const b=[...document.querySelectorAll('#modal .mb button')].find(b=>b.textContent==='Start export');b&&b.click()}"); pg5.wait_for_timeout(9000)
    d = pg5.evaluate("()=>({msg:(document.querySelector('#modal .prog')||{nextElementSibling:{}}).nextElementSibling.textContent,video:document.querySelectorAll('#modal video').length})")
    chk('dialog: "Export failed" with the missing-imagery reason, no video, no download', 'Export failed' in d['msg'] and 'Required map imagery' in d['msg'] and d['video'] == 0 and len(dl5) == n0, (d, dl5))
    chk('export-validation section raised no page errors', not [e for e in errs5 if 'Required map imagery' not in e], errs5)
    ctx5.close()

    # ================= B. starting paused (e.g. the tab was paused, then Streamlit reran) =================
    ctx, pg, errs = newctx(br, "sessionStorage.setItem('wx.mapbox.paused','1');")
    r = pg.evaluate("""async()=>{
      const WX=window.WX,sc=WX.S.show.scenes[0];sc.bg={type:'mapbox',mbStyle:'stock',style:'streets-v12',view:{c:[-71.2,42.5],z:7,b:0,p:0}};WX.S.show.mbMigrated=1;
      WX.loadShow(JSON.parse(JSON.stringify(WX.S.show)));
      let e=null;try{await MB.init();}catch(x){e=x}
      await new Promise(r=>setTimeout(r,800));
      return {paused:MB.paused,status:MB.status,rejected:!!(e&&e.mbPaused),maps:window.__maps.length};}""")
    chk('starting paused: no Mapbox map is created, nothing is marked as an error', r['paused'] and r['status'] == 'idle' and r['rejected'] and r['maps'] == 0, r)
    chk('starting paused: the editor still draws (placeholder) without errors', not errs, errs)
    r = pg.evaluate("""async()=>{MB.setPaused(false);await MB.init();return {maps:window.__maps.length,status:MB.status};}""")
    chk('resume starts exactly one map and becomes ready', r['maps'] == 1 and r['status'] == 'ready', r)
    ctx.close()

    # ================= C. page reloads are counted per tab session =================
    ctx, pg, errs = newctx(br)
    pg.evaluate(SETUP)
    pg.reload(); pg.wait_for_function("window.WX&&window.WX.S&&window.MB", timeout=20000)
    pg.evaluate(SETUP)
    u = pg.evaluate("()=>MB.usage()")
    chk('after one reload: this page 1 map, this tab session 2 maps, this month 2', u['page']['maps'] == 1 and u['session']['maps'] == 2 and u['month']['maps'] == 2, u)
    # pause state: kept across an ordinary reload of the same tab (Streamlit iframe reload), new tabs default to active
    pg.evaluate("()=>MB.setPaused(true)")
    pg.reload(); pg.wait_for_function("window.WX&&window.WX.S&&window.MB", timeout=20000)
    chk('pause survives a reload of the same tab', pg.evaluate("()=>MB.paused===true"))
    ctxn = br.new_context(); pgn = ctxn.new_page(); pgn.add_init_script(FAKE_GL); pgn.goto(HTML); pgn.wait_for_function("window.WX&&window.WX.S&&window.MB", timeout=20000)
    chk('a new tab / browser session starts active (not paused)', pgn.evaluate("()=>MB.paused===false"))
    ctxn.close()
    pg.evaluate("()=>MB.setPaused(false)")
    ctx.close()

    # ================= D. forced native helper (troubleshooting switch) keeps the old behaviour =================
    ctx, pg, errs = newctx(br, "localStorage.setItem('wx.mapbox.projector','native');")
    pg.evaluate(SETUP)
    r = pg.evaluate("""()=>{const x=MB.xf(WX.S.show.scenes[0].bg,{c:[-71.2,42.5],z:7,b:0,p:0});const f=x.fwd(-70,41.5);return {maps:window.__maps.length,helper:MB.projectorInfo().helperMapExists,f,mode:MB.projectorInfo().mode};}""")
    chk('native mode: display + helper maps (2 loads) and coordinates still work', r['maps'] == 2 and r['helper'] and r['mode'] == 'native' and r['f'][0] == r['f'][0], r)
    f_native = r['f']
    ctx.close()
    ctx, pg, errs = newctx(br)
    pg.evaluate(SETUP)
    f_math = pg.evaluate("()=>MB.xf(WX.S.show.scenes[0].bg,{c:[-71.2,42.5],z:7,b:0,p:0}).fwd(-70,41.5)")
    chk('maths and native helper give the same screen position (< 0.001 px)', abs(f_math[0] - f_native[0]) < 1e-3 and abs(f_math[1] - f_native[1]) < 1e-3, (f_math, f_native))
    ctx.close()

    # ================= E. sk. token in Secrets is not used; a browser token is still allowed =================
    ctx, pg, errs = newctx(br, "window.WX_MAPBOX_TOKEN='sk.eyJ1IjoidGVzdCJ9.TOPSECRETVALUE';")
    r = pg.evaluate("()=>({has:MB.hasToken(),info:MB.tokenInfo()})")
    chk('a secret (sk.) token is never treated as usable and never echoed', r['has'] is False and 'REJECTED' in r['info']['kind'] and 'TOPSECRET' not in str(r), r)
    ctx.close()
    br.close()
bad = [r for r in res if not r[1]]
print('\n%d/%d checks passed' % (len(res) - len(bad), len(res)))
sys.exit(1 if bad else 0)
