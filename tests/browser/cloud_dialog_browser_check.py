"""Real-browser regression (v0.10.2 Cloud workspace UI fix): Sync now feedback + My Shows navigation.
Root cause of the navigation complaint: the "My Shows…" button handed its click event to myShows(trash) -> the event was truthy -> "Deleted shows" opened first.
Covers: the dialog opens on the actual My Shows list; exactly one tab is highlighted; Deleted shows only when chosen; Back/Version history return to the
dialog; Open / Delete / Restore; loading, empty and error states; stale async results ignored; repeated opening; Sync now: busy + repeat-click guard,
"Cloud sync complete!" with time and version, "Already up to date.", "Sync incomplete" (image upload refused), errors (offline / server) that say whether
changes are safe on this computer, localStorage-quota failures; the top chip reports version / outstanding changes.
Fake Supabase by default; WX_BACKEND=pg runs the REAL SQL migrations (WX_MIGRATIONS_DIR).   Usage: python3 wxbuild.py && python3 tests/browser/cloud_dialog_browser_check.py"""
from playwright.sync_api import sync_playwright
import json, pathlib, subprocess, sys, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
PORT = 8797; LOCAL = 'http://127.0.0.1:%d' % PORT; FAKE = 'https://fake-project.supabase.test'
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
# network switches the test flips from Python: __delay (ms), __net = '' | offline | storage500 | save500
NET = """(()=>{const f=window.fetch.bind(window);window.__delay=0;window.__net='';window.__saves=0;
 window.fetch=async(u,o)=>{const url=String((u&&u.url)||u),m=((o&&o.method)||(u&&u.method)||'GET').toUpperCase();
  if(url.includes('fake-project')){ if(/rpc\\/wx_studio_save_show/.test(url))window.__saves++; if(window.__delay)await new Promise(r=>setTimeout(r,window.__delay));
   if(window.__net==='offline')throw new TypeError('Failed to fetch');
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

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])
    c1, a = new_computer(br); sign_in(a); a.wait_for_timeout(2500); saved(a)
    rename_sync(a, 'ZZ LIVE TEST 1')
    # second cloud show (the first one is then listed with Open / Delete)
    ev(a, "document.getElementById('bNew').click()"); a.wait_for_timeout(1500); rename_sync(a, 'ZZ SECOND')

    names0 = sorted(x['name'] for x in adm()['shows'])
    chk('File > New show leaves the previous cloud show intact (it used to be overwritten by the blank new show)', names0 == ['ZZ LIVE TEST 1', 'ZZ SECOND'], names0)
    # ===================== navigation =====================
    chk('the green indicator says Saved to cloud', chip(a) == 'Saved to cloud', chip(a))
    open_dialog(a); wait(a, "()=>{const l=document.querySelector('#modal [data-cloud-list]');return l&&l.dataset.state==='ready'}", 8000); d = dlg(a)
    chk('one click on the indicator opens the Cloud workspace with the actual My Shows list (no extra click)', d and d['title'] == 'Cloud workspace' and d['state'] == 'ready' and 'ZZ LIVE TEST 1' in d['names'] and 'ZZ SECOND' in d['names'], d)
    chk('exactly one tab is highlighted: My Shows (Deleted shows is not)', d['tabs'] == [['shows', 'true'], ['deleted', 'false']], d['tabs'])
    top = ev(a, "(()=>{const m=document.getElementById('modal');return [...m.querySelectorAll('button')].map(b=>b.textContent.trim())})()")
    chk('Sync now, Save a version, Version history, Sign out and Close are all in the same dialog', all(x in top for x in ['Sync now', 'Save a version now', 'Version history…', 'Sign out…', 'Close']), top)
    chk('current show is marked, others offer Open and Delete', 'Open' in d['buttons'] and 'Delete' in d['buttons'], d['buttons'])
    # deleted tab only when chosen
    click_btn(a, 'Deleted shows'); wait(a, "()=>document.querySelector('#modal [data-cloud-list]').dataset.state!=='loading'", 5000); d = dlg(a)
    chk('Deleted shows opens only when selected: highlighted tab moves, list says No deleted shows.', d['tabs'] == [['shows', 'false'], ['deleted', 'true']] and d['state'] == 'empty' and 'No deleted shows.' in d['text'], d)
    click_btn(a, 'My Shows'); wait(a, "()=>document.querySelector('#modal [data-cloud-list]').dataset.state==='ready'", 5000); d = dlg(a)
    chk('My Shows tab returns to the real list on the first click', d['tabs'] == [['shows', 'true'], ['deleted', 'false']] and 'ZZ LIVE TEST 1' in d['names'], d)
    # delete / restore round trip, in place
    ev(a, "()=>{const r=[...document.querySelectorAll('#modal [data-show-id]')].find(x=>x.textContent.includes('ZZ LIVE TEST 1'));[...r.querySelectorAll('button')].find(b=>b.textContent==='Delete').click()}"); a.wait_for_timeout(1500)
    d = dlg(a); chk('Delete removes the show from My Shows in place (dialog stays on My Shows)', 'ZZ LIVE TEST 1' not in d['names'] and d['tabs'][0][1] == 'true', d)
    click_btn(a, 'Deleted shows'); a.wait_for_timeout(1200); d = dlg(a)
    chk('the deleted show is listed under Deleted shows with a Restore button', 'ZZ LIVE TEST 1' in d['names'] and d['buttons'] == ['Restore'], d)
    ev(a, "()=>{[...document.querySelectorAll('#modal [data-show-id] button')].find(b=>b.textContent==='Restore').click()}"); a.wait_for_timeout(1500)
    d = dlg(a); chk('Restore removes it from Deleted shows (stays on that tab)', d['tabs'][1][1] == 'true' and d['state'] == 'empty', d)
    click_btn(a, 'My Shows'); a.wait_for_timeout(1000); d = dlg(a); chk('…and it is back in My Shows', 'ZZ LIVE TEST 1' in d['names'], d)
    # Version history round trip
    click_btn(a, 'Version history…'); a.wait_for_timeout(1200)
    chk('Version history opens', ev(a, "document.querySelector('#modal h3').textContent") == 'Version history')
    click_btn(a, 'Back'); a.wait_for_timeout(1200); d = dlg(a)
    chk('Back from Version history returns to the Cloud workspace on My Shows with the list loaded', d and d['title'] == 'Cloud workspace' and d['tabs'][0][1] == 'true' and d['state'] == 'ready', d)
    # event argument can never select Deleted shows
    close_dialog(a)
    ev(a, "WXCloudUI.myShows({type:'click'})"); a.wait_for_timeout(800); d = dlg(a)
    chk('myShows(<click event>) opens My Shows (the original bug opened Deleted shows)', d['tabs'][0][1] == 'true' and d['tab'] == 'shows', d)
    close_dialog(a); ev(a, "WXCloudUI.myShows(true)"); a.wait_for_timeout(800); d = dlg(a); chk('myShows(true) is the only way to open Deleted shows directly', d['tabs'][1][1] == 'true' and d['tab'] == 'deleted', d)
    close_dialog(a)
    # repeated opening
    ok = True; seen = []
    for i in range(6):
        open_dialog(a); wait(a, "()=>document.querySelector('#modal [data-cloud-list]').dataset.state==='ready'", 5000); d = dlg(a); seen.append((d['tabs'][0][1], d['state']))
        if i % 2: click_btn(a, 'Deleted shows')
        close_dialog(a)
        ok = ok and d['tabs'][0][1] == 'true' and d['state'] == 'ready' and d['tab'] == 'shows'
    chk('opening the dialog repeatedly (also after leaving it on Deleted shows) always starts on the My Shows list', ok, seen)
    # stale async result: Deleted list answers after the user already went back to My Shows
    ev(a, "()=>{const e=WXCloudUI.engine;if(!e.__orig){e.__orig=e.listShows;e.listShows=async function(del){if(del)await new Promise(r=>setTimeout(r,1500));return e.__orig.call(this,del)}}}")
    open_dialog(a); click_btn(a, 'Deleted shows'); click_btn(a, 'My Shows'); a.wait_for_timeout(2600); d = dlg(a)
    chk('a slow Deleted-shows answer arriving late does not replace the My Shows list', d['tabs'][0][1] == 'true' and d['tab'] == 'shows' and 'ZZ SECOND' in d['names'] and d['state'] == 'ready', d)
    close_dialog(a)
    # error state with retry
    ev(a, "()=>{const e=WXCloudUI.engine;e.listShows=async function(del){if(window.__listFail)throw new Error('database unavailable');return e.__orig.call(this,del)}; window.__listFail=true}")
    open_dialog(a); wait(a, "()=>document.querySelector('#modal [data-cloud-list]').dataset.state==='error'", 5000); d = dlg(a)
    chk('a failing list shows a clear error with Try again (no blank dialog)', d['state'] == 'error' and 'Could not load your shows' in d['text'] and 'database unavailable' in d['text'], d['text'])
    ev(a, "window.__listFail=false"); click_btn(a, 'Try again'); wait(a, "()=>document.querySelector('#modal [data-cloud-list]').dataset.state==='ready'", 5000)
    chk('Try again reloads the list', dlg(a)['state'] == 'ready')
    close_dialog(a)
    # loading state is visible while the list is slow
    ev(a, "()=>{const e=WXCloudUI.engine;e.listShows=async function(del){await new Promise(r=>setTimeout(r,1200));return e.__orig.call(this,del)}}")
    open_dialog(a); a.wait_for_timeout(250); d = dlg(a); chk('a loading message is shown while the list loads', d['state'] == 'loading' and 'Loading' in d['text'], d)
    a.wait_for_timeout(1800); chk('…then the list appears', dlg(a)['state'] == 'ready'); close_dialog(a)
    ev(a, "()=>{WXCloudUI.engine.listShows=WXCloudUI.engine.__orig}")
    # Open another show from the list
    open_dialog(a); wait(a, "()=>document.querySelector('#modal [data-cloud-list]').dataset.state==='ready'", 5000)
    ev(a, "()=>{const r=[...document.querySelectorAll('#modal [data-show-id]')].find(x=>x.textContent.includes('ZZ LIVE TEST 1'));[...r.querySelectorAll('button')].find(b=>b.textContent==='Open').click()}")
    ok = wait(a, "()=>WX.S.show.name==='ZZ LIVE TEST 1'", 15000); chk('Open from the list opens that cloud show and closes the dialog', ok and ev(a, "document.getElementById('modalBg').style.display")=='none', ev(a, "WX.S.show.name"))
    saved(a); a.wait_for_timeout(5500)

    # ===================== Sync now =====================
    open_dialog(a); r0 = sres(a); chk('before any click the sync result area is empty', r0 and r0['kind'] == '' and r0['btnText'] == 'Sync now', r0)
    # unchanged -> Already up to date
    # The fixture show was written by an older build; opening it applies the format migrations, which is a genuine local change that the
    # first Sync now must send (and say so). Only then is the show really in step with the cloud.
    click_btn(a, 'Sync now'); wait(a, "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind&&r.dataset.kind!=='busy'}", 15000); r1 = sres(a)
    chk('first Sync now after opening an older show sends the migrated copy: "Cloud sync complete!"', r1['kind'] in ('ok', 'same'), r1)
    close_dialog(a); open_dialog(a)
    click_btn(a, 'Sync now'); wait(a, "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind&&r.dataset.kind!=='busy'}", 15000); r1 = sres(a)
    chk('nothing changed -> "Already up to date." with the cloud version', r1['kind'] == 'same' and r1['title'] == 'Already up to date.' and 'cloud version' in r1['text'], r1)
    # server idempotency: "Save a version now" on an identical show is sent, the server answers 'unchanged' -> success, no new revision
    def rev_of():
        st = adm(); return [x['rev'] for x in st['shows'] if x['name'] == 'ZZ LIVE TEST 1' and not x.get('deleted_at')]
    rv0 = rev_of(); click_btn(a, 'Save a version now'); wait(a, "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind&&r.dataset.kind!=='busy'}", 15000); rs = sres(a)
    chk('"Save a version now" on an identical show -> success ("Already up to date."), revision unchanged, no error', rs['kind'] == 'same' and rev_of() == rv0 and ev(a, "WXCloudUI.engine.status().error") is None, [rs, rv0, rev_of()])
    chk('…and the top indicator still says Saved to cloud', 'Saved to cloud' in ev(a, "document.querySelector('[data-cloud-status]')?.textContent||document.body.innerText"), None)
    # change + slow network: busy state, no double click
    ev(a, "()=>{WX.S.show.scenes[0].name='Renamed for sync test';WX.commit();window.__delay=1800;window.__saves=0}"); a.wait_for_timeout(300)
    click_btn(a, 'Sync now'); a.wait_for_timeout(300); rb = sres(a)
    chk('while syncing: "Syncing…" with a spinner, button disabled', rb['kind'] == 'busy' and rb['spin'] and rb['btnText'] == 'Syncing…' and rb['btnDisabled'] is True and 'Syncing…' in rb['title'], rb)
    ev(a, "document.querySelector('#modal [data-cloud-sync]').click()"); ev(a, "document.querySelector('#modal [data-cloud-sync]').click()")   # repeat clicks while disabled
    wait(a, "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind&&r.dataset.kind!=='busy'}", 20000); r2 = sres(a); saves = ev(a, "window.__saves"); ev(a, "window.__delay=0")
    chk('success -> "Cloud sync complete!" with the completion time and cloud version, kept on screen', r2['kind'] == 'ok' and r2['title'] == 'Cloud sync complete!' and 'Completed at' in r2['text'] and 'cloud version' in r2['text'] and r2['btnText'] == 'Sync now' and r2['btnDisabled'] is False, r2)
    chk('repeat clicks while busy did not send extra saves', saves <= 2, saves)
    a.wait_for_timeout(2500); chk('the result stays visible (not auto-dismissed)', sres(a)['kind'] == 'ok')
    d2 = ev(a, "document.querySelector('#modal [data-cloud-version]').dataset.cloudVersion"); chk('dialog header shows the latest cloud version', int(d2) >= 3 and 'Latest cloud version' in ev(a, "document.querySelector('#modal [data-cloud-version]').textContent"), d2)
    chk('top indicator: Saved to cloud, tooltip names the version', chip(a) == 'Saved to cloud' and 'version' in chiptitle(a), (chip(a), chiptitle(a)))
    # closing and reopening keeps the last result
    close_dialog(a); open_dialog(a); chk('reopening the dialog still shows the last sync result', sres(a)['kind'] == 'ok', sres(a)); close_dialog(a)

    # ---- partial media: the image upload is refused ----
    ev(a, "window.__net='storage500'")
    ev(a, """()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');for(let i=0;i<64;i++)for(let j=0;j<64;j++){x.fillStyle='rgb('+((i*37+j*11)%256)+','+((i*13+j*71)%256)+','+((i*5+j*29)%256)+')';x.fillRect(i,j,1,1)}
      WX.S.show.assets.aFail=c.toDataURL('image/png');WX.S.show.scenes[0].bg={type:'image',asset:'aFail',kenburns:false};WX.commit()}""")
    a.wait_for_timeout(500); open_dialog(a); click_btn(a, 'Sync now'); wait(a, "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind&&r.dataset.kind!=='busy'}", 25000); r3 = sres(a)
    chk('an image that cannot be uploaded -> "Sync incomplete" naming the image, never "complete"', r3['kind'] == 'incomplete' and r3['title'] == 'Sync incomplete' and 'aFail' in r3['text'] and 'Cloud sync complete' not in r3['text'], r3)
    chk('…and explains that the show is saved but the image stays on this computer', 'saved in the cloud' in r3['text'] and 'stay on this computer' in r3['text'], r3['text'][:300])
    chk('top indicator is not green while an image is missing from the cloud', chip(a) != 'Saved to cloud' and ev(a, "document.getElementById('cloudState').dataset.k") in ('incomplete',), (chip(a), ev(a, "document.getElementById('cloudState').dataset.k")))
    # network restored: sync again -> complete
    ev(a, "window.__net=''"); click_btn(a, 'Sync now'); wait(a, "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind&&r.dataset.kind!=='busy'}", 25000); r4 = sres(a)
    chk('after the problem is gone Sync now completes and the image is in the cloud', r4['kind'] == 'ok' and len(adm()['objects']) >= 1 and chip(a) == 'Saved to cloud', (r4['title'], len(adm()['objects']), chip(a)))

    # ---- errors ----
    ev(a, "()=>{WX.S.show.scenes[0].name='Offline edit';WX.commit()}")
    ev(a, "window.__net='offline'"); a.wait_for_timeout(300); click_btn(a, 'Sync now'); wait(a, "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind&&r.dataset.kind!=='busy'}", 25000); r5 = sres(a)
    chk('offline -> clear message and "safely saved on this computer"', r5['kind'] == 'error' and 'no connection' in r5['title'] and 'safely saved on this computer' in r5['text'], r5)
    chk('top indicator reports Offline – saved locally and the tooltip does not claim cloud success', 'Offline' in chip(a), (chip(a), chiptitle(a)))
    ev(a, "window.__net=''"); click_btn(a, 'Sync now'); wait(a, "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind==='ok'}", 25000)
    chk('connection back -> Sync now completes', sres(a)['kind'] == 'ok', sres(a))
    ev(a, "()=>{WX.S.show.scenes[0].name='Server error edit';WX.commit()}"); ev(a, "window.__net='save500'"); a.wait_for_timeout(300)
    click_btn(a, 'Sync now'); wait(a, "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind&&r.dataset.kind!=='busy'}", 25000); r6 = sres(a)
    chk('server error -> "Sync failed" with the real message and the local-save assurance', r6['kind'] == 'error' and r6['title'] == 'Sync failed' and 'database unavailable' in r6['text'] and 'safely saved on this computer' in r6['text'], r6)
    chk('top indicator shows Sync failed (red)', ev(a, "document.getElementById('cloudState').dataset.k") == 'failed', ev(a, "document.getElementById('cloudState').dataset.k"))
    ev(a, "window.__net=''")
    # ---- localStorage quota failure while the cloud works ----
    ev(a, """()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(/^wx\\.studio\\.autosave/.test(k)&&String(v).length>500)throw new DOMException('The quota has been exceeded.','QuotaExceededError');return set.call(this,k,v)};
      const open=indexedDB.open.bind(indexedDB);indexedDB.open=function(n,v){if(n==='wxstudio-autosave'){throw new DOMException('blocked','InvalidStateError')}return open(n,v)};0}""")
    ev(a, "()=>{WX.S.show.scenes[0].name='Quota edit';WX.commit()}"); a.wait_for_timeout(600)
    stq = ev(a, "[document.getElementById('saveState').dataset.state,document.getElementById('saveState').textContent,document.getElementById('saveState').title,Object.keys(WX.S.show.assets).join(','),JSON.stringify(WX.S.show).length]")
    chk('(precondition) the editor shows Not saved because both local stores refuse', stq[0] == 'failed', stq)
    click_btn(a, 'Sync now'); wait(a, "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind==='ok'}", 25000); r7 = sres(a)
    chk('quota failure + successful cloud sync -> complete, but warns that no local copy could be saved', r7['kind'] == 'ok' and 'could not save a local copy' in r7['text'] and 'Cloud sync complete!' in r7['title'], r7)
    cloudname = adm()['shows']; names = [s['doc']['scenes'][0]['name'] for s in cloudname if s['doc']['scenes']]
    chk('the cloud really has the edit made while local storage was failing', 'Quota edit' in names, names)
    ev(a, "window.__net='offline'"); ev(a, "()=>{WX.S.show.scenes[0].name='Quota offline edit';WX.commit()}"); a.wait_for_timeout(300); click_btn(a, 'Sync now'); wait(a, "()=>{const r=document.querySelector('#modal [data-cloud-sync-result]');return r&&r.dataset.kind==='error'}", 25000); r8 = sres(a)
    chk('quota failure + offline -> says the latest changes are NOT saved anywhere and to use Save', r8['kind'] == 'error' and 'could not save a local copy' in r8['text'] and 'safely saved' not in r8['text'], r8)
    ev(a, "window.__net=''")
    errs = a.errs; chk('no page errors', not errs, errs[:3])
    br.close()
srv.terminate()
try: srv.wait(15)
except Exception: srv.kill()
bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad))); sys.exit(1 if bad else 0)
