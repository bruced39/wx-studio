# Decoder / imagery preparation layer (not connected yet)

`discovery.py` is a **real unsigned-public-S3 listing helper**, not a feed
adapter or thumbnail downloader. It resolves GOES hourly object prefixes,
mesoscale M1/M2 filenames and NEXRAD Level II volume paths. It does not
decode native weather data or claim that the web app can display it yet.

## Decode/build sequence

1. **GOES native resolution first**: GOES-19 East, GOES-18 West from the
   NOAA NODD public buckets. ABI Band 2 visible 0.5 km; clean IR nominal
   2 km; MCMIP bands for derived GeoColor; Cloud Top Temp/Height where
   available. Full Disk, CONUS and separate moving M1/M2 scans. Decode
   NetCDF4 coordinates and reprojection: ABI fixed grid is NOT a regular
   lat/lon image. Preserve original source resolution until final tile
   rendering; do not upscale a 1 km/2 km preview and call it 0.5 km.
2. **MRMS mosaic**: quality-controlled composite reflectivity GRIB2.gz,
   nominal 1 km and ~2-min cadence when available. Maintain your OWN
   timestamped history for live loops; NOAA's MapServer is not time-enabled.
3. **NEXRAD site native Level II**: retrieve Unidata real-time chunks or
   volumes. Process super-resolution bin/gate geometry, radar calibration,
   azimuth, elevation and valid data, output geo tiles for selected KBOX /
   KGYX etc. A 1 km national mosaic is not a Level II substitute.
4. **Palette application**: built-in LUT registry provides working starters,
   but NWS-style radar legends and operational satellite enhancements need
   review against your preferred exact color tables. GeoColor uses derived
   channels, not a simple single-field LUT.
5. **Scene integration**: register real sources only AFTER returning a
   timestamped `list({site,hours})` of georeferenced CORS-clean image
   frames. Correct long-term placement is a Mapbox raster source/layer
   BELOW WX Studio's independent place-name symbol layers, preserving
   radar on-screen labels; Claude's interim canvas compositing covers names.
6. **RTMA/models**: wait for user product selections. Do not guess fields.

## Processing libraries to evaluate in a future backend

Satpy/xarray/netCDF4, pyproj/rasterio, Py-ART and/or MetPy for radar;
cfgrib/ecCodes for GRIB2. Their availability, licensing and runtime
cost need testing before deployment. Avoid adding them to Streamlit's
main `requirements.txt` until the decoder architecture is agreed upon.
