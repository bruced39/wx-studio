"""v0.11.6: builds the 12-second master-timeline DEMONSTRATION show with the real editor engine (TL.beginEdit/flush - the same path a drag at the playhead takes),
saves it as docs/demo/master_timeline_demo.wxshow.json, renders stills, and (if the browser can encode H.264) a test MP4.
The sandbox has no map tiles, so stills / MP4 use a stylised stand-in background (WDMap.draw is replaced ONLY in this script; the saved show is untouched).
Usage: python3 wxbuild.py && python3 tests/browser/build_timeline_demo.py [out_dir]"""
from playwright.sync_api import sync_playwright
import pathlib, sys, os, base64, json, time
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'docs' / 'demo'); OUT.mkdir(parents=True, exist_ok=True)
HTML = (ROOT / 'dist' / 'studio.html').as_uri()
BUILD = r"""()=>{
  const E=WX.E,TL=Timeline,MA=MapAnim;
  const bg={type:'map',theme:'dark',view:{cx:487,cy:305,w:400},cities:false,counties:false};
  const mk=(t,p)=>{const o=E.newObject(t,p);o.anim={in:'none',delay:0,dur:0.01};return o};
  const front=mk('front',{id:'front',geo:true,kind:'cold',pts:[[350,210],[365,250],[368,290],[355,330],[345,375]]});
  const low=mk('hl',{id:'low',geo:true,x:372,y:262,kind:'L',value:'1004',size:110});
  const label=mk('text',{id:'label',geo:true,x:410,y:236,text:'DEEPENING LOW',size:40,box:true,boxColor:'rgba(8,20,38,0.75)',color:'#ffffff'});
  const head=mk('text',{id:'head',x:640,y:80,text:'COLD FRONT SWEEPS EAST',size:64,color:'#ffffff'});
  const rain=mk('icon',{id:'rain',geo:true,x:330,y:350,icon:'rain',size:120});
  const sun=mk('icon',{id:'sun',geo:true,x:640,y:215,icon:'sunny',size:110});
  const sc=E.newScene({id:'demo',name:'12 s master timeline demo',duration:12,bg,title:{show:false,text:'',sub:''},transition:{type:'cut',dur:0},objects:[front,low,label,rain,sun,head]});
  WX.loadShow({name:'Master timeline demo (v0.11.6)',accent:'#2f9bff',scenes:[sc],assets:{},mbMigrated:1});
  const s=WX.S.show.scenes[0]; TL.enable(s,{duration:12});
  const edit=(T,fn)=>{const ed=TL.beginEdit(s,T);fn(ed.objs);return TL.flush(s,ed)};
  /* links first (at 0 s): the Low rides the front, the label follows the Low */
  TL.link(s,'low','attach','front',0); TL.link(s,'label','follow','low',0);
  /* the front: five key shapes (a sixth control point is added at 9 s) */
  const F={3:[[410,205],[438,250],[444,296],[422,336],[404,381]],6:[[468,196],[506,242],[518,296],[492,342],[470,388]],9:[[520,190],[560,226],[586,264],[592,302],[566,342],[536,386]],12:[[556,196],[598,232],[626,272],[628,312],[602,352],[568,392]]};
  Object.keys(F).forEach(t=>edit(+t,o=>{o.find(q=>q.id==='front').pts=F[t].map(p=>[p[0],p[1]])}));
  TL.setPathAll(s,'front','curve'); TL.setEaseAll(s,'front','linear');
  /* the Low also slides along the front at its own times (keys on the front offset) */
  edit(4.5,o=>{const l=o.find(q=>q.id==='low'),f=o.find(q=>q.id==='front');l.x+=8;l.y-=26});
  edit(10,o=>{const l=o.find(q=>q.id==='low');l.x+=10;l.y+=40});
  /* an independent rain icon with a curved path and its own timing */
  edit(2.5,o=>{const r=o.find(q=>q.id==='rain');r.x=400;r.y=345}); edit(6,o=>{const r=o.find(q=>q.id==='rain');r.x=470;r.y=300}); edit(11,o=>{const r=o.find(q=>q.id==='rain');r.x=600;r.y=300});
  const rk=s.tl.tracks.rain.keys; TL.setHandles(s,'rain',rk[1].id,[0,-70],[-20,60]); TL.setPath(s,'rain',rk[2].id,'curve'); TL.setPath(s,'rain',rk[3].id,'curve');
  /* the label gets its own offset key at 7 s (moves above the Low) */
  edit(7,o=>{const t=o.find(q=>q.id==='label');t.y+=22;t.x+=6});
  /* the sun fades in from 4 s (appears) */
  s.tl.tracks.sun={keys:[],vis:{a:4}}; TL.normalize(s);
  WX.S.oid='front'; WX.commit(); WX.setTab('anim'); return JSON.parse(JSON.stringify(s));}"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox']); ctx = b.new_context(viewport={'width': 1700, 'height': 980}); pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.goto(HTML); pg.wait_for_timeout(1800); pg.evaluate("document.getElementById('modalBg')&&document.getElementById('modalBg').remove()")
    # stand-in background (sandbox has no map data)
    pg.evaluate(r"""()=>{WDMap.status='ready';WDMap.draw=(c,v,theme,o)=>{const W=o.W,H=o.H;const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,'#14304f');g.addColorStop(1,'#0b1c33');c.fillStyle=g;c.fillRect(0,0,W,H);
      const k=W/v.w,X=x=>W/2+(x-v.cx)*k,Y=y=>H/2+(y-v.cy)*k;c.fillStyle='#24405e';c.beginPath();const land=[[250,150],[620,150],[700,190],[700,330],[640,372],[600,380],[610,340],[560,330],[500,380],[470,420],[420,430],[360,420],[300,430],[250,440]];land.forEach((q,i)=>i?c.lineTo(X(q[0]),Y(q[1])):c.moveTo(X(q[0]),Y(q[1])));c.closePath();c.fill();
      c.strokeStyle='rgba(255,255,255,.07)';c.lineWidth=1;for(let i=0;i<20;i++){c.beginPath();c.moveTo(0,i*H/20);c.lineTo(W,i*H/20);c.stroke();c.beginPath();c.moveTo(i*W/20,0);c.lineTo(i*W/20,H);c.stroke()}}}""")
    scene = pg.evaluate(BUILD); pg.wait_for_timeout(500)
    tr = scene['tl']['tracks']
    print('tracks:', {k: [round(x['t'], 2) for x in v['keys']] for k, v in tr.items()})
    (OUT / 'master_timeline_demo.wxshow.json').write_text(pg.evaluate("(()=>{const sh=JSON.parse(JSON.stringify(WX.S.show));return JSON.stringify(Object.assign({format:'wx-studio-show',formatVersion:2,savedWith:'0.11.6'},sh),null,1)})()"))
    print('wrote show JSON', (OUT / 'master_timeline_demo.wxshow.json').stat().st_size, 'bytes')
    # editor screenshots (timeline bar, route handles, shape dots)
    for T, nm in ((3, 'editor_t3_front_reshape'), (7.5, 'editor_t7p5')):
        pg.evaluate("(t)=>{const i=document.getElementById('mtlTime');i.value=t;i.dispatchEvent(new Event('change'))}", T); pg.wait_for_timeout(500); pg.screenshot(path=str(OUT / (nm + '.png')))
    pg.evaluate("WX.S.oid='rain'"); pg.evaluate("(t)=>{const i=document.getElementById('mtlTime');i.value=t;i.dispatchEvent(new Event('change'))}", 4); pg.wait_for_timeout(500); pg.click('#mtlTracks' if False else 'button:has-text("Tracks")'); pg.wait_for_timeout(300); pg.screenshot(path=str(OUT / 'editor_rain_route_tracks.png'))
    # stills at 0,3,6,9,12 through the same path the exporter uses
    for T in (0, 3, 6, 9, 11.99):
        png = pg.evaluate("""(t)=>{const cv=document.createElement('canvas');cv.width=1920;cv.height=1080;WX.E.renderScene(cv.getContext('2d'),WX.S.show,WX.S.show.scenes[0],t,{editing:false});return cv.toDataURL('image/png')}""", T)
        (OUT / ('still_t%05.2f.png' % T)).write_bytes(base64.b64decode(png.split(',')[1]))
    # test MP4 (this Chromium can encode H.264; a real Chrome / Edge / Firefox check is still the owner's)
    info = pg.evaluate("""async()=>{try{const t0=performance.now();const r=await Exporter.run(WX.S.show,{fps:30,width:1280,height:720,bitrate:4e6,sceneIndexes:null});const ab=await r.blob.arrayBuffer();const u8=new Uint8Array(ab);let s='';const CH=0x8000;for(let i=0;i<u8.length;i+=CH)s+=String.fromCharCode.apply(null,u8.subarray(i,i+CH));
       return {ok:true,b64:btoa(s),frames:r.frames,seconds:r.seconds,codec:r.codec,ms:performance.now()-t0}}catch(e){return {ok:false,err:String(e&&e.message||e),code:e&&e.code}}}""")
    if info.get('ok'):
        (OUT / 'master_timeline_demo_test.mp4').write_bytes(base64.b64decode(info['b64'])); print('mp4', info['frames'], 'frames', info['seconds'], 's', info['codec'], round(info['ms']), 'ms')
    else: print('MP4 not produced:', info)
    print('errors', errs); b.close()
