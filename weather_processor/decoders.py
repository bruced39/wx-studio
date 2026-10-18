"""Source-native NOAA scientific decoders to georeferenced PNG overlays.

This module never fabricates observations or upsamples a low-resolution feed
and calls it native. GOES NetCDF, MRMS GRIB2, and NEXRAD Level II are decoded
with dedicated scientific libraries, then transformed onto an output grid.
Each overlay always carries the observation timestamp from its source.
"""
from __future__ import annotations

import gzip
import json
import math
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import CRS, Geod, Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject

PALETTE_DIR = Path(__file__).parent / "palettes"
MAX_PIXELS = 16_000_000


def palette(name: str) -> dict:
    if not name or "/" in name or ".." in name:
        raise ValueError("Palette name must be a local basename")
    value = json.loads((PALETTE_DIR / (name + ".json")).read_text(encoding="utf-8"))
    stops = value.get("stops")
    if not isinstance(stops, list) or len(stops) < 2:
        raise ValueError("Palette needs at least two stops")
    last = -float("inf")
    for v, col in stops:
        if not np.isfinite(v) or v <= last or not isinstance(col, str) or not (
            len(col) == 7 and col.startswith("#")
        ):
            raise ValueError("Invalid color stop")
        last = v
    return value


def rgba(values: np.ndarray, table: dict, *, good=None) -> np.ndarray:
    data = np.asarray(values, dtype=np.float32)
    valid = np.isfinite(data)
    if good is not None:
        valid &= np.asarray(good, dtype=bool)
    stops = table["stops"]
    thresholds = np.array([float(x[0]) for x in stops], dtype=np.float32)
    colors = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for _, h in stops], dtype=np.uint8)
    out = np.zeros(data.shape + (4,), dtype=np.uint8)
    flat = np.nan_to_num(data, nan=-1e9)
    if table.get("continuous"):
        for ch in range(3):
            out[..., ch] = np.interp(flat, thresholds, colors[:, ch]).astype(np.uint8)
    else:
        ix = np.clip(np.searchsorted(thresholds, flat, side="right") - 1, 0, len(stops) - 1)
        out[..., :3] = colors[ix]
    out[..., 3] = np.where(valid & (data >= thresholds[0]), 255, 0).astype(np.uint8)
    return out


def size_for_bbox(bbox, resolution_degrees: float) -> tuple[int, int]:
    w, s, e, n = (float(x) for x in bbox)
    if not (-180 <= w < e <= 180 and -85 <= s < n <= 85):
        raise ValueError("Invalid WGS84 bounds (antimeridian wrapping is not supported)")
    if not 0 < resolution_degrees <= 0.25:
        raise ValueError("Invalid target resolution")
    width, height = math.ceil((e - w) / resolution_degrees), math.ceil((n - s) / resolution_degrees)
    if not (width > 0 and height > 0 and width * height <= MAX_PIXELS):
        raise ValueError("Requested frame exceeds safe memory budget; split into geographic tiles")
    return width, height


def geographic_grid(data: np.ndarray, src_transform, src_crs, bbox, resolution_degrees,
                    *, resampling=Resampling.nearest) -> np.ndarray:
    width, height = size_for_bbox(bbox, resolution_degrees)
    w, s, e, n = bbox
    dest = np.full((height, width), np.nan, dtype=np.float32)
    reproject(
        source=np.asarray(data, dtype=np.float32),
        destination=dest,
        src_transform=src_transform,
        src_crs=src_crs,
        src_nodata=np.nan,
        dst_transform=from_origin(w, n, (e - w) / width, (n - s) / height),
        dst_crs="EPSG:4326",
        dst_nodata=np.nan,
        resampling=resampling,
        num_threads=2,
        init_dest_nodata=True,
    )
    return dest


def goes_abi_netcdf(path: Path, channel: str, bbox, *, resolution=None):
    """GOES-19/18 ABI L2 CMIP fixed grid -> WGS84; C02 reflectance or C13 IR BT.

    Respects per-file fixed-grid projection and each moving mesoscale domain.
    Imagery outside the sector or Earth's limb is transparent. Never infer
    that 0.5 km visible data are available for a thermal-IR channel.
    """
    import xarray as xr

    if channel not in ("C02", "C13"):
        raise ValueError("Only native visible C02 and thermal C13 are implemented")
    native_step = 0.005 if channel == "C02" else 0.02
    requested = native_step if resolution is None else float(resolution)
    if requested < native_step:
        raise ValueError("Will not invent finer-than-native pixels")
    with xr.open_dataset(path, engine="h5netcdf", mask_and_scale=True) as ds:
        if "CMI" not in ds or "goes_imager_projection" not in ds:
            raise ValueError("Not a NOAA GOES ABI L2 CMIP NetCDF scan")
        geo = ds["goes_imager_projection"].attrs
        h = float(geo["perspective_point_height"])
        lon0 = float(geo["longitude_of_projection_origin"])
        a = float(geo["semi_major_axis"])
        b = float(geo["semi_minor_axis"])
        sweep = geo.get("sweep_angle_axis", "x")
        if sweep not in ("x", "y"):
            raise ValueError("Invalid ABI sweep axis")
        crs = CRS.from_proj4(
            f"+proj=geos +lon_0={lon0} +h={h} +a={a} +b={b} +sweep={sweep} +units=m +no_defs"
        )
        x = np.asarray(ds["x"].values, dtype=np.float64) * h
        y = np.asarray(ds["y"].values, dtype=np.float64) * h
        if not (len(x) > 1 and len(y) > 1 and np.all(np.diff(x) > 0)):
            raise ValueError("Unexpected ABI fixed-grid x order")
        values = np.asarray(ds["CMI"].values, dtype=np.float32)
        if y[0] < y[-1]:
            values = values[::-1]
            y = y[::-1]
        src_transform = from_origin(
            x[0] - (x[1] - x[0]) / 2,
            y[0] + (y[0] - y[1]) / 2,
            abs(x[1] - x[0]),
            abs(y[1] - y[0]),
        )
        if "DQF" in ds:
            # NOAA DQF: 0=good, 1=conditionally usable, >=2 bad/missing.
            quality = np.asarray(ds["DQF"].values) <= 1
            if quality.shape == values.shape:
                if np.asarray(ds["y"].values)[0] < np.asarray(ds["y"].values)[-1]:
                    quality = quality[::-1]
                values = np.where(quality, values, np.nan)
        # Reject domains outside the actual sector. This is especially
        # important for one-minute mesoscale boxes that move with events.
        tx = Transformer.from_crs(CRS.from_epsg(4326), crs, always_xy=True)
        west, south, east, north = bbox
        sample_lon = np.linspace(west, east, 13)
        sample_lat = np.linspace(south, north, 13)
        llon, llat = np.meshgrid(sample_lon, sample_lat)
        gx, gy = tx.transform(llon, llat)
        valid = np.isfinite(gx) & np.isfinite(gy) & (gx >= min(x)) & (gx <= max(x)) & (gy >= min(y)) & (gy <= max(y))
        if not valid.any():
            raise ValueError("Requested region does not intersect this ABI scan footprint")
        product = geographic_grid(values, src_transform, crs, bbox, requested, resampling=Resampling.bilinear)
    if channel == "C02":
        # Reflectance factor: single-channel visible grayscale, NO LUT.
        reflectance = np.clip(product, 0, 1)
        gray = np.uint8(255 * np.sqrt(reflectance))
        out = np.zeros(gray.shape + (4,), dtype=np.uint8)
        out[..., :3] = gray[..., None]
        out[..., 3] = np.where(np.isfinite(product), 255, 0).astype(np.uint8)
        return Image.fromarray(out, "RGBA")
    # ABI CMI C13 is brightness temperature in kelvin, not "cloud tops".
    return Image.fromarray(rgba(product - 273.15, palette("satellite-ir-c13")), "RGBA")


def mrms_grib2_gz(payload: bytes, bbox, *, resolution=0.01):
    """Decode a native NOAA MRMS GRIB2.gz reflectivity field, not ImageServer PNG."""
    import xarray as xr

    if payload[:2] != b"\x1f\x8b":
        raise ValueError("MRMS response is not gzip GRIB2")
    with tempfile.TemporaryDirectory(prefix="wx_mrms_") as tmp:
        path = Path(tmp) / "scan.grib2"
        with path.open("wb") as out:
            # Use stdlib gzip and a strict decompression cap against damaged files.
            uncompressed = gzip.decompress(payload)
            if len(uncompressed) > 120_000_000 or uncompressed[:4] != b"GRIB":
                raise ValueError("MRMS payload not a reasonable GRIB2 field")
            out.write(uncompressed)
        ds = xr.open_dataset(path, engine="cfgrib", backend_kwargs={"indexpath": ""})
        try:
            variables = [v for v in ds.data_vars if getattr(ds[v], "ndim", 0) >= 2]
            if not variables:
                raise ValueError("No two-dimensional reflectivity variable")
            da = ds[variables[0]].squeeze(drop=True)
            if da.ndim != 2:
                raise ValueError("Unexpected MRMS GRIB geometry")
            field = np.asarray(da.values, dtype=np.float32)
            latitude = np.asarray(ds["latitude"].values)
            longitude = np.asarray(ds["longitude"].values)
            if latitude.ndim != 1 or longitude.ndim != 1:
                raise ValueError("MRMS product is not a geographic regular grid")
            longitude = np.where(longitude > 180, longitude - 360, longitude)
            if longitude[0] > longitude[-1]:
                longitude = longitude[::-1]
                field = field[:, ::-1]
            if latitude[0] < latitude[-1]:
                latitude = latitude[::-1]
                field = field[::-1, :]
            dy = abs(float(latitude[1] - latitude[0]))
            dx = abs(float(longitude[1] - longitude[0]))
            transform = from_origin(longitude[0] - dx / 2, latitude[0] + dy / 2, dx, dy)
            data = geographic_grid(field, transform, "EPSG:4326", bbox, float(resolution))
        finally:
            ds.close()
    return Image.fromarray(rgba(data, palette("radar-reflectivity")), "RGBA")


def nexrad_level2(path: Path, radar_site: str, moment: str, bbox=None, *, resolution=0.003):
    """Lowest elevation native Level-II polar gates -> sampled WGS84 2-D image.

    Nearest ray/gate sampling preserves native measured values (no invented
    1-km reflectivity mosaic). No velocity dealiasing is claimed.
    """
    import pyart

    if moment not in ("reflectivity", "velocity"):
        raise ValueError("Unsupported NEXRAD moment")
    radar = pyart.io.read_nexrad_archive(str(path))
    if moment not in radar.fields:
        raise ValueError("Moment not available in this radar volume")
    if radar.nsweeps < 1:
        raise ValueError("No radar sweeps")
    start, end = int(radar.sweep_start_ray_index["data"][0]), int(radar.sweep_end_ray_index["data"][0]) + 1
    azimuth = np.asarray(radar.azimuth["data"][start:end], dtype=np.float64) % 360
    if len(azimuth) < 100:
        raise ValueError("Incomplete Level II sweep")
    order = np.argsort(azimuth)
    az = azimuth[order]
    gates = np.ma.asarray(radar.fields[moment]["data"][start:end, :])
    gate_values = np.asarray(gates.filled(np.nan), dtype=np.float32)[order]
    ranges = np.asarray(radar.range["data"], dtype=np.float64)
    if len(ranges) < 2:
        raise ValueError("Missing radar gate ranges")
    spacing = float(np.median(np.diff(ranges)))
    if spacing <= 0:
        raise ValueError("Invalid range gates")
    longitude = float(radar.longitude["data"][0])
    latitude = float(radar.latitude["data"][0])
    geod = Geod(ellps="WGS84")
    max_range = float(ranges[-1])
    if bbox is None:
        lon_pts, lat_pts, _ = geod.fwd(
            np.full(8, longitude), np.full(8, latitude),
            np.arange(0, 360, 45), np.full(8, max_range)
        )
        bbox = [max(-180, float(min(lon_pts))), max(-85, float(min(lat_pts))),
                min(180, float(max(lon_pts))), min(85, float(max(lat_pts)))]
    width, height = size_for_bbox(bbox, float(resolution))
    west, south, east, north = bbox
    output = np.full((height, width), np.nan, dtype=np.float32)
    lon_vec = west + (np.arange(width) + 0.5) * (east - west) / width
    for row0 in range(0, height, 128):
        rows = min(128, height - row0)
        lat_vec = north - (row0 + np.arange(rows) + 0.5) * (north - south) / height
        llon, llat = np.meshgrid(lon_vec, lat_vec)
        forward, _, distance = geod.inv(
            np.full(llon.shape, longitude), np.full(llat.shape, latitude), llon, llat
        )
        az_target = np.mod(forward, 360)
        ri = np.searchsorted(az, az_target) % len(az)
        prev = (ri - 1) % len(az)
        clockwise = np.mod(az[ri] - az_target, 360)
        counter = np.mod(az_target - az[prev], 360)
        nearest_ray = np.where(clockwise <= counter, ri, prev)
        gate = np.rint((distance - ranges[0]) / spacing).astype(np.int64)
        inside = (distance <= max_range) & (gate >= 0) & (gate < gate_values.shape[1])
        block = np.full(llon.shape, np.nan, dtype=np.float32)
        block[inside] = gate_values[nearest_ray[inside], gate[inside]]
        output[row0:row0 + rows] = block
    table = palette("radar-reflectivity" if moment == "reflectivity" else "radar-velocity")
    return Image.fromarray(rgba(output, table), "RGBA"), bbox
