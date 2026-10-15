# WX Studio — AI Handoff

> Shared project continuity for ChatGPT and Claude. Update this file whenever code changes.
> Never assume this snapshot is the latest: read `main`, `VERSION`, recent commits, and relevant source files before editing.

## Last reviewed baseline

- Review date: 2026-10-14 (America/New_York; commits below are UTC on 2026-10-15).
- Repository: `bruced39/wx-studio`; default/deployment branch: `main`.
- **Last reviewed application version:** `0.9.0` (`VERSION`).
- **Last reviewed code commit:** `3647ad05ec4bff306ded3e26bb26edc3bc8c1602` — `WX Studio 0.9.0: add Aguacero-style map overlays`.
- This document may itself be committed after the code baseline without a version bump. Treat the code commit above as a historical snapshot; check `main` for any newer work.

## Purpose / ownership boundaries

WX Studio is a browser-based weather broadcast studio hosted by Streamlit, built in collaboration with Claude and ChatGPT. Features include scenes, drawn weather elements, camera moves, animated forecast graphics and client-side video export. Preserve **Claude's pre-existing studio architecture and features**. Do not rewrite unrelated rendering, scene state, export, or UI workflows to adjust the AguaceroWX-inspired maps.

Core files: `studio/mapbox.js` (Mapbox backgrounds/cartography), `studio/ui.js` (Scene / Background settings), `wxbuild.py` (HTML bundle), `app.py` (Streamlit host), `studio/index.html` (shell), and `VERSION`. Streamlit deployment runs from `main` with `app.py`. Mapbox uses a public `pk.` token supplied through Streamlit secrets or browser settings; **never commit credentials/tokens**.

## Recent confirmed progress

| Version | Commit | Changes |
|---|---|---|
| 0.8.5 | `5a6324a` | Road zoom ranges and badge |
| 0.8.6 | `84791c4` | Smoother live Mapbox navigation |
| 0.8.7 | `d86f5a1` | AguaceroWX-style separate transportation classes, colors, widths, outlines, toggles and zoom ranges |
| 0.8.8 | `19f6961` | Native sharp Mapbox rendering and reduced stop-motion flicker |
| 0.8.9 | `ce2ecd9` | Land & Water, depth, national parks, building footprints and 3D controls |
| 0.9.0 | `3647ad0` | AguaceroWX-style Overlays settings and map layers |

In 0.8.9 the broadcast ocean/water color default is `#1d253a`; bathymetry color `#000000`; parks `#252525`; building footprint `#242424`. Preserve existing saved scenes/settings unless a migration is explicitly necessary.

## Overlay implementation as of 0.9.0 — REVIEWED IN SOURCE, NOT UI-TESTED

Implemented under **Scene → Background → Mapbox map → Weather Director Broadcast → Overlays**:

- Day / Night Cycle (toggle).
- NWS Forecast Areas / County Warning Areas (CWA).
- NWS Public Zones.
- NWS Fire Weather Zones.
- NWS Coastal Marine Zones.
- Time Zone Boundaries.
- Latitude / Longitude Grid (off, 0.5°, 1°, 2°, 5°, 10°, 15°, 30°; color, width, opacity, automatic spacing).

Boundary line controls offer enable, color, solid/dashed/dotted style, width, opacity, and min/max zoom. NWS layers use the NOAA/NWS ArcGIS reference-map service, with layer IDs 1 (CWA), 8 (public), 9 (fire), 5 (coastal marine). Time zones use the U.S. DOT/Bureau of Transportation Statistics ArcGIS layer. Each overlay defaults off.

**Verified:** the published NOAA service metadata includes these four IDs; the US DOT/BTS time zone endpoint is published. **Not verified:** live browser fetch/CORS, zoom/animation performance, rendering of all boundary layers in the deployed app, or visual matching against user screenshots.

## Next work / QA priorities

1. Open the deployed Studio and visually test the 0.9.0 Overlays panel using the user's AguaceroWX screenshots, with priority on exact settings hierarchy, label legibility and fine line styling.
2. Enable each NWS and time-zone overlay around Boston/New England; confirm geometry actually renders, can be styled, and honors min/max zoom. Check error console and performance. NWS fetches are viewport-based; ensure network responses remain complete and old requests do not overwrite newer viewport results.
3. **Known likely UX issue in source:** `overlayLatLonAutoSpacing` defaults to `true`. When true, selecting a fixed grid spacing from the dropdown will be overridden by automatic zoom-dependent spacing. Resolve the control semantics, ideally allowing manual interval selection to do what it says.
4. Verify Day/Night shading's terminator and how its data refreshes when the scene is stationary; 0.9.0 refresh is attached to Mapbox `moveend`.
5. Confirm 0.8.8 smooth Mapbox navigation and flicker-free stop behavior are still intact with overlays enabled; avoid large synchronous/async updates on every camera step.
6. Continue matching AguaceroWX cartography: city/town names, resolution/sharpness, road widths and coloring, coastline/water behavior. Do not change Claude's other UI features.
7. The previously discussed **Put Ocean/Land Over Added Layers** control was consciously deferred until the proper weather-data overlay stack exists. Do not mistakenly mark it complete.
8. After a successful live visual test, correct confirmed issues in small commits, increment `VERSION` for application changes, and update this file.

## Rules for alternating between ChatGPT and Claude

1. **Before editing:** read GitHub `main` HEAD, `VERSION`, recent commits, and `AI_HANDOFF.md`. Compare against your last known SHA; read changed files before touching them.
2. Avoid two writers editing the same file at the same time. Never replace whole source files with an earlier snapshot; preserve edits from the other AI.
3. Limit diffs to targeted areas; retain saved-scene data compatibility and other implemented features.
4. Test or at least inspect syntax/build when possible. State clearly what is **untested**. Check Streamlit deployment after merging to `main`.
5. Keep deployment tokens and other credentials out of commits and all handoff notes.
6. When application code changes, bump `VERSION`, describe what changed and what remains to do here, commit coherently, and record the resulting SHA. Do not assume a deployment succeeded solely because a commit was pushed.

## User's established goals

A broadcast-quality weather studio whose map is comparable to AguaceroWX: sharp high-resolution map, correctly weighted roads and locality labels, aesthetically matching land/water colors, responsive smooth panning/zooming without stop flicker, granular overlay controls, and retention of all existing Claude-created studio capabilities.

**Status at handoff:** v0.9.0 overlay code exists on `main`; next task is **live testing and targeted overlay fixes**, not wholesale reimplementation.
