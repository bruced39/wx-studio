# Map animation steps — architecture and plan (v0.11.0, branch `claude/v0.11.0-map-animation-steps`)

Goal: in ONE map scene, place fronts / highs-lows / icons / text for **Step 1**, add more steps, change those graphics at each step, and let WX Studio animate the in-between. No Supabase change (steps are plain JSON inside the scene); shows without steps load and render exactly as before.

## 1. What the existing code gives us (checked)

| Fact | Where | Consequence |
|---|---|---|
| A scene is drawn as a pure function of scene time `t` (`E.renderScene`); playback, scrubbing and MP4 export call the same code frame by frame (`E.prepareFrame` + `E.renderShow`) | `engine.js` | Animation = a pure function `objectsAt(scene, t)` used by `renderScene`; editor / preview / MP4 are identical by construction |
| Map-pinned objects (`geo:true`) store `pts` / `x,y` as **[lng, lat]** (Mapbox) or map units, converted per frame by `E.xf(scene,t)` (`toScreen`) | `engine.js`, `mapbox.js` | Interpolate the stored geographic coordinates; zoom, pan and the existing map camera animation stay correct |
| Fronts, lines, arrows are Catmull-Rom curves through `pts` | `symbols.js` | Control points already ARE the curve controls; morph = resample the curve |
| Objects have stable ids; entry animation (`anim`), screen-space `move` path, `moveWith` | `engine.js` | Kept untouched; step logic is layered on top |
| The editor reads/writes `cur().objects` (43 call sites) and snapshots `S.show.scenes` for undo | `ui.js` | Edit a step through a view of the scene whose `objects` is that step's array |
| Cloud document = whole show JSON (assets replaced by hashes); SQL only checks scene `id` and `duration`; 8 MiB limit | `cloud_workspace.js`, migrations | Extra scene keys are stored, synced, versioned and conflict-checked like everything else |
| Scene camera animates `bg.view → bg.view2` on scene time | `engine.js` `viewAt` | Unchanged; runs alongside the steps |

## 2. Data model (compact JSON, deterministic)

```jsonc
scene.objects          // = STEP 1 (exactly as today; old builds / non-animated code still see a normal scene)
scene.anim = {         // absent for ordinary scenes
  "v": 1,
  "speed": 1,          // overall speed multiplier (0.25–4); durations are divided by it
  "steps": [
    { "id": "k1", "name": "Step 1", "hold": 2 },                          // step 1: no "objects" (it is scene.objects), no transition
    { "id": "k2", "name": "Step 2", "hold": 1.5, "dur": 3, "ease": "inout",
      "objects": [ ...full object snapshots for this step, same ids as step 1... ] }
  ]
}
```
* **Steps are snapshots** (like PowerPoint *Morph*): a new step starts as a copy of the selected step (same object ids), you move/bend/restyle, the engine recognises objects by `id`. An object missing from step N+1 leaves; an object new in step N+1 enters. No fragile patch/diff logic; reorder / duplicate / delete are trivial and keep every step's look.
* `hold` = seconds the step stays still (the "pause"). `dur` = seconds of the move **into** the step, `ease` = `inout` | `linear` | `out`.
* `scene.duration` is derived: `Σ hold + Σ dur(step ≥ 2)`, divided by `speed`; kept in sync on every step edit and on load, so the show length, scene list, Present and MP4 export need no change.
* UI-only state (selected step, playhead) is **not** saved and never triggers an autosave.
* Size: ~0.3 KB per object per step; the step bar shows the animation size and warns above 1 MiB.

## 3. Timing

`E.animTimeline(scene)` → ordered segments `hold(step i)` and `move(i-1 → i)`; `E.objectsAt(scene, t)` finds the segment and returns the objects to draw:
* inside a hold → that step's array itself (read-only use, nothing copied);
* inside a move → fresh interpolated copies (saved objects are never mutated), `u = ease(progress)`.

## 4. Interpolation (geographic)

For an id present in both steps (same `type`, same `geo`):
* numbers (`x,y,size,width,weight,opacity,…`) → linear; angles (`dir`, `rot`) → shortest way round; colours (`#hex`, `rgb(a)`) → blended; nested effect objects → recursive.
* `pts` (front, line, arrow, flow, jet, pen): **same number of points** → pairwise (exact, keeps control-point meaning). **Different numbers** → both curves are sampled along their drawn Catmull-Rom path and resampled by arc length to the same N (8–48) points, then blended — a front that gets longer/shorter grows/shrinks smoothly, nothing jumps. At `u=0/1` the exact stored points are drawn.
* text, icon, kind (cold→warm), font family, style … (not blendable) → **crossfade** of the two looks while their positions/sizes still glide. Weight/size/colour of fonts glide.
* An object only in the earlier step: keeps moving in its last direction (velocity of the previous move) while fading out — gone before the move ends. Only in the later step: fades in (and eases up from 90 % size) so it enters smoothly.
All maths is on stored coordinates, so it is correct at any zoom/pan/camera move.

## 5. Editing UX (what you asked for)

* New **Animation bar** under the stage on map scenes: `Animate this scene` → steps strip with proportional blocks (hold = solid, move = gradient), `＋ Step`, duplicate, delete, ◀▶ reorder, per-step **Hold / Move** seconds and easing, overall **Speed**, total length, ▶ play scene, scrub.
* Selecting a step shows that step on the map and **every existing tool edits that step** (move, restyle, change text/fonts, add, delete). A new step inherits the previous step's graphics.
* Fronts (and lines/arrows) get **a few clickable control points** instead of every point: a new step simplifies fronts to ≤ 6 control points without changing their shape; **double-click the curve to add a point**, **Shift+click a point to remove it**; a **Fewer points** button for any line.
* Selecting a front/line selects it whole: drag to move, **rotate handle** (angle), **corner handle** (size), plus numeric Rotate / Scale in the Object panel.
* Fonts / colours / sizes are edited per step in the normal Object panel and glide or crossfade.

## 6. Cloud / file compatibility

Steps live in `scene.anim` of the normal show document: cloud save/open, unchanged-document check (stable key order), revision conflicts (Keep mine / Use cloud / Keep both), version restore and `.wxshow` import/export need no code change; media scans also look into step objects. Old shows have no `anim` and take exactly the old code paths.

## 7. Future precipitation areas

`objectsAt` is type-agnostic: an area is "an object with `pts` (closed) + fill". Morph = the same resampling on closed rings (start-point alignment + equal vertex count) and crossfade for colour/pattern changes. Nothing in the step model changes.

## 8. Risks and decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Snapshot vs. "inherit unchanged properties" | Snapshots. Consequence: a restyle in Step 1 does not automatically reach later steps (same as PowerPoint Morph). A later "apply to all steps" tool is possible. |
| 2 | Front drawn in the opposite direction in the next step | Interpolated point-to-point; the teeth side follows the stored direction/`flip`. Documented; reverse the front in the later step. |
| 3 | Z-order | Per step (snapshot array order). |
| 4 | Existing `move` path / entry animations | Unchanged. Entry animations play at scene start only; step arrivals use the step fade. |
| 5 | Performance | Hold frames copy nothing; move frames clone only interpolated objects; curve sampling is cached per (object, step pair). Checked with a many-object benchmark in Stage 4. |
| 6 | Map camera per step | Out of scope now (camera keeps `view → view2`); the model leaves room for `step.view`. |
| 7 | Editor integration risk (43 `cur()` uses) | `cur()` returns a view with `objects` = the selected step's array (write-through Proxy); the real show is never swapped, so autosave / cloud / undo always see a consistent document. |
| 8 | Version | 0.11.0 (new feature line); bumped at the end of each stage commit from the current VERSION. |

## 9. Stages

1. Data model + step bar + timing + editing controls (+ rotate / scale / few-control-points tools).
2. Geographic interpolation, resampling, appear / disappear, crossfade.
3. Playback, scrubbing, scene duration, MP4 parity.
4. Cloud / `.wxshow` / conflict / offline tests, performance, full regression (Node, browser, PostgreSQL variants), docs.

## 10. Implementation notes (as built)

* `studio/mapanim.js` (new, no DOM/canvas, unit-tested in Node): model (`enable / addStep / dupStep / delStep / moveStep / setStep / setSpeed / flatten / normalize`), `timeline`, `objectsAt`, `interpolate`, `resample`, `simplifyPts`. Exposed as `window.MapAnim`; `Engine.objectsAt` is wired in `renderScene` for non-editing renders only, so editing always shows the selected step exactly as stored.
* Interpolated objects are fresh copies; two private render-only fields carry the animation state: `_a` (opacity) and `_s` (scale about the object's centre). They never reach saved data.
* Cross-fades: when something not blendable changes (text, icon, kind, font, flip, object type) two copies are drawn with complementary opacity; every blendable field (position, size, colour, weight, points) glides in both.
* Editing UI: `cur()` returns a write-through view for step 2+. Rotate (↻) and scale (⤡) handles, double-click-to-add and Shift+click-to-remove control points, "Fewer points", "Reverse", ⟲/⟳/±10 % buttons, and "Copy object → all steps" are in `ui.js`.
* New steps simplify fronts to ≤ 6 control points (Visvalingam–Whyatt, ends kept). Step 1 is never simplified.
* Media scans (`showfile.js` inventory, `export.js` readiness, `reattachLib`, `remapMedia`) look into step objects.
* Version numbers per stage: 0.11.0 (Stage 1) → 0.11.1 (Stage 2) → 0.11.2 (Stage 3) → 0.11.3 (Stage 4); the release number is decided when you approve the merge.
