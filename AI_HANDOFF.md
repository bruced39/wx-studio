# WX Studio — AI Handoff

> Shared project continuity for ChatGPT and Claude. Update this file whenever code changes.
> Never assume this snapshot is the latest: read `main`, `VERSION`, recent commits, and relevant source files before editing.

## Last reviewed baseline

- Review date: 2026-10-16 (America/New_York; older entries below retain their original dates).
- Repository: `bruced39/wx-studio`; default/deployment branch: `main`.
- **Last reviewed application version:** `0.9.67` (`VERSION`).
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

## v0.9.7 — Pan Map and Satellite startup default

User reported on Oct 15, 2026 that left-mouse panning still did not work after v0.9.6 and the studio started in a non-Satellite map, ignoring the previously saved default camera.

- Added **✋ Pan Map** to the left tools and select it by default after the Mapbox show is initialized. Left-drag moves the map even when weather objects cover the background; users may choose **⌖ Select** to edit graphics. Right-drag orbit and mouse wheel zoom retain previous behavior. Select still pans when clicking an empty map.
- Replaced projector-based inverse-coordinate pan with native `P.panBy([dx/MB.scale,dy/MB.scale],{duration:0})`, starting from a fixed pointer-down camera, and retrieving `P.getCenter()`. Added mathematical pan fallbacks for Mercator and Globe if the off-screen projector is temporarily unavailable. Pan uses cumulative drag offsets from pointer-down, avoiding drift.
- The startup map now uses **Satellite** and **the saved default map camera** (stored under `wx.studio.defaultMap.v1`) even if an autosaved show is restored. To protect existing user work, only the FIRST scene background is replaced by the saved default; all scene objects, subsequent scenes, and other settings in the show are retained. Saved camera zoom, center, bearing, pitch and overlays remain. If no saved-default entry exists in this browser, the autosaved map camera stays in place but Satellite becomes the active base.
- New Show and Default View already use `defaultMapBg()`, which now opens saved defaults with Satellite. Saving a new default still records the map's current camera and settings; boot normalizes the base to Satellite.
- **Tests:** JS parse, saved-default vs restored-session precedence with an in-memory localStorage mock, absence of a saved default, preservation of weather objects, null-show tool initialization, Pan method mocked against native Mapbox methods, Mercator and globe fallback. **Not tested in deployed browser:** real Firefox/Mapbox/Streamlit drag events, actual persisted localStorage entries on user's machine, simultaneous scene objects, Mapbox camera at high pitch. User to verify after redeploy.
- **Important:** Never dereference `cur()` during pre-show `buildTools()`; the v0.9.6 blank-screen fix remains. Do not replace saved user map settings with defaults other than explicitly selecting Satellite as requested.
- Development is still pending full Aguacero label parity, further QA of clean coastline land source, and camera smoothness.

## v0.9.8 — pan direction and named view+style presets (2026-10-15)

- User confirmed v0.9.7 **pan motion was reversed**: dragging right sent the visible map left, and dragging up sent the visible map down. Fixed only the native Mapbox projector call: `P.panBy([-dx/s,-dy/s],{duration:0})`. The existing Mercator/globe mathematical fallback already moved the content with the cursor; its signs are unchanged. Tests simulated all four directions with the observed Mapbox center behavior.
- The **Map Style > Saved Styles** section already had named, browser-local, style-only presets. New saves now include `camera:{c:[lon,lat],z,b,p}` from `E.viewAt(cur(),editT())` in addition to all Mapbox defaults/settings and projection. Name entered through prompt when clicking **Save Style**. The Saved Styles tab now shows a brief zoom/projection/base descriptor and **Load Preset** action; applying it restores both settings and camera in the current scene, clears prior camera animation `view2/camDur/camDelay`, and sets `S.editEnd=false`. Existing user-created weather objects and other scenes are not touched.
- **Legacy saved styles without a camera are supported**: applying them changes only settings and leaves the current camera in place. Existing preset names remain, and saving a duplicate name asks to replace it. No migration/deletion of the browser storage key `wx.studio.mapStylePresets.v1`.
- IMPORTANT: Presets currently live in **browser localStorage**. They are not saved to GitHub/cloud or embedded in downloaded `.wxshow.json` shows; changing browser/device or deleting site data could lose them. If cloud-synced preset library is wanted, build it as a separate feature later.
- The separate **Save Default View** feature is unchanged; loading a preset does not automatically make it the default starting map. To use a preset as the default, load it and click Save Default View.
- Focused V8 tests passed for named preset saving/restoration (including location, zoom, pitch, bearing, overlays, and projection), legacy style-only compatibility, and right/left/up/down pan directions. Full Streamlit + Firefox browser interactions still need the user's visual verification.
- Do not regress v0.9.6 safe startup or v0.9.7 dedicated Pan Map tool. Next: user verifies drag direction and presets, then continue any remaining Aguacero parity work.

## v0.9.9 — private cloud map presets (2026-10-15)

A brand-new, ISOLATED Supabase project **WX Studio** was created under **Dave's Org**, US East, at a quoted **$0/month**. Project ID: `lcujugmyyuumrshdasla` (URL `https://lcujugmyyuumrshdasla.supabase.co`). This is NOT the old WXfusion Supabase project `caszmwcapacaofvcrzli`. Do not connect WX Studio's public browser client to the old forecast database.

- Applied `supabase/migrations/20261015_create_wx_studio_map_presets.sql` to the NEW isolated project and verified `public.wx_studio_map_presets` is the only table and row-level security is enabled with SELECT/INSERT/UPDATE/DELETE policies restricted to signed-in `auth.uid() = user_id`.
- `app.py` now injects this isolated project's intentionally PUBLIC Supabase `sb_publishable_` key and endpoint into the studio iframe; browser-safe publishable keys are not service-role secrets. Optional `WX_SUPABASE_URL` and `WX_SUPABASE_PUBLISHABLE_KEY` Streamlit secrets can override defaults if the project changes. **No manual secrets setup is required for the normal deployment. Never commit Supabase secret/service-role keys.**
- `studio/cloud_presets.js` handles email/password sign-up, sign-in, refreshed per-browser session, sign-out and authenticated cloud preset list/upsert/delete, using Supabase REST. `studio/index.html` loads this module before `studio/ui.js`. `wxbuild.py` inlines all JS modules as before.
- Map Style → Saved Styles now has **Cloud Presets** (sign in/create account/refresh/load/delete/sign out) plus **This Browser — Local Presets**, with an **Upload Local Presets to Cloud** action that keeps old browser copies. While signed in, Save Style becomes **Save to Cloud**, saves the current map center, zoom, bearing, tilt, projection, colors, labels, coastline/boundaries and overlays under a user-supplied name. Old style-only presets without camera remain compatible.
- Loading only replaces active scene map settings/view; user can pan, zoom, edit further without changing stored preset until they deliberately save it again. Existing weather graphics, other scenes, and **Save Default View** remain separate.
- The NEW project has no WXfusion forecast data. Existing WXfusion's five forecast tables without RLS were NOT modified; that separate security advisory still merits later review.
- `CLOUD_PRESETS_SETUP.md` now covers account setup, user controls and security. Auth email confirmation and actual multi-device browser behavior need LIVE user verification; the cloud JS REST client was tested with mocked sign-in/list/upsert/delete/sign-out. The isolated DB schema/RLS policies were verified by Supabase.
- Preserve the v0.9.6 startup null-show safeguard, v0.9.8 corrected map panning, scene compatibility and Claude's features. Do not alter unrelated code.

## v0.9.10 — Cloud account input text contrast

- Fixed unreadable email/password text in **Map Style → Saved Styles → Cloud Presets → Create Account/Sign In**. The new input types in v0.9.9 were not included in the global dark input CSS; browsers used their white default input backgrounds while inheriting the studio's near-white foreground text.
- Updated **studio/index.html only** for the application CSS: email and password share the existing dark background with explicit high-contrast light text, caret color, visible placeholder color and WebKit autofill styling. No login handler, cloud project, map controls, preset data or Supabase code changed.
- Source CSS verified to contain selectors and readable colors. Live browser visual check still required, especially Firefox/Windows autofill.
- Do not accidentally regress v0.9.6 startup or cloud auth from v0.9.9.

## v0.9.12 — administrative boundary rendering, pan after restyle, zoom toggle

On Oct 15, 2026, user reported that Show Zoom off continued displaying a badge, that left-drag map panning could freeze after changing county width, that zoomed-in country/state/county lines looked thin/washed out/dashed and ugly when enlarged, and that border sliders with matching thumb positions displayed different pixel values.

- `studio/mapbox.js` hides original, multiply drawn Mapbox Streets administrative line layers (which have their own width/blur/dash/opacity). Draws **one dedicated solid line layer per admin level** using Streets v8 `admin` source: `admin_level` 0 country, 1 state/province, 2 county/second-level. Sets `line-opacity:1`, `line-blur:0`, round caps/joins, pixel width exactly from user control. Uses proper text-valued `maritime:'true'` exclusion. Respects per-layer show/color/width settings; county min zoom defaults 6. Avoid adding duplicated lines across restyles. Original coastline drawing remains unchanged. Note county availability depends on native Streets v8 second-level coverage.
- `studio/ui.js` boundary sliders coastline, country, state and county now share the **identical 0.25–8.0 px range with 0.05 px step** and visually consistent readouts; old preset pixel values aren't migrated or changed. All widths can now match.
- Live Mapbox camera canvas stays available for panning **while a changed style/config is still waiting for a background snapshot** (provided same Mapbox base style/projection), preventing the frozen preview after changing line width. Renderer applies new styling once interaction ends. Tested mock with pending config and stable old base.
- Zoom overlay now requires `showZoomBadge===true` and Show Zoom toggle invokes immediate `drawOverlay()` repaint, rather than waiting on stale preview or treating undefined as on. Mapbox background defaults already set showZoomBadge true.
- Source checked for JS syntax; mocked border layer setup test confirms exactly 3 lines, full opacity/no dash, custom widths, county off and min zoom 6; mocked live map while config pending passes.
- **Live browser QA required**: dark/custom vs satellite, low/high zoom detail/line colors, county coverage, toggle Show Zoom off, right/left pan immediately after changing border sliders, no icon/scene/cloud regressions. Original color choices preserved: user may need to change dark black borders to a light color for Satellite contrast. The slide renderer uses its native 1920x1080 pixel scale, so thin strokes can appear narrower in resized preview.
- Claude published v0.9.11 HD animated weather icons; preserved **all Claude changes** by branching from v0.9.11 main commit `fc526f5`. Only mapbox.js/ui.js (plus VERSION/handoff) changed here.

## v0.9.13 — live, continuously updating zoom readout

User reported that in v0.9.12, unchecking Show Zoom hid the zoom badge correctly, but zooming after rechecking left the displayed number frozen until toggling the checkbox off/on again.

- Moved ONLY the zoom badge out of the shared drawing canvas into its own absolutely positioned, SVG-backed overlay in `studio/index.html` (`#mapZoomBadge`, text `#mapZoomValue`). SVG retains the old badge's relative size, colors, outline, and placement on the 1920×1080 stage; `pointer-events:none` preserves map panning, selection and weather-object interactions.
- `studio/ui.js` `updateZoomBadge()` reads the **active scene camera** via `E.viewAt(scene,editT())` on every rendered editor animation frame independently of Mapbox tile/background rendering. It updates only if text changes and hides unless the scene is a Mapbox background and `showZoomBadge===true` and edit mode. A mouse wheel zoom also updates it directly in the same event; zoom slider and Show Zoom checkboxes call it immediately.
- Removed the legacy 2D-canvas badge draw so no stale/duplicate badge can be left behind. Playback and presentation still hide this editor-only readout.
- **Tests:** JavaScript parsing; mocked DOM/state camera changes from 6.8 → 7.3 → 9.55 with checkbox untouched, off/on behavior, scene change and playback state. Checked SVG/CSS and live render callback presence. Still requires user live Streamlit verification that zoom readout follows zoom input and doesn't obscure the map or intercept pointer events.
- Preserves v0.9.12 border fixes, Pan Map, named cloud presets and all Claude v0.9.11 HD animated icon features. Do not regress or modify those.

## v0.9.19 — ocean-only coastlines versus inland water outlines (2026-10-15)

User reported satellite maps at regional zoom showed many unintended black irregular lines running through states. They were outlines around inland water features caused by `wd-coastline-outline` using the Mapbox Streets v8 `water` polygons (merged oceans, lakes, rivers and reservoirs). They asked to distinguish **Ocean & Island Coastlines** and **Inland Water Outlines**, with inland outlines **OFF by default**. This update implements that without losing ocean coasts or changing the satellite imagery/background.

- `studio/mapbox.js` keeps existing `broadcastShowCoastline` / `broadcastCoastlineColor` / `broadcastCoastlineWidth` setting keys, but **replaces the old merged Streets `water` line**, for both satellite and flat-color maps. The new `wd-ocean-coastline` line uses Natural Earth `ne_10m_coastline.geojson` (continent and major-island ocean shorelines), and `wd-minor-island-coastline` uses `ne_10m_minor_islands_coastline.geojson` for small ocean islands. Both draw clean, solid, antialiased strokes with the user's existing coastline color/width. The old `wd-coastline-outline` and `wd-flat-coastline` layers are removed during restyling; the old Streets `water` outline is no longer created.
- Added `broadcastInlandWaterOutlines:false`, `broadcastInlandWaterOutlineColor:'#050505'`, `broadcastInlandWaterOutlineWidth:1` defaults. If user opts IN, lazily load Natural Earth `ne_10m_lakes.geojson` and `ne_10m_rivers_lake_centerlines.geojson` to draw `wd-inland-lakes-outline` and `wd-inland-rivers-outline` independently of coastline outlines. On first load, empty GeoJSON placeholders are used, then the async fetched geometry is installed and map preview cache invalidated. Data requests and parsed geometry are cached across restyles. Standard satellite water tint and all unrelated Mapbox layers remain unchanged.
- `studio/ui.js` **Map Style → Boundaries** controls are now **Ocean & island coastlines** (toggle), **Ocean coastline color**, **Ocean coastline width (px)**, then **Inland water outlines** (toggle, Off by default), **Inland outline color** and **Inland outline width (px)**, followed by the existing country/state/county controls. Both widths share the v0.9.12 common 0.25–8 px scale. Existing saved presets continue to work because original coastline keys are unchanged, and new keys use WD_DEFAULTS migration.
- **Tests completed:** parsed both JS files; mocked map layer stack verified ocean+minor islands present and inland outlines absent by default, inland outlines added when requested, independent toggles, line width, old merged water line not recreated. **Not browser-tested:** runtime fetches of 10m Natural Earth geometry from public GitHub; line alignment against Mapbox imagery at high zoom; data download performance; Globe projection; live cloud preset loading. User must confirm in Streamlit before claiming final visual parity. The Natural Earth coastline is generalized, so it will not have the same sub-meter detail as Mapbox raster satellite at extreme zoom.
- Preserved all concurrent Claude additions in **v0.9.14–v0.9.18** (snow, heavy snow, Blizzard and other animated/static weather icons); this patch updates only `studio/mapbox.js`, `studio/ui.js`, VERSION and this handoff, branching from Claude's main commit `6a8b363`. Do not inadvertently overwrite Claude commits or reset their app VERSION.

## Next work / QA priorities

1. Open the deployed Studio and visually test the 0.9.0 Overlays panel using the user's AguaceroWX screenshots, with priority on exact settings hierarchy, label legibility and fine line styling.
2. Enable each NWS and time-zone overlay around Boston/New England; confirm geometry actually renders, can be styled, and honors min/max zoom. Check error console and performance. NWS fetches are viewport-based; ensure network responses remain complete and old requests do not overwrite newer viewport results.
3. **0.9.1 change needs a browser visual test:** confirm Ocean Only excludes land and islands at coastlines, reacts to pans and zooms without flicker, and that On spans land + water. Mapbox Streets `water` includes oceans and inland lakes; this implementation masks to water rather than distinguishing salt from freshwater. Grid intervals are now separate from the mode selector when auto spacing is off.
4. Verify Day/Night shading's terminator and how its data refreshes when the scene is stationary; 0.9.0 refresh is attached to Mapbox `moveend`.
5. Confirm 0.8.8 smooth Mapbox navigation and flicker-free stop behavior are still intact with overlays enabled; avoid large synchronous/async updates on every camera step.
6. Continue matching AguaceroWX cartography: city/town names, resolution/sharpness, road widths and coloring, coastline/water behavior. Do not change Claude's other UI features.
7. The previously discussed **Put Ocean/Land Over Added Layers** control was consciously deferred until the proper weather-data overlay stack exists. Do not mistakenly mark it complete.
8. After a successful live visual test, correct confirmed issues in small commits, increment `VERSION` for application changes, and update this file.

## v0.9.11 – HD animated weather icons (Claude)

- Added `studio/icons_hd.js` + `studio/icons_hd_art.js` (user's own sun / cloud artwork embedded as data URIs; loaded right after `icons.js`). They extend `window.Icons`; `icons.js` itself is untouched.
- Library now has **Animated** and **Static** categories (first in the list). Animated ids that match an original id (`sunny`, `partly-cloudy` = "Partly Sunny", `mostly-sunny`, `cloudy`, `rain`, `drizzle`, `heavy-rain`) replace the old icon of that name; new ids: `showers`, `heavy-rain-wind`, `mostly-sunny-rain`, `mostly-sunny-showers`. Static copies use id `<id>-static` and label "<name> (Static)". The 7-Day builder uses the same list, so animated icons are available there.
- Only `studio/index.html` (two script tags) and the library hint text in `studio/ui.js` were touched in shared files. More icons will be appended to the `ICONS` array in `icons_hd.js` as the user approves them; originals not yet replaced still come from `icons.js`.
- v0.9.14: added animated/static **Flurries** (`flurries`, snowflake generator `snow()` in `icons_hd.js`; replaces the original `flurries` entry in the library).
- v0.9.15: added animated/static **Light Snow** (`light-snow`, new addition; no original id).
- v0.9.16: added animated/static **Moderate Snow** (`moderate-snow`, new addition).
- v0.9.17: the v0.9.16 "Moderate Snow" entry was renamed to **Snow** (`snow`, replaces the original `snow`); added animated/static **Heavy Snow** (`heavy-snow`, replaces the original).
- v0.9.18: added animated/static **Blizzard** (`blizzard`, replaces the original; `blizzard()` in `icons_hd.js`).
- v0.9.20: library is **day-only**. The new `showers` icon stands in for the original `showers-day`/`showers-night` (aliases in `icons_hd.js`), all remaining `*-night` icons are hidden from the library list, and `Icons.fromText` always returns day icons. Saved scenes that reference night ids still draw.
- Next icon update: `light-rain` ("Light Rain") and new `light-showers` reuse the Showers artwork, `snow-showers-day` ("Snow Showers") reuses Light Snow, and `overcast` is aliased to `cloudy` and removed from the library (weather text "overcast" now returns `cloudy`). Duplicates are listed as separate Animated + Static entries via the `ICONS.push(...)` block in `icons_hd.js`.
- v0.9.22: added animated/static **Sun_Thunderstorms** (`sun-thunderstorms`, new addition; the original `thunderstorm`/`tstorm-day` are untouched). User artwork with the original bolt removed (`sunstorm` in `icons_hd_art.js`) plus a procedural branching lightning bolt (`makeBolt/strike/drawBolt`, `sunStorm()` in `icons_hd.js`); ICONS entries may now carry `st` = phase used for the Static still (strike peak).
- v0.9.23: added animated/static **Thunderstorms** (`thunderstorm`, replaces the original `thunderstorm`). Uses the cloud from the user's reference icon (`stormcloud` art in `icons_hd_art.js`, bolt/rain removed) plus rain streaks and the procedural lightning bolt (`thunder()` in `icons_hd.js`; `drawBolt` got an optional width multiplier). `sun-thunderstorms` unchanged.
- v0.9.24: all drop-rain icons (Rain, Showers, Light Rain, Light Showers, Drizzle, Heavy Rain, Mostly Sunny/Rain, Mostly Sunny/Showers, Thunderstorms) now use glossy raindrop sprites cut from the user's reference photo (`drop0..11` in `icons_hd_art.js`; `rain()`/`rainLayout()` in `icons_hd.js`, ~half the old streak count, drops fall along their own ~20 degree slant, layouts picked to avoid clumping). Snowflakes unchanged (user prefers the original procedural flakes). Heavy Rain & Wind still uses the curved wind-swept streaks (`windRain`).
- v0.9.25: added animated/static **Wintry Mix** (`wintry-mix`, replaces the original `wintry-mix`): Cloudy cloud + raindrop sprites (`rain()`) and the original procedural snowflakes (`snow()`) falling together.
- v0.9.26: `sun-thunderstorms` now also has raindrop sprites; for it and `thunderstorm` the drops are born under the solid cloud body and fade in at its underside (`rain()` accepts `p.mask = { k: <art key> }`; `cloudBase()` reads the cloud underside from the art alpha). Other rain icons unchanged.
- v0.9.27: all snow icons (Flurries, Light Snow, Snow, Heavy Snow, Snow Showers, and the flakes in Wintry Mix) use a new `snow()` layout: random flakes whose positions are re-rolled until no two crowd or overlap at any moment of the loop (`snowLayout()` in `icons_hd.js`). Flake art unchanged; Blizzard unchanged.
- v0.9.28: added animated/static **Mostly Cloudy** (`mostly-cloudy`, replaces the original; user's sun+cloud artwork `mcloudy` in `icons_hd_art.js`, breathing glow + shimmering rays, `mostlyCloudy()`); **Snow Showers** is now its own icon with 7 flakes (between Flurries 5 and Light Snow 10) instead of a copy of Light Snow; **Blizzard** has less wind effect (shorter/shallower streaks, more tumbling flakes, still blows left).
- Verified in headless Chromium: library renders both categories with no script errors; live look inside the user's browser still to confirm.

## Rules for alternating between ChatGPT and Claude

1. **Before editing:** read GitHub `main` HEAD, `VERSION`, recent commits, and `AI_HANDOFF.md`. Compare against your last known SHA; read changed files before touching them.
2. Avoid two writers editing the same file at the same time. Never replace whole source files with an earlier snapshot; preserve edits from the other AI.
3. Limit diffs to targeted areas; retain saved-scene data compatibility and other implemented features.
4. Test or at least inspect syntax/build when possible. State clearly what is **untested**. Check Streamlit deployment after merging to `main`.
5. Keep deployment tokens and other credentials out of commits and all handoff notes.
6. When application code changes, bump `VERSION`, describe what changed and what remains to do here, commit coherently, and record the resulting SHA. Do not assume a deployment succeeded solely because a commit was pushed.

## User's established goals

A broadcast-quality weather studio whose map is comparable to AguaceroWX: sharp high-resolution map, correctly weighted roads and locality labels, aesthetically matching land/water colors, responsive smooth panning/zooming without stop flicker, granular overlay controls, and retention of all existing Claude-created studio capabilities.

**Status at handoff:** v0.9.19 separates ocean/island shorelines from optional inland-water outlines (off by default) on both Satellite and flat maps, preserving Claude's v0.9.18 code and cloud presets. Awaiting browser shoreline/line-performance QA.

## v0.9.29 – 7-Day builder: Magenta panel checkbox + template self-heal
- 7-Day Forecast Builder has a new per-day "Magenta" checkbox (`d.hl`). `E.build7DayBW` draws a semi-transparent magenta rect (`rgba(220,30,175,0.6)`) over that day's template panel (days 1-5: y 280-948; day 6: 280-628; day 7: 722-1070 in 1920x1080) beneath the header/content, so the background still shows through.
- Template robustness: `ensureBG()` in ui.js re-registers `assets.bg7day` (window.WX_BG7DAY) on boot and loadShow whenever a scene references it; autosave no longer stores the 335 KB template in localStorage (avoids quota loss).
- Files: studio/engine.js, studio/ui.js. No ChatGPT-modified code touched.

## v0.9.30 – Magenta = #ff00c6 @ 65%; "+ Scene" inserts a blank scene
- Magenta highlight panel now `rgba(255,0,198,0.65)` (user's #ff00c6 at the template's 65% opacity).
- `+ Scene` (ui.js newScene) now inserts a blank scene (solid #101820 background, no title, no objects) instead of copying the previous scene's background. Files: studio/engine.js, studio/ui.js. No ChatGPT-modified code touched.

## v0.9.31 – Drag icons from the Library onto the canvas
- Library icons are now `draggable`; dropping one on the stage places an icon object at the drop point (selected, default size 220, resizable/movable afterwards). Click-to-place still works. Drop handler in ui.js reuses the existing file-drop listener (`application/x-wx-icon`). File: studio/ui.js. No ChatGPT-modified code touched.

## v0.9.32 – Default background for new scenes
- User's cloud-sky image (studio/bgdefault.js, `window.WX_BGDEFAULT`) is now the background of blank scenes made by "+ Scene" (asset id `bgdefault`, re-attached via `ensureBG`, kept out of localStorage autosave). Future: a saved-backgrounds section to choose from (requested, not built). Files: studio/bgdefault.js (new), studio/index.html, studio/ui.js. No ChatGPT-modified code touched.

## v0.9.33 – Backgrounds tab (saved backgrounds)
- New "Backgrounds" side tab: upload images (click or drop, multi-file; resized to <=1920 px wide JPEG, stored in IndexedDB `wxstudio-bgs`), click a thumbnail to apply it to the current scene, ✕ deletes uploads, ★ picks the background used by "+ Scene" (localStorage `wx_bg_default`). Built-ins: Default sky, Billerica 7-Day template. Files: studio/ui.js, studio/index.html. No ChatGPT-modified code touched.

## v0.9.34 – Hint for multi-click drawing tools
- Selecting Front/Arrow/Isobar shows a toast explaining: click each point, double-click or Enter to finish. Investigated "can't draw on the map": in headless (no Mapbox/internet) every bottom-bar tool creates objects on non-map scenes; map scenes could not be verified without a live map. No ChatGPT-modified code touched. File: studio/ui.js.

## v0.9.35 – Background image fit modes
- Image backgrounds have `bg.fit`: `blur` (default: whole image + blurred/darkened fill), `fill` (crop), `solid` (whole image + `bg.fitColor` bars), `stretch`. Switch is "Image fit" in Scene panel > Background (image backgrounds). 16:9 images look identical in all but stretch/fill-with-different-shape. Files: studio/engine.js, studio/ui.js. No ChatGPT-modified code touched.

## v0.9.36 – Resilient scene drawing + visible draw errors
- User video (Streamlit, live Mapbox scene) showed Front/H clicks creating objects but nothing drawing, not even the draft dots or the scene title: consistent with renderScene throwing each frame (loop swallowed it into console.error). E.renderScene now guards background, each object, title and bug separately; the editor loop still draws the overlay after an error and shows a one-time "Drawing error: <message>" toast (E.onDrawError). With a stub projection in headless all tools work, so the real cause is still unconfirmed. Files: studio/engine.js, studio/ui.js. Touches map-adjacent drawing code but not the ChatGPT map files (mapbox.js).

## v0.9.37 – Drop shadows on every object
- New per-object `shadow` ({on, blur, dist, alpha}); default ON (blur 12, dist 7, opacity 0.6) for all types except `shape` and `image`. Composited in engine.js `drawShadowed` (object drawn to a scratch canvas then blitted with a canvas shadow, so existing glows still work). Object panel has a Shadow section (checkbox, Softness, Distance, Opacity). Files: studio/engine.js, studio/ui.js. No ChatGPT-modified files touched (mapbox.js untouched).

## v0.9.38 – Assets tab: Banners & Graphics overlays (transparent PNGs)
- "Backgrounds" tab renamed **Assets** with sub-tabs Backgrounds | Banners | Graphics. Banners/Graphics keep PNG transparency (IndexedDB `wxstudio-bgs`, records have `kind`; asset ids `ov_<id>`; autosave strips library assets that exist in IndexedDB and `reattachLib()` restores them on load; Save Show files still embed them).
- Click an item (or drag it onto the stage) to add an image object at Upper left/right, Lower left/right, Top/Bottom center or Center (safe margin `S.show.safe`, default 48px), sizes Original/75/50/33/20% of frame width, entrance Automatic (from nearest edge) or fixed. Object panel for images has Position buttons. Image resize handle now keeps aspect ratio (Shift = free).
- New entrance animations in engine.js: in-left/in-right/in-top/in-bottom (slide from the frame edge).
- NOT done: cloud sync of banners (needs a new Supabase table/storage bucket + RLS; existing cloud presets are in cloud_presets.js by ChatGPT). Files: studio/engine.js, studio/ui.js, studio/index.html. mapbox.js / cloud_presets.js untouched.

## v0.9.39 – Text styles
- Text objects: Outline (strokeW/strokeColor), Gradient fill (color→color2), Gloss highlight, and box styles (plain/titlebar/red/glass) plus a Preset dropdown (Title bar, Red alert panel, Glass panel, Outline, Gold, Chrome) via `E.applyTextPreset`. The old built-in text shadow was removed (the per-object drop shadow from v0.9.37 handles it). Built-in "Default sky" background uses fit=fill so its 3:2 shape is cropped, not letterboxed. Files: studio/engine.js, studio/ui.js.

## v0.9.40 – Snap, guides, safe margin, align & distribute
- Dragging an object snaps to the frame edges/center, the safe-margin box (`S.show.safe`, default 48 px) and other objects' edges/centers (12 px threshold, magenta snap lines; guide box shows while dragging). Scene panel > "Layout & Guides": Snap on/off, Show guides, Safe margin slider, and "Align & distribute…" dialog (tick objects; align to selection or frame; left/center/right/top/middle/bottom; distribute H/V). Toggles saved in localStorage `wx_snap`. Files: studio/ui.js. mapbox.js untouched.

## v0.9.41 – Broadcast widgets, auto time text, templates
- New object types (engine.js drawWidget, added from the toolbar "＋ Add…" dropdown): `citytemp` (name + value badge, optional color-by-temperature, pointer to the city; fields are plain strings so data can be bound later), `callout` (anchor dot + leader line + label/value box), `legend` (radar/precip/snow/temp gradient bar with left/right labels), `ticker` (scrolling alert band with tag). Text gained `auto` ('valid','datetime','date','clock' – evaluated at draw time) for the valid-time box, clock and date bugs, and `wrapW` (wrap width). 
- "Templates…" button next to 7-Day…: Storm Update (red panels), Weather Headlines (glass panels), Storm Impacts (keeps the current map background; time frame box, red panels, valid time). Built by `E.buildTemplate`/`E.sceneFromTemplate`.
- Files: studio/engine.js, studio/ui.js, studio/index.html. mapbox.js / cloud_presets.js untouched.

## v0.9.42 — private cloud Assets (2026-10-16; ChatGPT)

**Starting main:** Claude's v0.9.41 commit `c4707d9`; baseline verified before edits. Preserved Claude's v0.9.38–0.9.41 Assets/graphics, guides, templates, widgets, and typography features. `studio/engine.js` was NOT changed.

- Created private PNG-only Supabase Storage bucket `wx-studio-banners` in dedicated WX Studio project `lcujugmyyuumrshdasla`, max **8 MiB** per file, and `public.wx_studio_assets` metadata (`id,user_id,kind,name,storage_path,width,height,created_at,updated_at`), unique `(user_id,kind,name)`. Applied owner-only RLS for metadata and each Storage action (SELECT/INSERT/UPDATE/DELETE), using `<auth.uid>/<kind>/<uuid>.png` paths. Anonymous table access revoked. Applied SQL tracked in `supabase/migrations/20261016_create_wx_studio_private_assets.sql`; table/bucket/policies verified in Supabase. No service-role keys or new cloud credentials committed.
- Added `studio/cloud_assets.js` client that reuses the existing `WXCloudPresets.ensureSession()` and public project config, uploads/downloads PNG bytes without changing transparency, generates short-lived signed preview links for private thumbnail display, and supports list, save/upsert by name, rename, delete. PNG signature, dimensions, 8 MiB limit and owner-path validation built in. `studio/index.html` adds only a JS include after cloud_presets.js; `wxbuild.py` bundles it automatically.
- Added targeted `studio/ui.js` Assets panel integration, leaving original IndexedDB `wxstudio-bgs`/`bgs` local library intact. Banners/Graphics now accept original PNGs (NO conversion/canvas downscale), have per-item **Save to cloud** and **Upload all local items to cloud**, while each Assets sub-tab (Backgrounds/Banners/Graphics) has **Cloud library** with authenticated thumbnail, click/download to local, rename and delete. Download creates a normal local asset `ov_<id>` (or `bg_<id>`) without modifying existing scenes. An optional JPG background **cloud copy only** converts to PNG; local file unaffected. Offline failures do not delete local assets.
- `CLOUD_PRESETS_SETUP.md` extended with user-facing first-use instructions, account sign-in reuse, cross-browser test checklist and confirmations. `tests/cloud_assets.test.js` adds Node built-in test runner coverage. Helper functions tested with mocked Supabase auth/REST/storage for original PNG byte equality, owner separation, CRUD, temporary signed thumbnail links, invalid MIME and paths. **Real two-device/browser validation still required.**
- **Touched Claude-shared files:** `studio/ui.js` (minimal targeted Assets panel additions and PNG import branch), `studio/index.html` (one cloud script tag). **Not touched:** `studio/engine.js` and unrelated layouts/templates/text styling; no breaking object-ID migration.
- **Future cautions:** Cloud items do NOT get inserted into the user's scene automatically; first download into local IndexedDB, then click local thumbnail to place. Delete cloud does not remove local files. The user's cloud login is the SAME map-presets login. Upload limit and PNG-only MIME apply to Storage bucket, not offline local photo workflows.


## v0.9.43 — cloud Assets offline retry safeguard (2026-10-16)

After publishing the v0.9.42 cloud Assets feature, identified a failed cloud list request could cause an automatic retry loop in the Assets panel. `studio/ui.js` now tracks attempted loads per signed-in account and Assets sub-tab, retries only when user clicks **Refresh cloud**, and resets attempt flags on account switch. The local IndexedDB library, map presets, engine, other Claude features, and all data remain unchanged. JavaScript syntax checked; user should test offline/online switching in the Assets panel.

## v0.9.44 – Title banner #2 + Layer Style window (Claude)
- Scene panel accordions: existing "Title Banner" renamed **Title banner #1**; new **Title banner #2 (your banner + logo)** (closed by default, click heading to open/close). Uses the user's transparent banner + Billerica Weather logo (studio/tb2.js, `window.WX_TB2`, cropped PNGs). Per-scene `scene.title2` {show,text,pos ul|ur|full,width,y,logo,logoScale,align,size,upper,color,anim,delay,fx}; drawn in engine.js `drawTitle2` after `drawTitle`. Default text style = user's Photopea style: Roboto Condensed 700, #07345a, 2px outside stroke #1f2f57, drop shadow black 67% / 90° / 3px / size 6.
- New reusable Photopea-like **Layer Style** floating window (ui.js `openFxWindow`): Stroke, Drop Shadow, Color Overlay, Gradient Overlay, Outer Glow; live preview, drag by title, Reset/Cancel/OK. Rendering in `E.drawFxLines`. Also available on text objects ("Layer style…" button; `o.fx`). Spread, bevel/emboss, contour, texture, satin, inner shadow/glow are not implemented; Multiply blend approximated by plain black at opacity.
- Roboto Condensed added to the Google Fonts link and font preload.
- Touched files ChatGPT changed recently for v0.9.42/43 (cloud Assets): studio/ui.js, studio/engine.js, studio/index.html (small, separate edits). cloud_assets.js, tests and supabase files untouched.

## v0.9.45 – Layer Style for every object + saved styles (Claude)
- `engine.js` `drawFxObj`: any non-text object with `o.fx` is drawn via its silhouette (stroke, drop shadow, outer glow, color/gradient overlay). `o.fx` replaces the legacy shadow. Skipped under scaled/rotated transforms (falls back to plain draw).
- `ui.js`: "Layer style…" button in the inspector for all non-text objects (+ Remove); Layer Style window gained a **Saved styles** dropdown with Save style as… / Delete (localStorage `wx_fxpresets`).
- Not touched: ChatGPT cloud files (cloud_assets.js, cloud_presets.js, supabase, tests).

## v0.9.46 – Export image (PNG/JPG) for X and Facebook (Claude)
- New **Export image** button (index.html `#bImg`) → `imageDialog` in ui.js. Renders the finished look of the current scene or all scenes (zip, tiny store-only zip writer) as PNG/JPG at 1920x1080, 1200x675, 1080x1080 or 1080x1350 (center crop with position slider).
- Uses `E.prepareFrame` + `E.renderScene` at scene end; if a map isn't ready (e.g. no Mapbox token) it still renders and notes it.
- Touched only ui.js + index.html; ChatGPT cloud files untouched.

## v0.9.47 – No zip: Export image saves plain PNG/JPG; MP4 auto-saves (Claude)
- Removed the zip writer. "All scenes" now saves one PNG/JPG per scene. Image and MP4 exports download automatically when finished (MP4 dialog keeps a "Download again" button). ui.js only; ChatGPT files untouched.

## v0.9.48 — low-zoom city visibility and label zoom windows (ChatGPT, 2026-10-16)

**Starting main:** Claude's v0.9.47 commit `2928f77`. User reported city/town place labels disappear when zooming out below ~6 with no matching min/max settings visible.

- Mapbox Streets v8 `place_label` has a dynamic, zoom-dependent `filterrank` (0–5) and stable `symbolrank` (1–19). WX Studio's custom major-city fallback previously required **both** filterrank density and symbolrank prominence; when the data's filterrank changed at overview zoom, it could hide all cities. Now the fallback tests **symbolrank alone**, and the main city layer keeps a city when it meets either the configured density filter **or**, if Keep major cities is enabled, the stable major-city rank. Mapbox's original place-label layers remain hidden to avoid double labels.
- Added `broadcastCityMaxZoom`, `broadcastTownMaxZoom`, `broadcastVillageMaxZoom` defaulting to 24 and `broadcastMajorCityMinZoom` defaulting to 0; the older city/town/village **minimum** settings/defaults are preserved. `Map Style → City + Town Labels` now shows min and max sliders for each city/town/village tier and a **Major-city minimum zoom** control with a brief hint. The major-city fallback fills 0 (or configured minimum) up to the city's configurable minimum with no gap; the regular city layer takes over above City min zoom.
- Corrected `+cfg.broadcastCityMinZoom||3` to honor an explicitly selected min zoom of **0**. Added bound checks so min/max windows remain valid. Existing map preset settings and saved shows are merged with defaults via `MB.ensureConfig`, so the additional keys remain backward-compatible.
- New `tests/map_city_labels.test.js` (Node built-in test runner) tests custom symbol-rank filters, coverage across zooms 0–20 when City min zoom = 6, user-disabled major labels, correct town/village zoom windows and presence of all controls.
- Source syntax and mocked Mapbox label-layer/zoom tests passed. Live Mapbox tile data/layout collision behaviour still needs user confirmation, particularly at zoom 2–6.
- **Claude overlap:** touched `studio/ui.js` with a targeted change limited to City + Town Labels controls. Did **not** alter Claude's v0.9.44–0.9.47 Layer Style, banners, templates, image export, `studio/engine.js`, `studio/index.html`, or cloud presets/assets. Changed `studio/mapbox.js`, `studio/ui.js`, `VERSION`, `AI_HANDOFF.md` and one file under `tests/`.


## v0.9.49 – "+ Map scene" button (Claude)
- New **+ Map scene** button (index.html `#bAddMap`, ui.js): inserts a new scene after the current one using a copy of the current scene's map (style, view, layers) with no drawn objects/titles. Existing "+ Scene" (blank sky) and ⧉ duplicate unchanged. Did not touch ChatGPT's v0.9.48 city-zoom code (engine/map files) – only ui.js/index.html small additions.

## v0.9.50 — restore visible city labels at overview zoom (ChatGPT; 2026-10-16)

**Starting main:** Claude's v0.9.49 commit `ef6b082`, which added a `+ Map` scene button. That new button, and all Claude v0.9.44–0.9.49 work, are preserved. This fix was **rebased** onto Claude's newest main after a race was caught in the pre-push check; the old v0.9.49 fix branch was NOT pushed to main.

- User provided a screenshot of WX Studio **v0.9.48 at zoom 6.0** where all city labels were absent despite roads and borders showing. The v0.9.48 custom filter-only fix did not restore names.
- `studio/mapbox.js` previously suppressed ALL original Mapbox Streets/Satellite Streets `place_label` symbol layers, including their well-tested built-in `settlement-major-label` and `settlement-minor-label` layers. Now those native settlement layers remain visible from each user's configured minimum through zoom **7.5**, with the configured text color, halo, opacity and uppercase setting applied. Above zoom 7.5, the original custom WX Studio city/town label layers resume, without overlapping zoom coverage. The native settlement layer's zoom-aware font size and Mapbox collision expressions are preserved. The custom low-zoom rank fallback remains for base map styles without native settlement layers.
- **Show Places Off** hides both native and custom place symbols, and **Cities Only** hides the native minor settlement layer. Older saved map styles and all existing City/Town/Village min/max settings remain compatible. No cloud, scene, show ID, or defaults changed.
- `tests/map_city_labels.test.js` updated with an actual mocked Mapbox layer stack including `settlement-major-label` and `settlement-minor-label`, verifying they are visible at zoom 6.0, custom city labels begin at 7.5, and Show Places/Cities Only settings work. A separate source-level/mock V8 run passed the same cases. **The live browser has not been tested**: user must verify at zooms 5–8, and if still missing report the active style and settings.
- **Files changed:** `studio/mapbox.js`, `tests/map_city_labels.test.js`, `VERSION`, `AI_HANDOFF.md`. Did **not** edit `studio/ui.js`, `studio/index.html`, `studio/engine.js`, cloud presets/assets, templates or Claude's `+ Map` button.


## v0.9.51 — user label styling now consistent across EVERY zoom (2026-10-16)

User supplied screenshots of WX Studio v0.9.50 showing **correct user-selected large label font/size at zoom 7.5, but much smaller default Mapbox font/size at zoom 7.0**. v0.9.50 deliberately restored native Mapbox settlement-major/minor layers below zoom 7.5 to fix *missing* city labels; however it only applied the user color/halo/opacity/uppercase and accidentally retained Mapbox's built-in zoom-variable **font and text-size**. This release closes that visual jump without undoing low-zoom label visibility.

- `studio/mapbox.js`: The **native overview** `settlement-major-label` and `settlement-minor-label` layers now explicitly use **the same WX Studio label font stack** via `wdFontStack(cfg.broadcastLabelFont)`, **city size** `broadcastCitySize` for major cities and **town size** `broadcastTownSize` for minor cities/towns, `broadcastLabelSpacing` + `broadcastLabelDensity` via `labelPadding()`, `broadcastUppercaseLabels`, `broadcastLabelColor`, `broadcastLabelHaloColor`, `broadcastLabelHaloWidth`, `text-halo-blur=.15` and `broadcastLabelOpacity`. Exactly the same font/size/appearance now applies at zoom 7.0 (native) and zoom 7.5 (custom) without changes to the user's settings. Label color/font/size updates are re-applied on restyle. Native zoom-dependent **feature filtering and collision placement** are deliberately preserved to keep cities visible below zoom 6. Labels may still be less dense at national zoom due to collision avoidance.
- Extended `tests/map_city_labels.test.js` with assertions comparing native vs custom city/town `text-size`, `text-font`, `text-padding`, casing, opacity, colors, halo and blur under altered saved-style values. Additional tests confirm style updates change both layers together and the important native city layer stays visible at zoom 6.0. Mocked Mapbox/V8 tests and JS syntax checks passed.
- **Claude overlap:** Started from main v0.9.50 `4016884`; touched only `studio/mapbox.js`, `tests/map_city_labels.test.js`, `VERSION`, and `AI_HANDOFF.md`. Did not change `studio/ui.js`, `studio/engine.js`, `studio/index.html`, `cloud_assets.js`, cloud presets, the + Map button, banners, text features or widgets.
- **Live QA still necessary:** confirm your saved map label font, size, halo and spacing stay visually consistent from zoom 8 → 7.5 → 7 → 6 → 5 while city names remain. Browser Mapbox glyph fetching and symbol collisions are not fully exercised by mocked tests.


## v0.9.52 — more major cities at regional zoom (2026-10-16)

User reported too few major city labels below zoom 5, despite v0.9.51 having fixed visibility/typography. Root cause: restored native Mapbox settlement layers still used Mapbox's restrictive stock place filters, so WX Studio's Major-city rank and Label density controls did not affect the low-zoom labels.

- Mapbox: custom filter on native settlement-major/minor layers using Streets v8 class/type and symbolrank/filterrank. New `broadcastOverviewCityDensity` selection defaults to `more`: Standard uses configured Major-city rank (default 9), More cities uses rank+5 (default 14), Many cities allows rank 19. Existing Major-city rank now applies below zoom 7.5; native minor town density adapts too. `symbol-sort-key` prioritizes major cities, without forcing overlapping labels.
- New `broadcastOverviewLabelGap:2` px (adjustable 0–20) relaxes overview collision spacing. Font, city/town size, casing, color, halo and opacity from user settings are unchanged; regular high-zoom spacing remains as previously configured. Map Style → City + Town Labels adds Overview city coverage and Overview label gap controls and improved guidance. `MB.ensureConfig` adds missing defaults to old cloud presets/saved shows automatically.
- Extended `tests/map_city_labels.test.js` mocks with `setFilter`, rank 9/14/19 density modes, z5, no forced overlap, zero gap, preservation of typography, Show Places and Cities Only toggles. JS parse and simulated filter tests passed. Browser Mapbox layout/collision behavior and tile data still need live QA.
- Starting main v0.9.51 `fc770ec`; touched only `studio/mapbox.js`, `studio/ui.js` (targeted Map Style controls), `tests/map_city_labels.test.js`, `VERSION` and `AI_HANDOFF.md`. Claude's `studio/engine.js`, `studio/index.html`, + Map, banners, clouds, templates and existing settings were not changed.

## v0.9.53 — critical regression fix: restore low-zoom city names (ChatGPT, 2026-10-16)

User reported WX Studio v0.9.52 hides **all** city labels again after zooming out past ~6, before they could try the new density controls. Critically, the user wants **every existing font, size, halo, color and other label preference preserved**.

- Root cause: v0.9.52 **replaced** the proven Mapbox Streets native settlement-major/minor filters with restrictive hand-written filters, instead of augmenting the original. Those changed filters could leave no eligible settlement names at specific overview zooms. v0.9.51's native baseline was visually confirmed by the user to show cities (albeit too few).
- `studio/mapbox.js` now captures and caches each untouched stock/native settlement layer filter **once per loaded style**, then the v0.9.52 Standard/More/Many rank rules are applied with `['any',originalFilter,extraCandidatesFilter]`. This guarantees the stock settlement labels remain eligible even when the extra density criteria do not match. On failure to install the additive filter, explicitly restore the stock filter. The stock `symbol-sort-key` and placement settings are **no longer overwritten**, retaining Mapbox's tested priority/collision behavior. The pristine-filter cache is cleared when the base style reloads.
- **Preserved all current user styling**: font, city and town pixel sizes, uppercase, label opacity, halo color/width, label text color, WX Studio's separate 2px Overview gap, and the higher-zoom label behavior from v0.9.51. No label keys/defaults, presets or UI controls were changed. No cloud show/asset data modified.
- Enhanced `tests/map_city_labels.test.js`: simulate a Mapbox Streets v12-style existing stock layer with a real separate pre-existing filter; verify that rank modes 9/14/19 broaden eligibility but a stock city remains eligible even at strict user rank 1, including disputed-settlement/type variations covered by the baseline; repeat mode changes to ensure filter changes do not accumulate; preserve stock sorting, collision settings and overview font size. JS source and mocked Mapbox layer tests pass. **Requires live browser QA at zoom 7, 6, 5, 4, 3 to confirm rendering**, not merely source/mocked tests.
- Starting main v0.9.52 `9b89b77`; touched only `studio/mapbox.js`, `tests/map_city_labels.test.js`, `VERSION`, and `AI_HANDOFF.md`. Claude's `studio/ui.js`, `studio/index.html`, `studio/engine.js`, scenes, banners and cloud features untouched. The user should NOT need to rebuild any saved settings.


## v0.9.54 — independent Aguacero-style place-label panels (ChatGPT, 2026-10-16)

User supplied live screenshots showing different apparent label fonts/sizes at zoom 7.3 and compared WX Studio's single crowded City + Town Labels menu with AguaceroWX's individually collapsible **Cities, Towns, Villages** panels. Their priority is keeping ALL existing custom font/size/halo/visibility choices and cloud presets.

- `studio/ui.js` changes **Map Style → City + Town Labels** to **Place Labels**, containing independently expandable **Cities**, **Towns**, **Villages** groups, each with the SAME controls: enabled, font, size (px), text and outline colors, outline width (px), density (%), prominence tier, uppercase, opacity, text spacing, text background/color, soft text shadow, min/max zoom, dot on/off, dot fill/outline/size/name offset/shadow. The shared overview rank/coverage/gap controls remain above the groups. Existing accordion convention and no second sign-in are preserved.
- `studio/mapbox.js` adds explicit independent tier config defaults and an **idempotent legacy migration** in `MB.ensureConfig`. Every existing scene/saved style with only the old `broadcastLabelFont/Color/Halo/Spacing/Opacity/Uppercase` inherits those exact values in each new category on first load, including old city/town/village sizes and place-type toggles. Subsequent settings for each tier remain independent; all new values are included in `WD_DEFAULTS` so they save correctly with shows, named styles, and cloud map presets.
- The native Mapbox **major** settlement overview layers use City styling, native **minor** settlement layers use Town styling. Native minor labels are filtered to town types so a city doesn't appear again in a smaller/different-looking Town layer. Preserves the proven stock-major label fallback, original rank/collision rules and additive eligibility filter from v0.9.53 so names stay eligible near zoom 6. User per-tier typography applies to BOTH native below 7.5 and custom high-zoom layers. New per-tier custom place-label filter and Circle dot layers honor the corresponding category selection, size, colors, prominence, zoom, offsets. Optional text backgrounds use a stretchable symbol icon; optional soft shadow increases text-halo blur rather than a true spatially offset shadow. Defaults for extra effects are Off.
- `studio/ui.js` map-style preset loading now detects OLD saved presets without tier-font keys. It clears only currently initialized new-tier properties before copying the old preset settings, ensuring `MB.ensureConfig` migrates the preset's original font, color, halo, etc., rather than inheriting stale values from the current scene. Existing map cameras, objects and show asset IDs unchanged.
- **Testing:** 12 deterministic mocked JS/Mapbox regression tests pass in `tests/map_city_labels.test.js`, including zero-city-label gap/stock native filter, font continuity at overview/high zoom, per-tier fonts/colors/sizes, old saved-style migration, separate enable toggles and optional dots. Production Mapbox WebGL/glyph rendering, text backgrounds and cloud-style loading still need the user's live QA.
- **Claude overlap:** Started from latest `main` v0.9.53 commit `720fc0e`; touched **`studio/ui.js`** (the shared Map Style panel and targeted legacy-preset loader) and `studio/mapbox.js`, `tests/map_city_labels.test.js`, `VERSION`, `AI_HANDOFF.md`. Did NOT modify Claude's `studio/engine.js`, `studio/index.html`, cloud Storage clients, banners/templates/widgets, or map navigation. Recheck main and use non-force fast-forward before deployment.


## v0.9.55 — restore Place Labels to Map Style popup (ChatGPT, 2026-10-16)

User supplied v0.9.54 screenshot with no Place Labels section in the floating Map Style window. Root cause: `scenePanel()` correctly builds a `mapAccordion('labels','Place Labels', ...)` with separate collapsible Cities/Towns/Villages, but `renderMapStylePanel()` was still using `addGroup('City + Town Labels','Labels')`. The `byTitle` lookup therefore silently found nothing and dropped the entire section.

- `studio/ui.js`: change the floating popup's group lookup to `addGroup('Place Labels')` so the existing accordion and nested subcategories appear at the proper position (after Water Features, before Terrain). No reimplementation or reset of the label panel.
- `tests/map_city_labels.test.js`: regression check that the scene accordion title and popup lookup match, and Cities/Towns/Villages remain nested. All 13 existing/new mocked tests and JavaScript syntax checks passed.
- **User data:** No changes to `studio/mapbox.js`, label defaults, saved map presets, cloud storage, or font, size, color, density, halo, zoom settings. All current user choices remain unchanged. No Mapbox token touched. Browser popup visually awaits user confirmation.
- **Claude overlap:** Only `studio/ui.js` (the shared popup wiring, one targeted lookup fix), `tests/map_city_labels.test.js`, `VERSION`, and `AI_HANDOFF.md` changed. `studio/engine.js` and `studio/index.html` untouched. Source branch started from v0.9.54 `5a2f471`; recheck main before fast-forward, no force-push.


## v0.9.56 — consistent place typography across zoom; black flat-map coastlines (ChatGPT, 2026-10-16)

**Starting main:** v0.9.55 `ec6f0e6`, verified before editing. User supplied screenshots and confirmed two remaining issues: City/Town label appearances differ as map zoom crosses the Mapbox-native/custom transition; Dark and Custom Color modes display **bright white shorelines** while other boundaries are black.

- `studio/mapbox.js` now builds **both** the native low-zoom Mapbox settlement major/minor layers and the custom WX Studio high-zoom City/Town/Village symbol layers from ONE shared `tierTextStyle(cfg,tier,overview)` helper. Explicit same **text-field**, font stack, exact user pixel size, uppercase, letter spacing (0), line height (1.2), wrapping width (10), anchor/justify, offset, text fill, opacity, halo color/width, and optional shadow at every zoom. The independently configurable **Overview label gap** remains 2 px by default, while the high-zoom controls keep existing tier spacing; these affect collision density, NOT text appearance. The old synthetic major-city fallback's hidden **+2px font-size increase** was removed. Preserved the working low-zoom native baseline filters/collision priorities and the user-requested three independent category settings and cloud presets.
- Removed the unintended exception in `installSeparatedWaterOutlines` that converted `broadcastCoastlineColor:'#050505'` (near-black) into `'#e0e4eb'` (pale white) whenever `broadcastBase` was Dark or Custom Color. All maps now honor the **same saved coastline color**, with near-black fallback; ocean & minor-island geometries/width remain untouched. User-selected nondefault coastline colors are respected in all map styles, and optional inland-water outlines stay independent.
- `tests/map_city_labels.test.js` now includes 15 deterministic JS/Mapbox mock tests, explicitly comparing low/high zoom text layout and paint for Cities and Towns, checking that synthetic major-city fallback font size exactly matches the user's saved City size, verifying black coastlines on Satellite/Dark/Custom, and preservation of custom coastline color. The earlier 13 visibility, original-filter, density, UI, migration and optional dot tests all still pass.
- **Files changed:** `studio/mapbox.js`, `tests/map_city_labels.test.js`, `VERSION`, `AI_HANDOFF.md`. **Claude overlap:** no changes to `studio/ui.js`, `studio/engine.js`, `studio/index.html`, cloud presets, scene objects, banner assets, or map navigation. No new repository-root files. **Important live QA:** ask user to check typography on the same city at 8 → 7.5 → 7 → 6 → 5 and flat globe coastline colors. Mock tests cannot fully simulate Mapbox glyph availability or WebGL collision layout.

## v0.9.57 — fix city/town label classification across zoom (ChatGPT, 2026-10-16)

**Starting main:** v0.9.56 `96ede98`. User still saw different-sized labels at zoom 7 despite previous typography fixes; repeated updates hadn't addressed the true cause. Investigation against the official public Mapbox Streets v12 style (`mapbox/mapbox-gl-styles/styles/streets-v12.json`) and Streets v8 tileset reference showed **both** `settlement-major-label` and `settlement-minor-label` use `filterrank` and zoom-dependent `symbolrank`; neither layer filters by `type:city` versus `type:town`. WX Studio wrongly styled all stock *major* symbols with City's selected font/size and all stock *minor* symbols with Town's; a high-ranked Town could appear in the City tier at z7, then switch to its correct Town tier after z7.5. Some Cities originally in stock minor could also be lost due to the previous Town-only minor restriction.

- `studio/mapbox.js`: before touching either stock settlement layer, snapshot original native major **and** minor filters once per Mapbox style using the existing `__wdOriginalOverviewFilters` cache. Form a combined original selection per source that keeps both rank populations eligible; OR in the existing user-controlled density expansions. Then apply an **explicit, mutually exclusive Streets `place_label.type`** check to each: City native layer shows only `type:'city'`; Town native layer shows only `type:'town'` (both with supported `class` settlement/disputed_settlement). Original low-zoom city eligibility is preserved from BOTH original rank populations. A map.setFilter failure falls back to type-only filters rather than reverting to mixed-type stock layers. Don't alter layout, symbol priority/collision, style controls, or unrelated rendering code. Native City/Town and custom City/Town layers still use `tierTextStyle` for exactly the same selected font, size, color, halo, uppercase and other paint at all zooms. No changes to current City/Town/Village field values, migrations, or defaults.
- `tests/map_city_labels.test.js`: strengthened rank fixtures to match the core Mapbox Streets v12 design—stock major includes prominent cities AND towns, stock minor includes less-prominent cities AND towns. Verify a prominent Town appears **only** in Town-styled minor native layer, an ordinary City from stock minor appears **only** in City-styled major native layer, both original filters remain cached untouched through repeated density changes, and corresponding custom/native text-size settings agree exactly at the 7.5 zoom transition. Old v0.9.56 code **fails** the new regression ('a prominent TOWN must not render with City typography'); new patch passes **all 15** mock tests. No live browser/tiles verified yet.
- **Important UI clarification:** The user retains independent Cities and Towns settings by request. Their existing Town font size (often 16px by default) is deliberately smaller than their City font size (often 20px); this difference is **intentional** and should NOT be silently replaced, even though casual visual descriptions may call all populated places "cities." To make every populated-place label identical in appearance, the user must separately choose the same font/size in Cities and Towns (and Villages if enabled). Do NOT interpret mere smaller Town labels as a bug after this fix; first inspect selected tier settings and Mapbox feature `type`.
- **Files touched:** `studio/mapbox.js`, `tests/map_city_labels.test.js`, `VERSION`, `AI_HANDOFF.md`. Claude's shared `studio/ui.js`, `studio/index.html`, `studio/engine.js`, map navigation, scenes, cloud map presets/assets, and users' saved data were not changed. Guarded fast-forward only. **Live QA requested:** hover across zoom levels 8→7.5→7→6, checking a specific city's size stays the same and that towns stay consistently at their separately configured size; native Mapbox collision engine may still hide crowded place names.

## v0.9.58 – "Apply my AguaceroWX label settings" button (Claude)
- ui.js only (Map Style → Place Labels): new button sets City/Town/Village exactly from the user's AguaceroWX screenshots: Roboto Bold 16px, #fff text, #000 outline (City 2.5, Town 2, Village 1.5px), density 97/96/96, Population All, no bg/shadow, dots off (sizes 3.5/3/2.5, offset 4), zoom 2–22 (Villages 6–22), All caps on. Fixes labels vanishing below zoom 3/5/7 (old mins) and mismatched tier sizes (20/16/13).
- NOT done: separate Hamlet tier (user: Roboto Bold 16, outline 1, density 96, zoom 8–22, dots 2) – hamlets are still drawn with Villages (['village','hamlet'] layer). Class labels Continent/Country/State/County/Subdivision/Water/Natural/POI are OFF in the user's AguaceroWX, Airport labels ON (Roboto Bold 11, black, white outline 1, zoom 8–24), Road names ON (Open Sans Regular, 1x, white, black outline 1px, density 30%, zoom 15–24), Road signs ON 1.2x density 100% zoom 6–24: not implemented here.
- Did not touch mapbox.js or ChatGPT's label routing (v0.9.49–0.9.57).

## v0.9.59 – Video import (MP4/WebM scene backgrounds) (Claude)
- Assets → new **Videos** tab (ui.js `videosPanel`, IndexedDB `wxstudio-vids`, `restoreVideos`): upload MP4/WebM, "Use as this scene's background" (sets bg `{type:'video', vid, vidStart, vidLoop, fit}` and matches scene duration), fit (fill/blur/solid/stretch), start offset, loop, match length. Videos live ONLY in the browser (not in the show file); missing video shows a placeholder.
- engine.js: `E.registerVideo/E.vid/E.seekVideo`, `drawBackground` video branch, live playback sync (`syncVideo`; thumbnails pass `thumb:true`), `prepareFrame` now also seeks video backgrounds frame-exactly for MP4 export/image export. `E.exporting` flag set in export.js (`X.run` wrapper, cleared before the realtime-WebM fallback) and in imageDialog.
- Audio not included. Tested headless with WebM (upload, background, image export at scene end = last video frame, reload persistence, realtime WebM export); H.264 WebCodecs frame-seek export path not testable headless – please confirm in Chrome/Edge.
- Did not touch ChatGPT's map/label/cloud code.

## v0.9.60 — AguaceroWX place-label defaults + one canonical restore button (ChatGPT, 2026-10-16)

**Starting latest main** was Claude's **v0.9.59 video backgrounds**, commit `f262b1b`. It was detected while building the first draft against v0.9.58. Rebased all changes on the new commit instead of overwriting his code. Claude's Videos tab, video import, engine/export/video handling, cloud assets and all map/scene navigation stay intact.

User specifically requested the previously recorded AguaceroWX **place labels** to become the default for new WX Studio/Weather Director map scenes while keeping Claude's one-click `Apply my AguaceroWX label settings` button to restore those defaults after experiments. Verified reference as recorded from the user's Aguacero screenshots and Claude's v0.9.58 handoff (no Mapbox label system exists in the separate WxFusion forecasting repository).

- **One shared source of truth**, in `studio/mapbox.js`: `MB.AGUACERO_PLACE_LABELS`, used by both `MB.DEFAULTS` (new scenes / Reset all to defaults) and `MB.applyAguaceroPlaceLabels(bg)` (restore button). UI no longer duplicates numeric defaults. Common tiers: Enabled, **Roboto Bold 16px**, white text `#ffffff`, black outline `#000000`, uppercase, All population, backgrounds/shadows/dots OFF.
- **Cities:** halo 2.5px, density 97%, zoom 2–22, inactive dot size 3.5px.
- **Towns:** halo 2px, density 96%, zoom 2–22, inactive dot size 3px.
- **Villages:** halo 1.5px, density 96%, zoom 6–22, inactive dot size 2.5px.
- **Hamlets (new independent accordion and renderer):** halo 1px, density 96%, zoom 8–22, inactive dot size 2px. Previously hamlets were bundled with Villages and could not have their own font/size/zoom. Separate `wd-hamlet-labels` and `wd-hamlet-dots` use a `type:'hamlet'` Mapbox filter; Village layer now handles `type:'village'` exclusively. No duplicated names.
- Low-zoom major city minimum restored to 2 (not the unrelated old 0) when applying Aguacero reference. Overview coverage/gap/rank use the existing WX Studio controls (More cities, 2px gap, rank9), as these **were not specified** in the Aguacero screenshot; both defaults and button share these WX-specific values. Existing global label values remain for compatibility.
- **Backwards compatibility:** `MB.ensureConfig` distinguishes fresh new map configs (fill Aguacero defaults directly) from old saved shows with legacy typography (migrate their original values, never overwrite selected fonts/colors/zoom). Old saved styles without an independent Hamlet tier inherit the saved Village appearance and zoom, not arbitrary settings in the current scene. `studio/ui.js` resets only temporary tier-label fields before importing saved styles, preventing stale cross-scene state. Existing modern cloud presets retain all their selected tier fields. The user's active map and saved cloud data are not bulk-reset by deployment; pressing the restore button changes only label settings.
- **Tests:** `tests/map_city_labels.test.js` increased to 20 deterministic tests. Includes exact default/button equality for all four tiers, button restoring fields but not other scene settings, fresh map initialisation, old custom style preservation, old preset import, separate Hamlet/Village filters and visibility, plus the 15 existing zoom, placement, typography and coastline tests. All pass in V8 mock runner; JS syntax checked. **Live WebGL Mapbox rendering requires user validation.**
- **Touched:** `studio/mapbox.js`, `studio/ui.js` (targeted label panel + saved style import, preserving all Claude video additions), `tests/map_city_labels.test.js`, `VERSION`, `AI_HANDOFF.md`. **Untouched:** `studio/engine.js`, `studio/export.js`, `studio/index.html`, cloud client code, scripts/config/secrets.
- **Scope:** Only Map Style → Place Labels / City-Town-Village-Hamlet settings. Airport, road, country, water and other label-category configurations not part of this release. Do not claim that these non-place categories now match Aguacero one-to-one.


## v0.9.61 – Animated GIF import (Claude)
- Assets → Videos now also accepts animated GIFs. engine.js: own GIF decoder (`gifDecode`/`gifLzw`, disposal methods, transparency, interlace), `E.registerGif`, frames kept in memory (auto-downscaled to a ~260 MB pixel budget, max 1920 wide) and drawn through the existing video background branch (`bg.type==='video'`, `v.gif`). GIFs default to `vidLoop:true` so they keep looping for the whole scene; export/image export are frame-exact (no seeking). Stored in IndexedDB `wxstudio-vids` with `kind:'gif'`, restored on load.
- Verified headless: frame at t=2.0 equals ffmpeg frame 20 (ms-integer timing), loop at t=5.0 equals t=2.0, reload persistence.
- Rebased onto ChatGPT v0.9.60 (Aguacero label restore/Hamlets) with no conflicts; its code untouched.

## v0.9.62 – 7-Day icons: one size, aligned by visible top (Claude)
- engine.js `E.build7DayBW`: all 7 icons now share one size (72% of column width, was 86% main / 80% Thu-Fri) and are aligned by the icon art's visible top (`iconVisTop` measures solid-pixel top of each icon at build time, falls back to box-centered if measuring fails). Main 5 columns share one top line; Thu/Fri sit at the top-center of their panels so rain stays clear of the % and temperature. Applies to newly built 7-day scenes only (rebuild via 7-Day… to refresh existing ones). engine.js only; ChatGPT code untouched.

## v0.9.63 — all label categories recreated from user's original AguaceroWX recording (ChatGPT, 2026-10-17)

**Source of truth:** User's Oct 17 vertical video `Recording 2026-10-17 000711.mp4` (36.6 sec, 398×920), visually inspected end-to-end. Crucial correction: all populated-place categories are **Roboto Bold 16px**. The original video displays OTHER label categories with different sizes; do not apply 16px to roads, airports or continent/state labels.

**Places (enabled):** Cities Roboto Bold 16px, white text, black 2.5px outline, density 97%, All population, zoom 2–22, dots off (white/black 1px border, size 3.5px, offset 4px); Towns same except outline 2px, density 96%, zoom 2–22, dot size 3px; Villages same except outline 1.5px, density 96%, zoom 6–22, dot size 2.5px; Hamlets same except outline 1px, density 96%, zoom 8–22, dot size 2px. All four no text backgrounds or shadows, uppercase, dots off. These 4 categories existed from v0.9.60 and remain unchanged.

**Global:** Hide All Labels OFF; All Caps ON; Fade Labels ON. **Road Signs ON**, 1.2x size, 100% density, all five sign types ON (Interstates, US Highways, State Routes, Other, Exits), zoom 6–24. **Road Names ON**, Open Sans Regular, 1x text, white/black outline 1px, density 30%, background and shadow OFF, zoom 15–24.

**Other reference label groups**, all background/shadow OFF: Continent OFF Roboto Bold 16px black/white halo1.5 zoom .75–3; Country OFF Roboto Bold 14px black/white halo1 zoom1–10; State OFF Roboto Bold 12px black/white halo1 zoom3–9; County OFF Open Sans Regular 10px gray (#656565 sampled)/white halo1 zoom7–16; Airport ON Roboto Bold 11px black/white halo1 zoom8–24; POI OFF Roboto Bold 10px black/white halo1 zoom6–24; Subdivision OFF Roboto Bold 11px black/white halo1 zoom10–15; Water OFF Roboto Bold 10px blue (#0a7eb9 sampled)/white halo1 zoom13–24; Natural Feature OFF Roboto Bold 10px green (#339758 sampled)/white halo1 zoom4–24. RGB sampled from MP4 swatches; original unsupplied exact hex codes may differ due video compression.

- `studio/mapbox.js`: adds these remaining recorded values to SAME central `MB.AGUACERO_PLACE_LABELS` object as the four City/Town/Village/Hamlet presets, assigned to `WD_DEFAULTS` for brand-new map scenes and used by the **unchanged one-click restore API**. `MB.ensureConfig` preserves existing scene and cloud-saved label choices unless user invokes restore. Adds Open Sans Regular font mapping. Applies auxiliary label categories to existing Mapbox native symbol layers when enabled (including Airport and Road Names), honoring recorded zoom, font, text size, colors, outline. Road shields inherit 1.2x size/100%-density mapping. Adds Hide All, global caps, fade duration controls, while keeping existing Mapbox collision handling and all major-city type-based filtering.
- `studio/ui.js`: adds nested controls under the SAME Map Style → Place Labels accordion for Hide All/All Caps/Fade, Road Signs, Road Names, Continent/Country/State/County, Airport/POI/Subdivision/Water/Natural groups. The Restore button still calls only `g.MB.applyAguaceroPlaceLabels(b)` and never duplicates preset numbers in UI. No transportation line geometry, coastlines, boundaries, cameras, scenes, cloud clients or video/GIF assets changed.
- `tests/map_city_labels.test.js`: **22 passing V8/mock tests**: compare each reference label field with BOTH new-scene defaults and button reset, simulated native Mapbox Airport/Road Name typography and zoom, the original four 16px classes, low-zoom ranks/collision continuity, Hamlet migration and older cloud preset loading. JavaScript syntax verified. No production WebGL/browser screenshots tested; user live check needed, especially geographic label density and Mapbox native source coverage.
- **Claude overlap:** Starting from Claude's latest v0.9.62 commit `4e26c890` after conflict was detected and rebased. Claude's 7-day icon alignments, video/GIF import/export, `studio/engine.js`, `studio/export.js`, `studio/index.html` and all other source files preserved untouched. Only `studio/mapbox.js`, `studio/ui.js` (Place Labels), `tests/map_city_labels.test.js`, `VERSION`, `AI_HANDOFF.md` changed. Non-force fast-forward required.


## v0.9.64 – 7-Day icons: matched visual size (Claude)
- engine.js `iconVis`/`iconFit`: each icon's box is scaled so its visible art has the same overall "mass" (geometric mean of solid-pixel width × height) – a round sun, a flat cloud and a cloud with rain/snow now look similar in size, still top-aligned (v0.9.62). Newly built 7-day scenes only; engine.js only, ChatGPT code untouched.

## v0.9.65 — restore AguaceroWX video label-panel layout (ChatGPT, 2026-10-17)

**User request:** The user reports the current map **labels look correct**, but the **Map Style → Place Labels settings LAYOUT** no longer looks like the original AguaceroWX video. Restore the recorded *visual arrangement only*, retaining all numeric settings, Mapbox label rendering, verified video restore button, saved styles and Claude's work. The relevant `MAP_STYLE_REFERENCE.md` specifies the video order: Road Signs, Road Names, Continent/Country/State/County, Cities/Towns/Villages/Hamlets and airport/other groups, with independent type sections, zoom, font, size, density, population, and dots.

- `studio/ui.js` **UI only**: Inside the existing **Place Labels** accordion in the independent Map Style flyout, created scoped Aguacero-style expandable label cards whose headings have right-aligned independent enable checkboxes. Each City/Town/Village/Hamlet category displays Font, Size (with live numeric readout), Text/Outline colors, Outline width, Density %, Population, Background and Shadow, a separate Zoom range area with min/max number boxes, and a separate Place dots area (toggle plus dot style/offset settings). Existing Uppercase/Opacity/Spacing settings are kept under **Advanced text options** rather than removed. Disabled categories still show their controls for comparison to the original reference. Road Signs, Road Names, Airport, POI, Country, State, County, Water, Natural and other auxiliary label groups use the same heading/row layout with their existing controls. Existing `g.MB.applyAguaceroPlaceLabels(b)` restore button stays unchanged. No Mapbox settings names, values, or default presets are changed.
- `studio/index.html` CSS only: Scoped styling of label-card headings, right-side checkboxes, numeric slider readouts, zoom range and dot dividers under `#mapStyleScroll`; no global interface or Mapbox rendering CSS changes.
- `tests/map_city_labels.test.js`: 24 mock/regression tests passed (the previous 22 plus two UI-specific tests). UI mock checks all four independent headings, input value change affecting only the selected style key, disabled tier controls still present, zoom/dot controls, and unchanged restore action; source JS syntax passed. **The actual live browser/popout visual has not yet been verified by user**; avoid claiming pixel-identical recreation from only the written video checklist.
- **Files changed:** `studio/ui.js`, `studio/index.html`, `tests/map_city_labels.test.js`, `VERSION`, `AI_HANDOFF.md`. **No changes to `studio/mapbox.js`, `studio/engine.js`, `studio/export.js`, any cloud storage/auth or scene data, and no label settings values changed.** Keep later Claude commits by using fresh `main` compare and non-force fast-forward only.


## v0.9.66 – rain/snow centered under clouds
- studio/icons_hd.js only: rain/snow drops are stratified across the cloud width, shifted to offset slant drift, and scored for being centered; mostly-sunny cloud x0 120→112; snow flakes keep their horizontal stratum.
- Not touched: ChatGPT's recent files (mapbox.js, label UI, tests).

## v0.9.67 — reduce crowded place labels at regional zoom WITHOUT changing Aguacero text sizes (ChatGPT, 2026-10-17)

**Source & starting commit:** `main` v0.9.66 at `66e74b2`, including Claude's latest v0.9.65 Aguacero-like independent label menu and v0.9.66 rain/snow icon work. User provided screenshot around zoom 7 with some labels perceived as smaller despite personally setting every City/Town/Village/Hamlet font **Roboto Bold 16 px**, and map was crowded. The four categories already share an exact 16 px `text-size` when user sets them so; however the user-reference Aguacero halo widths **2.5/2/1.5/1 px** yield different visible visual weight, which must NOT be reset without permission.

- **Primary root cause of crowding:** `tierFilter` quantizes 96–97% user density to `filterrank <= 5` (Mapbox maximum). Low-zoom `nativeOverviewFilter` also OR'd all stock settlement filters with expanded matches, which meant lowering a tier's density often **could not remove original Mapbox labels**. The v0.9.52 failure teaches not to replace original City filters in a way that can blank the overview map.
- `studio/mapbox.js`: add **WX Studio-only** `broadcastAutoDeclutter:true` and `broadcastDeclutterStrength:1.25` to the existing canonical Aguacero restore/default object, preserving ALL four original 16px fonts/sizes, halos, colors, zoom ranges, density percentages, and other reference values. New `placeCollisionPadding(cfg,base)` uses a Mapbox-supported zoom camera `interpolate` expression for the **text-padding layout property**. It adds collision space at zoom 3/5/6/7/7.5, reducing label overlap at broad geographic views, and returns smoothly to the user's original spacing at zoom 9+. It applies to BOTH native Mapbox overview and custom WX Studio layers across the z7.5 handoff; it never modifies the text-size/text-font/halo/feature classification. `broadcastAutoDeclutter:false` or strength 0 returns original user spacing. Configurations that have not yet been `MB.ensureConfig`-resolved do not activate the new feature unintentionally.
- Low-zoom native City/Town **density control now applies to the combined original+supplemental candidate list**, not only extras. Lowering the user density below 96 removes less-prominent places; for City labels `symbolrank <= 4` remains eligible despite low density, preserving important city names such as Boston/NYC at overview zoom. Original Mapbox rank filters, per-place tier styling, original default density percentages and label preferences stay saved.
- `studio/ui.js`: targeted additions immediately after Overview label gap in Map Style → Place Labels: **Automatically declutter labels when zoomed out** toggle and **Decluttering strength** slider (0–2x) with explanatory hint. Does not restructure Claude's UI or other Aguacero headings/cards. Existing saved shows/presets retain their original fonts and sizes; only missing new readability keys default to Auto and 1.25x.
- **Testing:** 26 mocked Mapbox + source tests pass, including new tests that every tier retains user-selected Roboto Bold 16px and original distinct Aguacero halo widths while native/custom layout text-padding increases at zoom 7 and returns to normal at zoom 9, off/zero strength switches recover manual values, and reducing native Town/City density works without hiding top-ranked cities. Mapbox official style documentation confirms `text-padding` supports zoom interpolate camera expressions. **Not browser-tested**: user should validate screen at zoom 7 and 5, then adjust strength if desired.
- **File scope:** `studio/mapbox.js`, `studio/ui.js` (only the new declutter control), `tests/map_city_labels.test.js`, `VERSION`, `AI_HANDOFF.md`. Claude's v0.9.65 visual label controls remain, along with `studio/icons_hd.js`, `studio/engine.js`, `studio/index.html`, video scenes, banners, map water/coasts, templates and cloud operations. Publish only if `main` still matches `66e74b2` using expected SHA + force=false.


## v0.9.68 – Motion path (A → B → C …)
- Any object (icons, H/L, fronts, text, images…) can glide along a path: Object tab → "Motion path" → "Move along a path". Drag the lettered handles on the stage; "+ Add stop" adds C, D, …; start time, travel time, ease, smooth curve, repeat.
- Data: `o.move = {on, pts:[[dx,dy]…] (screen-px offsets from the object = A), start, dur, ease, smooth, loop}`. Engine: `E.moveDefault/moveSamples/moveOffset`; applied in `drawObjectAnimated` (shifts a copy of the object, so shadows/Layer Style follow). Editor shows A at its normal spot with the route + handles; motion plays in Scene/Show/Present/export.
- Files: studio/engine.js, studio/ui.js. Not touched: ChatGPT's mapbox.js / label work / tests.

## v0.9.69 – "+ Map scene" works with no map scene
- studio/ui.js `#bAddMap`: if the current scene has no map, copies another map scene's map, else uses the saved/built-in default map. No change to other files; ChatGPT's files untouched.

## v0.9.70 – Linked motion (fronts/lows move together)
- Motion path panel gains "Move together with": tick other objects (fronts, lows, labels) and they follow the leader's exact path/timing, keeping their drawn spacing. Data: `follower.moveWith = leaderId`; engine `drawObjectAnimated` uses the leader's `moveOffset`. Files: studio/engine.js, studio/ui.js. ChatGPT's files untouched.

## v0.9.71 – Weather data loop layer + playback bar (foundation)
New self-contained file **studio/dataloop.js** (global `WXData`), so it does not collide with Map Style / menu work. Hooks elsewhere are tiny: `index.html` (one script tag after ui.js), `engine.js` (`renderScene` calls `WXData.draw` right after the background and `WXData.drawBar` after objects; `prepareFrame` awaits `WXData.ensure(scene)` so exports are deterministic).

**What it does:** Per scene "Weather data loop" bar above the tool row: ‹ ▶ › frame step/play, − 10x + speed (frames/sec, 1–30), loop progress bar (blue = frames loaded, knob = current frame; click/drag to scrub), timestamp (EDT/EST default) top-right, LIVE menu (archive disabled for now), length menu (1/2/4/12 Hr per source), data menu (+ radar site menu), opacity, and "Show this bar in the video" (the same bar is drawn onto the 1920×1080 canvas). Frames are warped onto the Mapbox map through `E.xf(...).fwd(lon,lat)` (an 18×18 textured mesh, so it follows pan/zoom/projection). Needs a **Mapbox** map scene.

**Data contract for providers (ChatGPT):**
```js
WXData.registerSource({
  id:'goes', label:'GOES Satellite', lengths:[1,2,4,12],            // hours offered in the length menu
  sites:[{id:'KBOS',label:'KBOS Boston'}], defaultSite:'KBOS',       // optional (radar)
  list: async ({site, hours}) => [ {t:epochMs, bbox:[west,south,east,north], crs:'4326'|'3857',
                                     url:'https://…' /* CORS-clean */ | load: async()=>canvasOrImage }, … ]  // oldest → newest
});
```
`goes`, `nexrad`, `rtma`, `forecast` are listed as "not connected yet" until a provider with that id is registered. A `demo` provider (synthetic blobs) is built in so the bar can be tried. Saved as `scene.dataLoop = {on, source, site, hours, speed, opacity, showBar, idx}`.

**Known limits / next:** the layer is drawn over the rendered Mapbox frame, so city labels baked into the map are covered by it — the proper fix is to add the frame as a raster layer *below* the label layers inside the Mapbox GL map (mapbox.js). Palettes folder, RTMA value-at-city labels, archive mode and tests with real feeds are still to do.
Files: studio/dataloop.js (new), studio/engine.js, studio/index.html. ChatGPT's files: not touched except one script-tag line in index.html.
