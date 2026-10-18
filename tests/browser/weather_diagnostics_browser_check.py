"""Real-browser (headless Chromium) check of the Data Source Status / diagnostics section and the honest LIVE labels
(studio/weather_workspace.js), against the real built dist/studio.html.
Usage: python3 wxbuild.py && python3 tests/browser/weather_diagnostics_browser_check.py [screenshot_dir]

What this proves: how the UI reacts to a processor that is absent, not running, waiting, connected, stale, or sending bad frames.
What it does NOT prove (this sandbox has no NOAA / Mapbox / Docker / Windows PC): the processor here is a MOCK answered at the
network layer by Playwright (http://127.0.0.1:8080 /health /catalog /manifests /frames). It is not the real NOAA processor, and the
real browser's loopback-permission prompt is not exercised. The frame image is a 1x1 PNG.
Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import json, base64, os, sys, tempfile, pathlib, time
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxdiag_')) + '/'
os.makedirs(S, exist_ok=True)
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, info if not ok else '')
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
HTML = (ROOT / 'dist' / 'studio.html').as_uri()
EP = 'http://127.0.0.1:8080'
CORS = {'access-control-allow-origin': '*'}
now = int(time.time() * 1000)

def fresh(b, init=None, routes=None, width=1700):
    ctx = b.new_context(viewport={'width': width, 'height': 960}, permissions=['clipboard-read', 'clipboard-write'])
    if init: ctx.add_init_script(init)
    pg = ctx.new_page(); pg.errs = []
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    if routes: routes(pg)
    pg.goto(HTML); pg.wait_for_timeout(2200)
    pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    pg.click('#dlBar .loop-toggle'); pg.wait_for_timeout(1000)
    return ctx, pg
def visible(pg): return pg.evaluate("!!document.querySelector('#wxws:not([hidden])')")
def sec_open(pg, sid): return pg.evaluate("(id)=>{const b=document.getElementById('wxws-'+id);return !!b&&b.parentElement.classList.contains('open')}", sid)
def head(pg, label): return pg.locator('#wxws button.ws-sh:has(b:text-is("%s"))' % label).first
def expand(pg, sid, label):
    if not sec_open(pg, sid): head(pg, label).click(); pg.wait_for_timeout(150)
def open_panel(pg):
    pg.click('#dlBar .dl-source'); pg.wait_for_timeout(500)
def open_groups(pg): pg.evaluate("(()=>{const g=WXWeatherWorkspace.ui.grp;g['diag-east']=true;g['diag-west']=true;WXWeatherWorkspace.render()})()"); pg.wait_for_timeout(150)
def row(pg, pid): return pg.evaluate("(p)=>{const r=document.querySelector('#wxws [data-pid=\"'+p+'\"]');return r?{state:r.dataset.state,text:r.textContent,pill:r.querySelector('.ws-pill').textContent,btns:[...r.querySelectorAll('button')].map(b=>b.textContent)}:null}", pid)
def card(pg): return pg.evaluate("(()=>{const c=document.querySelector('#wxws [data-diag=processor]');return c?{state:c.dataset.state,text:c.textContent,pill:c.querySelector('.ws-pill').textContent}:null})()")
def strip(pg): return pg.evaluate("(()=>{const c=document.querySelector('#wxws .ws-cloud');return {pill:c.querySelector('.ws-pill').textContent,text:c.querySelector('.t').textContent,state:c.dataset.state}})()")
def dock(pg): return pg.evaluate("(()=>{const n=document.querySelector('#dlBar .dl-live');return n?{t:n.textContent,s:n.getAttribute('data-wxs'),title:n.title}:null})()")
BAR = """()=>{const sc=WX.S.show.scenes[WX.S.si],cv=document.createElement('canvas');cv.width=1920;cv.height=1080;const c=cv.getContext('2d'),calls=[],o=c.fillText.bind(c);
  c.fillText=function(t,...a){calls.push(String(t));return o(t,...a)};WXData.drawBar(c,sc,0,{});return calls}"""

def mock(state):
    """state: dict(mode='ok'|'down'|'waiting', products={pid:(age_min, n)}, frame='png'|'404'|'text', frame_bad={pid})"""
    def install(pg):
        def h(route):
            u = route.request.url; path = u.split('127.0.0.1:8080', 1)[1]
            if state['mode'] == 'down': return route.abort()
            if path == '/health':
                n = len(state['products']) if state['mode'] == 'ok' else 0
                return route.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps({'service': 'wxstudio-noaa-native', 'status': 'ready' if n else 'waiting-for-real-noaa-frames', 'freshProducts': n, 'scientificDecoding': True}))
            if path == '/catalog':
                prods = [] if state['mode'] == 'waiting' else [{'product': k, 'latestObservationUtc': now - age * 60000, 'earliestObservationUtc': now - age * 60000 - (n - 1) * 5 * 60000, 'frameCount': n, 'attribution': 'NOAA'} for k, (age, n) in state['products'].items()]
                return route.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps({'schema': 'wxstudio.frames.v1', 'products': prods}))
            if path.startswith('/manifests/'):
                prod = path.split('/')[2].replace('.json', ''); age, n = state['products'][prod]
                fr = [{'t': now - age * 60000 - (n - 1 - i) * 5 * 60000, 'bbox': [-100, 20, -60, 50], 'crs': '4326'} for i in range(n)]
                for f in fr: f['url'] = f'{EP}/frames/{prod}/{f["t"]}.png'
                return route.fulfill(status=200, content_type='application/json', headers=CORS, body=json.dumps({'schema': 'wxstudio.frames.v1', 'product': prod, 'frames': fr}))
            if path.startswith('/frames/'):
                prod = path.split('/')[2]
                if prod in state.get('bad404', ()): return route.fulfill(status=404, body='', headers=CORS)
                if prod in state.get('badtext', ()): return route.fulfill(status=200, content_type='image/png', headers=CORS, body=b'this is not an image')
                return route.fulfill(status=200, content_type='image/png', headers=CORS, body=PNG)
            route.fulfill(status=404, body='', headers=CORS)
        pg.route(EP + '/**', h)
    return install
INIT = "window.WX_WEATHER_PROCESSOR_URL='%s'" % EP

with sync_playwright() as p:
    b = p.chromium.launch()

    # ============================ A. DISCONNECTED: no processor enabled ============================
    ctx, pg = fresh(b)
    open_panel(pg)
    names = pg.evaluate("[...document.querySelectorAll('#wxws .ws-sh b')].map(x=>x.textContent)")
    chk('A: both new sections exist in the existing panel (old sections untouched, same order)', names == ['Weather layer', 'Satellite', 'Radar', 'RTMA', 'Forecast Models', 'Weather Color Palettes', 'Data Source Status', 'Connect local NOAA processor', 'Demo test patterns'], names)
    s = strip(pg); chk('A: top strip says Not connected / No processor enabled', s['pill'] == 'Not connected' and 'No processor enabled' in s['text'] and s['state'] == 'notconfigured', s)
    expand(pg, 'status', 'Data Source Status')
    c = card(pg); chk('A: processor card = Not connected, explains how to start one, mentions demo still works', c and c['pill'] == 'Not connected' and 'start the free local processor' in c['text'] and 'Demo patterns work' in c['text'], c)
    chk('A: Run diagnostics is disabled (nothing to ask)', pg.evaluate("[...document.querySelectorAll('#wxws [data-diag=processor] button')].find(b=>b.textContent==='Run diagnostics').disabled"))
    states = pg.evaluate("[...document.querySelectorAll('#wxws #wxws-status .ws-drow[data-pid]')].map(r=>r.dataset.state)")
    chk('A: every NOAA source row is "notconnected"; none is live/connected', states and all(x in ('notconnected', 'demo', 'experimental') for x in states) and 'live' not in states, states)
    chk('A: GOES East/West groups, MRMS and NEXRAD rows are present', pg.evaluate("document.querySelector('#wxws-status').textContent.includes('GOES-19 East')&&document.querySelector('#wxws-status').textContent.includes('GOES-18 West')") and row(pg, 'mrms-reflectivity') and row(pg, 'nexrad-reflectivity-KBOX') and row(pg, 'nexrad-velocity-KBOX'))
    chk('A: the panel shows no LIVE-verified pill anywhere', pg.evaluate("![...document.querySelectorAll('#wxws .ws-pill')].some(p=>/LIVE/.test(p.textContent))"))
    chk('A: planned RTMA / Forecast models are Not connected and nothing is invented', pg.evaluate("[...document.querySelectorAll('#wxws [data-future]')].map(r=>r.dataset.future+':'+r.querySelector('.ws-pill').textContent).join()") == 'rtma:Not connected,models:Not connected' and 'No feed is enabled' in pg.evaluate("document.querySelector('#wxws [data-future=rtma]').textContent"))
    # collapsible
    ar = pg.evaluate("document.querySelector('#wxws .ws-sh[aria-controls=wxws-status]').getAttribute('aria-expanded')"); head(pg, 'Data Source Status').click(); pg.wait_for_timeout(120)
    chk('A: Data Source Status collapses and expands', ar == 'true' and not sec_open(pg, 'status') and pg.evaluate("document.querySelector('#wxws .ws-sh[aria-controls=wxws-status]').getAttribute('aria-expanded')") == 'false')
    expand(pg, 'status', 'Data Source Status')
    # copy report
    pg.locator('#wxws [data-diag=processor] button', has_text='Copy report').click(); pg.wait_for_timeout(300)
    rep = pg.evaluate("(document.querySelector('#wxws textarea.ws-report')||{}).value||''")
    chk('A: Copy report builds a plain-text report (processor: none)', 'WX Studio data diagnostics' in rep and 'Processor: none' in rep, rep[:120])
    # help section
    expand(pg, 'connect', 'Connect local NOAA processor')
    ht = pg.evaluate("document.getElementById('wxws-connect').textContent")
    chk('A: Connect help — no-Docker start script (first-run switch), Docker option, /health, /catalog, the Streamlit checkbox, docker logs', all(x in ht for x in ['start_no_docker_windows.ps1', '-InstallMicromamba', 'Docker Desktop', 'start_local_windows.ps1', '/health', '/catalog', 'Use free local NOAA processor on this computer', 'docker logs -f wxstudio-noaa-local', 'waiting-for-real-noaa-frames', 'Cannot find the ecCodes library']), '')
    links = pg.evaluate("[...document.querySelectorAll('#wxws-connect a')].map(a=>[a.href,a.target,a.rel])")
    chk('A: help links point at http://127.0.0.1:8080 and open in a new tab safely', [l[0] for l in links] == [EP + '/health', EP + '/catalog'] and all(l[1] == '_blank' and 'noopener' in l[2] for l in links), links)
    chk('A: help says what is not verified (honest)', 'Not verified yet' in ht)
    # demo vs real
    pg.evaluate("WXWeatherWorkspace.ui.sections.demo=true;WXWeatherWorkspace.render()")
    pg.locator('#wxws #wxws-demo .ws-row', has_text='Radar').first.click(); pg.wait_for_timeout(1500)
    d = dock(pg); chk('A: demo layer → dock badge says DEMO (not LIVE), colored, no red dot', d and d['t'] == 'DEMO' and d['s'] == 'demo' and 'synthetic' in d['title'].lower() or (d and 'Synthetic' in d['title']), d)
    calls = pg.evaluate(BAR); chk('A: exported bar for a demo says DEMO and never LIVE', 'DEMO' in calls and 'LIVE' not in calls, calls)
    chk('A: ctx.fillText is restored after drawing (no leaked override)', pg.evaluate("(()=>{const c=document.createElement('canvas').getContext('2d');WXData.drawBar(c,WX.S.show.scenes[WX.S.si],0,{});return !Object.prototype.hasOwnProperty.call(c,'fillText')})()"))
    drows = pg.evaluate("[...document.querySelectorAll('#wxws #wxws-status .ws-drow[data-state=demo]')].map(r=>r.querySelector('.ws-pill').textContent)")
    chk('A: demo sources are labeled "Demo · synthetic" in the status list', drows and all(x == 'Demo · synthetic' for x in drows), drows)
    pg.screenshot(path=S + 'A_disconnected.png')
    chk('A: no page errors', not pg.errs, pg.errs); ctx.close()

    # ============================ B. WAITING: local processor not running ============================
    st = {'mode': 'down', 'products': {}}
    ctx, pg = fresh(b, INIT, mock(st)); pg.wait_for_timeout(600)
    open_panel(pg); expand(pg, 'status', 'Data Source Status'); pg.wait_for_timeout(700)
    s = strip(pg); chk('B: strip says Waiting for local processor', s['pill'] == 'Waiting for local processor' and s['state'] == 'waiting-local', s)
    c = card(pg); chk('B: card explains how to start it and shows the address', c and c['state'] == 'waiting-local' and EP in c['text'] and 'Start the processor' in c['text'], c)
    open_groups(pg); r = row(pg, 'goes-east-conus-C02'); chk('B: every satellite row says Waiting for local processor (not an error, not connected)', r and r['state'] == 'waiting' and r['pill'] == 'Waiting for local processor' and 'Verify frame' not in r['btns'], r)
    pg.locator('#wxws [data-diag=processor] button', has_text='Run diagnostics').click(); pg.wait_for_timeout(900)
    c = card(pg); chk('B: Run diagnostics records /health and /catalog as failed with a plain reason', c and '✗' in c['text'] and 'no response' in c['text'], c['text'] if c else None)
    pg.locator('#wxws [data-diag=processor] button', has_text='Copy report').click(); pg.wait_for_timeout(300)
    rep = pg.evaluate("(document.querySelector('#wxws textarea.ws-report')||{}).value||''")
    chk('B: report contains FAILED for /health and the local address', '/health: FAILED' in rep and EP in rep, rep[:300])
    pg.screenshot(path=S + 'B_waiting_local.png')
    chk('B: no page errors', not pg.errs, pg.errs); ctx.close()

    # ============================ C. WAITING: processor up but no fresh NOAA frames ============================
    st = {'mode': 'waiting', 'products': {}}
    ctx, pg = fresh(b, INIT, mock(st)); pg.wait_for_timeout(600)
    open_panel(pg); expand(pg, 'status', 'Data Source Status'); pg.wait_for_timeout(700)
    pg.locator('#wxws [data-diag=processor] button', has_text='Run diagnostics').click(); pg.wait_for_timeout(900)
    s = strip(pg); chk('C: strip says Waiting for NOAA frames', s['pill'] == 'Waiting for NOAA frames', s)
    c = card(pg); chk('C: card shows /health answered with waiting-for-real-noaa-frames and 0 products', c and '✓ answered' in c['text'] and 'waiting-for-real-noaa-frames' in c['text'] and '0 products' in c['text'] and 'processor window' in c['text'], c)
    r = row(pg, 'mrms-reflectivity'); chk('C: MRMS row says Waiting for NOAA frames; nothing LIVE', r and r['state'] == 'waiting' and r['pill'] == 'Waiting for NOAA frames', r)
    chk('C: not one source is live or connected', pg.evaluate("![...document.querySelectorAll('#wxws .ws-drow')].some(r=>/^(live|connected)$/.test(r.dataset.state))"))
    chk('C: no page errors', not pg.errs, pg.errs); ctx.close()

    # ============================ D. CONNECTED → verified LIVE → STALE ============================
    st = {'mode': 'ok', 'products': {'goes-east-conus-C13': (2, 6), 'mrms-reflectivity': (3, 6), 'nexrad-reflectivity-KBOX': (35, 6), 'rtma-2m-temperature': (4, 3)}}
    ctx, pg = fresh(b, INIT, mock(st)); pg.wait_for_timeout(900)
    open_panel(pg); expand(pg, 'status', 'Data Source Status'); pg.wait_for_timeout(500)
    pg.locator('#wxws [data-diag=processor] button', has_text='Run diagnostics').click(); pg.wait_for_timeout(1200)
    s = strip(pg); chk('D: strip = Connected, 4 products listed, none verified yet (no LIVE claim)', s['pill'] == 'Connected' and '4 products listed' in s['text'] and 'none verified yet' in s['text'] and 'LIVE' not in s['text'], s)
    c = card(pg); chk('D: card shows /health ✓ and /catalog ✓ with 4 products', c and c['pill'] == 'Connected' and '✓ answered' in c['text'] and '4 products' in c['text'] and EP in c['text'], c['text'] if c else None)
    r = row(pg, 'goes-east-conus-C13'); chk('D: listed GOES CONUS IR → "Connected · not verified" (NOT live) with newest time, age and frame count', r and r['state'] == 'connected' and r['pill'] == 'Connected · not verified' and 'min ago' in r['text'] and '6 frames available' in r['text'] and 'Z ·' in r['text'] and 'Verify frame' in r['btns'], r)
    r = row(pg, 'mrms-reflectivity'); chk('D: MRMS row also Connected · not verified', r and r['state'] == 'connected', r)
    r = row(pg, 'nexrad-reflectivity-KBOX'); chk('D: NEXRAD KBOX ~35 min old → Stale, with the reason shown', r and r['state'] == 'stale' and r['pill'] == 'Stale' and __import__('re').search(r'3[5-7] min old', r['text']), r)
    open_groups(pg); r = row(pg, 'goes-west-full-C02'); chk('D: a product the processor does not list stays Waiting for NOAA frames', r and r['state'] == 'waiting' and r['pill'] == 'Waiting for NOAA frames', r)
    r = row(pg, 'rtma-2m-temperature'); chk('D: an RTMA product the processor really lists is shown (Other products), with no Use button invented', r and r['state'] == 'connected' and 'Use' not in r['btns'], r)
    chk('D: planned RTMA row reflects the real listing; Forecast models still Not connected', 'Listed' in pg.evaluate("document.querySelector('#wxws [data-future=rtma] .ws-pill').textContent") and pg.evaluate("document.querySelector('#wxws [data-future=models] .ws-pill').textContent") == 'Not connected')
    chk('D: nothing is LIVE before a frame has been downloaded and checked', pg.evaluate("![...document.querySelectorAll('#wxws .ws-pill')].some(p=>/LIVE/.test(p.textContent))"))
    # Verify
    pg.locator('#wxws [data-pid="goes-east-conus-C13"] button', has_text='Verify frame').click(); pg.wait_for_timeout(900)
    r = row(pg, 'goes-east-conus-C13'); chk('D: Verify frame → LIVE · verified, with the decoded frame size', r and r['state'] == 'live' and r['pill'] == 'LIVE · verified' and '1×1 px' in r['text'], r)
    s = strip(pg); chk('D: strip now counts 1 verified live', '1 verified live' in s['text'], s)
    # frame check failures never show LIVE
    st['bad404'] = {'mrms-reflectivity'}; pg.locator('#wxws [data-pid="mrms-reflectivity"] button', has_text='Verify frame').click(); pg.wait_for_timeout(900)
    r = row(pg, 'mrms-reflectivity'); chk('D: frame 404 → Unavailable with the reason (never LIVE)', r and r['state'] == 'unavailable' and 'HTTP 404' in r['text'], r)
    st['bad404'] = set(); st['badtext'] = {'mrms-reflectivity'}; pg.locator('#wxws [data-pid="mrms-reflectivity"] button', has_text='Check again').click(); pg.wait_for_timeout(900)
    r = row(pg, 'mrms-reflectivity'); chk('D: a "frame" that is not a decodable image → Unavailable (never LIVE)', r and r['state'] == 'unavailable' and r['state'] != 'live', r)
    st['badtext'] = set(); pg.locator('#wxws [data-pid="mrms-reflectivity"] button', has_text='Check again').click(); pg.wait_for_timeout(900)
    r = row(pg, 'mrms-reflectivity'); chk('D: re-checking a recovered product turns it LIVE', r and r['state'] == 'live', r)
    # report
    pg.locator('#wxws [data-diag=processor] button', has_text='Copy report').click(); pg.wait_for_timeout(400)
    rep = pg.evaluate("document.querySelector('#wxws textarea.ws-report').value")
    clip = ''
    try: clip = pg.evaluate("navigator.clipboard.readText()")
    except Exception as e: clip = ''
    chk('D: report lists catalog counts, newest time and verified frame size', '/catalog: 4 product(s)' in rep and 'goes-east-conus-C13' in rep and 'verified 1x1' in rep and 'frame(s)' in rep, rep)
    chk('D: report was copied to the clipboard (when the browser allows it)', clip == rep or clip == '', 'clipboard differs')
    pg.screenshot(path=S + 'D_connected_verified.png')
    # use the verified source on the map: dock badge LIVE
    pg.locator('#wxws [data-pid="goes-east-conus-C13"] button', has_text='Use').click(); pg.wait_for_timeout(2200)
    d = pg.evaluate("WXWeatherWorkspace.ui.open"); pg.evaluate("WXWeatherWorkspace.close()")
    ld = pg.evaluate("WX.S.show.scenes[WX.S.si].dataLoop.source")
    chk('D: Use selects the real source', ld == 'goes-east-conus-C13', ld)
    d = dock(pg); chk('D: decoded + fresh real frames → dock badge LIVE (data-wxs=live)', d and d['t'] == 'LIVE' and d['s'] == 'live', d)
    calls = pg.evaluate(BAR); chk('D: exported bar says LIVE for verified fresh data', 'LIVE' in calls, calls)
    # time passes: 30 minutes later the same frames are stale
    pg.evaluate("(()=>{const r=Date.now;window.__realNow=r;Date.now=()=>r()+30*60000})()"); pg.wait_for_timeout(1600)
    d = dock(pg); chk('D: 30 minutes later the dock badge says STALE, not LIVE', d and d['t'] == 'STALE' and d['s'] == 'stale', d)
    calls = pg.evaluate(BAR); chk('D: ...and the exported bar says STALE and never LIVE', 'STALE' in calls and 'LIVE' not in calls, calls)
    open_panel(pg)
    r = row(pg, 'goes-east-conus-C13'); chk('D: ...and its status row is Stale with the age', r and r['state'] == 'stale' and 'min old' in r['text'], r)
    chk('D: ...and the strip stops counting it as verified live', '1 verified live' not in strip(pg)['text'], strip(pg))
    pg.evaluate("Date.now=window.__realNow;0")
    pg.screenshot(path=S + 'D_stale.png')
    chk('D: no page errors', not pg.errs, pg.errs); ctx.close()

    # ============================ E. processor lost while a real layer is on ============================
    st = {'mode': 'ok', 'products': {'goes-east-conus-C13': (2, 6)}}
    ctx, pg = fresh(b, INIT, mock(st)); pg.wait_for_timeout(900)
    pg.evaluate("WXWeatherWorkspace.close();0"); pg.evaluate("(()=>{const sc=WX.S.show.scenes[WX.S.si];sc.dataLoop=Object.assign(WXData.defaults(),{on:true,source:'goes-east-conus-C13',hours:1});WX.commit&&WX.commit()})()"); pg.wait_for_timeout(2500)
    d = dock(pg); chk('E: real source, decoded fresh frames → LIVE', d and d['s'] == 'live', d)
    st['mode'] = 'down'
    open_panel(pg); expand(pg, 'status', 'Data Source Status'); pg.locator('#wxws [data-diag=processor] button', has_text='Run diagnostics').click(); pg.wait_for_timeout(1200)
    c = card(pg); chk('E: processor lost → card says Waiting for local processor', c and c['state'] == 'waiting-local', c)
    chk('E: frames already decoded in the loop keep their (honest) age-based state, not a fake error', pg.evaluate("document.querySelector('#dlBar .dl-live').getAttribute('data-wxs')") in ('live', 'waiting'))
    chk('E: no page errors', not pg.errs, pg.errs); ctx.close()

    # ============================ F. layout ============================
    st = {'mode': 'ok', 'products': {'goes-east-conus-C13': (2, 6), 'mrms-reflectivity': (3, 6)}}
    for w in (1700, 1100):
        ctx, pg = fresh(b, INIT, mock(st), width=w); pg.wait_for_timeout(700)
        open_panel(pg); expand(pg, 'status', 'Data Source Status'); expand(pg, 'connect', 'Connect local NOAA processor'); pg.wait_for_timeout(300)
        ov = pg.evaluate("(()=>{const p=document.getElementById('wxws'),s=p.querySelector('.ws-scroll');return [p.scrollWidth<=p.clientWidth+1,s.scrollWidth<=s.clientWidth+1]})()")
        chk('F: no horizontal overflow in the panel at %dpx' % w, ov == [True, True], ov)
        pg.screenshot(path=S + 'F_layout_%d.png' % w); ctx.close()
    b.close()

fails = [r for r in res if not r[1]]
print('\n%d checks, %d passed, %d failed' % (len(res), len(res) - len(fails), len(fails)))
sys.exit(1 if fails else 0)
