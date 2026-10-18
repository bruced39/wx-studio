"""Bounded, read-only HTTPS-ready frame/manifest service for a separate NOAA worker.

Runs independently from Streamlit. It serves ONLY decoder-created PNGs, never
accepts arbitrary URLs/paths or claims stale observations are live. Production:
place behind HTTPS reverse proxy with a persistent rolling frame directory.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

PRODUCT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{1,99}$")
STAMP = re.compile(r"^[0-9]{13}\.png$")
SCHEMA = "wxstudio.frames.v1"
MAX_FRAMES = 180
MAX_IMAGE_BYTES = 25_000_000


def clean_product(text: str) -> str:
    if not PRODUCT.fullmatch(text):
        raise ValueError("Invalid product")
    return text


def frames_for(root: Path, product: str, base: str, *, max_age_minutes=90, now_ms=None) -> dict | None:
    """Return only complete, fresh, validated frame records with absolute URLs."""
    product = clean_product(product)
    directory = root / product
    manifest = directory / "manifest.json"
    if not manifest.is_file() or manifest.stat().st_size > 1_000_000:
        return None
    try:
        data = json.loads(manifest.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    if data.get("schema") != SCHEMA or data.get("product") != product:
        return None
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000) if now_ms is None else now_ms
    out = []
    for row in data.get("frames", [])[-MAX_FRAMES:]:
        if not isinstance(row, dict):
            continue
        ts, box = row.get("t"), row.get("bbox")
        if not isinstance(ts, int) or isinstance(ts, bool) or not isinstance(box, list) or len(box) != 4:
            continue
        if not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in box):
            continue
        if not (-180 <= box[0] < box[2] <= 180 and -85 <= box[1] < box[3] <= 85):
            continue
        name = str(row.get("url", "")).removeprefix("frames/")
        if not STAMP.fullmatch(name) or row.get("url") != "frames/" + name or int(name[:-4]) != ts:
            continue
        file = directory / "frames" / name
        if not file.is_file() or file.stat().st_size > MAX_IMAGE_BYTES:
            continue
        if row.get("crs") != "4326":
            continue
        out.append({"t": ts, "bbox": box, "crs": "4326",
                    "url": base.rstrip("/") + "/frames/" + product + "/" + name})
    out.sort(key=lambda f: f["t"])
    if not out:
        return None
    latest = out[-1]["t"]
    age = (now_ms - latest) / 60000
    if age > max_age_minutes or age < -10:
        return None
    return {"schema": SCHEMA, "source": data.get("source"), "product": product,
            "frames": out, "nativeResolutionMetres": data.get("nativeResolutionMetres"),
            "latestObservationUtc": datetime.fromtimestamp(latest / 1000, timezone.utc).isoformat(),
            "frameCount": len(out), "attribution": data.get("attribution", "NOAA/Unidata"),
            "status": "available"}


def catalog(root: Path, base: str, *, max_age_minutes=90, now_ms=None) -> dict:
    available = []
    if root.is_dir():
        for entry in sorted(root.iterdir()):
            if entry.is_dir() and PRODUCT.fullmatch(entry.name):
                result = frames_for(root, entry.name, base, max_age_minutes=max_age_minutes,
                                    now_ms=now_ms)
                if result:
                    available.append({k: result[k] for k in ("source", "product", "frameCount",
                                                              "latestObservationUtc", "nativeResolutionMetres")})
    return {"schema": SCHEMA, "status": "ready" if available else "no-fresh-data",
            "products": available}


def make_handler(root: Path, *, public_base="", allowed_origin="*", max_age_minutes=90):
    root = root.resolve()
    class Handler(BaseHTTPRequestHandler):
        def send_headers(self, code, content_type, size=0, cache="no-store"):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.send_header("Cache-Control", cache)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(size))
            self.end_headers()

        def do_OPTIONS(self):
            self.send_headers(204, "text/plain")
        def do_HEAD(self):
            self.respond(head_only=True)
        def do_GET(self):
            self.respond(head_only=False)
        def respond(self, head_only=False):
            path = urlsplit(self.path).path
            base = public_base.rstrip("/") or (
                ("https" if self.headers.get("X-Forwarded-Proto") == "https" else "http")
                + "://" + self.headers.get("Host", "127.0.0.1"))
            if path == "/health":
                obj = {"service": "WX Studio NOAA processing", "status": "ok",
                       "mode": "read-only", "liveData": catalog(root, base, max_age_minutes=max_age_minutes)["status"]}
                return self.send_json(obj, head_only)
            if path == "/catalog":
                return self.send_json(catalog(root, base, max_age_minutes=max_age_minutes), head_only)
            match = re.fullmatch(r"/manifests/([A-Za-z0-9-]{2,100})\.json", path)
            if match:
                obj = frames_for(root, match[1], base, max_age_minutes=max_age_minutes)
                return self.send_json(obj, head_only, status=200 if obj else 404)
            match = re.fullmatch(r"/frames/([A-Za-z0-9-]{2,100})/([0-9]{13}\.png)", path)
            if match:
                product, filename = match.groups()
                source = frames_for(root, product, base, max_age_minutes=max_age_minutes)
                if not source or not any(f["t"] == int(filename[:-4]) for f in source["frames"]):
                    return self.send_json({"error": "no current validated frame"}, head_only, 404)
                file = root / product / "frames" / filename
                data = file.read_bytes()
                self.send_headers(200, "image/png", len(data), "public, max-age=60")
                if not head_only:
                    self.wfile.write(data)
                return
            self.send_json({"error": "not found"}, head_only, 404)
        def send_json(self, value, head_only=False, status=200):
            payload = json.dumps(value if value is not None else {"error": "not available"}).encode()
            self.send_headers(status, "application/json; charset=utf-8", len(payload))
            if not head_only:
                self.wfile.write(payload)

    return Handler


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", default=os.environ.get("WX_WEATHER_FRAME_ROOT", "wx_weather_output"))
    ap.add_argument("--host", default="127.0.0.1",
                    help="bind 0.0.0.0 ONLY behind TLS reverse proxy")
    ap.add_argument("--port", type=int, default=8788)
    ap.add_argument("--public-base", default=os.environ.get("WX_WEATHER_PUBLIC_BASE_URL", ""))
    ap.add_argument("--cors-origin", default=os.environ.get("WX_WEATHER_CORS_ORIGIN", "*"))
    ap.add_argument("--max-age-minutes", type=int, default=90)
    a = ap.parse_args(argv)
    srv = ThreadingHTTPServer((a.host, a.port), make_handler(
        Path(a.root), public_base=a.public_base, allowed_origin=a.cors_origin,
        max_age_minutes=a.max_age_minutes))
    print(f"NOAA manifest service: {a.host}:{a.port} (no processing jobs inside HTTP handlers)")
    srv.serve_forever()


if __name__ == "__main__":
    main()
