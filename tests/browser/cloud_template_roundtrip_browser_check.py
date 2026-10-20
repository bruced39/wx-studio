"""Real-browser check (v0.10.2 integration): a Storm Update template (bundled background, text-only banner, fit-box headline) plus a Flow object (chevron look)
and a Jet object (moving words, soft edges, no outline, pinned pts + z0) is saved to the cloud on one "computer" and opened on another.
Verifies every object and field survives, the bundled artwork is re-attached from the app and is NOT uploaded to the media bucket, and both computers
draw the same picture. Runs against the in-memory fake by default; WX_BACKEND=pg (+ WX_MIGRATIONS_DIR) runs the REAL v0.10.2 SQL migrations.
Usage: python3 wxbuild.py && python3 tests/browser/cloud_template_roundtrip_browser_check.py   (needs node, playwright, Chromium)
NOTE: fake / local PostgreSQL only; the live Supabase project still needs the authenticated two-computer test."""
from playwright.sync_api import sync_playwright
import json, os, sys, pathlib, subprocess, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
PORT = 8793; LOCAL = 'http://127.0.0.1:%d' % PORT; FAKE = 'https://fake-project.supabase.test'
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, info if not ok else '')
srv = subprocess.Popen(['node', str(ROOT / 'tests/helpers/fake_supabase_server.js'), str(PORT)])
for _ in range(300):
    try: urllib.request.urlopen(LOCAL + '/__admin/state'); break
    except Exception: time.sleep(0.1)
def adm(path='state'): return json.loads(urllib.request.urlopen(LOCAL + '/__admin/' + path).read())
HDR = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-upsert, prefer, x-client-info, accept-profile', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'}
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
def new_computer(br):
    ctx = br.new_context(viewport={'width': 1700, 'height': 960}); ctx.add_init_script(CONF); ctx.route(FAKE + '/**', route)
    pg = ctx.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(1800); return ctx, pg
def sign_in(pg):
    pg.evaluate("document.getElementById('cloudState').click()"); pg.wait_for_timeout(300)
    pg.fill('#modal input[type=email]', 'a@x.test'); pg.fill('#modal input[type=password]', 'pw'); click_btn(pg, 'Sign in'); pg.wait_for_timeout(900)

BUILD = """()=>{const E=WX.E,sc=E.sceneFromTemplate('storm-night',{title:'STORM UPDATE',lines:['Damaging wind gusts tonight across eastern Massachusetts','Coastal flooding at high tide','Power outages possible']}); sc.objects=E.buildTemplate('storm-night',{lines:['Damaging wind gusts tonight across eastern Massachusetts','Coastal flooding at high tide','Power outages possible']});
  const flow=E.newObject('flow',{pts:[[300,700],[600,640],[900,660],[1300,600]],style:'chevron',color:'#ffd23f',size:46,spacing:2.6,speed:0.9}); flow.geo=true; flow.z0=7.5; flow.id='flow_rt';
  const jet=E.newObject('jet',{pts:[[100,300],[700,250],[1300,330],[1800,280]],style:'ribbon',color:'#d5dbe6',width:70,speed:1,outline:false,fade:0.45,flowText:true,words:'JET STREAM',label:'Polar jet'}); jet.geo=true; jet.z0=7.5; jet.id='jet_rt';
  sc.objects.push(flow,jet);
  WX.loadShow({name:'Storm round trip',accent:'#2f9bff',scenes:[sc],assets:{}}); return true}"""
# order-independent copy of the scenes + a picture of the first frame
SNAP = """async()=>{const E=WX.E; await E.preload(WX.S.show);
  const canon=v=>Array.isArray(v)?v.map(canon):(v&&typeof v==='object')?Object.keys(v).sort().reduce((o,k)=>(o[k]=canon(v[k]),o),{}):v;
  const c=document.createElement('canvas');c.width=960;c.height=540;const x=c.getContext('2d');x.scale(0.5,0.5);E.renderScene(x,WX.S.show,WX.S.show.scenes[0],2.5,{editing:false});
  const d=x.getImageData(0,0,960,540).data;let h=0,nz=0;for(let i=0;i<d.length;i+=4){h=(h*31+d[i]+d[i+1]*3+d[i+2]*7)>>>0;if(d[i]+d[i+1]+d[i+2]>30)nz++}
  const ids=WX.S.show.scenes[0].objects.map(o=>o.type+':'+o.id);
  return {scenes:JSON.stringify(canon(WX.S.show.scenes)),hash:h,lit:nz,bg:(WX.S.show.scenes[0].bg||{}).asset,bgLen:(WX.S.show.assets[(WX.S.show.scenes[0].bg||{}).asset]||'').length,ids}}"""

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])
    c1, a = new_computer(br); sign_in(a); a.wait_for_timeout(2500)
    a.evaluate(BUILD); a.wait_for_timeout(600)
    snapA = a.evaluate(SNAP)
    tplLen = a.evaluate("(WX_TPL.tpl_storm_night||'').length")
    chk('the template scene has its bundled background attached locally', snapA['bg'] == 'tpl_storm_night' and snapA['bgLen'] == tplLen and tplLen > 10000, (snapA['bg'], snapA['bgLen'], tplLen))
    chk('scene contains the headline text, Flow and Jet', 'flow:flow_rt' in snapA['ids'] and 'jet:jet_rt' in snapA['ids'] and any(i.startswith('text:') for i in snapA['ids']), snapA['ids'])
    ok = False
    for _ in range(60):
        st = adm(); sh = st['shows']
        if sh and any(o.get('id') == 'flow_rt' for s in sh[0]['doc'].get('scenes', []) for o in s.get('objects', [])) and wait(a, "()=>document.getElementById('cloudState').querySelector('.cl').textContent==='Saved to cloud'", 500): ok = True; break
        a.wait_for_timeout(500)
    chk('computer 1 reached Saved to cloud with the new scene', ok, chip(a))
    st = adm(); doc = st['shows'][0]['doc'] if st['shows'] else {}
    chk('bundled background is not uploaded: media bucket and media table are empty', len(st['objects']) == 0 and len(st['media']) == 0, (st['objects'], len(st['media'])))
    chk('document has no assets entry for it, keeps the scene reference, and records the bundled id + hash', 'tpl_storm_night' not in (doc.get('assets') or {}) and doc['scenes'][0]['bg'].get('asset') == 'tpl_storm_night' and len(doc.get('builtinAssets', {}).get('tpl_storm_night', '')) == 64, json.dumps(doc.get('builtinAssets')))
    chk('no image data is embedded in the cloud document', 'data:' not in json.dumps(doc))
    chk('computer 1 shows no incomplete / local-only warning', chip(a) == 'Saved to cloud', chip(a))
    sc = doc['scenes'][0]; flow = next((o for o in sc['objects'] if o.get('id') == 'flow_rt'), {}); jet = next((o for o in sc['objects'] if o.get('id') == 'jet_rt'), {})
    chk('Flow fields stored (chevron look, pts, z0, size, spacing, speed)', flow.get('style') == 'chevron' and flow.get('z0') == 7.5 and len(flow.get('pts', [])) == 4 and flow.get('size') == 46 and flow.get('spacing') == 2.6 and flow.get('speed') == 0.9, flow)
    chk('Jet fields stored (words, soft edges, outline off, z0)', jet.get('flowText') is True and jet.get('words') == 'JET STREAM' and jet.get('fade') == 0.45 and jet.get('outline') is False and jet.get('z0') == 7.5 and len(jet.get('pts', [])) == 4, jet)
    head = next((o for o in sc['objects'] if o.get('type') == 'text' and o.get('fitBox')), {})
    chk('fit-box headline stored (fitBox, autoFit, maxLines, wrapW, centre x/y)', head.get('fitBox') and head.get('autoFit') is not False and head.get('maxLines') == 2 and head.get('wrapW') and head.get('x') and head.get('y'), head)
    t2 = sc.get('title2') or {}
    chk('text-only banner stored (textOnly, region)', t2.get('textOnly') is True and isinstance(t2.get('region'), dict) and t2.get('text') == 'STORM UPDATE', t2)

    # ================= computer 2 =================
    c2, b = new_computer(br); sign_in(b); b.wait_for_timeout(500)
    ok = wait(b, "()=>WX.S.show.name==='Storm round trip'", 30000)
    chk('computer 2 auto-opened the cloud show', ok, b.evaluate("WX.S.show.name"))
    snapB = b.evaluate(SNAP)
    chk('every scene, object and field is identical on computer 2', snapB['scenes'] == snapA['scenes'], 'differs' if snapB['scenes'] != snapA['scenes'] else '')
    chk('bundled artwork re-attached from the app on computer 2 (same bytes, nothing downloaded)', snapB['bg'] == 'tpl_storm_night' and snapB['bgLen'] == tplLen and len(adm()['objects']) == 0, (snapB['bg'], snapB['bgLen']))
    chk('both computers draw the same picture (non-blank)', snapB['hash'] == snapA['hash'] and snapB['lit'] > 20000, (snapA['hash'], snapB['hash'], snapB['lit']))
    chk('computer 2 says Saved to cloud, with no missing-artwork warning', wait(b, "()=>document.getElementById('cloudState').querySelector('.cl').textContent==='Saved to cloud'", 8000) and 'Some artwork' not in (b.evaluate("document.getElementById('modalBg').style.display==='none'?'':document.getElementById('modal').innerText")), chip(b))
    # an edit on computer 2 syncs and still uploads nothing
    b.evaluate("(()=>{const o=WX.S.show.scenes[0].objects.find(o=>o.id==='jet_rt');o.words='JET STREAM  ';o.width=90;WX.commit();})()")
    for _ in range(60):
        if adm()['shows'][0]['rev'] >= 2 and adm()['shows'][0]['doc']['scenes'][0]['objects'][-1].get('width') == 90: break
        b.wait_for_timeout(500)
    st = adm(); ob = [o for o in st['shows'][0]['doc']['scenes'][0]['objects'] if o.get('id') == 'jet_rt']
    chk('an edit made on computer 2 reaches the cloud; still nothing in the media bucket', ob and ob[0].get('width') == 90 and len(st['objects']) == 0, (ob[:1], st['objects']))
    # computer 1 sees the newer version notice and can load it with the new fields
    a.evaluate("WXCloudUI.engine.checkRemote()"); a.wait_for_timeout(600)
    chk('computer 1 is notified of the newer version', 'Newer version' in chip(a), chip(a))
    # a custom image that reuses a bundled id: cloud open keeps it, the ordinary local loader keeps its historical behaviour (bundled copy wins)
    kc = b.evaluate("""()=>{const mk=()=>({name:'x',accent:'#2f9bff',assets:{tpl_hl_sky:'data:image/png;base64,AAAA'},scenes:[WX.E.newScene({name:'s',duration:4,bg:{type:'image',asset:'tpl_hl_sky',fit:'fill'},title:{show:false,text:'',sub:''},objects:[]})]});
      const saveName=WX.S.show.name; WX.cloud.loadCloudShow(mk(),{}); const cloud=WX.S.show.assets.tpl_hl_sky; WX.loadShow(mk()); const local=WX.S.show.assets.tpl_hl_sky; return [cloud, local===WX_TPL.tpl_hl_sky]}""")
    chk('opening from the cloud never replaces a different image that reuses a bundled id', kc[0] == 'data:image/png;base64,AAAA', kc)
    chk('local file / autosave loading is unchanged (bundled copy re-attached)', kc[1] is True, kc)
    errs = a.errs + b.errs
    chk('no page errors', not errs, errs[:3])
    br.close()
srv.terminate()
try: srv.wait(15)
except Exception: srv.kill()
bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad))); sys.exit(1 if bad else 0)
