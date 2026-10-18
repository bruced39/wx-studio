# WX Studio — NOAA native decoder worker (first implementation)

Status (v0.9.74): deployable separate Python/Docker NOAA decoder + read-only
HTTPS-ready manifest/frame server and browser/Mapbox source bridge implemented.
**NOT deployed or demonstrated against live NOAA raw files yet.** A networked
host, scientific dependency installation, real observations, secure HTTPS domain,
and CORS/browser acceptance tests are required before feeds are honestly LIVE.

## Setup on a separate worker

From repository root with Python 3.11+:

    python -m venv .wx-weather
    .wx-weather/bin/pip install -r studio/weather/ingest/requirements-worker.txt
    .wx-weather/bin/python -m unittest discover -s tests -p test_noaa_ingest.py

Do NOT add worker dependencies to root requirements.txt (the Streamlit shell).

## Process original observations at available/native resolution

GOES-19 ABI native C02 visible (0.5 km) CONUS:

    python -m studio.weather.ingest.cli convert --source goes --satellite east --sector conus --band C02 --bbox=-76,39,-66,46

GOES-18 ABI meso1 sector C13 IR (native ~2 km), if the moving sector covers ROI:

    python -m studio.weather.ingest.cli convert --source goes --satellite west --sector meso1 --band C13 --bbox=-124,32,-116,44

MRMS native reflectivity GRIB2.gz (1 km grid, NOT pre-colored radar image):

    python -m studio.weather.ingest.cli convert --source mrms --bbox=-76,39,-66,46

KBOX NEXRAD native Level-II lowest-elevation 250 m gate sampling (NOT MRMS):

    python -m studio.weather.ingest.cli convert --source nexrad --site KBOX --moment reflectivity --bbox=-73,40,-68,44

Each accepts --input=/real/downloaded/path for offline decoded-file verification
without downloading. Output defaults to wx_weather_output/product/manifest.json
and wx_weather_output/product/frames/OBSERVATION_EPOCH_MS.png.
Choose a smaller geographic bbox instead of forcing low-resolution imagery if
a command rejects a request on output size/memory. Default max is 12M pixels.

Manifest schema: wxstudio.frames.v1; frames sorted by real observation
timestamp; each frame contains t (UTC epoch ms), bbox [west,south,east,north],
crs=4326 and url=frames/{t}.png. No-data and radar no-echo are transparent.
Frame timestamps come from file metadata, never from download time.

## Local QA, serving and operational limitations

    python -m studio.weather.ingest.cli serve --root wx_weather_output --port 8788

This deliberately binds to 127.0.0.1. Remote WX Studio browsers need a separate
bounded HTTPS+CORS frame publisher and an adapter that registers only verified
available manifests in Claude's WXData.registerSource contract. Running this
one-shot command does NOT activate live radar/satellite in the cloud.
Run recurring downloads with a separate scheduler, retain only a small rolling
set of frames (default --keep=48), verify source age and supervise failures.
Do not store full observation loops in the private user weather-palette bucket.

## Exact source scope

GOES: true ABI geostationary projection, native C02 and C13; East/West,
Full Disk/CONUS/M1/M2. GeoColor is a separate multiband composite NOT yet
implemented; we do not mislabel simple C02 as GeoColor.
MRMS: regular-grid MergedReflectivityQC GRIB2 from NOAA, not a baked-color
4-hour ImageServer visualization. NOAA's operational service can be delayed.
NEXRAD: Py-ART original Level-II sweep and native polar gate geolocation,
with separate reflectivity/velocity options. 3D/CAPPI/dual-polar fields need
additional domain processing. The real radar cadence depends on VCP.
RTMA specific datasets and model fields await your choices.

Current WXData.draw() draws over text labels. Mapbox raster layers need to
be rendered BELOW the City's/Town's symbol layers in the eventual live bridge.

Sources: https://registry.opendata.aws/noaa-goes/
         https://registry.opendata.aws/noaa-nexrad/
         https://mrms.ncep.noaa.gov/2D/MergedReflectivityQC/

## Independent worker + HTTP service (v0.9.74)

The decoder's `cli.py` remains the actual raw NetCDF4/GRIB2/Level-II
converter. No scientific packages were added to Streamlit.

Production build on a **separate Linux Docker host** (at least approximately
6 GB worker memory, persistent disk sized to the selected loops):

```bash
docker compose -f studio/weather/ingest/compose.yml up --build -d
curl http://127.0.0.1:8788/health
curl http://127.0.0.1:8788/catalog
```

The decoder container polls four authentic NOAA inputs sequentially every
5 minutes by default: GOES-19 East CONUS C02 visible (~0.5 km source band)
and C13 IR (~2 km), MRMS MergedReflectivityQC native 1 km GRIB2, and KBOX
NEXRAD Level-II lowest-sweep native polar data with ~250 m reflectivity gate
sampling. These are NOT GeoColor or RTMA/forecast model products.
The worker refuses stale downloads and oversized source requests rather than
mislabeling or automatically decimating observations. The host retains a
bounded rolling frame cache (default 180 per product); actual source cadence
and missing scans determine how far back a loop can go. A newly launched worker
has NO four-hour history until it accumulates or otherwise ingests real scans.

Publisher endpoints, CORS-clean by default:
```
GET /health
GET /catalog
GET /manifests/mrms-reflectivity.json
GET /manifests/goes-east-conus-C02.json
GET /manifests/goes-east-conus-C13.json
GET /manifests/nexrad-reflectivity-KBOX.json
GET /frames/{product}/{observation_timestamp_ms}.png
```

`/catalog` includes only verified, currently fresh product manifests.
If NOAA is unavailable/stale, the service reports `no-fresh-data` and the
browser does not register the source as live. This ensures the old synthetic
`demo` feed is never substituted as NOAA output. Weather imagery is a
Mapbox IMAGE SOURCE + RASTER LAYER inserted below its coastline, boundary,
road, city, town and other vector overlays; the exporter waits for imagery
before snapping the map. The loop bar itself remains Claude's unchanged UI.

**HTTPS requirement:** Docker Compose binds port 8788 to the host loopback.
Configure an HTTPS reverse proxy to that loopback port on the worker and
point your **WX Studio Streamlit secrets** to that HTTPS domain:

```toml
WX_WEATHER_PROCESSOR_URL = "https://your-worker-domain.example"
```

Set `WX_WEATHER_PUBLIC_BASE_URL` on the worker to the same external HTTPS
base, and `WX_WEATHER_CORS_ORIGIN` to your actual studio origin if possible.
No service-role keys are sent to the browser; the public NOAA-derived frames
are read-only. Never make the processing worker a public writable endpoint.
The existing `WXWeatherProcessorBridge` registers GOES/MRMS/NEXRAD only
after it receives a valid and fresh catalog. It refreshes available observations
while the editor remains open and refuses mismatched NEXRAD site choices.

Offline QA:
```bash
python -m unittest discover -s tests -p test_noaa_service.py -v
node --test tests/weather_underlay.test.js
python -m unittest discover -s tests -p test_noaa_ingest.py -v
```

**Still unverified:** This ChatGPT environment cannot download NOAA raw files,
cannot install packages on a user-owned public Docker host or provide a public
TLS domain, and has no authorized host credentials. Successful actual NetCDF,
GRIB2 and Level-II conversions, on-map alignment across zooms, and cross-domain
browser fetch must be established on the worker before declaring feeds LIVE.
C02 is NOT GeoColor. GOES West and movable mesoscale sectors need separately
configured products and ROIs. RTMA variable and model fields await selection.
