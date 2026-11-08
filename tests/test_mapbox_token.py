"""v0.10.3 – public Mapbox token selection (mapbox_token.py). Run: python3 -m unittest tests.test_mapbox_token"""
from pathlib import Path
import ast
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from mapbox_token import normalize_host, pick_token  # noqa: E402

PK1 = "pk.eyJ1IjoiYSIsImEiOiJwcm9kMTIzNDU2In0.abcdef"
PK2 = "pk.eyJ1IjoiYSIsImEiOiJ0ZXN0MTIzNDU2In0.ghijkl"
SK = "sk.eyJ1IjoiYSIsImEiOiJzZWNyZXQxMjM0In0.TOPSECRET"


class PickTokenTests(unittest.TestCase):
    def test_public_token_is_used(self):
        c = pick_token({"MAPBOX_PUBLIC_TOKEN": "  " + PK1 + "\n"})
        self.assertEqual((c.token, c.source, c.rejected), (PK1, "MAPBOX_PUBLIC_TOKEN", []))

    def test_legacy_name_still_works_and_public_name_wins(self):
        self.assertEqual(pick_token({"MAPBOX_TOKEN": PK1}).source, "MAPBOX_TOKEN")
        c = pick_token({"MAPBOX_TOKEN": PK2, "MAPBOX_PUBLIC_TOKEN": PK1})
        self.assertEqual((c.token, c.source), (PK1, "MAPBOX_PUBLIC_TOKEN"))

    def test_secret_and_temporary_tokens_are_never_returned_and_only_the_key_name_is_reported(self):
        c = pick_token({"MAPBOX_PUBLIC_TOKEN": SK})
        self.assertEqual(c.token, "")
        self.assertEqual(c.rejected, ["MAPBOX_PUBLIC_TOKEN"])
        self.assertNotIn("TOPSECRET", repr(c))
        c = pick_token({"MAPBOX_PUBLIC_TOKEN": SK, "MAPBOX_TOKEN": PK1})
        self.assertEqual((c.token, c.source, c.rejected), (PK1, "MAPBOX_TOKEN", ["MAPBOX_PUBLIC_TOKEN"]))
        self.assertEqual(pick_token({"MAPBOX_TOKEN": "tk.something-long-enough-123"}).token, "")

    def test_garbage_and_missing_values(self):
        for bad in ("", "   ", "pk.", "pk.short", 12345, None, ["pk." + "x" * 30]):
            self.assertEqual(pick_token({"MAPBOX_PUBLIC_TOKEN": bad}).token, "", repr(bad))
        self.assertEqual(pick_token({}), ("", "", []))

    def test_per_host_table_selects_a_dedicated_restricted_token(self):
        table = {"MAPBOX_PUBLIC_TOKENS_BY_HOST": {"wx-studio.streamlit.app": PK1, "wx-studio-test.streamlit.app": PK2},
                 "MAPBOX_PUBLIC_TOKEN": "pk.eyJ1IjoiYSIsImEiOiJkZWZhdWx0MTIzIn0.zzzzzz"}
        self.assertEqual(pick_token(table, "wx-studio.streamlit.app").token, PK1)
        self.assertEqual(pick_token(table, "WX-Studio-Test.streamlit.app:443").token, PK2)
        c = pick_token(table, "other.streamlit.app")
        self.assertEqual(c.source, "MAPBOX_PUBLIC_TOKEN", "unknown host falls back to the single token")
        self.assertEqual(pick_token(table, None).source, "MAPBOX_PUBLIC_TOKEN", "no Host header falls back too")

    def test_per_host_secret_token_is_rejected_by_name(self):
        c = pick_token({"MAPBOX_PUBLIC_TOKENS_BY_HOST": {"a.streamlit.app": SK}}, "a.streamlit.app")
        self.assertEqual(c.token, "")
        self.assertEqual(c.rejected, ["MAPBOX_PUBLIC_TOKENS_BY_HOST[a.streamlit.app]"])

    def test_normalize_host(self):
        self.assertEqual(normalize_host("Wx.Streamlit.App:8501"), "wx.streamlit.app")
        self.assertEqual(normalize_host("localhost:8501"), "localhost")
        self.assertEqual(normalize_host("[::1]:8501"), "::1")
        self.assertEqual(normalize_host(None), "")

    def test_broken_secrets_object_does_not_raise(self):
        class Boom(dict):
            def get(self, *a, **k):
                raise RuntimeError("no secrets file")
        self.assertEqual(pick_token(Boom(), "x"), ("", "", []))


class AppWiringTests(unittest.TestCase):
    def test_app_uses_the_picker_and_only_injects_public_tokens(self):
        code = (ROOT / "app.py").read_text(encoding="utf-8")
        ast.parse(code)
        self.assertIn("from mapbox_token import TokenChoice, pick_token", code)
        self.assertIn('if _tok.startswith("pk."):', code)
        self.assertNotIn("st.secrets.get(key", code, "no ad-hoc secret reads left in app.py")


if __name__ == "__main__":
    unittest.main()
