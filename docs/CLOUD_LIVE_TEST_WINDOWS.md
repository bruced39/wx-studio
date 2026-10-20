# v0.10.2 live cloud test — Windows, two browser profiles

Goal: prove the cloud workspace against the **real** Supabase project (`lcujugmyyuumrshdasla`) before anything is released.
This runs a **separate copy** of the code on your PC at `http://localhost:8502`. It does **not** touch the production app, your normal WX Studio folder, `main`, or the database structure.
Use only the disposable shows named below. Nothing is deleted from your existing shows. You type your own password into each browser; never send it to anyone.

## A. One-time setup (PowerShell)

Needs Git and Python 3.10+ (you already have both if you run WX Studio locally).

```powershell
cd $HOME\Documents
git clone https://github.com/bruced39/wx-studio.git wx-studio-livetest
cd wx-studio-livetest
git checkout claude/v0.10.2-release-test
git log --oneline -1                      # note the commit id; send it to Claude/ChatGPT with your results
py -m venv .venv
.\.venv\Scripts\Activate.ps1              # if Windows blocks it: Set-ExecutionPolicy -Scope Process Bypass, then run it again
pip install -r requirements.txt
streamlit run app.py --server.port 8502
```

Optional (Mapbox maps): create `wx-studio-livetest\.streamlit\secrets.toml` containing `MAPBOX_PUBLIC_TOKEN = "pk.your_public_token"` (this file is git-ignored), or paste the token inside the studio as usual.
Leave this window open while testing. Stop with Ctrl+C. To remove everything afterwards, delete the `wx-studio-livetest` folder.

## B. Two browser profiles

Open **Chrome profile 1** (call it **A**) and **Chrome profile 2** or Edge (call it **B**). Open `http://localhost:8502` in both. Each profile has its own browser storage, so B behaves like a second computer.

### Check 1 — the right project (both profiles)
Click the small **cloud status chip** at the top → the dialog's last line must read
`Cloud project: lcujugmyyuumrshdasla.supabase.co · publishable key …` (last 4 characters shown).
If it shows another host, stop and tell us.

## C. Test script (use only these disposable names)

Write down what you see for each step (✅ / ❌ and anything odd). Keep DevTools (F12) → **Network** open in A; filter on `supabase`.

| # | Profile | Do this | Expected |
|---|---|---|---|
| 1 | A | Sign in with your normal WX Studio login (typed by you). | Chip shows *Syncing* → *Saved to cloud*. No claim wizard unless this browser already has a show. If a wizard appears, choose **Keep it separate**. |
| 2 | A | Page reload (F5). | Still signed in (session refresh works); chip returns to *Saved to cloud*. |
| 3 | A | New show named **ZZ LIVE TEST 1**. Add a background image from your computer (any PNG/JPG under 8 MB) plus some text. | Within ~5 s the chip says *Saved to cloud*. Network: a `POST …/storage/v1/object/wx-studio-media/<your-id>/<64 hex>.png` (raw image, status 200), then `rpc/wx_studio_register_media`, then `rpc/wx_studio_save_show`. |
| 4 | A | Scene → **Templates…** → *Storm Update – night*. | Chip → *Saved to cloud*. Network shows **no** storage POST for the template artwork (bundled images are never uploaded). |
| 5 | B | Sign in (same account). | B opens **ZZ LIVE TEST 1** automatically (or offers it). Your image appears, the storm template background appears, chip *Saved to cloud*. |
| 6 | A and B | Both: change the show **title text** to different words, A first, wait for *Saved to cloud*, then B. | B shows a **Conflict – choose** chip with a **Resolve…** button (or a "Newer version" notice). Your work in B is not lost. |
| 7 | B | In the conflict dialog choose **Keep mine…** (confirm). Then repeat step 6 and choose **Use cloud version**, then once more and choose **Keep both**. | Keep mine: B's text wins and a *Before another computer's version replaced it* entry appears in Version history. Use cloud version: B takes A's text. Keep both: a second show named "… (… copy)" exists in My Shows. |
| 8 | A | Cloud chip → **Version history…** → **Restore** an older version. | A new revision is created (history is not erased); the show shows the restored content. |
| 9 | A | DevTools → Network → set **Offline**. Edit the text. Wait 10 s. | Chip shows *Offline – saved locally*; text stays on screen. Set **No throttling** again. Within ~1 minute the chip returns to *Saved to cloud* with the edit kept. |
| 10 | A | While offline again (as step 9) press F5 to reload, then go back online. | Your edit is still there after reload; it syncs when online. |
| 11 | A | Duplicate-upload test (optional but wanted): DevTools → Console → in the **context dropdown** (top-left of the Console, says *top*) pick the studio's frame, then paste the snippet in section D. | Prints the second upload's real server response (e.g. HTTP 400 *Asset Already Exists* or 409 *Duplicate*) and `"reason":"exists"`. |
| 12 | A | After step 11, look at the chip. | Still *Saved to cloud*; no error message. |
| 13 | A | Cloud chip → **Sign out…** → choose *keep this show on this computer*. Reopen the app. | The show is still on screen; chip says *Sign in to sync*. |
| 14 | A | Sign in again. | Cloud copy and local copy agree; nothing duplicated. |
| 15 | any | Account isolation: nothing to do unless you have a second account. If you do, sign into it in B and confirm it does **not** see ZZ LIVE TEST 1. | Empty My Shows. |

### Optional visual checks
- **Flow / Jet on a real map** (needs a Mapbox token): in **ZZ LIVE TEST 1** add a Mapbox scene, draw a **Flow arrows** line and a **Jet stream** (style Ribbon, *Moving words*, *Soft edges* 45). Zoom the map in and out and pan. Arrows and jet width should scale with the map and stay pinned to the same place. Save, open on B, repeat.
- **MP4**: *Export MP4* → **Scenes to export → This scene only**, Start export; then again with **A range of scenes…**. Open the files in a video player. Chrome/Edge needed (H.264 encoder).

## D. Console snippet for step 11 (uploads one tiny 8×8 image twice)

```js
(async()=>{const C=WXCloudWorkspace,u=WXCloudUI.engine.uid();const c=document.createElement('canvas');c.width=c.height=8;c.getContext('2d').fillRect(0,0,8,8);
const b=await new Promise(r=>c.toBlob(r,'image/png'));const bytes=new Uint8Array(await b.arrayBuffer());const sha=await C.sha256(bytes);const path=u+'/'+sha+'.png';const out=[];
for(let i=0;i<2;i++){try{await WXCloudUI.api.upload(path,bytes,'image/png');out.push('upload '+(i+1)+': OK')}catch(e){out.push('upload '+(i+1)+': HTTP '+e.status+' '+JSON.stringify(e.body)+'  =>  '+JSON.stringify(C.classifyStorageError(e)))}}
console.log(out.join('\n'));})()
```
This leaves one tiny (<1 KB) unregistered image in your private storage; the database rules do not allow deleting it. It is harmless and unrelated to your shows.

## E. Cleaning up
In **My Shows…**, **Delete** **ZZ LIVE TEST 1** and any "(… copy)" show (this is a soft delete; they move to *Deleted shows*). Your other shows are untouched. Delete the `wx-studio-livetest` folder when finished.

## F. What to send back
The commit id from step A, the ✅/❌ list, and for any ❌ a screenshot of the chip/dialog plus (if possible) the Network row for the failing request (status and response body). Do **not** send passwords, tokens or the `Authorization` header.
