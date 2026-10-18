# WX Studio — source-native NOAA scientific processor (implementation stage)

This is a **separate server + ingest worker**. It implements decoding of real
NOAA **ABI Level-2 CMIP NetCDF4**, **MRMS GRIB2.gz**, and **NEXRAD Level II
polar volumes**, rather than treating NOAA pre-rendered ImageServer PNGs as
original science measurements.

**Deployment status:** Source code is ready for dependency installation and
live-file acceptance testing; this repository commit **does not deploy or
activate an independent public processor**. Products will not appear as native
live weather loops in WX Studio until you host this service, let it decode
fresh NOAA observations, and set Streamlit
WX_WEATHER_PROCESSOR_URL to its public HTTPS origin. Do not mistake the
earlier browser NOAA MRMS Northeast preview for the native GRIB2 decoder.

## Native data and geographic coverage

| Product ID | Actual source | Source-native detail | Implementation |
|---|---|---|---|
| goes-east-conus-C02 | NOAA GOES-19 public AWS ABI-L2-CMIPC | ABI Band 2 ~0.5 km at nadir; regional geographic crop | Real NetCDF4 CMIP reflectance, calibrated grayscale; no fake GeoColor |
| goes-west-conus-C02 | NOAA GOES-18 AWS ABI-L2-CMIPC | Band 2 ~0.5 km at nadir | Same; West regional crop |
| goes-(east/west)-full-C02 | NOAA CMIPF | Source full-disk pixels | Currently process a high-resolution regional crop only, not an all-Earth full-resolution texture |
| goes-(east/west)-meso1-C02 / meso2-C02 | NOAA CMIPM | Per-scan moving ~0.5 km, ~1-min scans | Per-file moving sector bbox, not a static Northeast bbox |
| ...-C13 for the same sectors | NOAA ABI channel 13 | ~2 km infrared brightness temperature | Kelvin -> °C, palette enhancement; NOT the retrieved cloud-top-temperature product |
| mrms-reflectivity | NOAA MRMS MergedReflectivityQC 00.50 | Native gridded ~1 km radar mosaic | gzip GRIB2 via ecCodes/cfgrib, QC reflectivity, transparent user-editable dBZ legend |
| nexrad-reflectivity-KBOX | NOAA/Unidata WSR-88D Level II | Native polar radial/gate measurements, super-resolution as available | Py-ART read, lowest sweep and geodetic inverse sampling, custom dBZ LUT |
| nexrad-velocity-KBOX | Same native Level II | Scan-dependent native velocity gates | Diverging m/s palette; NOT automatically dealised |

Other NEXRAD sites may be enabled by changing the KXXX suffix and the worker
source list. **KBOX**, not KBOS, is the Boston WSR-88D station.

**Resolution limitation:** NOAA publishes native sensors in several
projections and changing grids. Reprojection *necessarily samples* raw pixels
onto a WGS84 geographic grid. This implementation uses 0.005° for C02,
0.02° for IR, 0.01° for MRMS, and 0.003° for Level II output, within
a 16-million-pixel-per-frame safety cap. Those are geographic output
sampling steps, not a claim that each pixel is a physical native-resolution
sensor measurement everywhere. Full nationwide 0.5 km coverage ultimately
needs tiled output and progressive loading. Never substitute coarse
full-country preview tiles and call them source-native. Never invent scan
times; they come from real NOAA filenames.

The MCMIP multichannel GeoColor recipe, cloud-top temperature/height native
retrievals, RTMA fields, and models are NOT yet connected; the user will choose
RTMA products and numerical models separately.

## One-host native NOAA activation (v0.9.86)

The scientific processor can now be started on **one Docker host** instead of
requiring two independent services with shared cross-service volumes. This is
especially useful for cloud providers that expose just one web service and
one persistent disk. The default Docker image starts:
- the existing read-only FastAPI /catalog + timestamped PNG service; and
- the existing raw NOAA NetCDF/GRIB2/NEXRAD volume ingest worker.

Both run in separate OS processes **inside one container**, controlled by
`weather_processor/single_host.py`. If one crashes, its sibling shuts down
too so the host can restart cleanly. A graceful shutdown stops both. There
is **no demo-data substitution** when NOAA is unavailable: /health returns
`waiting-for-real-noaa-frames` until an actual recent raw NOAA scan is
successfully decoded and saved.

From the repository root, on a machine with Docker:

```bash
docker build -f weather_processor/Dockerfile -t wxstudio-noaa-native .
docker volume create wxstudio-noaa-frames
docker run --rm -p 8080:8080 \
  -v wxstudio-noaa-frames:/data/frames \
  -e WX_PROCESSOR_PRODUCTS=mrms-reflectivity,goes-east-conus-C02,nexrad-reflectivity-KBOX \
  wxstudio-noaa-native
```

`PORT` and `WX_PROCESSOR_INTERVAL_SECONDS` (60–3600, default 120) are
configurable; the host should mount persistent storage at **/data/frames**.
Don't run both the single-host launcher and another worker against the same
volume. The existing `docker-compose.yml` explicitly starts the API on its
own and the ingest worker as a separate service, so its original behavior
remains unchanged.

**Deployment prerequisite:** A public HTTPS Docker host with sufficient RAM
(4+ GB is an initial minimum, more for multiple 0.5-km ABI sectors, and a
persisted volume) is still needed. NOAA's underlying observation files are
free/open data but CPU, storage, memory, egress and web hosting may cost
money. No host is provisioned or charged by this code change. A 512 MB
sleeping/free web instance should not be presented as a reliable source-
native satellite/radar service.

Once deployed, test `/health` and `/catalog` first. The catalog **MUST
contain actual fresh NOAA decoded products**, otherwise don't set
`WX_WEATHER_PROCESSOR_URL` or claim production operation. Then test
`/manifests/mrms-reflectivity.json` and one actual `/frames/...` URL
before adding `WX_WEATHER_PROCESSOR_URL = "https://..."` to Streamlit
secrets. For full-resolution source acceptance, confirm actual scan
timestamps and pixels from raw downloaded files, not the rendered
NWS ArcGIS MRMS image-preview source.

Run isolated zero-network startup tests with:

```bash
python -m pytest tests/test_weather_processor_single_host.py -q
```

The source-native NOAA scientific decoders and their fixtures remain in
`tests/test_weather_processor.py`. CI/in-memory tests cannot verify actual
NOAA network access, the native science files, or the user's browser imagery.
The current browser MRMS ImageServer preview remains available separately
until a real native worker is running.

## Running the processor

A Linux host (preferably x86_64, with 4+ cores, enough RAM and persistent
disk) is required; the scientific Python stack is intentionally NOT added
to the Streamlit app. First create and verify an HTTPS endpoint and estimate
storage/bandwidth expense. NOAA files are public/free, but a running host and
egress may have costs. No new paid service is provisioned by this release.

Run from the **repository root**:

    docker compose -f weather_processor/docker-compose.yml up --build

The original Compose workflow runs two containers sharing a persistent Docker volume:
- noaa-worker: polls fixed public NOAA sources, downloads bounded raw files,
  decodes real observations, atomically publishes PNG+metadata and prunes data
  older than 12 hours.
- noaa-api: GET-only /health, /catalog, /manifests/{product}.json,
  /frames/{product}/{observed-milliseconds}.png, CORS-enabled for WX Studio.

Raw observation timestamp is validated against current UTC (GOES <=45 min,
MRMS <=25 min, Level II <=40 min). Stale data are NOT advertised as live,
failure is logged and no synthetic replacement is generated.

Then proxy port 8080 through HTTPS, verify with:

    curl https://YOUR-PROCESSOR.example/health
    curl https://YOUR-PROCESSOR.example/catalog
    curl https://YOUR-PROCESSOR.example/manifests/mrms-reflectivity.json

The catalog remains empty until a real, recent decoded source is present.
Configure Streamlit's secret:

    WX_WEATHER_PROCESSOR_URL = "https://YOUR-PROCESSOR.example"

Restart or rerun Streamlit and refresh the embedded studio. The existing
studio/weather/processor_bridge.js registers ONLY products in /catalog, then
Claude's existing WXData weather loop and Mapbox UNDER-label raster image
draws the frame. The old browser MRMS preview is retained as an explicitly
labeled alternative test; once native MRMS is published it takes priority
in the processor registry.

## Choosing the finest NOAA products

Enable only the necessary products to limit RAM and bandwidth. Use commas:

    WX_PROCESSOR_PRODUCTS=mrms-reflectivity,goes-east-conus-C02,goes-east-meso1-C02,goes-east-meso2-C02,goes-east-conus-C13,goes-west-conus-C02,nexrad-reflectivity-KBOX,nexrad-velocity-KBOX

For Mesoscale 1/2 the NOAA satellite chooses where to point: those sectors
move and may cover an area far from the currently visible map. They are
listed as current only after the worker actually decodes them; no pretending
the Northeast was in every scan.

The current WXData loop eagerly loads PNG frames. The bridge therefore caps
a visible window to 8 very-large C02 images, 12 C13/Level II, or 24 MRMS
frames, selecting REAL time-spaced observations across the chosen history.
Loop duration choices appear only as enough real history accumulates. This
is a conservative high-resolution-first starting point—not all scans are
displayed at full native cadence over a 12-hour memory-heavy browser loop.
A future progressive/tiled frame source will remove that memory limitation.

## Product palettes

Palettes in weather_processor/palettes are the exact same editable starter
stop values as studio/weather/palettes.js:
- radar-reflectivity.json (dBZ)
- radar-velocity.json (m/s, not velocity dealiasing)
- satellite-ir-c13.json (°C thermal IR brightness temperature)

C02 visible needs **no color palette**, and the missing proper GeoColor
recipe must not be represented by a color-table-only band 2 image.
The existing private Supabase user palette bucket remains untouched.
For now edit an on-disk JSON starter and rebuild/restart the worker to use it;
connecting user-owned cloud LUTs to the remote processor needs an explicitly
approved authenticated palette-sync design. DO NOT put public NOAA frame
archives in the existing private palette bucket.

## Acceptance tests and operational limits

Install packages and run:

    python -m pytest tests/test_weather_processor.py -q
    node --test tests/weather_native_processor_bridge.test.js

Tests use synthetic small image/value arrays and mocked catalogs; they
do not falsely claim the live GOES, MRMS and NEXRAD feeds are currently
reachable. For full validation, load actual recent NOAA files into an
isolated test host and inspect pixel georeferencing, timestamp, alpha,
palette, coverage and Mapbox underlay at multiple zooms.

The physical NetCDF/GRIB2/Level II decoder must be validated against
representative real science files before classifying any feed as
production. The first step after installation should be MRMS: watch the
stdout ingest timestamps; call /catalog; then test the actual browser
Mapbox underlay with city labels visible. Next activate ABI and KBOX
radar one by one. Real AWS bucket browsing and image/GRIB downloads are
only attempted at runtime on the processor host.

Sources:
- https://registry.opendata.aws/noaa-goes/
- https://registry.opendata.aws/noaa-nexrad/
- https://mrms.ncep.noaa.gov/2D/MergedReflectivityQC/
- https://www.ncei.noaa.gov/products/goes-terrestrial-weather-abi-glm
- https://www.unidata.ucar.edu/blogs/news/entry/important-changes-to-noaa-nexrad
