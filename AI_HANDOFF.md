# WX Studio — AI Handoff

> Shared project continuity for ChatGPT and Claude. Update this file whenever code changes.
> Never assume this snapshot is the latest: read `main`, `VERSION`, recent commits, and relevant source files before editing.

## Last reviewed baseline

- Review date: 2026-10-14 (America/New_York; commits below are UTC on 2026-10-15).
- Repository: `bruced39/wx-studio`; default/deployment branch: `main`.
- **Last reviewed application version:** `0.9.6` (`VERSION`).
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
| 0.9.3 | see Git log | Folded map icon before Redo, clearer popup typography; flat-mode hydrography hidden (subsequently corrected) |
| 0.9.4 | see Git log | Shared satellite basemap and independent land/water colors (later refined) |
| 0.9.5 | see Git log | Clean Dark/Custom coastlines without inland lakes or roads; Ocean On/Off; county min zoom 6; stable Mapbox left-drag pan |

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

## v0.9.3 feedback and corrections

User screenshots (2026-10-15) showed the top toolbar using a camera glyph rather than a folded-map glyph, the Map Style flyout text appearing less crisp than AguaceroWX, and Dark/Custom Color basemaps still showing lakes and rivers. In v0.9.3:

- Replaced the camera svg with a compact folded-map svg placed immediately between **Undo** and **Redo (Ctrl+Y)**.
- Changed flyout typography to a screen-optimized Segoe UI/Arial stack with larger section/control fonts and stronger section-label rules; does not alter the actual city/town Mapbox glyph renderer.
- Dark and Custom Color now have a uniform selected fill for land and water in both Mercator and Globe. Suppress separate Mapbox Streets water fills, native waterways and hydro labels, custom WD water/coastline lines, water depth, national parks and the optional WD waterways. Saved toggles and style settings are **not overwritten** and remain available when switching back to Satellite, which is unchanged.
- **Requires live browser validation:** check Dark/Custom at coastal New England and Great Lakes, both projections and multiple zooms; confirm sea/lake layers do not show through and that Satellite settings restore. Verify popup labels are acceptably sharp at current browser zoom and Streamlit iframe size. Do not assume runtime rendering has been tested based on JavaScript syntax tests.

## v0.9.4 — corrected user reference (2026-10-15)

**User explicitly corrected v0.9.3:** They do **not** want land and ocean painted the same color. They want the **same coastlines, detailed islands/continents, water shapes, roads, cities, state/country boundaries, and other vector cartography used in Satellite** on Dark/Custom maps — only the satellite *imagery raster* should be replaced with an editable solid land color and independently editable ocean/lake color. Do not regress this by hiding hydrography.

Changes on `main`:

- All three broadcast bases use the **same `satellite-streets-v12` vector source/style** so toggling background does not change geographic detail. In Dark/Custom, Mapbox satellite raster layers are hidden, and original raster visibility is remembered/restored when selecting Satellite.
- Solid land fills use existing `broadcastDarkColor` / `broadcastCustomColor`. Water polygons use `broadcastWaterColor` at full opacity on non-satellite maps (satellite keeps previous tint behavior). The **Land & Water** section and the main style controls let the user select ocean/lake color.
- Restored vector waterway/coastline/park/bathymetry layers (where enabled). Coastline outlines include water polygon boundaries such as islands/lakes. The previous 'no water' flat-mode rule has been reverted. Original administrative boundary lines are positioned above the land/water backgrounds on non-satellite and made light *only when the original configured default would be nearly invisible*.
- Preview cards are now vector SVG for Custom/Dark and a real `@2x` Mapbox Static satellite thumbnail with vector fallback; they no longer use blurry gradient placeholders.
- Top folded-map toolbar button is moved **one position to the right**, after Redo: Undo → Redo → Map Style.
- **Important testing limits:** JS parse and source invariants can be checked, but actual Mapbox browser-rendered coastlines/visibility, low zoom island coverage, satellite card image loading, Mercator/Globe appearance, and scene export have NOT been visually confirmed. Test around New England, Caribbean archipelago, worldwide globe and coastline at all zooms. Check that switching back to Satellite restores raster imagery.
- Settings are the same objects/keys across all three bases. Preserve old shows/presets and do not overwrite any unrelated Scene/Claude code.

## v0.9.5 — clean broadcast maps + pan repair

User's 2026-10-15 screenshots clarify **Dark and Custom Color** map style:

- Only continent/island ocean shorelines, country and state boundaries, geographic place labels, with optional county boundaries. **Do not show inland lakes, rivers, local roads, airport lines, water depth, parks or 3D buildings** on Dark/Custom. Satellite retains all its working layers/settings (including radar-data-compatible layering).
- In Dark/Custom the default is **Show ocean color OFF**: land and ocean share the selected flat background, but coastline outlines stay on. If ocean is turned on, show a separate color picker and apply selected ocean color independently. Satellite unaffected. Setting keys: `broadcastOceanShow`, existing `broadcastWaterColor`, `broadcastCustomColor`, `broadcastDarkColor`.
- Mapbox Streets v8's `water` vector polygons **combine inland water with ocean**, with no class to filter. To separate sea from lakes, the flat styles use Natural Earth's **10m land polygon** (`ne_10m_land.geojson`, CC0) fetched lazily from the public Natural Earth GitHub repository. The land polygons have interior holes (lakes) removed in-memory so lakes stay filled as land. A world background gets ocean color when enabled, otherwise land color. A line on this land source supplies continent and island coastlines. No external token needed for the land data. The URL is not a credential; if unavailable, map won't show the external coastline geometry—check browser console for loading errors. The geojson is global and high-detail; confirm load/performance before building more features on top.
- **County boundaries On/Off and Min Zoom (default 6.0)** in Boundaries. The optional `wd-county-boundaries` layer filters Mapbox Streets v8 `admin_level=2` starting at `broadcastCountyMinZoom`; actual local coverage at particular zooms depends on Mapbox Streets data. Existing color and width controls preserved. County boundary defaults to Off.
- Reworked left-drag pan in **Select** tool to compute a stable camera coordinate from pointer-down with `MB.panByPixels`, rather than accumulating per-move offsets. Right-drag tilt/rotate, mouse wheel zoom, and screenshot precision unaffected. Please test explicitly in Mercator and Globe.
- Do not remove the working v0.9.1 grid choices Off/On/Ocean Only. The grid's own Ocean Only mode still uses Mapbox water geometry and was already confirmed working by the user. Do not confuse that with **Show ocean color**.
- **Tests completed:** syntax of mapbox.js/ui.js, mocked style install for Ocean off/on/Satellite and Natural Earth polygon hole removal. **Untested in deployed browser:** GitHub-hosted Natural Earth data fetch/CORS, outlines and counties over New England/Caribbean, actual left-drag pan, performance and video export. Do not claim those tests were performed.
- The toolbar still has Undo → Redo → folded Map Style icon; keep it.
- Next: user live visual QA, then iterate only confirmed rendering issues and the full independent Labels parity list from `MAP_STYLE_REFERENCE.md`.

## Emergency v0.9.6 editor startup hotfix

On Oct 15, 2026 the user reported v0.9.5 loaded an empty black stage, empty left tools and empty right inspector, even after restarting Streamlit. Root cause identified in `studio/ui.js`: `boot()` calls `buildTools()` before initializing `S.show`; `buildTools()` calls `setTool('select')`; v0.9.5 newly added `cur()?.bg?.type` inside `setTool()`. The optional chaining on `cur()` **does not guard the dereference inside `cur`**, which reads `S.show.scenes` when `S.show` is still null. This throws and aborts `boot`, leaving the UI blank. v0.9.6 changes only that cursor condition to use `S.show?.scenes?.[S.si]?.bg?.type`, which is safe before load.

- Verified with a focused V8 test calling `setTool('select')` when `S.show=null` and a syntax parse.
- **Do not add code paths accessing `cur()` before `S.show` is initialized.**
- v0.9.5 map changes are retained; still need live browser validation. Next ask user to refresh and confirm tools, scene panel and map return before further map changes.
- This is a startup hotfix, not verification of third-party Natural Earth coastline loading or browser pan behavior.

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

**Status at handoff:** v0.9.6 emergency startup fix restores safe initialization of Select tool; user must verify the deployed app boots. v0.9.5 map changes remain in place pending live QA.
