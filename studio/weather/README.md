# Weather data integration — clean source & palette directories

This folder is owned by ChatGPT's **weather data / palette** work. Claude owns
the presentation layer and playback controls in `studio/dataloop.js`. Check
`VERSION`, latest `main`, and `AI_HANDOFF.md` before touching shared files.

## Directory structure

- `sources.js`: GOES-19 East, GOES-18 West (CONUS/full disk/mesoscale 1/2,
  native ABI visible Band 2 0.5 km, IR Band 13 2 km, multispectral/GeoColor
  foundation, cloud top T/H), NOAA 1 km MRMS mosaic, true site-native NEXRAD
  Level II base reflectivity and velocity. Product manifest **only**; adapters
  are not yet registered as live playback data. Exact per-satellite product
  availability should be checked during decoder implementation.
- `palettes.js`: built-in starting radar and infrared/derived-cloud palettes,
  with numeric stop validation. GeoColor / native visible are RGB/grayscale;
  do not force a 1D scalar LUT onto them.
- `cloud_palettes.js`: authenticated private Supabase API. `WXWeatherPaletteCloud.list`,
  `.save`, `.remove`, `.uploadLut`, `.downloadLut`. Reuses the existing
  `WXCloudPresets` login. Built-in palettes don't require login.
- `nexrad_sites.js`: NOAA NCEI all-site station discovery (regional fallback)
  and selectable location dots over the editing stage, without touching the
  actual forecast-map label renderer. Clicking a dot sets `scene.dataLoop.site`
  to e.g. **KBOX** (the Boston WSR-88D; **KBOS is an airport code**, not the
  WSR-88D site identifier). It does **not** activate a nonexistent data feed.
- `ingest/`: discovery/decoder handoff documentation and examples.
- `../../supabase/migrations/20261017_create_weather_palettes.sql`: private
  owner-only cloud metadata/LUT store, already applied to WX Studio Supabase.

## Supabase folder paths

Bucket: `wx-studio-weather-palettes` (PRIVATE; JSON/PNG, 2 MiB/file).

  {user-uuid}/radar/{product-id}/{palette-name}.json
  {user-uuid}/satellite/{product-id}/{palette-name}.json
  {user-uuid}/rtma/{product-id}/{palette-name}.json
  {user-uuid}/models/{product-id}/{palette-name}.json
  {user-uuid}/custom/{product-id}/{palette-name}.json

These are virtual Supabase Storage prefixes. They appear when the first file
is uploaded; PostgreSQL palette records are separate from LUT assets. The
current default palettes are versioned in `studio/weather/palettes.js` so
they remain available offline and to every user without a cloud login.

**Do not use this bucket for satellite imagery, radar frames, or temporary
multi-hour weather-data archives.** Frequent imagery would consume Supabase
storage/bandwidth, and users haven't approved a higher cost. Use source-side
public data plus a properly budgeted cache/processor for rendered frames.

## First direct NOAA frame adapter — MRMS Northeast test (v0.9.78)

`studio/weather/sources.js` now registers a **real but experimental**
`WXData` source named **NOAA MRMS · Northeast (test)**. It is shown in the
Weather data loop source menu after the existing script loads; no changes to
Claude's `studio/dataloop.js`, `studio/engine.js`, `studio/index.html`, or
the working Mapbox renderer are required.

- Origin: NOAA/NWS `radar_base_reflectivity_time` ImageServer (public,
  time-enabled **MRMS** composited radar). It supplies server-rendered
  transparent radar images (PNG32), **not raw source reflectivity/dBZ**.
  Palette recoloring is therefore unavailable on this browser test source.
- Every frame timestamp is read from NOAA's actual image catalog using
  `ImageServer/query`, and the live service's `timeInfo.timeExtent` is
  checked first. Duplicate and out-of-window timestamps are removed; stale
  imagery or a blocked/CORS response gives an explicit error rather than
  inventing playback frames.
- Test footprint is **Northeast** `[-82,35.5,-64.5,49]` in WGS84; each
  transparent image is requested at **3072 × 2304** pixels, a regional high
  detail visual integration test (not an all-CONUS or source-native 1-km
  archive). Fixed high-quality geography reduces bandwidth and avoids
  pretending an entire country's radar can be shown at regional resolution
  in one image. Only **1-hour** selectable (up to 12 observed image timestamps).
- Use a map scene, enable the weather data loop bar, select **NOAA MRMS ·
  Northeast (test)**, choose 1 Hr, and view the Northeast region with the
  loop opacity around 85%. New MRMS frames are obtained when that source is
  initialized for the session; refresh the browser to fetch newer frames
  during this first trial. Automatic rolling reload and adaptive tiling are
  follow-up improvements.
- QA: six mocked Node-compatible test cases in
  `tests/weather_mrms_browser_source.test.js` pass. The native NOAA metadata
  was verified through NOAA's public ArcGIS REST endpoint, **but CORS and
  actual transparent PNG playback in the user's browser remain unverified**.
  Do NOT describe this source as fully live/production until their test.
- The existing `studio/weather/processor_bridge.js` is unchanged. If a
  true processed/raw MRMS provider later registers the `mrms` id, it can
  supersede this preview; NEXRAD Level II and GOES source families remain
  decoder-dependent. For full native fidelity use raw NOAA files, server-side
  processing/tiles and a time-aware regional tile cache.

## Real feeds: adapter contract

In `studio/dataloop.js`, use `WXData.registerSource({ id, label, lengths,
list: async ({site,hours}) => [...] })`. Each returned frame must include
`{t, bbox, crs:'4326'|'3857', load:async()=>canvas}`. **Do not register a
feed before it can return decoded, georeferenced, CORS-safe images.**

For GOES native NetCDF (NOAA NODD public AWS S3), a proper converter must
read ABI fixed-grid projection, the per-scan coverage (especially moving
mesoscale sectors), radiance/reflectance/brightness T, limb masks and quality
flags. Reproject to geographic tiles. GOES-19 is East, GOES-18 is West.
Visible Band 2 is ~0.5 km at nadir; IR/cloud top is nominal 2 km. GeoColor
is a derived RGB product and is not identical to one unenhanced ABI band.

For NEXRAD Level II native bzip2-compressed volume messages from public
`unidata-nexrad-level2` (and realtime chunks), decode actual radar moments,
elevation and polar gate location, perform quality flags, color map each
native-resolution radial, and rasterize to projected tiles. A 1 km MRMS
mosaic, although useful for national coverage, is NOT a substitute for Level
II at single-site zoom. `KBOX` is the correct Boston local WSR-88D.

For MRMS raw 1 km quality-controlled mosaic, ingest timestamped GRIB2.gz
from NOAA, and retain timestamped frames if rendering an independent LUT.
The NWS **live MapServer** is not time-enabled. However NOAA also offers the
separate **time-enabled radar_base_reflectivity_time ImageServer**, advertised
with a moving 4-hour history and ~5-min updates (actual current time extent
may be shorter; query it). Its source-colored images are useful for a fallback
loop but are NOT raw dBZ that our custom color palettes can recolor.

For RTMA/model fields, keep the catalog pending until the user selects
fields and model products. The prepared cloud palettes can be filled
individually once those choices are made. Do not start with lower-resolution
preview imagery and imply it's native high-resolution data.

## NOAA/Unidata references

- https://registry.opendata.aws/noaa-goes/
- https://registry.opendata.aws/noaa-nexrad/
- https://mrms.ncep.noaa.gov/data/
- https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity/MapServer
- https://gis.ncdc.noaa.gov/arcgis/rest/services/cdo/nexrad/MapServer/0

All *native/derived* NOAA NetCDF, GRIB2 and Level II products still
require real decoding, reprojection, cache/expiry logic, NOAA attribution
and operational browser validation. The initial NWS MRMS browser preview
uses NOAA's own time-enabled image rendering without a local decoder; it
is not a substitute for the planned source-native data pipeline.

## Native NetCDF4/GRIB2/Level II stage (v0.9.79)

The separate **`weather_processor/`** package contains the first actual NOAA ABI Level 2 C02/C13 NetCDF, raw MRMS GRIB2.gz, and native NEXRAD Level II decoders, plus bounded read-only CORS frame manifests. See [processor deployment/limitations](../../weather_processor/README.md). This scientific stack is intentionally NOT installed in Streamlit. Source registration through `studio/weather/processor_bridge.js` is conditional on real decoded, current NOAA frames from a separately hosted `WX_WEATHER_PROCESSOR_URL`. It is **not yet deployed or operationally validated**, unlike the existing lower-level NWS rendered MRMS browser test. Existing cloud palettes and NEXRAD site dots stay intact. The HTML bundler `wxbuild.py` now inlines the weather/* modules into Streamlit iframe.
