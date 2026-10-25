"""Decode ORIGINAL NOAA/Unidata science files into geo-referenced transparent RGBA.

Optional worker-only dependencies: numpy, Pillow, pyproj, rasterio, xarray,
h5netcdf, pygrib/eccodes (MRMS), arm_pyart + scipy (NEXRAD Level II).
NO decimation of raw GOES/Level-II source fields. The requested display ROI
is cropped BEFORE geographical reprojection. Native resolution is preserved
up to the chosen geographic output pixel footprint.

This is a processing worker, NOT a claim of a live WX Studio provider.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import math

import numpy as np
from PIL import Image

BBox = tuple[float, float, float, float]

# Editable starter scales: not asserted to be NOAA's certified official LUT.
RADAR = [(-5, (0, 0, 0, 0)), (5, (55, 180, 80, 160)),
         (15, (0, 170, 90, 235)), (25, (245, 235, 45, 255)),
         (35, (255, 145, 30, 255)), (45, (235, 45, 45, 255)),
         (55, (185, 40, 190, 255)), (75, (240, 205, 240, 255))]
VELOCITY = [(-60, (80, 10, 120, 255)), (-30, (30, 100, 210, 255)),
            (-5, (140, 220, 250, 255)), (0, (220, 220, 220, 220)),
            (5, (255, 225, 120, 255)), (30, (240, 75, 45, 255)),
            (60, (145, 0, 25, 255))]
IR_CELSIUS = [(-100, (255, 250, 255, 255)), (-75, (195, 60, 225, 255)),
              (-60, (230, 75, 40, 255)), (-45, (245, 220, 60, 255)),
              (-30, (75, 190, 110, 255)), (-15, (80, 145, 230, 255)),
              (0, (185, 190, 190, 255)), (35, (20, 25, 40, 0))]


@dataclass
class Frame:
    pixels: np.ndarray  # uint8 RGBA, north-up
    bbox: BBox            # west,south,east,north WGS84
    timestamp: datetime   # must be timezone aware
    product: str
    native_resolution_m: float

    def save(self, path: str | Path) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(self.pixels, "RGBA").save(p, format="PNG")


def rgba(values, stops, *, valid=None, min_echo=None) -> np.ndarray:
    """Linear LUT on a 2D scalar, missing/no-echo and masked cells transparent."""
    arr = np.ma.asarray(values, dtype=np.float32)   # float first: NumPy 2 refuses a NaN fill on integer data
    a = np.asarray(arr.filled(np.nan), dtype=np.float32)
    if a.ndim != 2:
        raise ValueError("Expected 2D geophysical field")
    stops = sorted(stops, key=lambda x: x[0])
    if len(stops) < 2 or any(stops[i][0] >= stops[i + 1][0]
                             for i in range(len(stops) - 1)):
        raise ValueError("Palette stops must be strictly increasing")
    finite = np.isfinite(a) & ~np.ma.getmaskarray(arr)
    if valid is not None:
        finite &= np.asarray(valid, dtype=bool)
    if min_echo is not None:
        finite &= a >= min_echo
    safe = np.where(finite, a, stops[0][0])
    out = np.empty((*a.shape, 4), dtype=np.uint8)
    xp = [s[0] for s in stops]
    for band in range(4):
        out[..., band] = np.clip(np.interp(safe, xp, [s[1][band] for s in stops]), 0, 255).astype("uint8")
    out[~finite] = (0, 0, 0, 0)
    return out


def _dims(bbox: BBox, metres: float, max_pixels: int) -> tuple[int, int]:
    w, s, e, n = bbox
    if not (-180 <= w < e <= 180 and -85 <= s < n <= 85):
        raise ValueError("Provide WGS84 [west south east north] in non-wrapping extent")
    if not 100 <= metres <= 10000:
        raise ValueError("Pixel resolution must be 100–10000 metres")
    lat = (s + n) / 2
    width = int(math.ceil((e-w)*111320*math.cos(math.radians(lat))/metres))
    height = int(math.ceil((n-s)*111320/metres))
    width, height = max(1, width), max(1, height)
    if width*height > max_pixels:
        raise ValueError(f"Output {width}×{height} exceeds {max_pixels:,} pixels; choose smaller bbox, not hidden downsampling")
    return width, height


def _stamp(raw: str) -> datetime:
    from datetime import datetime
    return datetime.fromisoformat(str(raw).strip().replace("Z", "+00:00")).astimezone(timezone.utc)


def decode_goes(path: str | Path, bbox: BBox, *, band: str = "C02",
                max_pixels: int = 12_000_000) -> Frame:
    """ABI-L2-CMIP netCDF4 CMI: C02 visible 0.5km, C13 clean IR 2km.

    Uses true GOES fixed-grid projection x/y * perspective height, NOT an
    incorrect linear lat/lon stretch. Only ABI individual-band CMI products
    are accepted here. GeoColor requires a separate multichannel algorithm.
    """
    if band not in ("C02", "C13"):
        raise ValueError("First native ABI decoder supports C02 and C13 only")
    import xarray as xr
    from pyproj import CRS, Transformer
    from rasterio.enums import Resampling
    from rasterio.transform import Affine, from_bounds
    from rasterio.warp import reproject

    with xr.open_dataset(path, engine="h5netcdf", mask_and_scale=True) as ds:
        if "CMI" not in ds or "goes_imager_projection" not in ds:
            raise ValueError("Not an ABI single-band CMI NetCDF file")
        prod = str(ds.attrs.get("dataset_name", Path(path).name))
        if "MCMIP" in prod:
            raise ValueError("Multichannel MCMIP is not a single-band CMI image")
        t = _stamp(ds.attrs["time_coverage_start"])
        proj = ds["goes_imager_projection"].attrs
        h = float(proj["perspective_point_height"])
        native_m = 500 if band == "C02" else 2000
        geos = CRS.from_proj4(
            f"+proj=geos +lon_0={float(proj['longitude_of_projection_origin'])}"
            f" +h={h} +sweep={proj.get('sweep_angle_axis','x')}"
            f" +a={float(proj['semi_major_axis'])} +b={float(proj['semi_minor_axis'])} +units=m +no_defs")
        # Sample the ENTIRE ROI perimeter, not just the corners, because
        # geostationary limbs/scan lines are curved in lon/lat space.
        w, s, e, n = bbox
        lons = np.linspace(w, e, 24)
        lats = np.linspace(s, n, 24)
        lonp = np.concatenate((lons, lons, np.full(24,w), np.full(24,e)))
        latp = np.concatenate((np.full(24,s), np.full(24,n), lats, lats))
        xx, yy = Transformer.from_crs("EPSG:4326", geos, always_xy=True).transform(lonp, latp)
        valid = np.isfinite(xx) & np.isfinite(yy)
        if not valid.any():
            raise ValueError("Requested ROI is outside this GOES satellite view")
        xm, xM = min(xx[valid]), max(xx[valid])
        ym, yM = min(yy[valid]), max(yy[valid])
        x = np.asarray(ds.x.values)*h
        y = np.asarray(ds.y.values)*h
        if not (np.all(np.diff(x)>0) and np.all(np.diff(y)<0)):
            raise ValueError("Unsupported GOES x/y axis order; refusing silent map flip")
        ix = np.flatnonzero((x>=xm) & (x<=xM))
        iy = np.flatnonzero((y>=ym) & (y<=yM))
        if not len(ix) or not len(iy):
            raise ValueError("GOES CMI scan does not cover ROI")
        # Small padding prevents nearest-resampling blank seams on bbox edges.
        i0, i1 = max(0,ix[0]-2), min(len(x),ix[-1]+3)
        j0, j1 = max(0,iy[0]-2), min(len(y),iy[-1]+3)
        if (i1-i0)*(j1-j0)>max_pixels*5:
            raise ValueError("GOES source ROI too large to process within memory budget")
        src = np.asarray(ds["CMI"].isel(y=slice(j0,j1),x=slice(i0,i1)).values, dtype="float32")
        if src.ndim != 2:
            raise ValueError("Expected one scalar CMI band, not a multiband composite")
        dx, dy = float(x[1]-x[0]), float(y[1]-y[0])
        transform = Affine(dx,0,float(x[i0]-dx/2),0,dy,float(y[j0]-dy/2))
        out_w, out_h = _dims(bbox,native_m,max_pixels)
        target = np.full((out_h,out_w),np.nan,dtype="float32")
        reproject(source=src,destination=target,src_transform=transform,src_crs=geos,
                  src_nodata=np.nan,dst_transform=from_bounds(*bbox,out_w,out_h),
                  dst_crs="EPSG:4326",dst_nodata=np.nan,resampling=Resampling.nearest)
    valid = np.isfinite(target)
    if band=="C02":
        brightness=np.asarray(np.clip(target,0,1)**.58*255,dtype="uint8")
        output=np.empty((*target.shape,4),dtype="uint8")
        output[:,:,:3]=brightness[:,:,None]
        output[:,:,3]=np.where(valid,255,0).astype("uint8")
    else:
        output=rgba(target-273.15,IR_CELSIUS,valid=valid)
    return Frame(output,bbox,t,band,native_m)


def crop_regular_grid(field, lons, lats, bbox:BBox) -> tuple[np.ndarray,BBox]:
    """Lossless MRMS regular-latlon crop, pixel centers to WGS84 bounds."""
    w,s,e,n=bbox
    arr=np.ma.asarray(field)
    lon=np.asarray(lons).ravel()
    lat=np.asarray(lats).ravel()
    if arr.shape!=(lat.size,lon.size):
        raise ValueError("GRIB2 coordinates are not 1-D regular lat/lon")
    lon=np.where(lon>180,lon-360,lon)
    ii=np.flatnonzero((lon>=w)&(lon<=e))
    jj=np.flatnonzero((lat>=s)&(lat<=n))
    if not len(ii) or not len(jj):
        raise ValueError("MRMS grid does not cover requested region")
    # Regular latlon grid: source axes are monotonic in either direction.
    if not (np.all(np.diff(lon)>0) or np.all(np.diff(lon)<0)):
        raise ValueError("MRMS source crosses antimeridian or is irregular")
    if not (np.all(np.diff(lat)>0) or np.all(np.diff(lat)<0)):
        raise ValueError("MRMS latitude order not monotonic")
    cropped=arr[np.ix_(jj,ii)]
    x=lon[ii]
    y=lat[jj]
    if x[0]>x[-1]: cropped=cropped[:,::-1];x=x[::-1]
    if y[0]<y[-1]: cropped=cropped[::-1,:];y=y[::-1]
    dx=abs(float(np.median(np.diff(x)))) if len(x)>1 else .01
    dy=abs(float(np.median(np.diff(y)))) if len(y)>1 else .01
    return cropped,(float(x[0]-dx/2),float(y[-1]-dy/2),
                    float(x[-1]+dx/2),float(y[0]+dy/2))


def decode_mrms(path:str|Path,bbox:BBox,*,max_pixels:int=12_000_000)->Frame:
    """Native regular-grid MRMS GRIB2 reflectivity via ecCodes/pygrib."""
    import pygrib
    # pygrib.open() exposes close(), but is not guaranteed to implement
    # Python's with-context-manager protocol on every ecCodes wheel.
    grbs=pygrib.open(str(path))
    try:
        g=grbs.message(1)
        if g.gridType!="regular_ll":
            raise ValueError(f"MRMS grid type {g.gridType!r} is not regular_ll")
        vals=g.values
        ny,nx=vals.shape
        lat=np.linspace(g.latitudeOfFirstGridPointInDegrees,
                        g.latitudeOfLastGridPointInDegrees,ny)
        lon=np.linspace(g.longitudeOfFirstGridPointInDegrees,
                        g.longitudeOfLastGridPointInDegrees,nx)
        subset,actual=crop_regular_grid(vals,lon,lat,bbox)
        if subset.size>max_pixels:
            raise ValueError("MRMS native ROI too large; narrow geographic bbox")
        ts=g.validDate.replace(tzinfo=timezone.utc)
    finally:
        grbs.close()
    # Sentinel fill/no-echo values are never painted black across the map.
    valid=np.ma.filled(np.ma.asarray(subset,dtype="float32"),np.nan)  # float first: NumPy 2 refuses a NaN fill on integer data
    pixels=rgba(subset,RADAR,valid=(valid>-5)&(valid<90),min_echo=-5)
    return Frame(pixels,actual,ts,"MRMS_MergedReflectivityQC",1000)


def decode_level2(path:str|Path,bbox:BBox,*,moment:str="reflectivity",
                  metres:int=250,max_pixels:int=12_000_000)->Frame:
    """NEXRAD Level-II lowest-elevation polar gates, projected 250m WGS84 grid.

    Uses original per-gate lat/lon and masks; no 1km MRMS substitution.
    Nearest physical gate with finite 900m support avoids painted wedges
    in missing/unsampled sectors. This is a PPI, NOT an expensive 3D CAPPI.
    """
    if moment not in ("reflectivity","velocity"):
        raise ValueError("Supported native moments: reflectivity and velocity")
    import pyart
    from pyproj import Transformer, CRS
    from scipy.spatial import cKDTree
    radar=pyart.io.read_nexrad_archive(str(path))
    options=("reflectivity","corrected_reflectivity") if moment=="reflectivity" else ("velocity",)
    name=next((q for q in options if q in radar.fields),None)
    if not name:
        raise ValueError(f"Radar volume does not contain native {moment}")
    w,h=_dims(bbox,metres,max_pixels)
    east,south,west,north=bbox[2],bbox[1],bbox[0],bbox[3]
    # First radar sweep = native lowest tilt (not a vertical composite).
    i0,i1=radar.get_start_end(0)
    values=np.ma.asarray(radar.fields[name]["data"][i0:i1+1])
    lats,lons,_=radar.get_gate_lat_lon_alt(0)
    if values.shape!=lats.shape or values.shape!=lons.shape:
        raise ValueError("Radar gate geometry/data do not align")
    srcvalues=np.ma.filled(np.ma.asarray(values,dtype="float32"),np.nan)
    good=np.isfinite(srcvalues)&(~np.ma.getmaskarray(values))&np.isfinite(lats)&np.isfinite(lons)
    if moment=="reflectivity":good &= srcvalues>=-5
    if not np.any(good):raise ValueError("Selected radar sweep has no valid bins")
    lon0=float(radar.longitude["data"][0])
    lat0=float(radar.latitude["data"][0])
    local=CRS.from_proj4(f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=WGS84 +units=m")
    fwd=Transformer.from_crs("EPSG:4326",local,always_xy=True)
    sx,sy=fwd.transform(lons[good],lats[good])
    tree=cKDTree(np.column_stack((sx,sy)))
    xs=np.linspace(west+(east-west)/(2*w),east-(east-west)/(2*w),w)
    ys=np.linspace(north-(north-south)/(2*h),south+(north-south)/(2*h),h)
    result=np.full((h,w),np.nan,dtype="float32")
    # Chunk by scanlines to avoid allocating tens of millions of point pairs.
    step=max(1,350_000//w)
    bins=srcvalues[good]
    for row in range(0,h,step):
        lony,laty=np.meshgrid(xs,ys[row:row+step])
        xx,yy=fwd.transform(lony,laty)
        dist,idx=tree.query(np.column_stack((xx.ravel(),yy.ravel())),
                            distance_upper_bound=900,workers=1)
        good_idx=np.isfinite(dist)&(idx<len(bins))
        out=result[row:row+step].ravel()
        out[good_idx]=bins[idx[good_idx]]
    pixels=rgba(result,RADAR if moment=="reflectivity" else VELOCITY,
                min_echo=-5 if moment=="reflectivity" else None)
    # radar.time is relative to UTC epoch; use actual volume start time.
    units=radar.time["units"]
    from datetime import timedelta
    base=_stamp(units.split("since ",1)[1].replace(" ","T",1))
    stamp=base+timedelta(seconds=float(radar.time["data"][i0]))
    return Frame(pixels,bbox,stamp,"NEXRAD_LevelII_"+moment,metres)
