# WX Studio — free native NOAA science on Windows, NO Docker

This runs WX Studio's EXISTING highest-native-resolution NOAA decoder stack on
YOUR Windows PC with a **portable, free scientific environment**. No Docker
Desktop, Windows Subsystem for Linux, paid hosting, credit card, public
tunnel, or server account. The Streamlit cloud app stays lightweight; its
browser connects directly to the processor at `127.0.0.1:8080` on that
**same computer**.

This is an alternative launcher, not a new radar/satellite feed. The original
NOAA data remains unmodified. Native downloads and scientific conversion are
done by `weather_processor.ingest`; frames are published only after decoding
real files and verifying their NOAA timestamps. We never mark a demo as live.

## One-time preparation

1. In Windows 10/11, download the WX Studio GitHub repository as a ZIP (or
   use your existing local clone) and extract it to a folder on your PC.
2. Open **PowerShell** in the extracted `wx-studio` folder.
3. To download an official **portable micromamba** executable and install the
   open-source, pre-built Windows scientific packages in an isolated folder,
   run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\weather_processor\start_no_docker_windows.ps1 -InstallMicromamba
   ```

   The first setup needs Internet access and can take several minutes and
   several gigabytes of download/disk storage. Packages are installed only
   inside `%LOCALAPPDATA%\WXStudioNOAA`; system Python is NOT changed.
   The downloaded tool comes from the official mamba-org GitHub release.
   If you would rather install micromamba yourself, do so from the official
   installation guide and omit `-InstallMicromamba`.

4. The **same** PowerShell window stays open and starts both the API and NOAA
   ingest. Press **Ctrl+C** to stop. Next time you can run the same command
   WITHOUT the `-InstallMicromamba` switch.

## Connect it to your weather show

1. With that processor window still open, visit
   [http://127.0.0.1:8080/health](http://127.0.0.1:8080/health)
   and [http://127.0.0.1:8080/catalog](http://127.0.0.1:8080/catalog).
   At first, `waiting-for-real-noaa-frames` is NORMAL; scientific decoders
   must fetch the first real scan. Only `/catalog` with genuinely fresh NOAA
   products counts as live.
2. Open WX Studio in the browser **on this same Windows computer**.
3. Expand the Streamlit sidebar and check
   **Use free local NOAA processor on this computer**.
4. If the browser asks for **local network access**, allow this site to reach
   `127.0.0.1`. A browser security policy might still block loopback from
   an HTTPS-embedded Streamlit app: if that occurs, don't expose the API on
   your public LAN or open ports; report the exact browser error.
5. In **Weather Data → Cloud & data status**, wait for native sources to
   appear with real observation times. Select the registered GOES, MRMS or
   NEXRAD product in the playback dock.

The native decoder and existing Mapbox raster underlay support have already
been implemented. If NOAA source downloads, Windows scientific libraries,
browser CORS/LNA or your Mapbox token fail, the UI should show a disconnected
or error state rather than pretending a synthetic frame is a real scan.

## Free highest-resolution product choices

The default product list is:

- `mrms-reflectivity`: NOAA MRMS **1 km GRIB2** radar reflectivity.
- `goes-east-conus-C02`: GOES-19 ABI C02 **nominal 0.5 km** visible reflectance.
- `nexrad-reflectivity-KBOX`: KBOX NEXRAD **native Level II radar volume**.

These formats require real scientific decoding; unlike lower-detail browser
ImageServer snapshots, they retain source-level measurements. A native pixel
at satellite nadir does not imply a final 0.5 km raster everywhere (GOES viewing
angle, cropping, browser memory limitations). Original radar gates are
processed by Py-ART and ultimately reprojected to a display raster.

To start only MRMS first while checking download and RAM:

```powershell
powershell -ExecutionPolicy Bypass -File .\weather_processor\start_no_docker_windows.ps1 -Products "mrms-reflectivity"
```

Later, to enable East/West visible or IR sectors and nearby radar:

```powershell
powershell -ExecutionPolicy Bypass -File .\weather_processor\start_no_docker_windows.ps1 -Products "mrms-reflectivity,goes-east-conus-C02,goes-east-meso1-C02,goes-west-conus-C13,nexrad-reflectivity-KBOX"
```

Mesoscale footprints move with the satellite scan. Those source availability
and processing speed depend on the actual public NOAA data and the power of
your PC. Native imagery is still cropped/limited to a 16-million-pixel output
frame in the existing processor; **full native-pixel full-disk tiling** is not
yet supported and must not be advertised as such.

We are intentionally NOT activating RTMA and forecast-model products before
you select their exact requested variables. The Weather Data palettes already
support local and cloud saved tables; native NOAA source processing may need
product-specific scalar/color mappings as each additional field comes online.

## Privacy, startup and troubleshooting

- The service listens only at **127.0.0.1**, never `0.0.0.0`.
- All NOAA files, processed imagery and downloaded scientific packages live
  in `%LOCALAPPDATA%\WXStudioNOAA` on your Windows PC.
- Other devices cannot access the private local processor.
- No NOAA jobs run on Streamlit Community Cloud. No Supabase API keys or
  Mapbox secret tokens are needed by the processor.
- If port 8080 is already occupied, stop the other service or run with
  `-Port 8081`. The Streamlit sidebar's automatic local URL currently uses
  8080, so normal setup should use 8080.
- To change input products, stop with Ctrl+C and rerun with `-Products`.
- If an isolated scientific environment installation fails, capture its
  displayed error. Do **not** replace scientific dependencies with random pip
  wheels or disable browser security protections.
- This code has automated offline lifecycle tests, but the user must perform
  a real Windows scientific install, NOAA ingest and live browser test. No
  live products are claimed until verified in the real catalog.

There is still a Docker option in
[`LOCAL_FREE_WINDOWS.md`](LOCAL_FREE_WINDOWS.md), but it is **not** required
for this no-Docker path.
