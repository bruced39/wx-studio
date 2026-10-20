"""Real-browser check (v0.10.1.5): Export MP4 can render the whole show (default, unchanged), only the current scene, or a range of scenes.
Uses the same FAKE H.264 encoder as export_browser_check.py (headless Chromium has no real H.264 encoder), so it checks which frames are rendered,
the summary line, the preflight scene numbers and the downloaded file name — not the picture quality. Usage: python3 wxbuild.py && python3 tests/browser/export_scene_picker_browser_check.py"""
from playwright.sync_api import sync_playwright
import json, base64, os, sys, tempfile, pathlib, subprocess, shutil
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxscn_')) + '/'
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


OPEN = "document.getElementById('bExport').click()"
def btn(pg, text): return pg.evaluate("t=>{const b=[...document.querySelectorAll('#modal .mb button')].find(x=>x.textContent===t);if(!b)return null;return !b.disabled}", text)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1700, 'height': 960}, accept_downloads=True); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(2500); ev = pg.evaluate
    ev("document.getElementById('modalBg')&&(document.getElementById('modalBg').style.display='none')")
    if not canned:
        print('SKIP needs ffmpeg for the canned H.264'); sys.exit(0)
    ev(FAKE, canned)
    MK = """(si)=>{const E=WX.E,mk=(n,d,extra)=>E.newScene(Object.assign({name:n,duration:d,bg:{type:'solid',color:'#103050',kenburns:false},title:{show:false,text:'',sub:''},objects:[E.newObject('text',{text:n,x:960,y:540,size:120})]},extra||{}));
      const s3=mk('Impacts',3); s3.objects.push(E.newObject('image',{asset:'img_missing',x:500,y:500,w:200,h:120}));
      WX.loadShow({name:'Evening Show',accent:'#2f9bff',scenes:[mk('Intro',2),mk('Radar',1),s3,mk('Outro: final!',1.5)],assets:{}}); WX.S.si=si; WX.setTab('scene');}"""
    def dialog(si=1):
        ev("localStorage.removeItem('wx.export.v1')"); ev(MK, si); ev(OPEN); pg.wait_for_timeout(900)
    def set_scope(v):
        ev("v=>{const s=[...document.querySelectorAll('#modal select')].find(x=>[...x.options].some(o=>o.value==='all'));s.value=v;s.onchange()}", v); pg.wait_for_timeout(500)
    def set_range(a, z):
        ev("([a,z])=>{const s=[...document.querySelectorAll('#modal select')].filter(x=>x.options.length===4&&[...x.options].every((o,i)=>o.value==String(i)));s[0].value=a;s[1].value=z;s[0].onchange();}", [a, z]); pg.wait_for_timeout(500)
    def summary(): return ev("document.querySelector('#modal .hint').textContent")
    def checks(): return ev("[...document.querySelectorAll('#modal .expcheck > div')].map(d=>d.textContent)")
    def start():
        with pg.expect_download(timeout=60000) as dl: ev("[...document.querySelectorAll('#modal .mb button')].find(b=>b.textContent==='Start export').click()")
        return dl.value.suggested_filename
    def frames(): return ev("window.__fake.n")
    def reset_fake(): ev("window.__fake.n=0;window.__fake.frames=[]")

    dialog(1)
    opts = ev("(()=>{const s=[...document.querySelectorAll('#modal select')].find(x=>[...x.options].some(o=>o.value==='all'));return [...s.options].map(o=>o.text)})()")
    chk('picker offers Whole show, This scene only (named) and a range', len(opts) == 3 and opts[0].startswith('Whole show (4 scenes)') and opts[1] == 'This scene only – 2 · Radar' and opts[2].startswith('A range'), opts)
    chk('the default is the whole show (7.5 s), exactly as before', '7.5 s' in summary() and not summary().startswith('Scene'), summary())
    chk('range pickers are hidden until "A range of scenes" is chosen', ev("[...document.querySelectorAll('#modal div')].some(d=>d.textContent.startsWith('From scene')&&d.parentElement.style.display==='flex')") is False)
    reset_fake(); name = start(); pg.wait_for_timeout(500)
    chk('whole show: 225 frames (7.5 s at 30 fps) and the show name in the file name', frames() == 225 and name == 'Evening_Show_x.mp4', (frames(), name))

    # --- this scene only
    dialog(1); set_scope('one')
    chk('"This scene only" summary names the scene number and is 1.0 s', summary().startswith('Scene 2 only · ') and '1.0 s' in summary(), summary())
    reset_fake(); name = start(); pg.wait_for_timeout(500)
    chk('current scene only: 30 frames, file named after the scene', frames() == 30 and name == 'Radar_x.mp4', (frames(), name))
    chk('the show itself is untouched (still 4 scenes, 7.5 s)', ev("WX.S.show.scenes.length===4&&WX.E.total(WX.S.show)===7.5"))
    dialog(3); set_scope('one'); reset_fake(); name = start(); pg.wait_for_timeout(500)
    chk('scene names are made file-safe', frames() == 45 and name == 'Outro_final_x.mp4', (frames(), name))

    # --- range
    dialog(0); set_scope('range')
    chk('range pickers appear', ev("[...document.querySelectorAll('#modal div')].some(d=>d.textContent.startsWith('From scene')&&d.parentElement.style.display==='flex')") is True)
    set_range('1', '2')
    chk('range 2–3 summary shows scene numbers and 4.0 s', summary().startswith('Scenes 2–3 · ') and '4.0 s' in summary(), summary())
    reset_fake(); name = start(); pg.wait_for_timeout(500)
    chk('range 2–3: 120 frames, file named for the show and range', frames() == 120 and name == 'Evening_Show_scenes_2-3_x.mp4', (frames(), name))
    dialog(0); set_scope('range'); set_range('2', '1')
    chk('a backwards range (3 → 2) is handled the same way', summary().startswith('Scenes 2–3 · '), summary())
    set_range('0', '3'); chk('range covering every scene is the whole show', not summary().startswith('Scene') and '7.5 s' in summary(), summary())
    set_range('1', '1'); chk('range of one scene reads as that scene only', summary().startswith('Scene 2 only · '), summary())

    # --- preflight reports scene numbers from the full show
    dialog(0); set_scope('one'); pg.wait_for_timeout(600)
    chk('missing image in scene 3 is not reported when only scene 1 is exported', not any('Scene 3' in t for t in checks()), checks())
    set_scope('range'); set_range('1', '2'); pg.wait_for_timeout(600)
    chk('it is reported with the real scene number when scenes 2–3 are exported', any('Scene 3' in t and 'img_missing' in t for t in checks()), checks())

    # --- a one-scene show has no range option; reopening starts at the whole show again
    ev("""()=>{const E=WX.E;WX.loadShow({name:'Solo',accent:'#2f9bff',scenes:[E.newScene({name:'Only',duration:2,bg:{type:'solid',color:'#103050',kenburns:false},title:{show:false,text:'',sub:''},objects:[]})],assets:{}});}"""); ev("document.querySelector('#modal .mb button')&&document.getElementById('modalBg').style.display!=='none'&&document.querySelector('#modal .mb button').click()"); ev(OPEN); pg.wait_for_timeout(700)
    opts = ev("(()=>{const s=[...document.querySelectorAll('#modal select')].find(x=>[...x.options].some(o=>o.value==='all'));return [...s.options].map(o=>o.value)})()")
    chk('one-scene show: no range option', opts == ['all', 'one'], opts)
    chk('no page errors', not errs, errs[:3])
    b.close()
bad = [r for r in res if not r[1]]
print(f"\n{len(res) - len(bad)}/{len(res)} checks passed"); sys.exit(1 if bad else 0)
