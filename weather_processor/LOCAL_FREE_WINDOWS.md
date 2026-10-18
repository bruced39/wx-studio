# WX Studio NOAA Processor — FREE local Windows option (Docker alternative)\n\n**If you do not have or want Docker, use [NO_DOCKER_WINDOWS.md](NO_DOCKER_WINDOWS.md) instead.** The no-Docker path has an isolated Windows scientific environment and uses the same source-native GOES, MRMS and NEXRAD decoders.

NO paid cloud hosting. WX Studio's native NetCDF4, GRIB2 and NEXRAD Level II decoders run on your own Windows PC. Your browser receives images at http://127.0.0.1:8080. Streamlit Community Cloud only hosts the studio interface. This requires no rental server, credit card, public tunnel, open firewall port or monthly hosting fee.

## Prerequisites

- Windows 10/11, free disk space and enough RAM for native NOAA science products. Full-resolution satellite frames are large.
- Docker Desktop Personal in Linux/WSL2 mode, which is free for personal use, education and qualifying small organizations. Install, start and wait for its engine to become ready.
- A current checkout of bruced39/wx-studio (git clone or ZIP). Keep the repository folder; Docker needs its source code to build.

## Start

Open PowerShell inside the repository root:

    powershell -ExecutionPolicy Bypass -File .\weather_processor\start_local_windows.ps1

By default this enables native NOAA MRMS reflectivity (1 km source), GOES-19 East C02 visible (0.5 km nominal source near nadir), and KBOX NEXRAD Level II reflectivity. If your PC is short on memory, validate MRMS alone first:

    powershell -ExecutionPolicy Bypass -File .\weather_processor\start_local_windows.ps1 -Products "mrms-reflectivity"

You can pass further product IDs in a comma-separated -Products argument. Use -Rebuild after changing Python dependencies. The script downloads Docker dependencies on first build, creates a persistent local volume, runs the existing NOAA worker and read-only FastAPI, and binds the service only to Windows loopback (127.0.0.1).

The local processing is genuinely source-native but the current renderer still has a 16-million-pixel frame safety cap and high-resolution full-disk regional cropping. Very large full-disk and multiple mesoscale feeds require future tiled/progressive rendering. Do not represent a downsampled frame as native-pixel full disk.

## Connect your browser to your computer

1. On the SAME Windows PC, open http://127.0.0.1:8080/health and confirm it responds. At startup it may show waiting-for-real-noaa-frames.
2. Open the usual WX Studio Streamlit web app on that same computer.
3. Expand Streamlit's sidebar and check: Use free local NOAA processor on this computer.
4. If your browser prompts to allow access to the local/loopback network, allow it for the studio site.
5. In Weather Data / Cloud & data status, look for freshly decoded NOAA products. They are not shown as live until the actual NOAA ingest worker downloads, decodes and publishes observations.

The Streamlit SERVER DOES NOT contact your computer. JavaScript inside your browser requests http://127.0.0.1:8080/catalog and image frames directly, using the already existing Mapbox under-label weather layer. The browser processor connection is optional; demos still work without it.

Some browsers enforce more restrictive iframe/Local Network Access permissions and may block even with the hint in the processor bridge. If so, do not disable browser protection. Run Streamlit locally alongside the decoder instead, or review a secure zero-cost remote-access design in a separate step. We have NOT verified live Chromium/Firefox permission in your deployed Streamlit iframe.

## Verify or stop

    docker logs -f wxstudio-noaa-local
    docker stop wxstudio-noaa-local
    docker start wxstudio-noaa-local

API checks:
- http://127.0.0.1:8080/health
- http://127.0.0.1:8080/catalog
- http://127.0.0.1:8080/manifests/mrms-reflectivity.json (once actual MRMS is fresh)

The script never enables port forwarding, publicly advertises a hostname, or creates a cloud resource. NOAA source files are free; your own PC electricity, storage and Internet usage are not necessarily zero.

## Status and fidelity

Already in project: native NOAA processing code; GET-only frame API; local weather loop; Mapbox weather raster below city labels; weather palettes; NEXRAD selection dots; Weather Data panel. Local start and browser connect are added by this release.
NOT verified: running native Docker science packages on the user's Windows computer; real NOAA downloads and corresponding PNG pixel accuracy; browser cross-origin connection and rendered map. These need a first local smoke test.
NOT done: true full-resolution 0.5 km full-disk tiled rendering, user-selected RTMA or NOMADS products, 24/7 free hosted processing. The computer must be on for local live data.

Official documentation:
- https://docs.docker.com/subscription-billing/desktop-license/
- https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access
- https://registry.opendata.aws/noaa-goes/
- https://registry.opendata.aws/noaa-nexrad/
