"""Real-browser check (v0.10.2.2): NEW map scenes start with the Banner & Logo in the UPPER RIGHT with the logo at 90 % (the layout taken from the
user's own map scene); image/solid scenes keep the old default (upper left, 105 %); a scene that already has a banner keeps it.
Usage: python3 wxbuild.py && python3 tests/browser/map_banner_default_browser_check.py  (needs playwright + Chromium)"""
from playwright.sync_api import sync_playwright
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
res = []
def chk(n, ok, info=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n, '' if ok else info)
T2 = "i=>{const t=WX.S.show.scenes[i].title2;return t?{pos:t.pos,logoScale:t.logoScale,width:t.width,height:t.height,y:t.y,dx:t.dx,autoWidth:t.autoWidth,logo:t.logo,show:t.show,bgType:WX.S.show.scenes[i].bg.type}:null}"
with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox']); pg = br.new_page(viewport={'width': 1700, 'height': 960}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(2000)
    ev = pg.evaluate; ev("document.getElementById('modalBg').style.display='none'")
    def click(sel): ev("s=>document.querySelector(s).click()", sel); pg.wait_for_timeout(700)
    a = ev(T2, 0)
    chk('first (map) scene of a new show: Banner & Logo upper right, logo 90 %', a and a['bgType'] == 'mapbox' and a['pos'] == 'ur' and abs(a['logoScale'] - 0.9) < 1e-9, a)
    chk('…the rest of the layout is unchanged (width 1150, height 154, y 40, offset 0, fit-to-text, logo on)', a and (a['width'], a['height'], a['y'], a['dx'], a['autoWidth'], a['logo']) == (1150, 154, 40, 0, True, True), a)
    chk('…and it starts hidden like before (the user turns it on)', a and a['show'] is False, a)
    click('#bAddScene')
    b = ev(T2, 1)
    chk('a new IMAGE/solid scene keeps the old default (upper left, 105 %)', b and b['bgType'] != 'mapbox' and b['pos'] == 'ul' and abs(b['logoScale'] - 1.05) < 1e-9, b)
    click('#bAddMap')
    c = ev(T2, 2)
    chk('"+ Map" scene (added from an image scene): upper right, logo 90 %', c and c['bgType'] == 'mapbox' and c['pos'] == 'ur' and abs(c['logoScale'] - 0.9) < 1e-9, c)
    click('#bAddMap')
    d = ev(T2, 3)
    chk('"+ Map" again (copy of a map scene): upper right, logo 90 %', d and d['pos'] == 'ur' and abs(d['logoScale'] - 0.9) < 1e-9, d)
    # a scene that already has its own banner is never changed
    ev("()=>{const t=WX.S.show.scenes[0].title2;t.pos='ul';t.logoScale=1.3;t.show=true;WX.commit()}"); click('#bAddMap')
    e0 = ev(T2, 0); e4 = ev(T2, 4)
    chk('an existing banner (user changed it to upper left / 130 %) is left alone', e0 and e0['pos'] == 'ul' and abs(e0['logoScale'] - 1.3) < 1e-9 and e0['show'] is True, e0)
    chk('…while the next new map scene still gets the new default', e4 and e4['pos'] == 'ur' and abs(e4['logoScale'] - 0.9) < 1e-9, e4)
    # the engine default itself (used by templates, old shows and tests) is unchanged
    dd = ev("()=>{const d=WX.E.title2Default();return [d.pos,d.logoScale]}")
    chk('E.title2Default() is unchanged (upper left, 105 %) – old shows/templates behave as before', dd == ['ul', 1.05], dd)
    # the banner really draws at the upper right in a map scene
    r = ev("""()=>{const E=WX.E,sc=WX.S.show.scenes[4];sc.title2.show=true;sc.title2.text='7 DAY FORECAST';const c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d');
      const L=E.title2Layout(sc.title2,x);return L?{keys:Object.keys(L).slice(0,12),barL:L.barL,barW:L.width||L.w||null}:null}""")
    chk('layout helper reports a banner for the new map scene (no exception)', r is not None, r)
    chk('no page errors', not errs, errs)
    br.close()
n = sum(res); print('\n%d/%d checks passed' % (n, len(res))); sys.exit(0 if n == len(res) else 1)
