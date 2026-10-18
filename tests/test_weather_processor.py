"""Unit tests for real NOAA parser/palette/frame-API contracts.

These tests do NOT assert an external NOAA service is currently reachable.
Integration validation needs current NOAA example files + a running worker.
"""
from __future__ import annotations

import datetime as dt
import io
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from weather_processor import decoders, ingest, service
from weather_processor.store import FrameStore, UTC, validate_product


def test_noaa_source_timestamp_parsers_and_freshness():
    time = ingest.scan_time(
        "OR_ABI-L2-CMIPC-M6C02_G19_s20262911101009_e20262911105500_c20262911105570.nc",
        "goes",
    )
    assert time == dt.datetime.strptime("2026291110100", "%Y%j%H%M%S").replace(tzinfo=UTC)
    assert ingest.scan_time("MRMS_MergedReflectivityQC_00.50_20261018-110029.grib2.gz", "mrms").minute == 0
    assert ingest.scan_time("KBOX20261018_110112_V06", "nexrad").hour == 11
    assert ingest.fresh(time, kind="goes", now=time + dt.timedelta(minutes=14))
    assert not ingest.fresh(time, kind="goes", now=time + dt.timedelta(hours=5))
    with pytest.raises(ValueError):
        ingest.scan_time("bad_no_observation_date", "mrms")


def test_native_noaa_products_are_strict_and_not_generic_uploads():
    for product in (
        "mrms-reflectivity",
        "goes-east-meso1-C02",
        "goes-west-full-C13",
        "nexrad-reflectivity-KBOX",
        "nexrad-velocity-KDIX",
    ):
        assert validate_product(product) == product
    for invalid in ("../../secrets", "rtma", "forecast", "goes-east-all",
                    "nexrad-reflectivity-/../KBOX", "goes-east-meso3-C02"):
        with pytest.raises(ValueError):
            validate_product(invalid)


def test_palette_values_and_no_fake_radar_echoes():
    table = decoders.palette("radar-reflectivity")
    field = np.array([[np.nan, -4, 0, 5, 20, 55]], np.float32)
    pixels = decoders.rgba(field, table)
    assert pixels.shape == (1, 6, 4)
    assert list(pixels[0, :3, 3]) == [0, 0, 0]
    assert pixels[0, 3, 3] == 255
    assert np.array_equal(pixels[0, 4, :3], np.array([2, 253, 2]))
    assert decoders.palette("radar-velocity")["continuous"]
    assert decoders.palette("satellite-ir-c13")["units"] == "°C"
    with pytest.raises(ValueError):
        decoders.palette("../etc/passwd")


def test_native_output_resolution_guard_does_not_fake_detail():
    assert decoders.size_for_bbox([-82, 35, -72, 40], .01) == (1000, 500)
    with pytest.raises(ValueError, match="safe memory"):
        decoders.size_for_bbox([-180, -60, 180, 60], .001)
    with pytest.raises(ValueError):
        decoders.size_for_bbox([-81, 40, -82, 35], .01)


def test_atomic_frame_store_and_actual_observation_manifest(tmp_path, monkeypatch):
    store = FrameStore(tmp_path)
    stamp = dt.datetime.now(UTC) - dt.timedelta(minutes=2)
    red = Image.new("RGBA", (4, 3), (255, 0, 0, 255))
    store.put("mrms-reflectivity", stamp, red, [-82, 35.5, -64.5, 49], "NOAA native MRMS GRIB2")
    assert store.has("mrms-reflectivity", stamp)
    assert len(store.active()) == 1
    monkeypatch.setattr(service, "STORE", store)
    client = TestClient(service.APP)
    assert client.get("/health").json()["status"] == "ready"
    catalog = client.get("/catalog").json()
    assert catalog["schema"] == "wxstudio.frames.v1"
    assert catalog["products"][0]["product"] == "mrms-reflectivity"
    response = client.get("/manifests/mrms-reflectivity.json")
    assert response.status_code == 200
    frames = response.json()["frames"]
    assert len(frames) == 1
    assert frames[0]["t"] == int(stamp.timestamp() * 1000)
    assert frames[0]["bbox"] == [-82, 35.5, -64.5, 49]
    assert frames[0]["crs"] == "4326"
    result = client.get("/frames/mrms-reflectivity/" + str(frames[0]["t"]) + ".png")
    assert result.status_code == 200 and result.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert result.headers["access-control-allow-origin"] == "*" if (
        "access-control-allow-origin" in result.headers) else True
    assert client.get("/frames/../../secret/1234567890123.png").status_code in (400, 404)
    assert client.get("/manifests/not-real.json").status_code == 404


def test_stale_processed_observations_are_never_claimed_live(tmp_path, monkeypatch):
    store = FrameStore(tmp_path)
    old = dt.datetime.now(UTC) - dt.timedelta(hours=3)
    image = Image.new("RGBA", (2, 2), (0, 0, 0, 0))
    store.put("mrms-reflectivity", old, image, [-80, 40, -79, 41], "historic test")
    assert not store.active()
    monkeypatch.setattr(service, "STORE", store)
    client = TestClient(service.APP)
    assert client.get("/catalog").json()["products"] == []
    assert client.get("/manifests/mrms-reflectivity.json").status_code == 404


def test_full_disk_and_meso_candidates_not_mislabeled():
    now = dt.datetime(2026, 10, 18, 11, 10, tzinfo=UTC)
    class Fake:
        def list_s3(self, bucket, prefix):
            assert bucket == "noaa-goes19"
            if "ABI-L2-CMIPM" not in prefix or not prefix.endswith("/11/"):
                return []
            # A real S3 scan exists in its observation-hour prefix ONCE.
            # Fake S3 results must not return the same scan in three hours.
            return [{"Key": prefix + "OR_ABI-L2-CMIPM1-M6C02_G19_s20262911105001_e20262911105500_c20262911106000.nc",
                     "Size": 100}]
    rows = ingest.goes_candidates(Fake(), "goes-east-meso1-C02", now)
    assert len(rows) == 1
    assert rows[0][2].hour == 11
    assert rows[0][0] == "noaa-goes19"


def test_goes_candidate_regex_accepts_single_and_double_digit_abi_scan_modes():
    # Regression against an f-string containing \\d{1,2}: Python evaluates
    # the single curly braces as a tuple, and NO real GOES scan matches it.
    now = dt.datetime(2026, 10, 18, 11, 10, tzinfo=UTC)
    for mode in ("M6", "M16"):
        class Fake:
            def list_s3(self, bucket, prefix):
                if not prefix.endswith("/11/"):
                    return []
                return [{"Key": prefix + f"OR_ABI-L2-CMIPC-{mode}C02_G19_s20262911105001_e20262911105500_c20262911106000.nc",
                         "Size": 100}]
        rows = ingest.goes_candidates(Fake(), "goes-east-conus-C02", now)
        assert len(rows) == 1
        assert rows[0][2].hour == 11
    class NotAnotherProduct:
        def list_s3(self, bucket, prefix):
            if not prefix.endswith("/11/"):
                return []
            return [{"Key": prefix + "OR_ABI-L2-CMIPM2-M6C02_G19_s20262911105001_e20262911105500_c20262911106000.nc",
                     "Size": 100}]
    assert ingest.goes_candidates(NotAnotherProduct(), "goes-east-meso1-C02", now) == []


def test_mrms_decoding_rejects_pre_rendered_noaa_png_and_invalid_gzip():
    with pytest.raises(ValueError, match="not gzip"):
        decoders.mrms_grib2_gz(b"\x89PNG\r\n\x1a\n", [-82, 35, -64, 49])
