"""GitHub Actions acceptance check of real source-native NOAA decoder outputs.

Only a successful native decode from a timestamped NOAA observation can pass.
No mock or ImageServer raster passes this test. A failed/offline NOAA endpoint
produces an explicit FAIL report; it must not be marketed as live.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import sys
import time
from pathlib import Path

from PIL import Image

from .ingest import PublicNoaa, ingest_product, GOES, NEXRAD, MRMS
from .store import FrameStore, UTC, epoch_ms, validate_product

LOG = logging.getLogger("wxstudio.noaa-acceptance")


def verify_frame(store: FrameStore, product: str, stamp: dt.datetime, now: dt.datetime):
    """Verify a real decoder's atomic image AND geospatial/time metadata."""
    png, info = store.paths(product, stamp)
    if not (png.is_file() and info.is_file()):
        raise ValueError("Missing atomic decoder output PNG or metadata")
    meta = json.loads(info.read_text(encoding="utf-8"))
    if meta.get("schema") != "wxstudio.frames.v1":
        raise ValueError("Wrong frame schema")
    if meta.get("t") != epoch_ms(stamp):
        raise ValueError("Frame observation time does not match NOAA filename")
    bbox = meta.get("bbox")
    if not (isinstance(bbox, list) and len(bbox) == 4
            and -180 <= bbox[0] < bbox[2] <= 180
            and -85 <= bbox[1] < bbox[3] <= 85):
        raise ValueError("Invalid georeferenced bounding box")
    if not meta.get("source") or "NOAA" not in meta["source"]:
        raise ValueError("Source attribution does not identify NOAA")
    # PIL verifies that the processor really wrote a valid readable PNG.
    with Image.open(png) as image:
        image.verify()
    with Image.open(png) as image:
        if image.format != "PNG" or image.mode != "RGBA":
            raise ValueError("Expected scientific decoder RGBA PNG")
        width, height = image.size
        if min(width, height) < 2 or width * height > 16_000_000:
            raise ValueError("Invalid native decoder output dimensions")
        # A fair-weather radar image CAN be all transparent. Report it,
        # but don't invent a false echo to satisfy an acceptance check.
        alpha_extrema = list(image.getchannel("A").getextrema())
    if width != meta.get("width") or height != meta.get("height"):
        raise ValueError("PNG pixels disagree with metadata")
    if stamp > now + dt.timedelta(minutes=10) or stamp < now - dt.timedelta(minutes=60):
        raise ValueError("NOAA observation is stale/future-dated")
    return {
        "observation_utc": stamp.isoformat(),
        "epoch_ms": meta["t"],
        "native_source": meta["source"],
        "width": width,
        "height": height,
        "bbox": bbox,
        "png_bytes": png.stat().st_size,
        "alpha_min_max": alpha_extrema,
        "png": str(png),
    }


def run_acceptance(products: list[str], root: Path, *, now=None,
                   noaa=None, fail_on_missing=True):
    now = now or dt.datetime.now(UTC)
    checked = []
    noaa = noaa or PublicNoaa()
    store = FrameStore(root)
    for product in products:
        validate_product(product)
        result = {"product": product, "status": "failed", "frames": [], "error": None}
        started = time.monotonic()
        LOG.info("NOAA native decoder test: %s", product)
        try:
            found = ingest_product(noaa, store, product, now=now, limit=1)
            if not found:
                raise RuntimeError("No fresh NOAA scan successfully decoded; consult job logs "
                                   "for missing feed, library or decoder errors")
            for timestamp in found:
                result["frames"].append(verify_frame(store, product, timestamp, now))
            if not result["frames"]:
                raise RuntimeError("Decoder produced no complete frames")
            result["status"] = "passed"
        except Exception as exc:
            result["error"] = f"{type(exc).__name__}: {exc}"
            LOG.exception("NOAA validation failed: %s", product)
        result["elapsed_seconds"] = round(time.monotonic() - started, 2)
        checked.append(result)
    passed = sum(item["status"] == "passed" for item in checked)
    report = {
        "schema": "wxstudio.noaa.native-acceptance.v1",
        "verified_at_utc": now.isoformat(),
        "test_method": "Real NOAA native NetCDF/GRIB2/Level-II decode; no simulated frames",
        "passed": passed,
        "total": len(checked),
        "complete": passed == len(checked),
        "products": checked,
    }
    root.mkdir(parents=True, exist_ok=True)
    (root / "acceptance-report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prove real NOAA source-native decoding on a GitHub runner")
    parser.add_argument("--products", default=os.environ.get(
        "WX_NOAA_ACCEPTANCE_PRODUCTS",
        "mrms-reflectivity,goes-east-conus-C02,goes-east-conus-C13,nexrad-reflectivity-KBOX"))
    parser.add_argument("--output", default="noaa-proof")
    options = parser.parse_args(argv)
    products = [item.strip() for item in options.products.split(",") if item.strip()]
    if not products or len(products) > 8 or len(products) != len(set(products)):
        parser.error("Choose between 1 and 8 unique known NOAA product IDs")
    for item in products:
        if item != MRMS and not GOES.fullmatch(item) and not NEXRAD.fullmatch(item):
            parser.error("Unsupported product: " + item)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    report = run_acceptance(products, Path(options.output))
    for item in report["products"]:
        print(f"{item['status'].upper():6} {item['product']} "
              f"frames={len(item['frames'])} {item.get('error') or ''}", flush=True)
    print(f"Native NOAA decoder proof: {report['passed']}/{report['total']} passed "
          f"(full report in {options.output}/acceptance-report.json)", flush=True)
    return 0 if report["complete"] else 1


if __name__ == "__main__":
    sys.exit(main())
