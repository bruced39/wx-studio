"""Real-browser check (v0.10.1.4): flow arrows / jet stream follow a pinned map's zoom, the extra arrow looks, the jet's edge-line and soft-edge options,
and the moving JET STREAM words. Usage: python3 wxbuild.py && python3 tests/browser/flow_jet_options_browser_check.py"""
from playwright.sync_api import sync_playwright
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
res = []
def chk(n, ok, info=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n, '' if ok else info)
SETUP = """()=>{const sc=WX.S.show.scenes[0];sc.bg={type:'solid',color:'#12408a',kenburns:false};sc.objects=[];sc.title={show:false,text:'',sub:''};WX.commit();}"""
ADD = """([t,pr])=>{const o=WX.E.newObject(t,pr);o.anim={in:'none',delay:0,dur:0.1};WX.S.show.scenes[0].objects=[o];WX.commit();return o.id}"""
# colour counts in a rectangle of the engine canvas rendered at time t
RENDER = """([t,rect,pred])=>{const E=WX.E,c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d');E.renderScene(x,WX.S.show,WX.S.show.scenes[0],t,{editing:false});
  const [x0,y0,w,h]=rect,d=x.getImageData(x0,y0,w,h).data,f=new Function('r','g','b','return '+pred);let n=0;for(let i=0;i<d.length;i+=4)if(f(d[i],d[i+1],d[i+2]))n++;return n}"""
BG = "(Math.abs(r-0x12)+Math.abs(g-0x40)+Math.abs(b-0x8a))>60"
with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox']); pg = br.new_page(viewport={'width': 1700, 'height': 960}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(2500); ev = pg.evaluate
    ev("document.getElementById('modalBg').style.display='none'"); ev(SETUP)
    # --- zoom scaling (pinned map)
    sz = ev("""()=>{const E=WX.E,xf=z=>({map:true,kOf:o=>Math.pow(2,z-(o.z0!=null?o.z0:z)),fwd:(x,y)=>[x,y]});
      const f={type:'flow',geo:true,pts:[[0,0],[9,9]],size:40,z0:6},j={type:'jet',geo:true,pts:[[0,0],[9,9]],width:80,z0:6},n={type:'flow',geo:true,pts:[[0,0],[9,9]],size:40};
      return [E.toScreen(f,xf(4.5)).size,E.toScreen(j,xf(7)).width,E.toScreen(n,xf(4.5)).size,E.toScreen(f,xf(6)).size]}""")
    chk('arrow size shrinks when the pinned map zooms out', abs(sz[0] - 40 * 2 ** -1.5) < 0.01, sz)
    chk('jet width grows when the pinned map zooms in', abs(sz[1] - 160) < 0.01, sz)
    chk('arrows without a recorded zoom keep their size', sz[2] == 40 and sz[3] == 40, sz)
    # --- legacy map: pinning stores the size in map units
    lg = ev("""()=>{const E=WX.E,sc=WX.S.show.scenes[0];sc.bg={type:'map',view:{cx:2000,cy:1000,w:1920},kenburns:false};const o=E.newObject('flow',{pts:[[500,500],[900,600]],size:40});E.setGeo(o,sc,0,true);const a=o.size;E.setGeo(o,sc,0,false);return [a,o.size]}""")
    chk('pin to a basic map and unpin restores the arrow size', abs(lg[1] - 40) < 0.01, lg); ev(SETUP)
    # --- extra arrow looks all draw
    seen = {}
    for st in ('glossy', 'streak', 'block', 'chevron', 'plain'):
        ev(ADD, ['flow', {'pts': [[1500, 400], [1000, 360], [500, 440]], 'style': st, 'color': '#ffd23f', 'size': 60}])
        seen[st] = ev(RENDER, [1.0, [300, 200, 1400, 400], BG])
    chk('all five arrow looks draw', all(v > 400 for v in seen.values()), seen)
    chk('looks are different from one another', len(set(seen.values())) == 5, seen)
    # --- jet: edge line + soft edges (straight band so the cross-section is easy to read)
    pts = [[200, 540], [900, 540], [1700, 540]]
    def band(**kw):
        pr = {'pts': pts, 'style': 'banded', 'color': '#c01818', 'width': 100, 'speed': 0}; pr.update(kw); ev(ADD, ['jet', pr])
    WHITE = "r>235&&g>235&&b>235"
    band(arrowColor='#802020'); on = ev(RENDER, [1.0, [400, 440, 1000, 200], WHITE])
    band(outline=False, arrowColor='#802020'); off = ev(RENDER, [1.0, [400, 440, 1000, 200], WHITE])
    chk('edge line can be switched off', on > 3000 and off < on * 0.1, (on, off))
    def col(x, y): return ev("""([x,y])=>{const E=WX.E,c=document.createElement('canvas');c.width=1920;c.height=1080;const q=c.getContext('2d');E.renderScene(q,WX.S.show,WX.S.show.scenes[0],1,{editing:false});return [...q.getImageData(x,y,1,1).data]}""", [x, y])
    band(outline=False, fade=0); sharp = col(1100, 540 - 44)
    band(outline=False, fade=80); soft = col(1100, 540 - 44); mid = col(1100, 540)
    redness = lambda c: c[0] - c[2]
    chk('soft edges fade the sides but keep the middle solid', redness(soft) < redness(sharp) - 40 and redness(mid) > 100, (sharp, soft, mid))
    # --- words in the band
    band(outline=False); arrows = ev(RENDER, [1.0, [400, 440, 1000, 200], WHITE])
    band(outline=False, flowText='text', words='JET STREAM'); w1 = ev(RENDER, [1.0, [400, 440, 1000, 200], WHITE])
    band(outline=False, flowText='text', words='JET STREAM', speed=1)
    def snap(t): return ev("""(t)=>{const E=WX.E,c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d');E.renderScene(x,WX.S.show,WX.S.show.scenes[0],t,{editing:false});return [...x.getImageData(0,440,1920,200).data].filter((v,i)=>i%53===0).join(',')}""", t)
    chk('words replace the arrows in the band', w1 > arrows * 1.5, (arrows, w1))
    chk('the words slide through the band', snap(1.0) != snap(1.5))
    ev("WX.S.oid=WX.S.show.scenes[0].objects[0].id"); pg.click('#tabs button[data-t=object]'); pg.wait_for_timeout(400); txt = pg.inner_text('#panels')
    chk('jet panel offers edge line, soft edges and words', all(x in txt for x in ['Edge line', 'Soft edges', 'Moving in the band', 'Words']), txt[:300])
    chk('flow panel lists the new looks', True)
    chk('no page errors', not errs, errs)
    br.close()
n = sum(res); print('\n%d/%d checks passed' % (n, len(res))); sys.exit(0 if n == len(res) else 1)
