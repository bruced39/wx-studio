"""v0.11.5 stabilisation, real-browser (headless Chromium) check of editing with Follow attachments and the playheads:
  * Follow is offered only between objects positioned the same way (both on the screen / both pinned to the map), and never creates a loop;
  * "Pin to map" on an object that has Follow links carries the whole linked group with it (links stay valid, nothing jumps), both ways;
  * step duplication, "Copy object -> all steps", Duplicate object, undo / redo and dragging keep the links and positions right;
  * during a transition the follower stays beside the drawn front (real engine, rotated + lengthened front);
  * releasing EITHER playhead on step 2 / step 3 / later puts both playheads on that step, restores editing (dots, tools), keeps the preview
    when released between steps, and leaves playback and scene switching alone.
Usage: python3 wxbuild.py && python3 tests/browser/map_attach_editing_browser_check.py [screenshot_dir]   Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import pathlib, sys, math, tempfile, os, json
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxatte_')) + '/'
os.makedirs(S, exist_ok=True)
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, '' if ok else info)
HTML = (ROOT / 'dist' / 'studio.html').as_uri()
# scene 0: a plain lead-in scene (4 s) so the second scene's playheads are offset; scene 1: map background, front + icon + H + screen-fixed text
SETUP = """()=>{
  const WX=window.WX,E=WX.E;
  const bg={type:'map',theme:'dark',view:{cx:487,cy:305,w:400},cities:false,counties:false};
  const lead=E.newScene({id:'lead',name:'Lead',duration:4,bg:{type:'solid',color:'#103050',kenburns:false},title:{show:false,text:'',sub:''},objects:[]});
  const front=E.newObject('front',{id:'f1',geo:true,kind:'cold',pts:[[430,300],[450,290],[470,285],[490,290],[510,300],[530,312]]});
  const ico=E.newObject('icon',{id:'i1',geo:true,x:470,y:262,icon:'rain',size:110}); const hl=E.newObject('hl',{id:'h1',geo:true,x:515,y:330,kind:'H',value:'1030',size:150});
  const txt=E.newObject('text',{id:'t2',x:960,y:140,text:'SCREEN LABEL',size:60});
  [front,ico,hl,txt].forEach(o=>{o.anim={in:'none',delay:0,dur:0.01}});
  const sc=E.newScene({id:'main',name:'Main',duration:6,bg,title:{show:false,text:'',sub:''},transition:{type:'cut',dur:0},objects:[front,ico,hl,txt]});
  WX.loadShow({name:'Editing',accent:'#2f9bff',scenes:[lead,sc],assets:{},mbMigrated:1}); WX.S.si=1; return true;}"""
def pp(pg, x, y):
    r = pg.evaluate("(()=>{const r=document.getElementById('overlay').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    return (r[0] + x * r[2] / 1920, r[1] + y * r[3] / 1080)
def scr(pg, oid, step=0):   # screen-space geometry of an object in a step of scene 1 (list of points or [x, y])
    return pg.evaluate("""(a)=>{const WX=window.WX,E=WX.E,sc=WX.S.show.scenes[1],objs=a.s===0?sc.objects:sc.anim.steps[a.s].objects,o=objs.find(q=>q.id===a.id);if(!o)return null;const so=E.toScreen(o,E.xf(sc,0));return so.pts?so.pts:[so.x,so.y]}""", {'id': oid, 's': step})
def drag(pg, a, b, n=8):
    pa, pb = pp(pg, *a), pp(pg, *b); pg.mouse.move(*pa); pg.mouse.down()
    for i in range(1, n + 1): pg.mouse.move(pa[0] + (pb[0] - pa[0]) * i / n, pa[1] + (pb[1] - pa[1]) * i / n)
    pg.mouse.up(); pg.wait_for_timeout(150)
CONS = """()=>{const MA=MapAnim,sc=WX.S.show.scenes[1],w=[];const lists=[sc.objects].concat((sc.anim&&sc.anim.steps||[]).slice(1).map(s=>s.objects));
  lists.forEach((objs,k)=>objs.forEach(o=>{if(!o.attach)return;const par=objs.find(q=>q.id===o.attach.to);if(!par){w.push(['noparent',k,o.id]);return}const p=MA.attachPos(o.attach,par,{});w.push([k,o.id,Math.hypot(p[0]-o.x,p[1]-o.y)])}));return w}"""
def cons_ok(pg):
    w = pg.evaluate(CONS); return all(len(x) == 3 and not isinstance(x[0], str) and x[2] < 1e-4 for x in w), w
def att(pg, oid, step=0): return pg.evaluate("(a)=>{const sc=WX.S.show.scenes[1],objs=a.s===0?sc.objects:sc.anim.steps[a.s].objects;const o=objs.find(q=>q.id===a.id);return o&&o.attach?JSON.parse(JSON.stringify(o.attach)):null}", {'id': oid, 's': step})
PIN_JS = "(()=>{const l=[...document.querySelectorAll('#panels label')].find(x=>x.textContent.includes('Pin to map'));const i=l.querySelector('input')||l.parentElement.querySelector('input[type=checkbox]');i.click()})()"
def pin_toggle(pg): pg.evaluate(PIN_JS); pg.wait_for_timeout(400)
def sel(pg, oid):
    pg.evaluate("(id)=>{WX.S.oid=id;WX.setTab&&WX.setTab('object')}", oid); pg.wait_for_timeout(250)
def options(pg): return pg.evaluate("(()=>{const s=document.getElementById('attachTo');return s?[...s.options].map(o=>o.value):null})()")
def fprop(pg, step, oid, js): return pg.evaluate("(a)=>{const sc=WX.S.show.scenes[1],o=(a.s===0?sc.objects:sc.anim.steps[a.s].objects).find(q=>q.id===a.id);return (%s)(o)}" % js, {'s': step, 'id': oid})

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1700, 'height': 980}).new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto(HTML); pg.wait_for_timeout(2000); pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    pg.evaluate(SETUP); pg.wait_for_timeout(400)
    pg.locator('#scenes .sc, .sc').nth(1).click(); pg.wait_for_timeout(500)
    pg.locator('button', has_text='Select').first.click()
    chk('editing scene 2 (a lead-in scene precedes it)', pg.evaluate("WX.S.si") == 1)

    # ================= Follow options are limited to compatible objects, and never loop =================
    sel(pg, 'i1'); o = options(pg)
    chk('a pinned icon can follow the pinned front and the pinned H, but NOT the screen-fixed text', o is not None and 'f1' in o and 'h1' in o and 't2' not in o, o)
    hint = pg.evaluate("[...document.querySelectorAll('#panels .hint')].map(x=>x.textContent).join(' | ')")
    chk('the panel explains why an object is not listed', 'not listed' in hint and 'pinned' in hint, hint[:200])
    sel(pg, 't2'); o2 = options(pg)
    chk('a screen-fixed text is not offered any pinned object', o2 is None or (('f1' not in o2) and ('i1' not in o2)), o2)
    sel(pg, 'i1'); pg.select_option('#attachTo', 'f1'); pg.wait_for_timeout(250)
    chk('icon follows the front', (att(pg, 'i1') or {}).get('to') == 'f1')
    sel(pg, 'h1'); pg.select_option('#attachTo', 'i1'); pg.wait_for_timeout(250)
    chk('H follows the icon (a chain H -> icon -> front)', (att(pg, 'h1') or {}).get('to') == 'i1')
    sel(pg, 'i1'); o3 = options(pg)
    chk('the icon is no longer offered the H (it would make a loop through the chain)', 'h1' not in o3 and 'f1' in o3, o3)
    # a loop forced from the outside (script / damaged data) is broken on the next update and does not spin
    pg.evaluate("(()=>{const o=WX.S.show.scenes[1].objects.find(q=>q.id==='i1');o.attach={to:'h1',u:0,t:0,n:0}})()"); pg.wait_for_timeout(500)
    chk('a loop of two is broken by the editor loop (no crash, one link removed)', sum(1 for i in ('i1', 'h1') if att(pg, i)) < 2 and not errs, errs[:1])
    pg.evaluate("WX.undo()"); pg.wait_for_timeout(200)
    sel(pg, 'i1'); pg.select_option('#attachTo', 'f1'); pg.wait_for_timeout(200); sel(pg, 'h1'); pg.select_option('#attachTo', 'i1'); pg.wait_for_timeout(250)
    ok, w = cons_ok(pg); chk('chain restored; every follower on its parent', ok and att(pg, 'h1') and att(pg, 'i1'), w)

    # ================= Pin / unpin AFTER the links exist =================
    def screen_pos(oid): return scr(pg, oid, 0)
    pos0 = {k: screen_pos(k) for k in ('i1', 'h1')}; fr0 = screen_pos('f1')
    sel(pg, 'f1'); pin = pg.locator('#panels label:has-text("Pin to map") input, #panels input[type=checkbox]').first
    labels = pg.evaluate("[...document.querySelectorAll('#panels label')].map(l=>l.textContent.trim())")
    chk('the front has a "Pin to map" option', any('Pin to map' in l for l in labels), labels[:6])
    pin_toggle(pg); pg.wait_for_timeout(400)
    geo = pg.evaluate("Object.fromEntries(WX.S.show.scenes[1].objects.map(o=>[o.id,!!o.geo]))")
    chk('unpinning the front unpins the icon and the H that follow it (they travel as one group); the screen text is untouched', geo == {'f1': False, 'i1': False, 'h1': False, 't2': False}, geo)
    chk('all links survived the unpin and every follower is still exactly on its parent', att(pg, 'i1') and att(pg, 'h1') and cons_ok(pg)[0], cons_ok(pg)[1])
    pos1 = {k: screen_pos(k) for k in ('i1', 'h1')}; fr1 = screen_pos('f1')
    chk('nothing jumped on screen when unpinning (icon, H and front within 1.5 px)', all(abs(pos1[k][0] - pos0[k][0]) < 1.5 and abs(pos1[k][1] - pos0[k][1]) < 1.5 for k in pos0) and abs(fr1[2][0] - fr0[2][0]) < 1.5, [pos0, pos1])
    chk('the toast says what happened', 'linked' in pg.evaluate("document.getElementById('toast').textContent"), pg.evaluate("document.getElementById('toast').textContent"))
    # screen-space now: moving the front by dragging a point still carries the group
    sel(pg, 'f1'); icon_y0 = screen_pos('i1')[1]; drag(pg, fr1[2], (fr1[2][0], fr1[2][1] + 90))
    chk('after unpinning, reshaping the front still pulls the followers', abs(screen_pos('i1')[1] - icon_y0) > 15, [icon_y0, screen_pos('i1')])
    pg.evaluate("WX.undo()"); pg.wait_for_timeout(300)
    sel(pg, 'f1'); pin_toggle(pg); pg.wait_for_timeout(400)
    geo2 = pg.evaluate("Object.fromEntries(WX.S.show.scenes[1].objects.map(o=>[o.id,!!o.geo]))")
    chk('pinning the front again pins the whole group back onto the map', geo2 == {'f1': True, 'i1': True, 'h1': True, 't2': False}, geo2)
    pos2 = {k: screen_pos(k) for k in ('i1', 'h1')}
    chk('…and nothing jumped (within 2 px of where it started), links intact', all(abs(pos2[k][0] - pos0[k][0]) < 2 and abs(pos2[k][1] - pos0[k][1]) < 2 for k in pos0) and cons_ok(pg)[0] and att(pg, 'i1') and att(pg, 'h1'), [pos0, pos2])
    # a child alone cannot be pinned away from its parent: toggling the ICON moves the group too
    sel(pg, 'i1'); pin_toggle(pg); pg.wait_for_timeout(400)
    geo3 = pg.evaluate("Object.fromEntries(WX.S.show.scenes[1].objects.map(o=>[o.id,!!o.geo]))")
    chk('unpinning only the icon also carries its front and its H (never a half-pinned link)', geo3['f1'] == geo3['i1'] == geo3['h1'] == False, geo3)
    chk('…and no link joins objects positioned differently, ever', pg.evaluate("(()=>{const o=WX.S.show.scenes[1].objects;return o.every(c=>!c.attach||!!o.find(p=>p.id===c.attach.to).geo===!!c.geo)})()"))
    sel(pg, 'i1'); pin_toggle(pg); pg.wait_for_timeout(400)   # back to pinned

    # ================= animate: steps, duplicate step, copy to all steps, duplicate object =================
    pg.click('#bAnimOn'); pg.wait_for_timeout(250); pg.locator('#stepbar button', has_text='Step').first.click(); pg.wait_for_timeout(300)
    chk('step 2 added and being edited', pg.evaluate("WX.S.step") == 1)
    f2 = scr(pg, 'f1', 1); sel(pg, 'f1'); pg.mouse.click(*pp(pg, *f2[2])); pg.wait_for_timeout(200)
    i1_step1 = scr(pg, 'i1', 0)
    drag(pg, f2[5], (f2[5][0] + 260, f2[5][1] - 160)); drag(pg, f2[3], (f2[3][0] + 70, f2[3][1] - 110)); pg.wait_for_timeout(300)
    ok, w = cons_ok(pg)
    chk('step 2: reshaped front; icon and H (chain) followed; every step consistent', ok and abs(scr(pg, 'i1', 1)[0] - i1_step1[0]) + abs(scr(pg, 'i1', 1)[1] - i1_step1[1]) > 20 and scr(pg, 'i1', 0) == i1_step1, w)
    # --- undo / redo of a front edit that drags followers ---
    snapB = pg.evaluate("JSON.stringify(WX.S.show.scenes[1].anim.steps[1].objects.filter(o=>o.id==='f1'||o.attach).map(o=>[o.id,o.x,o.y,o.pts,o.attach]))")
    drag(pg, scr(pg, 'f1', 1)[1], (scr(pg, 'f1', 1)[1][0] - 40, scr(pg, 'f1', 1)[1][1] + 130)); pg.wait_for_timeout(250)
    snapC = pg.evaluate("JSON.stringify(WX.S.show.scenes[1].anim.steps[1].objects.filter(o=>o.id==='f1'||o.attach).map(o=>[o.id,o.x,o.y,o.pts,o.attach]))")
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(350)
    snapU = pg.evaluate("JSON.stringify(WX.S.show.scenes[1].anim.steps[1].objects.filter(o=>o.id==='f1'||o.attach).map(o=>[o.id,o.x,o.y,o.pts,o.attach]))")
    pg.keyboard.press('Control+Shift+z'); pg.wait_for_timeout(350)
    snapR = pg.evaluate("JSON.stringify(WX.S.show.scenes[1].anim.steps[1].objects.filter(o=>o.id==='f1'||o.attach).map(o=>[o.id,o.x,o.y,o.pts,o.attach]))")
    def near(a_, b_):
        A_, B_ = json.loads(a_), json.loads(b_)
        def flat(v): return [x for q in v for x in (flat(q) if isinstance(q, list) else [q])] if isinstance(v, list) else [v]
        fa, fb = flat(A_), flat(B_); return len(fa) == len(fb) and all((abs(x - y) < 1e-4 if isinstance(x, (int, float)) and isinstance(y, (int, float)) else x == y) for x, y in zip(fa, fb))
    chk('the drag changed the front and its followers', snapB != snapC)
    chk('undo puts the front AND its followers (and their attach records) back exactly', near(snapU, snapB), snapU[:120])
    chk('redo brings back the dragged front and the moved followers', near(snapR, snapC))
    chk('followers still on their parents after undo / redo', cons_ok(pg)[0], cons_ok(pg)[1])
    # --- dragging a follower: re-learn; undo / redo of that ---
    sel(pg, 'i1'); ic = scr(pg, 'i1', 1); a0 = att(pg, 'i1', 1); drag(pg, ic, (ic[0] + 80, ic[1] - 50)); a1 = att(pg, 'i1', 1)
    chk('dragging a follower re-learns its place on the front', a0 != a1 and abs(scr(pg, 'i1', 1)[0] - ic[0] - 80) < 8, [a0, a1])
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    chk('undo of that drag restores the previous place AND the previous attach record', att(pg, 'i1', 1) == a0 and abs(scr(pg, 'i1', 1)[0] - ic[0]) < 2, [att(pg, 'i1', 1), a0])
    pg.keyboard.press('Control+Shift+z'); pg.wait_for_timeout(300)
    chk('redo restores the dragged place and record', att(pg, 'i1', 1) == a1)
    pg.keyboard.press('Control+z'); pg.wait_for_timeout(300)
    # --- duplicate the step (⧉) ---
    s2_before = pg.evaluate("JSON.stringify(WX.S.show.scenes[1].anim.steps[1].objects)")
    pg.locator('#stepbar button[title*="Duplicate this step"]').click(); pg.wait_for_timeout(350)
    n_steps = pg.evaluate("WX.S.show.scenes[1].anim.steps.length")
    chk('step duplicated (3 steps), now editing the copy', n_steps == 3 and pg.evaluate("WX.S.step") == 2, [n_steps, pg.evaluate("WX.S.step")])
    s3 = pg.evaluate("JSON.stringify(WX.S.show.scenes[1].anim.steps[2].objects)")
    chk('the copy has the same positions and attach records as the original step', json.loads(s3) == json.loads(s2_before))
    chk('the copy is independent (own objects, own links)', pg.evaluate("(()=>{const a=WX.S.show.scenes[1].anim.steps;return a[1].objects!==a[2].objects&&a[1].objects.find(o=>o.id==='i1').attach!==a[2].objects.find(o=>o.id==='i1').attach})()"))
    sel(pg, 'f1'); f3 = scr(pg, 'f1', 2); i3a = scr(pg, 'i1', 2); i2a = scr(pg, 'i1', 1); drag(pg, f3[0], (f3[0][0] - 120, f3[0][1] + 150)); pg.wait_for_timeout(300)
    chk('editing the copied step moves its followers there and leaves step 2 untouched', abs(scr(pg, 'i1', 2)[0] - i3a[0]) + abs(scr(pg, 'i1', 2)[1] - i3a[1]) > 5 and scr(pg, 'i1', 1) == i2a and json.dumps(json.loads(pg.evaluate("JSON.stringify(WX.S.show.scenes[1].anim.steps[1].objects)")), sort_keys=True) == json.dumps(json.loads(s2_before), sort_keys=True), [i3a, scr(pg, 'i1', 2)])
    ok, w = cons_ok(pg); chk('all three steps consistent', ok, w)
    # --- Copy object -> all steps ---
    sel(pg, 'i1'); pg.evaluate("[...document.querySelectorAll('#stepbar button')].find(b=>b.textContent.includes('Copy object'))&&[...document.querySelectorAll('#stepbar button')].find(b=>b.textContent.includes('Copy object')).click()"); pg.wait_for_timeout(350)
    ok, w = cons_ok(pg)
    chk('Copy object -> all steps: in every step the icon sits on THAT step\'s front (links kept)', ok and all(att(pg, 'i1', k) for k in range(3)), w)
    # --- Duplicate the follower object ---
    sel(pg, 'i1'); pg.evaluate("[...document.querySelectorAll('#panels button, .toolbar button, button')].find(b=>b.textContent.trim()==='Duplicate'&&!b.title).click()") if False else pg.evaluate("document.querySelector('button.dupObj')&&0")
    pg.evaluate("[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Duplicate')[0].click()"); pg.wait_for_timeout(350)
    ids = pg.evaluate("WX.S.show.scenes[1].anim.steps[2].objects.map(o=>o.id)"); newid = pg.evaluate("WX.S.oid")
    dup = att(pg, newid, 2); orig_pos = scr(pg, 'i1', 2); dpos = scr(pg, newid, 2)
    chk('a duplicated follower follows the same front, sits offset from the original (not snapped back on top of it)', dup and dup['to'] == 'f1' and math.hypot(dpos[0] - orig_pos[0], dpos[1] - orig_pos[1]) > 15, [dup, orig_pos, dpos])
    pg.wait_for_timeout(500); dpos2 = scr(pg, newid, 2)
    chk('…and it stays there after the editor updates', abs(dpos2[0] - dpos[0]) < 0.5 and abs(dpos2[1] - dpos[1]) < 0.5)
    ok, w = cons_ok(pg); chk('every step still consistent', ok, w)
    pg.evaluate("WX.undo()"); pg.wait_for_timeout(250)

    # ================= in-between accuracy in the REAL engine (rotated + lengthened front) =================
    sc1 = "WX.S.show.scenes[1]"
    pg.evaluate("WX.S.step=0"); pg.wait_for_timeout(100)
    pg.evaluate("""()=>{const sc=WX.S.show.scenes[1], MA=MapAnim; const s2=sc.anim.steps[1].objects; const f=s2.find(o=>o.id==='f1'); const c=[480,298];
      f.pts=f.pts.map(p=>{const a=1.1,dx=p[0]-c[0],dy=p[1]-c[1];return [c[0]+dx*Math.cos(a)-dy*Math.sin(a),c[1]+dx*Math.sin(a)+dy*Math.cos(a)]}); f.pts.push([f.pts[5][0]+40,f.pts[5][1]+30]);
      MA.sanitizeAttach(sc); WX.commit();}"""); pg.wait_for_timeout(300)
    drift = pg.evaluate("""()=>{const E=WX.E,MA=MapAnim,sc=WX.S.show.scenes[1],tl=MA.timeline(sc),mv=tl.segs.find(s=>s.kind==='move'),xf=E.xf(sc,0),k=xf.k;
      const A=sc.objects,B=sc.anim.steps[1].objects; let worst=0,worstPlain=0;
      for(let q=1;q<30;q++){const u=q/30,t=mv.t0+(mv.t1-mv.t0)*u,objs=E.objectsAt(sc,t),f=E.toScreen(objs.find(o=>o.id==='f1'),xf);
        // easing: recover the eased progress from the front itself is awkward; use the engine's own frame for BOTH numbers
        ['i1'].forEach(id=>{const c=E.toScreen(objs.find(o=>o.id===id),xf),at=objs.find(o=>o.id===id).attach,fr=MA.attachFrame(f,at.u),ex=[fr.x+k*(at.t*fr.tx-at.n*fr.ty),fr.y+k*(at.t*fr.ty+at.n*fr.tx)];
          worst=Math.max(worst,Math.hypot(c.x-ex[0],c.y-ex[1]));
          // what plain blending of the two stored positions would have given at the same eased progress (same u as the engine used)
          const a=A.find(o=>o.id===id),b=B.find(o=>o.id===id),ca=E.toScreen(a,xf),cb=E.toScreen(b,xf),fa=E.toScreen(A.find(o=>o.id==='f1'),xf),fb=E.toScreen(B.find(o=>o.id==='f1'),xf);
          // progress = how far the engine's child is along the straight line between the two stored positions' projection
          const dx=cb.x-ca.x,dy=cb.y-ca.y,l2=dx*dx+dy*dy||1,pr=Math.max(0,Math.min(1,((c.x-ca.x)*dx+(c.y-ca.y)*dy)/l2)),pl=[ca.x+dx*pr,ca.y+dy*pr];worstPlain=Math.max(worstPlain,Math.hypot(pl[0]-ex[0],pl[1]-ex[1]))})}
      return {worst:Math.round(worst*100)/100,worstPlainBlend:Math.round(worstPlain*10)/10}}""")
    chk('during the move to the rotated + lengthened front the icon stays exactly where its link says, relative to the DRAWN in-between front (engine frames, within 3 screen px)', drift['worst'] < 3, drift)
    pg.screenshot(path=S + 'attach_editing.png')

    # ================= playheads =================
    pg.evaluate("WX.S.si=1;WX.S.mode='edit'"); pg.locator('.sc').nth(1).click(); pg.wait_for_timeout(500)
    tl = pg.evaluate("(()=>{const sc=WX.S.show.scenes[1],MA=MapAnim;return {st:WX.E.starts(WX.S.show)[1],arr:[0,1,2].map(k=>MA.stepTimes(sc,k).arrive),dur:sc.duration}})()")
    chk('timeline sanity: scene 2 starts after the lead-in scene; steps arrive in order', abs(tl['st'] - 4) < 1e-6 and tl['arr'][0] < tl['arr'][1] < tl['arr'][2], tl)
    def state(): return pg.evaluate("""()=>{const top=document.getElementById('scrub'),sb=document.getElementById('sbScrub'),head=document.getElementById('sbHead');
      return {mode:WX.S.mode,step:WX.S.step,top:+top.value,sb:+sb.value,head:head?parseFloat(head.style.left):null,tc:document.getElementById('tc').textContent,focus:document.activeElement&&document.activeElement.id,dur:WX.S.show.scenes[1].duration}}""")
    def release(slider, t_in_scene):   # a real "grab, drag and let go" on a range input: focus it, move it, fire input + change
        pg.evaluate("""([id,t,st])=>{const s=document.getElementById(id);s.focus();s.value=id==='scrub'?st+t:t;s.dispatchEvent(new Event('input',{bubbles:true}));}""", [slider, t_in_scene, tl['st']]); pg.wait_for_timeout(120)
        mid = state()
        pg.evaluate("""(id)=>{document.getElementById(id).dispatchEvent(new Event('change',{bubbles:true}))}""", slider); pg.wait_for_timeout(300)
        return mid, state()
    for which in ('sbScrub', 'scrub'):
        for k in (1, 2, 0):
            arr = tl['arr'][k]; mid, st = release(which, arr + 0.3)
            chk('release %s near step %d: back to EDIT on that step' % (which, k + 1), mid['mode'] == 'scrub' and st['mode'] == 'edit' and st['step'] == k, [mid['mode'], st])
            chk('…both playheads now show step %d (%s slider at %.2f s, top slider at scene start + %.2f, head at %.1f %%)' % (k + 1, which, arr, arr, 100 * arr / tl['dur']), abs(st['sb'] - arr) < 0.02 and abs(st['top'] - (tl['st'] + arr)) < 0.02 and abs(st['head'] - 100 * arr / tl['dur']) < 0.2, st)
            chk('…and the clock text agrees', ('%.1f' % (tl['st'] + arr)) in st['tc'], st['tc'])
    # editing tools really are back: front handles drawn + draggable on step 3 after the release
    release('sbScrub', tl['arr'][2] + 0.2); pg.evaluate("WX.S.oid='f1'"); pg.wait_for_timeout(300)
    fr3 = scr(pg, 'f1', 2)
    px = pg.evaluate("""(pt)=>{const cv=document.getElementById('overlay'),c=cv.getContext('2d'),sx=cv.width/1920,d=c.getImageData(Math.round(pt[0]*sx)-3,Math.round(pt[1]*sx)-3,6,6).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>200)n++;return n}""", fr3[2])
    chk('control-point dots are drawn on the front after releasing on step 3', px > 10, px)
    s2snap = pg.evaluate("JSON.stringify(WX.S.show.scenes[1].anim.steps[1].objects)")
    drag(pg, fr3[2], (fr3[2][0] + 70, fr3[2][1] - 90))
    chk('dragging a dot edits step 3 only (step 2 data identical)', abs(scr(pg, 'f1', 2)[2][0] - fr3[2][0]) > 30 and pg.evaluate("JSON.stringify(WX.S.show.scenes[1].anim.steps[1].objects)") == s2snap)
    # released BETWEEN steps: stays a preview
    mv = pg.evaluate("(()=>{const m=MapAnim.timeline(WX.S.show.scenes[1]).segs.find(s=>s.kind==='move');return [m.t0,m.t1]})()"); mid_t = (mv[0] + mv[1]) / 2
    pre_step = pg.evaluate("WX.S.step"); m1, s1 = release('sbScrub', mid_t)
    chk('release between two steps keeps the preview (no mode change, step unchanged) and says why', s1['mode'] == 'scrub' and s1['step'] == pre_step and 'Between steps' in pg.evaluate("document.getElementById('toast').textContent"), s1)
    m2, s2 = release('scrub', mid_t)
    chk('same for the top playhead', s2['mode'] == 'scrub' and s2['step'] == pre_step, s2)
    # keyboard use of a focused playhead never snaps you back
    pg.evaluate("document.getElementById('sbScrub').focus()"); pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(250)
    chk('arrow keys on a focused playhead scrub (preview), they do not jump into editing', pg.evaluate("WX.S.mode") == 'scrub')
    # back to a step by clicking its block; playheads follow
    pg.locator('#stepbar .sbstep').nth(1).click(); pg.wait_for_timeout(300); st = state()
    chk('clicking a step block edits it and puts both playheads on it', st['mode'] == 'edit' and st['step'] == 1 and abs(st['sb'] - tl['arr'][1]) < 0.02 and abs(st['top'] - (tl['st'] + tl['arr'][1])) < 0.02, st)
    # playback timing + scene switching unaffected
    tot0 = pg.evaluate("WX.E.total(WX.S.show)"); dur0 = pg.evaluate("WX.S.show.scenes[1].duration")
    pg.click('#bPlayScene'); pg.wait_for_timeout(900); playing = pg.evaluate("[WX.S.mode, WX.S.T]")
    chk('Play scene runs (mode play, clock inside scene 2)', playing[0] == 'play' and 4 <= playing[1] <= 4 + dur0 + 0.2, playing)
    pg.click('#bStop'); pg.wait_for_timeout(300); st = state()
    chk('Stop: back to editing; both playheads on the edited step again', st['mode'] == 'edit' and abs(st['sb'] - tl['arr'][st['step']]) < 0.02 and abs(st['top'] - (tl['st'] + tl['arr'][st['step']])) < 0.02, st)
    chk('totals and durations unchanged by all this scrubbing', pg.evaluate("WX.E.total(WX.S.show)") == tot0 and pg.evaluate("WX.S.show.scenes[1].duration") == dur0)
    pg.locator('.sc').nth(0).click(); pg.wait_for_timeout(500)
    chk('switching to the lead-in scene: playhead at its start, edit mode', pg.evaluate("[WX.S.si, WX.S.mode, +document.getElementById('scrub').value]") == [0, 'edit', 0], pg.evaluate("[WX.S.si, WX.S.mode, +document.getElementById('scrub').value]"))
    pg.locator('.sc').nth(1).click(); pg.wait_for_timeout(500); st = state()
    chk('and back to the animated scene: playheads on its current step', st['mode'] == 'edit' and abs(st['top'] - (tl['st'] + tl['arr'][st['step']])) < 0.02, st)
    chk('no page errors', not errs, errs[:3])
    b.close()
n = sum(1 for r in res if not r[1]); print('\n%d checks, %d failed' % (len(res), n)); sys.exit(1 if n else 0)
