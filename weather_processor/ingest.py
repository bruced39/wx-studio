"""Actual NOAA ingest worker (separate from Streamlit and Claude's loop UI).

Usage:
    python -m weather_processor.ingest --once
    python -m weather_processor.ingest --interval 120

No products are marked live until a raw NOAA file has been downloaded,
scientifically decoded, and an actual timestamped PNG atomically published.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import logging
import os
import re
import tempfile
import time
from pathlib import Path

import boto3
import requests
from botocore import UNSIGNED
from botocore.config import Config

from .decoders import goes_abi_netcdf, mrms_grib2_gz, nexrad_level2
from .store import FrameStore, UTC

LOG = logging.getLogger("wxstudio.noaa")
GOES = re.compile(r"^goes-(east|west)-(conus|full|meso1|meso2)-(C02|C13)$")
NEXRAD = re.compile(r"^nexrad-(reflectivity|velocity)-(K[A-Z0-9]{3})$")
MRMS = "mrms-reflectivity"
SOURCE_HOST = "https://mrms.ncep.noaa.gov/2D/MergedReflectivityQC/"
MRMS_FILE = re.compile(r'MRMS_MergedReflectivityQC_00\.50_(\d{8}-\d{6})\.grib2\.gz')
GOES_START = re.compile(r"_s(\d{13,14})")
NEXRAD_START = re.compile(r"(K[A-Z0-9]{3})(\d{8})_(\d{6})_V\d{2}")
REGIONS = {
    "east": [-82.0, 35.5, -64.5, 49.0],
    "west": [-125.0, 33.0, -107.0, 49.0],
}
DEFAULT_PRODUCTS = "mrms-reflectivity,goes-east-conus-C02,nexrad-reflectivity-KBOX"
MAX_DOWNLOAD = int(os.environ.get("WX_MAX_SOURCE_BYTES", str(250_000_000)))


def scan_time(text: str, kind: str) -> dt.datetime:
    if kind == "goes":
        m = GOES_START.search(text)
        if not m:
            raise ValueError("GOES observation filename missing scan timestamp")
        return dt.datetime.strptime(m.group(1)[:13], "%Y%j%H%M%S").replace(tzinfo=UTC)
    if kind == "mrms":
        m = MRMS_FILE.search(text)
        if not m:
            raise ValueError("MRMS historical filename missing observation timestamp")
        return dt.datetime.strptime(m.group(1), "%Y%m%d-%H%M%S").replace(tzinfo=UTC)
    m = NEXRAD_START.search(text)
    if not m:
        raise ValueError("NEXRAD volume filename missing observation timestamp")
    return dt.datetime.strptime(m.group(2) + m.group(3), "%Y%m%d%H%M%S").replace(tzinfo=UTC)


def fresh(observed: dt.datetime, *, kind: str, now=None) -> bool:
    now = now or dt.datetime.now(UTC)
    max_age = {"goes": 45, "mrms": 25, "nexrad": 40}[kind]
    lag = (now - observed).total_seconds() / 60
    return -10 <= lag <= max_age


class PublicNoaa:
    """Unsigned NOAA S3 + narrowly fixed MRMS HTTPS endpoint only."""
    def __init__(self):
        self.s3 = boto3.client(
            "s3", config=Config(signature_version=UNSIGNED,
                                connect_timeout=15, read_timeout=120, retries={"max_attempts": 3})
        )
        self.http = requests.Session()
        self.http.headers["User-Agent"] = "WXStudio-NOAA-ingest/1.0 (research/weather maps)"

    def list_s3(self, bucket: str, prefix: str) -> list[dict]:
        out = []
        paginator = self.s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                if 0 < obj.get("Size", 0) <= MAX_DOWNLOAD:
                    out.append(obj)
        return out

    def read_s3(self, bucket: str, key: str) -> bytes:
        o = self.s3.get_object(Bucket=bucket, Key=key)
        if o.get("ContentLength", MAX_DOWNLOAD + 1) > MAX_DOWNLOAD:
            raise ValueError("Raw NOAA product exceeds configured download cap")
        with o["Body"] as stream:
            data = stream.read(MAX_DOWNLOAD + 1)
        if len(data) > MAX_DOWNLOAD:
            raise ValueError("NOAA source download exceeded cap")
        return data

    def mrms_entries(self):
        r = self.http.get(SOURCE_HOST, timeout=(15, 35))
        r.raise_for_status()
        # Extract only known file basenames from NOAA's public directory;
        # never request an arbitrary URL from external HTML.
        return sorted(set(re.findall(MRMS_FILE.pattern, r.text)), reverse=True)

    def mrms_bytes(self, time_label: str):
        if not re.fullmatch(r"\d{8}-\d{6}", time_label):
            raise ValueError("Invalid MRMS time")
        name = f"MRMS_MergedReflectivityQC_00.50_{time_label}.grib2.gz"
        r = self.http.get(SOURCE_HOST + name, timeout=(15, 120), stream=True)
        r.raise_for_status()
        if int(r.headers.get("Content-Length", "0")) > MAX_DOWNLOAD:
            raise ValueError("MRMS download cap")
        data = bytearray()
        for chunk in r.iter_content(1024 * 1024):
            data.extend(chunk)
            if len(data) > MAX_DOWNLOAD:
                raise ValueError("MRMS download cap")
        return bytes(data)


def goes_candidates(noaa: PublicNoaa, product: str, now) -> list[tuple[str, str, dt.datetime]]:
    match = GOES.fullmatch(product)
    if not match:
        raise ValueError("Invalid GOES product")
    region, sector, channel = match.groups()
    sat = "19" if region == "east" else "18"
    bucket = "noaa-goes" + sat
    code = {"conus": "C", "full": "F", "meso1": "M1", "meso2": "M2"}[sector]
    family = "ABI-L2-CMIP" + ("M" if code.startswith("M") else code)
    keys = []
    # UTC hour folders; account for a scan close to an hour boundary.
    for back in (0, 1, 2):
        point = now - dt.timedelta(hours=back)
        prefix = f"{family}/{point:%Y}/{point:%j}/{point:%H}/"
        for item in noaa.list_s3(bucket, prefix):
            key = item["Key"]
            name = key.rsplit("/", 1)[-1]
            if re.search(rf"ABI-L2-CMIP{code}-M\d{1,2}{channel}_G{sat}_s", name):
                try:
                    stamp = scan_time(name, "goes")
                    if fresh(stamp, kind="goes", now=now):
                        keys.append((bucket, key, stamp))
                except ValueError:
                    continue
    return sorted(set(keys), key=lambda x: x[2], reverse=True)


def nexrad_candidates(noaa: PublicNoaa, site: str, now) -> list[tuple[str, str, dt.datetime]]:
    if not re.fullmatch(r"K[A-Z0-9]{3}", site):
        raise ValueError("Invalid radar station")
    bucket = "unidata-nexrad-level2"  # NOAA/NSF Unidata 2025+ archive
    out = []
    for day in (now, now - dt.timedelta(days=1)):
        prefix = f"{day:%Y/%m/%d}/{site}/"
        for item in noaa.list_s3(bucket, prefix):
            key = item["Key"]
            try:
                stamp = scan_time(key.split("/")[-1], "nexrad")
                if fresh(stamp, kind="nexrad", now=now):
                    out.append((bucket, key, stamp))
            except ValueError:
                continue
    return sorted(set(out), key=lambda x: x[2], reverse=True)


def ingest_product(noaa: PublicNoaa, store: FrameStore, product: str, *, now=None, limit=2):
    now = now or dt.datetime.now(UTC)
    successes = []
    if product == MRMS:
        frames = noaa.mrms_entries()
        for time_label in frames:
            stamp = scan_time(f"MRMS_MergedReflectivityQC_00.50_{time_label}.grib2.gz", "mrms")
            if not fresh(stamp, kind="mrms", now=now):
                continue
            if store.has(product, stamp):
                continue
            try:
                raw = noaa.mrms_bytes(time_label)
                image = mrms_grib2_gz(raw, REGIONS["east"])
                store.put(product, stamp, image, REGIONS["east"], "NOAA MRMS native GRIB2 reflectivity")
                successes.append(stamp)
            except Exception:
                LOG.exception("NOAA MRMS native decode failed at %s", time_label)
            if len(successes) >= limit:
                break
    elif (match := GOES.fullmatch(product)):
        region, sector, channel = match.groups()
        for bucket, key, stamp in goes_candidates(noaa, product, now):
            if store.has(product, stamp):
                continue
            try:
                raw = noaa.read_s3(bucket, key)
                with tempfile.TemporaryDirectory(prefix="wx_abi_") as tmp:
                    filename = Path(tmp) / "scan.nc"
                    filename.write_bytes(raw)
                    image, scan_bbox = goes_abi_netcdf(
                        filename, channel, None if sector.startswith("meso") else REGIONS[region]
                    )
                store.put(product, stamp, image, scan_bbox,
                          f"NOAA GOES-{19 if region == 'east' else 18} ABI {channel} NetCDF4")
                successes.append(stamp)
            except ValueError as e:
                if "does not intersect" not in str(e):
                    LOG.warning("GOES scan skipped %s: %s", key, e)
            except Exception:
                LOG.exception("GOES NetCDF decode failed %s", key)
            if len(successes) >= limit:
                break
    elif (match := NEXRAD.fullmatch(product)):
        moment, site = match.groups()
        for bucket, key, stamp in nexrad_candidates(noaa, site, now):
            if store.has(product, stamp):
                continue
            try:
                raw = noaa.read_s3(bucket, key)
                with tempfile.TemporaryDirectory(prefix="wx_l2_") as tmp:
                    filename = Path(tmp) / ("radar.ar2v")
                    filename.write_bytes(raw)
                    image, bbox = nexrad_level2(filename, site, moment)
                store.put(product, stamp, image, bbox,
                          f"NOAA/Unidata NEXRAD Level II {site} {moment}; lowest sweep")
                successes.append(stamp)
            except Exception:
                LOG.exception("NEXRAD Level II volume decode failed %s", key)
            if len(successes) >= limit:
                break
    else:
        raise ValueError(f"Product {product!r} is not a source-native implemented decoder")
    return successes


def run(products=None, *, once=False, interval=120, root=None):
    product_list = products or os.getenv("WX_PROCESSOR_PRODUCTS", DEFAULT_PRODUCTS).split(",")
    product_list = [p.strip() for p in product_list if p.strip()]
    for p in product_list:
        if p != MRMS and not GOES.fullmatch(p) and not NEXRAD.fullmatch(p):
            raise ValueError("Unsupported product " + p)
    store = FrameStore(Path(root or os.getenv("WX_PROCESSOR_DATA_DIR", "./wx-frames")))
    noaa = PublicNoaa()
    while True:
        for product in product_list:
            try:
                published = ingest_product(noaa, store, product)
                if published:
                    LOG.info("%s: published real NOAA frames %s", product, published)
            except Exception:
                LOG.exception("NOAA discovery error for %s; no fabricated frames", product)
        store.prune(older_than_hours=12)
        if once:
            break
        time.sleep(max(60, interval))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Decode live NOAA observations to WX Studio frames")
    parser.add_argument("--once", action="store_true", help="Check current files once then stop")
    parser.add_argument("--interval", type=int, default=120, help="Seconds between discovery checks")
    parser.add_argument("--products", default="", help="Comma-separated verified decoder product IDs")
    parser.add_argument("--data-dir", default="", help="Persistent local frame directory")
    parser.add_argument("--verbose", action="store_true")
    opts = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if opts.verbose else logging.INFO)
    run(products=opts.products.split(",") if opts.products else None,
        once=opts.once, interval=opts.interval, root=opts.data_dir or None)
