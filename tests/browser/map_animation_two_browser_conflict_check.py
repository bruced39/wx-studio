"""Two-computer simulation of the map animation cloud conflict (ChatGPT release item 3).
Two INDEPENDENT browser processes (separate profiles, storage and sessions - each stands for one physical computer) sign in to the same
cloud account against the in-memory fake Supabase (or the REAL SQL with WX_BACKEND=pg + WX_MIGRATIONS_DIR). A DISPOSABLE animated show is used:
  1. A and B open the same animated show.   2. A edits STEP 2 and the cloud save is confirmed.   3. B edits STEP 3 without reloading.
  4. The cloud conflict dialog must appear on B.   5. B chooses "Keep both".
  6. Both complete animations stay saved with the right step positions, objects, durations and names.   7. Neither side silently overwrote the other.
No existing show is touched: the test cloud starts empty and the test asserts it only ever holds the disposable show and its Keep-both copy.
Only Chromium is installed in CI; for the final user test use Firefox + Chrome (docs/MAP_ANIMATION_TWO_BROWSER_TEST.md).
Usage: python3 wxbuild.py && python3 tests/browser/map_animation_two_browser_conflict_check.py [screenshot_dir]   Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import json, os, sys, tempfile, pathlib, subprocess, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxanim2b_')) + '/'
os.makedirs(S, exist_ok=True)
PORT = 8797; LOCAL = 'http://127.0.0.1:%d' % PORT; FAKE = 'https://fake-project.supabase.test'
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
NAME = 'ZZ DISPOSABLE ANIM CONFLICT'
MKSHOW = r"""(name)=>{const E=WX.E;
  const bg={type:'mapbox',mbStyle:'broadcast',broadcastBase:'satellite',proj:'mercator',theme:'dark',region:'eastma',view:null,view2:null,grad:'sky',color:'#101820',asset:null,dim:0,kenburns:false}; MB.ensureConfig(bg);
  const f=E.newObject('front',{id:'f1',geo:true,kind:'cold',pts:[[430,300],[450,290],[470,285],[490,290],[510,300],[530,312]]});
  const t=E.newObject('text',{id:'t1',geo:true,x:480,y:260,text:'COLD FRONT',size:60}); const h=E.newObject('hl',{id:'h1',geo:true,x:520,y:330,kind:'H',value:'1030',size:160});
  const a=E.newScene({name:'Animated',duration:6,bg,title:{show:false,text:'',sub:''},objects:[f,t,h]});
  const b=E.newScene({name:'Plain',duration:4,bg:{type:'solid',color:'#204060',kenburns:false},title:{show:false,text:'',sub:''},objects:[E.newObject('text',{id:'p1',text:'PLAIN',x:960,y:540})]});
  WX.loadShow({name,accent:'#2f9bff',scenes:[a,b],assets:{},mbMigrated:1});
  const s=WX.S.show.scenes[0]; MapAnim.enable(s); MapAnim.setStep(s,0,{hold:1.5}); MapAnim.addStep(s,0,{hold:1,dur:2,simplify:true}); MapAnim.addStep(s,1,{hold:2,dur:2.5,simplify:true});
  s.anim.steps[1].objects[0].pts=s.anim.steps[1].objects[0].pts.map(p=>[p[0]+30,p[1]+10]); s.anim.steps[1].objects[1].text='MOVING EAST';
  s.anim.steps[1].name='Step two'; s.anim.steps[2].name='Step three';
  MapAnim.normalize(s); WX.commit();
  return JSON.stringify(s.anim);}"""
def wait(pg, js, t=20000):
    try: pg.wait_for_function(js, timeout=t); return True
    except Exception: return False
def chip(pg): return pg.evaluate("(()=>{const c=document.getElementById('cloudState');return c.hidden?'(hidden)':c.querySelector('.cl').textContent})()")
def modal_text(pg): return pg.evaluate("document.getElementById('modalBg').style.display==='none'?'':document.getElementById('modal').innerText")
def click_btn(pg, text, scope='#modal'):
    return pg.evaluate("([t,s])=>{const b=[...document.querySelectorAll(s+' button')].find(x=>x.textContent.trim()===t);if(!b)return false;b.click();return true}", [text, scope])
def new_computer(label):
    """a complete, separate browser PROCESS with its own profile/storage = one computer"""
    pw_browser = P.chromium.launch(args=['--no-sandbox'])
    ctx = pw_browser.new_context(viewport={'width': 1700, 'height': 960}); ctx.add_init_script(CONF); ctx.route(FAKE + '/**', route)
    pg = ctx.new_page(); pg.label = label; pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(1800); return pw_browser, pg
def sign_in(pg, email):
    pg.evaluate("document.getElementById('cloudState').click()"); pg.wait_for_timeout(300)
    pg.fill('#modal input[type=email]', email); pg.fill('#modal input[type=password]', 'pw'); click_btn(pg, 'Sign in'); pg.wait_for_timeout(900)
def saved(pg, t=25000): return wait(pg, "()=>document.getElementById('cloudState').querySelector('.cl').textContent==='Saved to cloud'", t)
def shows(): return adm()['shows']
def steps_of(doc, i=0): return doc['scenes'][i]['anim']['steps']
def sig(steps):
    """what matters of a step: id, name, hold, dur, object ids, and every object's geometry/text"""
    return [(s.get('id'), s.get('name'), s.get('hold'), s.get('dur'), json.dumps(s.get('objects'), sort_keys=True)) for s in steps]

with sync_playwright() as P:
    ba, a = new_computer('A'); bb = None
    base = json.loads(a.evaluate(MKSHOW, NAME)); a.wait_for_timeout(500); a.reload(); a.wait_for_timeout(1800)
    sign_in(a, 'a@x.test'); click_btn(a, 'Continue'); a.wait_for_timeout(2500)
    chk('A: disposable animated show created and saved to the cloud (one show in a clean test cloud)', saved(a) and len(shows()) == 1 and shows()[0]['doc']['name'] == NAME, chip(a))
    SID = shows()[0]['id']; rev1 = shows()[0]['rev']
    base_steps = steps_of(shows()[0]['doc'])
    chk('base animation has 3 steps with the expected names/timings', [s['name'] for s in base_steps][1:] == ['Step two', 'Step three'] and len(base_steps) == 3, [s['name'] for s in base_steps])

    # ---------- 1. second, fully independent browser opens the same show ----------
    bb, b = new_computer('B'); sign_in(b, 'a@x.test')
    chk('B (separate browser process and profile) opens the same show', wait(b, "()=>WX.S.show.name==='%s'" % NAME, 25000), b.evaluate("WX.S.show.name"))
    chk('B starts with the identical animation (all 3 steps)', sig(b.evaluate("WX.S.show.scenes[0].anim.steps")) == sig(base_steps))

    # ---------- 2. A edits STEP 2 and the cloud save is confirmed ----------
    a.evaluate("""(()=>{const s=WX.S.show.scenes[0];const st=s.anim.steps[1];st.name='A edited step two';st.hold=3;
      st.objects[0].pts=st.objects[0].pts.map(p=>[p[0]+20,p[1]-5]);MapAnim.normalize(s);WX.commit();})()""")
    for _ in range(60):
        if shows()[0]['rev'] > rev1: break
        a.wait_for_timeout(500)
    ok = saved(a, 20000); A_doc = shows()[0]['doc']; A_rev = shows()[0]['rev']
    chk('A: step-2 edit confirmed in the cloud ("Saved to cloud", exactly one new revision)', ok and A_rev == rev1 + 1, (chip(a), A_rev, rev1))
    chk('A: the cloud step 2 carries A’s name, hold and moved front; step 3 still the original',
        steps_of(A_doc)[1]['name'] == 'A edited step two' and steps_of(A_doc)[1]['hold'] == 3 and steps_of(A_doc)[1]['objects'][0]['pts'][0][0] == base_steps[1]['objects'][0]['pts'][0][0] + 20
        and json.dumps(steps_of(A_doc)[2], sort_keys=True) == json.dumps(base_steps[2], sort_keys=True))

    # ---------- 3. B edits STEP 3 WITHOUT reloading ----------
    chk('B has NOT seen A’s edit (no reload, still on the old step 2)', b.evaluate("WX.S.show.scenes[0].anim.steps[1].name") == 'Step two', b.evaluate("WX.S.show.scenes[0].anim.steps[1].name"))
    b.evaluate("""(()=>{const s=WX.S.show.scenes[0];const st=s.anim.steps[2];st.name='B edited step three';st.dur=4;
      st.objects[1].text='B WAS HERE';MapAnim.normalize(s);WX.commit();})()""")

    # ---------- 4. conflict dialog ----------
    ok = wait(b, "()=>/changed on (another computer|a different)|This show was changed/.test(document.getElementById('modal').innerText)", 25000)
    chk('B: the cloud conflict dialog appears', ok, modal_text(b)[:120])
    b.screenshot(path=S + 'two_browser_conflict.png')
    chk('dialog offers Keep both / Use cloud version / Keep mine…', all(any(x.strip() == t for x in b.evaluate("[...document.querySelectorAll('#modal button')].map(x=>x.textContent)")) for t in ('Keep both', 'Use cloud version', 'Keep mine…')))
    chk('nothing overwritten yet: the cloud still holds exactly A’s version, B still holds its own edit',
        shows()[0]['rev'] == A_rev and json.dumps(shows()[0]['doc'], sort_keys=True) == json.dumps(A_doc, sort_keys=True) and b.evaluate("WX.S.show.scenes[0].anim.steps[2].name") == 'B edited step three')

    # ---------- 5. Keep both ----------
    n0 = len(shows()); click_btn(b, 'Keep both'); b.wait_for_timeout(3500)
    sh = shows()
    chk('Keep both: exactly one additional cloud show, nothing deleted', len(sh) == n0 + 1 == 2 and {s['id'] for s in sh} >= {SID}, [s['doc']['name'] for s in sh])
    orig = next(s for s in sh if s['id'] == SID); copy = next(s for s in sh if s['id'] != SID)
    chk('the original show was NOT touched by B (same revision and byte-identical document as A saved)', orig['rev'] == A_rev and json.dumps(orig['doc'], sort_keys=True) == json.dumps(A_doc, sort_keys=True), (orig['rev'], A_rev))
    chk('the copy is a clearly named separate show', copy['doc']['name'] != NAME and NAME in copy['doc']['name'], copy['doc']['name'])

    # ---------- 6. both complete animations, with correct positions/objects/durations/names ----------
    oa, ca = steps_of(orig['doc']), steps_of(copy['doc'])
    chk('original: complete animation, 3 steps, same step ids as the base', [s['id'] for s in oa] == [s['id'] for s in base_steps], [s['id'] for s in oa])
    chk('copy: complete animation, 3 steps, same step ids as the base', [s['id'] for s in ca] == [s['id'] for s in base_steps], [s['id'] for s in ca])
    chk('original step 2 = A’s edit (name, hold, front moved +20/-5)', oa[1]['name'] == 'A edited step two' and oa[1]['hold'] == 3 and oa[1]['objects'][0]['pts'] == [[p[0] + 20, p[1] - 5] for p in base_steps[1]['objects'][0]['pts']])
    chk('original step 3 = unchanged (name, duration, text) – none of B’s edit leaked in', oa[2]['name'] == 'Step three' and oa[2]['dur'] == base_steps[2]['dur'] and oa[2]['objects'][1]['text'] != 'B WAS HERE')
    chk('copy step 3 = B’s edit (name, dur 4, text)', ca[2]['name'] == 'B edited step three' and ca[2]['dur'] == 4 and ca[2]['objects'][1]['text'] == 'B WAS HERE')
    chk('copy step 2 = B’s unchanged base (A’s edit is not in the copy)', ca[1]['name'] == 'Step two' and ca[1]['hold'] == base_steps[1]['hold'] and json.dumps(ca[1], sort_keys=True) == json.dumps(base_steps[1], sort_keys=True))
    chk('both: step 1 (the starting scene) and the object ids of steps 2 and 3 are intact', all(json.dumps(x[0], sort_keys=True) == json.dumps(base_steps[0], sort_keys=True) for x in (oa, ca)) and all([o['id'] for o in x[i]['objects']] == [o['id'] for o in base_steps[i]['objects']] for x in (oa, ca) for i in (1, 2)))
    chk('derived scene durations are right: original 1.5+2+3+2.5+2 = 11 s (A’s longer hold), copy 1.5+2+1+4+2 = 10.5 s (B’s longer step 3)',
        abs(orig['doc']['scenes'][0]['duration'] - 11) < 1e-6 and abs(copy['doc']['scenes'][0]['duration'] - 10.5) < 1e-6, (orig['doc']['scenes'][0]['duration'], copy['doc']['scenes'][0]['duration']))
    chk('both: the plain second scene is intact and has no animation', all(x['doc']['scenes'][1]['name'] == 'Plain' and 'anim' not in x['doc']['scenes'][1] and x['doc']['scenes'][1]['objects'][0]['id'] == 'p1' for x in (orig, copy)))

    # ---------- 7. neither browser silently overwrites the other afterwards ----------
    a.evaluate("WXCloudUI.engine.checkRemote()"); a.wait_for_timeout(1200)
    chk('A still holds its own animation (no silent overwrite from B)', a.evaluate("WX.S.show.scenes[0].anim.steps[1].name") == 'A edited step two' and a.evaluate("WX.S.show.scenes[0].anim.steps[2].name") == 'Step three')
    chk('B shows its own preserved version (its step-3 edit is live in the editor)', b.evaluate("WX.S.show.scenes[0].anim.steps[2].name") == 'B edited step three' and b.evaluate("WX.S.show.scenes[0].anim.steps[2].objects[1].text") == 'B WAS HERE')
    a.wait_for_timeout(1500)
    after = {s['id']: (s['rev'], json.dumps(s['doc'], sort_keys=True)) for s in shows()}
    chk('after both browsers settle the cloud is stable (no further revisions, no extra shows)', len(after) == 2 and after[SID][0] == A_rev, [(k, v[0]) for k, v in after.items()])
    # reload both computers: what each opens is what the cloud holds
    a.reload(); a.wait_for_timeout(2500); b.reload(); b.wait_for_timeout(2500)
    chk('after reloading both browsers every animation is still complete (3 steps each)', a.evaluate("WX.S.show.scenes[0].anim.steps.length") == 3 and b.evaluate("WX.S.show.scenes[0].anim.steps.length") == 3)
    errs = a.errs + b.errs
    chk('no page errors in either browser', not errs, errs[:3])
    ba.close(); bb.close()
srv.terminate()
try: srv.wait(15)
except Exception: srv.kill()
bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad))); sys.exit(1 if bad else 0)
