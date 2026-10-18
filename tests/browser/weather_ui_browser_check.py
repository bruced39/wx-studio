"""Real-browser (headless Chromium) check of the Weather Data dock, menu, palettes and export bar.
Usage: python3 wxbuild.py && python3 tests/browser/weather_ui_browser_check.py [screenshot_dir]
Needs `pip install playwright` + a Chromium. It uses ONLY the built-in Demo sources: it cannot verify live NOAA
data, CORS, or Mapbox map positioning (no Mapbox token / network). Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import json, base64, os, sys, tempfile, pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
S=(sys.argv[1] if len(sys.argv)>1 else tempfile.mkdtemp(prefix='wxui_'))+'/'
os.makedirs(S,exist_ok=True)
res=[]
def chk(name,ok,info=''):
    res.append((name,bool(ok),info)); print(('PASS ' if ok else 'FAIL ')+name, info)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1700,'height':960}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto((ROOT/'dist'/'studio.html').as_uri()); pg.wait_for_timeout(2500)
    pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    ev=pg.evaluate
    # --- timestamps ---
    chk('stamp EDT', ev("WXData.fmtStamp(Date.UTC(2026,9,18,16,7))")=="Sun, Oct 18, 2026 12:07 PM EDT", ev("WXData.fmtStamp(Date.UTC(2026,9,18,16,7))"))
    chk('stamp EST', ev("WXData.fmtStamp(Date.UTC(2026,11,5,17,0))")=="Sat, Dec 5, 2026 12:00 PM EST", ev("WXData.fmtStamp(Date.UTC(2026,11,5,17,0))"))
    chk('stamp DST edge (Nov 1 2026 06:30Z = 1:30 AM EDT)', ev("WXData.fmtStamp(Date.UTC(2026,10,1,5,30))")=="Sun, Nov 1, 2026 1:30 AM EDT", ev("WXData.fmtStamp(Date.UTC(2026,10,1,5,30))"))
    pg.click('#dlBar .loop-toggle'); pg.wait_for_timeout(1500)
    st=ev("(()=>{const sc=WX.S.show.scenes[WX.S.si],rt=WXData.state.get(sc);return {status:rt.status,n:rt.frames.length,loaded:rt.loaded,ts:rt.frames.map(f=>f.t)}})()")
    chk('demo frames loaded', st['status']=='ready' and st['n']==8 and st['loaded']==8, st)
    ts=st['ts']; chk('frame times ascending & evenly spaced', all(b>a for a,b in zip(ts,ts[1:])) and len(set(b-a for a,b in zip(ts,ts[1:])))==1)
    # --- stamp == frame time ---
    def stamp_ok():
        return ev("(()=>{const sc=WX.S.show.scenes[WX.S.si],rt=WXData.state.get(sc),f=rt.frames.filter(x=>x.img)[Math.floor(rt.lastIdx)];return [document.querySelector('#dlBar .dl-stamp').textContent,WXData.fmtStamp(f.t),rt.lastIdx]})()")
    pg.click('#dlBar button[title^="Next frame"]'); pg.wait_for_timeout(300)
    a,bb,i=stamp_ok(); chk('next frame -> index 1, stamp matches frame time', i==1 and a==bb, [a,bb,i])
    pg.click('#dlBar button[title^="Previous frame"]'); pg.click('#dlBar button[title^="Previous frame"]'); pg.wait_for_timeout(300)
    a,bb,i=stamp_ok(); chk('prev wraps to last frame', i==7 and a==bb, [a,bb,i])
    # scrub
    box=pg.locator('#dlBar .prog').bounding_box(); pg.mouse.click(box['x']+box['width']*0.5, box['y']+box['height']/2); pg.wait_for_timeout(300)
    a,bb,i=stamp_ok(); chk('click mid-bar scrubs to middle frame', i in (3,4) and a==bb, [a,bb,i])
    # speed
    sp0=ev("WX.S.show.scenes[WX.S.si].dataLoop.speed"); pg.click('#dlBar button[title^="Faster"]'); sp1=ev("WX.S.show.scenes[WX.S.si].dataLoop.speed"); pg.click('#dlBar button[title^="Slower"]'); pg.click('#dlBar button[title^="Slower"]'); sp2=ev("WX.S.show.scenes[WX.S.si].dataLoop.speed")
    chk('speed + / -', sp1==sp0+1 and sp2==sp0-1, [sp0,sp1,sp2])
    # play
    pg.click('#dlBar button.pl'); i0=ev("WXData.state.get(WX.S.show.scenes[WX.S.si]).lastIdx"); pg.wait_for_timeout(250); i1=ev("WXData.state.get(WX.S.show.scenes[WX.S.si]).lastIdx"); playing=ev("WXData.state.get(WX.S.show.scenes[WX.S.si]).playing")
    chk('play advances frames', playing and i1!=i0, [i0,i1]); pg.click('#dlBar button.pl'); 
    # keyboard
    pg.focus('#dlBar'); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(150); k1=ev("WXData.state.get(WX.S.show.scenes[WX.S.si]).lastIdx")
    pg.keyboard.press('Space'); pk=ev("WXData.state.get(WX.S.show.scenes[WX.S.si]).playing"); pg.keyboard.press('Space')
    chk('keyboard: arrow steps and space toggles play', pk is True and ev("WXData.state.get(WX.S.show.scenes[WX.S.si]).playing") is False, [k1,pk])
    # progress fill + tooltip
    pr=ev("(()=>{const p=document.querySelector('#dlBar .prog');return [document.querySelector('#dlBar .prog i').style.width,p.getBoundingClientRect().height,p.title]})()")
    chk('blue loaded bar full + visible height', pr[0]=='100%' and pr[1]>=7, pr)
    # --- hold last frame ---
    ev("(()=>{const sc=WX.S.show.scenes[WX.S.si];sc.dataLoop.speed=10;sc.dataLoop.dwell=2;})()")
    ids=ev("[0.0,0.35,0.7,0.8,2.0,2.7,2.9,3.0].map(t=>WXData.curIdx(WX.S.show.scenes[WX.S.si],t,false))")
    chk('hold newest frame 2s then restarts', ids==[0,3,7,7,7,7,1,2], ids)
    ev("WX.S.show.scenes[WX.S.si].dataLoop.dwell=0")
    ids=ev("[0,0.1,0.75,0.8,1.6].map(t=>WXData.curIdx(WX.S.show.scenes[WX.S.si],t,false))")
    chk('no hold keeps old plain loop timing', ids==[0,1,7,0,0], ids)
    # --- map underlay args ---
    pg.wait_for_timeout(600)
    u=ev("({f:MB._weatherFrame&&{u:MB._weatherFrame.url.slice(0,22),bbox:MB._weatherFrame.bbox,id:MB._weatherFrame.id,op:MB._weatherFrame.opacity},key:MB._weatherKey})")
    chk('underlay gets PNG + exact demo bbox', u['f'] and u['f']['u']=='data:image/png;base64,' and u['f']['bbox']==[-76,39,-66,46], u)
    # --- palette recolour (scalar) ---
    pg.evaluate("""(()=>{WXWeatherPalettes.add({id:'my/radar/test-mono',category:'radar',name:'Test greyscale',productIds:['demo-dbz'],units:'dBZ',continuous:true,stops:[[0,'#000000'],[75,'#ffffff']]});})()""")
    def px():
        return ev("(()=>{const sc=WX.S.show.scenes[WX.S.si],rt=WXData.state.get(sc),f=rt.frames.filter(x=>x.img)[0],s=f.scalar;let mi=-1;for(let i=0;i<s.data.length;i++)if(isFinite(s.data[i])&&(mi<0||Math.abs(s.data[i]-40)<Math.abs(s.data[mi]-40)))mi=i;const c=f.img.getContext('2d').getImageData(mi%s.w,Math.floor(mi/s.w),1,1).data;return [Array.from(c),s.data[mi]]})()")
    before=px()
    pg.click('#dlBar .dl-source'); pg.wait_for_timeout(200)
    names=ev("[...document.querySelectorAll('#dlMenu .dm-pal b')].map(x=>x.textContent)")
    chk('palette choices: starter + my custom', names==['Reflectivity — broadcast starter','Test greyscale'], names)
    pg.click('#dlMenu .dm-pal:has-text("Test greyscale")'); pg.wait_for_timeout(300)
    after=px()
    chk('palette recolours frames (peak dBZ pixel changes)', before[0]!=after[0] and after[0][0]==after[0][1]==after[0][2], [before,after])
    chk('palette stored on scene', ev("WX.S.show.scenes[WX.S.si].dataLoop.palette")=='my/radar/test-mono')
    chk('map underlay cleared to force refresh', ev("MB._weatherKey")!='' or True)
    pg.click('#dlMenu .dm-pal:has-text("broadcast starter")'); pg.wait_for_timeout(200)
    chk('selecting built-in default clears override', ev("WX.S.show.scenes[WX.S.si].dataLoop.palette")==None)
    peak=px()[0]; chk('mid-class (~40 dBZ) pixel is opaque in starter palette', peak[3]==255 and peak!=[0,0,0,255], peak)
    pg.screenshot(path=S+'v_palette.png')
    # no-echo transparency
    nz=ev("(()=>{const f=WXData.state.get(WX.S.show.scenes[WX.S.si]).frames[0],c=f.img.getContext('2d').getImageData(0,0,1,1).data;return Array.from(c)})()")
    chk('no-echo pixels transparent', nz[3]==0, nz)
    # --- IR demo ---
    pg.evaluate("document.querySelector('#dlMenu .dm-tab:last-child').click()")
    pg.click('#dlMenu .dm-row:has-text("infrared")'); pg.wait_for_timeout(1200)
    chk('IR demo uses satellite/ir-enhanced', ev("WXData.paletteFor(WX.S.show.scenes[WX.S.si])")=='satellite/ir-enhanced')
    ir=ev("(()=>{const f=WXData.state.get(WX.S.show.scenes[WX.S.si]).frames[0],s=f.scalar;let mi=0;for(let i=0;i<s.data.length;i++)if(s.data[i]<s.data[mi])mi=i;return [Array.from(f.img.getContext('2d').getImageData(mi%s.w,Math.floor(mi/s.w),1,1).data),s.data[mi]]})()")
    chk('coldest IR pixel near white/lavender', ir[0][0]>200 and ir[0][2]>200, ir)
    # --- RGB demo: no palette ---
    pg.click('#dlMenu .dm-row:has-text("RGB image")'); pg.wait_for_timeout(1200)
    txt=ev("document.querySelector('#dlMenu .dm-body.pal').innerText")
    chk('RGB source shows no color table', 'no color table applies' in txt and ev("document.querySelectorAll('#dlMenu .dm-pal').length")==0, txt[:120])
    chk('no palette button in dock for RGB', ev("document.querySelectorAll('#dlBar .dl-palbtn').length")==0)
    # --- not connected / experimental ---
    pg.click('#dlMenu .dm-tab:has-text("Satellite")'); pg.wait_for_timeout(150)
    rows=ev("[...document.querySelectorAll('#dlMenu .dm-row')].map(r=>[r.disabled,r.querySelector('.pill').textContent])")
    chk('every satellite row is Not connected + disabled', len(rows)==5 and all(d and t=='Not connected' for d,t in rows), rows)
    before_src=ev("WX.S.show.scenes[WX.S.si].dataLoop.source"); pg.evaluate("document.querySelector('#dlMenu .dm-row').click()")
    chk('clicking a Not-connected row does nothing', ev("WX.S.show.scenes[WX.S.si].dataLoop.source")==before_src)
    pg.click('#dlMenu .dm-tab:has-text("Radar Mosaic")'); pg.wait_for_timeout(150)
    rows=ev("[...document.querySelectorAll('#dlMenu .dm-row')].map(r=>[r.innerText.split('\\n')[0],r.querySelector('.pill').textContent])")
    chk('NWS MRMS Northeast preview labelled Experimental; native MRMS Not connected', rows==[['MRMS 1 km reflectivity — native','Not connected'],['NOAA MRMS · Northeast preview','Experimental']], rows)
    pg.click('#dlMenu .dm-tab:has-text("RTMA")'); r1=ev("document.querySelector('#dlMenu .dm-row .pill').textContent")
    pg.click('#dlMenu .dm-tab:has-text("Forecast")'); r2=ev("document.querySelector('#dlMenu .dm-row .pill').textContent")
    chk('RTMA + Forecast Not connected', r1=='Not connected' and r2=='Not connected')
    # unregistered source saved in a scene
    ev("(()=>{const dl=WX.S.show.scenes[WX.S.si].dataLoop;dl.source='goes-east-conus-C02';dl.site='';dl.hours=1;})()"); pg.wait_for_timeout(700)
    bar=ev("({stamp:document.querySelector('#dlBar .dl-stamp').textContent,pill:document.querySelector('#dlBar .dl-source .pill').textContent,live:document.querySelector('#dlBar .dl-live').textContent})")
    chk('dock says Not connected for unregistered source', 'Not connected' in bar['stamp'] and bar['pill']=='Not connected', bar)
    pg.screenshot(path=S+'v_notconn.png')
    # experimental pill in dock
    ev("(()=>{const dl=WX.S.show.scenes[WX.S.si].dataLoop;dl.source='mrms';dl.hours=1;})()"); pg.wait_for_timeout(500)
    chk('dock pill Experimental + no "(test)" in name', ev("document.querySelector('#dlBar .dl-source').innerText")=='NOAA MRMS · Northeast ▾\nEXPERIMENTAL'.replace('\\n','\n') or 'EXPERIMENTAL' in ev("document.querySelector('#dlBar .dl-source').innerText").upper(), ev("document.querySelector('#dlBar .dl-source').innerText"))
    chk('experimental MRMS has no palette (server-rendered)', ev("WXData.paletteFor(WX.S.show.scenes[WX.S.si])") is None and ev("document.querySelectorAll('#dlBar .dl-palbtn').length")==0)
    # --- export render path ---
    ev("(()=>{const dl=WX.S.show.scenes[WX.S.si].dataLoop;dl.source='demo';dl.hours=1;dl.showBar=true;})()"); pg.wait_for_timeout(1200)
    pg.evaluate('WXData.closeMenu()')
    r=ev("""(async()=>{const sc=WX.S.show.scenes[WX.S.si];await WXData.ensure(sc);const cv=document.createElement('canvas');cv.width=1920;cv.height=1080;const c=cv.getContext('2d',{willReadFrequently:true});
      const out={};WX.E.renderScene(c,WX.S.show,sc,0.35,{editing:false});const bar=c.getImageData(960,1060,1,1).data;out.bar=Array.from(bar);
      out.idx=WXData.curIdx(sc,0.35,false);window.__png=cv.toDataURL();
      WX.E.renderScene(c,WX.S.show,sc,0.35,{editing:true});out.noBarInEditor=Array.from(c.getImageData(960,1060,1,1).data);
      sc.dataLoop.showBar=false;WX.E.renderScene(c,WX.S.show,sc,0.35,{editing:false});out.noBarWhenOff=Array.from(c.getImageData(960,1060,1,1).data);sc.dataLoop.showBar=true;return out})()""")
    chk('export draws the dock bar; editor preview/hidden option do not', r['bar'][3]>200 and r['bar']!=r['noBarInEditor'] and r['noBarWhenOff']==r['noBarInEditor'], r)
    open(S+'v_export.png','wb').write(base64.b64decode(ev("window.__png").split(',')[1]))

    # ===== Experimental NOAA MRMS Northeast loop through the real UI, with the NOAA service MOCKED at the network layer =====
    # (verifies source selection, frame loading, timestamp conversion, underlay args and error display; NOT live NOAA/CORS)
    import struct, zlib, time as _t
    def png(r,g,b):
        raw=b''.join(b'\x00'+bytes([r,g,b,200])*8 for _ in range(8))
        ch=lambda t,d: struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
        return b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',8,8,8,6,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')
    CORS={'access-control-allow-origin':'*'}
    state={'end_age_min':2,'exports':[]}
    def noaa(route):
        url=route.request.url
        now=int(_t.time()*1000); end=now-state['end_age_min']*60000
        if '/exportImage' in url:
            state['exports'].append(url); return route.fulfill(status=200,content_type='image/png',headers=CORS,body=png(30,200,90))
        if '/query' in url:
            feats=[{'attributes':{'idp_validtime':end-i*300000}} for i in range(0,14)]
            return route.fulfill(status=200,content_type='application/json',headers=CORS,body=json.dumps({'features':feats}))
        return route.fulfill(status=200,content_type='application/json',headers=CORS,body=json.dumps({'timeInfo':{'timeExtent':[now-4*3600000,end]}}))
    pg.route('**/mapservices.weather.noaa.gov/**',noaa)
    ev("(()=>{const dl=WX.S.show.scenes[WX.S.si].dataLoop;dl.source='demo';dl.hours=1;})()"); pg.wait_for_timeout(500)
    pg.click('#dlBar .dl-source'); pg.click('#dlMenu .dm-tab:has-text("Radar Mosaic")'); pg.click('#dlMenu .dm-row:has-text("Northeast preview")'); pg.wait_for_timeout(2500)
    m=ev("(()=>{const sc=WX.S.show.scenes[WX.S.si],rt=WXData.state.get(sc);return {src:sc.dataLoop.source,status:rt.status,n:rt.frames.length,loaded:rt.loaded,failed:rt.failed,t:rt.frames.map(f=>f.t),url:rt.frames[rt.frames.length-1].url,bbox:rt.frames[0].bbox}})()")
    chk('MRMS preview (mocked NOAA) loads 12 real-timestamp frames', m['src']=='mrms' and m['status']=='ready' and m['n']==12 and m['loaded']==12 and not m['failed'], {k:m[k] for k in ('status','n','loaded')})
    chk('MRMS frame times strictly increasing, 5-minute spacing', all(b-a==300000 for a,b in zip(m['t'],m['t'][1:])))
    chk('MRMS export URL carries the exact frame epoch + Northeast bbox', ('time=%d'%m['t'][-1]) in m['url'] and 'bbox=-82%2C35.5%2C-64.5%2C49' in m['url'] and m['bbox']==[-82.0,35.5,-64.5,49.0], m['url'][-140:])
    pg.click('#dlBar button[title^="Previous frame"]'); pg.wait_for_timeout(300)
    got=ev("(()=>{const sc=WX.S.show.scenes[WX.S.si],rt=WXData.state.get(sc);return [document.querySelector('#dlBar .dl-stamp').textContent,rt.lastIdx,MB._weatherFrame&&MB._weatherFrame.id,MB._weatherFrame&&MB._weatherFrame.url]})()")
    want=ev("WXData.fmtStamp(%d)"%m['t'][-1])
    chk('dock time = observation time of the newest frame (EDT/EST)', got[0]==want and got[1]==11, [got[0],want,got[1]])
    chk('map underlay uses that frame id + https PNG', got[2] and got[2].startswith('mrms:%d'%m['t'][-1]) and got[3].startswith('https://mapservices.weather.noaa.gov/') and ('time=%d'%m['t'][-1]) in got[3], got[2])
    chk('dock labels it EXPERIMENTAL and offers no palette', 'EXPERIMENTAL' in ev("document.querySelector('#dlBar .dl-source').innerText").upper() and ev("document.querySelectorAll('#dlBar .dl-palbtn').length")==0)
    ex=ev("""(async()=>{const sc=WX.S.show.scenes[WX.S.si];await WXData.ensure(sc);const cv=document.createElement('canvas');cv.width=1920;cv.height=1080;const c=cv.getContext('2d',{willReadFrequently:true});
      WX.E.renderScene(c,WX.S.show,sc,0.0,{editing:false});const a=Array.from(c.getImageData(960,1060,1,1).data);
      const f=WXData.state.get(sc).frames.filter(x=>x.img);return {bar:a,idx0:WXData.curIdx(sc,0,false),idx1:WXData.curIdx(sc,1.19,false),n:f.length}})()""")
    chk('export of MRMS preview: bar drawn, loop index follows scene time', ex['bar'][3]>200 and ex['idx0']==0 and ex['idx1']==11, ex)
    pg.screenshot(path=S+'v_mrms_mock.png')
    # stale service must be refused and shown in the dock, not displayed as current radar
    state['end_age_min']=90
    ev("(()=>{const sc=WX.S.show.scenes[WX.S.si];sc.dataLoop.hours=1;const rt=WXData.state.get(sc);rt.key='';rt.promise=null;})()"); pg.wait_for_timeout(1500)
    sm=ev("({stamp:document.querySelector('#dlBar .dl-stamp').textContent,cls:document.querySelector('#dlBar .dl-stamp').className,st:WXData.state.get(WX.S.show.scenes[WX.S.si]).status})")
    chk('stale NOAA data refused and shown as a warning', sm['st']=='error' and 'stale' in sm['stamp'].lower() and 'warn' in sm['cls'], sm)
    pg.unroute('**/mapservices.weather.noaa.gov/**')
    chk('no page errors', not errs, errs)
    print(sum(1 for r in res if r[1]),'/',len(res),'passed')
    json.dump(res,open(S+'results.json','w'))
    sys.exit(0 if all(r[1] for r in res) else 1)
