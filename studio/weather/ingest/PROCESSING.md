# WX Studio — NOAA native decoder worker (first implementation)

Status: source-format decoders and frame exporter are implemented in Python, but
NOT a deployed live WX Studio feed. The worker requires native science packages,
a network-connected host, real NOAA sample-file QA, scheduler and HTTPS publication.

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
