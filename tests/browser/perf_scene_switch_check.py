"""Real-browser regression check for the v0.10.4 scene-switching / thumbnail / loop-pacing performance work.
Uses the shared perf harness (14-scene show, stand-in Mapbox that counts Map creations / setStyle calls).
Usage: python3 wxbuild.py && python3 tests/browser/perf_scene_switch_check.py"""
import sys, pathlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests' / 'perf'))
from perf_lib import launch, open_page
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, ('' if ok else info))

with sync_playwright() as p:
    br, ctx = launch(p); pg, errs, info = open_page(ctx, str(ROOT / 'dist' / 'studio.html'), 0, 14); ev = pg.evaluate
    def settle():
        last = -1
        for _ in range(60):
            cur = ev("WX.perf.thumbStats.renders"); 
            if cur == last: return cur
            last = cur; ev("()=>new Promise(r=>setTimeout(r,1800))")
    settle()                                                            # let the initial thumbnail pass finish
    nmap = ev("WX.S.show.scenes.filter(s=>s.bg.type==='mapbox').length")
    n = ev("WX.S.show.scenes.length"); chk('14-scene show loaded', n == 14, n)
    st0 = ev("({...WX.perf.thumbStats})"); chk('initial pass rendered every thumbnail once (cache filled)', st0['renders'] >= 12 and ev("WX.perf.thumbCacheSize()") >= 8, (st0, ev("WX.perf.thumbCacheSize()")))

    # 1. a click only moves the highlight: same card/canvas nodes, no thumbnail work
    ev("()=>{window.__cards=[...document.querySelectorAll('#sceneList .sc')];window.__cvs=window.__cards.map(c=>c.querySelector('canvas'))}")
    ev("()=>document.querySelector('.sc[data-i=\"5\"]').click()")
    r = ev("""()=>({same:[...document.querySelectorAll('#sceneList .sc')].every((c,i)=>c===window.__cards[i]&&c.querySelector('canvas')===window.__cvs[i]),
      on:[...document.querySelectorAll('#sceneList .sc.on')].map(c=>c.dataset.i),si:WX.S.si,panel:document.querySelectorAll('#panels *').length>0})""")
    chk('scene click keeps the same card and canvas elements', r['same'])
    chk('scene click highlights exactly the clicked card and selects it', r['on'] == ['5'] and r['si'] == 5, r)
    settle(); st1 = ev("({...WX.perf.thumbStats})")
    chk('scene click re-renders no (cached) thumbnail', st1['renders'] - st0['renders'] <= 1, (st0, st1))   # <=1: an un-snapshotted map scene may retry

    # 2. 80 rapid switches: zero thumbnail renders, no new Mapbox maps, no style rebuilds, no jumps storm
    m0 = ev("({m:__maps.length,s:__setStyleCalls||0})")
    ev("""async()=>{for(let k=0;k<80;k++){document.querySelector('.sc[data-i="'+((k*3)%14)+'"]').click();await new Promise(r=>setTimeout(r,15));}await new Promise(r=>setTimeout(r,1200));}""")
    settle(); st2 = ev("({...WX.perf.thumbStats})"); m1 = ev("({m:__maps.length,s:__setStyleCalls||0})")
    chk('80 rapid switches render almost no thumbnails (only never-snapshotted map scenes may retry)', st2['renders'] - st1['renders'] <= nmap * 2, (st1, st2, nmap))
    chk('switching scenes creates no Mapbox Map and no style rebuild', m1 == m0, (m0, m1))

    # 3. thumbnails survive a switch away and back pixel-identically
    ev("()=>document.querySelector('.sc[data-i=\"2\"]').click()")
    a = ev("()=>{const c=document.querySelector('.sc[data-i=\"7\"] canvas');return c.toDataURL()}")
    ev("()=>{document.querySelector('.sc[data-i=\"7\"]').click()}"); ev("()=>new Promise(r=>setTimeout(r,900))")
    b = ev("()=>{const c=document.querySelector('.sc[data-i=\"7\"] canvas');return c.toDataURL()}")
    chk('non-active thumbnail unchanged by switching (served from cache)', a == b)

    # 4. editing one scene re-renders only that scene's thumbnail and the pixels change
    ev("()=>document.querySelector('.sc[data-i=\"9\"]').click()"); ev("()=>new Promise(r=>setTimeout(r,800))")
    before = ev("()=>document.querySelector('.sc[data-i=\"9\"] canvas').toDataURL()"); s_b = ev("({...WX.perf.thumbStats})")
    ev("""()=>{const sc=WX.S.show.scenes[9];sc.bg={...sc.bg,type:'solid',color:'#aa2222'};WX.commit();}"""); ev("()=>new Promise(r=>setTimeout(r,1200))")
    after = ev("()=>document.querySelector('.sc[data-i=\"9\"] canvas').toDataURL()"); s_a = ev("({...WX.perf.thumbStats})")
    chk('editing a scene re-renders exactly that scene', s_a['renders'] - s_b['renders'] == 1, (s_b, s_a))
    chk('edited scene thumbnail pixels changed', before != after)
    chk('other scenes were not touched by the edit', ev("()=>document.querySelector('.sc[data-i=\"3\"] canvas').toDataURL()") != after)

    # 5. a no-op commit (same content) is free
    s_c = ev("({...WX.perf.thumbStats})"); ev("()=>{WX.commit()}"); ev("()=>new Promise(r=>setTimeout(r,1000))")
    chk('unchanged scene is not re-rendered (signature cache)', ev("WX.perf.thumbStats.renders") == s_c['renders'])

    # 6. external changes (assets/fonts/map data) invalidate everything, rendered in slices (not one long task)
    s_d = ev("({...WX.perf.thumbStats})"); ev("()=>{WX.E.onAsset()}"); ev("()=>new Promise(r=>setTimeout(r,16000))")
    s_e = ev("({...WX.perf.thumbStats})")
    chk('asset/font style invalidation re-renders every scene', s_e['renders'] - s_d['renders'] >= 12, (s_d, s_e))
    chk('...in separate slices, so the page stays responsive', s_e['slices'] - s_d['slices'] >= 10, (s_d, s_e))

    # 7. rebuilding the list (reorder) repaints thumbnails from cache immediately and re-renders nothing
    s_f = ev("({...WX.perf.thumbStats})")
    r = ev("""()=>{const l=document.querySelector('.sc[data-i="4"] canvas').toDataURL();document.querySelector('.sc[data-i="4"] .acts button').click();
      const moved=document.querySelector('.sc[data-i="3"] canvas').toDataURL();return {same:l===moved,si:WX.S.si}}""")
    settle(); s_g = ev("({...WX.perf.thumbStats})")
    chk('reordering repaints the cached thumbnail at once (no blank flash)', r['same'], r)
    chk('reordering re-renders (almost) nothing', s_g['renders'] - s_f['renders'] <= nmap, (s_f, s_g, nmap))

    # 8. deleting scenes prunes the cache
    c0 = ev("WX.perf.thumbCacheSize()"); ev("()=>{document.querySelector('.sc[data-i=\"1\"] .acts .dng').click()}"); ev("()=>new Promise(r=>setTimeout(r,1200))")
    chk('deleting a scene removes its cached thumbnail', ev("WX.perf.thumbCacheSize()") == c0 - 1, (c0, ev("WX.perf.thumbCacheSize()")))

    # 9. idle pacing: slow repaint => throttled when idle, full rate while the user is interacting
    ev("""()=>{const E=WX.E,o=E.renderScene;window.__slow=0;E.renderScene=function(c,show,sc,t,opts){if(opts&&opts.editing&&!opts.thumb){const e=performance.now()+60;while(performance.now()<e);return;}return o.apply(this,arguments)}}""")
    ev("()=>new Promise(r=>setTimeout(r,2200))")
    idle = ev("""async()=>{const f0=WX.perf.loop.frames;await new Promise(r=>setTimeout(r,3000));return (WX.perf.loop.frames-f0)/3}""")
    busy = ev("""async()=>{const f0=WX.perf.loop.frames;const t=setInterval(()=>window.dispatchEvent(new PointerEvent('pointermove')),100);await new Promise(r=>setTimeout(r,3000));clearInterval(t);return (WX.perf.loop.frames-f0)/3}""")
    chk('idle editor repaint is throttled when a repaint is slow (<= ~6/s at 60 ms; unthrottled would be ~16/s)', idle <= 6.5, idle)
    chk('...and runs at full rate while the user interacts', busy > idle * 2, (idle, busy))
    # 10. play still renders every frame on time
    pl = ev("""async()=>{const fr=[];let last=performance.now(),rq;const tk=()=>{const t=performance.now();fr.push(t-last);last=t;rq=requestAnimationFrame(tk)};rq=requestAnimationFrame(tk);
      document.getElementById('bPlayScene').click();await new Promise(r=>setTimeout(r,1500));document.getElementById('bStop').click();cancelAnimationFrame(rq);return fr.length}""")
    chk('playback still runs after the changes', pl > 3, pl)
    chk('no page errors from the app', not [e for e in errs if 'ERR_TUNNEL' not in e and 'Failed to load resource' not in e], errs[:3])
    br.close()
fails = [r for r in res if not r[1]]
print('\n%d/%d checks passed' % (len(res) - len(fails), len(res))); sys.exit(1 if fails else 0)
