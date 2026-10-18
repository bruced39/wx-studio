"""Offline regression checks for the zero-paid-host Windows NOAA workflow.

Does not require Docker/NOAA or pretend actual satellite/radar are live.
"""
from pathlib import Path
import ast
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LocalNoaaSetupTests(unittest.TestCase):
    def test_streamlit_shell_can_opt_in_to_local_decoder(self):
        code = (ROOT / "app.py").read_text(encoding="utf-8")
        ast.parse(code)
        self.assertIn("Use free local NOAA processor on this computer", code)
        self.assertIn('"http://127.0.0.1:8080" if local_noaa else _processor_url()', code)
        self.assertIn('value=False', code, "Do not enable local fetch until user opts in")
        self.assertIn("WX_WEATHER_PROCESSOR_URL", code,
                      "Retain existing manually configured remote URL support")

    def test_local_decoder_never_exposes_public_port(self):
        script = (ROOT / "weather_processor/start_local_windows.ps1").read_text(encoding="utf-8")
        self.assertIn('127.0.0.1:$($Port):8080', script)
        self.assertNotIn('-p "$($Port):8080"', script)
        self.assertNotIn('cloudflared', script.lower())
        self.assertNotIn('tailscale funnel', script.lower())
        self.assertIn('wxstudio-noaa-frames', script, "Persist science frames locally")
        self.assertIn('WX_PROCESSOR_PRODUCTS=$Products', script)
        self.assertIn('docker build', script)
        self.assertIn('--restart unless-stopped', script)

    def test_browser_bridge_preserves_existing_live_only_contract(self):
        bridge = (ROOT / "studio/weather/processor_bridge.js").read_text(encoding="utf-8")
        self.assertIn("options.targetAddressSpace='loopback'", bridge)
        self.assertIn("hostname==='127.0.0.1'", bridge)
        self.assertIn("hostname==='localhost'", bridge)
        self.assertIn('if(!endpoint)return;', bridge)
        self.assertIn("g.MB?.setWeatherFrame", bridge)
        self.assertIn("if(goes.length)", bridge)
        self.assertIn("if(mrms.length)", bridge)
        self.assertIn("if(nexrad.length)", bridge)

    def test_documentation_discloses_live_limits(self):
        doc = (ROOT / "weather_processor/LOCAL_FREE_WINDOWS.md").read_text(encoding="utf-8")
        self.assertIn("16-million-pixel", doc)
        self.assertIn("NOT verified", doc)
        self.assertIn("http://127.0.0.1:8080/health", doc)
        self.assertIn("must be on", doc)


if __name__ == "__main__":
    unittest.main()
