"""Real-browser (headless Chromium) check of the v0.10.1 portable show file: Save writes a .wxshow package when a show uses
videos/GIFs and the classic .wxshow.json otherwise; Open restores the media into a brand-new browser profile (the "other
computer" case) and keeps it after a reload; damaged/old/missing-media files give plain-language notices; Recent autosaves
keeps safety copies and restores them.
Usage: python3 wxbuild.py && python3 tests/browser/showfile_browser_check.py [screenshot_dir]
Needs playwright + Chromium and ffmpeg (for a tiny WebM and GIF). Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import json, os, sys, tempfile, pathlib, subprocess, shutil, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxsf_')) + '/'
os.makedirs(S, exist_ok=True)
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, info if not ok or info else '')
T = tempfile.mkdtemp(prefix='wxsf_media_')
if not shutil.which('ffmpeg'):
    print('SKIP showfile browser check: ffmpeg not available'); sys.exit(0)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15', '-t', '2', '-c:v', 'libvpx', '-b:v', '300k', T + '/loop.webm'], check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=8', '-t', '1', T + '/radar.gif'], check=True)

SHOW = r"""([withVideo])=>{const E=WX.E,mk=(n,bg)=>E.newScene({name:n,duration:4,bg,title:{show:false,text:'',sub:''},objects:[]});
  const ids=Object.keys(E.videos);
  const sc=[mk('Open',withVideo&&ids[0]?{type:'video',vid:ids[0],fit:'fill'}:{type:'solid',color:'#103050',kenburns:false}),
            mk('Radar',withVideo&&ids[1]?{type:'video',vid:ids[1],fit:'blur'}:{type:'solid',color:'#204060',kenburns:false}),
            mk('Outlook',{type:'solid',color:'#304050',kenburns:false})];
  WX.loadShow({name:'Portable test',accent:'#2f9bff',scenes:sc,assets:{}});}"""

def upload(pg):
    pg.evaluate("WX.setTab('bgs')"); pg.wait_for_timeout(200)
    pg.evaluate("[...document.querySelectorAll('#panels button, .panel button, button')].find(b=>b.textContent==='Videos').click()"); pg.wait_for_timeout(200)
    pg.set_input_files('input[type=file][accept*="video"]', [T + '/loop.webm']); pg.wait_for_timeout(800)
    pg.set_input_files('input[type=file][accept*="video"]', [T + '/radar.gif']); pg.wait_for_timeout(1500)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1700, 'height': 960}, accept_downloads=True); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(2500)
    ev = pg.evaluate
    ev("document.getElementById('modalBg')&&(document.getElementById('modalBg').style.display='none')")
    chk('WXShowFile loaded and the save indicator opens Recent autosaves', ev("!!window.WXShowFile && typeof document.getElementById('saveState').onclick==='function'"))

    # ---- light show -> classic .wxshow.json ----
    ev(SHOW, [False])
    with pg.expect_download() as d: ev("document.getElementById('bSave').click()")
    dl = d.value; light = S + dl.suggested_filename; dl.save_as(light)
    chk('light show saves as .wxshow.json', dl.suggested_filename == 'Portable_test.wxshow.json', dl.suggested_filename)
    j = json.load(open(light)); chk('light file keeps the classic show shape plus a format header', j.get('format') == 'wx-studio-show' and len(j['scenes']) == 3 and 'assets' in j)

    # ---- show with video + GIF -> .wxshow package ----
    upload(pg)
    nvid = ev("Object.keys(WX.E.videos).length"); chk('video and GIF uploaded in the browser', nvid == 2, nvid)
    ev(SHOW, [True]); pg.wait_for_timeout(400)
    vids = ev("Object.keys(WX.E.videos).map(k=>[k,!!WX.E.videos[k].gif,WX.E.videos[k].blob.size])")
    with pg.expect_download() as d: ev("document.getElementById('bSave').click()")
    dl = d.value; pkg = S + dl.suggested_filename; dl.save_as(pkg); pg.wait_for_timeout(300)
    chk('show with media saves as .wxshow', dl.suggested_filename == 'Portable_test.wxshow', dl.suggested_filename)
    z = zipfile.ZipFile(pkg); names = sorted(z.namelist())
    chk('package is a valid ZIP with manifest, show and two media files', z.testzip() is None and 'manifest.json' in names and 'show.json' in names and len([n for n in names if n.startswith('media/')]) == 2, names)
    man = json.loads(z.read('manifest.json')); chk('manifest lists both media with checksums and nothing missing', len([m for m in man['media'] if m.get('file')]) == 2 and not man['missing'] and all('crc32' in m for m in man['media'] if m.get('file')))
    chk('media bytes in the package equal the originals', sorted(z.getinfo(n).file_size for n in names if n.startswith('media/')) == sorted(v[2] for v in vids))
    chk('saving says what it did', 'Saved Portable_test.wxshow' in ev("document.getElementById('toast').textContent"), ev("document.getElementById('toast').textContent"))

    # ---- the "other computer": fresh profile, nothing in IndexedDB ----
    ctx2 = b.new_context(viewport={'width': 1700, 'height': 960}, accept_downloads=True); pg2 = ctx2.new_page(); errs2 = []
    pg2.on('pageerror', lambda e: errs2.append(str(e))); pg2.on('dialog', lambda d: d.accept())
    pg2.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg2.wait_for_timeout(2500)
    pg2.evaluate("document.getElementById('modalBg')&&(document.getElementById('modalBg').style.display='none')")
    chk('fresh browser has no videos', pg2.evaluate("Object.keys(WX.E.videos).length") == 0)
    pg2.set_input_files('#fileOpen', pkg); pg2.wait_for_timeout(2500)
    chk('opened with no warning dialog', pg2.evaluate("document.getElementById('modalBg').style.display!=='flex'"), pg2.evaluate("document.getElementById('modal').textContent"))
    chk('show restored: name and three scenes', pg2.evaluate("WX.S.show.name==='Portable test' && WX.S.show.scenes.length===3"))
    chk('both media restored and decoded', pg2.evaluate("Object.keys(WX.E.videos).length===2 && Object.values(WX.E.videos).every(v=>v.ok||v.gif)"), pg2.evaluate("JSON.stringify(Object.values(WX.E.videos).map(v=>[v.id,v.ok,v.w,v.h,v.err]))"))
    chk('scene backgrounds point at the restored media', pg2.evaluate("WX.S.show.scenes.slice(0,2).every(s=>s.bg.type==='video'&&WX.E.videos[s.bg.vid])"))
    pg2.evaluate("WX.E.preload && 0");
    px = pg2.evaluate("""()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const x=c.getContext('2d');WX.E.renderShow(x,WX.S.show,0.5,0,{});const d=x.getImageData(0,0,320,180).data;let s=0,sq=0;for(let i=0;i<d.length;i+=4){const v=d[i]+d[i+1]+d[i+2];s+=v;sq+=v*v}const n=d.length/4;return Math.sqrt(sq/n-(s/n)*(s/n))}""")
    chk('restored video actually draws (picture has detail, not a flat placeholder)', px > 20, px)
    pg2.screenshot(path=S + 'opened_package.png')
    pg2.reload(); pg2.wait_for_timeout(2500)
    chk('media is still there after a reload (stored in the new browser)', pg2.evaluate("Object.keys(WX.E.videos).length")==2, pg2.evaluate("Object.keys(WX.E.videos).length"))

    # ---- Recent autosaves keeps safety copies ----
    pg2.evaluate("document.getElementById('saveState').click()"); pg2.wait_for_timeout(500)
    txt = pg2.evaluate("document.getElementById('modal').textContent")
    chk('Recent lists the safety copy taken before opening the file', 'Before opening Portable_test.wxshow' in txt and 'safety copy' in txt, txt[:200])
    pg2.screenshot(path=S + 'recent_dialog.png')
    pg2.evaluate("[...document.querySelectorAll('#modal button')].find(x=>x.textContent==='Restore').click()"); pg2.wait_for_timeout(800)
    chk('Restore brings an earlier copy back and takes a safety copy first', pg2.evaluate("WX.S.show.scenes.length>=1") and 'Restored' in pg2.evaluate("document.getElementById('toast').textContent"), pg2.evaluate("document.getElementById('toast').textContent"))
    pg2.evaluate("document.getElementById('saveState').click()"); pg2.wait_for_timeout(400)
    chk('restoring itself left a recoverable safety copy', 'Before restoring' in pg2.evaluate("document.getElementById('modal').textContent"))
    pg2.evaluate("document.querySelector('#modal .mb button').click()")

    # ---- error handling ----
    bad = S + 'damaged.wxshow'; raw = bytearray(open(pkg, 'rb').read())
    open(bad, 'wb').write(bytes(raw[:-300]))
    pg2.set_input_files('#fileOpen', bad); pg2.wait_for_timeout(800)
    t = pg2.evaluate("document.getElementById('modal').textContent")
    chk('truncated file gives a plain message and leaves the show alone', 'Could not open' in t and ('damaged' in t or 'incomplete' in t) and pg2.evaluate("WX.S.show.scenes.length")>=1, t[:160])
    pg2.evaluate("document.querySelector('#modal .mb button').click()")
    junk = S + 'notashow.wxshow.json'; open(junk, 'w').write('{"hello":1}')
    pg2.set_input_files('#fileOpen', junk); pg2.wait_for_timeout(500)
    chk('non-show file refused', 'not a WX Studio show' in pg2.evaluate("document.getElementById('modal').textContent"))
    pg2.evaluate("document.querySelector('#modal .mb button').click()")
    old = S + 'old_with_video.wxshow.json'; sh = json.load(open(light)); sh.pop('format', None); sh.pop('formatVersion', None); sh['scenes'][0]['bg'] = {'type': 'video', 'vid': 'vid_gone', 'fit': 'fill'}
    json.dump(sh, open(old, 'w'))
    pg2.set_input_files('#fileOpen', old); pg2.wait_for_timeout(800)
    t = pg2.evaluate("document.getElementById('modal').textContent")
    chk('older-style file that points at a video explains it is not available', 'not available here' in t and 'vid_gone' in t, t[:240])
    pg2.evaluate("document.querySelector('#modal .mb button').click()")
    chk('the light .wxshow.json still opens', (pg2.set_input_files('#fileOpen', light), pg2.wait_for_timeout(600), pg2.evaluate("WX.S.show.name==='Portable test' && WX.S.show.scenes.length===3"))[2])

    # ---- Save with missing media warns and records it ----
    pg2.evaluate(SHOW, [True]); pg2.wait_for_timeout(300)
    pg2.evaluate("delete WX.E.videos[Object.keys(WX.E.videos)[1]]")
    msgs = []; pg2.remove_listener('dialog', pg2.listeners('dialog')[0]) if False else None
    pg2.on('dialog', lambda d: msgs.append(d.message))
    with pg2.expect_download() as d: pg2.evaluate("document.getElementById('bSave').click()")
    dl = d.value; p2 = S + 'missing_' + dl.suggested_filename; dl.save_as(p2)
    chk('missing media: user is warned before saving', any('not in this browser' in m for m in msgs), msgs)
    m2 = json.loads(zipfile.ZipFile(p2).read('manifest.json')); chk('missing media is recorded in the manifest', len(m2['missing']) == 1 and len([x for x in m2['media'] if x.get('file')]) == 1, m2['missing'])

    chk('no page errors (main)', not errs, errs[:3]); chk('no page errors (second profile)', not errs2, errs2[:3])
    b.close()
bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad))); sys.exit(1 if bad else 0)
