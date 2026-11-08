"""v0.11.4 integration check (animation steps x v0.10.4.4 scene-switch performance path).
Clicking a scene card now goes through the fast `selectScene` path (no full refresh); the animation step bar must still follow the selected scene.
Usage: python3 wxbuild.py && python3 tests/browser/integration_scene_switch_stepbar_check.py ; exit code 1 on failure."""
from playwright.sync_api import sync_playwright
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, '' if ok else info)
HTML = (ROOT / 'dist' / 'studio.html').as_uri()
SETUP = """()=>{
  const WX=window.WX,E=WX.E,MA=WX.MA||window.MapAnim,sh=WX.S.show;
  const mk=(name,type)=>{const sc=E.newScene({name});sc.bg=type==='map'?{type:'map',theme:'dark',view:{cx:487,cy:305,w:400},cities:false,counties:false}:{type:'solid',color:'#16324f'};sc.transition={type:'cut',dur:0};sc.duration=6;return sc;};
  sh.scenes=[mk('A map','map'),mk('B plain','solid'),mk('C map','map')];sh.mbMigrated=1;WX.loadShow(JSON.parse(JSON.stringify(sh)));
  const s=WX.S.show.scenes; return s.length;}"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1700, 'height': 960}).new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(HTML); pg.wait_for_timeout(2200); pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    chk('three scenes set up', pg.evaluate(SETUP) == 3)
    cards = lambda: pg.locator('#sceneList .sc')
    vis = lambda: pg.evaluate("(()=>{const e=document.getElementById('stepbar');return !!e&&!e.hidden&&e.querySelectorAll('.sbstep').length})()")
    # animate scene A with 3 steps, scene C with 2 steps, using the real buttons
    cards().nth(0).click(); pg.wait_for_timeout(300); pg.click('#bAnimOn'); pg.wait_for_timeout(200)
    for _ in range(2): pg.locator('#stepbar button', has_text='Step').first.click(); pg.wait_for_timeout(150)
    chk('scene A: step bar shows 3 steps', vis() == 3, vis())
    cards().nth(2).click(); pg.wait_for_timeout(300); pg.click('#bAnimOn'); pg.wait_for_timeout(200)
    pg.locator('#stepbar button', has_text='Step').first.click(); pg.wait_for_timeout(150)
    chk('scene C: step bar shows 2 steps', vis() == 2, vis())
    cards().nth(1).click(); pg.wait_for_timeout(300)
    chk('click plain scene B: step bar hidden (not left over from C)', not vis(), vis())
    chk('scene B: the Animate button is hidden (not a map scene)', pg.evaluate("(()=>{const e=document.getElementById('bAnimOn');return !e||e.hidden})()"))
    cards().nth(0).click(); pg.wait_for_timeout(300)
    chk('click A: step bar again shows A\'s 3 steps', vis() == 3, vis())
    cards().nth(2).click(); pg.wait_for_timeout(300)
    chk('click C: step bar shows C\'s 2 steps', vis() == 2, vis())
    chk('switching selects step 1 of the new scene (edit view)', pg.evaluate("document.querySelector('#stepbar .sbstep.on')&&document.querySelector('#stepbar .sbstep.on').dataset.step")=='0')
    # scene switching must not rebuild every card (perf contract) - card elements survive
    pg.evaluate("window.__c0=document.querySelectorAll('#sceneList .sc')[0]"); cards().nth(0).click(); pg.wait_for_timeout(200)
    chk('scene click keeps the same card elements (no full list rebuild)', pg.evaluate("document.querySelectorAll('#sceneList .sc')[0]===window.__c0"))
    chk('no page errors', not errs, errs)
    b.close()
n = sum(1 for r in res if not r[1]); print('\n%d checks, %d failed' % (len(res), n)); sys.exit(1 if n else 0)
