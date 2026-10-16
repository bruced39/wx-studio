# WX Studio — AI Handoff

> Shared project continuity for ChatGPT and Claude. Update this file whenever code changes.
> Never assume this snapshot is the latest: read `main`, `VERSION`, recent commits, and relevant source files before editing.

## Last reviewed baseline

- Review date: 2026-10-14 (America/New_York; commits below are UTC on 2026-10-15).
- Repository: `bruced39/wx-studio`; default/deployment branch: `main`.
- **Last reviewed application version:** `0.9.19` (`VERSION`).
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
