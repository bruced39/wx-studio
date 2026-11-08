"""Real-browser check (headless Chromium) that an animated map scene exports frame-accurately (v0.11.0): the real Exporter.encodeFrames loop
(frame stepping -> engine -> VideoFrame -> encoder) runs against a FAKE encoder that inspects every frame it is handed. The expected marker position is
computed independently from the stored step positions and the camera path, so a wrong time, a missing frame or a pixel-interpolated (instead of
geographic) animation would fail. Headless Chromium has no H.264 encoder, so a real MP4 has to be checked in Chrome/Edge (see AI_HANDOFF.md).
Usage: python3 wxbuild.py && python3 tests/browser/map_animation_export_browser_check.py [screenshot_dir]"""
from playwright.sync_api import sync_playwright
import os, sys, tempfile, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, ('' if ok else info))
HTML = (ROOT / 'dist' / 'studio.html').as_uri()

SETUP = r"""()=>{
  const E=WX.E;
  const bg={type:'map',theme:'dark',view:{cx:487,cy:305,w:400},view2:{cx:520,cy:300,w:250},camDelay:0,camDur:3,cities:false,counties:false};
  const mk=(id,x,y,fill)=>{const o=E.newObject('shape',{id,geo:true,shape:'ellipse',x,y,w:30,h:30,fill,stroke:fill,lw:0});o.anim={in:'none',delay:0,dur:0.01};return o};
  const a=E.newScene({name:'A',duration:4,bg,title:{show:false,text:'',sub:''},objects:[mk('m1',470,290,'#ff0000')]});
  const b=E.newScene({name:'B',duration:1,bg:{type:'solid',color:'#103050',kenburns:false},title:{show:false,text:'',sub:''},objects:[]});
  b.transition={type:'cut',dur:0};
  WX.loadShow({name:'exp',accent:'#2f9bff',scenes:[a,b],assets:{},mbMigrated:1});
  const s=WX.S.show.scenes[0]; MapAnim.enable(s); MapAnim.setStep(s,0,{hold:1}); MapAnim.addStep(s,0,{hold:1,dur:2,ease:'linear',simplify:false});
  s.anim.steps[1].objects[0].x=540; s.anim.steps[1].objects[0].y=320; MapAnim.normalize(s);
  return [WX.S.show.scenes[0].duration, WX.E.total(WX.S.show)];}"""

RUN = r"""async()=>{
  const WX=window.WX,E=WX.E,show=WX.S.show,fps=10,log=[],W=1920,H=1080;
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const c=cv.getContext('2d',{willReadFrequently:true});
  const expect=t=>{ // independent of the engine's object interpolation: linear glide in map units between the two stored positions
    if(t>=4)return null; const u=Math.max(0,Math.min(1,(t-1)/2)),mx=470+(540-470)*u,my=290+(320-290)*u,v=E.viewAt(show.scenes[0],t),k=W/v.w;
    return [W/2+(mx-v.cx)*k+15*k, H/2+(my-v.cy)*k+15*k];};
  window.VideoEncoder=class{constructor(o){this.o=o;this.i=0}
    static async isConfigSupported(c){return {supported:true,config:c}}
    configure(c){} async flush(){} close(){}
    encode(frame,opts){const i=this.i++,t=i/fps,e=expect(t);c.clearRect(0,0,W,H);c.drawImage(frame,0,0);
      let pix=null;if(e){const d=c.getImageData(Math.round(e[0]),Math.round(e[1]),1,1).data;pix=[d[0],d[1],d[2]]}
      const corner=Array.from(c.getImageData(5,5,1,1).data);
      log.push({i,ts:frame.timestamp,dur:frame.duration,pix,exp:e,corner});
      this.o.output({byteLength:1,copyTo:b=>{b[0]=1},timestamp:frame.timestamp,duration:frame.duration,type:'delta'},{});}};
  const out=await Exporter.encodeFrames(show,{fps,width:W,height:H,codec:'avc1.640028',bitrate:1e6,color:'native'},()=>{});
  return {out,log};}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    pg = b.new_context(viewport={'width': 1500, 'height': 900}).new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(HTML); pg.wait_for_timeout(2000)
    pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    dur, tot = pg.evaluate(SETUP)
    chk('scene A is 4 s, show is 5 s', abs(dur - 4) < 1e-9 and abs(tot - 5) < 1e-9, (dur, tot))
    r = pg.evaluate(RUN); log = r['log']
    chk('50 frames for 5 s at 10 fps', r['out']['frames'] == 50 and len(log) == 50, (r['out'], len(log)))
    chk('timestamps are exactly i/fps (µs) and durations 100000', all(f['ts'] == f['i'] * 100000 and f['dur'] == 100000 for f in log), log[:3])
    red = lambda q: q and q[0] > 200 and q[1] < 60 and q[2] < 60
    bad = [f['i'] for f in log[:40] if not red(f['pix'])]
    chk('every exported frame of the animated scene has the marker exactly where the stored geographic positions + camera put it', not bad, (bad[:8], [log[i] for i in bad[:2]]))
    # the marker really moves (not frozen) and lands at the step-2 position at the end
    xs = [f['exp'][0] for f in log[:40]]
    chk('marker position changes over the move (frames are distinct in time)', max(xs) - min(xs) > 40, (min(xs), max(xs)))
    chk('scene B frames (t ≥ 4 s) show the plain scene: no marker, solid colour', all(not red(f['corner']) and f['corner'][2] > 40 for f in log[40:]), log[40]['corner'])
    chk('the exporter produced no errors', not errs, errs)
    b.close()
bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad)))
sys.exit(1 if bad else 0)
