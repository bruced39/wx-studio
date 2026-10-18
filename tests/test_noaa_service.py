"""HTTP publisher unit tests: no scientific dependencies or NOAA downloads."""
from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
from http.server import ThreadingHTTPServer
from urllib.request import urlopen
import unittest

from studio.weather.ingest.service import frames_for, catalog, make_handler

NOW=1_800_000_000_000
PNG=b"\x89PNG\r\n\x1a\n" + b"sample-png-placeholder"  # HTTP test only, not an actual weather frame


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.product="goes-east-conus-C02"
        self.t=NOW-5*60_000

    def fixture(self, product=None, timestamp=None, filename=None, bbox=None):
        product=product or self.product
        t=self.t if timestamp is None else timestamp
        dir=self.root/product/"frames"
        dir.mkdir(parents=True,exist_ok=True)
        name=filename or str(t)+".png"
        (dir/name).write_bytes(PNG)
        meta={"schema":"wxstudio.frames.v1","source":"goes",
              "product":product,"frames":[{"t":t,"bbox":bbox or [-76,39,-66,46],
                "crs":"4326","url":"frames/"+name}],"nativeResolutionMetres":500}
        (dir.parent/"manifest.json").write_text(json.dumps(meta))

    def test_no_source_never_claims_live(self):
        self.assertIsNone(frames_for(self.root,self.product,"https://frames.example",now_ms=NOW))
        self.assertEqual(catalog(self.root,"https://frames.example",now_ms=NOW)["status"],"no-fresh-data")

    def test_manifest_uppercase_band_and_true_observation_time(self):
        self.fixture()
        result=frames_for(self.root,self.product,"https://frames.example",now_ms=NOW)
        self.assertEqual(result["status"],"available")
        self.assertEqual(result["frames"][0]["t"],self.t)
        self.assertEqual(result["nativeResolutionMetres"],500)
        self.assertEqual(result["frames"][0]["url"],
                         f"https://frames.example/frames/goes-east-conus-C02/{self.t}.png")

    def test_stale_and_future_files_unavailable(self):
        self.fixture(timestamp=NOW-100*60_000)
        self.assertIsNone(frames_for(self.root,self.product,"https://frames.example",now_ms=NOW))
        self.fixture(timestamp=NOW+11*60_000)
        self.assertIsNone(frames_for(self.root,self.product,"https://frames.example",now_ms=NOW))

    def test_wrong_file_and_bbox_disallowed(self):
        self.fixture(filename="1234567890123.png")
        self.assertIsNone(frames_for(self.root,self.product,"https://frames.example",now_ms=NOW))
        self.fixture(bbox=[-76,46,-66,39])
        self.assertIsNone(frames_for(self.root,self.product,"https://frames.example",now_ms=NOW))

    def test_public_http_response_and_cors_with_actual_route(self):
        # Use current clock for the actual HTTP test (no freshness spoofing).
        from datetime import datetime,timezone
        now=int(datetime.now(timezone.utc).timestamp()*1000)
        self.fixture(timestamp=now-30_000)
        server=ThreadingHTTPServer(("127.0.0.1",0),make_handler(
            self.root,public_base="https://wx-weather.example",allowed_origin="*"))
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        addr=f"http://127.0.0.1:{server.server_address[1]}"
        with urlopen(addr+"/catalog",timeout=3) as response:
            obj=json.loads(response.read())
            self.assertEqual(response.headers["Access-Control-Allow-Origin"],"*")
            self.assertEqual(obj["products"][0]["product"],self.product)
        with urlopen(addr+"/manifests/goes-east-conus-C02.json",timeout=3) as response:
            manifest=json.loads(response.read())
            self.assertEqual(manifest["frames"][0]["url"],
                             f"https://wx-weather.example/frames/{self.product}/{now-30_000}.png")
        with urlopen(addr+f"/frames/{self.product}/{now-30_000}.png",timeout=3) as response:
            self.assertEqual(response.read(),PNG)
            self.assertEqual(response.headers["Content-Type"],"image/png")


if __name__=="__main__":
    unittest.main()
