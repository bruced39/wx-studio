"""Checks the Streamlit shell (app.py) really hands the studio its Supabase configuration, without needing Streamlit installed or the network:
app.py is executed against a stub `streamlit` module that records what it would put on the page, the recorded page is opened in headless Chromium and
window.WX_CLOUD_CONFIG, the cloud status chip and the account dialog's "Cloud project" line are read back.
Only PUBLIC values are involved (project URL + sb_publishable_ key). Also checks that a secret/service key is never injected.
Usage: python3 wxbuild.py && python3 tests/app_cloud_config_check.py      (needs playwright + Chromium)"""
import sys, types, pathlib, runpy, json, os, tempfile, re
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
res = []
def chk(n, ok, info=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + n, '' if ok else info)
os.chdir(ROOT); sys.path.insert(0, str(ROOT))

def run_app(secrets):
    cap = {}
    class Ctx:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    class ST:
        sidebar = Ctx()
        def __init__(self): self.secrets = secrets
        def slider(self, *a, **k): return 940
        def checkbox(self, *a, **k): return False
        def __getattr__(self, name): return lambda *a, **k: None
    st = ST(); comp = types.ModuleType('streamlit.components.v1'); comp.html = lambda html, **k: cap.setdefault('html', html)
    mod = types.ModuleType('streamlit'); mod.__dict__.update({k: getattr(st, k) for k in ('sidebar', 'secrets', 'slider', 'checkbox')})
    for name in ('set_page_config', 'markdown', 'header', 'caption'): setattr(mod, name, lambda *a, **k: None)
    mod.components = types.ModuleType('streamlit.components'); mod.components.v1 = comp
    sys.modules.update({'streamlit': mod, 'streamlit.components': mod.components, 'streamlit.components.v1': comp})
    sys.modules.pop('wxbuild', None); runpy.run_path(str(ROOT / 'app.py'), run_name='__main__')
    return cap['html']

def cfg_of(html):
    m = re.search(r'window\.WX_CLOUD_CONFIG=(\{.*?\});</script>', html)
    return json.loads(m.group(1)) if m else None

default = run_app({})
c = cfg_of(default)
chk('default build injects WX_CLOUD_CONFIG', c is not None)
chk('default project URL is the WX Studio Supabase project', c and c['url'] == 'https://lcujugmyyuumrshdasla.supabase.co', c)
chk('default key is a publishable key', c and c['publishableKey'].startswith('sb_publishable_') and 'secret' not in c['publishableKey'].lower())
chk('only url + publishableKey are injected (nothing else from secrets)', c and sorted(c) == ['publishableKey', 'url'], c)
ov = run_app({'WX_SUPABASE_URL': 'https://example-override.supabase.co', 'WX_SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_OVERRIDE1234'})
c2 = cfg_of(ov); chk('Streamlit secrets override the defaults', c2 == {'url': 'https://example-override.supabase.co', 'publishableKey': 'sb_publishable_OVERRIDE1234'}, c2)
bad = run_app({'WX_SUPABASE_PUBLISHABLE_KEY': 'sb_secret_SHOULD_NEVER_BE_SENT', 'MAPBOX_TOKEN': 'pk.test'})
chk('a secret key in the publishable slot is refused (no cloud config injected)', cfg_of(bad) is None and 'sb_secret_' not in bad)
chk('no service-role / secret key text anywhere in the default page', 'service_role' not in default and 'sb_secret_' not in default)

with sync_playwright() as p:
    br = p.chromium.launch(args=['--no-sandbox'])
    f = pathlib.Path(tempfile.mkdtemp(prefix='wxapp_')) / 'page.html'; f.write_text(default, encoding='utf-8')
    pg = br.new_page(viewport={'width': 1700, 'height': 960}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f.as_uri()); pg.wait_for_timeout(2500)
    got = pg.evaluate("window.WX_CLOUD_CONFIG")
    chk('the browser page receives the same config', got == c, got)
    chk('the cloud chip is shown (cloud is active in this build)', pg.evaluate("(()=>{const e=document.getElementById('cloudState');return !!e&&!e.hidden&&e.textContent.trim().length>0})()"))
    pg.evaluate("document.getElementById('cloudState').click()"); pg.wait_for_timeout(500)
    line = pg.evaluate("(()=>{const e=document.querySelector('[data-cloud-project]');return e&&[e.dataset.cloudProject,e.textContent]})()")
    chk('the account dialog states the project host and the last 4 key characters', line and line[0] == 'lcujugmyyuumrshdasla.supabase.co' and line[1].endswith(c['publishableKey'][-4:]) and c['publishableKey'] not in line[1], line)
    chk('no page errors', not errs, errs[:3]); br.close()
print(f"\n{sum(res)}/{len(res)} checks passed"); sys.exit(0 if all(res) else 1)
