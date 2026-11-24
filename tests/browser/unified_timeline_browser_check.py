"""v0.11.7 unified master timeline, real-browser (headless Chromium) check:
  ONE clock for graphics + map camera + imported GIF / MP4 background.
  Camera: automatic camera keys from pan / wheel zoom at the playhead, scrubbing never writes, smooth interpolation, camera and graphics keyed on the same timeline,
          key retime / ease / delete, undo / redo, legacy start/end camera conversion (same picture), Play.
  Media:  a real GIF and a real MP4 (generated here) as scene background: default duration = clip length, playhead 0 = first frame, scrub shows the exact frame,
          Play / Pause / Stop stay in sync, graphics keys stay in sync, trim / speed / loop, 'match scene length', and MP4 EXPORT frames decoded with ffmpeg match the preview.
  Headless Chromium is NOT real Firefox and has no real Mapbox tiles (flat 'map' background is used for the mouse tests; the Mapbox camera maths is covered in Node).
Usage: python3 wxbuild.py && python3 tests/browser/unified_timeline_browser_check.py [out_dir]   Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import pathlib, sys, math, tempfile, os, json, base64, subprocess, io
from PIL import Image
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path((sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxut_'))); OUT.mkdir(parents=True, exist_ok=True)
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, '' if ok else info)
HTML = (ROOT / 'dist' / 'studio.html').as_uri()

# ---------- test media: 20 frames, frame i = colour (12 i, 255-12 i, 64); 4.0 s (GIF 200 ms per frame, MP4 5 fps) ----------
N = 20
def col(i): return (i * 12, 255 - i * 12, 64)
frames = [Image.new('RGB', (320, 180), col(i)) for i in range(N)]
GIF = OUT / 'clip.gif'; frames[0].save(GIF, save_all=True, append_images=frames[1:], duration=200, loop=0, optimize=False, disposal=1)
(OUT / 'f').mkdir(exist_ok=True)
for i, f in enumerate(frames): f.save(OUT / 'f' / ('f%03d.png' % i))
MP4 = OUT / 'clip.mp4'
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', '5', '-i', str(OUT / 'f' / 'f%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '5', str(MP4)], check=True)

SETUP = """()=>{
  const WX=window.WX,E=WX.E;
  const bg={type:'map',theme:'dark',view:{cx:487,cy:305,w:400},cities:false,counties:false};
  const ico=E.newObject('icon',{id:'i1',geo:true,x:440,y:340,icon:'rain',size:100});
  const front=E.newObject('front',{id:'f1',geo:true,kind:'cold',pts:[[430,300],[455,288],[480,285],[505,292],[530,306]]});
  [ico,front].forEach(o=>{o.anim={in:'none',delay:0,dur:0.01}});
  const sc=E.newScene({id:'main',name:'Map',duration:12,bg,title:{show:false,text:'',sub:''},transition:{type:'cut',dur:0},objects:[front,ico]});
  const med=E.newScene({id:'med',name:'Media',duration:6,bg:{type:'solid',color:'#103050',kenburns:false},title:{show:false,text:'',sub:''},transition:{type:'cut',dur:0},objects:[E.newObject('icon',{id:'mi',x:300,y:900,icon:'sunny',size:110})]});
  med.objects.forEach(o=>{o.anim={in:'none',delay:0,dur:0.01}});
  WX.loadShow({name:'UT',accent:'#2f9bff',scenes:[sc,med],assets:{},mbMigrated:1}); return true;}"""
def pp(pg, x, y):
    r = pg.evaluate("(()=>{const r=document.getElementById('overlay').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    return (r[0] + x * r[2] / 1920, r[1] + y * r[3] / 1080)
def S(pg): return "WX.S.show.scenes[%d]" % pg.evaluate("WX.S.si")
def seek(pg, t, w=140):
    pg.evaluate("(t)=>{const i=document.getElementById('mtlTime');i.value=t;i.dispatchEvent(new Event('change'))}", t); pg.wait_for_timeout(w)
def drag(pg, a, b, n=8):
    pa, pb = pp(pg, *a), pp(pg, *b); pg.mouse.move(*pa); pg.mouse.down()
    for i in range(1, n + 1): pg.mouse.move(pa[0] + (pb[0] - pa[0]) * i / n, pa[1] + (pb[1] - pa[1]) * i / n)
    pg.mouse.up(); pg.wait_for_timeout(220)
def tab(pg, t): pg.evaluate("(t)=>WX.setTab(t)", t); pg.wait_for_timeout(200)
def view(pg, si, t): return pg.evaluate("(a)=>WX.E.viewAt(WX.S.show.scenes[a.si],a.t)", {'si': si, 't': t})
def camkeys(pg, si=0): return pg.evaluate("(si)=>{const t=WX.S.show.scenes[si].tl;return t&&t.cam?t.cam.keys.map(k=>({id:k.id,t:k.t,w:k.v.w,cx:k.v.cx,cy:k.v.cy,e:k.e})):[]}", si)
def sj(pg, si): return pg.evaluate("(si)=>JSON.stringify(WX.S.show.scenes[si])", si)
def bgidx(pg):      # which of the 20 test frames does the STAGE show right now (centre pixel, red channel / 12)
    r = pg.evaluate("(()=>{const c=document.getElementById('stage').getContext('2d').getImageData(960,540,1,1).data;return [c[0],c[1],c[2]]})()")
    return round(r[0] / 12), r
def sel_scene(pg, i):
    pg.evaluate("(i)=>WX.S.si!==i&&document.querySelectorAll('#scenes .sc')[i].click()", i); pg.wait_for_timeout(350)
def upload(pg, f):
    tab(pg, 'bgs'); pg.evaluate("[...document.querySelectorAll('#panels button')].find(x=>x.textContent.trim()==='Videos').click()"); pg.wait_for_timeout(300)
    pg.set_input_files('#panels input[type=file]', str(f)); pg.wait_for_timeout(1500)
    pg.evaluate("(()=>{const b=[...document.querySelectorAll('#panels button')].filter(x=>x.textContent.startsWith('Use as this scene'));b[0].click()})()"); pg.wait_for_timeout(1400)

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1700, 'height': 980}).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto(HTML); pg.wait_for_timeout(1800); pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    pg.evaluate(SETUP); pg.wait_for_timeout(500)
    pg.locator('.sc').nth(0).click(); pg.wait_for_timeout(300)

    # ================= A. camera on the master timeline (flat map, real mouse) =================
    pg.evaluate("WX.setTool('select')"); pg.click('#bTlOn'); pg.wait_for_timeout(300)
    chk('map scene timeline shows a Camera lane (no keys yet) and no Media lane', pg.evaluate("!!document.getElementById('mtlCamTrack') && !document.getElementById('mtlMediaTrack') && document.querySelectorAll('#mtlCamTrack .mtl-key').length===0"))
    v0 = view(pg, 0, 0); tab(pg, 'anim')
    chk('Animation tab has a Camera section with Key camera here', pg.evaluate("!!document.getElementById('tlCamKey') && /No camera motion yet/.test(document.getElementById('tlCamNote').textContent)"))
    j_before = sj(pg, 0)
    for t in (0, 3.3, 7.7, 12, 5): seek(pg, t)
    chk('scrubbing the playhead alone creates no camera key and changes no data', sj(pg, 0) == j_before)
    seek(pg, 4); drag(pg, (1500, 300), (1300, 450))                                    # pan the empty map at 4 s
    ck = camkeys(pg)
    chk('panning at 4 s made a start key (0 s) and a key at 4 s - nothing else', len(ck) == 2 and ck[0]['t'] == 0 and abs(ck[1]['t'] - 4) < 0.05, ck)
    chk('the start key is the old view; the 4 s key moved the centre', abs(ck[0]['cx'] - 487) < 1e-6 and abs(ck[0]['w'] - 400) < 1e-6 and ck[1]['cx'] > 487 + 5, ck)
    chk('the camera did not create any object keys', pg.evaluate("Object.keys(WX.S.show.scenes[0].tl.tracks).length===0"))
    chk('a camera key marker appears on the Camera lane (2 diamonds), the playhead key is selected', pg.evaluate("document.querySelectorAll('#mtlCamTrack .mtl-key').length===2 && !!document.querySelector('#mtlCamTrack .mtl-key.sel')"))
    seek(pg, 2); vm = view(pg, 0, 2)
    chk('at 2 s the camera is between the start view and the 4 s view (smooth)', v0['cx'] < vm['cx'] < ck[1]['cx'], (v0, vm))
    j1 = sj(pg, 0)
    for t in (0, 1, 2, 3, 4, 9, 2): seek(pg, t, 80)
    chk('scrub back and forth: camera data unchanged', sj(pg, 0) == j1)
    seek(pg, 0); chk('at 0 s the camera is exactly the start view', abs(view(pg, 0, 0)['cx'] - v0['cx']) < 1e-9)
    # wheel zoom at 8 s
    seek(pg, 8); pg.mouse.move(*pp(pg, 960, 540)); pg.mouse.wheel(0, -500); pg.wait_for_timeout(900)
    ck = camkeys(pg)
    chk('wheel zoom at 8 s made a third key at 8 s with a smaller width (zoomed in)', len(ck) == 3 and abs(ck[2]['t'] - 8) < 0.05 and ck[2]['w'] < 400, ck)
    # edit between keys: insert, neighbours untouched
    before = camkeys(pg); seek(pg, 6); drag(pg, (1500, 300), (1450, 300)); ck = camkeys(pg)
    chk('editing between keys (6 s) inserts a key; neighbours keep their values', len(ck) == 4 and abs(ck[2]['t'] - 6) < 0.05 and abs(ck[1]['cx'] - before[1]['cx']) < 1e-9 and abs(ck[3]['w'] - before[2]['w']) < 1e-9, ck)
    seek(pg, 6); drag(pg, (1500, 300), (1480, 300)); chk('editing again at the same time updates that key (still 4 keys)', len(camkeys(pg)) == 4)
    # camera + graphics on the same timeline: key the icon at 4 s and check it lands under the mouse for THAT camera
    seek(pg, 4); tab(pg, 'object'); pg.evaluate("WX.S.oid='i1'"); pg.wait_for_timeout(150)
    sp = pg.evaluate("(()=>{const sc=WX.S.show.scenes[0],E=WX.E,o=E.objectsAt(sc,4).find(q=>q.id==='i1');const s=E.toScreen(o,E.xf(sc,4));return [s.x,s.y]})()")
    drag(pg, sp, (sp[0] + 150, sp[1] + 90))
    sp2 = pg.evaluate("(()=>{const sc=WX.S.show.scenes[0],E=WX.E,o=E.objectsAt(sc,4).find(q=>q.id==='i1');const s=E.toScreen(o,E.xf(sc,4));return [s.x,s.y]})()")
    chk('icon dragged at 4 s ends up where the mouse put it ON SCREEN under the playhead camera', abs(sp2[0] - (sp[0] + 150)) < 14 and abs(sp2[1] - (sp[1] + 90)) < 14, (sp, sp2))
    chk('both kinds of keys now exist on the one timeline: icon keys at 0 and 4 s, camera keys unchanged in number', pg.evaluate("(()=>{const t=WX.S.show.scenes[0].tl;return t.tracks.i1.keys.length===2&&t.cam.keys.length===4})()"))
    # a pinned (geo) object stays on the geography while the camera moves: its stored map coordinates are the same at every time except where it was keyed
    pin = pg.evaluate("(()=>{const sc=WX.S.show.scenes[0],E=WX.E,o=E.objectsAt(sc,8).find(q=>q.id==='f1');const a=E.toScreen(o,E.xf(sc,0)),b=E.toScreen(o,E.xf(sc,8));return [o.pts[0][0],a.pts[0][0],b.pts[0][0]]})()")
    chk('a pinned front keeps its map coordinates while the screen position follows the camera', pin[0] == 430 and abs(pin[1] - pin[2]) > 20, pin)
    # undo / redo (graphics key, then camera key)
    pg.evaluate("WX.undo()"); pg.wait_for_timeout(250); u1 = pg.evaluate("WX.S.show.scenes[0].tl.tracks.i1?WX.S.show.scenes[0].tl.tracks.i1.keys.length:0"); pg.evaluate("WX.redo()"); pg.wait_for_timeout(250)
    chk('undo takes the icon key away, redo brings it back (camera keys untouched)', u1 < 2 and pg.evaluate("WX.S.show.scenes[0].tl.tracks.i1.keys.length")==2 and len(camkeys(pg))==4, u1)
    seek(pg, 10.5); drag(pg, (1500, 300), (1400, 330)); n5 = len(camkeys(pg)); pg.evaluate("WX.undo()"); pg.wait_for_timeout(250); n4 = len(camkeys(pg)); pg.evaluate("WX.redo()"); pg.wait_for_timeout(250); n5b = len(camkeys(pg)); pg.evaluate("WX.undo()"); pg.wait_for_timeout(250)
    chk('a camera key made by dragging is undone and redone as one step (5 -> 4 -> 5), then undone again', (n5, n4, n5b, len(camkeys(pg))) == (5, 4, 5, 4), (n5, n4, n5b, len(camkeys(pg))))
    # key panel: retime + ease + delete
    ck = camkeys(pg); kid = ck[3]['id']; pg.evaluate("(id)=>{WX.S.tlSel={oid:'@cam',kid:id}}", kid); tab(pg, 'anim')
    chk('selecting a camera key shows the Selected camera key panel with ease', pg.evaluate("!!document.getElementById('tlCamKeyBox') && !!document.getElementById('tlCamEase')"))
    pg.select_option('#tlCamEase', 'linear'); pg.wait_for_timeout(200)
    chk('ease set to constant speed on that key', camkeys(pg)[3]['e'] == 'linear')
    w9a = view(pg, 0, 7)['w']
    pg.fill('#tlCamKeyBox input[type=number]', '10'); pg.dispatch_event('#tlCamKeyBox input[type=number]', 'change'); pg.wait_for_timeout(250)
    ck2 = camkeys(pg)
    chk('retiming the 8 s camera key to 10 s keeps 4 keys, in order, at 10 s', len(ck2) == 4 and abs(ck2[3]['t'] - 10) < 0.05 and all(ck2[i]['t'] < ck2[i + 1]['t'] for i in range(3)), ck2)
    chk('retiming changes the camera speed (the view at 7 s differs)', abs(view(pg, 0, 7)['w'] - w9a) > 1e-6)
    # drag the key diamond on the bar
    box = pg.locator('#mtlCamTrack .mtl-key').nth(3).bounding_box(); trk = pg.locator('#mtlCamTrack').bounding_box()
    pg.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2); pg.mouse.down(); pg.mouse.move(trk['x'] + trk['width'] * 0.75, box['y'] + box['height'] / 2, steps=6); pg.mouse.up(); pg.wait_for_timeout(250)
    ck3 = camkeys(pg); chk('dragging the camera key marker on the timeline bar retimes it (about 9 s)', abs(ck3[3]['t'] - 9) < 0.35 and len(ck3) == 4, ck3)
    pg.evaluate("(id)=>{WX.S.tlSel={oid:'@cam',kid:id}}", ck3[3]['id']); tab(pg, 'anim'); pg.click('#tlCamKeyBox button.dng'); pg.wait_for_timeout(250)
    chk('Delete key removes the camera key; the start key at 0 s cannot be deleted', len(camkeys(pg)) == 3 and pg.evaluate("(()=>{const k=WX.S.show.scenes[0].tl.cam.keys[0];return Timeline.camDelKey(WX.S.show.scenes[0],k.id)===false})()"))
    # playback: the playhead and the camera run together
    seek(pg, 0); pg.click('#mtlPlay'); pg.wait_for_timeout(1300); t_play = pg.evaluate("WX.S.tlT"); mode = pg.evaluate("WX.S.mode"); pg.click('#mtlPlay'); pg.wait_for_timeout(300)
    chk('Play runs the one clock (mode play, playhead advanced), Pause returns to edit at that time', mode == 'play' and 0.8 < t_play < 2.2 and pg.evaluate("WX.S.mode") == 'edit', (mode, t_play))
    chk('after Pause the editor camera is exactly the camera at the playhead time', abs(pg.evaluate("(()=>{const sc=WX.S.show.scenes[0];return WX.E.viewAt(sc,WX.S.tlT).cx-Timeline.camAt(sc,WX.S.tlT).cx})()")) < 1e-9)
    # remove the camera animation keeps the start view
    tab(pg, 'anim'); pg.click('#tlCamClear'); pg.wait_for_timeout(250)
    chk('Remove camera animation: no keys left, start view kept, graphics keys untouched', len(camkeys(pg)) == 0 and abs(view(pg, 0, 5)['cx'] - 487) < 1e-6 and pg.evaluate("WX.S.show.scenes[0].tl.tracks.i1.keys.length===2"))

    # ---------- legacy start/end camera (v0.11.6 scene with bg.view2) converts to keys with the same picture ----------
    pg.evaluate("""()=>{const E=WX.E,sc=WX.S.show.scenes[0];sc.bg.view={cx:487,cy:305,w:400};sc.bg.view2={cx:520,cy:320,w:200};sc.bg.camDelay=1;sc.bg.camDur=4;WX.commit()}"""); pg.wait_for_timeout(300)
    legacy = [view(pg, 0, t) for t in (0, 0.5, 1, 2, 3, 4.5, 5, 8)]; tab(pg, 'anim')
    chk('v0.11.6-style scene (start / end camera inside a master timeline) still plays as before', abs(legacy[2]['w'] - 400) < 1e-9 and abs(legacy[6]['w'] - 200) < 1e-9 and legacy[3]['w'] < 400)
    chk('the panel offers Convert start / end camera to keys', pg.evaluate("!!document.getElementById('tlCamConv')"))
    pg.click('#tlCamConv'); pg.wait_for_timeout(350); conv = [view(pg, 0, t) for t in (0, 0.5, 1, 2, 3, 4.5, 5, 8)]
    chk('after conversion every sampled frame has the same view (<= 1e-6) and view2 is gone', all(abs(a['w'] - c['w']) < 1e-6 and abs(a['cx'] - c['cx']) < 1e-6 for a, c in zip(legacy, conv)) and pg.evaluate("WX.S.show.scenes[0].bg.view2===undefined && WX.S.show.scenes[0].tl.cam.keys.length===3"), (legacy[3], conv[3]))
    chk('no page errors in the camera section', not errs, errs[:2])

    # ================= B. imported media: GIF + MP4 on the same timeline =================
    sel_scene(pg, 1)
    # B1: import first, then Animate
    upload(pg, GIF)
    chk('GIF imported as the scene background; scene length matched to the clip (4.0 s)', pg.evaluate("(()=>{const s=WX.S.show.scenes[1];return s.bg.type==='video'&&Math.abs(s.duration-4)<0.05})()"), pg.evaluate("[WX.S.show.scenes[1].bg.type,WX.S.show.scenes[1].duration]"))
    pg.click('#bTlOn'); pg.wait_for_timeout(350)
    chk('Animate on the media scene: timeline duration = clip duration (4 s), Media lane with a clip bar, no Camera lane', pg.evaluate("(()=>{const s=WX.S.show.scenes[1];return s.tl&&Math.abs(s.tl.duration-4)<0.05&&!!document.getElementById('mtlMediaTrack')&&document.querySelectorAll('#mtlMediaTrack .mtl-clip').length>=1&&!document.getElementById('mtlCamTrack')})()"))
    tab(pg, 'anim'); chk('the Animation tab shows the imported media section with the clip length', pg.evaluate("/GIF/.test(document.getElementById('tlMediaNote').textContent)&&/4\\.0/.test(document.getElementById('tlMediaNote').textContent)"))
    seek(pg, 0, 300); i0, rgb = bgidx(pg)
    chk('playhead 0 = first frame of the GIF', i0 == 0, rgb)
    ok = True; bad = []
    for t in (0.1, 0.5, 1.0, 1.9, 2.0, 2.6, 3.3, 3.9, 0.3):
        seek(pg, t, 160); want = min(int(math.floor(t / 0.2 + 1e-6)), N - 1); got, rgb = bgidx(pg)
        if got != want: ok = False; bad.append((t, want, got, rgb))
    chk('scrubbing shows the exact GIF frame for the playhead time (9 sample times, incl. going backwards)', ok, bad)
    seek(pg, 3.9, 200); seek(pg, 0.1, 200)
    # graphics keyed on the media scene stay in sync
    pg.evaluate("WX.S.oid='mi'"); seek(pg, 2); mi = pg.evaluate("(()=>{const o=WX.E.objectsAt(WX.S.show.scenes[1],2).find(q=>q.id==='mi');return [o.x,o.y]})()"); drag(pg, mi, (mi[0] + 600, mi[1] - 300), 10)
    chk('moving an icon at 2 s keys it (keys at 0 and 2 s); media and graphics share the timeline', pg.evaluate("WX.S.show.scenes[1].tl.tracks.mi.keys.length===2 && Math.abs(WX.S.show.scenes[1].tl.tracks.mi.keys[1].t-2)<0.05"))
    seek(pg, 1.0, 250); ip = pg.evaluate("(()=>{const o=WX.E.objectsAt(WX.S.show.scenes[1],1).find(q=>q.id==='mi');return o.x})()"); gi, _ = bgidx(pg)
    chk('at 1 s the icon is halfway AND the GIF shows frame 5 (same playhead)', abs(ip - (mi[0] + 300)) < 8 and gi == 5, (ip, mi, gi))
    # Play / Pause / Stop with media
    seek(pg, 0, 200); pg.click('#mtlPlay'); pg.wait_for_timeout(1250); pg.click('#mtlPlay'); pg.wait_for_timeout(350)
    tp = pg.evaluate("WX.S.tlT"); gi, _ = bgidx(pg)
    chk('Play then Pause: playhead advanced ~1.2 s and the media shows the frame for THAT time', 0.7 < tp < 2.2 and gi == min(int(math.floor(tp / 0.2 + 1e-6)), N - 1), (tp, gi))
    pg.click('#mtlStop'); pg.wait_for_timeout(300); gi, _ = bgidx(pg)
    chk('Stop returns to 0 s and the first frame', pg.evaluate("WX.S.tlT") == 0 and gi == 0, gi)
    # speed 2 / trim
    tab(pg, 'anim')
    def setnum(label_contains, val):
        pg.evaluate("""(a)=>{const l=[...document.querySelectorAll('#panels label, .panel label, label')].find(x=>x.textContent.includes(a.l));const i=l.parentElement.querySelector('input')||l.querySelector('input');i.value=a.v;i.dispatchEvent(new Event('input'));i.dispatchEvent(new Event('change'))}""", {'l': label_contains, 'v': str(val)}); pg.wait_for_timeout(300)
    setnum('Speed (1 = normal)', 2); seek(pg, 1.0, 250); gi, _ = bgidx(pg)
    chk('speed 2: at 1 s the GIF shows the frame of source time 2.0 s (frame 10)', gi == 10 and pg.evaluate("WX.S.show.scenes[1].bg.vidSpeed")==2, gi)
    pg.click('#tlMediaFit'); pg.wait_for_timeout(350)
    chk('Match scene length to the clip: 4 s at speed 2 -> 2.0 s timeline', abs(pg.evaluate("WX.S.show.scenes[1].tl.duration") - 2.0) < 0.05 and abs(pg.evaluate("WX.S.show.scenes[1].duration") - 2.0) < 0.05)
    setnum('Speed (1 = normal)', 1); setnum('Start trim', 1); setnum('End trim', 3); pg.click('#tlMediaFit'); pg.wait_for_timeout(350); seek(pg, 0, 250); g0, _ = bgidx(pg); seek(pg, 1.0, 250); g1, _ = bgidx(pg)
    chk('trim 1-3 s at speed 1: duration 2.0 s, 0 s shows source 1.0 s (frame 5), 1 s shows source 2.0 s (frame 10)', abs(pg.evaluate("WX.S.show.scenes[1].tl.duration") - 2.0) < 0.05 and g0 == 5 and g1 == 10, (g0, g1))
    # loop: lengthen the scene beyond one pass
    pg.evaluate("(()=>{const s=WX.S.show.scenes[1];Timeline.setDuration(s,5);WX.commit()})()"); setnum('Loop the clip', 1)
    pg.evaluate("(()=>{const s=WX.S.show.scenes[1];s.bg.vidLoop=true;WX.commit()})()"); seek(pg, 2.5, 250); gl, _ = bgidx(pg); seek(pg, 3.5, 250); gl2, _ = bgidx(pg)
    chk('loop inside the trim window: 2.5 s shows source 1.5 s (frame 7), 3.5 s shows source 2.5 s (frame 12)', gl == 7 and gl2 == 12, (gl, gl2))
    pg.evaluate("(()=>{const s=WX.S.show.scenes[1];s.bg.vidLoop=false;WX.commit()})()"); seek(pg, 4.9, 250); gh, _ = bgidx(pg)
    chk('without loop the last frame of the trim is held after the clip ends (frame 14)', gh == 14, gh)
    chk('the Media lane shows a hold bar after the clip when not looping', pg.evaluate("!!document.querySelector('#mtlMediaTrack .mtl-clip.hold')"))
    # undo of a media change
    pg.evaluate("(()=>{const s=WX.S.show.scenes[1];s.bg.vidSpeed=4;WX.commit()})()"); pg.evaluate("WX.undo()"); pg.wait_for_timeout(250)
    chk('undo restores the previous media speed', pg.evaluate("WX.S.show.scenes[1].bg.vidSpeed") in (1, None))
    chk('no page errors in the GIF section', not errs, errs[:2])

    # ================= C. MP4 (HTML video element) =================
    pg.evaluate("(()=>{WX.S.si=1;const s=WX.S.show.scenes[1];Timeline.toSteps;})()")
    pg.evaluate("document.querySelectorAll('#scenes .sc')[1].click()"); pg.wait_for_timeout(300)
    # a new scene for the MP4 (Animate first, then import: the import must set the timeline duration)
    pg.evaluate("WX.newScene()"); pg.wait_for_timeout(500)
    pg.evaluate("""()=>{const E=WX.E,s=WX.S.show.scenes[2];s.id='mp4';s.name='MP4';s.duration=9;s.transition={type:'cut',dur:0};s.bg={type:'solid',color:'#103050',kenburns:false};s.objects=[E.newObject('icon',{id:'mj',x:300,y:900,icon:'sunny',size:110})];s.objects.forEach(o=>{o.anim={in:'none',delay:0,dur:0.01}});WX.commit();}"""); pg.wait_for_timeout(300)
    sel_scene(pg, 2); pg.evaluate("WX.S.si")==2 or print('scene index', pg.evaluate("WX.S.si")); pg.click('#bTlOn'); pg.wait_for_timeout(300)
    chk('MP4 scene: timeline turned on first (9 s)', pg.evaluate("WX.S.show.scenes[2].tl.duration===9"))
    upload(pg, MP4); pg.wait_for_timeout(600)
    chk('importing the MP4 into an animated scene sets the timeline duration to the clip (4.0 s)', abs(pg.evaluate("WX.S.show.scenes[2].tl.duration") - 4.0) < 0.06 and abs(pg.evaluate("WX.S.show.scenes[2].duration") - 4.0) < 0.06, pg.evaluate("[WX.S.show.scenes[2].tl.duration,WX.S.show.scenes[2].duration]"))
    chk('MP4 is not a GIF (HTML video) and has the real duration', pg.evaluate("(()=>{const v=WX.E.videos[WX.S.show.scenes[2].bg.vid];return !v.gif&&Math.abs(v.dur-4)<0.1&&v.w===320})()"))
    ok = True; bad = []
    for t in (0.1, 0.5, 1.1, 1.9, 2.5, 3.5, 3.9, 0.3, 2.1):
        seek(pg, t, 700); want = min(int(math.floor(t / 0.2 + 1e-6)), N - 1); got, rgb = bgidx(pg)
        if got != want: ok = False; bad.append((t, want, got, rgb))
    chk('MP4 scrubbing shows the exact frame for the playhead time (9 samples, forwards and backwards)', ok, bad)
    ok = True; bad = []
    for t in (0.2, 1.0, 1.6, 3.0, 2.0, 0.4):       # exactly ON a frame boundary: the frame that STARTS at that time must show
        seek(pg, t, 700); want = int(round(t / 0.2)); got, rgb = bgidx(pg)
        if got != want: ok = False; bad.append((t, want, got, rgb))
    chk('MP4 scrubbing exactly on frame boundaries shows the frame that starts there (6 samples)', ok, bad)
    seek(pg, 0, 600); pg.click('#mtlPlay'); pg.wait_for_timeout(1500); pg.click('#mtlPlay'); pg.wait_for_timeout(900)
    tp = pg.evaluate("WX.S.tlT"); gi, rgb = bgidx(pg)
    chk('MP4 Play then Pause: the editor shows the frame of the paused playhead time', 0.8 < tp < 2.8 and gi == min(int(math.floor(tp / 0.2 + 1e-6)), N - 1), (tp, gi, rgb))

    # ================= D. EXPORT parity: real MP4 export, frames decoded with ffmpeg =================
    pg.evaluate("document.querySelectorAll('#scenes .sc')[1].click()"); pg.wait_for_timeout(300)
    # scene 1 (GIF scene): icon moves 0 -> 2 s; export the show scene by scene is not needed: export the whole show and compare scene 1's frames
    pg.evaluate("(()=>{const s=WX.S.show.scenes[1];s.bg.vidStart=0;delete s.bg.vidEnd;s.bg.vidSpeed=1;s.bg.vidLoop=false;Timeline.fitToMedia(s,WX.E.videos[s.bg.vid].dur);WX.commit()})()")
    info = pg.evaluate("""async()=>{try{const r=await Exporter.run(WX.S.show,{fps:20,width:640,height:360,bitrate:2e6,sceneIndexes:null});const u8=new Uint8Array(await r.blob.arrayBuffer());let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return {ok:true,b64:btoa(s),frames:r.frames,seconds:r.seconds,codec:r.codec}}catch(e){return {ok:false,err:String(e&&e.message||e)}}}""")
    chk('MP4 export of the whole show (map scene 12 s + GIF scene 4 s + MP4 scene 4 s) succeeded', info.get('ok'), info)
    if info.get('ok'):
        mp4 = OUT / 'export_media.mp4'; mp4.write_bytes(base64.b64decode(info['b64']))
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', str(mp4)], capture_output=True, text=True).stdout.strip() or 0)
        chk('exported length = the sum of the scene durations (12 + 4 + 4 s)', abs(dur - 20.0) < 0.4, dur)
        def fr(i):
            o = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(mp4), '-vf', 'select=eq(n\\,%d)' % i, '-vframes', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True).stdout
            return Image.open(io.BytesIO(o)).convert('RGB')
        bad = []
        for sceneStart, name in ((240, 'GIF scene'), (320, 'MP4 scene')):
            for t in (0.5, 1.5, 2.5, 3.5):
                im = fr(sceneStart + int(round(t * 20))); px = im.getpixel((320, 180)); got = round(px[0] / 12); want = min(int(math.floor(t / 0.2 + 1e-6)), N - 1)
                if abs(got - want) > 0: bad.append((name, t, want, got, px))
        chk('exported frames show the same media frame as the playhead time (GIF scene and MP4 scene, 8 sample frames)', not bad, bad)
        # graphics: the GIF-scene icon was keyed 0 -> 2 s; find it in the exported frame (it is the only large non-background blob) and compare with the engine position
        def icon_x(im):
            a = im.convert('RGB'); w, h = a.size; bg = a.getpixel((w - 4, 4)); xs = []
            for y in range(0, h, 3):
                for x in range(0, w, 3):
                    q = a.getpixel((x, y))
                    if sum(abs(q[i] - bg[i]) for i in range(3)) > 120: xs.append(x)
            return (sum(xs) / len(xs)) if xs else None
        xe = []
        for t in (0.0, 1.0, 2.0):
            xs = icon_x(fr(240 + (int(round(t * 20)) if t < 2 else 39))); xe.append(xs)
        want = pg.evaluate("(a)=>a.map(t=>{const o=WX.E.objectsAt(WX.S.show.scenes[1],t).find(q=>q.id==='mi');return o.x*640/1920+55*640/1920})", [0.0, 1.0, 2.0])
        chk('the icon moves between the exported frames the way the engine says (x at 0 / 1 / 2 s within 22 px of the model)', all(x is not None for x in xe) and (xe[0] < xe[1] < xe[2]) and abs((xe[1] - xe[0]) - (want[1] - want[0])) < 22, (xe, want))
    chk('no page errors anywhere', not errs, errs[:3])
    pg.screenshot(path=str(OUT / 'unified_editor.png'))
    b.close()
bad_ = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad_)))
sys.exit(1 if bad_ else 0)
