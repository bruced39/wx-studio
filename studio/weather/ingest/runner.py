"""Bounded NOAA observation scheduler for the dedicated scientific-data host.

Run separately from the HTTP manifest service. No background jobs are started
on Streamlit. Empty/stale/missing NOAA feeds are logged and NOT declared live.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import logging
import os
import time
from pathlib import Path
from types import SimpleNamespace

from .cli import convert

DEFAULT_JOBS = (
    ("goes", "east", "conus", "C02", "KBOX", "reflectivity", "-76,39,-66,46"),
    ("goes", "east", "conus", "C13", "KBOX", "reflectivity", "-76,39,-66,46"),
    ("mrms", "east", "conus", "C02", "KBOX", "reflectivity", "-76,39,-66,46"),
    ("nexrad", "east", "conus", "C02", "KBOX", "reflectivity", "-73,40,-68,44"),
)
LOG = logging.getLogger("wxstudio.noaa.runner")


def run_job(job, root: Path, keep: int, max_pixels: int, max_download_mb: int):
    source, satellite, sector, band, site, moment, bbox = job
    args = SimpleNamespace(source=source, satellite=satellite, sector=sector, band=band,
                           site=site, moment=moment, bbox=bbox,
                           output=str(root), input=None, keep=keep,
                           max_pixels=max_pixels, max_download_mb=max_download_mb,
                           max_age_minutes=90)
    result = convert(args)
    LOG.info("Decoded %s at %s to %s", source, result["utc"], result["frame"])
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=os.environ.get("WX_WEATHER_FRAME_ROOT", "wx_weather_output"))
    parser.add_argument("--interval-seconds", type=int, default=300,
                        help="minimum 120, normal 300; observation cadence is not guaranteed")
    parser.add_argument("--keep", type=int, default=180, help="bounded rolling frame limit per product")
    parser.add_argument("--max-pixels", type=int, default=12_000_000,
                        help="reject oversized requested ROI; never silently reduce source resolution")
    parser.add_argument("--max-download-mb", type=int, default=650)
    parser.add_argument("--once", action="store_true", help="process one polling cycle and exit")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.interval_seconds < 120 or args.keep < 1 or args.keep > 240:
        parser.error("interval >=120 seconds and 1 <= keep <= 240 required")
    jobs = DEFAULT_JOBS
    root = Path(args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    while True:
        began = time.monotonic()
        success = 0
        for job in jobs:
            try:
                result = run_job(job, root, args.keep, args.max_pixels, args.max_download_mb)
                if result:
                    success += 1
            except (Exception,) as e:
                # An unreachable or stale source MUST NOT create fake frames.
                LOG.warning("NOAA %s %s failed: %s", job[0], job[3] if job[0]=="goes" else job[4], e)
        LOG.info("NOAA round completed: %s/%s valid conversions", success, len(jobs))
        if args.once:
            return 0 if success else 2
        time.sleep(max(1, args.interval_seconds-(time.monotonic()-began)))


if __name__ == "__main__":
    raise SystemExit(main())
