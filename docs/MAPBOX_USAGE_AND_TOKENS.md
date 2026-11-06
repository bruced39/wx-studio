# Mapbox usage safeguards and tokens (v0.10.3)

Audience: the owner of the Mapbox account, ChatGPT and Claude. Status: **feature branch, not merged.**

WX Studio cannot cap spending. **Billing, usage alerts and token restrictions live in the Mapbox account.** Everything below only
reduces how many billable calls WX Studio makes and makes unexpected behaviour visible. The counters in the app are **local
estimates from one browser**, not Mapbox billing figures.

## 1. What Mapbox bills (as verified by ChatGPT, October 2026 – re-check on mapbox.com/pricing)

| Product | Used by WX Studio for | Free per month | Counted as |
|---|---|---|---|
| Mapbox GL JS (v3) | the hidden display map (satellite/streets), previews, MP4 frames | 50,000 map loads | **one load per `new mapboxgl.Map()`**. Tiles, style changes, zoom, pan are *not* extra loads inside the session (12 h max) |
| Static Images API | the Satellite style-card thumbnail in Map Style | 50,000 requests | each image request |
| Raster Tiles API | not used directly (GL JS tiles are inside the map load) | 750,000 | separate product |

There is no guaranteed hard spending cap.

## 2. Audit of v0.10.2.2 (before this change)

| Finding | Detail |
|---|---|
| Maps per page load | **2**: display map `D` + an empty-style "projector" `P` that only called `project()` / `unproject()` |
| "Save & load map" | `setToken()` and `setScale()` always destroyed and recreated both maps, even when nothing changed (2 more loads per click) |
| Scene / style / zoom / camera | reuse `D` (`setStyle`, `jumpTo`). **No extra loads** – verified again by the new browser check |
| Init loops | none found; a failed init latches `error` (no automatic retry); tile retries and 429/503 cool-downs never construct maps |
| Idle | no polling or timers touch Mapbox; verified by an idle test (no map, style, camera or event activity for 3.5 s) |
| Streamlit | a Streamlit rerun that reloads the component iframe is a page load (+1). This cannot be avoided in the app, so it is *counted* (tab-session counter) |
| Static Images | the Satellite style card builds the image URL each time the Map Style panel redraws |

## 3. What v0.10.3 changes

1. **One map load per page, not two.** The projector no longer exists at startup. Screen⇄geographic conversion for flat (mercator, pitch 0)
   cameras is exact Web-Mercator arithmetic. See §4 for how accuracy is protected. A helper map is created **lazily, once, and counted** only
   for cameras the maths does not cover: globe, pitch > 0, poles in view / zoom so low that Mapbox would move the camera, or if the self-test
   fails. Troubleshooting switch: *Mapbox settings → "use a separate helper map"* (or `localStorage['wx.mapbox.projector']='native'`) restores the old behaviour.
2. **No-op guards.** `MB.setToken()` / `MB.setScale()` do nothing when the effective token / label size is already in use (counted as "redundant
   reloads skipped"). A *failed* map can still be retried with the same token. When Streamlit Secrets supply the token, the browser token cannot
   change the effective token, so nothing is rebuilt.
3. **Reset mid-render safety.** A frame that fails because `MB.reset()` destroyed the map underneath it is ignored instead of latching a sticky "Mapbox error" on the new map (which previously pushed users to reload the page = another load).
4. **Local usage accounting** (`MB.usage()`): maps started this page load (display / helper), resets, skipped reloads, tab-session total (`sessionStorage`), calendar-month total for this browser (`localStorage`, UTC month), Static-Images previews. Warnings (always labelled local estimates):
   more than 3 maps in one page load, more than 12 in one tab session, more than 5,000 this month in this browser. Shown in *Mapbox settings* and in *Map diagnostics*.
5. **Pause Mapbox requests** (Scene panel button and Mapbox settings). Per tab (`sessionStorage`), so it cannot be forgotten for days. While paused the display map is **never moved or restyled**: no `Map` is created (including the helper), `doSnap`, the live-preview paths (`liveCanvas()` / `stableEditorFrame()` – no `jumpTo`, no restore jump after an interrupted snapshot), automatic tile retries, "Reload map tiles", WebGL-context-restore recovery and the style-card image are all blocked. Uncached snapshots are refused *without* marking Mapbox as failed. A live canvas is shown only if it is already at the requested camera; otherwise cached frames or the "Mapbox is paused" placeholder are drawn.
   Still works: editing, other backgrounds, saved shows, Cloud Workspace, already-drawn map frames, object positions (pure maths).
   **In-flight work:** requests already sent to Mapbox before the click (tiles, a style being fetched) **cannot be cancelled and may finish**, and their tiles may still arrive. Pausing bumps the render generation, so a snapshot that was running stops at its next checkpoint (after the style step, after each wait for tiles, before any retry) and no further camera move, style change or retry is issued; queued snapshots refuse to start. The generation is captured **before the very first await of `doSnap` (the initial `MB.init()` load)** - and, for a request that waited in the snapshot queue, at the moment `MB.snap` was *called* - so a **rapid pause + resume** (or a reset) while Mapbox is still loading for the first time, while the request waits behind another snapshot, or while `setup()` is waiting for `style.load`, makes that old operation stale - including while tiles are loading, where v0.10.3.3 and earlier returned a silent `null` that an export could not tell from a frame (v0.10.3.4: it is now the same `mbStale` error, so a map export stops and reports failure instead of producing an incomplete MP4) (v0.10.3.3 closed the first two cases; v0.10.3.1/.2 only covered the style wait): after the style arrives it changes nothing else (no projection/fog/terrain, no camera move), forgets the style bookkeeping so the next frame re-applies its own style, and ends with a non-latching `mbStale` error. The pause flag is kept in `sessionStorage`: it survives ordinary reloads of the same tab (Streamlit iframe reloads) and a new tab starts active. Resuming does not create a map by itself – the existing display map is reused, the camera is re-applied by the next normal redraw (a map that was never started is created once, on resume).
   **Export:** a show with map scenes cannot start while paused – the preflight shows an error with a **Resume Mapbox** button, and `prepare()` also refuses, so a video can never silently contain placeholders. Exports of shows without map scenes are unaffected.
6. **Tokens** (§5): `mapbox_token.py` picks a public token (optionally per host); secret/temporary tokens are refused by name; the settings dialog shows the masked token and its source, never asks to retype a Secrets token, and prints the URL to allow in Mapbox.
7. **Diagnostics** gained: pause state, usage counters, projector mode + self-test result, token kind/source/page origin (never the token).

Not changed: tile recovery, 429/503 cool-down, 4 s manual-reload guard, 24-tile cap, critical-source completeness, Cloud Workspace, saved-show format, Supabase files (untouched).

## 4. Why the maths cannot silently mis-place objects

* The formula is Web-Mercator with 512-px tiles (`world = 512·2^zoom`), rotated by the bearing, centred in the 1280×720 CSS-pixel map (× the label scale for output pixels).
* **Runtime self-test** right after the display map is ready (and retried if it was busy): the maths is compared against the display map's own `project()` at 7 points; tolerance 0.02 px (observed error is numerical noise). Rotation is checked on a private `transform.clone()` at two bearings; if that copy is unavailable only unrotated cameras use the maths. **Any** disagreement → the maths is disabled for the session and the helper map is used (the diagnostics say why).
* **Per-call guard:** the maths is used only if the camera is mercator, pitch 0, |lng| ≤ 180 and unconstrained (the world is taller than the view and the poles are not in view), because those are the cases where Mapbox moves the requested camera itself.
* Tests: random cameras/bearings/points against an independently written matrix-style transform (max error < 1e-5 px); a deliberately 1-px-wrong "Mapbox" is rejected; moving/pitched/globe/constrained displays are not trusted; the browser check compares `MB.xf` with the stand-in's `project()` for five cameras and with the native helper path.
* **Limit of the test environment:** real Mapbox GL cannot be downloaded in CI/sandbox. The self-test therefore runs for real on the first load in the owner's browser; please open *Map diagnostics* once on the test app and confirm `Projector: exact Mercator maths, verified against the live display map`. If it says `helper map when needed (...)`, nothing is wrong – it just costs one extra load.

## 5. Public tokens and Streamlit Secrets

* Only **public `pk.` tokens** may reach a browser. `sk.` / `tk.` values in Secrets are ignored and reported **by key name only**; `MB.hasToken()` also rejects them.
* Secrets (Streamlit app → Settings → Secrets) – the simple case, one token per app:
  ```toml
  MAPBOX_PUBLIC_TOKEN = "pk.…"
  ```
  One codebase serving several hostnames can pick a token by `Host` header (requires Streamlit ≥ 1.37 for the header; otherwise falls back to the single token):
  ```toml
  [MAPBOX_PUBLIC_TOKENS_BY_HOST]
  "wx-studio.streamlit.app" = "pk.…production…"
  "wx-studio-satellite-test.streamlit.app" = "pk.…test…"
  ```
  Priority: host table → `MAPBOX_PUBLIC_TOKEN` → `MAPBOX_TOKEN` (legacy).
* With a Secrets token nobody has to paste anything. The dialog shows `pk.…abcd`, does **not** copy it into the browser, and ignores an older browser token (it says so).
* **Create dedicated, restricted tokens** (Mapbox account → Tokens → Create a token): keep only the default public scopes (no secret or write scopes); under **URL restrictions** add exactly the sites that should use it:
  * production: `https://wx-studio.streamlit.app`
  * the satellite test app: `https://wx-studio-satellite-test.streamlit.app` (use a **different token** from production so either can be revoked alone)
  * local development: a separate token with `http://localhost:8501`
  Mapbox checks the `Referer` of each request. The Streamlit component is an iframe of the app page, so the app's origin is what is sent. **This could not be verified in the sandbox** – after restricting a token, open the app once; a wrong URL shows "Mapbox rejected the token (403)" immediately and is fixed by adding the origin shown in *Map diagnostics → "page origin"*.
* Browser-saved tokens are still synced by the Cloud Workspace (existing allow-listed setting `wx.mapbox.token`). A URL-restricted token saved that way works only on its allowed sites. Prefer Secrets so no token is saved at all. No cloud/Supabase file was changed.
* Rotate a token by creating a new one, updating Secrets, then deleting the old one in Mapbox.

## 6. What stays with the Mapbox account

Set a billing/usage **alert** and review **Statistics** weekly while moving to pay-as-you-go. The in-app numbers cannot see other users or browsers, nor Static Images/Raster API usage beyond this tab's own style-card requests. Do not rely on WX Studio to stop charges.

Rough budget: a normal editing session = 1 load per page load/Streamlit iframe reload (+1 only for globe/pitched/polar cameras, +1 per label-size or token change). 50,000 free loads ≈ 50,000 page loads per month.

## 7. Effects on the v0.11.4 animation branch (`claude/v0.11.0-map-animation-steps`)

Nothing was changed on that branch. When it is reconciled with main after the hotfix:

* **No API change.** It calls only `MB.xf`, `MB.panByPixels`, `MB.snap`, `MB.frame`/`liveFrame`, `MB.init`, `MB.diagnostics`, `MB.reloadTiles` – all still exist with the same signatures/returns.
* **Per-frame cost improves.** Animated exports call `MB.xf` once per object per frame; the maths path avoids a `P.jumpTo` per camera. `MB.snap` still reuses the one display map, so a long animated export creates **no** additional maps.
* **In-between cameras** that pass through globe / pitch / low zoom use the lazily created helper map (≤ 1 extra load per page, counted). Flat regional animations (the normal case) never create it.
* **Conflicts expected in `studio/ui.js` (`mapboxSettings`)** and in `studio/mapbox.js` around `MB.init` / `MB.reset` / `MB.snap` / `MB.xf` / `MB.diagnostics`: take the v0.10.3 versions, then re-run that branch's `map_animation_*` checks. Two source-slicing Node tests need the same small updates as here (`tests/map_loading_recovery.test.js`: pump guard regex, reset stub variables, `renderGeneration` in the `MB.snap` harness).
* **Export while paused** uses the new preflight; animated map shows therefore also ask to resume first.
* Its stored shows are unaffected (no show-file or cloud-format change here).


## MP4 export validation (v0.10.3.5)

An MP4 export may only encode **complete** map frames. `X.encodeFrames` calls `E.prepareFrame(show, T, {strict:true})`, which asks `MB.snap(bg, cam, {strict:true})` for every map frame:

| situation | editor (unchanged) | MP4 export |
|---|---|---|
| critical tiles (satellite, or base vector tiles if no satellite) fully loaded | frame shown | frame accepted |
| optional sources (terrain/DEM, images, labels) failed or pending | ignored | ignored - never blocks |
| critical tiles pending/failed | incomplete picture shown, retried in the background | up to 3 bounded recovery rounds (existing `recoverTiles`, 24-tile cap, `settle` 6 s each), then **export fails** |
| normal tile-loading timeout | quiet "no frame yet" | one more bounded wait per round, then **export fails** (`timeout`) |
| HTTP 429/503 cool-down with failed tiles | waits | **fails at once**, no re-requests (`rate-limited`) |
| pause / resume / reset while rendering | stale, dropped | **fails** (0.10.3.4) |
| cached frame recorded as incomplete | may be shown | never accepted; re-rendered |

Messages read like `Map scene "Radar" at 12.3 s: Required map imagery failed to load: 2 failed of 6 required map tiles. Check the connection or Mapbox token, use Reload map tiles, then export again.` No MP4 is returned or saved, the encoder is closed, the show and saved data are untouched, and the next export attempt works. Worst case for a bad frame is about 1 + 3 x 6 s of waiting; no extra Map instance is ever created. If Mapbox internals needed to verify tiles are unavailable, strict falls back to `map.loaded()` (as the editor does) and `DIAG.exportUnverified` counts those frames.
