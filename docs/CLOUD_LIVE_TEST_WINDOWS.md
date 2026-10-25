# v0.10.2 live cloud test — Windows, two independent browser profiles

Goal: prove the cloud workspace against the **real** Supabase project (`lcujugmyyuumrshdasla`) before v0.10.2 is released.
Branch under test: **`claude/v0.10.2-release-test`** (it contains the database migrations, the whole cloud client, the v0.10.1.6 MP4 fix, the storage/autosave fix and the Cloud workspace / Sync now fix). The exact commit id is given in Claude's report; `git log --oneline -1` in your folder must show the same id. VERSION still reads 0.10.1.6 until you authorize the release.

This runs a **separate copy** of the code at `http://localhost:8502`. It does not touch the production app, your normal WX Studio folder, `main` or the database structure. You type your own password into each browser; never send it to anyone.

## 0. Safety rules — read first

1. **Use only disposable shows named `ZZ LIVE TEST 1` and `ZZ SECOND`.** Never press **Delete**, **Restore**, **Keep mine…** or **Use cloud version** on any other show.
2. **Back up first (a portable file).** In the browser that holds your real work, open the show you care about and use **File ▸ Save** — it downloads a `.wxshow` file containing the show *and its images*. Do this for each important show and keep the files somewhere outside the `wx-studio-livetest` folder (for example `Documents\wx-backups\`). A `.wxshow` can be re-opened with **File ▸ Open** in any version.
3. **Do not clear browser data.** Your shows, images, login and autosaves live in the browser profile for `http://localhost:8502`, not in the git folder. Updating or deleting the folder never touches them. Use the same address (`localhost:8502`) and the same profiles every time.
4. **On Sign out always choose “Keep this show here”.** Never choose “Clear my account data from this computer”.
5. If something looks wrong, **stop**, take a screenshot and report — do not try to “fix” it by deleting things.
6. Nothing in this test costs money. The existing Supabase project is used as is; no new accounts or paid services are needed.
7. Cloud shows you already have stay as they are. The test only creates two new shows. Cleaning up (section E) only soft-deletes those two.

## A. Install or update (PowerShell)

Needs Git and Python 3.10+.

**First time:**

```powershell
cd $HOME\Documents
git clone https://github.com/bruced39/wx-studio.git wx-studio-livetest
cd wx-studio-livetest
git checkout claude/v0.10.2-release-test
git log --oneline -1                      # must equal the commit id in Claude's report
py -m venv .venv
.\.venv\Scripts\Activate.ps1              # if Windows blocks it: Set-ExecutionPolicy -Scope Process Bypass, then run it again
pip install -r requirements.txt
streamlit run app.py --server.port 8502
```

**Already installed (it is on `claude/v0.10.2-storage-fix` or an older branch):** stop the app (Ctrl+C), then

```powershell
cd $HOME\Documents\wx-studio-livetest
git status                                 # expect "nothing to commit"; if files are listed run: git stash
git fetch origin
git checkout claude/v0.10.2-release-test
git pull --ff-only origin claude/v0.10.2-release-test
git log --oneline -1                       # must equal the commit id in Claude's report
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
streamlit run app.py --server.port 8502
```

Optional (Mapbox maps): `wx-studio-livetest\.streamlit\secrets.toml` containing `MAPBOX_PUBLIC_TOKEN = "pk.your_public_token"` (git-ignored).
Leave this window open while testing. Afterwards press Ctrl+C. Deleting the `wx-studio-livetest` folder removes the test copy only.

## B. Two browser profiles

Profile **A** = Chrome profile 1. Profile **B** = a second Chrome profile (or Edge) — a *different profile*, not just another tab: it has its own browser storage, so it behaves like a second computer. Open `http://localhost:8502` in both, press **Ctrl+F5** once in each (loads the new build), and keep DevTools (F12) ▸ **Network** open in A (filter `supabase`).

**Check 0 — the right project (A and B).** Click the cloud chip at the top → **Cloud workspace** dialog → the line at the bottom must read `Cloud project: lcujugmyyuumrshdasla.supabase.co · publishable key …` (last 4 characters). Another host → stop and report.

## C. Test script

Mark each step ✅ / ❌ and note anything odd. Use the exact names below.

### Part 1 — sign in and the Cloud workspace dialog (profile A)

| # | Do this | Expected |
|---|---|---|
| 1 | Do the backup from rule 2. Sign in with your normal WX Studio login. | Chip *Syncing* → *Saved to cloud*. If a “claim this show” wizard appears, choose **Keep it separate** / **Decide later**. |
| 2 | Reload (F5). | Still signed in; chip *Saved to cloud*. |
| 3 | Click the green chip. | **Cloud workspace** opens **directly on the My Shows list** (your real shows listed; the open one marked “open now”). **Only “My Shows” is highlighted** as a tab. Sync now, Save a version now, Version history…, Sign out… and Close are in the same dialog. No extra click needed. |
| 4 | Click **Deleted shows**. | That tab becomes the highlighted one; list shows deleted shows or “No deleted shows.”. |
| 5 | Click **My Shows** (once). | The real list is back on the first click (never “Deleted shows”). |
| 6 | Close and reopen the dialog 4–5 times (also once while on the *Deleted shows* tab). | It **always opens on My Shows**. |
| 7 | **Version history…** then **Back**. | Back returns to Cloud workspace on **My Shows** with the list shown. Close it. |

### Part 2 — initial cloud save, image upload, Sync now messages (A)

| # | Do this | Expected |
|---|---|---|
| 8 | **File ▸ New show**, name it **ZZ LIVE TEST 1**. Add a background image from your computer (PNG/JPG under 8 MB) and some text. Add a second scene with another large background image. | Within about 5 s the chip says *Saved to cloud*. Network: `POST …/storage/v1/object/wx-studio-media/<your-id>/<64 hex>.png` (200) per image, then `rpc/wx_studio_register_media`, then `rpc/wx_studio_save_show`. The editor label says *Saved* (not red “Not saved”). |
| 9 | Chip ▸ **Sync now**. | Button turns to **Syncing…** with a spinner and cannot be clicked twice, then **Cloud sync complete!** with *Completed at <time> · cloud version N* (stays visible in the dialog) — or **Already up to date.** if the auto-save had already sent everything. |
| 10 | Click **Sync now** again without changing anything. | **Already up to date.** (with the cloud version). No new storage upload and no change in the revision number. |
| 11 | Click **Save a version now** (nothing changed). | **Already up to date.** — success, not an error; no new entry in Version history. |
| 12 | Edit some text, immediately open the dialog and click **Sync now**. | **Syncing…** then **Cloud sync complete!** with a higher cloud version. |
| 13 | Scene ▸ **Templates…** ▸ *Storm Update – night*. | Chip *Saved to cloud*. Network shows **no** storage upload for the template’s bundled artwork. |

### Part 3 — message checks with real faults (A)

Nothing in your data changes in this part.

| # | Do this | Expected |
|---|---|---|
| 14 | **Sync incomplete** (optional – needs an image **larger than 8 MB**, for example a big uncompressed PNG; if the editor shrinks it below 8 MB you will simply get “complete”, which is fine): in ZZ LIVE TEST 1 add a new scene and use that image as its background. Wait for the chip, then ▸ **Sync now**. | **Sync incomplete**: the show itself is saved (cloud version N), the image is named and the reason says *larger than the 8 MB limit*; “The images stay on this computer”. The chip is **not** plain “Saved to cloud”. The editor label still says *Saved*. |
| 15 | Remove that scene’s oversized background (or delete the scene) and **Sync now**. | **Cloud sync complete!**; chip *Saved to cloud*. |
| 16 | **Blocked request:** DevTools ▸ Network ▸ ⋮ ▸ **Network request blocking** ▸ add `*rpc/wx_studio_save_show*` and enable it. Change some text; open the dialog ▸ **Sync now**. | **Not synced – no connection to the cloud**, with *Your latest changes are safely saved on this computer.* Chip *Offline – saved locally* (never “Saved to cloud”). |
| 17 | Remove the blocking pattern; **Sync now**. | **Cloud sync complete!** and chip *Saved to cloud*. |

(A genuine server-side error message, **Sync failed**, cannot be produced safely from the browser; it and the local-storage-full cases are covered by the automated tests.)

### Part 4 — second browser and File ▸ New show isolation

| # | Profile | Do this | Expected |
|---|---|---|---|
| 18 | A | **File ▸ New show**, name it **ZZ SECOND**, add a text. Chip ▸ **My Shows**. | List now has **both** *ZZ LIVE TEST 1* and *ZZ SECOND*. Open **ZZ LIVE TEST 1** from the list: its **images, scenes and text are intact** (the previous show was not overwritten with the new one). |
| 19 | B | Sign in (same account). Chip ▸ **My Shows** ▸ **Open** *ZZ LIVE TEST 1*. | The show opens; **both background images appear**; the template background appears; chip *Saved to cloud*. |
| 20 | B | Chip ▸ **Sync now**. | **Already up to date.** (possibly **Cloud sync complete!** once, if opening applied a format update; the second click must say *Already up to date.*). |

### Part 5 — conflict detection and all three choices

A conflict happens when both profiles edit the same show from the same starting point. Each round: make sure both show *Saved to cloud* first, then **A edits and waits for *Saved to cloud***, then **B edits (without reloading) and waits ~5 s**.

| # | Do this | Expected |
|---|---|---|
| 21 | **Round 1** — A: change the title text to “From A 1”. B: change it to “From B 1”. | B shows a conflict (chip *Conflict – choose* / **Resolve…**; Sync now says **Sync paused – this show changed on another computer**, “Nothing was overwritten”). B’s text is still on screen. |
| 22 | B: **Resolve…** ▸ **Keep both**. | A second show named like “ZZ LIVE TEST 1 (… copy)” appears in My Shows with B’s text; ZZ LIVE TEST 1 keeps A’s text. |
| 23 | **Round 2** — repeat the setup (A “From A 2”, B “From B 2”). B: **Resolve…** ▸ **Use cloud version**. | B’s screen takes A’s text (“From A 2”); B’s own version is kept as a recent safety copy. |
| 24 | **Round 3** — repeat (A “From A 3”, B “From B 3”). B: **Resolve…** ▸ **Keep mine…** and confirm. | B’s text wins and syncs; A then picks it up (reload A or wait ~1 min). Version history in B contains the other computer’s version. |

### Part 6 — version history and restore (A)

| # | Do this | Expected |
|---|---|---|
| 25 | Chip ▸ **Version history…** ▸ pick an older version ▸ **Restore**. | A **new** revision is created (history is not erased) and the show shows the restored content. **Back** returns to My Shows. |

### Part 7 — offline editing, reload and recovery (A)

| # | Do this | Expected |
|---|---|---|
| 26 | DevTools ▸ Network ▸ throttling **Offline**. Edit text. Wait 10 s. | Chip *Offline – saved locally*; text stays. The editor label says *Saved*. |
| 27 | Still offline, open the dialog ▸ **Sync now**. | **Not synced – no connection to the cloud**; “safely saved on this computer”. |
| 28 | Still offline: press F5, then reopen ZZ LIVE TEST 1 if needed. | Your offline edit is still there after reload. |
| 29 | Set throttling back to **No throttling**. Wait up to ~1 minute (or **Sync now**). | Chip returns to *Saved to cloud*; Sync now gives **Cloud sync complete!**; open the show in B (reload B) and the offline edit is there. |

### Part 8 — sign out / sign in with local work preserved (A)

| # | Do this | Expected |
|---|---|---|
| 30 | Make one edit, wait for *Saved to cloud*. Chip ▸ **Sign out…** ▸ choose **Keep this show here** ▸ **Sign out**. | The show stays on screen; chip says *Sign in to sync*. |
| 31 | Reload (F5), then sign in again. | The same show is open; cloud and local copy agree; **no duplicate show**; chip *Saved to cloud*; My Shows unchanged. |
| 32 | Optional: go offline, edit, Sign out (**Keep this show here**), go online, reload, sign in. | The offline edit is still on screen and reaches the cloud after sign-in. |

### Part 9 — finishing checks

| # | Do this | Expected |
|---|---|---|
| 33 | Chip ▸ **My Shows**. | All your pre-existing shows are listed with their original names; none deleted or renamed. |
| 34 | Open one of **your own shows** in B, look at it, do **not** edit it, close the dialog. | Its images and scenes look as they did in your backup. |
| 35 | Optional storage check: in ZZ LIVE TEST 1 add a scene and **Upload background…** with a large (~2 MB or more) image. | Editor label *Saved* (hover may mention larger storage); within seconds chip *Saved to cloud*; in B the same image appears. |
| 36 | Optional duplicate-upload check: section D snippet. | See section D. |

### Optional visual checks
- **Flow / Jet on a real map** (needs a Mapbox token): in ZZ LIVE TEST 1 add a Mapbox scene, draw **Flow arrows** and a **Jet stream** (Ribbon, *Moving words*, *Soft edges* 45); zoom and pan — they must scale with the map and stay pinned. Save, open in B.
- **MP4**: *Export MP4* ▸ **This scene only**, and again **A range of scenes…**; play the files in a video player (Chrome/Edge needed).

## D. Console snippet for step 36 (uploads one tiny 8×8 image twice)

In DevTools ▸ Console, pick the studio’s frame in the context dropdown (top-left, says *top*), then paste:

```js
(async()=>{const C=WXCloudWorkspace,u=WXCloudUI.engine.uid();const c=document.createElement('canvas');c.width=c.height=8;c.getContext('2d').fillRect(0,0,8,8);
const b=await new Promise(r=>c.toBlob(r,'image/png'));const bytes=new Uint8Array(await b.arrayBuffer());const sha=await C.sha256(bytes);const path=u+'/'+sha+'.png';const out=[];
for(let i=0;i<2;i++){try{await WXCloudUI.api.upload(path,bytes,'image/png');out.push('upload '+(i+1)+': OK')}catch(e){out.push('upload '+(i+1)+': HTTP '+e.status+' '+JSON.stringify(e.body)+'  =>  '+JSON.stringify(C.classifyStorageError(e)))}}
console.log(out.join('\n'));})()
```
Expected: the second upload prints the server’s real answer (HTTP 400 *Asset Already Exists* or 409 *Duplicate*) and `"reason":"exists"`; the chip stays *Saved to cloud*. This leaves one tiny (<1 KB) unregistered image in your private storage; the database rules do not allow deleting it. It is harmless.

## E. Cleaning up

Chip ▸ **My Shows** ▸ **Delete** only on `ZZ LIVE TEST 1`, `ZZ SECOND` and the “(… copy)” show (soft delete; they move to *Deleted shows* and can be restored). Do not touch any other show. Remove the `wx-studio-livetest` folder when completely finished (your browser data and backups are unaffected).

## F. What to send back

The commit id from `git log --oneline -1`, the ✅/❌ list, and for each ❌ a screenshot of the chip/dialog plus (if possible) the failing Network row (status and response body). Do **not** send passwords, tokens or the `Authorization` header.

## G. Going back

`git checkout claude/v0.10.2-storage-fix` (or any earlier branch) in the same folder restores the previous code; your browser data stays as it is. An interrupted test never needs a data repair: re-open the `.wxshow` backup with **File ▸ Open** if a show ever looks wrong.

## H. Release checklist (not part of the live test; owner in brackets)

- [ChatGPT] The live Supabase migration history does not yet list `20261021114902_explicit_wx_studio_weather_palette_api_grants.sql` (it is already in this branch; the palettes table currently has authenticated access). Apply/record it in the live project before the final release.
- [Claude, after your authorization] VERSION 0.10.2, one coordinated AI_HANDOFF entry, one normal merge of the tested release branch into `main` after refreshing `main`.
- Not included in v0.10.2: cloud video/GIF (v0.10.3).

## I. Targeted retest of the stuck-sync fix (about 10 minutes, branch `claude/v0.10.2-sync-timeout`)

Why: in the live test, *Sync now* in Firefox spun for over a minute after reconnecting. The cause was a cloud request that never got an answer and had no time limit; every request now stops after at most 30 s (larger image uploads get more time), keeps your pending save, and retries safely. Automated tests reproduce the hang and pass; this retest confirms it in real browsers.

Update the test copy (stop the app first, back up with File ▸ Save as before):

```powershell
cd $HOME\Documents\wx-studio-livetest
git status
git fetch origin
git checkout claude/v0.10.2-sync-timeout
git pull --ff-only origin claude/v0.10.2-sync-timeout
git log --oneline -1                         # must match the commit id in Claude's report
.\.venv\Scripts\Activate.ps1
streamlit run app.py --server.port 8502
```
Ctrl+F5 in both profiles, then with a disposable show (for example `ZZ LIVE TEST 1`), profiles **A** (Firefox) and **B** (Chrome) both showing it as *Saved to cloud*:

| # | Do this | Expected |
|---|---|---|
| I1 | A: DevTools ▸ Network ▸ **Offline**. Edit text. | Chip *Offline – saved locally* / *Saved locally*; text stays. |
| I2 | B: edit the same show; wait for *Saved to cloud*. | – |
| I3 | A: set throttling back to **No throttling**. Wait ~10 s, then open the chip ▸ **Sync now**. | Either the **conflict dialog** appears right away (Keep both / Use cloud version / Keep mine…) **or**, if the connection is slow to recover, the dialog shows *Syncing…*, after about 15 s *“Still working – this is taking longer than usual…”*, and within about half a minute per attempt **Not synced – the cloud did not answer** (changes safe on this computer). **It must never spin for more than about a minute, and a reload must not be needed.** |
| I4 | If I3 ended with *did not answer*, click **Sync now** again. | The conflict dialog (or *Cloud sync complete!*). Nothing lost. |
| I5 | In the conflict dialog choose **Keep mine…**. | B’s version is kept in Version history; A’s text is in the cloud; chip *Saved to cloud*. |

Send back ✅/❌ for I1–I5 and a screenshot of any message that appears. A ❌ on I3 (spinner longer than about a minute) is a release blocker.
