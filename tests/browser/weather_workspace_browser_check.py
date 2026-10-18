"""Real-browser (headless Chromium) check of the Weather Data workspace panel (studio/weather_workspace.js).
Usage: python3 wxbuild.py && python3 tests/browser/weather_workspace_browser_check.py [screenshot_dir]

What this proves: the panel's behavior in a real browser, driven by real clicks, against the real built studio.html.
What it does NOT prove (this sandbox has no NOAA / Mapbox / Supabase access):
  * "mock processor" scenarios answer the bridge's /catalog, /manifests and /frames requests from Playwright at the
    network layer. They show how the UI reacts to a processor; they are NOT a live NOAA processor.
  * cloud palette storage is a small in-memory FAKE of WXWeatherPaletteCloud (list/save/remove). It checks that the UI
    sends the right arguments and registers the right palettes; it is NOT Supabase.
Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import json, base64, os, sys, tempfile, pathlib, time
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxws_')) + '/'
os.makedirs(S, exist_ok=True)
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, info if not ok else '')
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==')
HTML = (ROOT / 'dist' / 'studio.html').as_uri()

def fresh(b, init=None, routes=None):
    ctx = b.new_context(viewport={'width': 1700, 'height': 960}, accept_downloads=True)
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
    if not sec_open(pg, sid): head(pg, label).click(); pg.wait_for_timeout(100)
def dl(pg): return pg.evaluate("(()=>{const d=WX.S.show.scenes[WX.S.si].dataLoop;return d?JSON.parse(JSON.stringify(d)):null})()")

with sync_playwright() as p:
    b = p.chromium.launch()

    # ============================ A. no cloud processor configured ============================
    ctx, pg = fresh(b)
    chk('dock hook installed (source button now opens the workspace)', pg.evaluate("WXData.openMenu.workspace===true"))
    pg.click('#dlBar .dl-source'); pg.wait_for_timeout(300)
    chk('source button opens the workspace panel', visible(pg))
    chk('old flyout stays hidden', pg.evaluate("(()=>{const m=document.getElementById('dlMenu');return !m||m.hidden})()"))
    pg.click('#dlBar .dl-source'); pg.wait_for_timeout(200)
    chk('clicking the source button again closes it', not visible(pg))
    pg.click('#dlBar .dl-source'); pg.wait_for_timeout(200)
    pg.focus('#wxws .ws-x'); pg.keyboard.press('Escape'); chk('Escape closes', not visible(pg))
    pg.click('#dlBar .dl-source'); pg.wait_for_timeout(200)
    pg.mouse.click(300, 400); pg.wait_for_timeout(200); chk('click outside the panel closes it', not visible(pg))
    pg.click('#dlBar .dl-source'); pg.wait_for_timeout(200)

    names = pg.evaluate("[...document.querySelectorAll('#wxws .ws-sh b')].map(x=>x.textContent)")
    chk('sections in the requested order', names == ['Weather layer', 'Satellite', 'Radar', 'RTMA', 'Forecast Models', 'Weather Color Palettes', 'Cloud & data status', 'Demo test patterns'], names)
    chk('cloud strip: NOT connected, no processor', pg.evaluate("document.querySelector('#wxws .ws-cloud .ws-pill').textContent")=='Not connected' and 'No processor' in pg.evaluate("document.querySelector('#wxws .ws-cloud .t').textContent"))
    # expand / collapse with real clicks
    chk('satellite collapsed by default', not sec_open(pg, 'satellite') and pg.evaluate("document.querySelector('#wxws .ws-sh[aria-controls=wxws-satellite]').getAttribute('aria-expanded')")=='false')
    head(pg, 'Satellite').click(); pg.wait_for_timeout(100)
    chk('click expands satellite', sec_open(pg, 'satellite') and pg.evaluate("document.querySelector('#wxws .ws-sh[aria-controls=wxws-satellite]').getAttribute('aria-expanded')")=='true')
    chips = pg.evaluate("[...document.querySelectorAll('#wxws #wxws-satellite .ws-chip')].map(c=>({d:c.disabled,dot:c.querySelector('.d').className,t:c.textContent}))")
    chk('satellite: 2 satellites x 4 sectors x 5 products = 40 chips', len(chips) == 40, len(chips))
    chk('satellite: every chip Not connected + disabled, no green dots', all(c['d'] and 'connected' not in c['dot'].split() for c in chips))
    sects = pg.evaluate("[...document.querySelectorAll('#wxws #wxws-satellite .ws-sech b')].map(x=>x.textContent)")
    chk('satellite: East+West each list CONUS, Full Disk, Mesoscale 1, Mesoscale 2', sects == ['CONUS', 'Full Disk', 'Mesoscale 1', 'Mesoscale 2'] * 2, sects)
    chk('satellite header summary says Not connected', pg.evaluate("document.querySelector('#wxws .ws-sh[aria-controls=wxws-satellite] i').textContent")=='Not connected')
    head(pg, 'Satellite').click()
    head(pg, 'Radar').click(); pg.wait_for_timeout(100)
    rows = pg.evaluate("[...document.querySelectorAll('#wxws #wxws-radar .ws-row')].map(r=>({n:r.querySelector('b').textContent,p:r.querySelector('.ws-pill').textContent,d:r.disabled}))")
    byn = {r['n']: r for r in rows}
    chk('radar: native MRMS is Not connected + disabled', byn['MRMS reflectivity — native']['p']=='Not connected' and byn['MRMS reflectivity — native']['d'], byn.get('MRMS reflectivity — native'))
    chk('radar: NWS Northeast preview is labelled Experimental and selectable', byn['NOAA MRMS · Northeast preview']['p']=='Experimental' and not byn['NOAA MRMS · Northeast preview']['d'])
    chk('radar: NEXRAD reflectivity + velocity Not connected', byn['Base reflectivity · Level II']['p']=='Not connected' and byn['Radial velocity · Level II']['p']=='Not connected')
    nsites = pg.evaluate("document.querySelectorAll('#wxws #wxws-radar select option').length")
    chk('radar: station list present (sandbox is offline, so this is nexrad_sites.js built-in fallback list, not NOAA\'s full list)', nsites >= 10, nsites)
    pg.fill('#wxws #wxws-radar input[type=text]', 'KBOX'); pg.wait_for_timeout(100)
    chk('radar: station filter finds KBOX', pg.evaluate("[...document.querySelectorAll('#wxws #wxws-radar select option')].some(o=>o.value==='KBOX')"))
    pg.fill('#wxws #wxws-radar input[type=text]', '')
    pg.screenshot(path=S + 'A_radar.png')
    head(pg, 'Radar').click()
    for sid, label in (('rtma', 'RTMA'), ('models', 'Forecast Models')):
        head(pg, label).click(); pg.wait_for_timeout(100)
        rr = pg.evaluate("(id)=>[...document.querySelectorAll('#wxws #wxws-'+id+' .ws-row')].map(r=>({p:r.querySelector('.ws-pill').textContent,d:r.disabled}))", sid)
        txt = pg.evaluate("(id)=>document.getElementById('wxws-'+id).textContent", sid)
        chk(f'{label}: only Not connected rows, nothing pre-selected', rr and all(x['p']=='Not connected' and x['d'] for x in rr) and 'Nothing here is live data' in txt, rr)
        head(pg, label).click()
    # demo + layer
    chk('opening from the dock expands the section of the active source (demo)', sec_open(pg, 'demo'))
    expand(pg, 'demo', 'Demo test patterns')
    chk('demo rows are DEMO and the panel says they are not weather data', pg.evaluate("[...document.querySelectorAll('#wxws #wxws-demo .ws-row .ws-pill')].map(x=>x.textContent).join()")=='Demo,Demo,Demo' and 'NOT weather data' in pg.evaluate("document.getElementById('wxws-demo').textContent"))
    pg.locator('#wxws #wxws-demo .ws-row', has_text='infrared').click(); pg.wait_for_timeout(1200)
    d = dl(pg); chk('picking a demo source writes dataLoop.source', d['source']=='demo-ir', d)
    chk('dock followed the pick', 'infrared' in pg.evaluate("document.querySelector('#dlBar .dl-srcname').textContent"))
    pg.locator('#wxws #wxws-demo .ws-row', has_text='radar test').click(); pg.wait_for_timeout(1200)
    # layer card controls
    live = pg.evaluate("document.querySelector('#wxws [data-live]').textContent")
    chk('layer card shows frame number + observation time', live.startswith('Frame ') and ' of 8' in live and 'EDT' in live or 'EST' in live, live)
    pg.evaluate("document.querySelector('#wxws .ws-ctl input[type=range]').value=0.4;document.querySelector('#wxws .ws-ctl input[type=range]').dispatchEvent(new Event('input'));document.querySelector('#wxws .ws-ctl input[type=range]').dispatchEvent(new Event('change'))")
    chk('opacity slider writes dataLoop.opacity (and label)', abs(dl(pg)['opacity'] - 0.4) < 1e-9 and pg.evaluate("document.querySelector('#wxws .ws-ctl .v').textContent")=='40%')
    pg.wait_for_timeout(300); u = pg.evaluate("MB._weatherFrame&&MB._weatherFrame.opacity"); chk('opacity reaches the Mapbox underlay call', u is not None and abs(u - 0.4) < 1e-9, u)
    pg.select_option('#wxws .ws-ctl select', '2'); chk('history select writes dataLoop.hours', dl(pg)['hours'] == 2)
    pg.select_option('#wxws .ws-ctl select', '1')
    i0 = pg.evaluate("WXData.state.get(WX.S.show.scenes[WX.S.si]).lastIdx")
    pg.click('#wxws button[title="Next frame"]'); pg.wait_for_timeout(250)
    i1 = pg.evaluate("WXData.state.get(WX.S.show.scenes[WX.S.si]).lastIdx"); chk('mini playback: next frame steps the loop', i1 == (i0 + 1) % 8, [i0, i1])
    pg.click('#wxws [data-play]'); pg.wait_for_timeout(120); pl = pg.evaluate("WXData.state.get(WX.S.show.scenes[WX.S.si]).playing"); pg.click('#wxws [data-play]')
    chk('mini playback: play/pause toggles', pl is True and pg.evaluate("WXData.state.get(WX.S.show.scenes[WX.S.si]).playing") is False)
    # stack + capability gating
    # since v0.9.89 the real Mapbox layer supports ordering, so the capability is normally ON (weather starts below labels: only the up arrow is enabled)
    cap = pg.evaluate("WXWeatherWorkspace.capabilities.layerPosition"); arrows = pg.evaluate("[...document.querySelectorAll('#wxws .ws-stack .me button')].map(x=>x.disabled)")
    chk('layer order arrows follow the Mapbox capability (on: only "move above labels" enabled)', arrows == ([False, True] if cap else [True, True]), [cap, arrows])
    pg.evaluate("WXWeatherWorkspace.capabilities.layerPosition=false;WXWeatherWorkspace.render()")
    arrows = pg.evaluate("[...document.querySelectorAll('#wxws .ws-stack .me button')].map(x=>x.disabled)")
    chk('layer order arrows are disabled when the capability is off', arrows == [True, True], arrows)
    pg.evaluate("WXWeatherWorkspace.capabilities.layerPosition=true;WXWeatherWorkspace.render()")
    pg.click('#wxws .ws-stack .me button[title^="Move above"]'); pg.wait_for_timeout(100)
    chk('with capability: moving above labels writes dataLoop.order', dl(pg).get('order') == 'above-labels' and pg.evaluate("document.querySelector('#wxws .ws-stack div:nth-child(2) span').textContent")=='Weather data')
    pg.click('#wxws .ws-stack .me button[title^="Move below"]'); chk('and back below', dl(pg).get('order') == 'below-labels')
    pg.evaluate("WXWeatherWorkspace.capabilities.layerPosition=false;WXWeatherWorkspace.render()")
    # visibility
    pg.evaluate("document.querySelector('#wxws .sw input').click()"); pg.wait_for_timeout(500)
    chk('visibility off: dataLoop.on false, no weather on the map', dl(pg)['on'] is False and pg.evaluate("MB._weatherFrame==null||MB._weatherFrame===undefined"), dl(pg))
    chk('dock shows the enable button again', pg.locator('#dlBar .loop-toggle', has_text='Enable').count() == 1)
    pg.evaluate("document.querySelector('#wxws .sw input').click()"); pg.wait_for_timeout(600)
    chk('visibility on again restores frames', dl(pg)['on'] is True)
    pg.screenshot(path=S + 'A_layer.png')

    # ---- palettes: fake in-memory cloud ----
    pg.evaluate("""(()=>{window.__cloud={rows:[{id:'11111111-2222-3333-4444-555555555555',category:'radar',product_id:'mrms_mosaic_reflectivity',name:'Cloud storm colors',units:'dBZ',stops:[[0,'#000000'],[30,'#00ff00'],[60,'#ff0000']]}],calls:[]};
      WXWeatherPaletteCloud.list=async c=>{__cloud.calls.push(['list',c]);return __cloud.rows.map(r=>JSON.parse(JSON.stringify(r)))};
      WXWeatherPaletteCloud.save=async a=>{__cloud.calls.push(['save',JSON.parse(JSON.stringify(a))]);const row={id:a.id||'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',category:a.category,product_id:a.productId,name:a.name,units:a.units,stops:a.stops};const i=__cloud.rows.findIndex(r=>r.id===row.id);if(i>=0)__cloud.rows[i]=row;else __cloud.rows.push(row);return row};
      WXWeatherPaletteCloud.remove=async id=>{__cloud.calls.push(['remove',id]);__cloud.rows=__cloud.rows.filter(r=>r.id!==id)};})()""")
    pg.evaluate("WXWeatherWorkspace.ui.sections.demo=false;WXWeatherWorkspace.render()")
    head(pg, 'Weather Color Palettes').click(); pg.wait_for_timeout(150)
    forlayer = pg.evaluate("[...document.querySelectorAll('#wxws #wxws-palettes .ws-pal b')].slice(0,1).map(x=>x.textContent)")
    chk('palettes: layer palette listed first with a preview strip', 'Reflectivity' in forlayer[0] and pg.evaluate("document.querySelectorAll('#wxws #wxws-palettes .ws-pal canvas.ws-strip').length")>=1, forlayer)
    strip_ok = pg.evaluate("(()=>{const c=document.querySelector('#wxws #wxws-palettes canvas.ws-strip'),d=c.getContext('2d').getImageData(0,0,c.width,1).data;let n=0;for(let i=0;i<c.width;i++)if(d[i*4+3]===255)n++;return [c.width,n,getComputedStyle(c).position]})()")
    chk('palette strip is fully painted and not absolutely positioned', strip_ok[1] == strip_ok[0] and strip_ok[2] == 'static', strip_ok)
    # sync cloud
    pg.evaluate("WXWeatherWorkspace.ui.grp.radar=true;WXWeatherWorkspace.render()")
    pg.click('text=Sync my cloud palettes'); pg.wait_for_timeout(400)
    msg = pg.evaluate("document.querySelector('#wxws #wxws-palettes [role=status]').textContent")
    chk('sync: 1 cloud palette loaded', msg.startswith('1 saved palette'), msg)
    chk('sync: palette registered as my/<cat>/<id> and tagged cloud', pg.evaluate("!!WXWeatherPalettes.custom['my/radar/11111111-2222-3333-4444-555555555555']") and pg.locator('#wxws .ws-badge.cloud', has_text='My palette · cloud').count() >= 1)
    # use it on the layer (demo radar -> radar/reflectivity product 'mrms_mosaic_reflectivity'? demo uses base 'demo-dbz')
    chk('palette for a different product cannot be applied (Use disabled)', pg.evaluate("[...document.querySelectorAll('#wxws .ws-pal')].filter(x=>x.textContent.includes('Cloud storm colors')).every(x=>[...x.querySelectorAll('button')].find(b=>b.textContent==='Use').disabled)"))
    # copy & edit built-in -> session only
    pg.locator('#wxws .ws-pal', has_text='Reflectivity — broadcast starter').first.locator('button', has_text='Copy & edit').click(); pg.wait_for_timeout(150)
    chk('editor opens with copy of the stops', pg.locator('#wxws .ws-stop').count() == 15, pg.locator('#wxws .ws-stop').count())
    pg.fill('#wxws .ws-edit input[type=text]', 'My radar'); pg.locator('#wxws .ws-stop input[type=number]').first.fill('7')
    pg.locator('#wxws .ws-edit button', has_text='Use this session only').click(); pg.wait_for_timeout(250)
    sess = pg.evaluate("Object.values(WXWeatherPalettes.custom).filter(p=>p.name==='My radar').map(p=>({id:p.id,first:p.stops[0],n:p.stops.length,prod:p.productIds}))")
    chk('session-only palette registered, edit applied', len(sess) == 1 and sess[0]['first'][0] == 7 and sess[0]['n'] == 15, sess)
    chk('session-only badge shown, nothing sent to the cloud', pg.locator('#wxws .ws-badge.local').count() >= 1 and not [c for c in pg.evaluate("__cloud.calls") if c[0] == 'save'])
    # bad stops rejected
    pg.click('text=New palette'); pg.wait_for_timeout(100)
    pg.locator('#wxws .ws-stop input[type=number]').nth(1).fill('0')
    pg.locator('#wxws .ws-edit button', has_text='Use this session only').click(); pg.wait_for_timeout(150)
    chk('duplicate/non-increasing stops are rejected with a message', 'increasing' in pg.evaluate("document.querySelector('#wxws #wxws-palettes [role=status]').textContent") and pg.locator('#wxws .ws-edit').count() == 1)
    pg.click('text=New palette'); pg.wait_for_timeout(100)
    chk('new palette from a demo layer does not default to a demo product', pg.evaluate("[...document.querySelectorAll('#wxws .ws-edit select')].every(x=>!/demo/.test(x.value))"))
    before = len([c for c in pg.evaluate("__cloud.calls") if c[0] == 'save'])
    pg.locator('#wxws .ws-edit button', has_text='Save to my cloud palettes').click(); pg.wait_for_timeout(200)
    chk('cloud save without a real product is refused with a message (nothing sent)', len([c for c in pg.evaluate("__cloud.calls") if c[0] == 'save']) == before and 'product' in pg.evaluate("document.querySelector('#wxws #wxws-palettes [role=status]').textContent").lower())
    pg.locator('#wxws .ws-edit button', has_text='Cancel').click()
    # save to cloud: category satellite product abi_c13
    pg.evaluate("WXWeatherWorkspace.ui.grp.satellite=true;WXWeatherWorkspace.render()")
    pg.locator('#wxws .ws-pal', has_text='Infrared brightness temperature').first.locator('button', has_text='Copy & edit').click(); pg.wait_for_timeout(150)
    pg.fill('#wxws .ws-edit input[type=text]', 'Boston IR')
    chk('editor says smooth blending is saved with the palette (no false "stepped" warning)', 'Smooth color blending is saved' in pg.evaluate("document.querySelector('#wxws .ws-edit').textContent") and 'stepped' not in pg.evaluate("document.querySelector('#wxws .ws-edit').textContent"))
    pg.locator('#wxws .ws-edit button', has_text='Save to my cloud palettes').click(); pg.wait_for_timeout(500)
    sv = [c for c in pg.evaluate("__cloud.calls") if c[0] == 'save']
    chk('cloud save: arguments sent to WXWeatherPaletteCloud.save', len(sv) == 1 and sv[0][1]['category'] == 'satellite' and sv[0][1]['productId'] == 'abi_c13' and sv[0][1]['name'] == 'Boston IR' and sv[0][1]['units'] == '°C' and len(sv[0][1]['stops']) == 13 and sv[0][1].get('continuous') is True and not sv[0][1]['id'], sv[:1] and {k: v for k, v in sv[0][1].items() if k != 'stops'})
    chk('cloud save: registered with productIds [abi_c13]', pg.evaluate("Object.values(WXWeatherPalettes.custom).some(p=>p.name==='Boston IR'&&p.productIds[0]==='abi_c13'&&p.id.startsWith('my/satellite/'))"))
    # export
    pg.evaluate("WXWeatherWorkspace.ui.grp.satellite=true;WXWeatherWorkspace.render()")
    with pg.expect_download() as dlinfo:
        pg.locator('#wxws .ws-pal', has_text='Boston IR').first.locator('button', has_text='Export').click()
    path = dlinfo.value.path(); ex = json.loads(open(path).read())
    chk('export: JSON file with schema, product and stops', ex['schema'] == 'wxstudio.palette.v1' and ex['name'] == 'Boston IR' and ex['productId'] == 'abi_c13' and len(ex['stops']) == 13 and dlinfo.value.suggested_filename == 'boston-ir.wxpalette.json', dlinfo.value.suggested_filename)
    # import json (round trip) + csv + garbage
    fp = pathlib.Path(tempfile.mkdtemp()) / 'in.json'; fp.write_text(json.dumps(ex))
    pg.set_input_files('#wxws input[type=file]', str(fp)); pg.wait_for_timeout(300)
    chk('import JSON opens the editor prefilled (product kept, nothing saved yet)', pg.locator('#wxws .ws-edit').count() == 1 and pg.locator('#wxws .ws-stop').count() == 13 and len([c for c in pg.evaluate("__cloud.calls") if c[0] == 'save']) == 1)
    pg.locator('#wxws .ws-edit button', has_text='Cancel').click()
    cp = pathlib.Path(tempfile.mkdtemp()) / 'ramp.csv'; cp.write_text('value,color\n0,#000000\n50,255 128 0\n100,#fff\n')
    pg.set_input_files('#wxws input[type=file]', str(cp)); pg.wait_for_timeout(300)
    stops = pg.evaluate("[...document.querySelectorAll('#wxws .ws-stop')].map(r=>[r.querySelector('input[type=number]').value,r.querySelector('input[type=color]').value])")
    chk('import CSV (hex, "r g b" and short hex)', stops == [['0', '#000000'], ['50', '#ff8000'], ['100', '#ffffff']], stops)
    pg.locator('#wxws .ws-edit button', has_text='Cancel').click()
    bad = pathlib.Path(tempfile.mkdtemp()) / 'bad.txt'; bad.write_text('hello world')
    pg.set_input_files('#wxws input[type=file]', str(bad)); pg.wait_for_timeout(300)
    chk('import of a bad file shows an error, no editor', pg.locator('#wxws .ws-edit').count() == 0 and 'Could not import' in pg.evaluate("document.querySelector('#wxws #wxws-palettes [role=status]').textContent"))
    # delete cloud palette: confirm step
    pg.evaluate("WXWeatherWorkspace.ui.grp.radar=true;WXWeatherWorkspace.render()")
    row = pg.locator('#wxws .ws-pal', has_text='Cloud storm colors').first
    row.locator('button', has_text='Delete').click(); pg.wait_for_timeout(100)
    chk('delete needs a second click (Confirm)', not [c for c in pg.evaluate("__cloud.calls") if c[0] == 'remove'] and pg.locator('#wxws .ws-pal', has_text='Cloud storm colors').first.locator('button', has_text='Confirm').count() == 1)
    pg.locator('#wxws .ws-pal', has_text='Cloud storm colors').first.locator('button', has_text='Confirm').click(); pg.wait_for_timeout(400)
    rm = [c for c in pg.evaluate("__cloud.calls") if c[0] == 'remove']
    chk('confirmed delete calls WXWeatherPaletteCloud.remove(row id) and unregisters it', rm == [['remove', '11111111-2222-3333-4444-555555555555']] and pg.evaluate("!WXWeatherPalettes.custom['my/radar/11111111-2222-3333-4444-555555555555']"), rm)
    # RGB demo: no colour table
    pg.evaluate("WXWeatherWorkspace.ui.sections.demo=true;WXWeatherWorkspace.render()")
    pg.locator('#wxws #wxws-demo .ws-row', has_text='RGB image').click(); pg.wait_for_timeout(1200)
    txt = pg.evaluate("document.getElementById('wxws-palettes').textContent")
    chk('RGB demo: panel says no color table applies and offers none for the layer', 'no color table applies' in txt and pg.evaluate("document.querySelector('#wxws .ws-card').textContent.includes('no color table applies')"))
    pg.screenshot(path=S + 'A_palettes.png')
    # fallback to the original flyout if the new panel breaks
    pg.evaluate("WXWeatherWorkspace.close();WXWeatherWorkspace.render=()=>{throw new Error('boom')};0")
    pg.click('#dlBar .dl-source'); pg.wait_for_timeout(300)
    chk('if the workspace throws, the original dock flyout still opens', pg.evaluate("(()=>{const m=document.getElementById('dlMenu');return !!m&&!m.hidden})()"))
    chk('no page errors in scenario A', not pg.errs, pg.errs)
    ctx.close()

    # ============================ B. mock cloud processor connected ============================
    now = int(time.time() * 1000)
    def frames_for(prod, n, step):
        return [{'t': now - (n - 1 - i) * step * 60000, 'bbox': [-100, 20, -60, 50], 'crs': '4326', 'url': f'https://wxproc.test/api/frames/{prod}/{now - (n - 1 - i) * step * 60000}.png'} for i in range(n)]
    PRODS = {'goes-east-conus-C13': (6, 5), 'mrms-reflectivity': (6, 2), 'nexrad-reflectivity-KBOX': (6, 5)}
    def routes_ok(pg):
        def h(route):
            u = route.request.url; path = u.split('wxproc.test/api', 1)[1]
            if path == '/catalog':
                prods = [{'product': k, 'latestObservationUtc': now, 'earliestObservationUtc': now - (n - 1) * st * 60000, 'frameCount': n} for k, (n, st) in PRODS.items()]
                return route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps({'schema': 'wxstudio.frames.v1', 'products': prods}))
            if path.startswith('/manifests/'):
                prod = path.split('/')[2].replace('.json', '')
                return route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps({'schema': 'wxstudio.frames.v1', 'product': prod, 'frames': frames_for(prod, *PRODS[prod])}))
            if path.startswith('/frames/'):
                return route.fulfill(status=200, content_type='image/png', headers={'access-control-allow-origin': '*'}, body=PNG)
            route.fulfill(status=404, body='')
        pg.route('https://wxproc.test/**', h)
    ctx, pg = fresh(b, "window.WX_WEATHER_PROCESSOR_URL='https://wxproc.test/api'", routes_ok)
    pg.wait_for_timeout(800)
    pg.click('#dlBar .dl-source'); pg.wait_for_timeout(300)
    cl = pg.evaluate("[document.querySelector('#wxws .ws-cloud .ws-pill').textContent,document.querySelector('#wxws .ws-cloud .t').textContent]")
    chk('[mock processor] strip says Connected with product count', cl[0] == 'Connected' and '3 live NOAA products' in cl[1], cl)
    head(pg, 'Satellite').click(); pg.wait_for_timeout(100)
    conn = pg.evaluate("[...document.querySelectorAll('#wxws #wxws-satellite .ws-chip')].filter(c=>!c.disabled).map(c=>c.closest('.ws-sector').querySelector('b').textContent+':'+c.textContent)")
    chk('[mock processor] exactly the decoded satellite product turns selectable', conn == ['CONUS:Clean IR 2 km'], conn)
    chk('[mock processor] satellite summary shows 1 connected', pg.evaluate("document.querySelector('#wxws .ws-sh[aria-controls=wxws-satellite] i').textContent")=='1 connected')
    pg.locator('#wxws #wxws-satellite .ws-chip:not([disabled])').click(); pg.wait_for_timeout(1800)
    d = dl(pg); chk('[mock processor] picking it selects goes-east-conus-C13 with its real history lengths', d['source'] == 'goes-east-conus-C13' and d['hours'] == 1, d)
    st = pg.evaluate("(()=>{const sc=WX.S.show.scenes[WX.S.si],r=WXData.state.get(sc);return [r.status,r.frames.filter(f=>f.img).length]})()")
    chk('[mock processor] frames load for the chosen product', st == ['ready', 6], st)
    live = pg.evaluate("document.querySelector('#wxws [data-live]').textContent"); chk('[mock processor] layer card shows Frame i of 6 + time', live.startswith('Frame ') and ' of 6' in live, live)
    pill_txt = pg.evaluate("document.querySelector('#wxws .ws-card .ws-pill').textContent"); chk('[mock processor] layer pill is Connected', pill_txt == 'Connected')
    pal_note = pg.evaluate("(()=>{WXWeatherWorkspace.ui.sections.palettes=true;WXWeatherWorkspace.render();return document.getElementById('wxws-palettes').textContent})()")
    chk('[mock processor] pre-colored frames: palette choice is "saved with the scene", not claimed live', 'arrive already colored' in pal_note, '')
    head(pg, 'Radar').click(); pg.wait_for_timeout(100)
    rows = pg.evaluate("Object.fromEntries([...document.querySelectorAll('#wxws #wxws-radar .ws-row')].map(r=>[r.querySelector('b').textContent,[r.querySelector('.ws-pill').textContent,r.disabled]]))")
    chk('[mock processor] native MRMS + NEXRAD reflectivity become Connected, velocity stays Not connected', rows['MRMS reflectivity — native'] == ['Connected', False] and rows['Base reflectivity · Level II'] == ['Connected', False] and rows['Radial velocity · Level II'][0] == 'Not connected', rows)
    chk('[mock processor] the experimental preview is replaced, not shown as native', rows['NOAA MRMS · Northeast preview'][0] == 'Not connected', rows['NOAA MRMS · Northeast preview'])
    pg.locator('#wxws #wxws-radar .ws-row', has_text='MRMS reflectivity — native').click(); pg.wait_for_timeout(1500)
    chk('[mock processor] choosing native MRMS selects source mrms', dl(pg)['source'] == 'mrms')
    head(pg, 'Cloud & data status').click(); pg.wait_for_timeout(100)
    stx = pg.evaluate("document.getElementById('wxws-status').textContent")
    chk('[mock processor] status lists decoded products and what the labels mean', 'goes-east-conus-C13' in stx and 'never NOAA data' in stx and 'Experimental' in stx)
    pg.screenshot(path=S + 'B_connected.png')
    chk('no page errors in scenario B', not pg.errs, pg.errs)
    ctx.close()

    # ============================ C. processor unreachable / D. reachable but empty ============================
    def routes_fail(pg): pg.route('https://wxproc.test/**', lambda r: r.abort())
    ctx, pg = fresh(b, "window.WX_WEATHER_PROCESSOR_URL='https://wxproc.test/api'", routes_fail); pg.wait_for_timeout(800)
    pg.click('#dlBar .dl-source'); pg.wait_for_timeout(300)
    cl = pg.evaluate("[document.querySelector('#wxws .ws-cloud .ws-pill').textContent,document.querySelector('#wxws .ws-cloud .t').textContent]")
    chk('[unreachable processor] strip says Not connected / unreachable', cl[0] == 'Not connected' and 'unreachable' in cl[1].lower(), cl)
    head(pg, 'Satellite').click(); chk('[unreachable processor] no satellite chip selectable', pg.evaluate("[...document.querySelectorAll('#wxws #wxws-satellite .ws-chip')].every(c=>c.disabled)"))
    ctx.close()
    def routes_empty(pg): pg.route('https://wxproc.test/**', lambda r: r.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps({'schema': 'wxstudio.frames.v1', 'products': []})))
    ctx, pg = fresh(b, "window.WX_WEATHER_PROCESSOR_URL='https://wxproc.test/api'", routes_empty); pg.wait_for_timeout(800)
    pg.click('#dlBar .dl-source'); pg.wait_for_timeout(300)
    cl = pg.evaluate("[document.querySelector('#wxws .ws-cloud .ws-pill').textContent,document.querySelector('#wxws .ws-cloud .ws-pill').className]")
    chk('[empty processor] says "No fresh data" (never Connected)', cl[0] == 'No fresh data' and 'connected' not in cl[1].split(), cl)
    ctx.close()
    b.close()

fails = [r for r in res if not r[1]]
print('\n%d checks, %d passed, %d failed' % (len(res), len(res) - len(fails), len(fails)))
sys.exit(1 if fails else 0)
