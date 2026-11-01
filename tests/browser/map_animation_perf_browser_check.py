"""Performance check (headless Chromium, software rendering – far slower than a real GPU browser) of animated map scenes with many graphics (v0.11.0):
12 fronts, 40 icons, 20 text labels, 12 steps. Compares the cost of a frame in the middle of a move (interpolation + drawing) with a frame in a hold.
Only RELATIVE costs are asserted (headless software canvas is ~20x slower than a GPU browser: the engine's own drawing of 72 shadowed objects dominates both kinds of frame); the absolute numbers are printed for the record.
Usage: python3 wxbuild.py && python3 tests/browser/map_animation_perf_browser_check.py"""
from playwright.sync_api import sync_playwright
import sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
res = []
def chk(name, ok, info=''):
    res.append((name, bool(ok), info)); print(('PASS ' if ok else 'FAIL ') + name, str(info))
JS = r"""()=>{
  const WX=window.WX,E=WX.E,sc=E.newScene({name:'perf',duration:6,bg:{type:'solid',color:'#12304f'},title:{show:false,text:'',sub:''},objects:[]});
  const mk=(o)=>{o.anim={in:'none',delay:0,dur:0.01};return o};
  for(let i=0;i<12;i++)sc.objects.push(mk(E.newObject('front',{id:'f'+i,kind:['cold','warm','stationary','occluded'][i%4],size:26,pts:[[100+i*20,100+i*60],[500,150+i*55],[900,120+i*60],[1300,160+i*50],[1700,140+i*55]]})));
  for(let i=0;i<40;i++)sc.objects.push(mk(E.newObject('icon',{id:'i'+i,x:100+(i%10)*180,y:500+Math.floor(i/10)*120,size:90,icon:['sunny','rain','cloudy','snow'][i%4]})));
  for(let i=0;i<20;i++)sc.objects.push(mk(E.newObject('text',{id:'t'+i,x:100+(i%5)*360,y:40+Math.floor(i/5)*20,text:'T'+i,size:40})));
  WX.loadShow({name:'perf',accent:'#2f9bff',scenes:[sc],assets:{},mbMigrated:1}); const s=WX.S.show.scenes[0];
  MapAnim.enable(s); MapAnim.setStep(s,0,{hold:1});
  for(let k=1;k<12;k++){MapAnim.addStep(s,k-1,{hold:1,dur:2,simplify:false,ease:'linear'});s.anim.steps[k].objects.forEach((o,j)=>{if(o.pts)o.pts=o.pts.map((p,n)=>[p[0]+30*Math.sin(k+j+n),p[1]+25*Math.cos(k+j)]).slice(0,k%3?5:4);else{o.x+=40*Math.sin(k+j);o.y+=30*Math.cos(k+j)}if(o.type==='text'&&k%2)o.text='T'+j+'x'})}
  MapAnim.normalize(s);
  const cv=document.createElement('canvas');cv.width=1920;cv.height=1080;const c=cv.getContext('2d');
  const bench=(ts)=>{const t0=performance.now();for(const t of ts)E.renderScene(c,WX.S.show,s,t,{editing:false});return (performance.now()-t0)/ts.length};
  const hold=[],move=[];for(let k=0;k<11;k++){hold.push(1+k*3+0.5+0.5*0);move.push(1+k*3+1+1)}   // inside a hold / middle of the next move
  bench(hold.slice(0,3));bench(move.slice(0,3));
  const h=bench(hold.concat(hold)),m=bench(move.concat(move));
  const t0=performance.now();for(let i=0;i<200;i++)MapAnim.objectsAt(s,1+((i*0.137)%30));const interp=(performance.now()-t0)/200;
  return {hold:h,move:m,interp,steps:s.anim.steps.length,objects:s.objects.length,bytes:MapAnim.sizeBytes(s),dur:s.duration};}"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    pg = b.new_context(viewport={'width': 1500, 'height': 900}).new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(2000)
    pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    r = pg.evaluate(JS)
    print('72 objects, %d steps, %.1f s, animation data %.0f KB: frame in hold %.1f ms, frame mid-move %.1f ms, objectsAt alone %.2f ms' % (r['steps'], r['dur'], r['bytes'] / 1024, r['hold'], r['move'], r['interp']))
    chk('interpolation alone (72 objects) is cheap', r['interp'] < 4, r['interp'])
    chk('a frame in the middle of a move costs at most ~1.6x a frame in a hold + 8 ms (interpolated objects are redrawn from scratch)', r['move'] < r['hold'] * 1.6 + 8, (r['hold'], r['move']))
    chk('12 steps of 72 objects are about a few hundred KB, below the 1 MiB warning', r['bytes'] < 1048576, r['bytes'])
    chk('no page errors', not errs, errs)
    b.close()
bad = [r for r in res if not r[1]]
print('\n%d checks, %d failed' % (len(res), len(bad))); sys.exit(1 if bad else 0)
