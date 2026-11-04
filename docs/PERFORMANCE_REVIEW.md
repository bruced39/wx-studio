# WX Studio performance review (v0.10.4)

Scope: scene switching, editor/playback rendering, Mapbox cost, memory, export. Baselines were taken **before** any change, on `main` 425e62d (v0.10.2.2) and on the Mapbox-usage branch tip (0.10.3.2); both behaved the same, so the usage-safeguard work adds no performance cost.

## 1. How it was measured

`tests/perf/` is a deterministic harness you can re-run:

| file | purpose |
|---|---|
| `fake_gl.js` | stand-in `mapboxgl` that counts `new Map()` / `setStyle` / `jumpTo` and simulates tile latency (default 700 ms) |
| `perf_lib.py` | builds a 14-scene show (map scenes with fronts, highs/lows, 6 animated icons, 7-day, gradients), instruments `renderScene`, long tasks and map-frame readiness |
| `perf_bench.py` | scenarios: cold/warm switch, 60 rapid switches, idle load, playback frame time, 200-switch memory/listener growth, 30 s export with a fake encoder (frame count + timestamp integrity) |
| `profile_render.py` | CPU-profiles `renderScene` for one scene (self time by function) |

```
python3 wxbuild.py
python3 tests/perf/perf_bench.py --label mine --out mine.json            # everything (export takes minutes)
python3 tests/perf/perf_bench.py --only switch,rapid,idle --label quick
python3 tests/perf/profile_render.py --scene 0
python3 tests/browser/perf_scene_switch_check.py                          # the regression check
```

**Limits of the sandbox numbers.** Chromium 141, 2 CPUs, *software* rasterising, no real Mapbox, no H.264 encoder, **no Firefox** (not installed). Absolute milliseconds are therefore 5-20x slower than a real machine; use the *ratios* and the *call counts*. Section 6 explains how to profile on your own computer in Chrome and Firefox.

## 2. Baseline findings (before changes)

| # | finding | measurement |
|---|---|---|
| 1 | Every scene click rebuilt all 14 cards/canvases (`refreshAll`) and then re-rendered **all** thumbnails at 1920x1080 ~450 ms later | ~2.5 s main thread per click; long tasks up to 3 s; same for map and non-map scenes |
| 2 | The idle editor repaints the whole stage every ~30 ms | 86-99 % of the main thread busy while nothing changes (software raster) |
| 3 | Stage render cost is **canvas raster work**, not JS | profile: ~97 % in `drawImage`/`restore`; JS bookkeeping < 1 ms. Per frame on the map scene: 6 animated icons ~60 ms, 3 fronts ~13 ms, 2 high/low badges ~7 ms |
| 4 | Playback frame time | median 212 ms (map scene), 388 ms (7-day), 130 ms (gradient), same cause as 3 |
| 5 | Export (900 frames) | 383 ms/frame: render 294, RGBA->YUV 13, prepare < 1; **900/900 frames, 0 duplicate, 0 gap** timestamps |
| 6 | Mapbox cost of a scene switch | **none**: 1 map for the whole session, 0 `new Map()`, 0 `setStyle` over 60 rapid switches; map pixels ready 14-21 ms after the click |
| 7 | Memory / leaks over 200 switches | heap flat (9.7 MB), listeners and DOM nodes flat; no leak found |

## 3. Changes in v0.10.4

1. **Scene switch is O(1).** `selectScene(i)` toggles the `.on` card, refreshes the panels and transport, and requests a repaint. No card/canvas rebuild, no thumbnail re-render.
2. **Thumbnail cache.** Each card keeps a cached 192x108 thumbnail keyed by a signature of that scene + show-level settings + an *epoch*. Only scenes whose signature changed are re-rendered, **one per idle slice**, active scene first, nearest neighbours next. `thumbSoon(true)` keeps its old meaning ("something external changed"): it bumps the epoch, so asset loads, fonts, map-outline loads etc. still refresh everything. A 90 s TTL self-heals thumbnails that depend on data loaded elsewhere (weather data). Rebuilding the list (reorder/duplicate/delete) repaints cached thumbnails immediately (no blank flash). Deleted scenes are pruned.
3. **Map thumbnails stay honest.** A map scene's thumbnail is cached only if a finished snapshot for exactly that camera existed (`MB.hasFrame`, a pure peek that makes no request); otherwise it is retried on the next pass, as before. The active map scene still copies the finished editor stage.
4. **Editor loop pacing.** While the user is idle the loop never spends more than ~1/3 of the main thread repainting (interval >= 3x the last repaint cost, capped at 600 ms). Full rate returns on any pointer/key/wheel input, while drawing, dragging or interacting with the map, and a scene switch forces an immediate repaint. If the browser reports pending input (`navigator.scheduling.isInputPending`, Chromium) the repaint is skipped so the click is handled first. On a fast machine (repaint < 10 ms) nothing changes. Playback, present and export are untouched.
5. Instrumentation for tests: `WX.perf.thumbStats / thumbCacheSize / loop`.

Not changed (deliberately): rendering output, export pipeline, timing, Mapbox projection/tile-recovery/pause logic, cloud sync, show files, Supabase.

## 4. Results (same harness, same machine)

Median over the 14-scene run, warm visit unless stated. "Before" = usage-branch tip / main (identical). Sandbox (software raster) milliseconds.

| metric | before | after |
|---|---|---|
| thumbnail main-thread work caused by ONE scene click | 2,450-2,750 ms (all 14 scenes, full size) | **0 ms** (cache hit); 1 scene re-rendered only if you edited it |
| longest single main-thread block after a click | 2.6-3.6 s | **0.4-0.5 s** (= one stage repaint) |
| click handler (DOM work inside the click) | map 16-19 ms, other 3.5-4 ms | map ~10 ms, other ~2.4 ms |
| scene card + panels reflect the click | after the full rebuild (behind the next long task) | immediately |
| new scene visible on the stage | 130-240 ms (one stage repaint, raster-bound) | 130-230 ms (same repaint; **now forced on the very next frame**, even from a throttled idle state) |
| idle main-thread load, map scene | 86 % | **34 %** |
| idle main-thread load, 7-day scene | 99 % | 80 % (one repaint here is ~480 ms) |
| idle main-thread load, gradient scene | 87 % | **38 %** |
| idle long tasks per second (map / 7-day / gradient) | 4.1 / 2.3 / 6.3 | 2.0 / 1.7 / 3.3 |
| 60 rapid switches: thumbnail work | 13 renders, 2,580 ms | **0** |
| 60 rapid switches: click-handler median / p95 | 4.1 / 12.5 ms | 2.4 / 13.0 ms |
| new Mapbox maps / style rebuilds over 60 rapid switches | 0 / 0 | 0 / 0 (unchanged, checked by the regression test over 80 switches) |
| heap / listeners / DOM nodes after 200 switches | 9.7 MB / 232-238 / 1,223-1,253 (flat) | 9.7 MB / 237-238 / 1,234 (flat) |
| playback frame time (map / 7-day / gradient), median | 249 / 497 / 151 ms | 227 / 384 / 135 ms (loop noise; the render path is unchanged) |
| 30 s export, 900 frames, fake encoder | 344 s (383 ms/frame), 900/900, 0 dup, 0 gap | 306 s (341 ms/frame), 900/900, **0 dup, 0 gap** (run-to-run noise; the export path is unchanged) |

Reading this honestly: the visible *stage* repaint is raster-bound and was not made cheaper, so on this software-rendered sandbox the new scene still takes one repaint (130-230 ms) to appear. What was removed is everything piled on top of it: the full list rebuild, 14 full-size thumbnail renders (~2.5 s) and the continuous idle repaint that kept the main thread busy. On a machine with GPU canvas a repaint is typically 5-20 ms, so the same fixes turn "a slight delay" into "no delay"; section 6 shows how to confirm that on your computer.

Cached vs fresh map tiles: a scene switch never touches Mapbox (0 new maps, 0 style rebuilds, map pixels ready in 11-21 ms from the display map's cached frame). Tile loading after a camera change is a separate, asynchronous path whose UI cost is nil (the stage keeps repainting the last good frame; the stand-in's 700 ms latency never blocked a click).

## 5. What was *not* optimised, and why

* **Animated-icon cost (~10 ms each here).** The artwork is drawn with large `drawImage` + `shadowBlur` every frame. Caching frames is *not* safe as a blanket change: 90 phases x 6 icons x sizes is hundreds of MB, and shadows/compositing differ if baked. Candidate for a real-GPU measurement first (see section 6). If it is a problem on your machine, the safe options are (a) a bounded LRU of pre-shadowed sprites for the editor/preview only, never for export, (b) quantising the preview to 15 fps.
* **Export render time.** It is raster-bound like playback; export must stay exact, so it keeps the unmodified path. Its frame integrity was verified (count and timestamps) before and after.
* **Firefox.** Not available in the sandbox; please run the checks in section 6.

## 6. Profiling on your own computer

**Chrome / Edge** (open the app, e.g. https://wx-studio.streamlit.app, or the test app):
1. `F12` -> *Performance* tab -> tick **Screenshots**, leave *Web Vitals* off.
2. Press *Record*, click through 5-6 scenes at normal speed, press *Stop*.
3. Look at the **Main** track: before v0.10.4 each click was followed by a ~0.5 s+ block of `renderScene`/`drawThumb` tasks (red-cornered *Long Task* flags); after it should be only the stage repaint. In *Summary* check *Scripting* vs *Rendering/Painting*.
4. Idle load: record 10 s with nothing happening; *Frames* lane shows the repaint cadence, and the CPU graph should sit at or below ~35 % for slow repaints.
5. GPU: `chrome://gpu` should say *Canvas: Hardware accelerated*; if it says *Software only* the app will feel much slower everywhere.
6. Console one-liners: `WX.perf.thumbStats` (renders vs cacheHits), `WX.perf.loop` (frames, throttled, skippedInput, lastCost ms).

**Firefox:**
1. `F12` -> *Performance* -> *Start recording*, same actions, *Capture recording*.
2. Open the *Flame Graph* / *Call Tree*; invert the call tree and look for `drawImage` and `CanvasRenderingContext2D.restore` self time.
3. `about:support` -> *Graphics*: check *Compositing* is WebRender (hardware) rather than Basic/software; `about:config` `gfx.canvas.accelerated` should be true.
4. `WX.perf.loop.lastCost` in the console gives the editor repaint cost directly (Firefox lacks `isInputPending`, so only the pacing part applies).

**Export:** the dialog's own progress shows fps. Compare a 30 s export of your real show before/after; expect the same duration (raster-bound) but a responsive editor while it runs is not promised by this release.

Please send back: browser + version, GPU line from `chrome://gpu` / `about:support`, `WX.perf.loop.lastCost` while idle on a map scene, and the Performance recording summary of a 6-click switch sequence.

## 7. Interaction with the other branches

* **Mapbox usage safeguards (0.10.3.x).** This branch is stacked on it (`claude/v0.10.3-mapbox-usage-safeguards` @ 443b6d6). Only one `mapbox.js` line is added (`MB.hasFrame`, a pure cache peek with no request side effect); pause/resume, generation staleness, tile recovery and the projector are untouched. Fewer thumbnail passes also means fewer camera-driven snapshot requests from non-active map scenes. Merge order: hotfix (done) -> usage -> **performance** -> animation reconciliation.
* **Animation branch (`claude/v0.11.0-map-animation-steps`, 0.11.4).** Expected conflicts are limited to `studio/ui.js` (`renderSceneList`, the card click handler, `drawThumb`/`thumbSoon`, the `loop` function head). Anything the animation work adds that changes pixels asynchronously must call `thumbSoon(true)` (as `E.onAsset` does); content that changes the *scene object* is picked up automatically through the signature. New per-frame work should go through `renderScene` so the idle pacing sees its cost. Animated map steps (fronts moving over a map) are raster work like the icons, so please measure them with `perf_bench.py --only anim,idle` before merging.
