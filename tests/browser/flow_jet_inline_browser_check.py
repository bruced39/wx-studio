"""Real-browser check (v0.10.1.3): flow arrows + jet stream draw tools and rendering (both looks, animated), template text defaults (Standard font,
same size on every bar, number boxes), and double-click editing of text on the stage (Enter = new line, Esc finishes, Backspace never deletes the object).
Usage: python3 wxbuild.py && python3 tests/browser/flow_jet_inline_browser_check.py   (needs playwright + Chromium)"""
from playwright.sync_api import sync_playwright
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
res = []
def chk(n, ok, info=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n, '' if ok else info)
PIX = """([x0,y0,w,h])=>{const cv=[...document.querySelectorAll('canvas')].find(c=>c.width===1920&&c.height===1080);const d=cv.getContext('2d').getImageData(x0,y0,w,h).data;let n=0;const b=[0x12,0x40,0x8a];
  for(let i=0;i<d.length;i+=4){if(Math.abs(d[i]-b[0])+Math.abs(d[i+1]-b[1])+Math.abs(d[i+2]-b[2])>60)n++}return n}"""
with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox']); pg = br.new_page(viewport={'width': 1700, 'height': 960}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(2500); ev = pg.evaluate
    ev("document.getElementById('modalBg').style.display='none'")
    tools = ev("[...document.querySelectorAll('#tools button[data-tool]')].map(b=>b.dataset.tool)")
    chk('Flow arrows and Jet stream tools exist next to Arrow', 'flow' in tools and 'jet' in tools and 'arrow' in tools, tools)
    # draw both with the real tool: click points, double-click to finish
    ev("(()=>{const sc=WX.S.show.scenes[0];sc.bg={type:'solid',color:'#12408a',kenburns:false};sc.objects=[];sc.title={show:false,text:'',sub:''};WX.commit();})()"); pg.wait_for_timeout(500)
    def pos(x, y):
        r = ev("(()=>{const r=document.getElementById('overlay').getBoundingClientRect();return [r.left,r.top,r.width]})()"); k = r[2] / 1920; return r[0] + x * k, r[1] + y * k
    for tool, pts in (('flow', [(1500, 300), (1100, 260), (700, 380)]), ('jet', [(200, 700), (700, 600), (1200, 760)])):
        pg.click('#tools button[data-tool=%s]' % tool)
        for (x, y) in pts: pg.mouse.click(*pos(x, y)); pg.wait_for_timeout(60)
        pg.mouse.dblclick(*pos(*pts[-1])); pg.wait_for_timeout(300)
    types = ev("WX.S.show.scenes[0].objects.map(o=>o.type)")
    chk('drawing created a flow object and a jet object', 'flow' in types and 'jet' in types, types)
    pg.click('#tools button[data-tool=select]'); pg.wait_for_timeout(800)
    a = ev(PIX, [600, 200, 1000, 260]); b = ev(PIX, [150, 520, 1150, 340])
    chk('flow arrows are drawn', a > 800, a); chk('jet stream is drawn', b > 3000, b)
    # animated: pixels change between two times (flow + jet both)
    def snap(t):
        return ev("""(t)=>{const E=WX.E,c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d');E.renderScene(x,WX.S.show,WX.S.show.scenes[0],t,{editing:false});return [...x.getImageData(0,0,1920,1080).data].filter((v,i)=>i%97===0).join(',')}""", t)
    chk('flow and jet animate over time', snap(1.0) != snap(1.4))
    # look switches
    for look in (('flow', 'plain'), ('flow', 'glossy'), ('jet', 'ribbon'), ('jet', 'banded')):
        ev("([t,l])=>{WX.S.show.scenes[0].objects.find(o=>o.type===t).style=l;WX.commit();}", list(look)); pg.wait_for_timeout(250)
    chk('both looks render without errors', not errs, errs)
    # colour / size controls in the panel
    ev("WX.S.oid=WX.S.show.scenes[0].objects.find(o=>o.type==='flow').id"); pg.click('#tabs button[data-t=object]'); pg.wait_for_timeout(400)
    txt = pg.inner_text('#panels'); chk('flow panel offers look, color, size, spacing, speed', all(w in txt for w in ['Look', 'Arrow size', 'Spacing', 'Speed']), txt[:200])
    ev("WX.S.oid=WX.S.show.scenes[0].objects.find(o=>o.type==='jet').id"); pg.click('#tabs button[data-t=scene]'); pg.click('#tabs button[data-t=object]'); pg.wait_for_timeout(400)
    txt = pg.inner_text('#panels'); chk('jet panel offers look, band color, arrow color, width, speed', all(w in txt for w in ['Look', 'Band color', 'Arrow color', 'Band width', 'Speed']), txt[:200])
    # templates: Standard font, same size, number boxes
    pg.click('#bTpl'); pg.wait_for_timeout(300); pg.locator('#modalBg select').first.select_option('hl-night'); pg.click('text=Create scene'); pg.wait_for_timeout(1500)
    objs = ev("WX.S.show.scenes[WX.S.si].objects.map(o=>({s:o.size,f:o.font}))"); t2 = ev("WX.S.show.scenes[WX.S.si].title2")
    chk('template bar text defaults to Standard', all(o['f'] == 'sans' for o in objs), objs); chk('banner title defaults to Standard (Barlow)', t2['font'] == 'Barlow', t2['font'])
    chk('every bar starts at the same size', len({o['s'] for o in objs}) == 1 and objs[0]['s'] > 0, objs)
    ev("WX.S.oid=WX.S.show.scenes[WX.S.si].objects[0].id"); pg.click('#tabs button[data-t=scene]'); pg.click('#tabs button[data-t=object]'); pg.wait_for_timeout(300)
    chk('text size is a number box', pg.locator('#panels input[type=number]').count() >= 1)
    # typed size in the dialog applies to all bars
    pg.click('#bTpl'); pg.wait_for_timeout(300); pg.locator('#modalBg select').first.select_option('storm-day'); pg.locator('#modalBg input[type=number]').nth(1).fill('36'); pg.click('text=Create scene'); pg.wait_for_timeout(1200)
    chk('a size typed in the template dialog is used on all bars', ev("WX.S.show.scenes[WX.S.si].objects.every(o=>o.size===36)"), ev("WX.S.show.scenes[WX.S.si].objects.map(o=>o.size)"))
    # double-click editing
    pg.click('#tools button[data-tool=select]'); o0 = ev("(()=>{const o=WX.S.show.scenes[WX.S.si].objects[1];return [o.x,o.y]})()"); x, y = pos(*o0)
    pg.mouse.dblclick(x, y); pg.wait_for_timeout(300); chk('double-click on bar text opens an in-place editor', pg.locator('textarea.wxInline').count() == 1)
    pg.keyboard.press('Control+A'); pg.keyboard.type('rain then wind'); pg.keyboard.press('Enter'); pg.keyboard.type('gusts 50'); pg.wait_for_timeout(200)
    chk('Enter makes a second line and caps are kept', ev("WX.S.show.scenes[WX.S.si].objects[1].text") == 'RAIN THEN WIND\nGUSTS 50', ev("WX.S.show.scenes[WX.S.si].objects[1].text"))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200); chk('Esc closes the editor', pg.locator('textarea.wxInline').count() == 0)
    pg.mouse.dblclick(x, y); pg.wait_for_timeout(250); dbg = ev("document.activeElement.tagName+':'+document.activeElement.className+'|'+(document.querySelectorAll('textarea.wxInline').length)+'|'+WX.S.oid"); pg.keyboard.press('Backspace'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    chk('Backspace in the editor edits text, never deletes the object', ev("WX.S.show.scenes[WX.S.si].objects.length") == 4 and ev("WX.S.show.scenes[WX.S.si].objects[1].text") == 'RAIN THEN WIND\nGUSTS 5', (dbg, ev("WX.S.show.scenes[WX.S.si].objects.length"), ev("WX.S.show.scenes[WX.S.si].objects[1].text")))
    R = ev("WX.S.show.scenes[WX.S.si].title2.region"); pg.mouse.dblclick(*pos((R['l'] + R['r']) / 2, R['cy'])); pg.wait_for_timeout(250)
    chk('double-click on the banner title opens its editor', pg.locator('textarea.wxInline').count() == 1)
    pg.keyboard.press('Control+A'); pg.keyboard.type('Storm Update tonight'); pg.keyboard.press('Enter'); pg.wait_for_timeout(200)
    chk('Enter finishes the one-line banner title', ev("WX.S.show.scenes[WX.S.si].title2.text") == 'Storm Update tonight' and pg.locator('textarea.wxInline').count() == 0)
    chk('no page errors', not errs, errs)
    br.close()
n = sum(res); print('\n%d/%d checks passed' % (n, len(res))); sys.exit(0 if n == len(res) else 1)
