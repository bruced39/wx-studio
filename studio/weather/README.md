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
from NOAA, retain each ~2 minute scan for a genuine 1/2/4 h history.
The NWS MapServer live map image is not time-enabled, so **cannot** supply
a historical four-hour loop by itself.

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

All imagery/frame connections still require a real decoder, projection,
cache/expiry logic, NOAA attribution and operational browser validation.
