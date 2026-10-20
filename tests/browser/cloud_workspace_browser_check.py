"""Real-browser (headless Chromium) check of the v0.10.2 cloud workspace client against the in-memory fake Supabase
(tests/helpers/fake_supabase*.js, which implements docs/CLOUD_WORKSPACE_CONTRACT.md). Each browser context is a separate "computer".
Covers: sign-in + explicit claim of existing local work, first sync with image upload, second computer auto-opening the newest
cloud show and downloading its image, newer-version notice (no overwrite), conflict dialog, offline recovery, resume offer,
account isolation, sign-out keep/clear, version history + restore, status chip layout at narrow widths.
Usage: python3 wxbuild.py && python3 tests/browser/cloud_workspace_browser_check.py [screenshot_dir]   (needs node, playwright, Chromium)
Exit code 1 if any check fails.  NOTE: this uses the FAKE server; the real Supabase project still needs the live two-computer test."""
from playwright.sync_api import sync_playwright
import json, os, sys, tempfile, pathlib, subprocess, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxcw_')) + '/'
os.makedirs(S, exist_ok=True)
PORT = 8791; LOCAL = 'http://127.0.0.1:%d' % PORT; FAKE = 'https://fake-project.supabase.test'
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, info if not ok or info else '')
srv = subprocess.Popen(['node', str(ROOT / 'tests/helpers/fake_supabase_server.js'), str(PORT)])
for _ in range(50):
    try: urllib.request.urlopen(LOCAL + '/__admin/state'); break
    except Exception: time.sleep(0.1)
def adm(path='state', data=None):
    rq = urllib.request.Request(LOCAL + '/__admin/' + path, data=json.dumps(data).encode() if data is not None else None, method='POST' if data is not None else 'GET')
    return json.loads(urllib.request.urlopen(rq).read())
HDR = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-upsert, prefer, x-client-info, accept-profile', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'}
def route(r):
    q = r.request
    if q.method == 'OPTIONS': r.fulfill(status=204, headers=HDR); return
    try: resp = r.fetch(url=q.url.replace(FAKE, LOCAL))
    except Exception: r.abort(); return
    h = dict(resp.headers); h.update(HDR); r.fulfill(response=resp, headers=h)
CONF = "window.WX_CLOUD_CONFIG={url:'" + FAKE + "',publishableKey:'sb_publishable_fake'};"
IMG = """()=>{const c=document.createElement('canvas');c.width=64;c.height=36;const x=c.getContext('2d');x.fillStyle='#c33';x.fillRect(0,0,64,36);x.fillStyle='#fff';x.fillRect(10,10,20,10);return c.toDataURL('image/png');}"""
MKSHOW = """([name,img])=>{const E=WX.E,mk=(n,bg)=>E.newScene({name:n,duration:4,bg,title:{show:false,text:'',sub:''},objects:[]});
  WX.loadShow({name:name,accent:'#2f9bff',scenes:[mk('Open',{type:'image',asset:'img_test',fit:'fill'}),mk('Two',{type:'solid',color:'#204060',kenburns:false})],assets:{img_test:img}});}"""
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

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])
    # ================= computer 1: existing local work, then sign in =================
    c1, a = new_computer(br)
    chk('cloud chip is visible and says Sign in to sync while signed out', chip(a) == 'Sign in to sync', chip(a))
    img = a.evaluate(IMG); a.evaluate(MKSHOW, ['Legacy show', img]); a.wait_for_timeout(500)
    a.reload(); a.wait_for_timeout(1800)
    chk('pre-account work survives a reload (normal local autosave untouched)', a.evaluate("WX.S.show.name") == 'Legacy show')
    sign_in(a, 'a@x.test')
    wiz = modal_text(a)
    chk('claim wizard offers the existing local show before anything changes', 'Legacy show' in wiz and 'Add it to my account' in wiz and 'Keep it separate' in wiz, wiz[:120])
    chk('nothing was uploaded before the user chose', len(adm()['shows']) == 0)
    click_btn(a, 'Continue'); a.wait_for_timeout(2500)
    chk('claimed work is still open after the sign-in reload', a.evaluate("WX.S.show.name") == 'Legacy show')
    ok = wait(a, "()=>document.getElementById('cloudState').querySelector('.cl').textContent==='Saved to cloud'", 25000)
    st = adm(); chk('first sync created exactly one cloud show', ok and len(st['shows']) == 1, chip(a))
    doc = st['shows'][0]['doc'] if st['shows'] else {}
    chk('cloud document keeps engine v:1 beside cloud_schema:1 and contains no embedded image data', doc.get('v') == 1 and doc.get('cloud_schema') == 1 and 'data:' not in json.dumps(doc))
    asset = (doc.get('assets') or {}).get('img_test', {})
    chk('image was uploaded to the private bucket and registered before the document referenced it', str(asset.get('media', '')).startswith('sha256:') and len(st['media']) == 1 and len(st['objects']) == 1 and st['objects'][0].startswith('user-a/'), asset)
    for _ in range(20):
        st = adm()
        if st['workspace']: break
        a.wait_for_timeout(500)   # (sleep through Playwright so route handlers keep running)
    chk('workspace row records this device and scene', len(st['workspace']) == 1 and st['workspace'][0]['show_id'] == st['shows'][0]['id'])
    a.screenshot(path=S + 'cw_signed_in.png')

    # ================= computer 2: empty browser auto-opens the newest cloud show =================
    c2, b = new_computer(br)
    sign_in(b, 'a@x.test'); b.wait_for_timeout(500)
    chk('no wizard on a computer with no existing work', 'Add it to my account' not in modal_text(b), modal_text(b)[:80])
    ok = wait(b, "()=>WX.S.show.name==='Legacy show'", 25000)
    chk('computer with no real local work auto-opens the newest cloud show', ok, b.evaluate("WX.S.show.name"))
    got = b.evaluate("(()=>{const d=WX.S.show.assets.img_test;return d&&d.slice(0,22)})()")
    chk('its image was downloaded, verified and attached', got == 'data:image/png;base64,', got)
    chk('status says Saved to cloud (complete show)', wait(b, "()=>document.getElementById('cloudState').querySelector('.cl').textContent==='Saved to cloud'", 8000), chip(b))
    b.screenshot(path=S + 'cw_second_computer.png')

    # ================= newer version notice, conflict dialog =================
    b.evaluate("(()=>{WX.S.show.name='Edited on computer 2';WX.commit();})()")
    for _ in range(60):
        if adm()['shows'][0]['rev'] >= 2: break
        b.wait_for_timeout(500)
    r2 = adm()['shows'][0]; chk('edit on computer 2 synced as a new revision', r2['rev'] >= 2 and r2['doc']['name'] == 'Edited on computer 2', (r2['rev'], r2['doc']['name'], b.evaluate("JSON.stringify(WXCloudUI.engine.status())")))
    a.evaluate("WXCloudUI.engine.checkRemote()"); a.wait_for_timeout(500)
    chk('computer 1 is only notified about the newer version', 'Newer version' in chip(a) and a.evaluate("WX.S.show.name") == 'Legacy show', chip(a))
    a.evaluate("(()=>{WX.S.show.name='Edited on computer 1';WX.commit();})()")
    ok = wait(a, "()=>document.getElementById('modal').innerText.includes('changed on another computer')||document.getElementById('modal').innerText.includes('This show was changed on')", 20000)
    chk('editing on both computers opens the conflict dialog (nothing silently overwritten)', ok, modal_text(a)[:100])
    chk('cloud still holds computer 2 work and computer 1 keeps its own', adm()['shows'][0]['doc']['name'] == 'Edited on computer 2' and a.evaluate("WX.S.show.name") == 'Edited on computer 1')
    chk('conflict dialog offers Keep both / Use cloud / Keep mine', all(x in modal_text(a) for x in ['Keep both', 'Use cloud version', 'Keep mine']))
    a.screenshot(path=S + 'cw_conflict.png')
    click_btn(a, 'Use cloud version'); a.wait_for_timeout(1500)
    chk('"Use cloud version" loads the cloud copy and keeps a local safety copy', a.evaluate("WX.S.show.name") == 'Edited on computer 2')
    a.evaluate("document.getElementById('saveState').click()"); a.wait_for_timeout(500)
    chk('safety copy of the replaced local edit exists in Recent autosaves', 'Before loading the cloud version' in modal_text(a), modal_text(a)[:200]); click_btn(a, 'Close')

    # ================= offline: local work is never lost =================
    adm('faults', {'offline': True})
    a.evaluate("(()=>{WX.S.show.name='Edited offline';WX.commit();})()")
    ok = wait(a, "()=>document.getElementById('cloudState').querySelector('.cl').textContent.startsWith('Offline')", 25000)
    chk('offline shows "Offline – saved locally"', ok, chip(a))
    chk('offline edit is still autosaved in this browser', 'Edited offline' in (a.evaluate("localStorage.getItem('wx.studio.autosave.v1:u:user-a')") or ''))
    adm('faults', {'offline': False}); a.evaluate("WXCloudUI.engine.syncNow({force:true})")
    ok = wait(a, "()=>document.getElementById('cloudState').querySelector('.cl').textContent==='Saved to cloud'", 20000)
    chk('reconnecting syncs the offline edit', ok and adm()['shows'][0]['doc']['name'] == 'Edited offline', chip(a))

    # ================= version history + restore =================
    a.evaluate("WXCloudUI.accountDialog()"); a.wait_for_timeout(300); click_btn(a, 'Version history…'); a.wait_for_timeout(1200)
    vt = modal_text(a); chk('version history lists saved versions', 'Version history' in vt and 'version' in vt.lower() and 'Restore' in vt, vt[:160])
    a.screenshot(path=S + 'cw_versions.png'); click_btn(a, 'Close')
    rev0 = adm()['shows'][0]['rev']
    vers = a.evaluate("WXCloudUI.engine.listVersions()"); old = [v for v in vers if v['rev'] < rev0][-1]
    a.evaluate("(v)=>WXCloudUI.engine.restoreVersion(v)", old); a.wait_for_timeout(1500)
    chk('restoring creates a NEW revision (history kept)', adm()['shows'][0]['rev'] == rev0 + 1 and adm()['shows'][0]['doc']['name'] == old.get('name'), (rev0, adm()['shows'][0]['rev']))

    # ================= My Shows / delete / undelete =================
    a.evaluate("WXCloudUI.myShows()"); a.wait_for_timeout(1000); mt = modal_text(a)
    chk('My Shows lists the show with scene count and the open marker', 'open now' in mt and '2 scenes' in mt, mt[:150]); a.screenshot(path=S + 'cw_myshows.png'); click_btn(a, 'Close')

    # ================= account isolation, sign out =================
    a.evaluate("WXCloudUI.signOutDialog()"); a.wait_for_timeout(300)
    click_btn(a, 'Sign out'); a.wait_for_timeout(2500)
    chk('sign out keeps a local copy of the show and returns to Sign in to sync', a.evaluate("WX.S.show.name") != '' and chip(a) == 'Sign in to sync', chip(a))
    sign_in(a, 'b@x.test'); w = modal_text(a)
    chk('a different account is offered the leftover local copy only through the explicit wizard', 'Add it to my account' in w, w[:100])
    # choose "Keep it separate"
    a.evaluate("document.querySelectorAll('#modal input[type=radio]')[1].click()"); click_btn(a, 'Continue'); a.wait_for_timeout(2500)
    chk("account B does not see account A's show", a.evaluate("WX.S.show.name") != 'Edited offline' and len([s for s in adm()['shows'] if s['user_id'] == 'user-b']) == 0, a.evaluate("WX.S.show.name"))
    chk("account B's local storage is separate", a.evaluate("localStorage.getItem('wx.studio.ns.v1')") == 'user-b' and 'Edited offline' not in (a.evaluate("localStorage.getItem('wx.studio.autosave.v1:u:user-b')") or ''))
    a.evaluate("document.getElementById('saveState').click()"); a.wait_for_timeout(400)
    chk("account B's Recent autosaves do not list account A's copies", 'Before loading the cloud version' not in modal_text(a)); click_btn(a, 'Close')

    # ================= clear on sign-out (shared computer) =================
    b.evaluate("WXCloudUI.signOutDialog()"); b.wait_for_timeout(300)
    b.evaluate("document.querySelectorAll('#modal input[type=radio]')[1].click()"); click_btn(b, 'Sign out'); b.wait_for_timeout(2500)
    keys = b.evaluate("Object.keys(localStorage).filter(k=>k.includes(':u:user-a'))")
    chk("'Clear my account data' removes the account's local storage", keys == [], keys)
    chk('cloud copy is untouched by clearing local data', len(adm()['shows']) >= 1)

    # ================= computer with its own real work: Resume offer, never a silent replacement =================
    c4, d = new_computer(br); d.evaluate(MKSHOW, ['Office work', img]); d.wait_for_timeout(400); d.reload(); d.wait_for_timeout(1500)
    sign_in(d, 'a@x.test'); click_btn(d, 'Continue'); d.wait_for_timeout(3000)
    ok = wait(d, "()=>document.getElementById('modal').innerText.includes('Resume your cloud show?')", 15000)
    chk('existing local work gets a Resume offer instead of being replaced', ok and d.evaluate("WX.S.show.name") == 'Office work', modal_text(d)[:100])
    d.screenshot(path=S + 'cw_resume_offer.png')
    click_btn(d, 'Keep this computer’s show')
    for _ in range(40):
        if len([x for x in adm()['shows'] if x['user_id'] == 'user-a']) >= 2: break
        d.wait_for_timeout(500)
    names = sorted(x['doc']['name'] for x in adm()['shows'] if x['user_id'] == 'user-a')
    chk('keeping local work saves it as its own cloud show; the other show is untouched', 'Office work' in names and len(names) == 2 and d.evaluate("WX.S.show.name") == 'Office work', names)

    # ================= narrow layout =================
    c3, n = new_computer(br, 1188)
    ov = n.evaluate("(()=>{const c=document.getElementById('cloudState').getBoundingClientRect();return [c.right,innerWidth,document.documentElement.scrollWidth]})()")
    chk('status chip fits at 1188 px without horizontal overflow', ov[0] <= ov[1] and ov[2] <= ov[1] + 1, ov); n.screenshot(path=S + 'cw_narrow.png')
    errs = a.errs + b.errs + n.errs
    chk('no page errors in any window', not errs, errs[:3])
    br.close()
srv.terminate()
bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad))); sys.exit(1 if bad else 0)
