"""Real-browser check (headless Chromium) that map animation steps are rendered at GEOGRAPHIC positions while the map camera moves and zooms
(v0.11.0). Mapbox tiles are not available in headless mode, so MB.xf is replaced by an exact Web-Mercator projection with the same contract
(fwd [lng,lat]->pixel, inv pixel->[lng,lat]); everything else (E.xf, kOf zoom scaling via z0, E.objectsAt, E.renderScene) is the real code.
Usage: python3 wxbuild.py && python3 tests/browser/map_animation_geo_browser_check.py [screenshot_dir]"""
from playwright.sync_api import sync_playwright
import os, sys, tempfile, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxgeo_')) + '/'
os.makedirs(S, exist_ok=True)
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, ('' if ok else info))
HTML = (ROOT / 'dist' / 'studio.html').as_uri()

SETUP = """()=>{
  const E=WX.E;
  const mer=(lng,lat)=>{const s=Math.sin(lat*Math.PI/180);return [(lng+180)/360, 0.5-Math.log((1+s)/(1-s))/(4*Math.PI)]};
  const unm=(x,y)=>[x*360-180, Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI];
  MB.xf=(bg,cam)=>{const c=cam.c,z=cam.z,sz=512*Math.pow(2,z),m0=mer(c[0],c[1]);
    return {fwd:(lng,lat)=>{const m=mer(lng,lat);return [960+(m[0]-m0[0])*sz,540+(m[1]-m0[1])*sz]},
            inv:(x,y)=>unm(m0[0]+(x-960)/sz,m0[1]+(y-540)/sz)}};
  const bg={type:'mapbox',mbStyle:'broadcast',proj:'mercator',theme:'dark',region:'eastma',grad:'sky',color:'#101820',asset:null,dim:0,kenburns:false,
            view:{c:[-71.5,42.4],z:6,b:0,p:0},view2:{c:[-70.4,42.0],z:7.6,b:0,p:0},camDelay:0,camDur:3};
  const mk=(id,x,y,fill)=>{const o=E.newObject('shape',{id,geo:true,shape:'ellipse',x,y,w:36,h:36,fill,stroke:fill,lw:0,z0:6});o.anim={in:'none',delay:0,dur:0.01};return o};
  const sc=E.newScene({name:'Map',duration:4,bg,title:{show:false,text:'',sub:''},objects:[mk('m1',-72.0,42.9,'#ff0000'),mk('m2',-71.0,42.2,'#00ff00')]});
  const show={name:'geo',accent:'#2f9bff',scenes:[sc],assets:{},mbMigrated:1};
  WX.loadShow(show);
  const s=WX.S.show.scenes[0]; MapAnim.enable(s); MapAnim.setStep(s,0,{hold:1}); MapAnim.addStep(s,0,{hold:1,dur:2,ease:'linear',simplify:false});
  const o1=s.anim.steps[1].objects; o1[0].x=-70.2; o1[0].y=42.0; o1[1].x=-71.8; o1[1].y=41.6; MapAnim.normalize(s);
  return s.duration;}"""

CHECK = """(t)=>{
  const WX=window.WX,E=WX.E,sc=WX.S.show.scenes[0],cv=document.createElement('canvas');cv.width=1920;cv.height=1080;const c=cv.getContext('2d');
  E.renderScene(c,WX.S.show,sc,t,{editing:false});
  const xf=E.xf(sc,t),objs=MapAnim.objectsAt(sc,t),out={};
  const px=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=1920||y>=1080)return null;return Array.from(c.getImageData(x,y,1,1).data)};
  objs.forEach(o=>{const so=E.toScreen(o,xf);out[o.id]={cx:so.x+so.w/2,cy:so.y+so.h/2,w:so.w,lng:o.x,lat:o.y,pix:px(so.x+so.w/2,so.y+so.h/2),away:px(so.x+so.w/2+so.w*1.6,so.y+so.h/2)}});
  let h=0;const d=c.getImageData(0,0,1920,1080).data;for(let i=0;i<d.length;i+=97)h=(h*31+d[i])>>>0;out.hash=h;
  return out;}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={'width': 1500, 'height': 900}).new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(HTML); pg.wait_for_timeout(2000)
    pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    dur = pg.evaluate(SETUP); pg.wait_for_timeout(300)
    chk('animated map scene: total 1 + 2 + 1 s', abs(dur - 4) < 1e-9, dur)
    red = lambda q: q and q[0] > 200 and q[1] < 60 and q[2] < 60
    green = lambda q: q and q[1] > 200 and q[0] < 60 and q[2] < 60
    for t in (0.2, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5):
        r = pg.evaluate(CHECK, t)
        chk('t=%.1f: both markers drawn at their geographic place while the camera moves (marker pixel found)' % t, red(r['m1']['pix']) and green(r['m2']['pix']), (r['m1']['pix'], r['m2']['pix']))
        chk('t=%.1f: marker size follows the camera zoom (kOf), edge outside is empty' % t, not red(r['m1']['away']) and r['m1']['w'] > 36 * 0.99, (r['m1']['w'], r['m1']['away']))
    # mid-move = geographic midpoint, NOT the pixel-midpoint of the two end positions seen through different cameras
    r1, r2, rm = pg.evaluate(CHECK, 1.0), pg.evaluate(CHECK, 3.0), pg.evaluate(CHECK, 2.0)
    chk('mid-move is the geographic midpoint of the stored positions', abs(rm['m1']['lng'] - (-72.0 + -70.2) / 2) < 1e-9 and abs(rm['m1']['lat'] - (42.9 + 42.0) / 2) < 1e-9, rm['m1'])
    pm = ((r1['m1']['cx'] + r2['m1']['cx']) / 2, (r1['m1']['cy'] + r2['m1']['cy']) / 2)
    chk('…which differs from a screen-pixel interpolation (camera zoom/pan changes in between)', ((pm[0] - rm['m1']['cx']) ** 2 + (pm[1] - rm['m1']['cy']) ** 2) ** .5 > 20, (pm, rm['m1']['cx'], rm['m1']['cy']))
    # deterministic scrubbing: any order / repetition gives identical pictures
    ts = [2.2, 0.4, 3.7, 1.9, 2.2, 0.4]; hs = [pg.evaluate(CHECK, t)['hash'] for t in ts]
    chk('scrubbing back and forth is deterministic (same time = same picture)', hs[0] == hs[4] and hs[1] == hs[5], hs)
    chk('different times give different pictures', len(set(hs)) >= 4, hs)
    # the camera at t uses the SAME time as the objects: camera animation unchanged by steps
    chk('camera path unchanged (view→view2 over 3 s)', pg.evaluate("(()=>{const sc=WX.S.show.scenes[0],a=WX.E.viewAt(sc,0),b=WX.E.viewAt(sc,3),m=WX.E.viewAt(sc,1.5);return Math.abs(a.z-6)<1e-9&&Math.abs(b.z-7.6)<1e-9&&m.z>6.5&&m.z<7.1})()"))
    # saved document is untouched by all that rendering
    chk('rendering never changes the saved scene', pg.evaluate("(()=>{const s=JSON.stringify(WX.S.show.scenes[0]);for(let t=0;t<4;t+=0.25){const cv=document.createElement('canvas');cv.width=1920;cv.height=1080;WX.E.renderScene(cv.getContext('2d'),WX.S.show,WX.S.show.scenes[0],t,{editing:false});}return s===JSON.stringify(WX.S.show.scenes[0])})()"))
    # show-level time (scene is not first) and renderShow path used by preview + export
    chk('renderShow (preview/export path) draws the same picture as renderScene', pg.evaluate("""()=>{const WX=window.WX,E=WX.E,A=document.createElement('canvas'),B=document.createElement('canvas');A.width=B.width=1920;A.height=B.height=1080;
      E.renderShow(A.getContext('2d'),WX.S.show,2.2,{editing:false});E.renderScene(B.getContext('2d'),WX.S.show,WX.S.show.scenes[0],2.2,{editing:false});
      const a=A.getContext('2d').getImageData(0,0,1920,1080).data,bb=B.getContext('2d').getImageData(0,0,1920,1080).data;for(let i=0;i<a.length;i++)if(a[i]!==bb[i])return false;return true}"""))
    chk('no drawing errors / page errors', not errs and pg.evaluate("!WX.E.lastErr"), errs)
    b.close()
bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad)))
sys.exit(1 if bad else 0)
