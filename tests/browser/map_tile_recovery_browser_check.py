"""Real-browser (headless Chromium) check of the satellite tile-recovery fix (v0.10.2.2).
Mapbox GL cannot be downloaded in CI, so a stand-in `mapboxgl` is injected that behaves like the real library where it matters:
map.loaded() is TRUE even when tiles FAILED to download, failed tiles are never retried by the library itself, and they emit an 'error' event.
Checks: failed tiles are detected and re-requested (live view), a snapshot never caches a frame with failed tiles, the diagnostics dialog works,
and a WebGL context restore drops stale frames.
Usage: python3 wxbuild.py && python3 tests/browser/map_tile_recovery_browser_check.py"""
from playwright.sync_api import sync_playwright
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
HTML = (ROOT / 'dist' / 'studio.html').as_uri()
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, ('' if ok else info))

FAKE_GL = r"""
window.WX_MAPBOX_TOKEN='pk.fake-test-token';
(function(){
  const W=1920,H=1080;
  window.__tiles={a:{state:'loaded'},b:{state:'loaded'},c:{state:'loaded'},d:{state:'loaded'}};
  window.__failNext={};      // tile key -> times it will fail again when requested
  window.__requests=[];      // every (re)request of a tile
  const cache={_tiles:window.__tiles,
    _removeTile(k){delete this._tiles[k];},
    update(){for(const k of ['a','b','c','d']){if(this._tiles[k])continue;window.__requests.push(k);
      if((window.__failNext[k]||0)>0){window.__failNext[k]--;this._tiles[k]={state:'errored'};}else this._tiles[k]={state:'loaded'};}
      window.__paint();}};
  window.__cache=cache;
  window.__listeners={};
  window.__paint=function(){const m=window.__map;if(!m)return;const c=m.__canvas.getContext('2d');
    // paint a satellite-ish picture; failed tiles stay black (the "rectangular holes")
    c.fillStyle='#000';c.fillRect(0,0,W,H);
    [['a',0,0],['b',960,0],['c',0,540],['d',960,540]].forEach(([k,x,y])=>{if(cache._tiles[k]&&cache._tiles[k].state==='loaded'){c.fillStyle='#2a6a3a';c.fillRect(x,y,960,540);}});
    m.__renders=(m.__renders||0)+1;(window.__listeners.render||[]).slice().forEach(f=>f());};
  class Map{
    constructor(o){this.__canvas=document.createElement('canvas');this.__canvas.width=W;this.__canvas.height=H;
      this.style={_sourceCaches:{'mapbox-satellite':cache}};this.transform={};this.__ls={};this.__loaded=false;
      if(o&&o.container&&o.style&&typeof o.style==='string'){window.__map=this;o.container.appendChild(this.__canvas);
        setTimeout(()=>{this.__loaded=true;(this.__ls.load||[]).forEach(f=>f());window.__paint();},20);}
      this.__o=o;this.__isD=!!(o&&typeof o.style==='string');}
    on(ev,fn){(this.__ls[ev]=this.__ls[ev]||[]).push(fn);if(this.__isD){(window.__listeners[ev]=window.__listeners[ev]||[]).push(fn);}return this;}
    once(ev,fn){const w=(...a)=>{this.off(ev,w);fn(...a)};this.on(ev,w);
      if(ev==='style.load')setTimeout(()=>{(this.__ls['style.load']||[]).slice().forEach(f=>f());},10);return this;}
    off(ev,fn){for(const t of [this.__ls,window.__listeners]){if(t[ev])t[ev]=t[ev].filter(f=>f!==fn);}return this;}
    getCanvas(){return this.__canvas;} loaded(){return this.__loaded;} isMoving(){return false;}
    jumpTo(){} triggerRepaint(){setTimeout(()=>window.__paint(),0);} resize(){} remove(){}
    getSource(){return undefined;} getLayer(){return undefined;} getStyle(){return {layers:[],sources:{}};}
    setStyle(){window.__setStyleCalls=(window.__setStyleCalls||0)+1;setTimeout(()=>{(this.__ls['style.load']||[]).slice().forEach(f=>f());},5);} setProjection(){} setFog(){} setTerrain(){}
    addSource(){} addLayer(){} removeLayer(){} removeSource(){} setPaintProperty(){} setLayoutProperty(){} setFilter(){}
    getCenter(){return {lng:-73.5,lat:42};} project(){return {x:0,y:0};} unproject(){return {lng:0,lat:0};} panBy(){}
    areTilesLoaded(){return true;} queryRenderedFeatures(){return [];} querySourceFeatures(){return [];} setPadding(){} getZoom(){return 5;}
    get painter(){return {context:{gl:{VERSION:1,MAX_TEXTURE_SIZE:2,getParameter:(p)=>p===1?'WebGL 2.0 (fake)':16384,getExtension:()=>null,isContextLost:()=>false}}};}
  }
  window.mapboxgl={Map,version:'3.9.0-fake',accessToken:''};
  window.__fireError=function(status){(window.__listeners.error||[]).slice().forEach(f=>f({error:{status:status,message:'Failed '+status+' https://api.mapbox.com/v4/mapbox.satellite/5/9/11@2x.webp?access_token=pk.fake-test-token'},sourceId:'mapbox-satellite'}));};
  window.__fireIdle=function(){(window.__listeners.idle||[]).slice().forEach(f=>f());};
})();
"""

SETUP = """async()=>{
  const WX=window.WX,sc=WX.S.show.scenes[0];
  sc.bg={type:'mapbox',mbStyle:'stock',style:'satellite-streets-v12',view:{c:[-73.46,42.05],z:5.36,b:0,p:0}};
  WX.S.show.mbMigrated=1;
  WX.loadShow(JSON.parse(JSON.stringify(WX.S.show)));
  await window.MB.init();
  return window.MB.status;}"""

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])
    ctx = br.new_context(viewport={'width': 1400, 'height': 900})
    ctx.add_init_script(FAKE_GL)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(HTML); pg.wait_for_function("window.WX&&window.WX.S&&window.MB", timeout=20000)
    chk('map initialises with the stand-in Mapbox', pg.evaluate(SETUP) == 'ready')
    pg.wait_for_timeout(300)

    cam = "{c:[-73.46,42.05],z:5.36,b:0,p:0}"
    # ---- 1. live view: a tile fails (HTTP 429) -> detected + re-requested with no user action
    pg.evaluate("()=>{window.__failNext.b=0;window.__tiles.b={state:'errored'};window.__requests.length=0;window.__fireError(429);window.__fireIdle();}")
    chk('Mapbox itself reports loaded() while a tile has failed (premise of the bug)', pg.evaluate("()=>window.__map.loaded()===true&&window.__tiles.b.state==='errored'"))
    h = pg.evaluate("()=>MB.diagnostics()")
    chk('diagnostics report names the failed tile and HTTP status', 'failed 1' in h and 'HTTP 429' in h and 'mapbox-satellite' in h, h)
    chk('diagnostics report never contains the access token', 'pk.fake-test-token' not in h and 'access_token=…' in h, h)
    pg.wait_for_function("window.__tiles.b.state==='loaded'", timeout=6000)
    chk('failed tile was re-requested automatically (idle watchdog, ~1.5 s back-off)', pg.evaluate("window.__requests.includes('b')"))
    chk('the live canvas is whole again (no black hole)', pg.evaluate("()=>{const c=window.__map.getCanvas().getContext('2d');const px=c.getImageData(1400,300,1,1).data;return px[1]>80}"))

    # ---- 2. snapshot while a tile has failed twice: retried, never cached incomplete
    r = pg.evaluate("""async()=>{
      MB.cache.clear();window.__tiles.c={state:'errored'};window.__failNext.c=1;window.__requests.length=0;
      const bg=WX.S.show.scenes[0].bg,cam=%s;
      const cv=await MB.snap(bg,cam);
      const k=[...MB.cache.keys()].pop();
      return {have:!!cv,healthy:Object.values(window.__tiles).every(t=>t.state==='loaded'),cached:MB.cache.size,reqs:window.__requests.slice(),keyHas:!!k};}""" % cam)
    chk('snapshot with a failed tile recovered it before capture', r['have'] and r['healthy'] and 'c' in r['reqs'], r)
    chk('snapshot was cached as complete', r['cached'] >= 1)
    px = pg.evaluate("()=>{const cv=[...MB.cache.values()].pop();const d=cv.getContext('2d').getImageData(500,800,1,1).data;return d[1]}")
    chk('cached snapshot has imagery where the failed tile was', px > 80, px)

    # ---- 3. permanently failing tile: picture returned but flagged incomplete and retried later, not cached as final
    r = pg.evaluate("""async()=>{
      MB.cache.clear();
      window.__tiles.d={state:'errored'};window.__failNext.d=999;
      const bg=WX.S.show.scenes[0].bg,cam=%s;
      const cv=await MB.snap(bg,cam);
      return {have:!!cv,incomplete:MB.diag.incompleteSnaps,errored:window.__tiles.d.state};}""" % cam)
    chk('permanently failing tile: best-effort frame returned and counted as incomplete', r['have'] and r['incomplete'] >= 1 and r['errored'] == 'errored', r)
    pg.evaluate("()=>{window.__failNext.d=0}")
    # watchdog recovers it once the network is back; stale incomplete frame is dropped
    pg.evaluate("()=>{window.__fireIdle()}")
    pg.wait_for_function("window.__tiles.d.state==='loaded'", timeout=8000)
    pg.evaluate("()=>{window.__fireIdle()}")
    chk('after the tile recovers the stale incomplete frame is discarded', pg.evaluate("()=>MB.cache.size===0"))

    # ---- 4. diagnostics dialog (Mapbox settings -> Map diagnostics -> Reload map tiles)
    pg.evaluate("()=>{const b=[...document.querySelectorAll('button')].find(x=>/Open Map Style/.test(x.textContent));if(b)b.click()}")
    pg.wait_for_timeout(400)
    clicked = pg.evaluate("""()=>{const b=[...document.querySelectorAll('button')].find(x=>/Mapbox Token \\/ Quality|Mapbox settings/.test(x.textContent));if(b){b.click();return true}return false}""")
    chk('Mapbox settings reachable from the Map Style panel', clicked)
    if clicked:
        pg.wait_for_selector('#mbDiag', timeout=4000)
        pg.click('#mbDiag'); pg.wait_for_selector('#mbDiagText', timeout=4000)
        chk('Map diagnostics dialog shows the report', 'WX Studio map diagnostics' in pg.inner_text('#mbDiagText'))
        pg.evaluate("()=>{window.__tiles.a={state:'errored'}}")
        pg.click('#mbDiagReload'); pg.wait_for_function("window.__tiles.a.state==='loaded'", timeout=4000)
        chk('"Reload map tiles" re-requests every tile', pg.evaluate("window.__requests.filter(k=>k==='a').length>=1"))

    # ---- 5. WebGL context restore drops cached pictures
    r = pg.evaluate("""async()=>{
      const cv=window.__map.getCanvas();MB.cache.set('stale',cv);
      cv.dispatchEvent(new Event('webglcontextlost'));cv.dispatchEvent(new Event('webglcontextrestored'));
      await new Promise(r=>setTimeout(r,200));
      return {size:MB.cache.size,lost:MB.diag.contextLost,restored:MB.diag.contextRestored};}""")
    chk('context lost/restored is counted and stale frames dropped', r['lost'] == 1 and r['restored'] == 1 and r['size'] == 0, r)
    # ---- 5b. an unrelated OPTIONAL source that keeps failing must not block or churn the satellite snapshot
    r = pg.evaluate("""async()=>{
      window.__map.style._sourceCaches.composite={_tiles:{v1:{state:'errored'}},_source:{type:'vector'},removed:0,_removeTile(k){this.removed++;delete this._tiles[k];},update(){}};
      MB.cache.clear();const before=MB.diag.incompleteSnaps,t0=performance.now();
      const cv=await MB.snap(WX.S.show.scenes[0].bg,%s);
      return {have:!!cv,ms:performance.now()-t0,incomplete:MB.diag.incompleteSnaps-before,removed:window.__map.style._sourceCaches.composite.removed};}""" % cam)
    chk('optional-source failure: snapshot returns promptly and is trusted as complete', r['have'] and r['incomplete'] == 0 and r['ms'] < 4000, r)
    chk('optional-source failure is still listed in diagnostics but marked informational', 'composite [vector, informational]' in pg.evaluate("()=>MB.diagnostics()"))
    pg.evaluate("()=>{delete window.__map.style._sourceCaches.composite}")

    # ---- 5c. HTTP 429: a burst opens ONE cool-down; no retry request is sent inside it; recovery follows afterwards
    ev0 = pg.evaluate("()=>MB.diag.throttleEvents")
    pg.evaluate("()=>{window.__requests.length=0;window.__tiles.a={state:'errored'};for(let i=0;i<30;i++)window.__fireError(429);window.__fireIdle();}")
    pg.wait_for_timeout(2600)
    d = pg.evaluate("()=>MB.diagnostics()")
    chk('429 burst counts as one rate-limit event with an active back-off', pg.evaluate("()=>MB.diag.throttleEvents") == ev0 + 1 and 'back-off ACTIVE' in d, d[-700:])
    chk('no tile request is sent during the cool-down (no request storm)', pg.evaluate("()=>window.__requests.length") == 0 and pg.evaluate("()=>window.__tiles.a.state") == 'errored')
    pg.wait_for_function("window.__tiles.a.state==='loaded'", timeout=15000)
    chk('after the cool-down the failed tile is requested again, once', pg.evaluate("()=>window.__requests.filter(k=>k==='a').length") == 1)

    # ---- 5d. private Mapbox cache interface unavailable: reported, never claimed complete; Reload falls back to a style rebuild
    pg.evaluate("()=>{window.__savedCaches=window.__map.style._sourceCaches;window.__map.style._sourceCaches=undefined;}")
    d = pg.evaluate("()=>MB.diagnostics()")
    chk('unavailable interface is reported as UNVERIFIED, not as complete coverage', 'Tile coverage: UNVERIFIED' in d and 'COMPLETE' not in d, d[-500:])
    calls = pg.evaluate("()=>window.__setStyleCalls||0")
    n = pg.evaluate("()=>MB.reloadTiles()")
    try: pg.wait_for_function("(c)=>(window.__setStyleCalls||0)>c", arg=calls, timeout=8000); ok = True
    except Exception: ok = False
    chk('Reload map tiles falls back to rebuilding the map style', n == 1 and ok, (n, calls, pg.evaluate("()=>window.__setStyleCalls")))
    pg.evaluate("()=>{window.__map.style._sourceCaches=window.__savedCaches}")

    # ---- 5e. manual Reload during a 429 cool-down: visible warning, short guard against rapid repeats, automatic retries still wait
    if not pg.query_selector('#mbDiagReload'):
        pg.evaluate("()=>{const b=[...document.querySelectorAll('button')].find(x=>/Mapbox Token \\/ Quality/.test(x.textContent));if(b)b.click()}")
        pg.wait_for_selector('#mbDiag', timeout=4000); pg.click('#mbDiag'); pg.wait_for_selector('#mbDiagReload', timeout=4000)
    pg.wait_for_timeout(4200)                                   # let any earlier manual-reload guard expire
    pg.evaluate("()=>{window.__fireError(429);}")
    pg.click('#mbDiagReload'); pg.wait_for_timeout(300)
    warn = pg.inner_text('#mbDiagWarn') if pg.is_visible('#mbDiagWarn') else ''
    chk('rate-limited: the dialog shows a visible warning and relabels the button', 'rate-limiting' in warn and 'Reload anyway' in pg.inner_text('#mbDiagReload'), warn)
    chk('rate-limited: the manual reload was honoured (counted) and the cool-down is still active', pg.evaluate("()=>MB.manualReload.count>=1&&MB.diagnostics().includes('back-off ACTIVE')"))
    chk('the button is disabled for the guard period (no rapid repeats)', pg.evaluate("()=>document.getElementById('mbDiagReload').disabled===true"))
    ig = pg.evaluate("()=>{const a=MB.manualReload.ignored,r=MB.reloadTiles();return [r,MB.manualReload.ignored-a]}")
    chk('a repeated reload inside the guard is ignored by the core as well', ig == [-1, 1], ig)
    pg.evaluate("()=>{window.__requests.length=0;window.__tiles.c={state:'errored'};window.__fireIdle();}")
    pg.wait_for_timeout(1900)
    chk('automatic retries still respect the cool-down after a manual reload', pg.evaluate("()=>window.__requests.filter(k=>k==='c').length") == 0 and pg.evaluate("()=>window.__tiles.c.state") == 'errored')
    pg.wait_for_function("window.__tiles.c.state==='loaded'", timeout=15000)

    # ---- 6. a failed tile (HTTP 429) must not be mistaken for a rejected token; a real 401 still is
    r = pg.evaluate("()=>{window.__fireError(429);const a=MB.status;window.__fireError(401);return [a,MB.status,MB.err]}")
    chk('HTTP 429 on a tile keeps the map usable (status stays ready)', r[0] == 'ready', r)
    chk('HTTP 401 still reports the token problem', r[1] == 'error' and 'rejected the token' in r[2] and 'pk.' not in r[2], r)
    chk('no page errors', not errs, errs)
    br.close()
bad = [r for r in res if not r[1]]
print('\n%d/%d checks passed' % (len(res) - len(bad), len(res)))
sys.exit(1 if bad else 0)
