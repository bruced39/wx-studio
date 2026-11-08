"""v0.11.5 stabilisation: "Follow" attachments (obj.attach) keep their relationships and positions through
  local autosave + reopen, the portable show files (.wxshow.json and the .wxshow package), the cloud workspace (save, open on a second computer,
  edit sync), old shows without any attachment, and are handled safely when a hand-made / damaged show file has bad links.
Runs against the in-memory fake Supabase by default, or against the REAL SQL in an isolated local PostgreSQL with WX_BACKEND=pg + WX_MIGRATIONS_DIR
(never against production Supabase - the cloud config here is a fake project URL that is routed to the local test server).
Usage: python3 wxbuild.py && python3 tests/browser/map_attach_persistence_browser_check.py [screenshot_dir]   Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import json, os, sys, tempfile, pathlib, subprocess, time, urllib.request, base64
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxattp_')) + '/'
os.makedirs(S, exist_ok=True)
PORT = 8797; LOCAL = 'http://127.0.0.1:%d' % PORT; FAKE = 'https://fake-project.supabase.test'
TMP = tempfile.mkdtemp(prefix='wxattp_files_')
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, ('' if ok else info))
srv = subprocess.Popen(['node', str(ROOT / 'tests/helpers/fake_supabase_server.js'), str(PORT)])
for _ in range(300):
    try: urllib.request.urlopen(LOCAL + '/__admin/state'); break
    except Exception: time.sleep(0.1)
def adm(path='state', data=None):
    rq = urllib.request.Request(LOCAL + '/__admin/' + path, data=json.dumps(data).encode() if data is not None else None, method='POST' if data is not None else 'GET')
    return json.loads(urllib.request.urlopen(rq).read())
HDR = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-upsert, prefer, x-client-info, accept-profile', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'}
def route(r):
    q = r.request
    if q.method == 'OPTIONS': r.fulfill(status=204, headers=HDR); return
    try: resp = r.fetch(url=q.url.replace(FAKE, LOCAL))
    except Exception: r.abort(); return
    h = dict(resp.headers); h.update(HDR); r.fulfill(response=resp, headers=h)
CONF = "window.WX_MAPBOX_TOKEN='pk.fake-test-token';window.WX_CLOUD_CONFIG={url:'" + FAKE + "',publishableKey:'sb_publishable_fake'};"
def wait(pg, js, t=20000, arg=None):
    try: pg.wait_for_function(js, arg=arg, timeout=t); return True
    except Exception: return False
def click_btn(pg, text, scope='#modal'):
    return pg.evaluate("([t,s])=>{const b=[...document.querySelectorAll(s+' button')].find(x=>x.textContent.trim()===t);if(!b)return false;b.click();return true}", [text, scope])
def new_computer(br, w=1700):
    ctx = br.new_context(viewport={'width': w, 'height': 960}, accept_downloads=True); ctx.add_init_script(CONF); ctx.route(FAKE + '/**', route)
    pg = ctx.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(1800); return ctx, pg
def sign_in(pg, email):
    pg.evaluate("document.getElementById('cloudState').click()"); pg.wait_for_timeout(300)
    pg.fill('#modal input[type=email]', email); pg.fill('#modal input[type=password]', 'pw'); click_btn(pg, 'Sign in'); pg.wait_for_timeout(900)
def saved(pg, t=25000): return wait(pg, "()=>document.getElementById('cloudState').querySelector('.cl').textContent==='Saved to cloud'", t)

# ---- the test show -------------------------------------------------------------------------------------------------------------------------
# scene 0 "Pinned": a Mapbox scene (objects pinned = lng/lat) with a front, an icon beside it (offset across the line), an H on it, and a label that
#   follows the ICON (a chain: label -> icon -> front); animated: step 2 moves + lengthens the front, step 3 bends it.
# scene 1 "Screen": plain background (screen coordinates), a front and an icon that follows it (not animated).
# scene 2 "Legacy": animated like a v0.11.4 show - no attachment anywhere.
BUILD = r"""(name)=>{const E=WX.E,MA=MapAnim;
  const bg={type:'mapbox',mbStyle:'broadcast',broadcastBase:'satellite',proj:'mercator',theme:'dark',region:'eastma',view:null,view2:null,grad:'sky',color:'#101820',asset:null,dim:0,kenburns:false}; MB.ensureConfig(bg);
  const f=E.newObject('front',{id:'f1',geo:true,kind:'cold',pts:[[-71.9,42.1],[-71.6,42.3],[-71.3,42.36],[-71.0,42.3],[-70.8,42.1],[-70.6,41.9]]});
  const i=E.newObject('icon',{id:'i1',geo:true,x:-71.3,y:42.62,icon:'rain',size:110}); const h=E.newObject('hl',{id:'h1',geo:true,x:-70.9,y:42.25,kind:'H',value:'1030',size:160});
  const t=E.newObject('text',{id:'t1',geo:true,x:-71.3,y:42.85,text:'SHOWERS',size:60});
  const a=E.newScene({id:'scA',name:'Pinned',duration:6,bg,title:{show:false,text:'',sub:''},objects:[f,i,h,t]});
  const f2=E.newObject('front',{id:'f2',kind:'warm',pts:[[300,700],[600,600],[900,580],[1200,640],[1500,760]]}); const i2=E.newObject('icon',{id:'i2',x:900,y:480,icon:'sun',size:120});
  const b=E.newScene({id:'scB',name:'Screen',duration:4,bg:{type:'solid',color:'#204060',kenburns:false},title:{show:false,text:'',sub:''},objects:[f2,i2]});
  const lf=E.newObject('front',{id:'lf',kind:'stationary',pts:[[400,500],[700,450],[1000,470],[1300,560]]}); const li=E.newObject('icon',{id:'li',x:900,y:380,icon:'snow',size:110});
  const c=E.newScene({id:'scC',name:'Legacy',duration:6,bg:{type:'solid',color:'#304050',kenburns:false},title:{show:false,text:'',sub:''},objects:[lf,li]});
  WX.loadShow({name,accent:'#2f9bff',scenes:[a,b,c],assets:{},mbMigrated:1});
  const sh=WX.S.show, A=sh.scenes[0], B=sh.scenes[1], C=sh.scenes[2], LL={lngLat:true};
  const get=(sc,id)=>sc.objects.find(o=>o.id===id);
  get(A,'i1').attach=MA.makeAttach(get(A,'f1'),get(A,'i1'),LL); get(A,'h1').attach=MA.makeAttach(get(A,'f1'),get(A,'h1'),LL); get(A,'t1').attach=MA.makeAttach(get(A,'i1'),get(A,'t1'),LL);
  get(B,'i2').attach=MA.makeAttach(get(B,'f2'),get(B,'i2'));
  MA.enable(A); MA.setStep(A,0,{hold:1.5}); MA.addStep(A,0,{hold:1,dur:2}); MA.addStep(A,1,{hold:2,dur:2.5});
  const f_s2=A.anim.steps[1].objects.find(o=>o.id==='f1'); f_s2.pts=f_s2.pts.map(p=>[p[0]+0.35,p[1]+0.12]); f_s2.pts.push([-70.2,41.7]);
  const f_s3=A.anim.steps[2].objects.find(o=>o.id==='f1'); f_s3.pts=f_s3.pts.map((p,k)=>[p[0]+0.1,p[1]-0.1*Math.sin(k)]);
  MA.sanitizeAttach(A); MA.sanitizeAttach(B);   // every step: the followers sit on THAT step's front
  MA.enable(C); MA.addStep(C,0,{hold:1,dur:2}); C.anim.steps[1].objects.find(o=>o.id==='lf').pts=C.anim.steps[1].objects.find(o=>o.id==='lf').pts.map(p=>[p[0]+100,p[1]-40]);
  WX.commit(); return true;}"""
# a compact, comparable picture of every front / follower in every step of every scene
SNAP = r"""()=>{const out=[];const r=v=>v==null?null:Math.round(v*1e6)/1e6;
  WX.S.show.scenes.forEach((sc,si)=>{const lists=[['s0',sc.objects]];(sc.anim&&sc.anim.steps||[]).forEach((st,k)=>{if(k>0)lists.push(['s'+k,st.objects])});
    lists.forEach(([k,objs])=>objs.forEach(o=>{if(o.type==='front'||o.attach)out.push([si,k,o.id,r(o.x),r(o.y),o.pts?o.pts.map(p=>[r(p[0]),r(p[1])]):null,o.attach?[o.attach.to,r(o.attach.u),r(o.attach.t),r(o.attach.n)]:null])   // key order is not significant (PostgreSQL jsonb re-orders keys)}))});
  return JSON.stringify(out);}"""
# is every follower exactly on its front in every step? -> list of worst distances (stored units)
CONS = r"""()=>{const MA=MapAnim,worst=[];WX.S.show.scenes.forEach((sc,si)=>{const lists=[sc.objects];(sc.anim&&sc.anim.steps||[]).forEach((st,k)=>{if(k>0)lists.push(st.objects)});
  lists.forEach((objs,k)=>objs.forEach(o=>{if(!o.attach)return;const par=objs.find(q=>q.id===o.attach.to);if(!par){worst.push([si,k,o.id,'no parent']);return}
   const p=MA.attachPos(o.attach,par,{lngLat:sc.bg.type==='mapbox'});worst.push([si,k,o.id,Math.hypot(p[0]-o.x,p[1]-o.y)])}))});return worst}"""
def snap(pg): return pg.evaluate(SNAP)
def cons_ok(pg):
    w = pg.evaluate(CONS); return all(isinstance(x[3], (int, float)) and x[3] < 1e-5 for x in w), w
def n_attach(pg): return pg.evaluate("""()=>{let n=0;WX.S.show.scenes.forEach(sc=>{[sc.objects].concat((sc.anim&&sc.anim.steps||[]).slice(1).map(s=>s.objects)).forEach(a=>a.forEach(o=>{if(o.attach)n++}))});return n}""")

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])
    c1, a = new_computer(br)
    a.evaluate(BUILD, 'Follow persistence'); a.wait_for_timeout(500)
    S0 = snap(a); N0 = n_attach(a); ok, w = cons_ok(a)
    chk('test show built: 3 followers in the animated pinned scene x 3 steps + 1 in the screen scene = 10 links', N0 == 10, N0)
    chk('every follower sits exactly on its front in every step (consistent before saving)', ok, w)
    chk('the label follows the ICON (a two-level chain) and the icon follows the front', a.evaluate("(()=>{const o=WX.S.show.scenes[0].objects;return o.find(x=>x.id==='t1').attach.to==='i1'&&o.find(x=>x.id==='i1').attach.to==='f1'})()"))
    chk('step 2 really moved the front and its followers with it', json.loads(S0) and a.evaluate("(()=>{const s=WX.S.show.scenes[0];const g=(o,id)=>o.find(x=>x.id===id);return Math.abs(g(s.anim.steps[1].objects,'i1').x-g(s.objects,'i1').x)>0.2&&Math.abs(g(s.anim.steps[1].objects,'t1').x-g(s.objects,'t1').x)>0.2})()"))

    # ---------- 1. LOCAL save + reopen (autosave -> reload) ----------
    a.wait_for_timeout(800); a.reload(); a.wait_for_timeout(2200)
    chk('local autosave + reload: show is back', a.evaluate("WX.S.show.name") == 'Follow persistence', a.evaluate("WX.S.show.name"))
    S1 = snap(a)
    chk('local reopen: every front, follower position and attach record identical', S1 == S0)
    ok, w = cons_ok(a); chk('local reopen: followers still exactly on their fronts', ok, w)
    # still LIVE after reopening: reshape the front of step 2 and the followers must come along
    a.evaluate("(()=>{WX.S.step=1;WX.S.stepSid=WX.S.show.scenes[0].id;WX.S.si=0;WX.S.mode='edit'})()"); a.wait_for_timeout(200)
    before = a.evaluate("(()=>{const o=WX.S.show.scenes[0].anim.steps[1].objects;return [o.find(x=>x.id==='i1').x,o.find(x=>x.id==='t1').x]})()")
    a.evaluate("(()=>{const o=WX.S.show.scenes[0].anim.steps[1].objects;const f=o.find(x=>x.id==='f1');f.pts=f.pts.map(p=>[p[0]+0.4,p[1]]);})()"); a.wait_for_timeout(500)
    after = a.evaluate("(()=>{const o=WX.S.show.scenes[0].anim.steps[1].objects;return [o.find(x=>x.id==='i1').x,o.find(x=>x.id==='t1').x]})()")
    chk('reopened show: moving the step-2 front still carries the icon AND the label (chain) by the same amount', abs(after[0] - before[0] - 0.4) < 0.02 and abs(after[1] - before[1] - 0.4) < 0.02, [before, after])
    a.evaluate("WX.commit()"); a.wait_for_timeout(300)
    S0 = snap(a)       # new reference after the edit

    # ---------- 2. PORTABLE show files ----------
    with a.expect_download() as d: a.evaluate("document.getElementById('bSave').click()")
    dl = d.value; jpath = TMP + '/' + dl.suggested_filename; dl.save_as(jpath)
    chk('Save writes the light .wxshow.json when there is no media', jpath.endswith('.wxshow.json'), dl.suggested_filename)
    jdoc = json.load(open(jpath))
    saved_links = sum(1 for sc in jdoc['scenes'] for o in sc['objects'] if o.get('attach')) + sum(1 for sc in jdoc['scenes'] if sc.get('anim') for st in sc['anim']['steps'][1:] for o in st['objects'] if o.get('attach'))
    chk('the saved file contains all 10 attach records', saved_links == 10, saved_links)
    chk('…and no attach key anywhere in the Legacy scene', not any('attach' in o for o in jdoc['scenes'][2]['objects']) and not any('attach' in o for st in jdoc['scenes'][2]['anim']['steps'][1:] for o in st['objects']))
    c2, b = new_computer(br)       # a brand-new browser profile = "another computer"
    b.set_input_files('#fileOpen', jpath); b.wait_for_timeout(1800)
    chk('Open of the .wxshow.json in a brand-new browser: positions + attach records identical', snap(b) == S0)
    ok, w = cons_ok(b); chk('…and the followers sit on their fronts', ok, w)
    # the package form (.wxshow zip): built with the real packer, opened through the same Open button
    pk = b.evaluate("""async()=>{const r=await WXShowFile.pack(WX.S.show,{videos:{},appVersion:'test'});const buf=new Uint8Array(await r.blob.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=8192)s+=String.fromCharCode.apply(null,buf.subarray(i,i+8192));return btoa(s)}""")
    ppath = TMP + '/pkg.wxshow'; open(ppath, 'wb').write(base64.b64decode(pk))
    chk('the .wxshow package is a zip', open(ppath, 'rb').read(2) == b'PK')
    c3, c = new_computer(br); c.set_input_files('#fileOpen', ppath); c.wait_for_timeout(2000)
    chk('Open of the .wxshow package in a third fresh browser: identical', snap(c) == S0)
    ok, w = cons_ok(c); chk('…followers on their fronts', ok, w)
    chk('no page errors while saving / opening portable files', not (a.errs or b.errs or c.errs), (a.errs + b.errs + c.errs)[:2])
    c3.close()

    # ---------- 3. CLOUD save + reopen ----------
    sign_in(a, 'a@x.test'); click_btn(a, 'Continue'); a.wait_for_timeout(2500)
    ok = saved(a); st = adm()
    chk('cloud: first sync created one cloud show', ok and len(st['shows']) == 1, len(st['shows']))
    doc = st['shows'][0]['doc']
    cloud_links = sum(1 for sc in doc['scenes'] for o in sc['objects'] if o.get('attach')) + sum(1 for sc in doc['scenes'] if sc.get('anim') for s2 in sc['anim']['steps'][1:] for o in s2['objects'] if o.get('attach'))
    chk('cloud: all 10 attach records are stored in the document', cloud_links == 10, cloud_links)
    chk('cloud: schema versions unchanged (engine v:1, cloud_schema:1)', doc.get('v') == 1 and doc.get('cloud_schema') == 1, (doc.get('v'), doc.get('cloud_schema')))
    chk('cloud: the Legacy scene is stored with no attach key', not any('attach' in o for o in doc['scenes'][2]['objects']))
    rev1 = st['shows'][0]['rev']
    c4, d2 = new_computer(br); sign_in(d2, 'a@x.test')
    ok = wait(d2, "()=>WX.S.show.name==='Follow persistence'", 25000)
    chk('cloud: a second computer opens the show', ok, d2.evaluate("WX.S.show.name"))
    d2.wait_for_timeout(800)
    chk('cloud reopen: every position + attach record identical', snap(d2) == S0)
    ok, w = cons_ok(d2); chk('cloud reopen: followers on their fronts', ok, w)
    chk('cloud reopen did not create a new revision (nothing "changed" by merely opening)', saved(d2, 15000) and adm()['shows'][0]['rev'] == rev1, adm()['shows'][0]['rev'])
    # edit on computer B: move the step-3 front, the followers come along, and that is what the cloud stores
    d2.evaluate("(()=>{WX.S.step=2;WX.S.stepSid=WX.S.show.scenes[0].id;WX.S.si=0;WX.S.mode='edit'})()"); d2.wait_for_timeout(250)
    d2.evaluate("(()=>{const o=WX.S.show.scenes[0].anim.steps[2].objects;const f=o.find(x=>x.id==='f1');f.pts=f.pts.map(p=>[p[0]-0.25,p[1]+0.05]);})()"); d2.wait_for_timeout(500); d2.evaluate("WX.commit()")
    for _ in range(60):
        if adm()['shows'][0]['rev'] > rev1: break
        d2.wait_for_timeout(500)
    doc2 = adm()['shows'][0]['doc']; s3 = doc2['scenes'][0]['anim']['steps'][2]['objects']
    fi = next(o for o in s3 if o['id'] == 'f1'); ic = next(o for o in s3 if o['id'] == 'i1'); lb = next(o for o in s3 if o['id'] == 't1')
    ok_c, w2 = cons_ok(d2)
    chk('cloud edit: one new revision holding the reshaped step-3 front', adm()['shows'][0]['rev'] == rev1 + 1)
    chk('cloud edit: the icon and the label moved with the front in the stored document and kept their attach records', ic['attach']['to'] == 'f1' and lb['attach']['to'] == 'i1' and ok_c, w2)
    d2S = snap(d2)
    c5, a2 = new_computer(br); sign_in(a2, 'a@x.test'); wait(a2, "()=>WX.S.show.name==='Follow persistence'", 25000); a2.wait_for_timeout(800)
    chk('cloud: a fresh computer afterwards sees exactly the edited positions + links', snap(a2) == d2S)
    ok, w = cons_ok(a2); chk('…and they are consistent', ok, w)
    chk('no page errors during the cloud round trips', not (a.errs or d2.errs or a2.errs), (a.errs + d2.errs + a2.errs)[:2])
    c4.close(); c5.close()

    # ---------- 4. OLD shows (no attachments at all) stay exactly as they were ----------
    old = a.evaluate("""()=>{const sh=JSON.parse(JSON.stringify(WX.S.show));sh.scenes.forEach(sc=>{const strip=arr=>arr.forEach(o=>{delete o.attach});strip(sc.objects);(sc.anim&&sc.anim.steps||[]).slice(1).forEach(s=>strip(s.objects))});sh.name='Old show';return sh}""")
    opath = TMP + '/old.wxshow.json'; open(opath, 'w').write(json.dumps(old))
    c6, o = new_computer(br); o.set_input_files('#fileOpen', opath); o.wait_for_timeout(1800)
    after_ = o.evaluate("JSON.stringify(WX.S.show.scenes)")
    oa = json.loads(after_)
    same_objs = all(json.dumps(x['objects'], sort_keys=True) == json.dumps(y['objects'], sort_keys=True) for x, y in zip(old['scenes'], oa)) and all(json.dumps(x.get('anim'), sort_keys=True) == json.dumps(y.get('anim'), sort_keys=True) for x, y in zip(old['scenes'], oa))
    chk('old show (no attach) opens with every object and every animation step byte-for-byte unchanged', same_objs)
    chk('old show: no attach key appears anywhere, and Follow bookkeeping changes nothing', n_attach(o) == 0 and o.evaluate("MapAnim.syncAttach(WX.S.show.scenes[0].anim.steps[1].objects,new WeakMap(),{lngLat:true})") == 0)
    chk('old show: plays (timeline) as before', o.evaluate("MapAnim.timeline(WX.S.show.scenes[2]).total") > 0 and o.evaluate("MapAnim.objectsAt(WX.S.show.scenes[2],3).length") == 2)
    chk('old show: the saved JSON carries no attach key', '"attach"' not in o.evaluate("WXShowFile.legacyJson(WX.S.show,{})"))
    c6.close()

    # ---------- 5. DAMAGED / hand-edited files: bad links are dropped safely ----------
    bad = a.evaluate("""()=>{const E=WX.E;const mk=(id,x,y)=>E.newObject('icon',{id,x,y,icon:'rain',size:80});
      const f=E.newObject('front',{id:'f',kind:'cold',pts:[[300,500],[600,450],[900,470],[1200,560]]});
      const ok1=mk('ok1',600,380); ok1.attach={to:'f',u:0.4,t:0,n:-70};
      const A=mk('A',100,100),B=mk('B',200,100),C=mk('C',300,100),D=mk('D',400,100),Ex=mk('Ex',500,100);          // 5-long cycle A->B->C->D->Ex->A
      A.attach={to:'B',u:0,t:0,n:0};B.attach={to:'C',u:0,t:0,n:0};C.attach={to:'D',u:0,t:0,n:0};D.attach={to:'Ex',u:0,t:0,n:0};Ex.attach={to:'A',u:0,t:0,n:0};
      const T1=mk('T1',700,700),T2=mk('T2',800,700),T3=mk('T3',900,700); T1.attach={to:'T2',u:0,t:0,n:0};T2.attach={to:'T3',u:0,t:0,n:0};T3.attach={to:'T1',u:0,t:0,n:0};   // 3-cycle
      const self=mk('self',1000,700); self.attach={to:'self',u:0,t:0,n:0};
      const gone=mk('gone',1100,700); gone.attach={to:'nobody',u:0.5,t:1,n:2};
      const geoMix=mk('geoMix',1200,700); geoMix.geo=true; geoMix.attach={to:'f',u:0.5,t:0,n:0};                  // pinned child, screen parent
      const junk1=mk('junk1',1300,700); junk1.attach='f'; const junk2=mk('junk2',1400,700); junk2.attach=[1,2,3]; const junk3=mk('junk3',1500,700); junk3.attach={to:'f',u:'abc',t:null,n:{}};
      const nan=mk('nan',1600,700); nan.attach={to:'f',u:0.2,t:1e300,n:0}; const fr2=E.newObject('front',{id:'fr2',kind:'warm',pts:[[1,1],[2,2],[3,3]]}); fr2.attach={to:'f',u:0,t:0,n:0};     // a front cannot follow
      const chain=[]; let prev='f'; for(let k=0;k<40;k++){const c=mk('c'+k,300+k*20,300); c.attach={to:prev,u:0.5,t:0,n:-30}; chain.push(c); prev=c.id;}            // a long valid chain (40 deep)
      const sc=E.newScene({id:'bad1',name:'Damaged',duration:4,bg:{type:'solid',color:'#204060',kenburns:false},title:{show:false,text:'',sub:''},objects:[f,ok1,A,B,C,D,Ex,T1,T2,T3,self,gone,geoMix,junk1,junk2,junk3,nan,fr2].concat(chain)});
      return {name:'Damaged links',accent:'#2f9bff',scenes:[sc],assets:{},mbMigrated:1};}""")
    bpath = TMP + '/damaged.wxshow.json'; open(bpath, 'w').write(json.dumps(bad))
    c7, d = new_computer(br); d.set_input_files('#fileOpen', bpath); d.wait_for_timeout(1800)
    st_ = d.evaluate("""()=>{const o=WX.S.show.scenes[0].objects, g=id=>o.find(x=>x.id===id);return {show:WX.S.show.name,
      kept:['ok1'].filter(i=>g(i)&&g(i).attach).length, cyc:['A','B','C','D','Ex','T1','T2','T3'].filter(i=>g(i).attach).length, bad:['self','gone','geoMix','junk1','junk2','junk3','nan','fr2'].filter(i=>g(i).attach!==undefined).length,
      chainKept:o.filter(x=>/^c\\d+$/.test(x.id)&&x.attach).length, hist:WX.S.hist.length}}""")
    chk('damaged file opens (no crash) and the good link survives', st_['show'] == 'Damaged links' and st_['kept'] == 1, st_)
    chk('cycles of length 5 and 3 are broken (at least one link of each loop removed, no loop left)', d.evaluate("""()=>{const o=WX.S.show.scenes[0].objects;const by=Object.fromEntries(o.map(x=>[x.id,x]));const loops=ids=>ids.some(s=>{let c=by[s],n=0;while(c&&c.attach&&n<20){c=by[c.attach.to];n++;if(c===by[s])return true}return false});return !loops(['A','B','C','D','Ex'])&&!loops(['T1','T2','T3'])&&['A','B','C','D','Ex'].some(i=>!by[i].attach)}"""))
    chk('self, missing-parent, pinned/screen mismatch, malformed and front-as-follower links are all removed', st_['bad'] == 0, st_)
    chk('a 40-deep valid chain is kept intact and placed parent-first', st_['chainKept'] == 40, st_['chainKept'])
    pos = d.evaluate("""()=>{const o=WX.S.show.scenes[0].objects, g=id=>o.find(x=>x.id===id);const f=g('f');const p=MapAnim.attachPos(g('ok1').attach,f,{});return [Math.hypot(p[0]-g('ok1').x,p[1]-g('ok1').y), g('ok1').attach.n]}""")
    chk('the good link was placed exactly on its parent at load', pos[0] < 1e-5 and abs(pos[1] + 70) < 1e-6, pos)
    h0 = d.evaluate("WX.S.hist.length"); j0 = d.evaluate("JSON.stringify(WX.S.show.scenes)"); d.wait_for_timeout(1500)
    chk('no repeated updates: nothing changes and no history entries are added while the damaged show sits open', d.evaluate("WX.S.hist.length") == h0 and d.evaluate("JSON.stringify(WX.S.show.scenes)") == j0, [h0, d.evaluate("WX.S.hist.length")])
    chk('a second sync pass over the cleaned scene changes nothing (idempotent)', d.evaluate("MapAnim.syncAttach(WX.S.show.scenes[0].objects,new WeakMap(),{})") == 0 and d.evaluate("MapAnim.syncAttach(WX.S.show.scenes[0].objects,new WeakMap(),{})") == 0)
    chk('no page errors opening the damaged file', not d.errs, d.errs[:2])
    # damaged links inside the steps of an animated scene (steps load through the same safety pass)
    bad2 = d.evaluate("""()=>{const sc=WX.S.show.scenes[0];const c=JSON.parse(JSON.stringify(WX.S.show));const s=c.scenes[0];
      s.objects=s.objects.filter(o=>o.id==='f'||o.id==='ok1').concat([Object.assign(WX.E.newObject('icon',{id:'p',x:10,y:10}),{attach:{to:'q',u:0,t:0,n:0}}),Object.assign(WX.E.newObject('icon',{id:'q',x:20,y:10}),{attach:{to:'p',u:0,t:0,n:0}})]);
      MapAnim.enable(s); MapAnim.addStep(s,0,{hold:1,dur:2}); s.anim.steps[1].objects.forEach(o=>{if(o.id==='ok1')o.attach={to:'zzz',u:0,t:0,n:0}}); c.name='Damaged steps'; return c}""")
    spath = TMP + '/damaged_steps.wxshow.json'; open(spath, 'w').write(json.dumps(bad2))
    d.set_input_files('#fileOpen', spath); d.wait_for_timeout(1500)
    r_ = d.evaluate("""()=>{const s=WX.S.show.scenes[0];const g=(a,id)=>a.find(x=>x.id===id);return {n:WX.S.show.name,okS0:!!g(s.objects,'ok1').attach,okS1:g(s.anim.steps[1].objects,'ok1').attach,loop0:!!(g(s.objects,'p').attach&&g(s.objects,'q').attach),loop1:!!(g(s.anim.steps[1].objects,'p').attach&&g(s.anim.steps[1].objects,'q').attach)}}""")
    chk('damaged links inside an animated step are repaired the same way (missing parent dropped, loop broken, other steps untouched)', r_['n'] == 'Damaged steps' and r_['okS0'] and r_['okS1'] is None and not r_['loop0'] and not r_['loop1'], r_)
    chk('…and playing through the transition afterwards does not throw', d.evaluate("(()=>{const s=WX.S.show.scenes[0];for(let t=0;t<=s.duration;t+=0.25)MapAnim.objectsAt(s,t);return true})()") and not d.errs, d.errs[:2])
    c7.close()
    a.screenshot(path=S + 'attach_persistence.png')
    chk('no page errors anywhere', not (a.errs or b.errs or c.errs), (a.errs + b.errs)[:2])
    br.close()
srv.terminate()
bad_ = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad_)))
sys.exit(1 if bad_ else 0)
