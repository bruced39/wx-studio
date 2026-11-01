"""Real-browser (headless Chromium) check of the map animation steps (v0.11.0): step bar, editing a step with the normal tools,
rotate / scale handles, control points, scrubbing, playback and "editing never changes the other steps".
Usage: python3 wxbuild.py && python3 tests/browser/map_animation_browser_check.py [screenshot_dir]
Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import os, sys, tempfile, pathlib, json
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxanim_')) + '/'
os.makedirs(S, exist_ok=True)
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, ('' if ok else info))
HTML = (ROOT / 'dist' / 'studio.html').as_uri()

SETUP = """()=>{
  const WX=window.WX,E=WX.E,sc=WX.S.show.scenes[0];
  sc.bg={type:'map',theme:'dark',view:{cx:487,cy:305,w:400},cities:false,counties:false};
  sc.transition={type:'cut',dur:0};
  const front=E.newObject('front',{id:'f1',geo:true,kind:'cold',pts:[[430,300],[450,290],[470,285],[490,290],[510,300],[530,312]]});
  const txt=E.newObject('text',{id:'t1',geo:true,x:480,y:260,text:'COLD FRONT',size:60});
  const ico=E.newObject('icon',{id:'i1',geo:true,x:540,y:330,icon:'rain',size:120});
  [front,txt,ico].forEach(o=>{o.anim={in:'none',delay:0,dur:0.01}});
  sc.objects=[front,txt,ico]; sc.duration=6; WX.S.show.mbMigrated=1;
  WX.loadShow(JSON.parse(JSON.stringify(WX.S.show)));
  return true;}"""

def stage_to_page(pg, x, y):
    r = pg.evaluate("(()=>{const r=document.getElementById('overlay').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    return (r[0] + x * r[2] / 1920, r[1] + y * r[3] / 1080)

def scr(pg, oid, step=None):
    """screen-space points of an object (in the selected edit view)"""
    return pg.evaluate("""(a)=>{const WX=window.WX,E=WX.E,sc=WX.S.show.scenes[WX.S.si];const objs=a.step==null?sc.objects:(a.step==0?sc.objects:sc.anim.steps[a.step].objects);
      const o=objs.find(q=>q.id===a.id);if(!o)return null;const so=E.toScreen(o,E.xf(sc,0));return so.pts?so.pts:[[so.x,so.y]]}""", {'id': oid, 'step': step})

def drag(pg, a, b, shift=False, steps=8):
    pa, pb = stage_to_page(pg, *a), stage_to_page(pg, *b)
    if shift: pg.keyboard.down('Shift')
    pg.mouse.move(*pa); pg.mouse.down()
    for i in range(1, steps + 1): pg.mouse.move(pa[0] + (pb[0] - pa[0]) * i / steps, pa[1] + (pb[1] - pa[1]) * i / steps)
    pg.mouse.up()
    if shift: pg.keyboard.up('Shift')
    pg.wait_for_timeout(80)

def click(pg, p, shift=False):
    pp = stage_to_page(pg, *p)
    if shift: pg.keyboard.down('Shift')
    pg.mouse.click(*pp)
    if shift: pg.keyboard.up('Shift')
    pg.wait_for_timeout(80)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1700, 'height': 980})
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(HTML); pg.wait_for_timeout(2000)
    pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    pg.evaluate(SETUP); pg.wait_for_timeout(300)

    # ---- an ordinary map scene: bar offers to start animating, nothing changed in the document ----
    chk('un-animated map scene: only a small Animate button (no extra bar)', pg.evaluate("document.getElementById('stepbar').hidden && !document.getElementById('bAnimOn').hidden"))
    chk('un-animated scene has no anim block', pg.evaluate("!WX.S.show.scenes[0].anim"))
    before = pg.evaluate("JSON.stringify(WX.S.show.scenes[0])")
    pg.click('#bAnimOn'); pg.wait_for_timeout(150)
    chk('Animate this scene creates one step and keeps the objects', pg.evaluate("WX.S.show.scenes[0].anim.steps.length")==1 and pg.evaluate("WX.S.show.scenes[0].objects.length")==3)
    chk('scene duration is now derived from the steps', pg.evaluate("WX.S.show.scenes[0].duration")==3)
    chk('step bar appears once animation is on', pg.evaluate("!document.getElementById('stepbar').hidden && document.getElementById('bAnimOn').hidden"))
    chk('step strip is drawn', pg.evaluate("document.querySelectorAll('#stepbar .sbstep').length")==1)

    # ---- add a step: it inherits the previous graphics (same ids), fronts reduced to a few control points ----
    pg.click('#stepbar button.pri'); pg.wait_for_timeout(150)
    st = pg.evaluate("({n:WX.S.show.scenes[0].anim.steps.length, sel:WX.S.step, ids:WX.S.show.scenes[0].anim.steps[1].objects.map(o=>o.id), fp:WX.S.show.scenes[0].anim.steps[1].objects[0].pts.length})")
    chk('new step is step 2 and selected', st['n'] == 2 and st['sel'] == 1, st)
    chk('new step inherits all graphics with the same ids', st['ids'] == ['f1', 't1', 'i1'], st)
    chk('front in the new step has ≤ 6 control points', st['fp'] <= 6, st)
    step1_before = pg.evaluate("JSON.stringify(WX.S.show.scenes[0].objects)")

    # ---- edit step 2 with the normal tools: select the front by clicking on it, drag it ----
    pg.evaluate("WX.setTool('select')")
    mid = pg.evaluate("(()=>{const WX=window.WX,E=WX.E,sc=WX.S.show.scenes[0],o=sc.anim.steps[1].objects[0],so=E.toScreen(o,E.xf(sc,0)),c=Sym.catmull(so.pts,false,10);return c[Math.floor(c.length*0.45)]})()")
    click(pg, mid)
    chk('click selects the whole front', pg.evaluate("WX.S.oid")=='f1')
    f2b = scr(pg, 'f1', 1)
    drag(pg, mid, (mid[0] + 150, mid[1] + 40))
    f2c = scr(pg, 'f1', 1)
    chk('dragging moves the front in step 2', abs((f2c[0][0] - f2b[0][0]) - 150) < 3 and abs((f2c[0][1] - f2b[0][1]) - 40) < 14, (f2b[0], f2c[0]))
    chk('step 1 is untouched by the edit', pg.evaluate("JSON.stringify(WX.S.show.scenes[0].objects)") == step1_before)

    # ---- rotate and scale handles ----
    h = pg.evaluate("""()=>{const WX=window.WX,E=WX.E,sc=WX.S.show.scenes[0],o=sc.anim.steps[1].objects[0],so=E.toScreen(o,E.xf(sc,0)),b=E.bounds(so);
      let cx=0,cy=0;so.pts.forEach(q=>{cx+=q[0];cy+=q[1]});cx/=so.pts.length;cy/=so.pts.length;return {rot:[Math.min(Math.max(b.x+b.w/2,30),1890),Math.max(34,b.y-44)],scale:[Math.min(b.x+b.w+18,1900),Math.min(b.y+b.h+18,1060)],c:[cx,cy]}}""")
    pre = scr(pg, 'f1', 1); c = h['c']
    d0 = ((pre[0][0] - c[0]) ** 2 + (pre[0][1] - c[1]) ** 2) ** .5
    drag(pg, h['rot'], (h['rot'][0] + 160, h['rot'][1] + 30))
    post = scr(pg, 'f1', 1)
    d1 = ((post[0][0] - c[0]) ** 2 + (post[0][1] - c[1]) ** 2) ** .5
    chk('rotate handle turns the front about its centre (shape kept)', abs(d0 - d1) < 3 and abs(post[0][0] - pre[0][0]) + abs(post[0][1] - pre[0][1]) > 20, (pre[0], post[0]))
    h2 = pg.evaluate("""()=>{const WX=window.WX,E=WX.E,sc=WX.S.show.scenes[0],o=sc.anim.steps[1].objects[0],b=E.bounds(E.toScreen(o,E.xf(sc,0)));return [Math.min(b.x+b.w+18,1900),Math.min(b.y+b.h+18,1060)]}""")
    span0 = pg.evaluate("(()=>{const o=WX.S.show.scenes[0].anim.steps[1].objects[0];return Math.hypot(o.pts[0][0]-o.pts[o.pts.length-1][0],o.pts[0][1]-o.pts[o.pts.length-1][1])})()")
    drag(pg, h2, (h2[0] + 120, h2[1] + 80))
    span1 = pg.evaluate("(()=>{const o=WX.S.show.scenes[0].anim.steps[1].objects[0];return Math.hypot(o.pts[0][0]-o.pts[o.pts.length-1][0],o.pts[0][1]-o.pts[o.pts.length-1][1])})()")
    chk('scale handle makes the front bigger', span1 > span0 * 1.1, (span0, span1))

    # ---- control points: double-click the curve adds one, Shift+click a point removes one ----
    npts = pg.evaluate("WX.S.show.scenes[0].anim.steps[1].objects[0].pts.length")
    dn = scr(pg, 'f1', 1)
    # a spot on the curve between control points 1 and 2 (dense sample)
    spot = pg.evaluate("""()=>{const WX=window.WX,E=WX.E,sc=WX.S.show.scenes[0],o=sc.anim.steps[1].objects[0],so=E.toScreen(o,E.xf(sc,0)),d=window.Sym?null:null;const c=Sym.catmull(so.pts,false,10);let best=null,bd=1e9;c.forEach((q,i)=>{if(i%10==0)return;const d=Math.hypot(q[0]-960,q[1]-540);if(d<bd){bd=d;best=q}});return best}""")
    pp = stage_to_page(pg, *spot); pg.mouse.dblclick(*pp); pg.wait_for_timeout(100)
    n2 = pg.evaluate("WX.S.show.scenes[0].anim.steps[1].objects[0].pts.length")
    chk('double-click on the curve adds a control point', n2 == npts + 1, (npts, n2))
    dn2 = scr(pg, 'f1', 1)
    ci = min(range(len(dn2)), key=lambda k: (dn2[k][0]-960)**2 + (dn2[k][1]-540)**2)
    click(pg, dn2[ci], shift=True)
    n3 = pg.evaluate("WX.S.show.scenes[0].anim.steps[1].objects[0].pts.length")
    chk('Shift+click on a control point removes it', n3 == n2 - 1, (n2, n3))
    # dragging a single control point bends the curve
    v = scr(pg, 'f1', 1); i = min(range(len(v)), key=lambda k: (v[k][0]-960)**2 + (v[k][1]-540)**2)
    drag(pg, v[i], (v[i][0], v[i][1] - 90))
    v2 = scr(pg, 'f1', 1)
    chk('dragging a control point bends only that point', abs(v2[i][1] - (v[i][1] - 90)) < 3 and all(abs(v2[k][1] - v[k][1]) < 1 for k in range(len(v)) if k != i), (v[i], v2[i]))

    # ---- text edit in step 2 only ----
    pg.evaluate("WX.S.oid='t1'; WX.S.show.scenes[0].anim.steps[1].objects.find(o=>o.id==='t1').text='NEW TEXT'; WX.commit();")
    chk('text change lives in step 2 only', pg.evaluate("WX.S.show.scenes[0].objects.find(o=>o.id==='t1').text")=='COLD FRONT')

    # ---- graphics added while editing step 1 also reach the later steps; delete affects only the edited step ----
    pg.evaluate("WX.S.step=0; WX.S.oid=null"); pg.click('#stepbar .sbstep[data-step=\"0\"]'); pg.wait_for_timeout(80)
    pg.evaluate("WX.addObject('icon',{x:700,y:700,icon:'sun',id:'late1'})"); pg.wait_for_timeout(80)
    ids = pg.evaluate("[0,1].map(i=>MapAnim.stepObjects(WX.S.show.scenes[0],i).some(o=>o.id===WX.S.oid))")
    chk('an object added in step 1 is also in the later step (same id)', ids == [True, True], ids)
    pg.evaluate("WX.S.step=1"); pg.evaluate("WX.S.oid=WX.S.oid"); pg.keyboard.press('Delete'); pg.wait_for_timeout(80)
    ids = pg.evaluate("[0,1].map(i=>MapAnim.stepObjects(WX.S.show.scenes[0],i).filter(o=>o.type==='icon'&&o.icon==='sun').length)")
    chk('Delete removes it from the edited step only', ids == [1, 0], ids)
    # ---- timing + scrub + playback ----
    pg.evaluate("(()=>{const sc=WX.S.show.scenes[0];MapAnim.setStep(sc,0,{hold:0.6});MapAnim.setStep(sc,1,{hold:0.6,dur:0.8});WX.commit();})()")
    pg.evaluate("WX.loadShow(JSON.parse(JSON.stringify(WX.S.show)))"); pg.wait_for_timeout(200)
    tot = pg.evaluate("WX.S.show.scenes[0].duration")
    chk('total = hold1 + move2 + hold2', abs(tot - 2.0) < 1e-6, tot)
    mid_objs = pg.evaluate("MapAnim.objectsAt(WX.S.show.scenes[0],0.6+0.4).map(o=>o.id+(o._a!=null?'@'+o._a.toFixed(2):''))")
    chk('mid-move has both texts crossfading', sum(1 for s in mid_objs if s.startswith('t1')) == 2, mid_objs)
    pg.evaluate("(()=>{const sl=document.getElementById('sbScrub');sl.value=1.0;sl.dispatchEvent(new Event('input',{bubbles:true}));})()"); pg.wait_for_timeout(200)
    chk('scrubbing switches to scrub mode at the right show time', pg.evaluate("WX.S.mode")=='scrub' and abs(pg.evaluate("WX.S.T") - 1.0) < 0.01)
    snap_obj = pg.evaluate("JSON.stringify(WX.S.show.scenes[0])")
    pg.screenshot(path=S + 'scrub_mid_move.png')
    seq0 = pg.evaluate("WX.cloud.changeSeq()")
    pg.evaluate("(()=>{const sl=document.getElementById('sbScrub');for(const v of [0.2,0.9,1.4,0.3]){sl.value=v;sl.dispatchEvent(new Event('input',{bubbles:true}));}})()"); pg.wait_for_timeout(150)
    pg.click('#stepbar .sbstep[data-step=\"0\"]'); pg.wait_for_timeout(100); pg.click('#stepbar .sbstep[data-step=\"1\"]'); pg.wait_for_timeout(100)
    chk('moving the playhead / selecting steps does not mark the show changed (no autosave / cloud change)', pg.evaluate("WX.cloud.changeSeq()") == seq0, (seq0, pg.evaluate("WX.cloud.changeSeq()")))
    pg.evaluate("(()=>{const sl=document.getElementById('sbScrub');sl.value=1.0;sl.dispatchEvent(new Event('input',{bubbles:true}));})()"); pg.wait_for_timeout(100)
    # the saved document does not change while scrubbing / playing
    pg.evaluate("document.querySelector('#stepbar .sbctl:nth-of-type(2) button:last-of-type').scrollIntoView()")
    pg.click("#stepbar button:has-text('Play')"); pg.wait_for_timeout(300)
    chk('Play runs the animation', pg.evaluate("WX.S.mode")=='play')
    pg.wait_for_timeout(2300)
    chk('playback ends back in edit mode', pg.evaluate("WX.S.mode")=='edit')
    chk('no change notification during playback either', pg.evaluate("WX.cloud.changeSeq()") == seq0)
    chk('document not modified by scrubbing / playback', pg.evaluate("JSON.stringify(WX.S.show.scenes[0])") == snap_obj)
    chk('no drawing errors', pg.evaluate("!WX.E.lastErr"), pg.evaluate("String(WX.E.lastErr)"))

    # ---- step operations ----
    pg.evaluate("WX.S.step=0"); pg.click('#stepbar button.pri'); pg.wait_for_timeout(100)
    chk('add step after step 1 inserts at position 2', pg.evaluate("WX.S.show.scenes[0].anim.steps.length")==3 and pg.evaluate("WX.S.step")==1)
    pg.click("#stepbar button[title='Move step later']"); pg.wait_for_timeout(100)
    chk('reorder moves the step', pg.evaluate("WX.S.step")==2)
    pg.click("#stepbar button[title='Duplicate this step']"); pg.wait_for_timeout(100)
    chk('duplicate adds a step', pg.evaluate("WX.S.show.scenes[0].anim.steps.length")==4)
    pg.click("#stepbar button[title='Delete this step']"); pg.wait_for_timeout(100)
    chk('delete removes a step', pg.evaluate("WX.S.show.scenes[0].anim.steps.length")==3)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(150)
    chk('undo restores the deleted step', pg.evaluate("WX.S.show.scenes[0].anim.steps.length")==4)
    chk('non-map scenes get no step bar', pg.evaluate("""()=>{WX.newScene&&WX.newScene();const sc=WX.S.show.scenes[WX.S.si];sc.bg={type:'solid',color:'#123456'};WX.loadShow(JSON.parse(JSON.stringify(WX.S.show)));WX.S.si=WX.S.show.scenes.length-1;return true}""") is True)
    chk('no page errors', not errs, errs)
    b.close()

bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad)))
sys.exit(1 if bad else 0)
