# WX Studio

Browser-based weather broadcast studio for building scenes/slides and exporting **H.264 MP4** (16:9) for X and Facebook.
Hosted through Streamlit; the studio itself runs in your browser, so export happens on your PC.

## What's in Phase 1
- Scene rundown, 11 broadcast transitions (swipe, wipes, push, zoom, iris, dissolve…), present mode
- 42 animated weather icons (all 7-day conditions, day + night, tropical, wind, hot/cold…)
- **H / L** pressure markers, cold / warm / stationary / occluded fronts, troughs, dry lines (animated)
- Animated flow arrows, isobars with labels, freehand pen, boxes, ovals, pins, storm symbols, wind barbs, text
- US map (Albers) with regions, pan/zoom, **camera moves**; objects can be *pinned to the map*
- Upload your own graphics (objects, backgrounds, logo)
- 7-Day Forecast builder (editable, animated cards)
- Undo/redo, autosave, save/open show files (`.wxshow.json`, uploads included)
- MP4 export (WebCodecs H.264 + built-in muxer); WebM fallback if the browser can't encode H.264

## Deploy (Streamlit Community Cloud)
1. Create a GitHub repo and upload this folder's contents (keep `app.py` at the repo root).
2. Go to https://share.streamlit.io → **Create app** → pick the repo, branch, main file `app.py` → **Deploy**.
3. Open the app in Chrome or Edge.

Run locally: `pip install -r requirements.txt && streamlit run app.py`
Or without Streamlit: `python wxbuild.py` then open `dist/studio.html`.

## Notes
- State outlines are fetched in the browser from the public-domain `us-atlas` package (jsDelivr / unpkg).
- Community Cloud apps sleep when idle and have no permanent disk – use **Save** to keep shows.
- Not in Phase 1: live radar/satellite/model data (next phases, see below).

## Roadmap
2. National radar mosaic + NWS alerts + GOES satellite loops (rendered into the studio's map projection)
3. Click-a-site NEXRAD Level II loops (server-side decode)
4. Model scenes: HRRR, GFS, ECMWF open data, RRFS, tropical tracks (NHC ATCF)
5. Fill the 7-day builder from NWS / Model Desk

## Mapbox maps
Scene → Background → **Mapbox map**. Create a free account at mapbox.com, copy your default public token (`pk.…`) and paste it in
Scene → *Mapbox settings* (stored in your browser), or add `MAPBOX_TOKEN = "pk...."` to the app's Streamlit secrets.
Styles keep Mapbox's own zoom rules (cities, towns, roads and road shields pop in/out by zoom); Mercator or Globe projection.
Keep the browser tab visible while exporting. Each studio session uses two Mapbox map loads.
