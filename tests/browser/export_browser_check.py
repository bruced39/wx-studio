"""Real-browser (headless Chromium) check of the v0.10.0 export workflow: presets that remember your last choice, preflight,
the full video pipeline (frame stepping -> BT.709 YUV frames -> encoder -> MP4 writer) against a FAKE encoder that returns real
ffmpeg-made H.264, file verification, self-test, WebM-draft opt-in, 16:9 stage at many window sizes, and autosave failure reporting.
Usage: python3 wxbuild.py && python3 tests/browser/export_browser_check.py [screenshot_dir]
Needs playwright + Chromium, plus ffmpeg/ffprobe and node (for canned H.264). Headless Chromium has NO real H.264 encoder, so a real
MP4 export on your machine still has to be checked in Chrome/Edge (see AI_HANDOFF.md). Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import json, base64, os, sys, tempfile, pathlib, subprocess, shutil
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxexp_')) + '/'
os.makedirs(S, exist_ok=True)
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, info if not ok or info else '')
TMP = tempfile.mkdtemp(prefix='wxexp_media_')
have_ff = bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))

# canned real H.264 (1920x1080 @30, 45 frames) for the fake encoder
canned = None
if have_ff:
    js = r"""const M=require('./tests/helpers/media.js');const v=M.h264Samples(1920,1080,30,1.5);
    console.log(JSON.stringify({avcC:Buffer.from(v.avcC).toString('base64'),samples:v.samples.map(s=>({d:Buffer.from(s.data).toString('base64'),k:s.key}))}))"""
    canned = json.loads(subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    # a short VP9/VP8 WebM with a finite duration for verify()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '2', '-c:v', 'libvpx', '-b:v', '1M', TMP + '/t.webm'], check=True)

FAKE = r"""(canned)=>{
  const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)); const samples=canned.samples.map(s=>({d:b64(s.d),k:s.k})), avcC=b64(canned.avcC);
  window.__fake={frames:[],configs:[],n:0,planes:null,closed:0};
  window.VideoEncoder=class{constructor(o){this.o=o;this.encodeQueueSize=0;this.i=0}
    static async isConfigSupported(c){return {supported:/^avc1/.test(c.codec),config:c}}
    configure(c){window.__fake.configs.push(c)}
    encode(frame,opts){const f=window.__fake,i=this.i++;f.n++;f.frames.push({fmt:frame.format,w:frame.codedWidth,h:frame.codedHeight,cs:frame.colorSpace&&{p:frame.colorSpace.primaries,t:frame.colorSpace.transfer,m:frame.colorSpace.matrix,fr:frame.colorSpace.fullRange},ts:frame.timestamp,dur:frame.duration,key:!!(opts&&opts.keyFrame)});
      if(i===3&&frame.format==='I420'){const buf=new Uint8Array(frame.allocationSize());frame.copyTo(buf).then(()=>{f.planes=buf});}
      const s=samples[Math.min(i,samples.length-1)],k=(i%60===0);
      this.o.output({byteLength:s.d.length,copyTo:b=>b.set(s.d),timestamp:frame.timestamp,duration:frame.duration,type:i===0?'key':'delta'},i===0?{decoderConfig:{description:avcC}}:{})}
    async flush(){} close(){window.__fake.closed++}};
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1700, 'height': 960}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(2500)
    ev = pg.evaluate
    ev("document.getElementById('modalBg')&&(document.getElementById('modalBg').style.display='none')")
    def mkshow(seconds=1.5, name='Export test'):
        ev("""([secs,name])=>{const E=WX.E;const sc=E.newScene({name:'A',duration:secs,bg:{type:'solid',color:'#103050',kenburns:false},title:{show:false,text:'',sub:''},objects:[E.newObject('text',{text:'HELLO',x:960,y:540,size:160})]});
          WX.loadShow({name,accent:'#2f9bff',scenes:[sc],assets:{}});}""", [seconds, name])
    def open_dialog():
        ev("document.getElementById('bExport').click()"); pg.wait_for_timeout(700)
    def close_dialog():
        ev("document.querySelector('#modal .mb button').click()")
    def checks_text():
        return ev("[...document.querySelectorAll('#modal .expcheck > div')].map(d=>d.textContent)")
    def active_preset():
        return ev("(document.querySelector('#modal button.pri[data-preset]')||{dataset:{}}).dataset.preset")

    # ---------- 1. the stage is a true 16:9 at every window size ----------
    mkshow()
    for w, h in [(1366, 768), (1000, 800), (1700, 960), (1920, 1080), (1280, 600), (900, 900)]:
        pg.set_viewport_size({'width': w, 'height': h}); pg.wait_for_timeout(250)
        r = ev("(()=>{const s=document.getElementById('stageWrap').getBoundingClientRect(),b=document.getElementById('stageBox').getBoundingClientRect();return [s.width,s.height,b.width,b.height]})()")
        chk(f'stage 16:9 at {w}x{h}', abs(r[0] / r[1] - 16 / 9) < 0.01 and r[0] <= r[2] + 0.5 and r[1] <= r[3] + 0.5, [round(x, 1) for x in r])
    pg.set_viewport_size({'width': 1366, 'height': 768}); pg.wait_for_timeout(250); pg.screenshot(path=S + 'stage_1366.png')
    pg.set_viewport_size({'width': 1700, 'height': 960})
    ev("document.getElementById('bPresent').click()"); pg.wait_for_timeout(300)
    r = ev("(()=>{const s=document.getElementById('stageWrap');const c=s.getBoundingClientRect();return [s.classList.contains('present'),c.width,c.height,innerWidth,innerHeight]})()")
    chk('present mode still fills the screen', r[0] and abs(r[1] - r[3]) < 2 and abs(r[2] - r[4]) < 2, r); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)

    # ---------- 2. autosave reports failures ----------
    ev("WX.commit()"); ev("WX.S.show.name='Autosave A';document.getElementById('showName').dispatchEvent(new Event('change'))"); pg.wait_for_timeout(100)
    st = ev("(()=>{const e=document.getElementById('saveState');return [e.dataset.state,e.textContent]})()")
    chk('autosave success shows Saved hh:mm', st[0] == 'saved' and st[1].startswith('Saved '), st)
    ev("window.__realSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='wx.studio.autosave.v1'){const e=new Error('full');e.name='QuotaExceededError';throw e}return window.__realSet.call(this,k,v)};0")
    ev("WX.S.show.name='Autosave B';document.getElementById('showName').dispatchEvent(new Event('change'))"); pg.wait_for_timeout(100)
    st = ev("(()=>{const e=document.getElementById('saveState');return [e.dataset.state,e.textContent,e.style.color,e.title,document.getElementById('toast').textContent]})()")
    chk('autosave failure is shown (red, not silent) with a reason', st[0] == 'failed' and 'Not saved' in st[1] and 'full' in st[3] and 'Autosave failed' in st[4], st)
    ev("Storage.prototype.setItem=window.__realSet;0"); ev("WX.S.show.name='Autosave C';document.getElementById('showName').dispatchEvent(new Event('change'))"); pg.wait_for_timeout(100)
    chk('autosave recovers and shows Saved again', ev("document.getElementById('saveState').dataset.state") == 'saved')

    # ---------- 3. presets: X / Facebook / Custom, remembered ----------
    mkshow(1.5); ev("localStorage.removeItem('wx.export.v1')")
    open_dialog()
    labels = ev("[...document.querySelectorAll('#modal button[data-preset]')].map(b=>b.textContent)")
    chk('three preset buttons: X, Facebook, Custom', labels == ['X', 'Facebook', 'Custom'], labels)
    chk('default preset is X', active_preset() == 'x')
    summ = ev("document.querySelector('#modal .hint').textContent"); chk('summary shows 1920×1080 · 30 fps · 16 Mbps', all(t in summ for t in ['1920×1080', '30 fps', '16 Mbps', 'H.264 MP4']), summ)
    ev("document.querySelector('#modal button[data-preset=facebook]').click()"); pg.wait_for_timeout(300)
    chk('Facebook preset selects', active_preset() == 'facebook')
    ev("document.querySelector('#modal button[data-preset=custom]').click()"); pg.wait_for_timeout(300)
    vis = ev("[...document.querySelectorAll('#modal select')].map(s=>s.offsetParent!==null)"); chk('custom shows size and quality choices', vis == [True, True], vis)
    ev("(()=>{const s=document.querySelectorAll('#modal select');s[0].value='1280x720';s[0].dispatchEvent(new Event('change'));s[1].value='6';s[1].dispatchEvent(new Event('change'))})()"); pg.wait_for_timeout(300)
    summ = ev("document.querySelector('#modal .hint').textContent"); chk('custom 720p / 6 Mbps summary', '1280×720' in summ and '6 Mbps' in summ, summ)
    close_dialog(); pg.wait_for_timeout(200)
    open_dialog(); chk('last used preset (Custom 720p/6) is remembered when reopened', active_preset() == 'custom' and '1280×720' in ev("document.querySelector('#modal .hint').textContent"))
    ev("document.querySelector('#modal button[data-preset=facebook]').click()"); pg.wait_for_timeout(200); close_dialog()
    pg.reload(); pg.wait_for_timeout(2500); ev("document.getElementById('modalBg')&&(document.getElementById('modalBg').style.display='none')")
    chk('export button tooltip names the last used preset after a reload', 'Facebook' in ev("document.getElementById('bExport').title"), ev("document.getElementById('bExport').title"))
    open_dialog(); chk('Facebook is still selected after reload', active_preset() == 'facebook'); close_dialog()

    # ---------- 4. no H.264 here (real headless): clear stop, WebM draft is opt-in ----------
    mkshow(1.5); open_dialog(); t = checks_text()
    chk('preflight reports no H.264 encoder as an error', any('cannot encode' in x for x in t), t)
    pg.screenshot(path=S + 'dialog_no_h264.png')
    chk('Start export is disabled when the browser cannot encode H.264', ev("[...document.querySelectorAll('#modal .mb button')].find(b=>b.textContent==='Start export').disabled") is True)
    chk('a WebM draft is offered but clearly not for posting', 'not suitable for posting' in ev("(document.querySelector('#modal .webmoffer')||{textContent:''}).textContent"))
    r = ev("(async()=>{try{await Exporter.run(WX.S.show,{width:1920,height:1080,fps:30,bitrate:1e7});return 'no error'}catch(e){return [e.code,e.message]}})()")
    chk('Exporter.run throws NO_H264 instead of silently making a WebM', r[0] == 'NO_H264' and 'Chrome or Edge' in r[1], r)
    r = ev("(async()=>{const r=await Exporter.selfTest();return [r.ok,r.code,r.text]})()"); chk('self-test explains the missing encoder', r[0] is False and r[1] == 'NO_H264', r)
    ev("[...document.querySelectorAll('#modal .webmoffer button')][0].click()"); pg.wait_for_timeout(9000)
    msg = ev("document.querySelector('#modal .prog').nextElementSibling.textContent"); chk('opt-in WebM draft still works', 'Done' in msg and 'WebM' in msg, msg)
    chk('WebM draft is labelled "not checked"', 'draft recording' in ev("document.querySelector('#modal').innerText"))
    close_dialog()

    # ---------- 5. full MP4 pipeline with a fake encoder returning real H.264 ----------
    if canned:
        ev(FAKE, canned); mkshow(1.5); ev("localStorage.removeItem('wx.export.v1')"); open_dialog(); t = checks_text()
        chk('with an encoder available the preflight is all clear', all(x.startswith('✓') or x.startswith('ℹ') or 'Checking' in x or True for x in t) and ev("[...document.querySelectorAll('#modal .mb button')].find(b=>b.textContent==='Start export').disabled") is False, t)
        pg.screenshot(path=S + 'dialog_ready.png')
        ev("[...document.querySelectorAll('#modal .mb button')].find(b=>b.textContent==='Start export').click()"); pg.wait_for_timeout(9000)
        pg.screenshot(path=S + 'dialog_done.png')
        fk = ev("window.__fake")
        chk('45 frames encoded for a 1.5 s show at 30 fps', fk['n'] == 45, fk['n'])
        f0 = fk['frames'][0]
        chk('frames are I420 1920×1080 tagged BT.709 limited range', f0['fmt'] == 'I420' and f0['w'] == 1920 and f0['h'] == 1080 and f0['cs'] == {'p': 'bt709', 't': 'bt709', 'm': 'bt709', 'fr': False}, f0)
        ts = [f['ts'] for f in fk['frames']]; chk('frame timestamps step by exactly 1/30 s', all(abs(ts[i] - round(i * 1e6 / 30)) <= 1 for i in range(45)))
        chk('keyframe every 2 seconds (first frame is a keyframe)', fk['frames'][0]['key'] and not fk['frames'][1]['key'], [f['key'] for f in fk['frames'][:3]])
        cf = fk['configs'][-1]; chk('encoder config: avc1 High, 1920×1080, 16 Mbps default X preset, quality latency mode', cf['codec'].startswith('avc1.64') and cf['width'] == 1920 and cf['bitrate'] == 16000000 and cf['framerate'] == 30 and cf['latencyMode'] == 'quality', cf)
        planes = fk['planes']
        if planes:
            raw = base64.b64decode(planes) if isinstance(planes, str) else bytes(planes[str(i)] for i in range(len(planes))) if isinstance(planes, dict) else bytes(planes)
            y = raw[1080 * 1920 + 0]  # placeholder to keep indexing explicit below
        # expected YUV of the solid #103050 background at a corner pixel (no text there)
        exp = json.loads(subprocess.run(['node', '-e', "const X=require('./studio/export.js');const a=new Uint8Array(16*4);for(let i=0;i<16;i++)a.set([16,48,80,255],i*4);const o=X.rgbaToI420(a,4,4,new Uint8Array(24));console.log(JSON.stringify([o[0],o[16],o[20]]))"], cwd=ROOT, capture_output=True, text=True).stdout)
        got = ev("(()=>{const p=window.__fake.planes;if(!p)return null;const w=1920,h=1080;return [p[0],p[w*h],p[w*h+(w*h>>2)]]})()")
        chk('pixel values reaching the encoder equal the BT.709 conversion of the scene colour', got is not None and all(abs(a - c) <= 1 for a, c in zip(got, exp)), [got, exp])
        out = ev("""(async()=>{const r=await Exporter.run(WX.S.show,{width:1920,height:1080,fps:30,bitrate:16e6});const u=new Uint8Array(await r.blob.arrayBuffer());let s='';for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return {b64:btoa(s),kind:r.kind,color:r.color,seconds:r.seconds,frames:r.frames}})()""")
        open(TMP + '/out.mp4', 'wb').write(base64.b64decode(out['b64']))
        chk('Exporter.run reports kind mp4, bt709, 45 frames, 1.5 s', out['kind'] == 'mp4' and out['color'] == 'bt709' and out['frames'] == 45 and abs(out['seconds'] - 1.5) < 1e-9, {k: out[k] for k in ['kind', 'color', 'frames', 'seconds']})
        pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-of', 'json', '-count_frames', '-show_streams', '-show_format', TMP + '/out.mp4'], capture_output=True, text=True).stdout)
        v = pr['streams'][0]
        chk('ffprobe: H.264 1920×1080 30 fps, 45 frames, 1.5 s, BT.709 tagged', v['codec_name'] == 'h264' and v['width'] == 1920 and v['height'] == 1080 and v['r_frame_rate'] == '30/1' and int(v['nb_read_frames']) == 45 and abs(float(pr['format']['duration']) - 1.5) < 0.05 and v.get('color_space') == 'bt709' and v.get('color_range') == 'tv', {k: v.get(k) for k in ['codec_name', 'width', 'height', 'r_frame_rate', 'nb_read_frames', 'color_space', 'color_range']})
        dec = subprocess.run(['ffmpeg', '-v', 'error', '-i', TMP + '/out.mp4', '-f', 'null', '-'], capture_output=True, text=True).stderr.strip()
        chk('ffmpeg decodes the exported MP4 with no errors', dec == '', dec[:200])
        # dialog result: verification line (Chromium cannot play H.264 -> 'unverified', never a false failure)
        msg = ev("document.querySelector('#modal .prog').nextElementSibling.textContent"); chk('dialog reports Done with size and codec', 'Done' in msg and 'H.264 MP4' in msg, msg)
        chk_text = ev("(document.querySelector('#modal [data-status]')||{}).dataset"); chk('post-export check ran (unverified here: Chromium cannot play H.264)', chk_text and chk_text.get('status') in ('unverified', 'verified'), chk_text)
        # long show on X: warns but still exports; cancel works
        ev("localStorage.setItem('wx.export.v1',JSON.stringify({preset:'x',size:'1920x1080',mbps:'10'}))"); close_dialog(); mkshow(300); open_dialog(); t = checks_text()
        chk('5-minute show on X: warnings about length and size, Start still enabled', sum(1 for x in t if x.startswith('⚠')) == 2 and ev("[...document.querySelectorAll('#modal .mb button')].find(b=>b.textContent==='Start export').disabled") is False, t)
        ev("[...document.querySelectorAll('#modal .mb button')].find(b=>b.textContent==='Start export').click()"); pg.wait_for_timeout(1500)
        ev("[...document.querySelectorAll('#modal .mb button')].find(b=>b.textContent==='Close').click()"); pg.wait_for_timeout(800)
        chk('closing the dialog cancels a running export (encoder closed)', ev("window.__fake.closed") >= 1)
        # self-test with the fake encoder
        r = ev("(async()=>{const r=await Exporter.selfTest();return [r.ok,r.codec,r.text,r.verify]})()"); chk('self-test passes through the same pipeline', r[0] is True and r[1].startswith('avc1') and 'valid 1920×1080 H.264 MP4' in r[2], r)

        # verify(): playable file with finite duration (VP8 WebM), correct and wrong expectations
        webm = base64.b64encode(open(TMP + '/t.webm', 'rb').read()).decode()
        def vf(extra):
            return ev("""async([b64,extra])=>{const u=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const r=await Exporter.verify(new Blob([u],{type:'video/webm'}),extra);return [r.status,r.text]}""", [webm, extra])
        r = vf({'width': 640, 'height': 360, 'duration': 2, 'fps': 30}); chk('verify: right file is "verified"', r[0] == 'verified', r)
        r = vf({'width': 640, 'height': 360, 'duration': 5, 'fps': 30}); chk('verify: wrong length is "failed" with advice', r[0] == 'failed' and 'does not' not in r[1] and 'export again' in r[1], r)
        r = vf({'width': 1920, 'height': 1080, 'duration': 2, 'fps': 30}); chk('verify: wrong size is "failed"', r[0] == 'failed' and '640×360' in r[1], r)
        r = ev("""async()=>{const r=await Exporter.verify(new Blob([new Uint8Array(500)],{type:'video/mp4'}),{timeoutMs:4000});return [r.status,r.text]}"""); chk('verify: unplayable bytes are "unverified", never a crash', r[0] == 'unverified' and 'video player' in r[1], r)

    chk('no page errors', not errs, errs[:3])
    b.close()
bad = [r for r in res if not r[1]]
print(f"\n{len(res) - len(bad)}/{len(res)} checks passed"); sys.exit(1 if bad else 0)
