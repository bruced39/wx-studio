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
  const cache={_tiles:window.__tiles,_removeTile(k){delete this._tiles[k];},update(){for(const k of ['a','b','c','d']){if(!this._tiles[k])this._tiles[k]={state:'loaded'};}window.__paint();}};
  window.__listeners={};
  window.__paint=function(){const m=window.__map;if(!m)return;const c=m.__canvas.getContext('2d');c.fillStyle='#2a6a3a';c.fillRect(0,0,W,H);m.__renders=(m.__renders||0)+1;(window.__listeners.render||[]).slice().forEach(f=>f());};
  const mx=lng=>(180+lng)/360,my=lat=>(180-(180/Math.PI)*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360)))/360;
  class LngLat{constructor(a,b){this.lng=a;this.lat=b;}}
  class Map{
    constructor(o){
      this.__canvas=document.createElement('canvas');this.__canvas.width=W;this.__canvas.height=H;
      this.style={_sourceCaches:{'mapbox-satellite':cache}};this.__ls={};this.__loaded=false;this.__o=o;this.__isD=!!(o&&typeof o.style==='string');
      const c=o.center||[0,0];this.__st={c:[c.lng!==undefined?c.lng:c[0],c.lat!==undefined?c.lat:c[1]],z:o.zoom==null?1:o.zoom,b:o.bearing||0,p:o.pitch||0};
      this.__vw=(o.container&&o.container.clientWidth)||1280;this.__vh=(o.container&&o.container.clientHeight)||720;
      this.__proj=(o.projection&&o.projection.name)||o.projection||'mercator';
      window.__maps.push(this);window.__ev.push({t:'new',d:this.__isD});
      if(this.__isD){window.__map=this;o.container.appendChild(this.__canvas);setTimeout(()=>{this.__loaded=true;(this.__ls.load||[]).forEach(f=>f());window.__paint();},20);}
      const self=this;
      this.transform={clone(){const t={zoom:0,pitch:0,bearing:0,center:null,locationPoint(ll){return self.__pt(ll.lng,ll.lat,[t.center.lng,t.center.lat],t.zoom,t.bearing);}};return t;}};
    }
    __pt(lng,lat,c,z,b){const world=512*2**z,ang=-b*Math.PI/180,dx=(mx(lng)-mx(c[0]))*world,dy=(my(lat)-my(c[1]))*world;
      return {x:this.__vw/2+dx*Math.cos(ang)-dy*Math.sin(ang),y:this.__vh/2+dx*Math.sin(ang)+dy*Math.cos(ang)};}
    __un(x,y){const s=this.__st,world=512*2**s.z,ang=-s.b*Math.PI/180,u=x-this.__vw/2,v=y-this.__vh/2,dx=u*Math.cos(ang)+v*Math.sin(ang),dy=-u*Math.sin(ang)+v*Math.cos(ang);
      const X=mx(s.c[0])+dx/world,Y=my(s.c[1])+dy/world;return {lng:X*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*Y)))*180/Math.PI};}
    on(ev,fn){(this.__ls[ev]=this.__ls[ev]||[]).push(fn);if(this.__isD){(window.__listeners[ev]=window.__listeners[ev]||[]).push(fn);}return this;}
    once(ev,fn){const w=(...a)=>{this.off(ev,w);fn(...a)};this.on(ev,w);if(ev==='style.load')setTimeout(()=>{(this.__ls['style.load']||[]).slice().forEach(f=>f());},10);return this;}
    off(ev,fn){for(const t of [this.__ls,window.__listeners]){if(t[ev])t[ev]=t[ev].filter(f=>f!==fn);}return this;}
    getCanvas(){return this.__canvas;} loaded(){return this.__loaded;} isMoving(){return false;}
    jumpTo(o){const s=this.__st;if(o.center){s.c=[o.center.lng!==undefined?o.center.lng:o.center[0],o.center.lat!==undefined?o.center.lat:o.center[1]];}
      if(o.zoom!=null)s.z=o.zoom;if(o.bearing!=null)s.b=o.bearing;if(o.pitch!=null)s.p=o.pitch;window.__jumps=(window.__jumps||0)+1;}
    triggerRepaint(){setTimeout(()=>window.__paint(),0);} resize(){} remove(){window.__ev.push({t:'remove',d:this.__isD});}
    getSource(){return undefined;} getLayer(){return undefined;} getStyle(){return {layers:[],sources:{}};}
    setStyle(){window.__setStyleCalls=(window.__setStyleCalls||0)+1;setTimeout(()=>{(this.__ls['style.load']||[]).slice().forEach(f=>f());},5);}
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
        const bg=Object.assign({},sc.bg,{mbStyle:'stock',style:st});
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
