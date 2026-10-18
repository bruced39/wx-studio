# GitHub Actions: real NOAA data acceptance test

This is **phase 1: prove source-native decoding on a temporary GitHub Linux runner**.
It is NOT a deployed weather-feed server and does not change WX Studio's
runtime, Mapbox labels, palettes, scene settings or Claude's playback bar.

## Start

A push to `main` affecting `weather_processor/**` starts
[NOAA native-resolution decoder proof](https://github.com/bruced39/wx-studio/actions/workflows/noaa_native_acceptance.yml).

You can also run **Actions → NOAA native-resolution decoder proof →
Run workflow**, specifying up to eight comma-separated product IDs.
Examples (run selected tests separately if bandwidth/time is constrained):

- `mrms-reflectivity` — NCEP native MergedReflectivityQC GRIB2.gz; geographic 0.01-degree output sampling, approximately native 1-km-class mosaic.
- `goes-east-conus-C02` — GOES-19 East ABI-L2 CMIP Band 2 visible, native ~0.5-km-class near satellite nadir.
- `goes-east-conus-C13` — GOES-19 infrared Band 13, native ~2-km-class.
- `goes-west-conus-C02`, `goes-west-conus-C13` — GOES-18 West native bands.
- `goes-east-meso1-C02`, `goes-east-meso2-C02` — real moving East mesoscale domains. Their geographic footprints may NOT include New England.
- `goes-west-meso1-C02`, `goes-west-meso2-C02` — real moving West mesoscale domains.
- `goes-east-full-C02`, `goes-west-full-C02` — full-disk NOAA files cropped to current regional output windows; **not** full-disk ultra-HD tiles.
- `nexrad-reflectivity-KBOX` — native Boston WSR-88D Level II polar volume; **KBOX**, not KBOS. The decoders use the first/lowest sweep's actual gate/ray values.
- `nexrad-velocity-KBOX` — native radial Doppler velocity; this is not dealiased.

The GitHub runner installs NetCDF/HDF5, rasterio/PROJ, GRIB2/eccodes,
and Py-ART *in an isolated job*, never into Streamlit's app environment.
All sources are public NOAA/Unidata; no API keys or paid hosting required
for this one-time validation job. GitHub Actions run minutes, artifact
storage, download bandwidth and concurrency are still subject to the
user's GitHub billing/plan limits.

## What counts as PROVEN

The job must **finish green**. Each requested product must produce:

1. A successful download of a **fresh observation** selected by its genuine
   source timestamp (not the time the test was executed).
2. Decoding of real native **NetCDF4, GRIB2.gz or Level II** science bytes
   by the existing `weather_processor` code.
3. An atomic `.png` RGBA overlay and matching `.json` with
   `wxstudio.frames.v1` schema, geographic bounds, original UTC timestamp,
   nonempty NOAA source attribution, exact image width/height and PNG size.
4. A per-product **passed** entry in `noaa-proof/acceptance-report.json`.

The workflow archives the report and sample imagery as a short-lived
**noaa-native-proof-<runid>** build artifact. If **any product fails**,
the job is red and the report tells you which. NOAA feed outages,
no matching recent scans, oversized source files, missing scientific
dependencies or decoding errors are all honest failures.

A transparent frame can be legitimate for a dry-weather radar area;
valid metadata does not prove visible precipitation.
The output resolution is a deliberate geographic sampling of original
satellite/radar measurements, not invented sharper-than-native source data.
C02 grayscale is NOT a fabricated multiband GeoColor composite.

## What GitHub cannot replace

A GitHub Actions runner is ephemeral and does not provide stable
public HTTPS serving, a long-term frame archive, or a low-latency
every-2-minute production loop. Do not turn this validation workflow
into a perpetual polling daemon. **After the science proof**:

- Determine exact per-product NOAA arrival cadence, processing duration,
  downloaded bytes, generated PNG bytes, data quality and false failures.
- Choose a limited regional set of products, their actual update cycle,
  and whether existing Streamlit resources or an external free-tier host
  are sufficient. Any storage/egress costs must be explicitly reviewed
  before provisioning.
- Then deploy the *existing* separate `weather_processor/service.py`
  + worker over HTTPS and point WX Studio's existing processor bridge at it.
  Until then, the native feeds must remain **not connected** in the UI.

## Local reproducibility

From repository root on Linux, after following
`weather_processor/README.md` to install prerequisites:

```bash
python -m pytest -q tests/test_weather_processor.py tests/test_weather_processor_acceptance.py
python -m weather_processor.validate_live \
  --products "mrms-reflectivity,goes-east-conus-C02,goes-east-conus-C13,nexrad-reflectivity-KBOX" \
  --output noaa-proof
```

The source/native processor code predates this workflow. This change
adds **independent real-NOAA scientific acceptance infrastructure only**.
No claim of success is made before a green GitHub Actions run is examined.
