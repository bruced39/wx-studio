"""Source-side object discovery for WX Studio's future decoder/renderer.
No libraries, credentials, or paid NOAA feeds required for listing objects.
Does NOT decode NetCDF4, GRIB2, or NEXRAD radar moments; intended for backend.
"""
from __future__ import annotations
import datetime as dt
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Iterable

GOES_BUCKETS = {"east": "noaa-goes19", "west": "noaa-goes18"}
NEXRAD_BUCKET = "unidata-nexrad-level2"
MRMS_LATEST_REFLECTIVITY = (
    "https://mrms.ncep.noaa.gov/2D/MergedReflectivityQC/"
    "MRMS_MergedReflectivityQC.latest.grib2.gz"
)
XML_NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}

def public_s3_keys(bucket: str, prefix: str, max_items: int = 1000) -> list[str]:
    """List keys only. The files are native raw measurements, NOT map overlays."""
    if not bucket.startswith(("noaa-goes", "unidata-nexrad")):
        raise ValueError("Unapproved public NOAA/Unidata bucket")
    max_items = max(1, min(1000, int(max_items)))
    params = urllib.parse.urlencode(
        {"list-type": 2, "prefix": prefix, "max-keys": max_items}
    )
    endpoint = f"https://{bucket}.s3.amazonaws.com/?{params}"
    request = urllib.request.Request(endpoint, headers={"User-Agent": "WXStudio-Weather/1"})
    with urllib.request.urlopen(request, timeout=12) as response:
        root = ET.fromstring(response.read())
    return [node.text for node in root.findall(".//s3:Contents/s3:Key", XML_NS)
            if node.text]

def goes_prefix(product: str, when_utc: dt.datetime) -> str:
    """GOES S3 layout PRODUCT/YYYY/DDD/HH; M1 and M2 share PRODUCT's M prefix."""
    if when_utc.tzinfo is None:
        raise ValueError("Use timezone-aware UTC time")
    names = ("ABI-L2-CMIPC", "ABI-L2-CMIPF", "ABI-L2-CMIPM",
             "ABI-L2-MCMIPC", "ABI-L2-MCMIPF", "ABI-L2-MCMIPM",
             "ABI-L2-ACHTC", "ABI-L2-ACHTF", "ABI-L2-ACHTM",
             "ABI-L2-ACHAC", "ABI-L2-ACHAF", "ABI-L2-ACHAM")
    if product not in names:
        raise ValueError("Unknown GOES product directory")
    w = when_utc.astimezone(dt.timezone.utc)
    return f"{product}/{w:%Y}/{w:%j}/{w:%H}/"

def goes_keys(satellite: str, product: str, when_utc: dt.datetime,
              mesoscale: int | None = None) -> list[str]:
    if satellite not in GOES_BUCKETS:
        raise ValueError("Satellite must be east or west")
    if mesoscale not in (None, 1, 2):
        raise ValueError("Mesoscale sector must be 1 or 2")
    keys = public_s3_keys(GOES_BUCKETS[satellite], goes_prefix(product, when_utc))
    if mesoscale is not None:
        # Mesoscale M1 and M2 have separate filename product IDs.
        mark = f"M{mesoscale}-"
        keys = [key for key in keys if mark in key.rsplit("/", 1)[-1]]
    return keys

def nexrad_volume_prefix(site: str, when_utc: dt.datetime) -> str:
    if len(site) != 4 or not site.isalnum():
        raise ValueError("Use WSR-88D station such as KBOX, not airport KBOS")
    if when_utc.tzinfo is None:
        raise ValueError("Use timezone-aware UTC time")
    w = when_utc.astimezone(dt.timezone.utc)
    return f"{w:%Y/%m/%d}/{site.upper()}/"

def nexrad_volume_keys(site: str, when_utc: dt.datetime) -> list[str]:
    return public_s3_keys(NEXRAD_BUCKET, nexrad_volume_prefix(site, when_utc))

# Next backend tasks:
# 1. Select newest source objects, account for delayed scans/retries.
# 2. Decode GOES ABI fixed-grid NetCDF4 with CF projection + quality flags.
# 3. Decode NEXRAD Level II polar bins/tilts into high-res geo tiles.
# 4. Decode MRMS GRIB2 QC raster with proper transparent NoData.
# 5. Publish CORS-clean geolocated RGBA tile/frame manifests to WXData.
# 6. Store only necessary short-lived frame cache on cost-controlled compute.
