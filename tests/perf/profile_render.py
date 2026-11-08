"""CPU-profile renderScene for a scene (self-time by function). python3 tests/perf/profile_render.py [--html f] [--scene 0] [--n 40]"""
import argparse, sys, pathlib, collections
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from perf_lib import *
ap = argparse.ArgumentParser(); ap.add_argument('--html', default=str(ROOT/'dist'/'studio.html')); ap.add_argument('--scene', type=int, default=0); ap.add_argument('--n', type=int, default=40); ap.add_argument('--top', type=int, default=25)
a = ap.parse_args()
with sync_playwright() as p:
    br, ctx = launch(p); pg, errs, info = open_page(ctx, a.html, 0, 14)
    pg.evaluate("i=>document.querySelector('.sc[data-i=\"'+i+'\"]').click()", a.scene); pg.wait_for_timeout(3500)
    cdp = ctx.new_cdp_session(pg); cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 200}); cdp.send('Profiler.start')
    pg.evaluate("""async(n)=>{const E=WX.E,show=WX.S.show,sc=show.scenes[%d],cv=document.createElement('canvas');cv.width=1920;cv.height=1080;const c=cv.getContext('2d');
      for(let i=0;i<n;i++)E.renderScene(c,show,sc,1+i*.04,{editing:false});}""" % a.scene, a.n)
    prof = cdp.send('Profiler.stop')['profile']
    nodes = {n['id']: n for n in prof['nodes']}; selfus = collections.Counter(); dt = prof['timeDeltas']
    for sid, d in zip(prof['samples'], dt): selfus[sid] += d
    agg = collections.Counter()
    for sid, us in selfus.items():
        cf = nodes[sid]['callFrame']; agg['%s %s:%d' % (cf['functionName'] or '(anon)', cf['url'].split('/')[-1][:20] or 'inline', cf['lineNumber'] + 1)] += us
    tot = sum(agg.values())
    for k, v in agg.most_common(a.top): print('%6.1f ms/frame %5.1f%%  %s' % (v / 1000 / a.n, 100 * v / tot, k))
    br.close()
