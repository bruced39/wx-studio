# AguaceroWX Map Style Video Reference (2026-10-14)

This is a structured, non-video record of the user-supplied 93.4-second vertical Map Style walkthrough. It is a UI/functional checklist, **not** a statement that every Aguacero feature is implemented. The reference video is a conversation upload, not stored in this repository.

## User's navigation requirements
- Add a camera/map-style icon to WX Studio's **top toolbar**. Click to open an independent scrollable pop-out menu; X in upper right closes it. The popup must not take away unrelated scene or object tools.
- Use collapsible categories, preserve current WX Studio functionality and saved map configurations, and keep map settings common when switching between base modes.
- Top cards should be **Custom Color / Dark / Satellite** rather than Aguacero's Light / Dark / Satellite. Dark and Custom backgrounds have selectable colors.
- Use readable labels and numeric units (px, %, zoom). Never invent UI controls that cannot affect the map.
- Start from GitHub main and VERSION, never overwrite Claude's concurrent work; keep AI_HANDOFF updated.

## Video order (top to bottom)
| Approx. video time | Section | Observed controls |
|---|---|---|
| 0–6s | Map Style main | Save Style, Saved Styles, Reset all, Light/Dark/Satellite cards, Mercator/Globe/Polar NH/Polar SH, Show Zoom, custom overlay library, highlight, Custom Mapbox Style and token, search |
| 6–21s | Overlays | Day/night, NWS CWA, public, fire, coastal marine and time zones; enabled, color, solid line type, width px with optional By zoom, opacity %, min/max zoom. Lat/Lon Off/On/Ocean only, white grid color, line width px, opacity %, auto spacing |
| 21–24s | Globe | Atmosphere on, strength 10%, stars on, intensity 60%, background color |
| 24–27s | Satellite Imagery | Saturation −0.15, contrast +0.05, shadow lift 0, highlight ceiling 1 |
| 27–30s | Land & Water | Water color; put ocean/land over added layers; plot as normal source picker; water depth + color + zoom range; national parks color + zoom; building footprints color; 3D building height |
| 30–45s | Transportation | Roads master switch, Interstates/Major/State/County/Local Paved/Local Unpaved/Residential & Minor/Alleys & Service, each with color/on, width px, opacity %, outline, zoom ranges; Airports, Railroads |
| 45–51s | Boundaries | Country/State/County toggles, color, line type, width px, opacity %, min/max zoom |
| 51–54s | Water Features | Waterways with color, width px, opacity %, min/max zoom |
| 54–90s | Labels | Hide all labels, All Caps, Fade in/out, Road signs (sign categories + size/density), Road names (font, size, text color/outline/width, density, background/shadow, zoom), Continent/Country/State/County, City + city dots, Town + town dots, Village, Hamlet + dots, Points of Interest, Subdivision, Water and Natural labels. Classes show on/off, font, size px, text/outline colors, outline width px, density/population and min/max zoom where relevant |
| 90–93s | Terrain | Show Terrain, hillshade-behind-data, intensity %, 3D terrain/exaggeration %, zoom range and shadow/highlight/accent colors |

## WX Studio v0.9.2 implementation
- **Implemented in a popup:** toolbar camera button + X, scrollable categories and source UI bindings, Save Style/Saved Styles local presets, reset; Custom Color / Dark / Satellite cards; Mercator / Globe, Show Zoom; Overlays, Globe, Satellite Imagery, Land & Water, Transportation, Boundaries, Water Features, Labels (existing controls), Terrain and Map + Camera in this order.
- **New live rendering:** customizable opaque dark/custom Mapbox base, satellite brightness range, globe fog/star settings, waterways vector line, optional hillshade with colors.
- Existing NWS, roads, boundaries, city/town labels and lat/lon controls reused, not rewritten. Off overlays still show their styling controls, and range inputs display px/% where appropriate.
- **Not yet identical to Aguacero:** The video has many independently configurable label classes (font, size, outline, dot styles, density, population) that are not all in WX Studio. Railroads, special polar projections, per-zoom width/opacity ramps, custom style URL, and Plot as normal/Put Ocean or Land over added *weather-data* layers remain to implement/verify. Do not pretend that these settings work or add dummy controls.
- **QA still required:** browser testing of pop-out interactions, dark/custom map behavior at different zooms, existing NWS/latlon regressions, terrain/waterways/Globe on deployed Streamlit; confirm weather graphics and animations remain intact.
- Next: finish real label-category support while preserving WX Studio's existing settlement rendering; then implement missing style sections/features in small verified releases.

## Explicit non-goals
The screenshot's toolbar includes many unrelated aviation/radar/weather icons. Only the Map Style icon is requested now. More top-level tools will be added later, one at a time. Do not reproduce the reference application's branding/icons verbatim.

## Follow-up clarification (v0.9.4)

Dark and Custom Color are **not** flat silhouettes. They must retain the entire Satellite map's vector detail (roads, labels, boundary and coastline polygons, islands, inland water), using a separately selected solid **land** color and **ocean/lake** color, and no satellite imagery raster. Keep the three cards legible/crisp; use @2x Mapbox thumbnail for satellite. The folded map button belongs **after Redo** in the top toolbar.
