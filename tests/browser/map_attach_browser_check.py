"""v0.11.5 real-browser check: (1) releasing the playhead on a step returns to editing THAT step (dots/handles back, edits go to that step);
(2) an icon attached to a front follows it when the front is reshaped / lengthened in a later step and while gliding between steps.
Usage: python3 wxbuild.py && python3 tests/browser/map_attach_browser_check.py ; exit code 1 on failure."""
from playwright.sync_api import sync_playwright
import pathlib, sys, math
ROOT = pathlib.Path(__file__).resolve().parents[2]
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, '' if ok else info)
HTML = (ROOT / 'dist' / 'studio.html').as_uri()
SETUP = """()=>{
  const WX=window.WX,E=WX.E,sc=WX.S.show.scenes[0];
  sc.bg={type:'map',theme:'dark',view:{cx:487,cy:305,w:400},cities:false,counties:false}; sc.transition={type:'cut',dur:0};
  const front=E.newObject('front',{id:'f1',geo:true,kind:'cold',pts:[[430,300],[450,290],[470,285],[490,290],[510,300],[530,312]]});
  const ico=E.newObject('icon',{id:'i1',geo:true,x:470,y:262,icon:'rain',size:110});
  [front,ico].forEach(o=>{o.anim={in:'none',delay:0,dur:0.01}}); sc.objects=[front,ico]; sc.duration=6; WX.S.show.mbMigrated=1;
  WX.loadShow(JSON.parse(JSON.stringify(WX.S.show))); return true;}"""
def pp(pg, x, y):
    r = pg.evaluate("(()=>{const r=document.getElementById('overlay').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    return (r[0] + x * r[2] / 1920, r[1] + y * r[3] / 1080)
def scr(pg, oid, step):   # screen-space geometry of an object in a step
    return pg.evaluate("""(a)=>{const WX=window.WX,E=WX.E,sc=WX.S.show.scenes[0],objs=a.s===0?sc.objects:sc.anim.steps[a.s].objects,o=objs.find(q=>q.id===a.id);if(!o)return null;const so=E.toScreen(o,E.xf(sc,0));return so.pts?so.pts:[so.x,so.y]}""", {'id': oid, 'step': step, 's': step})
def drag(pg, a, b, n=8):
    pa, pb = pp(pg, *a), pp(pg, *b); pg.mouse.move(*pa); pg.mouse.down()
    for i in range(1, n + 1): pg.mouse.move(pa[0] + (pb[0] - pa[0]) * i / n, pa[1] + (pb[1] - pa[1]) * i / n)
    pg.mouse.up(); pg.wait_for_timeout(120)
def dist_to_front(pg, step, iid='i1', fid='f1'):   # distance (screen px) from the icon to the nearest point of the drawn front
    return pg.evaluate("""(a)=>{const WX=window.WX,MA=WX.MapAnim||window.MapAnim,E=WX.E,sc=WX.S.show.scenes[0],objs=a.s===0?sc.objects:sc.anim.steps[a.s].objects,f=objs.find(q=>q.id===a.f),c=objs.find(q=>q.id===a.i);
      const xf=E.xf(sc,0),sf=E.toScreen(f,xf),sc2=E.toScreen(c,xf),d=[];for(let k=0;k<=200;k++){const fr=MA.attachFrame(sf,k/200);d.push(Math.hypot(fr.x-sc2.x,fr.y-sc2.y));}return Math.min(...d)}""", {'s': step, 'f': fid, 'i': iid})
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1700, 'height': 980}).new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(HTML); pg.wait_for_timeout(2000); pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    pg.evaluate(SETUP); pg.wait_for_timeout(300)
    pg.locator('button', has_text='Select').first.click()
    # ---- attach the icon to the front (real UI) while still in a plain scene ----
    ic = scr(pg, 'i1', 0); pg.mouse.click(*pp(pg, *ic)); pg.wait_for_timeout(250)
    chk('icon selected', pg.evaluate("WX.S.oid") == 'i1')
    chk('the Follow control is offered for an icon', pg.locator('#attachTo').count() == 1)
    pg.select_option('#attachTo', 'f1'); pg.wait_for_timeout(250)
    att = pg.evaluate("WX.S.show.scenes[0].objects.find(o=>o.id==='i1').attach")
    chk('attaching keeps the icon where it is and records the spot on the front', att and att['to'] == 'f1' and 0.2 < att['u'] < 0.8, att)
    d0 = dist_to_front(pg, 0); chk('icon sits where it was placed (not snapped onto the line)', 40 < d0 < 140, d0)
    # moving the front in the plain scene carries the icon
    fp = scr(pg, 'f1', 0); mid = fp[2]; ic0 = scr(pg, 'i1', 0)
    pg.mouse.click(*pp(pg, *mid)); pg.wait_for_timeout(150); drag(pg, mid, (mid[0], mid[1] + 150)); pg.wait_for_timeout(200)
    ic1 = scr(pg, 'i1', 0); fp1 = scr(pg, 'f1', 0)
    chk('reshaping the front (drag a control point) pulls the attached icon along with it', abs(ic1[1] - ic0[1]) > 15, [ic0, ic1])
    # ---- animate: step 2 ----
    pg.click('#bAnimOn'); pg.wait_for_timeout(200); pg.locator('#stepbar button', has_text='Step').first.click(); pg.wait_for_timeout(250)
    chk('step 2 is being edited', pg.evaluate("WX.S.step") == 1)
    f2 = scr(pg, 'f1', 1); i2a = scr(pg, 'i1', 1)
    pg.mouse.click(*pp(pg, *f2[2])); pg.wait_for_timeout(200)
    drag(pg, f2[5], (f2[5][0] + 260, f2[5][1] - 140)); drag(pg, f2[3], (f2[3][0] + 80, f2[3][1] - 120)); pg.wait_for_timeout(300)   # lengthen + bend the front in step 2
    f2b = scr(pg, 'f1', 1); i2b = scr(pg, 'i1', 1); i1_step1 = scr(pg, 'i1', 0)
    chk('step 2: the front is reshaped (longer)', abs(f2b[5][0] - f2[5][0]) > 100, [f2[5], f2b[5]])
    chk('step 2: the attached icon followed the reshaped front', abs(i2b[0] - i2a[0]) + abs(i2b[1] - i2a[1]) > 20, [i2a, i2b])
    chk('step 1 untouched by editing step 2', scr(pg, 'f1', 0)[5] == fp1[5] and i1_step1 == ic1, [scr(pg, 'f1', 0)[5], fp1[5]])
    cons = pg.evaluate("""()=>{const MA=window.MapAnim,sc=WX.S.show.scenes[0],r=[];[0,1].forEach(k=>{const objs=k===0?sc.objects:sc.anim.steps[k].objects,f=objs.find(o=>o.id==='f1'),c=objs.find(o=>o.id==='i1'),fr=MA.attachFrame(f,c.attach.u),a=c.attach,x=fr.x+a.t*fr.tx-a.n*fr.ty,y=fr.y+a.t*fr.ty+a.n*fr.tx;r.push([Math.hypot(x-c.x,y-c.y),a.t,a.n])});return r}""")
    chk('every step keeps its icon exactly at its attach spot on that step\'s front', cons[0][0] < 1e-3 and cons[1][0] < 1e-3, cons)
    chk('step 2 kept the same spot along / across the front as step 1 (same t, n)', abs(cons[0][1] - cons[1][1]) < 1e-3 and abs(cons[0][2] - cons[1][2]) < 1e-3, cons)
    # ---- the icon glides with the front between the steps ----
    tl = pg.evaluate("WX.E.animTimeline(WX.S.show.scenes[0]).segs.find(s=>s.kind==='move')")
    worst = 0
    for k in (0.25, 0.5, 0.75):
        t = tl['t0'] + (tl['t1'] - tl['t0']) * k
        w = pg.evaluate("""(t)=>{const WX=window.WX,MA=window.MapAnim,E=WX.E,sc=WX.S.show.scenes[0],objs=E.objectsAt(sc,t),f=objs.find(q=>q.id==='f1'),c=objs.find(q=>q.id==='i1'),xf=E.xf(sc,0),sf=E.toScreen(f,xf),sc2=E.toScreen(c,xf);
          const d0=Math.hypot(...[0,1].map(i=>0));const a=sc.anim.steps[0].objects?0:0;return [sf.pts,sc2.x,sc2.y]}""", t)
        # distance icon-front at the mid frame must stay between the step-1 and step-2 distances (it never flies off the front)
        dd = pg.evaluate("""(t)=>{const WX=window.WX,MA=window.MapAnim,E=WX.E,sc=WX.S.show.scenes[0],objs=E.objectsAt(sc,t),f=objs.find(q=>q.id==='f1'),c=objs.find(q=>q.id==='i1'),xf=E.xf(sc,0),sf=E.toScreen(f,xf),cs=E.toScreen(c,xf);let m=1e9;for(let k=0;k<=200;k++){const fr=MA.attachFrame(sf,k/200);m=Math.min(m,Math.hypot(fr.x-cs.x,fr.y-cs.y));}return m}""", t)
        worst = max(worst, dd)
    chk('while gliding between the steps the icon stays beside the front (no flying off)', worst < 220, worst)
    # ---- scrub the playhead to step 2 and edit there (the reported problem: no dots) ----
    pg.evaluate("WX.S.oid=null"); pg.locator('#stepbar .sbstep').nth(0).click(); pg.wait_for_timeout(150)
    def scrub(tv):
        pg.evaluate("(t)=>{const s=document.getElementById('scrub');s.value=t;s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));}", tv); pg.wait_for_timeout(250)
    scrub(4.5)   # in the middle of the move between the steps
    chk('release mid-transition: stays a preview and explains why', pg.evaluate("WX.S.mode") == 'scrub' and 'Between steps' in pg.evaluate("document.getElementById('toast').textContent"))
    total = pg.evaluate("WX.S.show.scenes[0].duration"); scrub(total - 0.5)   # inside step 2's hold
    chk('release on step 2: back in EDIT mode on step 2', pg.evaluate("[WX.S.mode,WX.S.step]") == ['edit', 1], pg.evaluate("[WX.S.mode,WX.S.step]"))
    f2c = scr(pg, 'f1', 1); pg.mouse.click(*pp(pg, *f2c[1])); pg.wait_for_timeout(250)
    chk('front selected on step 2 after scrubbing there', pg.evaluate("WX.S.oid") == 'f1')
    # dots are drawn by the overlay in edit mode: sample the overlay canvas around a control point
    px = pg.evaluate("""(pt)=>{const cv=document.getElementById('overlay'),c=cv.getContext('2d'),sx=cv.width/1920,d=c.getImageData(Math.round(pt[0]*sx)-3,Math.round(pt[1]*sx)-3,6,6).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>200)n++;return n}""", f2c[1])
    chk('the control-point dots are drawn on the front in step 2', px > 10, px)
    before = scr(pg, 'f1', 1)[4]; drag(pg, before, (before[0] - 90, before[1] - 110)); after = scr(pg, 'f1', 1)[4]
    chk('dragging a dot edits step 2 (and only step 2)', abs(after[0] - before[0]) > 50 and scr(pg, 'f1', 0)[4] == fp1[4], [before, after])
    # scrubbing back to step 1 edits step 1
    scrub(0.4); chk('release on step 1: editing step 1', pg.evaluate("[WX.S.mode,WX.S.step]") == ['edit', 0])
    # ---- dragging the attached icon re-learns its spot; detach stops following ----
    pg.locator('#stepbar .sbstep').nth(1).click(); pg.wait_for_timeout(200)
    ic = scr(pg, 'i1', 1); pg.mouse.click(*pp(pg, *ic)); pg.wait_for_timeout(200); a0 = pg.evaluate("WX.S.show.scenes[0].anim.steps[1].objects.find(o=>o.id==='i1').attach")
    drag(pg, ic, (ic[0] + 90, ic[1] - 60)); pg.wait_for_timeout(250); ic_new = scr(pg, 'i1', 1)
    a1 = pg.evaluate("WX.S.show.scenes[0].anim.steps[1].objects.find(o=>o.id==='i1').attach")
    chk('dragging the icon puts it where released and re-learns its spot on the front', abs(ic_new[0] - ic[0] - 90) < 8 and a1 != a0, [ic, ic_new, a0, a1])
    pg.select_option('#attachTo', ''); pg.wait_for_timeout(200)
    chk('Detach removes the link', pg.evaluate("WX.S.show.scenes[0].anim.steps[1].objects.find(o=>o.id==='i1').attach") is None)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(250)
    chk('undo restores the link', pg.evaluate("(WX.S.show.scenes[0].anim.steps[1].objects.find(o=>o.id==='i1')||{}).attach") is not None)
    chk('no page errors', not errs, errs)
    b.close()
n = sum(1 for r in res if not r[1]); print('\n%d checks, %d failed' % (len(res), n)); sys.exit(1 if n else 0)
