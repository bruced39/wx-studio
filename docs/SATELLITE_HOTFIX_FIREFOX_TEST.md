# v0.10.2.2 satellite hotfix – Firefox test on a SEPARATE Streamlit app

Branch under test: **`claude/v0.10.2.2-map-tile-recovery`** (production `main` is not touched; production redeploys only when `main` changes).
No Supabase or cloud-sync code is changed by this branch.

## A. Put the branch on its own Streamlit address (no production impact)
Claude cannot create Streamlit apps (it needs your share.streamlit.io login), so this is a one-time 2-minute step for you:

1. https://share.streamlit.io → **Create app** (or *New app*) → **Deploy a public app from GitHub**.
2. Repository `bruced39/wx-studio` · **Branch `claude/v0.10.2.2-map-tile-recovery`** · Main file `app.py` · App URL e.g. `wx-studio-satellite-test` → **Deploy**.
   (Your existing `wx-studio` production app stays on `main` and is not changed.)
3. Mapbox token: a new address has its own browser storage, so either paste your public `pk.` token once in the studio
   (Scene ▸ Map Style ▸ **Mapbox Token / Quality…**) or add `MAPBOX_PUBLIC_TOKEN = "pk...."` to this test app's Secrets (Manage app ▸ Settings ▸ Secrets).
4. No other secrets. The app already uses the same public Supabase project as production – **use a disposable show only** (`ZZ SAT TEST`), do not edit real shows. If you would rather not touch cloud at all, simply do not sign in; the satellite test needs no account.
5. Open the app in **Firefox**, press **Ctrl+F5**. The studio footer must show version **0.10.2.2** and the commit id of the hotfix branch (not `9497cbf`).

Alternative without Streamlit: `git checkout claude/v0.10.2.2-map-tile-recovery`, `python wxbuild.py`, open `dist/studio.html` in Firefox.

## B. Test script (about 15 minutes)
Open **Map diagnostics** (Scene ▸ Map Style ▸ Mapbox Token / Quality… ▸ *Map diagnostics*) before and after each group; use *Copy report* when something looks wrong.

1. **New map scene** (+ Map scene) with Broadcast ▸ Satellite base: New England view → imagery must be continuous. Diagnostics: *Satellite/base tiles … COMPLETE*, "Tile coverage" line must **not** say UNVERIFIED.
2. **Existing map scene** (open one of your saved shows): same check.
3. **Eastern United States** (zoom out to ~z4) and back to **New England**, then zoom in to city level (~z9–10).
4. **Zoom** with the wheel in and out several times, **pan** by dragging (and right-drag rotate/tilt), then stop: gaps may flash while loading but must **fill in by themselves** within a few seconds. Note how long.
5. **Scene switching:** add 2–3 map scenes at different places, click between the thumbnails quickly several times; each stage and thumbnail must end up complete.
6. **Provoke it:** open the browser devtools Network tab, throttle to *Offline* for ~10 s while panning, set back to *No throttling* – missing tiles should be re-requested automatically (retry back-off 1.5 / 3 / 6 / 12 s). If anything stays missing, press **Reload map tiles** (in the diagnostics dialog) and note whether it fills in.
7. **Diagnostics:** the report should list the satellite source as `[satellite, counted]`, other sources as `[… informational]`, and the 429 line (*Rate limiting … not active*). Copy the report if any line says INCOMPLETE, FAILED, LIMITATION or UNVERIFIED.
8. **Playback and export:** play an ordinary map scene and a non-map scene; export a short MP4 (X preset). The exported video must show complete satellite imagery.

## C. What to send back
Pass/fail per step 1–8, the copied diagnostics report for any failing step, and (for a failure) the Firefox console and the Network entries for `api.mapbox.com` (status codes, e.g. 429).
