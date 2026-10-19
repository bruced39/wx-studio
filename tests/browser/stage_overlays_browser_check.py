"""Real-browser (headless Chromium) layout check of the in-stage overlays at laptop and smaller editor sizes (v0.10.1, from the
ChatGPT review of v0.10.0): the weather playback bar (#dlBar + its menu and settings), the NEXRAD "Radar sites" button, status
line and site dots must stay inside the 16:9 stage, not be clipped, not overlap each other, and remain clickable.
Usage: python3 wxbuild.py && python3 tests/browser/stage_overlays_browser_check.py [screenshot_dir]
Needs playwright + Chromium; no network or Mapbox token required (layout only). Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import os, sys, tempfile, pathlib, json
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxov_')) + '/'
os.makedirs(S, exist_ok=True)
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, info if not ok else '')
SIZES = [(1920, 1080), (1366, 768), (1280, 720), (1100, 700), (900, 620), (760, 560)]
SETUP = r"""()=>{const E=WX.E,bg={type:'mapbox',mbStyle:'broadcast',broadcastBase:'satellite',proj:'mercator',theme:'dark',region:'eastma',view:null,view2:null,grad:'sky',color:'#101820',asset:null,dim:0,kenburns:false};
  MB.ensureConfig(bg);
  const sc=E.newScene({name:'Map',duration:5,bg,title:{show:false,text:'',sub:''},objects:[]});
  sc.dataLoop={on:true,source:'nexrad',site:'KBOX',hours:1,speed:10,opacity:0.8,showBar:true,idx:0};
  WX.loadShow({name:'ov',accent:'#2f9bff',scenes:[sc],assets:{}});WX.setTool('pan');}"""
RECT = "(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect(),cs=getComputedStyle(e);return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height,vis:cs.display!=='none'&&cs.visibility!=='hidden'&&r.width>0&&r.height>0}}"
CLIP = """()=>{const bar=document.getElementById('dlBar');if(!bar)return null;const br=bar.getBoundingClientRect(),out=[];
  bar.querySelectorAll('button,select,input,span,div').forEach(e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);if(cs.display==='none'||!r.width)return;
    if(e.hidden||e.closest('[hidden]'))return;
    if(r.left<br.left-1||r.right>br.right+1||r.top<br.top-1||r.bottom>br.bottom+1)out.push((e.id||e.className||e.tagName)+':'+Math.round(r.left-br.left)+','+Math.round(br.right-r.right));});
  return {overflow:bar.scrollWidth>bar.clientWidth+1,outside:out.slice(0,6),h:br.height}}"""
inside = lambda a, wr, tol=1.5: a and a['l'] >= wr['l'] - tol and a['r'] <= wr['r'] + tol and a['t'] >= wr['t'] - tol and a['b'] <= wr['b'] + tol
def overlap(a, b): return not (a['r'] <= b['l'] or b['r'] <= a['l'] or a['b'] <= b['t'] or b['b'] <= a['t'])

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1366, 'height': 768}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(2500)
    ev = pg.evaluate
    ev("document.getElementById('modalBg').style.display='none'")
    ev(SETUP); pg.wait_for_timeout(1200)
    for (w, h) in SIZES:
        pg.set_viewport_size({'width': w, 'height': h}); pg.wait_for_timeout(700)
        tag = '%dx%d: ' % (w, h)
        wr = ev(RECT, '#stageWrap'); bar = ev(RECT, '#dlBar'); btn = ev(RECT, '#wxradar-pick-btn')
        chk(tag + 'stage is 16:9', wr and abs(wr['w'] / wr['h'] - 16 / 9) < 0.02, wr and round(wr['w'] / wr['h'], 3))
        chk(tag + 'weather bar visible and inside the stage', bar and bar['vis'] and inside(bar, wr), bar)
        clip = ev(CLIP); chk(tag + 'weather bar controls not clipped', clip and not clip['overflow'] and not clip['outside'], clip)
        chk(tag + 'Radar sites button inside the stage and not under the bar', btn and btn['vis'] and inside(btn, wr) and not overlap(btn, bar), btn)
        # toggle the picker and look at the dots, status line
        ev("document.getElementById('wxradar-pick-btn').click()"); pg.wait_for_timeout(500)
        if ev("document.querySelectorAll('#wxradar-picker .nxsite').length") == 0:   # no Mapbox token here, so the map cannot place the real sites: use percent-positioned stand-ins like the real dots
            ev("()=>{const L=document.getElementById('wxradar-picker');L.style.display='block';[[10,12],[90,12],[50,50],[88,70]].forEach(([x,y])=>{const d=document.createElement('button');d.className='nxsite';d.style.left=x+'%';d.style.top=y+'%';L.append(d)})}")
        st = ev(RECT, '#wxradar-site-status'); dots = ev("[...document.querySelectorAll('#wxradar-picker .nxsite')].map(d=>{const r=d.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height,vis:r.width>0}})")
        chk(tag + 'radar-site status line inside the stage and not over the button', st and inside(st, wr) and not overlap(st, btn), st)
        chk(tag + 'radar site dots drawn and inside the stage', len(dots) > 0 and all(inside(d, wr, 8) for d in dots), len(dots))
        # a dot is reachable by the pointer (not covered by the bar / button / status) — test the one nearest the middle of the stage
        if dots:
            cx, cy = (wr['l'] + wr['r']) / 2, (wr['t'] + wr['b']) / 2; d0 = min(dots, key=lambda d: abs((d['l'] + d['r']) / 2 - cx) + abs((d['t'] + d['b']) / 2 - cy))
            hit = ev("([x,y])=>{const e=document.elementFromPoint(x,y);return e&&(e.className||e.id||e.tagName)}", [(d0['l'] + d0['r']) / 2, (d0['t'] + d0['b']) / 2])
            chk(tag + 'a radar site dot receives the pointer', hit and 'nxsite' in str(hit), hit)
            ev("([x,y])=>document.elementFromPoint(x,y).click()", [(d0['l'] + d0['r']) / 2, (d0['t'] + d0['b']) / 2])
        pg.screenshot(path=S + 'overlay_%dx%d.png' % (w, h))
        ev("document.getElementById('wxradar-pick-btn').click()"); pg.wait_for_timeout(300)
        # open the Weather Data panel from the bar (the real click path) and make sure it stays inside the stage, clear of the bar
        opened = ev("()=>{const b=document.querySelector('#dlBar .dl-source');if(b)b.click();return !!b}")
        pg.wait_for_timeout(500); mn = ev(RECT, '#wxws'); bar = ev(RECT, '#dlBar'); wr = ev(RECT, '#stageWrap')
        if opened and mn and mn['vis']:
            chk(tag + 'Weather Data panel inside the stage', inside(mn, wr, 2), [mn, wr])
            chk(tag + 'Weather Data panel does not cover the playback bar', mn['b'] <= bar['t'] + 2, [mn['b'], bar['t']])
            xb = ev("(()=>{const x=document.querySelector('#wxws button[aria-label=\"Close\"],#wxws .ws-x,#wxws button');if(!x)return null;const r=x.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}})()")
            chk(tag + 'panel has a visible control inside it', xb and xb['w'] > 0, xb)
            sc = ev("(()=>{const m=document.getElementById('wxws');const sc=[m,...m.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(e).overflowY));return {scrolls:!!sc,overflowing:[m,...m.querySelectorAll('*')].some(e=>e.scrollWidth>e.clientWidth+2&&!['auto','scroll'].includes(getComputedStyle(e).overflowX)&&getComputedStyle(e).display!=='inline')}})()")
            chk(tag + 'panel content scrolls inside the panel instead of running off it', sc['scrolls'] or mn['h'] < wr['h'], sc)
            pg.screenshot(path=S + 'panel_%dx%d.png' % (w, h))
            ev("document.querySelector('#wxws button[aria-label=\"Close\"],#wxws button').click()"); pg.wait_for_timeout(200)
        else:
            chk(tag + 'Weather Data panel could be opened for the check', False, [opened, mn])
    chk('no page errors', not errs, errs[:3])
    b.close()
bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad))); sys.exit(1 if bad else 0)
