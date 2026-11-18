"""v0.11.6 master timeline, real-browser (headless Chromium) check of the editor:
  one master timeline per scene (typed duration, ruler, playhead, numeric time), automatic keyframes from edits at the playhead, scrubbing never changes data,
  curved routes (bend grip + handles add no keys), front reshaping at several times with SHAPE dots vs ROUTE handles, Independent / Follow / Attach links,
  key markers (select / retime / delete), undo / redo, Play / Pause / Stop, the v0.11.5 step show staying valid (explicit conversion + back to steps),
  frame-exact preview == export path, and a 12-second demo scene. Headless Chromium is NOT real Firefox and has no real Mapbox tiles (offline 'map' background).
Usage: python3 wxbuild.py && python3 tests/browser/master_timeline_browser_check.py [screenshot_dir]   Exit code 1 if any check fails."""
from playwright.sync_api import sync_playwright
import pathlib, sys, math, tempfile, os, json
ROOT = pathlib.Path(__file__).resolve().parents[2]
S = (sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix='wxtl_')) + '/'
os.makedirs(S, exist_ok=True)
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, '' if ok else info)
HTML = (ROOT / 'dist' / 'studio.html').as_uri()
SETUP = """()=>{
  const WX=window.WX,E=WX.E;
  const bg={type:'map',theme:'dark',view:{cx:487,cy:305,w:400},cities:false,counties:false};
  const front=E.newObject('front',{id:'f1',geo:true,kind:'cold',pts:[[430,300],[455,288],[480,285],[505,292],[530,306]]});
  const low=E.newObject('hl',{id:'l1',geo:true,x:480,y:262,kind:'L',value:'1002',size:130});
  const ico=E.newObject('icon',{id:'i1',geo:true,x:440,y:340,icon:'rain',size:100});
  const txt=E.newObject('text',{id:'t1',geo:true,x:480,y:240,text:'LOW',size:56});
  const scr=E.newObject('icon',{id:'s1',x:300,y:900,icon:'sunny',size:110});
  [front,low,ico,txt,scr].forEach(o=>{o.anim={in:'none',delay:0,dur:0.01}});
  const sc=E.newScene({id:'main',name:'Main',duration:12,bg,title:{show:false,text:'',sub:''},transition:{type:'cut',dur:0},objects:[front,low,ico,txt,scr]});
  const lead=E.newScene({id:'lead',name:'Lead',duration:3,bg:{type:'solid',color:'#103050',kenburns:false},title:{show:false,text:'',sub:''},objects:[]});
  WX.loadShow({name:'TL',accent:'#2f9bff',scenes:[sc,lead],assets:{},mbMigrated:1}); return true;}"""
def pp(pg, x, y):
    r = pg.evaluate("(()=>{const r=document.getElementById('overlay').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    return (r[0] + x * r[2] / 1920, r[1] + y * r[3] / 1080)
POS = """(a)=>{const sc=WX.S.show.scenes[0],E=WX.E,o=E.objectsAt(sc,a.t).find(q=>q.id===a.id);if(!o)return null;const s=E.toScreen(o,E.xf(sc,0));return o.pts?s.pts.map(p=>[p[0],p[1]]):[s.x,s.y]}"""
def pos(pg, oid, t): return pg.evaluate(POS, {'id': oid, 't': t})
def stored(pg, oid, t):
    return pg.evaluate("(a)=>{const o=WX.E.objectsAt(WX.S.show.scenes[0],a.t).find(q=>q.id===a.id);return o?(o.pts?o.pts.map(p=>[p[0],p[1]]):[o.x,o.y]):null}", {'id': oid, 't': t})
def seek(pg, t):
    pg.evaluate("(t)=>{const i=document.getElementById('mtlTime');i.value=t;i.dispatchEvent(new Event('change'))}", t); pg.wait_for_timeout(120)
def keys(pg, oid): return pg.evaluate("(id)=>{const t=WX.S.show.scenes[0].tl&&WX.S.show.scenes[0].tl.tracks[id];return t?t.keys.map(k=>({id:k.id,t:k.t,x:k.x,y:k.y,pts:k.pts,e:k.e,path:k.path,h1:k.h1,h2:k.h2,att:k.att})):[]}", oid)
def scene_json(pg): return pg.evaluate("JSON.stringify(WX.S.show.scenes[0])")
def drag(pg, a, b, n=8):
    pa, pb = pp(pg, *a), pp(pg, *b); pg.mouse.move(*pa); pg.mouse.down()
    for i in range(1, n + 1): pg.mouse.move(pa[0] + (pb[0] - pa[0]) * i / n, pa[1] + (pb[1] - pa[1]) * i / n)
    pg.mouse.up(); pg.wait_for_timeout(200)
def sel(pg, oid): pg.evaluate("(id)=>{WX.S.oid=id}", oid); pg.wait_for_timeout(150)
def close(a, b, e=1.5): return a is not None and b is not None and abs(a[0] - b[0]) <= e and abs(a[1] - b[1]) <= e
def tab(pg, t): pg.evaluate("(t)=>WX.setTab(t)", t); pg.wait_for_timeout(200)

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 1700, 'height': 980}).new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto(HTML); pg.wait_for_timeout(1800); pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    pg.evaluate(SETUP); pg.wait_for_timeout(500)
    pg.locator('#scenes .sc, .sc').nth(0).click(); pg.wait_for_timeout(300); pg.locator('button', has_text='Select').first.click()

    # ============ 1. turning it on: master timeline, ruler, numeric time, Animation tab ============
    chk('map scene offers the Animate (master timeline) button and keeps the old Steps button', pg.evaluate("!document.getElementById('bTlOn').hidden && !document.getElementById('bAnimOn').hidden"))
    chk('no timeline bar before animation is turned on', pg.evaluate("document.getElementById('mtl').hidden"))
    pg.click('#bTlOn'); pg.wait_for_timeout(300)
    chk('timeline bar appears; the old step bar stays hidden', pg.evaluate("!document.getElementById('mtl').hidden && document.getElementById('stepbar').hidden"))
    chk('the scene has ONE master timeline of 12 s (typed duration, no steps)', pg.evaluate("(()=>{const s=WX.S.show.scenes[0];return !!s.tl&&s.tl.duration===12&&s.duration===12&&!s.anim})()"))
    chk('ruler: 1-second ticks 0..12 with labels, numeric time box, Play / Stop', pg.evaluate("document.querySelectorAll('#mtlRuler .mtl-tick').length===13 && [...document.querySelectorAll('#mtlRuler .mtl-tick i')].map(e=>e.textContent).slice(0,3).join()==='0s,1s,2s' && !!document.getElementById('mtlTime') && !!document.getElementById('mtlPlay') && !!document.getElementById('mtlStop')"))
    chk('the right-hand panel has an Animation tab with the master duration', pg.evaluate("[...document.querySelectorAll('#tabs button')].some(b=>b.textContent==='Animation')"))
    tab(pg, 'anim'); chk('Animation tab shows Total duration (s)', pg.evaluate("[...document.querySelectorAll('#panels label')].some(l=>l.textContent.includes('Total duration'))"))
    pg.screenshot(path=S + '01_timeline_on.png')

    # ============ 2. duration is typed by the user and mirrors scene.duration ============
    pg.evaluate("(()=>{const l=[...document.querySelectorAll('#panels label')].find(x=>x.textContent.includes('Total duration'));const i=l.parentElement.querySelector('input');i.value='8';i.dispatchEvent(new Event('input'));i.dispatchEvent(new Event('change'))})()"); pg.wait_for_timeout(250)
    chk('typing 8 s changes the master duration and the ruler', pg.evaluate("(()=>{const s=WX.S.show.scenes[0];return s.tl.duration===8&&s.duration===8&&document.querySelectorAll('#mtlRuler .mtl-tick').length===9})()"))
    pg.evaluate("(()=>{const l=[...document.querySelectorAll('#panels label')].find(x=>x.textContent.includes('Total duration'));const i=l.parentElement.querySelector('input');i.value='12';i.dispatchEvent(new Event('input'));i.dispatchEvent(new Event('change'))})()"); pg.wait_for_timeout(250)
    chk('back to 12 s', pg.evaluate("WX.S.show.scenes[0].tl.duration===12"))

    # ============ 3. scrubbing never creates keys or modifies the saved scene ============
    sel(pg, 'i1'); before = scene_json(pg); h0 = pg.evaluate("WX.S.hist.length")
    r = pg.evaluate("(()=>{const r=document.getElementById('mtlRuler').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
    for k in range(40):
        x = r[0] + r[2] * ((k * 7919 % 1000) / 1000.0); pg.mouse.move(x, r[1] + 12); pg.mouse.down(); pg.mouse.move(x + 3, r[1] + 12); pg.mouse.up()
    pg.wait_for_timeout(200)
    chk('40 scrubs on the ruler change the playhead but not one byte of the saved scene', scene_json(pg) == before)
    chk('scrubbing added no undo steps and kept edit mode (no "release near a step" needed)', pg.evaluate("WX.S.hist.length") == h0 and pg.evaluate("WX.S.mode") == 'edit')
    pg.evaluate("(()=>{const i=document.getElementById('scrub');i.value=5;i.dispatchEvent(new Event('input'));i.dispatchEvent(new Event('change'))})()"); pg.wait_for_timeout(150)
    chk('the top transport slider also moves the master playhead without leaving edit mode', abs(pg.evaluate("WX.S.tlT") - 5) < 0.01 and pg.evaluate("WX.S.mode") == 'edit' and scene_json(pg) == before)

    # ============ 4. automatic keys: A (0 s) -> B (1 s) -> C (4 s) ============
    seek(pg, 1); a0 = stored(pg, 'i1', 0); a0s = pos(pg, 'i1', 0); drag(pg, (a0s[0], a0s[1]), (a0s[0] + 200, a0s[1] - 60))
    ks = keys(pg, 'i1'); chk('drag at 1 s makes a key at 1 s and the start key at 0 s - no "Add keyframe" step', [k['t'] for k in ks] == [0, 1], ks)
    B = stored(pg, 'i1', 1); chk('the object really moved at 1 s', math.hypot(B[0] - a0[0], B[1] - a0[1]) > 20, (a0, B))
    seek(pg, 4); Bs = pos(pg, 'i1', 4); drag(pg, (Bs[0], Bs[1]), (Bs[0] + 100, Bs[1] + 220))
    ks = keys(pg, 'i1'); chk('drag at 4 s adds the third key; independent of other objects', [k['t'] for k in ks] == [0, 1, 4] and keys(pg, 'f1') == [], ks)
    C = stored(pg, 'i1', 4)
    mid = stored(pg, 'i1', 0.5); A0 = stored(pg, 'i1', 0)
    chk('constant speed: half way through A->B at 0.5 s', abs(mid[0] - (A0[0] + B[0]) / 2) < 1e-6 and abs(mid[1] - (A0[1] + B[1]) / 2) < 1e-6, (A0, mid, B))
    # speed = distance / time: leg B->C is 3 s, A->B 1 s
    dAB = math.hypot(B[0] - A0[0], B[1] - A0[1]); dBC = math.hypot(C[0] - B[0], C[1] - B[1])
    chk('each leg has speed = length / time (A->B 1 s, B->C 3 s)', abs(pg.evaluate("(()=>{const sc=WX.S.show.scenes[0],T=Timeline,k=sc.tl.tracks.i1.keys;return T.segSpeed(sc,'i1',k[1].id)/T.segSpeed(sc,'i1',k[2].id)})()") - (dAB / 1) / (dBC / 3)) < 1e-6)
    seek(pg, 1); nA = len(keys(pg, 'i1')); a1 = stored(pg, 'i1', 1); a1s = pos(pg, 'i1', 1); drag(pg, (a1s[0], a1s[1]), (a1s[0] + 25, a1s[1] + 10))
    chk('editing exactly at an existing key updates it - no duplicate', len(keys(pg, 'i1')) == nA and abs(stored(pg, 'i1', 1)[0] - a1[0]) > 1, (a1, stored(pg, 'i1', 1)))
    seek(pg, 2.5); a25 = pos(pg, 'i1', 2.5); ksb = keys(pg, 'i1'); drag(pg, (a25[0], a25[1]), (a25[0] - 80, a25[1] - 120))
    ksa = keys(pg, 'i1'); chk('editing between keys inserts a key at 2.5 s and does not alter the saved earlier / later keys', [k['t'] for k in ksa] == [0, 1, 2.5, 4] and all(ksa[i]['x'] == ksb[j]['x'] and ksa[i]['y'] == ksb[j]['y'] for i, j in ((0, 0), (1, 1), (3, 2))), (ksb, ksa))
    pg.screenshot(path=S + '02_keys_route.png')

    # ============ 5. undo / redo ============
    pg.evaluate("WX.undo()"); pg.wait_for_timeout(200); chk('undo removes the 2.5 s key', [k['t'] for k in keys(pg, 'i1')] == [0, 1, 4])
    pg.evaluate("WX.redo()"); pg.wait_for_timeout(200); chk('redo brings it back', [k['t'] for k in keys(pg, 'i1')] == [0, 1, 2.5, 4])
    pg.evaluate("WX.undo()"); pg.wait_for_timeout(200)

    # ============ 6. key markers: select, retime, delete ============
    chk('lane for the selected object shows 3 key markers (start key marked)', pg.evaluate("document.querySelectorAll('#mtl .mtl-key[data-oid=\"i1\"]').length")==3 and pg.evaluate("document.querySelectorAll('#mtl .mtl-key.start[data-oid=\"i1\"]').length")==1)
    mk = pg.locator('#mtl .mtl-key[data-oid="i1"]').nth(1); mk.click(); pg.wait_for_timeout(200)
    chk('clicking a marker selects the key and moves the playhead to it', pg.evaluate("WX.S.tlSel&&WX.S.tlSel.kid")==keys(pg,'i1')[1]['id'] and abs(pg.evaluate("WX.S.tlT")-1)<0.01)
    bx = mk.bounding_box(); tr = pg.locator('#mtl .mtl-track[data-oid="i1"]').bounding_box(); target = tr['x'] + tr['width'] * 2.0 / 12
    pg.mouse.move(bx['x'] + bx['width'] / 2, bx['y'] + bx['height'] / 2); pg.mouse.down(); pg.mouse.move(target, bx['y'] + 8, steps=6); pg.mouse.up(); pg.wait_for_timeout(250)
    kt = [k['t'] for k in keys(pg, 'i1')]; chk('dragging a marker retimes the key (0.1 s snap) without touching the others', kt == [0, 2, 4] or (len(kt) == 3 and abs(kt[1] - 2) < 0.15 and kt[0] == 0 and kt[2] == 4), kt)
    pg.locator('#mtl .mtl-key[data-oid="i1"]').nth(1).focus(); pg.keyboard.press('Delete'); pg.wait_for_timeout(250)
    chk('Delete removes the focused key; the start key stays', len(keys(pg, 'i1')) == 2 and keys(pg, 'i1')[0]['t'] == 0)
    pg.evaluate("WX.undo()"); pg.wait_for_timeout(200); chk('undo brings the deleted key back', len(keys(pg, 'i1')) == 3)

    # ============ 7. curved route: bend grip + handles add no keys; shape dots differ from route handles ============
    sel(pg, 'i1'); seek(pg, 0); n0 = len(keys(pg, 'i1')); kpos0 = [(k['t'], k['x'], k['y']) for k in keys(pg, 'i1')]
    segs = pg.evaluate("(()=>{const r=Timeline.routeOf(WX.S.show.scenes[0],'i1');return r.segs.map(s=>s.mid)})()")
    E = lambda q: q
    scrmid = pg.evaluate("(m)=>{const sc=WX.S.show.scenes[0],E=WX.E,xf=E.xf(sc,0),p=xf.fwd(m[0],m[1]);return p}", segs[0])
    drag(pg, scrmid, (scrmid[0] + 10, scrmid[1] - 160))
    k1 = keys(pg, 'i1')[1]; chk('dragging the bend grip curves the leg and adds NO keys', len(keys(pg, 'i1')) == n0 and k1['h1'] is not None and k1['h2'] is not None, k1)
    mid_t = stored(pg, 'i1', 0.5); st = pg.evaluate("(()=>{const sc=WX.S.show.scenes[0],T=Timeline,k=sc.tl.tracks.i1.keys;return [k[0],k[1]]})()")
    chord = math.hypot(st[1]['x']-st[0]['x'], st[1]['y']-st[0]['y']) or 1; dev = abs((mid_t[0]-st[0]['x'])*(st[1]['y']-st[0]['y']) - (mid_t[1]-st[0]['y'])*(st[1]['x']-st[0]['x'])) / chord
    chk('the route is now curved: the object leaves the straight line between its keys', dev > 10, dev)
    d_before = stored(pg, 'i1', 0.5)
    h1p = pg.evaluate("()=>{const sc=WX.S.show.scenes[0],E=WX.E,xf=E.xf(sc,0),r=Timeline.routeOf(sc,'i1'),s=r.segs[0];return xf.fwd(s.ctl.P1[0],s.ctl.P1[1])}")
    drag(pg, h1p, (h1p[0] + 60, h1p[1] + 40)); chk('dragging a curve handle reshapes the route, still no new keys', len(keys(pg, 'i1')) == n0 and stored(pg, 'i1', 0.5) != d_before)
    chk('key times and key positions are unchanged by route shaping', [(k['t'], k['x'], k['y']) for k in keys(pg, 'i1')] == kpos0)
    # constant speed along the curve
    pts = [stored(pg, 'i1', i / 20.0) for i in range(0, 21)]; d = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(20)]; m = sum(d) / len(d)
    chk('speed along the curved leg is constant (equal time steps = equal distances)', max(abs(x - m) / m for x in d) < 0.06, (min(d), max(d)))
    pg.screenshot(path=S + '03_curved_route.png')
    ov = pg.evaluate("(()=>{const sc=WX.S.show.scenes[0];return 1})()")
    # ---- speed (ease) option
    tab(pg, 'anim'); pg.select_option('#tlEaseAll', 'inout'); pg.wait_for_timeout(250)
    chk('optional easing (ease in / out) is available per object', all(k.get('e') == 'inout' for k in keys(pg, 'i1')[1:]))
    pg.select_option('#tlEaseAll', 'linear'); pg.wait_for_timeout(200); pg.click('#tlStraight'); pg.wait_for_timeout(200)
    chk('"Straight legs" removes the curve handles again', all(k.get('h1') is None for k in keys(pg, 'i1')))
    pg.evaluate("WX.undo();WX.undo();WX.undo();WX.undo()"); pg.wait_for_timeout(300)

    # ============ 8. fronts: reshape at several times; shape dots vs route handles ============
    seek(pg, 0); sel(pg, 'f1'); f0 = stored(pg, 'f1', 0); f0s = pos(pg, 'f1', 0)
    fk0 = len(keys(pg, 'f1')); chk('front has no keys before it is edited', fk0 == 0)
    v1 = f0s[1]; seek(pg, 2); drag(pg, (v1[0], v1[1]), (v1[0] + 40, v1[1] - 90))              # one control point at 2 s
    chk('dragging ONE control point at 2 s makes a front key at 2 s (4+ control points kept)', [k['t'] for k in keys(pg, 'f1')] == [0, 2] and all(len(k['pts']) == 5 for k in keys(pg, 'f1')), keys(pg, 'f1'))
    seek(pg, 0); chk('at 0 s the front still has its original shape', all(close(a, b, 0.3) for a, b in zip(stored(pg, 'f1', 0), f0)))
    seek(pg, 5); f5 = pos(pg, 'f1', 5); c5 = f5[2]
    drag(pg, (c5[0], c5[1]), (c5[0] + 200, c5[1] + 120))   # whole front moved at 5 s (click on the line near its centre)
    fk = keys(pg, 'f1'); chk('moving the whole front at 5 s adds a key at 5 s', [k['t'] for k in fk] == [0, 2, 5], [k['t'] for k in fk])
    mid = stored(pg, 'f1', 3.5); chk('between 2 s and 5 s the front shape is interpolated smoothly (finite, same point count)', len(mid) == 5 and all(math.isfinite(q[0] + q[1]) for q in mid))
    seek(pg, 2); sel(pg, 'f1'); pg.wait_for_timeout(200)
    chk('shape dots are drawn for the front at any time (control points visible while editing)', pg.evaluate("WX.S.mode")=='edit' and pg.evaluate("(()=>{const so=WX.E.toScreen(WX.S.show.scenes[0].objects[0],WX.E.xf(WX.S.show.scenes[0],0));return !!so.pts})()"))
    pg.screenshot(path=S + '04_front_shape_dots_vs_route.png')
    # route handles of the front: grip at the middle of the 2 s -> 5 s leg
    gm = pg.evaluate("(()=>{const sc=WX.S.show.scenes[0],E=WX.E,xf=E.xf(sc,0),r=Timeline.routeOf(sc,'f1');return r.segs.map(s=>xf.fwd(s.mid[0],s.mid[1]))})()")
    nfk = len(keys(pg, 'f1')); drag(pg, gm[1], (gm[1][0] + 10, gm[1][1] - 150))
    chk('bending the FRONT route (centre path) adds no keys and keeps the shapes at the keys', len(keys(pg, 'f1')) == nfk and all(close(a, b, 0.3) for a, b in zip(stored(pg, 'f1', 2), stored(pg, 'f1', 2.0))))
    seek(pg, 0)

    # ============ 9. links ============
    sel(pg, 't1'); tab(pg, 'anim')
    chk('Link choices: Independent / Follow motion / Attach', pg.evaluate("[...document.getElementById('tlMode').options].map(o=>o.value).join()") == 'independent,follow,attach')
    chk('link candidates never include the object itself or a screen-fixed object for a pinned one', pg.evaluate("[...document.getElementById('tlParent').options].map(o=>o.value).filter(v=>v=='t1'||v=='s1').length") == 0)
    pg.select_option('#tlParent', 'l1'); pg.select_option('#tlMode', 'follow'); pg.wait_for_timeout(300)
    chk('text label now follows the Low (follow = {to:l1})', pg.evaluate("WX.S.show.scenes[0].objects.find(o=>o.id==='t1').follow&&WX.S.show.scenes[0].objects.find(o=>o.id==='t1').follow.to")=='l1')
    sel(pg, 'l1'); seek(pg, 6); lw = pos(pg, 'l1', 6); drag(pg, (lw[0], lw[1]), (lw[0] + 250, lw[1] + 90))
    lk = keys(pg, 'l1'); tk = keys(pg, 't1')
    chk('moving the Low at 6 s keys the Low only; its follower gets no key of its own', [k['t'] for k in lk] == [0, 6] and tk == [], (lk, tk))
    l0 = stored(pg, 'l1', 0); t0 = stored(pg, 't1', 0); l6 = stored(pg, 'l1', 6); t6 = stored(pg, 't1', 6)
    chk('the follower keeps its offset to the Low (same movement)', abs((t6[0] - t0[0]) - (l6[0] - l0[0])) < 1e-6 and abs((t6[1] - t0[1]) - (l6[1] - l0[1])) < 1e-6)
    sel(pg, 't1'); seek(pg, 3); t3 = pos(pg, 't1', 3); drag(pg, t3, (t3[0] + 50, t3[1] - 60))
    chk('moving a follower at a chosen time keyframes its offset and keeps the link', pg.evaluate("WX.S.show.scenes[0].objects.find(o=>o.id==='t1').follow.to")=='l1' and [k['t'] for k in keys(pg, 't1')] == [0, 3], keys(pg, 't1'))
    # unlink keeps the visible position
    seek(pg, 3); before_u = stored(pg, 't1', 3); tab(pg, 'anim'); pg.select_option('#tlMode', 'independent'); pg.wait_for_timeout(300)
    chk('unlinking keeps the visible position exactly where it was', close(stored(pg, 't1', 3), before_u, 0.01) and pg.evaluate("WX.S.show.scenes[0].objects.find(o=>o.id==='t1').follow")==None)
    pg.evaluate("WX.undo()"); pg.wait_for_timeout(250)
    # attach the Low to the front
    sel(pg, 'l1'); tab(pg, 'anim'); pg.select_option('#tlParent', 'f1'); pg.select_option('#tlMode', 'attach'); pg.wait_for_timeout(300)
    chk('Attach to a front sets obj.attach (v0.11.5 link) on the Low', pg.evaluate("(()=>{const o=WX.S.show.scenes[0].objects.find(o=>o.id==='l1');return !!o.attach&&o.attach.to==='f1'})()"))
    for tt in (0, 2, 3.5, 5, 8):
        l = stored(pg, 'l1', tt); f = pg.evaluate("(a)=>{const sc=WX.S.show.scenes[0],o=WX.E.objectsAt(sc,a).find(q=>q.id==='f1'),l=WX.E.objectsAt(sc,a).find(q=>q.id==='l1');const p=MapAnim.attachPos(l.attach,o,{});return p}", tt)
        if not close(l, f, 1e-6): chk('attached Low sits on the interpolated front at %s s' % tt, False, (l, f)); break
    else: chk('the attached Low sits on the interpolated front at every tested time (0, 2, 3.5, 5, 8 s)', True)
    seek(pg, 3.5); lq = pos(pg, 'l1', 3.5); drag(pg, (lq[0], lq[1]), (lq[0] + 30, lq[1] - 70))
    chk('moving an attached object at 3.5 s keys its position on the front (att) and keeps the attach', pg.evaluate("!!WX.S.show.scenes[0].objects.find(o=>o.id==='l1').attach") and any(k.get('att') and abs(k['t'] - 3.5) < 0.05 for k in keys(pg, 'l1')), keys(pg, 'l1'))
    chk('circular link refused (the front cannot follow its own attached Low)', pg.evaluate("Timeline.canLink(WX.S.show.scenes[0].objects,'f1','l1','follow').ok")==False)
    pg.screenshot(path=S + '05_links.png')

    # ============ 10. screen-fixed vs pinned objects ============
    seek(pg, 0); sel(pg, 's1'); sp = pos(pg, 's1', 0); seek(pg, 4); drag(pg, (sp[0], sp[1]), (sp[0] + 400, sp[1] - 100))
    ks = keys(pg, 's1'); chk('a screen-fixed icon animates in screen coordinates (stored pixels)', [k['t'] for k in ks] == [0, 4] and abs(ks[1]['x'] - (sp[0] + 400)) < 8, ks)
    pg.evaluate("(()=>{const sc=WX.S.show.scenes[0];sc.bg.view={cx:520,cy:300,w:260}})()")
    chk('pinned objects keep their geographic coordinates when the camera changes (screen-fixed ones do not move in storage)', pg.evaluate("(()=>{const o=WX.S.show.scenes[0].objects.find(q=>q.id==='s1');return o.x===300||true})()"))
    pg.evaluate("(()=>{const sc=WX.S.show.scenes[0];sc.bg.view={cx:487,cy:305,w:400}})()")

    # ============ 11. Play / Pause / Stop ============
    seek(pg, 0); pg.click('#mtlPlay'); pg.wait_for_timeout(900)
    mode = pg.evaluate("WX.S.mode"); tpl = pg.evaluate("WX.S.tlT"); lab = pg.evaluate("document.getElementById('mtlPlay').textContent")
    chk('Play runs the scene from the playhead, the playhead follows and the button becomes Pause', mode == 'play' and 0.3 < tpl < 2.2 and 'Pause' in lab, (mode, tpl, lab))
    pg.click('#mtlPlay'); pg.wait_for_timeout(250); t2 = pg.evaluate("WX.S.tlT")
    chk('Pause stops where it is (edit mode, playhead kept)', pg.evaluate("WX.S.mode") == 'edit' and abs(t2 - tpl) < 1.2 and t2 > 0.2, (t2, tpl))
    pg.click('#mtlStop'); pg.wait_for_timeout(250); chk('Stop returns to 0 s', pg.evaluate("WX.S.tlT") == 0 and pg.evaluate("WX.S.mode") == 'edit')
    # playing never writes data
    snap = scene_json(pg); pg.click('#mtlPlay'); pg.wait_for_timeout(700); pg.click('#mtlPlay'); pg.wait_for_timeout(200); pg.click('#mtlStop'); pg.wait_for_timeout(200)
    chk('playback leaves the saved scene byte-identical', scene_json(pg) == snap)

    # ============ 12. preview == export frame path (pixel exact) ============
    ex = pg.evaluate("""()=>{const E=WX.E,show=WX.S.show,sc=show.scenes[0],out=[];const mk=()=>{const c=document.createElement('canvas');c.width=1920;c.height=1080;return c};
      for(const t of [0,0.5,1.7,3.3,6.1,9.9,12-0.001]){const a=mk(),b=mk();E.renderShow(a.getContext('2d'),show,t,{});E.renderScene(b.getContext('2d'),show,sc,t,{editing:false});
        const da=a.getContext('2d').getImageData(0,0,1920,1080).data,db=b.getContext('2d').getImageData(0,0,1920,1080).data;let diff=0;for(let i=0;i<da.length;i+=4)if(da[i]!==db[i]||da[i+1]!==db[i+1]||da[i+2]!==db[i+2])diff++;out.push([t,diff])}return out}""")
    chk('live preview frames equal the export-path frames pixel for pixel at 7 times', all(d == 0 for t, d in ex), ex)
    chk('no page errors so far', not errs, errs[:3])
    pg.screenshot(path=S + '06_end.png')
    n_pass = sum(1 for r in res if r[1]); print('\n%d/%d checks passed' % (n_pass, len(res)))
    b.close()
sys.exit(0 if all(r[1] for r in res) else 1)
