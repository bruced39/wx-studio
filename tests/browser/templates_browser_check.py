"""Real-browser check of the headline / storm bar templates (v0.10.1.2): artwork attached, banner title and bar text centred and fitted,
2-line wrapping, auto-fit on/off, autosave keeps the artwork out of the saved copy and loadShow restores it.
Usage: python3 wxbuild.py && python3 tests/browser/templates_browser_check.py [screenshot_dir]   (needs playwright + Chromium)"""
from playwright.sync_api import sync_playwright
import pathlib, sys, tempfile, os
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxtpl_')) + '/'; os.makedirs(OUT, exist_ok=True)
res = []
def chk(n, ok, info=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n, '' if ok else info)
STORM = ['Timing: latest track and timing may have slowed the start time for rainfall Fri/Sat AM', 'Change in the track and speed will shift where the heaviest rain occurs',
         'Confidence remains high that southeastern MA, Cape & Islands will see the strongest wind gusts', 'Coastal flooding & beach erosion still remain along the coast. Power outages still possible.']
MAKE = """([k,t,l])=>{const E=WX.E,art=E.TPL_ART[k];WX.S.show.assets[art.asset]=window.WX_TPL[art.asset];const sc=E.sceneFromTemplate(k,{title:t,lines:l,safe:48},null);
  WX.S.show.scenes=[sc];WX.S.si=0;WX.commit();return {n:sc.objects.length,asset:sc.bg.asset,t2:sc.title2,art,bars:art.bars,bounds:sc.objects.map(o=>E.bounds(o)),sizes:sc.objects.map(o=>o.size)}}"""
# pixel boxes drawn by the stage: dark navy text in the banner area, white text inside each bar
PIX = """([reg,bars,inset])=>{const cv=[...document.querySelectorAll('canvas')].find(c=>c.width===1920&&c.height===1080);if(!cv)return null;const c=cv.getContext('2d');
  const box=(x0,y0,x1,y1,test)=>{x0=Math.round(x0);y0=Math.round(y0);const w=Math.round(x1-x0),h=Math.round(y1-y0),d=c.getImageData(x0,y0,w,h).data;let l=w,r=-1,t=h,b=-1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(test(d[i],d[i+1],d[i+2])){if(x<l)l=x;if(x>r)r=x;if(y<t)t=y;if(y>b)b=y;}}
    return r<0?null:{cx:x0+(l+r)/2,cy:y0+(t+b)/2,w:r-l,h:b-t}};
  const title=box(reg.l,reg.cy-reg.h/2,reg.r,reg.cy+reg.h/2,(r,g,b)=>r<70&&g<90&&b<140&&b>r+15);
  const rows=bars.map(B=>box(B.x+inset[0],B.y+inset[1],B.x+B.w-inset[0],B.y+B.h-inset[1],(r,g,b)=>r>235&&g>235&&b>235));return {title,rows}}"""
with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox']); pg = br.new_page(viewport={'width': 1700, 'height': 960}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(2500); ev = pg.evaluate
    ev("document.getElementById('modalBg').style.display='none'")
    kinds = ['hl-sky', 'hl-night', 'hl-day', 'storm-night', 'storm-day']
    chk('five templates listed', ev("WX.E.TEMPLATES.map(t=>t[0])") [:5] == kinds, ev("WX.E.TEMPLATES"))
    chk('old red/glass panel templates are gone from the list', not any(k in ('storm', 'headlines') for k in ev("WX.E.TEMPLATES.map(t=>t[0])")))
    for k in kinds:
        info = ev(MAKE, [k, 'Weather Headlines' if 'hl' in k else 'Storm Update', STORM]); pg.wait_for_timeout(1200)
        pg.locator('#stage').screenshot(path=OUT + 'tpl_%s.png' % k)
        art = info['art']; tag = k + ': '
        chk(tag + 'artwork attached and 4 bar texts', info['asset'] == art['asset'] and info['n'] == 4, info['n'])
        chk(tag + 'banner title is text-only with a region', info['t2']['textOnly'] and info['t2']['region'] and info['t2']['show'])
        inside = all(b['x'] >= bb['x'] - 1 and b['x'] + b['w'] <= bb['x'] + bb['w'] + 1 and b['y'] >= bb['y'] - 1 and b['y'] + b['h'] <= bb['y'] + bb['h'] + 1 for b, bb in zip(info['bounds'], info['bars']))
        chk(tag + 'every text block fits inside its bar', inside, [info['bounds'], info['bars']])
        px = ev(PIX, [art['banner'], art['bars'], [art['padX'] + 20, art['padY'] + 6]])
        t = px['title']; R = art['banner']
        chk(tag + 'title centred in the white banner area', t and abs(t['cx'] - (R['l'] + R['r']) / 2) <= 14 and abs(t['cy'] - R['cy']) <= 10, (t, R))
        okrows = all(r and abs(r['cx'] - (b['x'] + b['w'] / 2)) <= 16 and abs(r['cy'] - (b['y'] + b['h'] / 2)) <= 12 for r, b in zip(px['rows'], art['bars']))
        chk(tag + 'bar text centred in each bar', okrows, px['rows'])
    # two-line wrapping + shrink-to-fit + switches
    info = ev(MAKE, ['storm-night', 'Storm Update', STORM + []])
    lines = ev("WX.S.show.scenes[0].objects.map(o=>{const b=WX.E.bounds(o);return Math.round(b.h/(o.size*1.15))})")
    chk('each bar text is at most 2 lines', all(n <= 2 for n in lines), lines)
    ev("(()=>{const o=WX.S.show.scenes[0].objects[0];o.text='A '.repeat(80);WX.commit();})()")
    big = ev("(()=>{const o=WX.S.show.scenes[0].objects[0],b=WX.E.bounds(o),a=WX.S.show.scenes[0].objects.length;return {h:b.h,hmax:169-36+8,size:o.size}})()")
    chk('very long text shrinks to stay inside the bar', big['h'] <= big['hmax'], big)
    ev("(()=>{const o=WX.S.show.scenes[0].objects[0];o.autoFit=false;o.text='SHORT';o.size=120;})()")
    chk('auto-fit off uses the exact size', ev("(()=>{const b=WX.E.bounds(WX.S.show.scenes[0].objects[0]);return Math.abs(b.h-(120*1.15+8))<3})()"))
    # saving keeps the artwork out of the autosave copy; opening restores it
    ev(MAKE, ['hl-night', 'Weather Headlines', STORM]); pg.wait_for_timeout(600)
    sz = ev("(()=>{let n=0;for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/autosave/.test(k))n=Math.max(n,localStorage.getItem(k).length)}return n})()")
    chk('autosave copy is small (artwork not duplicated)', 0 < sz < 120000, sz)
    ok = ev("""(()=>{const E=WX.E,sc=E.sceneFromTemplate('storm-day',{title:'x',lines:['a'],safe:48},null);WX.loadShow({name:'t',accent:'#2f9bff',scenes:[sc],assets:{}});return WX.S.show.assets['tpl_storm_day']===window.WX_TPL['tpl_storm_day']})()""")
    chk('opening a show restores the template artwork', ok)
    chk('no page errors', not errs, errs)
    br.close()
n = sum(res); print('\n%d/%d checks passed (screenshots in %s)' % (n, len(res), OUT)); sys.exit(0 if n == len(res) else 1)
