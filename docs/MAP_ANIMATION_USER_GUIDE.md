# Map scene animation – quick guide (WX Studio v0.11.x)

> **New in v0.11.6 – the master timeline.** Read the next section first. The older "Steps" system (v0.11.0–v0.11.5) is still there and unchanged; every show made with steps keeps working exactly as before.

> **New in v0.11.7 – one clock for graphics, camera and imported media.** The same playhead now also drives the **map camera** and an imported **GIF / MP4 background**. See "One timeline for everything" below.

## One timeline for everything (v0.11.7)
Select a scene and press **Animate**. The timeline now works on **any** background (map, imported video / GIF, image, solid). The older Steps button stays map-only.

### Camera (map scenes)
* A **📷 Camera** row appears on the timeline bar. Move the playhead, then **pan (drag the empty map), zoom (wheel), rotate / tilt (right-drag or the Zoom / Rotate / Tilt sliders in the Animation tab)**. That creates a **camera key** at the playhead (a start key at 0 s is made automatically from the current view). Scrubbing never changes the camera.
* Editing between two camera keys inserts a key; editing exactly on one updates it. Select a camera key to **retime** it (drag the teal diamond or type the time), choose how the move **into** it behaves (*Smooth – keeps moving through keys* (default), *Ease in & out – stops at both keys*, *Constant speed*) or **delete** it. The start key at 0 s stays.
* Smooth = continuous speed through the keys with no overshoot; bearing takes the short way round (170° → −170° passes through 180°). Speed is set by the time between keys: move a key closer in time = faster camera.
* Graphics and camera share the clock: pinned (geo) graphics stay on the geography while the camera moves; screen-pinned graphics stay on the screen. Dragging a graphic at time T places it under the mouse for the camera **at T**.
* **Old start / end camera** (Scene → Camera Move, v0.11.6): scenes keep playing exactly as before. Press **Convert start / end camera to keys** in the Animation tab (also done automatically when you turn Animate on) – the picture does not change.
* **Remove camera animation** keeps the start view and deletes all camera keys.

### Imported GIF / MP4 (media scenes)
* Import the clip (Backgrounds tab → Videos → *Use as this scene's background*). The scene length is matched to the clip (e.g. 4.0 s). If the scene is already animated the timeline length follows.
* On the timeline a **🎞 Media** row shows the clip: playhead **0 s = the first frame** (after the start trim), the playhead at *t* shows the clip frame for *t*. Scrubbing, Play, Pause and Stop keep clip and graphics in step; the exported MP4 uses the same time → frame mapping.
* Animation tab → **Imported media**: *Start trim*, *End trim* (0 = to the end), *Speed* (1 = normal; 2 = twice as fast), *Loop the clip if the scene is longer* (loops inside the trim window; otherwise the last frame is held and the row shows a hatched "holds last frame" bar) and **Match scene length to the clip** (one pass = (end − start) ÷ speed).
* Graphics on top (fronts, H/L, text, icons, arrows) keyframe exactly as on a map scene. Imported clips are **not georeferenced** yet: graphics are screen graphics on the clip, and there is no map camera on these scenes (camera controls are hidden).
* The clip itself stays in your browser (and in a `.wxshow` package); it is not in the cloud database – other computers show "not available" until the clip is added there.

## Master timeline (v0.11.6) – one timeline per map scene
Select a map scene and press **Animate** (next to Scene / Show / Steps). A timeline bar appears under the map and an **Animation** tab opens on the right.

* **One total duration.** Type it in *Animation → Total duration* (e.g. 12). It is the scene length. Keys never change it, and it is not computed from steps.
* **Ruler and playhead.** 1-second ticks with labels, the playhead moves in tenths of a second. Type an exact time in the **Time (s)** box, drag the playhead, or use **Play / Stop**. **◀ Key / Key ▶** jump between keys of the selected object.
* **Keys are automatic.** Move the playhead to a time, then simply edit: drag an icon, reshape a front, rotate, resize. That edit creates (or updates) a key for *that object at that time*. Every object has its own keys; editing the cold front never touches the Low's keys. Scrubbing alone never creates or changes anything. Editing between two keys inserts a key there and leaves the neighbours alone; editing exactly at an existing key updates it (no duplicates).
* **Keys on the bar.** The **All objects** row and the optional **Tracks** rows show diamonds. Click one to select it, drag it to retime, **Delete key** to remove it. The first key at 0 s is the start pose and cannot be removed.
* **Curved paths.** With an object selected the map shows its route in yellow: lettered squares A, B, C… with times. Drag the orange ◆ in the middle of a leg to bend it; then two orange handles shape the curve. Bending never adds keys. **Straight legs / Smooth curve through keys** set the whole route at once.
* **Speed.** Default is constant speed along the route (route length ÷ leg time): a 1 s leg looks faster than a 4 s leg for the same distance, and moving key B farther away raises the speed unless you also change the time. *Speed (all legs)* offers ease in / out.
* **Fronts.** Move the playhead and drag the white round **shape dots** to reshape at that time; move, rotate or scale the whole front as usual. Add or remove dots at a later time: earlier shapes stay exactly as they were. Shape dots (white, round) are different from route handles (orange ◆).
* **Links** (*Animation → Link*): **Independent** (own keys only), **Follow** another object's motion (keeps its offset; unlinking keeps where it visibly is), **Attach to front** (the v0.11.5 behaviour: rides along the front's curve as it moves and reshapes). Moving a linked object at time T keys its *offset* instead of breaking the link. Circular or incompatible links (map-pinned with screen-pinned) are refused.
* **Pinned to map vs screen.** Map-pinned objects move in map coordinates, so they stay on the geography when the camera moves; screen objects move in screen coordinates.
* **Undo / Redo, autosave, cloud, version history, .wxshow, MP4 export** all include the timeline. Preview, Present and MP4 draw the same frame for the same time.

### Old step shows
A scene that uses Steps keeps the step bar and plays exactly as before. Nothing is converted automatically. To use the new timeline on it open the **Animation** tab and press **Convert to master timeline**: the steps become keys at the step times (a copy of the original steps is stored inside the scene). **Back to steps** restores the original steps exactly. If your steps used different styles per step, the conversion warns you (the master timeline has one style per object).

### Limits you should know
* Weather-data loops (native NOAA frames) keep their own clock; only imported GIF / MP4 clips follow the playhead in this version.
* Fronts that were blended point-by-point between steps are converted to the timeline's shape-morph, so the in-between shapes can differ slightly (the shapes at the key times are identical).
* (v0.11.6 only) Camera was not previewed while scrubbing; since v0.11.7 the camera is part of the timeline and previews while scrubbing.
* The **Pin to map** switch is disabled for an object that already has keys (unpin before animating).
* Tested in headless Chromium only; real Firefox and live Mapbox tiles have not been verified for the timeline.

---

# Steps (v0.11.0 – v0.11.5, unchanged)

One map scene can move your weather graphics from step to step, so a 30–60 s forecast needs only a few scenes.

## Make an animation
1. Open a **map scene**, place your fronts, highs/lows, icons and text for the first look.
2. Click **🎞 Animate** (transport row under the map). The **step bar** appears with *Step 1*.
3. Click **＋ Step**. The new step starts as a copy of the selected step. Select it (click its block), then change things on the map – everything you do now belongs to *this step*.
4. Press **▶ Play** (or drag the slider under the step bar) to watch it. Fronts, H/L, icons and text glide in map coordinates, so zooming or the scene’s camera move never shifts them off their place.

## Step bar
| Control | What it does |
|---|---|
| Step blocks | Solid = the step holds still; hatched = the move into that step. Click to edit it. |
| ＋ Step / ⧉ / 🗑 / ◀ ▶ | add (copy of selected), duplicate, delete, move earlier / later |
| Hold s | seconds the step stays still |
| Move s / Motion | seconds to move **into** the step; Smooth / Linear / Ease out (not for step 1) |
| Speed × | speeds up or slows the whole animation (0.25–4) |
| Total | the scene length (set by the steps; the Duration field is locked while animated) |
| Copy object → all steps | puts the selected object into every step exactly as it is here |
| Remove animation | keeps only the selected step; Ctrl+Z brings the animation back |

## Editing a front, line or arrow in a step
* **Click it** to select the whole thing; **drag** to move it.
* **↻ handle** (above it) rotates – hold **Shift** for 15° steps. **⤡ handle** (corner) makes it bigger or smaller. The Object panel has ⟲ ⟳ 15° and − + 10 % buttons too.
* You only see a few **control points** (new steps reduce fronts to at most 6). **Drag a point** to bend the curve, **double-click the line** to add a point, **Shift+click a point** to remove it, **Fewer points** to simplify more, **Reverse** to flip the drawing direction.
* Text, icons, H/L: change text, size, colour, font, icon type in the normal Object panel – size and colour glide, text/icon/type changes cross-fade.

## Scrubbing the playhead, then editing (v0.11.5)
Drag either playhead (the top bar or the one under the step blocks) and **release it on a step, or within about three-quarters of a second of one**. Both playheads then sit on that step (the top one at the scene's start plus the step's time). WX Studio goes back to editing that step: the front's control points, the rotate / scale handles and every tool work again, and your changes go to that step only. Release in the middle of a move between two steps and it stays a preview (a note tells you so) - drag the playhead onto a step, or click a step block, to edit it.

## Follow - icons, labels and H/L that stay with a front (v0.11.5)
Select an icon, text, H or L, open the **Follow** section of the Object tab and pick the front (or any other object) it belongs to. It stays exactly where you put it - nothing jumps - and remembers *where along the front* (for example 40 % of the way) and how far to the side it sits.
* Move, rotate, lengthen, shorten or bend the front in any step and the attached items ride along, keeping their spot.
* Add a step and reshape the front: the attached items glide between the steps on the front's new shape.
* Drag an attached item to give it a new spot; use **Along it (%)** to slide it along the front; choose **Nothing** to detach it.
* Items can follow each other in a chain (a label that follows an icon that follows a front). A loop is never allowed - the list simply does not offer an object that would make one.
* **Pinned vs. not pinned:** an item can only follow something positioned the same way - both pinned to the map, or both fixed on the screen. The list shows only those, and a note says how many were left out and why.
* Switching **Pin to map** on or off for an item that is part of a Follow group switches the whole group together (front, icons, H/L, labels), so nothing jumps and the links stay.
* Between two steps the item is placed on the in-between front at every frame, so it keeps its distance from the front and its place along it even while the front turns or stretches.
* Deleting the front releases the items. Older WX Studio builds still show the saved positions.

## What happens between steps
* Same object in both steps → it moves/morphs from one to the other (fronts with different point counts are re-spaced along their curve, no jumps).
* Only in the **next** step → it fades and scales in. Only in the **earlier** step → it keeps drifting the way it was already moving while it fades out.
* A graphic you add while editing step *k* is also added to all later steps (so it stays); **Delete** removes it from the edited step only (it then fades out at that step).

## Good to know
* Saving, cloud sync, `.wxshow` files, version history and MP4 export all include the steps – nothing special to do. Old shows are unchanged.
* The step data is small (about 2–4 KB per step for a typical scene). WX Studio warns when it grows past 1 MB.
* Camera movement (Scene → map camera start/end) still works as before and runs alongside the steps.
* Planned later: animated rain / snow / mix areas that grow, shrink and move (the step model already allows them).
