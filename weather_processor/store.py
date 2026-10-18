"""Atomic frame storage compatible with studio/weather/processor_bridge.js."""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import tempfile
from pathlib import Path

UTC = dt.timezone.utc
PRODUCT_RE = re.compile(r"^(?:mrms-reflectivity|goes-(?:east|west)-(?:conus|full|meso1|meso2)-C(?:02|13)|nexrad-(?:reflectivity|velocity)-K[A-Z0-9]{3})$")
MAX_MANIFEST_ROWS = 180


def validate_product(product: str) -> str:
    if not PRODUCT_RE.fullmatch(product):
        raise ValueError("Invalid or unsupported NOAA decoder product")
    return product


def epoch_ms(t: dt.datetime) -> int:
    if t.tzinfo is None:
        raise ValueError("Observation timestamp must be timezone-aware UTC")
    return int(t.astimezone(UTC).timestamp() * 1000)


class FrameStore:
    def __init__(self, directory: Path):
        self.root = Path(directory)
        self.root.mkdir(parents=True, exist_ok=True)

    def directory(self, product: str) -> Path:
        return self.root / validate_product(product)

    def paths(self, product: str, stamp: dt.datetime):
        base = self.directory(product) / str(epoch_ms(stamp))
        return base.with_suffix(".png"), base.with_suffix(".json")

    def has(self, product: str, stamp: dt.datetime) -> bool:
        png, meta = self.paths(product, stamp)
        return png.is_file() and meta.is_file()

    def put(self, product: str, stamp: dt.datetime, image, bbox, attribution: str):
        png, meta = self.paths(product, stamp)
        png.parent.mkdir(parents=True, exist_ok=True)
        w, s, e, n = [float(x) for x in bbox]
        if not (-180 <= w < e <= 180 and -85 <= s < n <= 85):
            raise ValueError("Bad WGS84 frame extent")
        if image.mode != "RGBA":
            raise ValueError("Expected georeferenced RGBA image")
        if image.width * image.height > 16_000_000:
            raise ValueError("Refusing oversized frame")
        doc = {"schema": "wxstudio.frames.v1", "t": epoch_ms(stamp),
               "bbox": [w, s, e, n], "crs": "4326", "source": attribution,
               "width": image.width, "height": image.height}
        with tempfile.NamedTemporaryFile(dir=png.parent, suffix=".png", delete=False) as temp:
            tmp_png = Path(temp.name)
        with tempfile.NamedTemporaryFile(dir=png.parent, suffix=".json", delete=False,
                                         mode="w", encoding="utf-8") as temp:
            tmp_meta = Path(temp.name)
        try:
            image.save(tmp_png, format="PNG", optimize=False)
            tmp_meta.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
            # Publish metadata LAST; the catalog never points at partial PNG.
            os.replace(tmp_png, png)
            os.replace(tmp_meta, meta)
        finally:
            tmp_png.unlink(missing_ok=True)
            tmp_meta.unlink(missing_ok=True)
        return doc

    def listed(self, product: str, *, now=None, history_hours=12):
        now = now or dt.datetime.now(UTC)
        lower = epoch_ms(now - dt.timedelta(hours=history_hours))
        upper = epoch_ms(now + dt.timedelta(minutes=10))
        directory = self.directory(product)
        result = []
        if not directory.is_dir():
            return []
        for info in directory.glob("*.json"):
            if not info.stem.isdigit() or len(info.stem) != 13:
                continue
            ms = int(info.stem)
            if ms < lower or ms > upper or not info.with_suffix(".png").is_file():
                continue
            try:
                data = json.loads(info.read_text(encoding="utf-8"))
                if data.get("schema") != "wxstudio.frames.v1" or data.get("t") != ms:
                    continue
                result.append(data)
            except (OSError, ValueError):
                continue
        return sorted(result, key=lambda x: x["t"])[-MAX_MANIFEST_ROWS:]

    def active(self, *, now=None):
        now = now or dt.datetime.now(UTC)
        cutoff = epoch_ms(now - dt.timedelta(minutes=50))
        active = []
        for directory in self.root.iterdir():
            if not directory.is_dir():
                continue
            try:
                validate_product(directory.name)
            except ValueError:
                continue
            frames = self.listed(directory.name, now=now)
            if frames and frames[-1]["t"] >= cutoff:
                active.append({"product": directory.name,
                               "latestObservationUtc": frames[-1]["t"],
                               "frameCount": len(frames),
                               "attribution": frames[-1]["source"]})
        return sorted(active, key=lambda x: x["product"])

    def prune(self, *, older_than_hours=12):
        cutoff = epoch_ms(dt.datetime.now(UTC) - dt.timedelta(hours=older_than_hours))
        for directory in self.root.iterdir():
            if not directory.is_dir():
                continue
            try:
                validate_product(directory.name)
            except ValueError:
                continue
            for path in directory.iterdir():
                if path.suffix not in (".png", ".json"):
                    continue
                if path.stem.isdigit() and int(path.stem) < cutoff:
                    path.unlink(missing_ok=True)
