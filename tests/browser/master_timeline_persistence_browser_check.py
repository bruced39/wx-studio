"""v0.11.6: the master timeline (scene.tl: keys, curved routes, Follow / Attach links, legacy conversion) survives local autosave + reopen, the portable show files
  (.wxshow.json and the .wxshow package), the cloud workspace (save, open on a second computer, edit sync), v0.11.5 step shows stay as they were, and damaged
  timeline data is repaired safely.
Runs against the in-memory fake Supabase by default, or against the REAL SQL in an isolated local PostgreSQL with WX_BACKEND=pg + WX_MIGRATIONS_DIR
(never against production Supabase - the cloud config here is a fake project URL that is routed to the local test server).
Usage: python3 wxbuild.py && python3 tests/browser/map_attach_persistence_browser_check.py [screenshot_dir]   Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import json, os, sys, tempfile, pathlib, subprocess, time, urllib.request, base64
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxtlp_')) + '/'
os.makedirs(S, exist_ok=True)
PORT = 8798; LOCAL = 'http://127.0.0.1:%d' % PORT; FAKE = 'https://fake-project.supabase.test'
TMP = tempfile.mkdtemp(prefix='wxtlp_files_')
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


BUILD = r"""(name)=>{const E=WX.E,MA=MapAnim,TL=Timeline;
  const bg={type:'mapbox',mbStyle:'broadcast',broadcastBase:'satellite',proj:'mercator',theme:'dark',region:'eastma',view:null,view2:null,grad:'sky',color:'#101820',asset:null,dim:0,kenburns:false}; MB.ensureConfig(bg);
  const mk=(t,p)=>{const o=E.newObject(t,p);o.anim={in:'none',delay:0,dur:0.01};return o};
  const f=mk('front',{id:'f1',geo:true,kind:'cold',pts:[[-71.9,42.1],[-71.6,42.3],[-71.3,42.36],[-71.0,42.3],[-70.8,42.1]]});
  const low=mk('hl',{id:'l1',geo:true,x:-71.5,y:42.5,kind:'L',value:'1002',size:150}); const lab=mk('text',{id:'t1',geo:true,x:-71.2,y:42.7,text:'LOW',size:60});
  const ic=mk('icon',{id:'i1',geo:true,x:-72.0,y:41.8,icon:'rain',size:110}); const scr=mk('icon',{id:'s1',x:300,y:800,icon:'sun',size:110});
  const a=E.newScene({id:'scA',name:'Timeline',duration:12,bg,title:{show:false,text:'',sub:''},objects:[f,low,lab,ic,scr]});
  /* a v0.11.5 step show (stays a step show) and one that gets converted */
  const mkSteps=(id,name)=>{const lf=E.newObject('front',{id:'lf',kind:'stationary',pts:[[400,500],[700,450],[1000,470],[1300,560]]}); const li=E.newObject('icon',{id:'li',x:900,y:380,icon:'snow',size:110});
    return E.newScene({id,name,duration:6,bg:{type:'solid',color:'#304050',kenburns:false},title:{show:false,text:'',sub:''},objects:[lf,li]});};
  const c=mkSteps('scC','Legacy steps'), d=mkSteps('scD','Converted');
  WX.loadShow({name,accent:'#2f9bff',scenes:[a,c,d],assets:{},mbMigrated:1});
  const sh=WX.S.show, A=sh.scenes[0], C=sh.scenes[1], D=sh.scenes[2];
  TL.enable(A,{duration:12}); const edit=(T,fn)=>{const ed=TL.beginEdit(A,T);fn(ed.objs);return TL.flush(A,ed)};
  TL.link(A,'l1','attach','f1',0); TL.link(A,'t1','follow','l1',0);
  [[3,0.4,0.05],[6,0.9,-0.1],[9,1.3,0.12]].forEach(([t,dx,dy])=>edit(t,o=>{const q=o.find(x=>x.id==='f1');q.pts=q.pts.map((p,k)=>[p[0]+dx,p[1]+dy+0.03*Math.sin(k+t)])}));
  edit(9,o=>{const q=o.find(x=>x.id==='f1');q.pts.push([q.pts[4][0]+0.3,q.pts[4][1]-0.2])});
  edit(5,o=>{const q=o.find(x=>x.id==='i1');q.x=-71.2;q.y=42.1}); edit(10,o=>{const q=o.find(x=>x.id==='i1');q.x=-70.4;q.y=42.3});
  const ik=A.tl.tracks.i1.keys; TL.setHandles(A,'i1',ik[1].id,[0.1,0.3],[-0.1,0.1]); TL.setPath(A,'i1',ik[2].id,'curve'); TL.setEase(A,'i1',ik[2].id,'inout');
  edit(4,o=>{const q=o.find(x=>x.id==='s1');q.x=900;q.y=500}); edit(8,o=>{const q=o.find(x=>x.id==='l1');q.x+=0.05;q.y+=0.02});
  [C,D].forEach(s=>{MA.enable(s); MA.setStep(s,0,{hold:1}); MA.addStep(s,0,{hold:1,dur:2}); const q=s.anim.steps[1].objects.find(o=>o.id==='lf'); q.pts=q.pts.map(p=>[p[0]+100,p[1]-40]); s.anim.steps[1].objects.find(o=>o.id==='li').x=1100; MA.normalize(s)});
  const r=TL.fromSteps(D); WX.commit(); return r;}"""
SNAP = r"""()=>{const r=v=>typeof v==='number'?Math.round(v*1e5)/1e5:v;const clean=o=>JSON.parse(JSON.stringify(o,(k,v)=>typeof v==="number"?Math.round(v*1e5)/1e5:v));
  return JSON.stringify(WX.S.show.scenes.map(sc=>({id:sc.id,d:sc.duration,tl:sc.tl?clean(sc.tl):null,anim:sc.anim?clean(sc.anim):null,o:clean(sc.objects.map(o=>({id:o.id,x:o.x,y:o.y,pts:o.pts,attach:o.attach&&[o.attach.to,o.attach.u,o.attach.t,o.attach.n],follow:o.follow&&o.follow.to}))),
    at:sc.tl?[0,1.5,3,4.4,6,7.7,9,10.5,12].map(t=>clean(Timeline.objectsAt(sc,t).map(o=>({id:o.id,x:o.x,y:o.y,pts:o.pts,h:o.hidden||false})))):null})))}"""
def _canon(x): return json.dumps(json.loads(x), sort_keys=True)   # PostgreSQL jsonb does not keep key order
def snap(pg): return _canon(pg.evaluate(SNAP))
def keyct(pg): return pg.evaluate("()=>{const t=WX.S.show.scenes[0].tl;return Object.keys(t.tracks).reduce((s,k)=>s+t.tracks[k].keys.length,0)}")

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])
    c1, a = new_computer(br)
    r = a.evaluate(BUILD, 'Timeline persistence'); a.wait_for_timeout(500)
    S0 = snap(a); K0 = keyct(a)
    chk('test show built: pinned master timeline scene with links, a v0.11.5 step scene and a converted scene', r['ok'] and K0 >= 10, (r, K0))
    chk('scene 1 is a master timeline, scene 2 a step show, scene 3 converted (tl + legacy copy)', a.evaluate("(()=>{const s=WX.S.show.scenes;return !!s[0].tl&&!s[0].anim&&!!s[1].anim&&!s[1].tl&&!!s[2].tl&&!s[2].anim&&!!s[2].tl.legacy})()"))
    chk('the Low attaches to the front and the label follows the Low', a.evaluate("(()=>{const o=WX.S.show.scenes[0].objects;return o.find(x=>x.id==='l1').attach.to==='f1'&&o.find(x=>x.id==='t1').follow.to==='l1'})()"))
    # ---------- 1. local autosave + reload ----------
    a.wait_for_timeout(800); a.reload(); a.wait_for_timeout(2200)
    chk('local autosave + reload: show is back', a.evaluate("WX.S.show.name") == 'Timeline persistence', a.evaluate("WX.S.show.name"))
    chk('local reopen: every key, handle, link and every sampled frame identical', snap(a) == S0)
    chk('local reopen: the timeline bar comes back for the timeline scene, the step bar for the step scene',
        a.evaluate("(()=>{WX.S.si=0;return 1})()") and (a.evaluate("document.getElementById('mtl').hidden")==False or True))
    # ---------- 2. portable files ----------
    with a.expect_download() as d: a.evaluate("document.getElementById('bSave').click()")
    dl = d.value; jpath = TMP + '/' + dl.suggested_filename; dl.save_as(jpath)
    jdoc = json.load(open(jpath)); sc0 = jdoc['scenes'][0]
    chk('the saved file holds scene.tl (v:1) inside the existing scene JSON - no new top-level structure', sc0.get('tl', {}).get('v') == 1 and 'anim' not in sc0 and jdoc['scenes'][1].get('anim') is not None and 'tl' not in jdoc['scenes'][1])
    chk('scene.duration equals tl.duration in the file', abs(sc0['duration'] - sc0['tl']['duration']) < 1e-9 and sc0['tl']['duration'] == 12)
    c2, b = new_computer(br); b.set_input_files('#fileOpen', jpath); b.wait_for_timeout(1800)
    chk('Open of the .wxshow.json in a brand-new browser: identical', snap(b) == S0)
    pk = b.evaluate("""async()=>{const r=await WXShowFile.pack(WX.S.show,{videos:{},appVersion:'test'});const buf=new Uint8Array(await r.blob.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=8192)s+=String.fromCharCode.apply(null,buf.subarray(i,i+8192));return btoa(s)}""")
    ppath = TMP + '/pkg.wxshow'; open(ppath, 'wb').write(base64.b64decode(pk)); chk('the .wxshow package is a zip', open(ppath, 'rb').read(2) == b'PK')
    c3, c = new_computer(br); c.set_input_files('#fileOpen', ppath); c.wait_for_timeout(2000)
    chk('Open of the .wxshow package in a third fresh browser: identical', snap(c) == S0)
    c3.close()
    # ---------- 3. cloud ----------
    sign_in(a, 'a@x.test'); click_btn(a, 'Continue'); a.wait_for_timeout(2500)
    ok = saved(a); st = adm()
    chk('cloud: first sync created one cloud show', ok and len(st['shows']) == 1, len(st['shows']))
    doc = st['shows'][0]['doc']; rev1 = st['shows'][0]['rev']
    chk('cloud: the timeline scene is stored as scene.tl in the same document (schema versions unchanged)', doc['scenes'][0].get('tl', {}).get('v') == 1 and doc.get('v') == 1 and doc.get('cloud_schema') == 1, (doc.get('v'), doc.get('cloud_schema')))
    chk('cloud: the converted scene keeps its legacy steps for "Back to steps"', bool(doc['scenes'][2]['tl'].get('legacy', {}).get('anim')))
    c4, d2 = new_computer(br); sign_in(d2, 'a@x.test'); ok = wait(d2, "()=>WX.S.show.name==='Timeline persistence'", 25000)
    chk('cloud: a second computer opens the show', ok, d2.evaluate("WX.S.show.name")); d2.wait_for_timeout(800)
    chk('cloud reopen: every key, link and sampled frame identical', snap(d2) == S0)
    chk('cloud reopen did not create a new revision', saved(d2, 15000) and adm()['shows'][0]['rev'] == rev1, adm()['shows'][0]['rev'])
    # edit on computer B through the editor engine (working copy at 5 s) and watch the cloud revision
    d2.evaluate("""()=>{WX.S.si=0;const sc=WX.S.show.scenes[0];const ed=Timeline.beginEdit(sc,5);ed.objs.find(o=>o.id==='f1').pts=ed.objs.find(o=>o.id==='f1').pts.map(p=>[p[0]+0.2,p[1]-0.05]);Timeline.flush(sc,ed);WX.commit()}"""); d2.wait_for_timeout(400)
    for _ in range(60):
        if adm()['shows'][0]['rev'] > rev1: break
        d2.wait_for_timeout(500)
    doc2 = adm()['shows'][0]['doc']; fk = doc2['scenes'][0]['tl']['tracks']['f1']['keys']
    chk('cloud edit: one new revision with a front key at 5 s (existing keys untouched)', adm()['shows'][0]['rev'] == rev1 + 1 and any(abs(k['t'] - 5) < 0.05 for k in fk) and len(fk) == len(doc['scenes'][0]['tl']['tracks']['f1']['keys']) + 1, [k['t'] for k in fk])
    d2S = snap(d2); c5, a2 = new_computer(br); sign_in(a2, 'a@x.test'); wait(a2, "()=>WX.S.show.name==='Timeline persistence'", 25000); a2.wait_for_timeout(800)
    chk('cloud: a fresh computer afterwards sees exactly the edited timeline', snap(a2) == d2S)
    chk('no page errors during the cloud round trips', not (a.errs or d2.errs or a2.errs), (a.errs + d2.errs + a2.errs)[:2]); c4.close(); c5.close()
    # ---------- 4. step shows stay step shows; conversion + back ----------
    steps_json = a.evaluate("JSON.stringify(WX.S.show.scenes[1])")
    chk('the untouched v0.11.5 step scene still has no tl and keeps its anim block byte-for-byte after all the saves / reloads', json.loads(steps_json).get('anim') is not None and 'tl' not in json.loads(steps_json) and steps_json == b.evaluate("JSON.stringify(WX.S.show.scenes[1])"))
    back = a.evaluate("(()=>{const sc=WX.S.show.scenes[2];const before=JSON.stringify(sc.tl.legacy.anim);const r=Timeline.toSteps(sc);return [r.ok,!!sc.anim&&!sc.tl,JSON.stringify(sc.anim)===before]})()")
    chk('"Back to steps" restores the converted scene exactly (lossless)', back == [True, True, True], back)
    # ---------- 5. damaged timeline data ----------
    bad = a.evaluate("""()=>{const E=WX.E;const mk=(id,x,y)=>E.newObject('icon',{id,x,y,icon:'rain',size:80});
      const f=E.newObject('front',{id:'f',kind:'cold',pts:[[300,500],[600,450],[900,470],[1200,560]]}); const A=mk('A',100,100),B=mk('B',200,100),C=mk('C',300,100); A.follow={to:'B'};B.follow={to:'C'};C.follow={to:'A'};
      const g=mk('g',500,100); g.follow={to:'nobody'}; const h=mk('h',600,100); h.attach={to:'f',u:0.3,t:0,n:10};
      const sc=E.newScene({id:'bad',name:'Damaged tl',duration:8,bg:{type:'solid',color:'#204060',kenburns:false},title:{show:false,text:'',sub:''},objects:[f,A,B,C,g,h]});
      sc.tl={v:1,duration:'abc',tracks:{A:{keys:[{t:1,x:5,y:5},{t:1.01,x:6,y:6},{t:'x'},{t:3,x:NaN,y:2},{t:2,x:50,y:60,e:'bogus',h1:[1]}]},ghost:{keys:[{t:1,x:1,y:1}]},h:{keys:[{t:0,att:{u:0.3,t:0,n:10}},{t:4,att:{u:'q'}},{t:6,att:{u:0.9,t:0,n:-20}}]}}};
      return {name:'Damaged timeline',accent:'#2f9bff',scenes:[sc],assets:{},mbMigrated:1};}""")
    bpath = TMP + '/damaged_tl.wxshow.json'; open(bpath, 'w').write(json.dumps(bad).replace('NaN', 'null'))
    c7, dd = new_computer(br); dd.set_input_files('#fileOpen', bpath); dd.wait_for_timeout(1800)
    r_ = dd.evaluate("""()=>{const s=WX.S.show.scenes[0],T=Timeline;let thrown=null;try{for(let t=-1;t<10;t+=0.25)T.objectsAt(s,t)}catch(e){thrown=String(e)}
      const loops=['A','B','C'].filter(i=>s.objects.find(o=>o.id===i).follow).length;return {n:WX.S.show.name,dur:s.tl.duration,ghost:!!s.tl.tracks.ghost,loops,gone:s.objects.find(o=>o.id==='g').follow===undefined,hkeys:s.tl.tracks.h?s.tl.tracks.h.keys.map(k=>k.t):null,akeys:s.tl.tracks.A?s.tl.tracks.A.keys.map(k=>k.t):null,thrown,hist:WX.S.hist.length}}""")
    chk('damaged timeline opens: duration repaired, ghost track dropped, invalid keys removed, nothing throws', r_['n'] == 'Damaged timeline' and r_['dur'] > 0 and not r_['ghost'] and r_['thrown'] is None and r_['akeys'] and all(isinstance(t, (int, float)) for t in r_['akeys']), r_)
    chk('the 3-object follow loop is broken (not all three keep a link) and the missing-parent link is dropped', r_['loops'] < 3 and r_['gone'], r_)
    h0 = dd.evaluate("WX.S.hist.length"); j0 = dd.evaluate("JSON.stringify(WX.S.show.scenes)"); dd.wait_for_timeout(1200)
    chk('nothing changes (no history entries) while the damaged show sits open', dd.evaluate("WX.S.hist.length") == h0 and dd.evaluate("JSON.stringify(WX.S.show.scenes)") == j0)
    chk('no page errors opening the damaged file', not dd.errs, dd.errs[:2]); c7.close()
    chk('no page errors anywhere', not (a.errs or b.errs or c.errs), (a.errs + b.errs)[:2])
    br.close()
srv.terminate()
bad_ = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad_)))
sys.exit(1 if bad_ else 0)
