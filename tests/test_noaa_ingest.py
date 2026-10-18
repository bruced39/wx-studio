"""Offline tests for NOAA native decoding and the WXData frame contract.

Run on processing worker: python -m unittest discover -s tests -p test_noaa_ingest.py
No API keys, live NOAA downloads or Streamlit server required.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
from studio.weather.ingest import cli, processors


class NOAAProcessorTests(unittest.TestCase):
    def test_radar_no_echo_transparent(self):
        x=np.ma.array([[np.nan,-20,-5,5,15,35,75,100]],mask=[[0,0,0,0,0,0,0,1]])
        out=processors.rgba(x,processors.RADAR,min_echo=-5)
        self.assertEqual(out.shape,(1,8,4))
        self.assertEqual(list(out[0,:3,3]),[0,0,0])
        self.assertGreater(int(out[0,3,3]),0)
        self.assertEqual(int(out[0,-1,3]),0)

    def test_grid_crop_north_up_and_lon_west_east(self):
        grid=np.array([[0,1,2,3],[10,11,12,13],[20,21,22,23]],float)
        part,bbox=processors.crop_regular_grid(grid,
            lons=[-67,-68,-69,-70],lats=[40,41,42],bbox=(-69.1,39.9,-67.9,42.1))
        # Input is south->north and east->west; result must be north->south,
        # west->east, without interpolating/downsampling original values.
        self.assertEqual(part.tolist(),[[22,21],[12,11],[2,1]])
        self.assertAlmostEqual(bbox[0],-69.5)
        self.assertAlmostEqual(bbox[3],42.5)

    def test_native_output_guard_refuses_silent_downsampling(self):
        size=processors._dims((-75,40,-74,41),500,100000)
        self.assertGreater(size[0],100)
        with self.assertRaisesRegex(ValueError,"exceeds"):
            processors._dims((-85,30,-60,50),500,1_000_000)

    def test_fake_mrms_grib2_field_read_with_true_timestamp(self):
        class Msg:
            gridType="regular_ll"
            values=np.ma.array([[5,10,20],[30,-999,40],[50,60,70]],mask=False)
            latitudeOfFirstGridPointInDegrees=43
            latitudeOfLastGridPointInDegrees=41
            longitudeOfFirstGridPointInDegrees=289
            longitudeOfLastGridPointInDegrees=291
            validDate=datetime(2026,10,18,13,0)
        class Gribs:
            def message(self,n): self.last=n;return Msg()
            def close(self): self.closed=True
        stub=SimpleNamespace(open=lambda p:Gribs())
        with patch.dict(sys.modules,{"pygrib":stub}):
            frame=processors.decode_mrms("mock.grib2",(-71,41,-69,43))
        self.assertEqual(frame.pixels.shape,(3,3,4))
        self.assertEqual(frame.timestamp.hour,13)
        self.assertEqual(frame.native_resolution_m,1000)
        self.assertEqual(int(frame.pixels[1,1,3]),0)

    def test_manifest_frame_uses_source_timestamp_and_caches_bounded(self):
        class Args:
            source="mrms"
            bbox="-71,41,-69,43"
            satellite="east";sector="conus";band="C02";site="KBOX"
            moment="reflectivity";keep=2;max_pixels=100_000
            max_download_mb=10
        t=datetime(2026,10,18,14,tzinfo=timezone.utc)
        picture=processors.Frame(np.zeros((4,5,4),dtype="uint8"),
           (-71,41,-69,43),t,"fake-MRMS",1000)
        with TemporaryDirectory() as d:
            inp=Path(d)/"fake.grib2";inp.write_bytes(b"GRIBstub")
            a=Args();a.input=str(inp);a.output=str(Path(d)/"output")
            with patch.object(processors,"decode_mrms",return_value=picture):
                result=cli.convert(a)
            import json
            m=json.loads(Path(result["manifest"]).read_text())
            self.assertEqual(m["schema"],"wxstudio.frames.v1")
            self.assertEqual(m["frames"][0]["t"],int(t.timestamp()*1000))
            self.assertEqual(m["frames"][0]["bbox"],[-71,41,-69,43])
            self.assertEqual(m["frames"][0]["crs"],"4326")
            self.assertTrue(Path(result["frame"]).is_file())
            self.assertEqual(result["pixelDimensions"],[5,4])

    def test_unsigned_latest_s3_object_lookup(self):
        now=datetime(2026,10,18,13,tzinfo=timezone.utc)
        example="ABI-L2-CMIPC/2026/291/13/OR_ABI-L2-CMIPC-M6C02_G19_s20262911300000_e.nc"
        with patch.object(cli.discovery,"goes_keys",return_value=[example]):
            url=cli.select_latest("goes",satellite="east",sector="conus",band="C02",now=now)
        self.assertTrue(url.startswith("https://noaa-goes19.s3.amazonaws.com/"))
        self.assertIn("M6C02",url)
        with self.assertRaisesRegex(ValueError,"NEXRAD"):
            cli.select_latest("nexrad",site="KBOS",now=now)

    def test_archive_has_no_generated_freshness_from_download_clock(self):
        # Frame timestamp only from observations, NEVER time.time() used as
        # an invented weather-validity timestamp.
        t=processors._stamp("2026-10-18T14:30:00Z")
        self.assertEqual(t.utcoffset().total_seconds(),0)
        self.assertEqual(t.minute,30)


if __name__=="__main__":
    unittest.main()
