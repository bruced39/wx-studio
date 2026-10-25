"""Real-browser regression (v0.10.2 stuck-sync fix): a cloud request that never answers must not leave "Sync now" spinning forever.
Reproduces the live-test report: computer A edits offline, computer B saves a newer version, A reconnects (the browser 'online' event starts a forced
sync) and the save request gets no answer. Expected: the request is stopped by the timeout, Sync now shows 'still working' then a clear
"the cloud did not answer" message (local edit intact, nothing lost, never 'Saved to cloud'), and once the cloud answers again the REAL conflict is
shown and Keep mine works. Fake Supabase by default; WX_BACKEND=pg runs the real SQL.   Usage: python3 wxbuild.py && python3 tests/browser/cloud_sync_timeout_browser_check.py"""

from playwright.sync_api import sync_playwright
import json, pathlib, subprocess, sys, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
PORT = 8805; LOCAL = 'http://127.0.0.1:%d' % PORT; FAKE = 'https://fake-project.supabase.test'
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
CONF = "window.WX_CLOUD_TIMEOUT_MS=20000;window.WX_CLOUD_CONFIG={url:'" + FAKE + "',publishableKey:'sb_publishable_fake'};"
# network switches the test flips from Python: __delay (ms), __net = '' | offline | storage500 | save500
NET = """(()=>{const f=window.fetch.bind(window);window.__delay=0;window.__net='';window.__saves=0;
 window.fetch=async(u,o)=>{const url=String((u&&u.url)||u),m=((o&&o.method)||(u&&u.method)||'GET').toUpperCase();
  if(url.includes('fake-project')){ if(/rpc\\/wx_studio_save_show/.test(url))window.__saves++; if(window.__delay)await new Promise(r=>setTimeout(r,window.__delay));
   if(window.__net==='offline')throw new TypeError('Failed to fetch');
   if(window.__net==='hang'&&/rpc\\/wx_studio_save_show/.test(url))return new Promise(()=>{});
   if(window.__net==='storage500'&&/storage\\/v1\\/object\\//.test(url)&&m==='POST')return new Response(JSON.stringify({error:'Internal',message:'boom'}),{status:500,headers:{'content-type':'application/json'}});
   if(window.__net==='save500'&&/rpc\\/wx_studio_save_show/.test(url))return new Response(JSON.stringify({message:'database unavailable'}),{status:500,headers:{'content-type':'application/json'}});}
  return f(u,o)}})();"""
def wait(pg, js, t=25000):
    try: pg.wait_for_function(js, timeout=t); return True
    except Exception: return False
def ev(pg, js, *a): return pg.evaluate(js, *a) if a else pg.evaluate(js)
def chip(pg): return ev(pg, "(()=>{const c=document.getElementById('cloudState');return c.hidden?'(hidden)':c.querySelector('.cl').textContent})()")
def chiptitle(pg): return ev(pg, "document.getElementById('cloudState').title")
def click_btn(pg, text): return ev(pg, "t=>{const b=[...document.querySelectorAll('#modal button')].find(x=>x.textContent.trim()===t);if(!b)return false;b.click();return true}", text)
def new_computer(br):
    ctx = br.new_context(viewport={'width': 1700, 'height': 960}); ctx.add_init_script(CONF); ctx.add_init_script(NET); ctx.route(FAKE + '/**', route)
    pg = ctx.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(1800); return ctx, pg
def sign_in(pg):
    ev(pg, "document.getElementById('cloudState').click()"); pg.wait_for_timeout(300)
    pg.fill('#modal input[type=email]', 'a@x.test'); pg.fill('#modal input[type=password]', 'pw'); click_btn(pg, 'Sign in'); pg.wait_for_timeout(900)
def saved(pg, t=30000): return wait(pg, "()=>document.getElementById('cloudState').querySelector('.cl').textContent==='Saved to cloud'", t)
def open_dialog(pg): ev(pg, "document.getElementById('cloudState').click()"); pg.wait_for_selector('#modal [data-cloud-dialog]', timeout=5000)
def close_dialog(pg): ev(pg, "document.getElementById('modalBg').style.display!=='none'&&[...document.querySelectorAll('#modal button')].find(x=>x.textContent.trim()==='Close').click()"); pg.wait_for_timeout(100)
DLG = """()=>{const m=document.getElementById('modal');if(!m||document.getElementById('modalBg').style.display==='none')return null;const title=m.querySelector('h3')&&m.querySelector('h3').textContent;
 const tabs=[...m.querySelectorAll('[role=tab]')].map(b=>[b.dataset.tab,b.getAttribute('aria-selected')]);const l=m.querySelector('[data-cloud-list]');
 return {title,tabs,state:l&&l.dataset.state,tab:l&&l.dataset.tab,names:[...m.querySelectorAll('[data-show-id]')].map(r=>r.querySelector('.grow>div').textContent.replace('  · open now','')),
  buttons:[...m.querySelectorAll('[data-show-id] button')].map(b=>b.textContent),text:l&&l.textContent}}"""
RES = """()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');if(!r)return null;const c=r.querySelector('.cwres');const b=document.querySelector('#modal [data-cloud-sync]');
 return {kind:r.dataset.kind||'',title:c&&c.querySelector('b')?c.querySelector('b').textContent:'',text:c?c.textContent:'',spin:!!(c&&c.querySelector('.cwspin')),btnText:b&&b.textContent,btnDisabled:b&&b.disabled}}"""
def dlg(pg): return ev(pg, DLG)
def sres(pg): return ev(pg, RES)
def rename_sync(pg, name):
    ev(pg, "n=>{WX.S.show.name=n;document.getElementById('showName').value=n;document.getElementById('showName').dispatchEvent(new Event('change'));WX.commit()}", name)
    saved(pg); pg.wait_for_timeout(5500)


SYNC_DONE = "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind&&r.dataset.kind!=='busy'}"
with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])
    c1, a = new_computer(br); sign_in(a); a.wait_for_timeout(2500); saved(a)
    rename_sync(a, 'ZZ TIMEOUT 1')
    sid = [x['id'] for x in adm()['shows'] if x['name'] == 'ZZ TIMEOUT 1'][0]
    c2, b = new_computer(br); sign_in(b); b.wait_for_timeout(2500)
    open_dialog(b); wait(b, "()=>document.querySelector('#modal [data-cloud-list]').dataset.state==='ready'", 8000)
    ev(b, "()=>{const r=[...document.querySelectorAll('#modal [data-show-id]')].find(x=>x.textContent.includes('ZZ TIMEOUT 1'));const o=r&&[...r.querySelectorAll('button')].find(x=>x.textContent==='Open');if(o)o.click();else document.getElementById('modalBg').style.display='none'}")   # a second computer may open the only cloud show by itself
    chk('(setup) computer B opened the show', wait(b, "()=>WX.S.show.name==='ZZ TIMEOUT 1'", 15000)); saved(b)
    # A goes offline and edits; B saves a newer version
    ev(a, "window.__net='offline'"); ev(a, "()=>{WX.S.show.scenes[0].name='Offline edit A';WX.commit()}"); a.wait_for_timeout(1500)
    chk('(setup) A does not claim Saved to cloud while offline', chip(a) != 'Saved to cloud', chip(a))
    ev(b, "()=>{WX.S.show.scenes[0].name='Newer edit B';WX.commit()}"); b.wait_for_timeout(500); saved(b); b.wait_for_timeout(5500)
    chk('(setup) B saved a newer cloud version', [x['doc']['scenes'][0]['name'] for x in adm()['shows'] if x['id'] == sid][0] == 'Newer edit B')
    # A reconnects, but the save request gets no answer
    ev(a, "window.__net='hang'"); ev(a, "window.dispatchEvent(new Event('online'))"); a.wait_for_timeout(800)
    open_dialog(a); t0 = time.time(); click_btn(a, 'Sync now'); a.wait_for_timeout(500); rb = sres(a)
    chk('Sync now shows "Syncing…" with the spinner while the request hangs', rb and rb['kind'] == 'busy' and rb['spin'] and rb['btnDisabled'] is True, rb)
    slow = wait(a, "()=>!!document.querySelector('#modal [data-cloud-slow]')", 24000)
    chk('after ~15 s the dialog says it is taking longer than usual and that changes are safe', slow and (time.time() - t0) < 30, round(time.time() - t0, 1))
    done = wait(a, SYNC_DONE, 60000); r1 = sres(a); el = time.time() - t0
    chk('the spinner ENDS by itself (no reload needed) with "Not synced – the cloud did not answer"', done and r1['kind'] == 'error' and 'did not answer' in r1['title'], [r1, round(el, 1)])
    chk('…within the time limits (about two 20 s requests, never "over a minute")', el < 55, round(el, 1))
    chk('…the message says the changes are safe on this computer', 'safely saved on this computer' in (r1 or {}).get('text', ''), r1)
    chk('the Sync now button is usable again', r1 and r1['btnDisabled'] is False and r1['btnText'] == 'Sync now', r1)
    chk('the local offline edit is still on screen', ev(a, "WX.S.show.scenes[0].name") == 'Offline edit A')
    chk('the chip does NOT claim Saved to cloud', chip(a) != 'Saved to cloud', chip(a))
    chk('the cloud still has the newer version from B (nothing overwritten)', [x['doc']['scenes'][0]['name'] for x in adm()['shows'] if x['id'] == sid][0] == 'Newer edit B')
    # the cloud answers again: the real conflict appears, nothing was lost
    ev(a, "window.__net=''"); click_btn(a, 'Sync now')
    done = wait(a, "()=>[...document.querySelectorAll('#modal button')].some(x=>x.textContent.trim()==='Keep mine…')", 30000)
    chk('once the cloud answers, the real conflict dialog appears (Keep both / Use cloud version / Keep mine)', done and ev(a, "['Keep both','Use cloud version','Keep mine…'].every(t=>[...document.querySelectorAll('#modal button')].some(x=>x.textContent.trim()===t))"), None)
    chk('A still has its local edit and the cloud still has B\'s', ev(a, "WX.S.show.scenes[0].name") == 'Offline edit A' and [x['doc']['scenes'][0]['name'] for x in adm()['shows'] if x['id'] == sid][0] == 'Newer edit B')
    click_btn(a, 'Keep mine…'); a.wait_for_timeout(2500); saved(a)
    cloud = [x for x in adm()['shows'] if x['id'] == sid][0]
    chk('Keep mine succeeds: cloud now has A\'s edit, a new revision, and B\'s version is in history', cloud['doc']['scenes'][0]['name'] == 'Offline edit A' and cloud['rev'] >= 3 and any(v['show_id'] == sid for v in adm()['versions']), [cloud['rev'], cloud['doc']['scenes'][0]['name']])
    chk('A ends as Saved to cloud', chip(a) == 'Saved to cloud', chip(a))
    chk('no page errors (A and B)', not a.errs and not b.errs, [a.errs, b.errs])
    br.close(); srv.terminate()
    bad = [r for r in res if not r[1]]
    print('\n%d checks, %d failed' % (len(res), len(bad))); sys.exit(1 if bad else 0)
