"""Real-browser (headless Chromium) check of the H / L pressure-centre badge artwork (studio/hl_art.js + Sym.drawHL).
Usage: python3 wxbuild.py && python3 tests/browser/hl_badge_browser_check.py [screenshot_dir]
Renders real scenes through the engine (the same path preview and export use) onto a solid-color background and samples pixels.
Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import os, sys, tempfile, pathlib, base64, json
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxhl_')) + '/'
os.makedirs(S, exist_ok=True)
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, info if not ok else '')
HTML = (ROOT / 'dist' / 'studio.html').as_uri()
BG = (42, 138, 58)

RENDER = """(spec)=>{
  const WX=window.WX,sc=WX.S.show.scenes[WX.S.si];
  sc.bg={type:'solid',color:spec.bg};sc.objects=spec.objs.map(o=>WX.E.newObject('hl',o));sc.dataLoop=null;
  const cv=document.createElement('canvas');cv.width=1920;cv.height=1080;const c=cv.getContext('2d');
  WX.E.renderScene(c,WX.S.show,sc,spec.t,{editing:false});
  const px=(x,y)=>Array.from(c.getImageData(x,y,1,1).data);
  window.__png=cv.toDataURL();
  return spec.pts.map(p=>px(p[0],p[1]));
}"""

def fresh(b, init=None):
    ctx = b.new_context(viewport={'width': 1700, 'height': 960});
    if init: ctx.add_init_script(init)
    pg = ctx.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.goto(HTML); pg.wait_for_timeout(2200)
    pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    return ctx, pg
def near(a, b, tol): return all(abs(x - y) <= tol for x, y in zip(a[:3], b[:3]))

H0 = dict(x=700, y=540, size=300, kind='H', value='1030')
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = fresh(b)
    ready = False
    for _ in range(40):
        ready = pg.evaluate("window.WXHLBadgeReady&&window.WXHLBadgeReady()")
        if ready: break
        pg.wait_for_timeout(100)
    chk('both badge images decoded (H and L)', ready)
    chk('artwork is embedded as two transparent PNG data URLs', pg.evaluate("Object.keys(WX_HL_ART).sort().join()")=='H,L' and pg.evaluate("Object.values(WX_HL_ART).every(u=>u.startsWith('data:image/png;base64,'))"))

    # --- decoding starts at page load: a render in a brand-new page (nothing called yet) already uses the badge, not the fallback letter ---
    ctx0, pg0 = fresh(b)
    top = pg0.evaluate(RENDER, dict(bg='#%02x%02x%02x' % BG, t=1.5, objs=[H0], pts=[(700, 540 - 165)]))[0]
    chk('first-ever render uses the badge artwork (metallic ring at the top, not the drawn letter)', abs(top[0] - top[2]) < 40 and top[0] > 70 and top[3] == 255 and not near(top, BG, 30), top)
    ctx0.close()
    # --- the artwork itself, decoded in the browser: real alpha, no white halo ---
    for k in ('H', 'L'):
        a = pg.evaluate('''async (k)=>{const im=new Image();im.src=WX_HL_ART[k];await im.decode();const n=im.naturalWidth,cv=document.createElement('canvas');cv.width=cv.height=n;const c=cv.getContext('2d');c.drawImage(im,0,0);
          const d=c.getImageData(0,0,n,n).data,A=(x,y)=>d[(y*n+x)*4+3];let semi=0,halo=0;
          for(let i=0;i<d.length;i+=4){const al=d[i+3];if(al>0&&al<255){semi++;if(al>20&&(d[i]+d[i+1]+d[i+2])/3>200)halo++}}
          return {n,corners:[A(0,0),A(n-1,0),A(0,n-1),A(n-1,n-1)],center:A(n>>1,n>>1),semi,halo}}''', k)
        chk('%s artwork: all four corners fully transparent, center opaque, 720px' % k, a['corners'] == [0, 0, 0, 0] and a['center'] == 255 and a['n'] == 720, a)
        chk('%s artwork: soft shadow present but no white halo pixels' % k, a['semi'] > 1000 and a['halo'] == 0, a)
    # --- H at (700,540) size 300: inside-circle blue, corner of the image square = pure background (transparent), pill dark ---
    H = dict(x=700, y=540, size=300, kind='H', value='1030')
    pts = [(700, 400), (535, 375), (865, 375), (700 - 128, 774), (700, 540 + 230), (700 + 235, 540)]
    r = pg.evaluate(RENDER, dict(bg='#%02x%02x%02x' % BG, t=1.5, objs=[H], pts=pts))
    inside, corner_tl, corner_br, pill = r[0], r[1], r[2], r[3]   # the two top corners of the image square (the pill sits below)
    chk('H: inside the ring is the badge blue', inside[2] > 150 and inside[0] < 40 and inside[3] == 255, inside)
    chk('H: corner of the image square (outside the circle) shows the background (no box)', near(corner_tl, BG, 30) and near(corner_br, BG, 30), [corner_tl, corner_br])
    chk('H: value pill is drawn below the badge (dark navy)', pill[0] < 60 and pill[1] < 75 and pill[2] < 95, pill)
    open(S + 'hl_H_render.png', 'wb').write(base64.b64decode(pg.evaluate("window.__png").split(',')[1]))

    # --- L at (1300,540), old default size 200, value 1000 ---
    L = dict(x=1300, y=540, size=200, kind='L', value='1000')
    r = pg.evaluate(RENDER, dict(bg='#%02x%02x%02x' % BG, t=1.5, objs=[L], pts=[(1300, 540 - 90), (1300 - 110, 540 - 110), (1300, 540 - 90)]))
    chk('L: inside the ring is the badge red', r[0][0] > 150 and r[0][1] < 40 and r[0][2] < 40, r[0])
    chk('L: corner of the image square is the background (no box)', near(r[1], BG, 30), r[1])

    # --- both on a light bright background: no white box / halo anywhere around the badge ---
    LIGHT = (240, 232, 178)
    ring = [(700 + int(190 * __import__('math').cos(a)), 540 + int(190 * __import__('math').sin(a))) for a in [i * 0.7 for i in range(9)]]
    r = pg.evaluate(RENDER, dict(bg='#%02x%02x%02x' % LIGHT, t=1.5, objs=[dict(H, value='')], pts=[(535, 375), (865, 375), (535, 705), (865, 705)]))
    chk('on a light background the image-square corners show no white/grey box (never brighter than the background, close to it)', all(near(x, LIGHT, 40) and sum(x[:3]) <= sum(LIGHT) + 12 for x in r), r)
    open(S + 'hl_light_render.png', 'wb').write(base64.b64decode(pg.evaluate("window.__png").split(',')[1]))

    # --- animation: pulsing ring + bob keep working, the badge stays in place ---
    a = pg.evaluate(RENDER, dict(bg='#%02x%02x%02x' % BG, t=1.5, objs=[H], pts=[(700, 400)]))[0]
    bb = pg.evaluate(RENDER, dict(bg='#%02x%02x%02x' % BG, t=2.4, objs=[H], pts=[(700, 400)]))[0]
    chk('badge still renders at another animation time (pulse/bob do not hide it)', bb[2] > 150 and bb[0] < 40, [a, bb])
    # --- small size uses the mip chain and still reads as a badge ---
    r = pg.evaluate(RENDER, dict(bg='#%02x%02x%02x' % BG, t=1.5, objs=[dict(x=700, y=540, size=60, kind='H', value='')], pts=[(700, 540 - 24), (700 - 33, 540 - 33)]))
    chk('small H (size 60): blue inside, background at the corner', r[0][2] > 120 and near(r[1], BG, 30), r)
    # --- existing saved objects (no new fields) draw; no value -> no pill ---
    r = pg.evaluate(RENDER, dict(bg='#%02x%02x%02x' % BG, t=1.5, objs=[dict(x=960, y=540, size=200, kind='H', value='')], pts=[(960, 540 + 0.78 * 200), (960, 540 - 90)]))
    chk('old-style H without a pressure value: badge drawn, no pill', near(r[0], BG, 30) and r[1][2] > 150, r)
    # --- bounds for selection ---
    bnds = pg.evaluate("Sym.hlBounds(100,100,200)")
    chk('selection bounds cover badge + pill', bnds == {'x': -24, 'y': -24, 'w': 248, 'h': 320}, bnds)
    # --- the editor itself: add an H and an L with the real tools and look at the stage ---
    pg.evaluate("(()=>{const WX=window.WX,sc=WX.S.show.scenes[WX.S.si];sc.bg={type:'solid',color:'#16324f'};sc.dataLoop=null;sc.objects=[WX.E.newObject('hl',{x:620,y:520,size:240,kind:'H',value:'1034'}),WX.E.newObject('hl',{x:1250,y:560,size:240,kind:'L',value:'998'})];WX.commit&&WX.commit()})()")
    pg.wait_for_timeout(800); pg.screenshot(path=S + 'hl_editor.png')
    chk('no page errors', not pg.errs, pg.errs)
    ctx.close()

    # ============ fallback: artwork missing -> original drawn letters, nothing disappears ============
    ctx, pg = fresh(b, "Object.defineProperty(window,'WX_HL_ART',{set(){},get(){return undefined}})")
    r = pg.evaluate("""(()=>{const WX=window.WX,sc=WX.S.show.scenes[WX.S.si];sc.bg={type:'solid',color:'#2a8a3a'};sc.dataLoop=null;sc.objects=[WX.E.newObject('hl',{x:700,y:540,size:300,kind:'H',value:'1030'})];
      const cv=document.createElement('canvas');cv.width=1920;cv.height=1080;const c=cv.getContext('2d');WX.E.renderScene(c,WX.S.show,sc,1.5,{editing:false});
      const d=c.getImageData(500,300,400,500).data;let blue=0;for(let i=0;i<d.length;i+=4)if(d[i+2]>200&&d[i]<90&&d[i+1]<160&&d[i+3]===255)blue++;return blue})()""")
    chk('fallback (no artwork): the drawn blue letter H still appears', r > 500, r)
    chk('no page errors in fallback', not pg.errs, pg.errs)
    ctx.close(); b.close()

fails = [r for r in res if not r[1]]
print('\n%d checks, %d passed, %d failed' % (len(res), len(res) - len(fails), len(fails)))
sys.exit(1 if fails else 0)
