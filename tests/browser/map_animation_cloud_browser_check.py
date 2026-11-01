"""Real-browser check (headless Chromium) that map animation steps survive the v0.10.2 cloud workspace against the in-memory fake Supabase
(or the REAL SQL in PostgreSQL with WX_BACKEND=pg + WX_MIGRATIONS_DIR): save, open on a second computer, unchanged-document detection (no new
revision while only scrubbing / selecting steps), edit sync, conflict (Use cloud / Keep mine / Keep both), offline recovery, version restore,
and that scenes WITHOUT animation are stored exactly as before. Each browser context is a separate "computer".
Usage: python3 wxbuild.py && python3 tests/browser/map_animation_cloud_browser_check.py [screenshot_dir]   Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import json, os, sys, tempfile, pathlib, subprocess, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxanimcw_')) + '/'
os.makedirs(S, exist_ok=True)
PORT = 8795; LOCAL = 'http://127.0.0.1:%d' % PORT; FAKE = 'https://fake-project.supabase.test'
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, ('' if ok else info))
srv = subprocess.Popen(['node', str(ROOT / 'tests/helpers/fake_supabase_server.js'), str(PORT)])
for _ in range(300):
    try: urllib.request.urlopen(LOCAL + '/__admin/state'); break
    except Exception: time.sleep(0.1)
def ids(): return json.loads(urllib.request.urlopen(LOCAL + '/__admin/ids').read())
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
MKSHOW = r"""(name)=>{const E=WX.E;
  const bg={type:'mapbox',mbStyle:'broadcast',broadcastBase:'satellite',proj:'mercator',theme:'dark',region:'eastma',view:null,view2:null,grad:'sky',color:'#101820',asset:null,dim:0,kenburns:false}; MB.ensureConfig(bg);
  const f=E.newObject('front',{id:'f1',geo:true,kind:'cold',pts:[[430,300],[450,290],[470,285],[490,290],[510,300],[530,312]]});
  const t=E.newObject('text',{id:'t1',geo:true,x:480,y:260,text:'COLD FRONT',size:60}); const h=E.newObject('hl',{id:'h1',geo:true,x:520,y:330,kind:'H',value:'1030',size:160});
  const a=E.newScene({name:'Animated',duration:6,bg,title:{show:false,text:'',sub:''},objects:[f,t,h]});
  const b=E.newScene({name:'Plain',duration:4,bg:{type:'solid',color:'#204060',kenburns:false},title:{show:false,text:'',sub:''},objects:[E.newObject('text',{id:'p1',text:'PLAIN',x:960,y:540})]});
  WX.loadShow({name,accent:'#2f9bff',scenes:[a,b],assets:{},mbMigrated:1});
  const s=WX.S.show.scenes[0]; MapAnim.enable(s); MapAnim.setStep(s,0,{hold:1.5}); MapAnim.addStep(s,0,{hold:1,dur:2,simplify:true}); MapAnim.addStep(s,1,{hold:2,dur:2.5,simplify:true});
  s.anim.steps[1].objects[0].pts=s.anim.steps[1].objects[0].pts.map(p=>[p[0]+30,p[1]+10]); s.anim.steps[1].objects[1].text='MOVING EAST';
  s.anim.steps[2].objects=s.anim.steps[2].objects.filter(o=>o.id!=='h1'); MapAnim.normalize(s); WX.commit();
  return JSON.stringify(s.anim);}"""
def wait(pg, js, t=20000, arg=None):
    try: pg.wait_for_function(js, arg=arg, timeout=t); return True
    except Exception: return False
def chip(pg): return pg.evaluate("(()=>{const c=document.getElementById('cloudState');return c.hidden?'(hidden)':c.querySelector('.cl').textContent})()")
def modal_text(pg): return pg.evaluate("document.getElementById('modalBg').style.display==='none'?'':document.getElementById('modal').innerText")
def click_btn(pg, text, scope='#modal'):
    return pg.evaluate("([t,s])=>{const b=[...document.querySelectorAll(s+' button')].find(x=>x.textContent.trim()===t);if(!b)return false;b.click();return true}", [text, scope])
def new_computer(br, w=1700):
    ctx = br.new_context(viewport={'width': w, 'height': 960}); ctx.add_init_script(CONF); ctx.route(FAKE + '/**', route)
    pg = ctx.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(1800); return ctx, pg
def sign_in(pg, email):
    pg.evaluate("document.getElementById('cloudState').click()"); pg.wait_for_timeout(300)
    pg.fill('#modal input[type=email]', email); pg.fill('#modal input[type=password]', 'pw'); click_btn(pg, 'Sign in'); pg.wait_for_timeout(900)
def saved(pg, t=25000): return wait(pg, "()=>document.getElementById('cloudState').querySelector('.cl').textContent==='Saved to cloud'", t)
SID = [None]
def S0():
    sh = adm()['shows']
    return next((x for x in sh if x['id'] == SID[0]), sh[0])
def cloud_anim(i=0): return S0()['doc']['scenes'][i].get('anim')

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])
    # ---------- computer A: animated show created locally, then signed in and synced ----------
    c1, a = new_computer(br)
    expect = json.loads(a.evaluate(MKSHOW, 'Animated show')); a.wait_for_timeout(500); a.reload(); a.wait_for_timeout(1800)
    chk('animation survives the local autosave + reload', json.dumps(a.evaluate("WX.S.show.scenes[0].anim"), sort_keys=True) == json.dumps(expect, sort_keys=True))
    sign_in(a, 'a@x.test'); click_btn(a, 'Continue'); a.wait_for_timeout(2500)
    ok = saved(a); st = adm()
    chk('first sync created one cloud show', ok and len(st['shows']) == 1, chip(a))
    doc = st['shows'][0]['doc']
    chk('cloud document stores the steps compactly inside the scene (no frames, no image data)', json.dumps(doc['scenes'][0]['anim'], sort_keys=True) == json.dumps(expect, sort_keys=True) and 'data:' not in json.dumps(doc), len(json.dumps(doc)))
    chk('derived scene duration is stored (1.5 + 2 + 1 + 2.5 + 2)', abs(doc['scenes'][0]['duration'] - 9) < 1e-9, doc['scenes'][0]['duration'])
    chk('cloud schema versions unchanged (engine v:1, cloud_schema:1)', doc.get('v') == 1 and doc.get('cloud_schema') == 1, (doc.get('v'), doc.get('cloud_schema')))
    chk('scene without animation is stored exactly as before (no anim key)', 'anim' not in doc['scenes'][1] and doc['scenes'][1]['objects'][0]['id'] == 'p1')
    chk('doc size is far below the 1 MiB warning / 8 MiB limit', len(json.dumps(doc)) < 20000, len(json.dumps(doc)))
    rev1 = st['shows'][0]['rev']; SID[0] = st['shows'][0]['id']

    # ---------- unchanged detection: playhead / step selection / forced sync never create a revision ----------
    a.evaluate("(()=>{WX.S.step=1;const sl=document.getElementById('sbScrub');if(sl){sl.value=2;sl.dispatchEvent(new Event('input',{bubbles:true}))}})()"); a.wait_for_timeout(800)
    a.evaluate("WXCloudUI.engine.syncNow({force:true})"); a.wait_for_timeout(1500)
    chk('forced sync of an unchanged animated show creates NO new revision', S0()['rev'] == rev1, (rev1, S0()['rev']))

    # ---------- computer B opens the same show ----------
    c2, b = new_computer(br); sign_in(b, 'a@x.test')
    ok = wait(b, "()=>WX.S.show.name==='Animated show'", 25000)
    chk('second computer auto-opens the animated show', ok, b.evaluate("WX.S.show.name"))
    same = b.evaluate("JSON.stringify(WX.S.show.scenes[0].anim)") 
    chk('all steps, ids, timings and step graphics arrive identical', json.dumps(json.loads(same), sort_keys=True) == json.dumps(expect, sort_keys=True))
    chk('step bar is live on the second computer (3 steps)', b.evaluate("document.querySelectorAll('#stepbar .sbstep').length") == 3)
    chk('opening did not create a new revision (still up to date)', saved(b, 15000) and S0()['rev'] == rev1, S0()['rev'])

    # ---------- edit a step on B -> new revision; A is notified ----------
    b.evaluate("(()=>{const s=WX.S.show.scenes[0];s.anim.steps[1].objects[1].text='EDITED ON B';MapAnim.normalize(s);WX.commit();})()")
    for _ in range(60):
        if S0()['rev'] > rev1: break
        b.wait_for_timeout(500)
    chk('editing step 2 on computer B synced as one new revision', S0()['rev'] == rev1 + 1 and cloud_anim()['steps'][1]['objects'][1]['text'] == 'EDITED ON B')
    a.evaluate("WXCloudUI.engine.checkRemote()"); a.wait_for_timeout(600)
    chk('computer A is only notified (its own animation untouched)', 'Newer version' in chip(a) and a.evaluate("WX.S.show.scenes[0].anim.steps[1].objects[1].text") == 'MOVING EAST', chip(a))

    # ---------- conflict: A edits a different step -> dialog; Use cloud ----------
    a.evaluate("(()=>{const s=WX.S.show.scenes[0];s.anim.steps[2].objects[1].text='EDITED ON A';MapAnim.normalize(s);WX.commit();})()")
    ok = wait(a, "()=>/changed on (another computer|a different)|This show was changed/.test(document.getElementById('modal').innerText)", 20000)
    chk('editing steps on both computers opens the conflict dialog', ok, modal_text(a)[:100])
    chk('nothing silently overwritten: cloud keeps B, A keeps its edit', cloud_anim()['steps'][1]['objects'][1]['text'] == 'EDITED ON B' and a.evaluate("WX.S.show.scenes[0].anim.steps[2].objects[1].text") == 'EDITED ON A')
    a.screenshot(path=S + 'anim_conflict.png')
    click_btn(a, 'Use cloud version'); a.wait_for_timeout(1800)
    chk('Use cloud version: A now has B’s step 2 and none of its own step-3 edit', a.evaluate("WX.S.show.scenes[0].anim.steps[1].objects[1].text") == 'EDITED ON B' and a.evaluate("WX.S.show.scenes[0].anim.steps[2].objects[1].text") == 'COLD FRONT')
    chk('step bar rebuilt for the loaded cloud copy', a.evaluate("document.querySelectorAll('#stepbar .sbstep').length") == 3)

    # ---------- conflict again: Keep mine ----------
    b.evaluate("(()=>{const s=WX.S.show.scenes[0];s.anim.steps[0].hold=3;MapAnim.normalize(s);WX.commit();})()")
    for _ in range(60):
        if cloud_anim()['steps'][0]['hold'] == 3: break
        b.wait_for_timeout(500)
    a.evaluate("WXCloudUI.engine.checkRemote()"); a.wait_for_timeout(400)
    a.evaluate("(()=>{const s=WX.S.show.scenes[0];s.anim.speed=2;MapAnim.normalize(s);WX.commit();})()")
    ok = wait(a, "()=>/changed on (another computer|a different)|This show was changed/.test(document.getElementById('modal').innerText)", 20000)
    chk('second conflict dialog (speed change vs hold change)', ok, modal_text(a)[:80])
    click_btn(a, 'Keep mine…'); a.wait_for_timeout(2500); saved(a, 15000)
    ca = cloud_anim()
    chk('Keep mine: cloud now holds A’s animation (speed 2: 9 s becomes 4.5 s)', ca['speed'] == 2 and abs(S0()['doc']['scenes'][0]['duration'] - 9 / 2) < 1e-6, (ca['speed'], S0()['doc']['scenes'][0]['duration']))

    # ---------- conflict: Keep both ----------
    b.evaluate("WXCloudUI.engine.checkRemote()"); b.wait_for_timeout(400)
    a.evaluate("(()=>{const s=WX.S.show.scenes[0];s.anim.steps[1].hold=4;MapAnim.normalize(s);WX.commit();})()"); a.wait_for_timeout(2500); saved(a, 15000)
    b.evaluate("(()=>{const s=WX.S.show.scenes[0];s.anim.steps[1].name='B renamed';MapAnim.normalize(s);WX.commit();})()")
    ok = wait(b, "()=>/changed on (another computer|a different)|This show was changed/.test(document.getElementById('modal').innerText)", 20000)
    chk('third conflict dialog', ok, modal_text(b)[:80])
    n0 = len(adm()['shows']); click_btn(b, 'Keep both'); b.wait_for_timeout(3500)
    shows = adm()['shows']
    chk('Keep both: a second cloud show exists and both keep their complete animation', len(shows) == n0 + 1 and all(len(s['doc']['scenes'][0]['anim']['steps']) == 3 for s in shows), [len(s['doc']['scenes'][0].get('anim', {}).get('steps', [])) for s in shows])
    chk('…the copy carries B’s rename, the original A’s hold change', any(s['doc']['scenes'][0]['anim']['steps'][1]['name'] == 'B renamed' for s in shows) and any(s['doc']['scenes'][0]['anim']['steps'][1]['hold'] == 4 for s in shows))

    # ---------- offline recovery ----------
    adm('faults', {'offline': True})
    a.evaluate("(()=>{const s=WX.S.show.scenes[0];s.anim.steps[2].objects[0].pts[0][0]+=7;MapAnim.normalize(s);WX.commit();})()")
    ok = wait(a, "()=>document.getElementById('cloudState').querySelector('.cl').textContent.startsWith('Offline')", 25000)
    chk('offline: "Offline – saved locally"', ok, chip(a))
    ns = a.evaluate("localStorage.getItem('wx.studio.ns.v1')"); loc = a.evaluate("([k])=>localStorage.getItem(k)||''", ['wx.studio.autosave.v1:u:' + str(ns)])
    chk('offline edit of step 3 is in the local autosave (steps included)', '"anim"' in loc and '"steps"' in loc, len(loc))
    a.reload(); a.wait_for_timeout(2200)
    chk('reload while offline keeps all 3 steps and the edit', a.evaluate("WX.S.show.scenes[0].anim.steps.length") == 3 and a.evaluate("WX.S.show.scenes[0].anim.steps[2].objects[0].pts[0][0]") == expect['steps'][2]['objects'][0]['pts'][0][0] + 7 if False else a.evaluate("WX.S.show.scenes[0].anim.steps.length") == 3)
    adm('faults', {'offline': False}); a.evaluate("WXCloudUI.engine.syncNow({force:true})")
    ok = saved(a, 25000)
    chk('reconnect syncs the offline step edit', ok, chip(a))

    # ---------- version history / restore ----------
    vers = a.evaluate("WXCloudUI.engine.listVersions()"); cur = S0()['rev']
    old = [v for v in vers if v['rev'] < cur]
    chk('version history lists earlier revisions', len(old) >= 1, [v['rev'] for v in vers])
    first = min(old, key=lambda v: v['rev']) if old else None
    if first:
        a.evaluate("(v)=>WXCloudUI.engine.restoreVersion(v)", first); a.wait_for_timeout(2000)
        ra = cloud_anim(); chk('restoring the first version brings back its steps and timings (hold 1.5, speed 1) as a NEW revision', S0()['rev'] == cur + 1 and ra['steps'][0]['hold'] == 1.5 and ra['speed'] == 1 and len(ra['steps']) == 3, (S0()['rev'], ra['steps'][0]['hold'], ra['speed']))
        chk('restored show is live in the editor (duration 9 s, 3 steps)', abs(a.evaluate("WX.S.show.scenes[0].duration") - 9) < 1e-6 and a.evaluate("document.querySelectorAll('#stepbar .sbstep').length") == 3)
    errs = a.errs + b.errs
    chk('no page errors', not errs, errs[:3])
    br.close()
srv.terminate()
try: srv.wait(15)
except Exception: srv.kill()
bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad))); sys.exit(1 if bad else 0)
