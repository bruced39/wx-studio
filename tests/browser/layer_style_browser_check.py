"""Real-browser check (v0.10.1.5): the Layer Style window's effect checkboxes really switch effects on and off (they used to do nothing because the
list row rebuilt itself on the same click), sliders change the picture, and the Scene-panel banner sections carry the new names.
Usage: python3 wxbuild.py && python3 tests/browser/layer_style_browser_check.py"""
from playwright.sync_api import sync_playwright
import pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[2]
res = []
def chk(n, ok, info=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n, '' if ok else info)
RENDER = """()=>{const E=WX.E,c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d');E.renderScene(x,WX.S.show,WX.S.show.scenes[0],1,{editing:false});
  const d=x.getImageData(560,300,800,480).data;let red=0,dark=0;for(let i=0;i<d.length;i+=4){if(d[i]>180&&d[i+1]<90&&d[i+2]<90)red++;if(d[i]<14&&d[i+1]<30&&d[i+2]<70)dark++}return [red,dark]}"""
with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox']); pg = br.new_page(viewport={'width': 1700, 'height': 960}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto((ROOT / 'dist' / 'studio.html').as_uri()); pg.wait_for_timeout(2500); ev = pg.evaluate
    ev("document.getElementById('modalBg').style.display='none'")
    ev("""()=>{const sc=WX.S.show.scenes[0];sc.bg={type:'solid',color:'#12408a',kenburns:false};sc.objects=[];sc.title2&&(sc.title2.show=false);const o=WX.E.newObject('text',{x:960,y:540,text:'HELLO',size:260,color:'#ffffff'});o.anim={in:'none',delay:0,dur:0.1};sc.objects.push(o);WX.S.oid=o.id;WX.commit();WX.setTab('object');}""")
    pg.wait_for_timeout(400)
    base = ev(RENDER); pg.get_by_text('Layer style… (Photopea-style)').click(); pg.wait_for_timeout(400)
    chk('the Layer Style window opens', ev("!!document.getElementById('fxwin')"))
    fx = lambda: ev("JSON.stringify((WX.S.show.scenes[0].objects[0].fx||{}))")
    cbs = pg.locator('#fxwin input[type=checkbox]')
    chk('five effect checkboxes', cbs.count() == 5)
    ev("(()=>{const o=WX.S.show.scenes[0].objects[0];o.fx.stroke.color='#ff0000';o.fx.stroke.size=10;})()")
    cbs.nth(0).click(); pg.wait_for_timeout(300)
    chk('ticking Stroke switches it on (and the box stays ticked)', ev("WX.S.show.scenes[0].objects[0].fx.stroke.on") is True and pg.locator('#fxwin input[type=checkbox]').nth(0).is_checked())
    on = ev(RENDER); chk('the red stroke now appears on the stage', on[0] > base[0] + 800, [base, on])
    chk('the Stroke pane is shown for the ticked effect', 'Stroke' in ev("document.querySelector('#fxwin').innerText"))
    pg.locator('#fxwin input[type=checkbox]').nth(0).click(); pg.wait_for_timeout(300)
    chk('unticking switches it off again', ev("WX.S.show.scenes[0].objects[0].fx.stroke.on") is False and ev(RENDER)[0] <= base[0] + 20)
    pg.locator('#fxwin input[type=checkbox]').nth(1).click(); pg.wait_for_timeout(300)
    chk('Drop Shadow tick works and selects its pane', ev("WX.S.show.scenes[0].objects[0].fx.shadow.on") is True and 'Drop Shadow' in ev("document.querySelector('#fxwin').innerText"))
    pg.locator('#fxwin >> text=Outer Glow').click(); pg.wait_for_timeout(300)
    chk('clicking an effect name selects it without toggling it', ev("!!WX.S.show.scenes[0].objects[0].fx.glow.on") is False and 'Outer Glow' in ev("document.querySelector('#fxwin').innerText"))
    pg.locator('#fxwin input[type=checkbox]').nth(4).click(); pg.wait_for_timeout(300)
    r = pg.locator('#fxwin input[type=range]').nth(1); r.evaluate("e=>{e.value=40;e.dispatchEvent(new Event('input',{bubbles:true}))}"); pg.wait_for_timeout(300)
    chk('Outer Glow ticks and its size slider changes the style', ev("WX.S.show.scenes[0].objects[0].fx.glow.on") is True and ev("WX.S.show.scenes[0].objects[0].fx.glow.size") == 40, fx())
    pg.get_by_role('button', name='OK').click(); pg.wait_for_timeout(300)
    chk('OK closes the window and the style is kept', ev("!document.getElementById('fxwin')") and ev("WX.S.show.scenes[0].objects[0].fx.glow.on") is True)
    # --- banner labels
    ev("(()=>{WX.setTab('scene')})()"); pg.wait_for_timeout(400)
    txt = ev("document.getElementById('side').innerText")
    chk('Scene panel says "Banner & Logo" and "Standard Banner"', 'banner & logo' in txt.lower() and 'standard banner' in txt.lower(), txt[:400])
    chk('the old names are gone', 'title banner' not in txt.lower() and 'your banner + logo' not in txt.lower())
    chk('no page errors', not errs, errs[:3])
    br.close()
print(f"\n{sum(res)}/{len(res)} checks passed"); sys.exit(0 if all(res) else 1)
