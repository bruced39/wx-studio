"""Acceptance-runner tests: no NOAA network access, and never fake a pass."""
from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest
from PIL import Image

from weather_processor import validate_live
from weather_processor.store import FrameStore, UTC


def test_verify_provenance_and_geospatial_png(tmp_path):
    store = FrameStore(tmp_path)
    stamp = dt.datetime.now(UTC) - dt.timedelta(minutes=5)
    image = Image.new("RGBA", (120, 100), (255, 20, 0, 80))
    bbox = [-75, 40, -70, 45]
    store.put("mrms-reflectivity", stamp, image, bbox, "NOAA MRMS real source GRIB2")
    result = validate_live.verify_frame(store, "mrms-reflectivity", stamp, dt.datetime.now(UTC))
    assert result["width"] == 120 and result["height"] == 100
    assert result["bbox"] == bbox
    assert result["png_bytes"] > 0
    assert result["alpha_min_max"] == [80, 80]
    assert result["epoch_ms"] == int(stamp.timestamp() * 1000)


def test_genuine_failure_is_not_promoted_to_pass(monkeypatch, tmp_path):
    def missing(_noaa, _store, _product, **kwargs):
        return []

    monkeypatch.setattr(validate_live, "ingest_product", missing)
    now = dt.datetime.now(UTC)
    report = validate_live.run_acceptance(
        ["mrms-reflectivity", "goes-east-conus-C02"], tmp_path,
        now=now, noaa=object())
    assert report["passed"] == 0 and not report["complete"]
    assert all(item["status"] == "failed" for item in report["products"])
    assert "No fresh NOAA scan" in report["products"][0]["error"]
    evidence = json.loads((tmp_path / "acceptance-report.json").read_text())
    assert evidence["schema"] == "wxstudio.noaa.native-acceptance.v1"


def test_separate_real_source_scan_results_report_success(monkeypatch, tmp_path):
    stamp = dt.datetime.now(UTC) - dt.timedelta(minutes=2)

    def decoded(_noaa, store, product, **kwargs):
        store.put(product, stamp, Image.new("RGBA", (8, 8), (5, 9, 40, 255)),
                  [-80, 38, -70, 45], "NOAA GOES-19 native NetCDF")
        return [stamp]

    monkeypatch.setattr(validate_live, "ingest_product", decoded)
    report = validate_live.run_acceptance(
        ["goes-east-conus-C02"], tmp_path, noaa=object())
    assert report["complete"] and report["passed"] == 1
    assert report["products"][0]["frames"][0]["native_source"].startswith("NOAA")
    assert (tmp_path / "acceptance-report.json").is_file()


def test_corrupt_image_or_timestamp_never_passes(tmp_path):
    store = FrameStore(tmp_path)
    stamp = dt.datetime.now(UTC) - dt.timedelta(minutes=2)
    store.put("mrms-reflectivity", stamp, Image.new("RGBA", (5, 5)),
              [-80, 35, -65, 49], "NOAA native radar")
    png, metadata = store.paths("mrms-reflectivity", stamp)
    png.write_bytes(b"not a real PNG")
    with pytest.raises(Exception):
        validate_live.verify_frame(store, "mrms-reflectivity", stamp, dt.datetime.now(UTC))
    png.write_bytes(Image.new("RGBA", (5, 5)).tobytes())
    with pytest.raises(Exception):
        validate_live.verify_frame(store, "mrms-reflectivity", stamp, dt.datetime.now(UTC))
    # A valid PNG with falsified observation metadata also fails.
    Image.new("RGBA", (5, 5)).save(png)
    data = json.loads(metadata.read_text())
    data["t"] += 123000
    metadata.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="timestamp|time"):
        validate_live.verify_frame(store, "mrms-reflectivity", stamp, dt.datetime.now(UTC))


def test_reject_unsupported_products_before_any_network(capsys):
    with pytest.raises(SystemExit):
        validate_live.main(["--products", "rtma,goes-east-conus-C02"])
    with pytest.raises(SystemExit):
        validate_live.main(["--products", "../secrets"])
