"""Real-browser check of banner #2 (title2): fit-to-text growth, left/right offset, height, text centred in the silver panel,
legacy shows unchanged. Usage: python3 wxbuild.py && python3 tests/browser/banner2_browser_check.py  (needs playwright + Chromium)."""
from playwright.sync_api import sync_playwright
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
res = []
def chk(n, ok, info=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n, '' if ok else info)
# draw the banner over a solid bg and measure its opaque bounds from the engine canvas
MEASURE = """([T,text,legacy])=>{const E=WX.E,sc=WX.S.show.scenes[0];sc.bg={type:'solid',color:'#30506f',kenburns:false};sc.objects=[];sc.title={show:false,text:'',sub:''};
  const d=E.title2Default();if(legacy){delete d.autoWidth;delete d.height;}sc.title2=Object.assign(d,T,{text,show:true});WX.commit();return true}"""
BOUNDS = """()=>{const cv=[...document.querySelectorAll('canvas')].find(c=>c.width===1920&&c.height===1080);if(!cv)return null;
  const c=cv.getContext('2d'),W=1920,H=300,im=c.getImageData(0,0,W,H).data,bg=[0x30,0x50,0x6f];let l=W,r=0,t=H,b=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,d=Math.abs(im[i]-bg[0])+Math.abs(im[i+1]-bg[1])+Math.abs(im[i+2]-bg[2]);if(d>60){if(x<l)l=x;if(x>r)r=x;if(y<t)t=y;if(y>b)b=y;}}
  return {l,r,t,b,w:r-l,h:b-t}}"""
with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox']); pg = br.new_page(viewport={'width': 1700, 'height': 960}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(2000)
    ev = pg.evaluate; ev("document.getElementById('modalBg').style.display='none'")
    def m(T, text, legacy=False):
        ev(MEASURE, [T, text, legacy]); pg.wait_for_timeout(500); return ev(BOUNDS)
    sh = m({'pos': 'ur'}, '7 DAY FORECAST'); lo = m({'pos': 'ur'}, 'SATELLITE & RADAR FOR EASTERN NEW ENGLAND')
    sm = m({'pos': 'ur', 'size': 40}, 'SATELLITE & RADAR FOR EASTERN NEW ENGLAND')
    dx = m({'pos': 'ur', 'dx': -200}, '7 DAY FORECAST'); tall = m({'pos': 'ur', 'height': 200}, '7 DAY FORECAST')
    leg = m({'pos': 'ur', 'width': 940}, '7 DAY FORECAST', True)
    chk('bounds measured', all([sh, lo, sm, dx, tall, leg]))
    if all([sh, lo, sm, dx, tall, leg]):
        chk('longer text widens the banner', lo['w'] > sh['w'] + 100, (sh, lo))
        chk('upper-right banner grows leftward (right edge fixed)', abs(lo['r'] - sh['r']) <= 3, (sh, lo))
        chk('smaller text shortens the banner', sm['w'] < lo['w'] - 100, (lo, sm))
        chk('height unchanged by text length', abs(lo['h'] - sh['h']) <= 3, (sh, lo))
        chk('offset slider moves the banner left', abs((sh['l'] - dx['l']) - 200) <= 3 and abs((sh['r'] - dx['r']) - 200) <= 3, (sh, dx))
        chk('height control makes the banner taller', tall['h'] > sh['h'] + 20, (sh, tall))
        chk('legacy banner keeps its fixed width', 900 < leg['w'] < 960, leg)
    chk('no page errors', not errs, errs)
    br.close()
n = sum(res); print('\n%d/%d checks passed' % (n, len(res))); sys.exit(0 if n == len(res) else 1)
