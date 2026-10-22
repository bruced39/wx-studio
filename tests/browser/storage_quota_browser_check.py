"""Real-browser regression (v0.10.2 storage fix): the small localStorage autosave slot fills up when a show gets a large background image.
Reproduces the live-test bug: Scene 2 + an uploaded background -> localStorage throws QuotaExceededError -> the cloud engine used to never be told
(cloud kept the default background and still said "Saved to cloud"). Verifies, against the in-memory fake Supabase (WX_BACKEND=pg: the real SQL migrations):
  1. REAL quota: localStorage is filled to the brim, then a ~2 MB background is uploaded through the real file picker
  2. the cloud still receives the image (uploaded, registered, hashed) and the cloud chip only says "Saved to cloud" once the cloud document has it
  3. the autosave falls back to the larger IndexedDB database; reload restores the newest show (image included) - nothing deleted
  4. a second computer opens the cloud show and reconstructs the identical image bytes and picture
  5. BOTH local stores failing (the exact failure of the live test): the cloud still gets the image, the editor honestly says "Not saved"
  6. compatibility: ordinary shows still autosave to localStorage in the old format; stale fallback data is ignored once localStorage works again;
     the marker-key failure path (stub) still restores; a pre-existing autosave loads unchanged
Usage: python3 wxbuild.py && python3 tests/browser/storage_quota_browser_check.py"""
from playwright.sync_api import sync_playwright
import json, os, sys, pathlib, subprocess, time, urllib.request, hashlib, base64, random, io, tempfile
from PIL import Image
ROOT = pathlib.Path(__file__).resolve().parents[2]
PORT = 8794; LOCAL = 'http://127.0.0.1:%d' % PORT; FAKE = 'https://fake-project.supabase.test'
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, info if not ok else '')
srv = subprocess.Popen(['node', str(ROOT / 'tests/helpers/fake_supabase_server.js'), str(PORT)])
for _ in range(300):
    try: urllib.request.urlopen(LOCAL + '/__admin/state'); break
    except Exception: time.sleep(0.1)
def adm(path='state'): return json.loads(urllib.request.urlopen(LOCAL + '/__admin/' + path).read())
HDR = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-upsert, prefer, x-client-info, accept-profile', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'}
def route(r):
    q = r.request
    if q.method == 'OPTIONS': r.fulfill(status=204, headers=HDR); return
    try: resp = r.fetch(url=q.url.replace(FAKE, LOCAL))
    except Exception: r.abort(); return
    h = dict(resp.headers); h.update(HDR); r.fulfill(response=resp, headers=h)
CONF = "window.WX_CLOUD_CONFIG={url:'" + FAKE + "',publishableKey:'sb_publishable_fake'};"
def wait(pg, js, t=25000):
    try: pg.wait_for_function(js, timeout=t); return True
    except Exception: return False
def chip(pg): return pg.evaluate("(()=>{const c=document.getElementById('cloudState');return c.hidden?'(hidden)':c.querySelector('.cl').textContent})()")
def click_btn(pg, text): return pg.evaluate("t=>{const b=[...document.querySelectorAll('#modal button')].find(x=>x.textContent.trim()===t);if(!b)return false;b.click();return true}", text)
def new_computer(br, ctx=None, goto=True):
    ctx = ctx or br.new_context(viewport={'width': 1700, 'height': 960})
    if goto: ctx.add_init_script(CONF); ctx.route(FAKE + '/**', route)
    pg = ctx.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(1800); return ctx, pg
def sign_in(pg):
    pg.evaluate("document.getElementById('cloudState').click()"); pg.wait_for_timeout(300)
    pg.fill('#modal input[type=email]', 'a@x.test'); pg.fill('#modal input[type=password]', 'pw'); click_btn(pg, 'Sign in'); pg.wait_for_timeout(900)
def cloud_saved(pg, t=30000): return wait(pg, "()=>document.getElementById('cloudState').querySelector('.cl').textContent==='Saved to cloud'", t)

# a noisy (incompressible) 1600x900 JPEG, about 1.4 MB -> about 1.9 M characters as a data URL
rnd = random.Random(7); img = Image.frombytes('RGB', (1600, 900), bytes(rnd.getrandbits(8) for _ in range(1600 * 900 * 3)))
IMG = tempfile.mkdtemp(prefix='wxquota_') + '/forecast.jpg'; img.save(IMG, 'JPEG', quality=92)
IMG_BYTES = open(IMG, 'rb').read(); IMG_SHA = hashlib.sha256(IMG_BYTES).hexdigest()

FILL = """()=>{const lim=localStorage.length;let n=0;const chunk='x'.repeat(100000);try{for(;;){localStorage.setItem('zz_fill_'+n,chunk);n++}}catch(e){}
  /* leave about 300 000 characters free: plenty for small autosaves, far too little for a 2 MB image */
  for(let k=0;k<2;k++){localStorage.removeItem('zz_fill_'+(--n))} return n}"""
SHA_ASSET = """async(id)=>{const u=WX.S.show.assets[id]||'';const i=u.indexOf(',');const b=atob(u.slice(i+1));const a=new Uint8Array(b.length);for(let k=0;k<b.length;k++)a[k]=b.charCodeAt(k);
  const h=await crypto.subtle.digest('SHA-256',a);return {len:a.length,sha:[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join(''),mime:u.slice(5,i)}}"""
RENDER2 = """async()=>{const E=WX.E;await E.preload(WX.S.show);const c=document.createElement('canvas');c.width=960;c.height=540;const x=c.getContext('2d');x.scale(0.5,0.5);
  E.renderScene(x,WX.S.show,WX.S.show.scenes[1],1.0,{editing:false});const d=x.getImageData(0,0,960,540).data;let h=0;for(let i=0;i<d.length;i+=4){h=(h*31+d[i]+d[i+1]*3+d[i+2]*7)>>>0}return h}"""
AUTO = """async()=>{const key='wx.studio.autosave.v1';const ns=localStorage.getItem('wx.studio.ns.v1');const k=ns?key+':u:'+ns:key;
  const main=localStorage.getItem(k);const flag=localStorage.getItem(k+':idb');
  const rec=await new Promise(res=>{try{const r=indexedDB.open('wxstudio-autosave',1);r.onupgradeneeded=()=>r.result.createObjectStore('cur',{keyPath:'key'});
   r.onsuccess=()=>{const q=r.result.transaction('cur','readonly').objectStore('cur').get(k);q.onsuccess=()=>res(q.result||null);q.onerror=()=>res(null)};r.onerror=()=>res(null)}catch(e){res(null)}});
  let mj=null;try{mj=JSON.parse(main)}catch(e){}
  return {mainLen:main?main.length:0,mainScenes:mj&&mj.scenes?mj.scenes.length:0,mainStub:!!(mj&&mj.wxIdbStub),flag:!!flag,recLen:rec?rec.json.length:0,recScenes:rec?JSON.parse(rec.json).scenes.length:0,
    recHasImg:!!(rec&&/"a[0-9a-z]{6,}":"data:image\\/jpeg/.test(rec.json)),state:document.getElementById('saveState').dataset.state,title:document.getElementById('saveState').title,text:document.getElementById('saveState').textContent}}"""
def prep(pg):
    """open the Scene panel and its Background section, then wait until the cloud engine is completely idle (UI work can trigger harmless autosaves; a sync
    scheduled by one of them would otherwise pick up the image later and hide the bug)"""
    pg.evaluate("WX.setTab('scene')"); pg.wait_for_timeout(300)
    pg.evaluate("()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Upload background…');if(!b){const a=[...document.querySelectorAll('.acc-h,.acch,summary,h4,h3')].find(x=>/background/i.test(x.textContent));if(a)a.click()}}")
    pg.wait_for_timeout(7000)
    return pg.evaluate("(()=>{const r=WXCloudUI.engine.record();return !!r&&!r.dirty&&!r.pending})()")
def upload(pg):
    with pg.expect_file_chooser(timeout=8000) as fc:
        pg.evaluate("()=>[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Upload background…').click()")
    fc.value.set_files(IMG); pg.wait_for_timeout(2500)

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])
    # ================= 1-3: REAL quota on computer 1 =================
    c1, a = new_computer(br); sign_in(a); a.wait_for_timeout(2500)
    a.evaluate("WX.newScene()"); a.wait_for_timeout(500)       # Scene 2, default (bundled) background - exactly the live-test steps
    ok = False
    for _ in range(60):
        sh = adm()['shows']
        if sh and len(sh[0]['doc'].get('scenes', [])) == 2: ok = True; break
        a.wait_for_timeout(500)
    chk('Scene 2 reaches the cloud with the bundled default background', ok and adm()['shows'][0]['doc']['scenes'][1]['bg'].get('asset') == 'bgdefault', adm()['shows'][0]['doc']['scenes'][1]['bg'] if ok else '')
    cloud_saved(a)
    chk('chip says Saved to cloud before the image', chip(a) == 'Saved to cloud', chip(a))
    filled = a.evaluate(FILL); chk('localStorage was filled until the browser refused (real quota)', filled > 5, filled)
    # prove the quota is real: a 2 MB value is refused now
    thrown = a.evaluate("()=>{try{localStorage.setItem('zz_probe','y'.repeat(2000000));localStorage.removeItem('zz_probe');return false}catch(e){return e.name}}")
    chk('the browser really throws QuotaExceededError for a 2 MB write', thrown == 'QuotaExceededError', thrown)
    idle = prep(a); chk('engine idle with nothing pending right before the upload', idle)
    a.evaluate("window.__marks=0;const m=WXCloudUI.engine.markDirty;WXCloudUI.engine.markDirty=function(){window.__marks++;return m.apply(this,arguments)};0")      # ';0': Playwright would otherwise CALL the function this expression evaluates to
    upload(a)
    imgId = a.evaluate("WX.S.show.scenes[1].bg.asset"); chk('the background image is set on Scene 2', imgId and imgId != 'bgdefault' and imgId.startswith('a'), imgId)
    chk('the cloud engine WAS notified although localStorage threw', a.evaluate("window.__marks") >= 1, a.evaluate("window.__marks"))
    au = a.evaluate(AUTO)
    chk('autosave fell back to the larger IndexedDB database (newest show incl. the image) and left a marker', au['flag'] and au['recScenes'] == 2 and au['recHasImg'] and au['recLen'] > 1000000, {k: au[k] for k in ['flag', 'recScenes', 'recHasImg', 'recLen']})
    chk('the older localStorage autosave was NOT deleted or overwritten (still the 2-scene show without the image)', au['mainScenes'] == 2 and au['mainLen'] > 100 and au['mainLen'] < 1000000 and not au['mainStub'], {k: au[k] for k in ['mainLen', 'mainScenes', 'mainStub']})
    chk('editor says Saved (not "Not saved") and explains it used the larger storage', au['state'] == 'saved' and 'larger storage' in au['title'], (au['state'], au['title'][:80]))
    # cloud receives the image
    ok = False
    for _ in range(80):
        st = adm(); doc = st['shows'][0]['doc']
        if doc['scenes'][1]['bg'].get('asset') == imgId and imgId in (doc.get('assets') or {}): ok = True; break
        a.wait_for_timeout(500)
    chk('cloud document now has Scene 2 with the uploaded image (not bgdefault)', ok, adm()['shows'][0]['doc']['scenes'][1]['bg'])
    cloud_saved(a, 20000)
    st = adm(); doc = st['shows'][0]['doc']; asset = doc['assets'].get(imgId, {})
    chk('chip says Saved to cloud only after the cloud has the image', chip(a) == 'Saved to cloud' and len(st['objects']) == 1, (chip(a), len(st['objects'])))
    chk('uploaded object is the exact image bytes (SHA-256 of the picked file)', asset.get('media') == 'sha256:' + IMG_SHA or IMG_SHA in json.dumps(asset), asset)
    chk('no image data is embedded in the cloud document', 'data:' not in json.dumps(doc))
    shaA = a.evaluate(SHA_ASSET, imgId); hashA = a.evaluate(RENDER2)
    # reload computer 1: the newest show (with the image) comes back from the larger database
    a.reload(); a.wait_for_timeout(3500)
    chk('after reload the show is restored from the larger storage with its image', a.evaluate("WX.S.show.scenes.length")==2 and a.evaluate("WX.S.show.scenes[1].bg.asset")==imgId and a.evaluate("(WX.S.show.assets[WX.S.show.scenes[1].bg.asset]||'').length")>1000000, a.evaluate("[WX.S.show.scenes.length, WX.S.show.scenes[1].bg.asset]"))
    # ================= 4: second computer reconstructs the image =================
    c2, b = new_computer(br); sign_in(b); b.wait_for_timeout(500)
    ok = wait(b, "()=>WX.S.show.scenes.length===2&&WX.S.show.scenes[1].bg.asset!=='bgdefault'", 40000)
    chk('computer 2 opened the cloud show with Scene 2', ok, b.evaluate("[WX.S.show.name, WX.S.show.scenes.length, WX.S.show.scenes[1] && WX.S.show.scenes[1].bg.asset]"))
    wait(b, "()=>(WX.S.show.assets[WX.S.show.scenes[1].bg.asset]||'').length>1000", 20000)
    shaB = b.evaluate(SHA_ASSET, b.evaluate("WX.S.show.scenes[1].bg.asset"))
    chk('computer 2 downloaded the image and its bytes equal the original file (SHA-256)', shaB['sha'] == IMG_SHA and shaB['len'] == len(IMG_BYTES) and shaA['sha'] == IMG_SHA, (shaB, IMG_SHA[:12]))
    chk('both computers draw the same Scene 2 picture', b.evaluate(RENDER2) == hashA == a.evaluate(RENDER2), (hashA,))
    # ================= compatibility on computer 1 =================
    # shrink the show again: localStorage works again -> marker removed, localStorage is authoritative, the stale database record is ignored
    a.evaluate("()=>{const o=WX.S.show;o.scenes[1].bg={type:'solid',color:'#123456',kenburns:false};delete o.assets[Object.keys(o.assets).find(k=>/^a/.test(k))];WX.commit()}"); a.wait_for_timeout(800)
    au = a.evaluate(AUTO)
    chk('once the show fits again localStorage is used and the marker is cleared (stale database record kept but ignored)', not au['flag'] and au['mainScenes'] == 2 and au['mainLen'] < 1000000 and au['recLen'] > 1000000 and au['state'] == 'saved' and 'larger' not in au['title'], {k: au[k] for k in ['flag', 'mainLen', 'recLen', 'state']})
    a.reload(); a.wait_for_timeout(3000)
    chk('reload then shows the localStorage version (solid Scene 2), not the stale database copy', a.evaluate("WX.S.show.scenes[1].bg.type")=='solid', a.evaluate("WX.S.show.scenes[1].bg.type"))
    errs = a.errs + b.errs; chk('no page errors (real quota run)', not errs, errs[:3])
    c1.close(); c2.close()

    # ================= 5: BOTH local stores fail (the live-test failure) =================
    c3, d = new_computer(br); sign_in(d); d.wait_for_timeout(2500)
    d.evaluate("WX.newScene()"); d.wait_for_timeout(500)
    for _ in range(60):
        if adm()['shows'] and len(adm()['shows'][-1]['doc'].get('scenes', [])) == 2: break
        d.wait_for_timeout(500)
    cloud_saved(d); chk('engine idle with nothing pending before the image (computer 3)', prep(d))
    d.evaluate("""()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(/^wx\\.studio\\.autosave/.test(k)&&String(v).length>20000)throw new DOMException('The quota has been exceeded.','QuotaExceededError');return set.call(this,k,v)};
      const open=indexedDB.open.bind(indexedDB);indexedDB.open=function(n,v){if(n==='wxstudio-autosave'){throw new DOMException('blocked','InvalidStateError')}return open(n,v)};window.__marks=0;
      const m=WXCloudUI.engine.markDirty;WXCloudUI.engine.markDirty=function(){window.__marks++;return m.apply(this,arguments)};0}""")
    n0 = len(adm()['shows'])
    upload(d)
    imgD = d.evaluate("WX.S.show.scenes[1].bg.asset"); au = d.evaluate(AUTO)
    chk('editor honestly shows "Not saved" when no local store can hold the show', au['state'] == 'failed' and 'Not saved' in au['text'], (au['state'], au['text']))
    chk('cloud engine was still notified', d.evaluate("window.__marks") >= 1, d.evaluate("window.__marks"))
    ok = False
    for _ in range(80):
        sh = adm()['shows']; doc = sh[-1]['doc']
        if doc['scenes'][1]['bg'].get('asset') == imgD and imgD in (doc.get('assets') or {}): ok = True; break
        d.wait_for_timeout(500)
    chk('the cloud still received Scene 2 with the uploaded image (this was the live-test bug)', ok, adm()['shows'][-1]['doc']['scenes'][1]['bg'])
    cloud_saved(d, 20000)
    chk('cloud chip reaches Saved to cloud only now, while the local indicator stays red', chip(d) == 'Saved to cloud' and d.evaluate(AUTO)['state'] == 'failed', (chip(d), d.evaluate(AUTO)['state']))
    c3.close()

    # ================= 6: more compatibility (no cloud needed) =================
    c4 = br.new_context(viewport={'width': 1500, 'height': 900}); c4.route(FAKE + '/**', route)
    c4, e = new_computer(br, c4, goto=False)
    # (a) ordinary show: old format in localStorage, no marker, no database record
    e.evaluate("WX.newScene()"); e.wait_for_timeout(500); au = e.evaluate(AUTO)
    chk('an ordinary show still autosaves to localStorage only (old format, no marker, no database record)', au['mainScenes'] == 2 and not au['flag'] and au['recLen'] == 0 and au['state'] == 'saved', {k: au[k] for k in ['mainScenes', 'flag', 'recLen', 'state']})
    # (b) pre-existing autosave from an older version loads unchanged
    old = e.evaluate("localStorage.getItem('wx.studio.autosave.v1')"); e.reload(); e.wait_for_timeout(2500)
    chk('a pre-existing localStorage autosave loads unchanged', e.evaluate("WX.S.show.scenes.length") == 2 and e.evaluate("localStorage.getItem('wx.studio.autosave.v1')") is not None, e.evaluate("WX.S.show.scenes.length"))
    # (c) marker key cannot be written -> the main key becomes a tiny stub; reload still restores from the database
    e.evaluate("""()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(/^wx\\.studio\\.autosave\\.v1$/.test(k)&&String(v).length>20000)throw new DOMException('q','QuotaExceededError');if(/:idb$/.test(k))throw new DOMException('q','QuotaExceededError');return set.call(this,k,v)}}""")
    e.evaluate("()=>{const o=WX.S.show;o.assets['aBIG']='data:image/jpeg;base64,'+'A'.repeat(60000);o.scenes[1].bg={type:'image',asset:'aBIG',kenburns:false};WX.commit()}"); e.wait_for_timeout(1200)
    au = e.evaluate(AUTO)
    chk('marker write refused -> main key shrinks to a stub, the database holds the show', au['mainStub'] and au['recScenes'] == 2 and au['recLen'] > 50000 and au['state'] == 'saved', {k: au[k] for k in ['mainStub', 'recScenes', 'recLen', 'state']})
    e.reload(); e.wait_for_timeout(3000)
    chk('reload restores the show from the database via the stub', e.evaluate("WX.S.show.scenes.length") == 2 and e.evaluate("WX.S.show.scenes[1].bg.asset") == 'aBIG' and e.evaluate("(WX.S.show.assets.aBIG||'').length") > 50000, e.evaluate("[WX.S.show.scenes.length, WX.S.show.scenes[1].bg.asset]"))
    errs = e.errs; chk('no page errors (compatibility runs)', not errs, errs[:3])
    br.close()
srv.terminate()
try: srv.wait(15)
except Exception: srv.kill()
bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad))); sys.exit(1 if bad else 0)
