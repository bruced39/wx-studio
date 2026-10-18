"""Public, read-only frames API for WX Studio.

Serve on a separate scientific-processing host (NOT Streamlit).
Set WX_WEATHER_PROCESSOR_URL in Streamlit secrets to this service's HTTPS URL
only after the ingest worker has published fresh native NOAA products.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .store import FrameStore, validate_product

ROOT = Path(os.environ.get("WX_PROCESSOR_DATA_DIR", "./wx-frames"))
STORE = FrameStore(ROOT)
APP = FastAPI(title="WX Studio native NOAA processor", version="1.0.0", docs_url=None, redoc_url=None)
# NOAA imagery and catalog are public data with no user secrets. The site has
# no unauthenticated processing/upload API. CORS must work in Streamlit iframe.
APP.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


@APP.get("/health")
def health():
    active = STORE.active()
    return {"service": "wxstudio-noaa-native", "status": "ready" if active else "waiting-for-real-noaa-frames",
            "freshProducts": len(active), "scientificDecoding": True}


@APP.get("/catalog")
def catalog():
    return {"schema": "wxstudio.frames.v1", "products": STORE.active(),
            "disclaimer": "Only actual decoded NOAA scans with fresh observations are listed."}


@APP.get("/manifests/{product}.json")
def manifest(product: str, request: Request):
    try:
        validate_product(product)
    except ValueError:
        raise HTTPException(404, "Unknown product") from None
    active = {p["product"] for p in STORE.active()}
    if product not in active:
        raise HTTPException(404, "No fresh decoded observations for this product")
    origin = str(request.base_url).rstrip("/")
    records = STORE.listed(product)
    frames = [{"t": x["t"], "bbox": x["bbox"], "crs": x["crs"],
               "url": f"{origin}/frames/{product}/{x['t']}.png"}
              for x in records]
    return {"schema": "wxstudio.frames.v1", "product": product, "frames": frames,
            "source": records[-1]["source"] if records else "NOAA"}


@APP.get("/frames/{product}/{timestamp}.png")
def frame(product: str, timestamp: str):
    try:
        validate_product(product)
        if not timestamp.isdigit() or len(timestamp) != 13:
            raise ValueError("Invalid observation time")
    except ValueError:
        raise HTTPException(404, "Unknown frame") from None
    filename = STORE.directory(product) / (timestamp + ".png")
    if not filename.is_file() or not filename.with_suffix(".json").is_file():
        raise HTTPException(404, "NOAA scan not available")
    return FileResponse(filename, media_type="image/png", headers={
        "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff"
    })
