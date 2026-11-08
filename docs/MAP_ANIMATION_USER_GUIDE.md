# Map scene animation – quick guide (WX Studio v0.11.x)

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

## What happens between steps
* Same object in both steps → it moves/morphs from one to the other (fronts with different point counts are re-spaced along their curve, no jumps).
* Only in the **next** step → it fades and scales in. Only in the **earlier** step → it keeps drifting the way it was already moving while it fades out.
* A graphic you add while editing step *k* is also added to all later steps (so it stays); **Delete** removes it from the edited step only (it then fades out at that step).

## Good to know
* Saving, cloud sync, `.wxshow` files, version history and MP4 export all include the steps – nothing special to do. Old shows are unchanged.
* The step data is small (about 2–4 KB per step for a typical scene). WX Studio warns when it grows past 1 MB.
* Camera movement (Scene → map camera start/end) still works as before and runs alongside the steps.
* Planned later: animated rain / snow / mix areas that grow, shrink and move (the step model already allows them).
