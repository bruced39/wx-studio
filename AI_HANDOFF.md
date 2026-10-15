# WX Studio — AI Handoff

> Shared project continuity for ChatGPT and Claude. Update this file whenever code changes.
> Never assume this snapshot is the latest: read `main`, `VERSION`, recent commits, and relevant source files before editing.

## Last reviewed baseline

- Review date: 2026-10-14 (America/New_York; commits below are UTC on 2026-10-15).
- Repository: `bruced39/wx-studio`; default/deployment branch: `main`.
- **Last reviewed application version:** `0.9.2` (`VERSION`).
- **Last reviewed code:** Map Style flyout on `feature/map-style-flyout-v0-9-2` prepared for `main`; see latest GitHub commit before editing. Reference `MAP_STYLE_REFERENCE.md` for video details.
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
| 0.9.1 | `e9650e0` | Lat/Lon grid modes Off / On / Ocean Only with water polygon clipping and legacy interval migration |
| 0.9.2 | see Git log | Standalone Map Style toolbar popout; Custom/Dark/Satellite bases, saved styles, new Globe/Satellite/Waterways/Terrain options, Aguacero category ordering |

In 0.8.9 the broadcast ocean/water color default is `#1d253a`; bathymetry color `#000000`; parks `#252525`; building footprint `#242424`. Preserve existing saved scenes/settings unless a migration is explicitly necessary.

## Overlay implementation as of 0.9.0 — REVIEWED IN SOURCE, NOT UI-TESTED

Implemented under **Scene → Background → Mapbox map → Weather Director Broadcast → Overlays**:

- Day / Night Cycle (toggle).
- NWS Forecast Areas / County Warning Areas (CWA).
- NWS Public Zones.
- NWS Fire Weather Zones.
- NWS Coastal Marine Zones.
- Time Zone Boundaries.
- Latitude / Longitude Grid **Off / On (land + water) / Ocean Only**; color, width, opacity, automatic spacing and optional fixed interval. Ocean Only clips generated grid lines against loaded Mapbox Streets water polygons, using `sourcedata` refresh as water tiles arrive.

Boundary line controls offer enable, color, solid/dashed/dotted style, width, opacity, and min/max zoom. NWS layers use the NOAA/NWS ArcGIS reference-map service, with layer IDs 1 (CWA), 8 (public), 9 (fire), 5 (coastal marine). Time zones use the U.S. DOT/Bureau of Transportation Statistics ArcGIS layer. Each overlay defaults off.

**Verified:** the published NOAA service metadata includes these four IDs; the US DOT/BTS time zone endpoint is published. **Not verified:** live browser fetch/CORS, zoom/animation performance, rendering of all boundary layers in the deployed app, or visual matching against user screenshots.

## Current v0.9.2 Map Style video work

The user's 93.4-second AguaceroWX video was reviewed. **Read `MAP_STYLE_REFERENCE.md` before implementing further controls**: it records all 9 major categories, their order, settings, timestamps, and the outstanding parity gaps.

The top toolbar now has a camera-style Map Style button opening a scrollable floating settings panel with X close, Customize and Saved Styles tabs. It moves the existing Mapbox controls from the right Scene panel and reuses their bindings. The menu order is Overlays, Globe, Satellite Imagery, Land & Water, Transportation, Boundaries, Water Features, Labels, Terrain, Map + Camera. The top choices are Custom Color / Dark / Satellite; dark/custom background colors are user-selectable. Settings remain saved with the scene when switching base types.

New source features: flat dark/custom map background, native satellite shadow/highlight brightness tuning, adjustable globe fog/stars, vector waterways, and Mapbox terrain hillshade coloring. Matching px/% slider readouts, collapsible groups, reset and browser-local saved map style presets are present.

**Not yet finished:** Aguacero's full independently configurable label hierarchy (road signs, cities/dots, towns/dots, villages, hamlets, counties, countries, water labels, etc.), railroads, per-zoom styling toggles, polar projections, full custom Mapbox Style picker, and future data-overlay layer ordering. Avoid claiming complete pixel/function parity. These should be added incrementally without regressing current labels/maps.

**Testing status:** JS syntax validated in connector-side V8; actual deployed Streamlit map, Mapbox web rendering, popup UX and browser performance have NOT been tested. User needs to test after deployment.

## Next work / QA priorities

1. Open the deployed Studio and visually test the 0.9.0 Overlays panel using the user's AguaceroWX screenshots, with priority on exact settings hierarchy, label legibility and fine line styling.
2. Enable each NWS and time-zone overlay around Boston/New England; confirm geometry actually renders, can be styled, and honors min/max zoom. Check error console and performance. NWS fetches are viewport-based; ensure network responses remain complete and old requests do not overwrite newer viewport results.
3. **0.9.1 change needs a browser visual test:** confirm Ocean Only excludes land and islands at coastlines, reacts to pans and zooms without flicker, and that On spans land + water. Mapbox Streets `water` includes oceans and inland lakes; this implementation masks to water rather than distinguishing salt from freshwater. Grid intervals are now separate from the mode selector when auto spacing is off.
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

**Status at handoff:** v0.9.2 staged/published for popout and style modes; next is live browser test and advanced label parity from `MAP_STYLE_REFERENCE.md`. User confirmed v0.9.1 Lat/Lon lines work perfectly.
