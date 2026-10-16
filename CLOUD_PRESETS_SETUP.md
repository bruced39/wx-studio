# WX Studio Cloud Map Presets — User Guide

## Status

**Configured to use a dedicated, isolated WX Studio Supabase project in US East.**
The project was created on 2026-10-15 in Dave's Org at a quoted cost of **$0/month**.
Project ID: `lcujugmyyuumrshdasla`.

- Secure table: `public.wx_studio_map_presets`, with row-level security and per-account Read / Add / Update / Delete policies.
- WX Studio includes this project's **public** `sb_publishable_` key in `app.py`. This is intentionally browser-safe. No database secret or service-role key is present in GitHub or sent to a browser.
- Streamlit **does not need secrets configured** to use the standard cloud account. If you need to migrate projects later, optional `WX_SUPABASE_URL` and `WX_SUPABASE_PUBLISHABLE_KEY` entries in Streamlit Cloud Secrets override these public defaults.
- Existing WXfusion forecast tables remain in their separate Supabase project, untouched.

## First use

1. Open the deployed WX Studio and go to **Map Style (folded-map toolbar icon) → Saved Styles**.
2. Under **Cloud Presets**, select **Create Account** using your email and a password with at least 8 characters.
3. If Supabase sends a confirmation email, confirm your address and return to WX Studio to **Sign In**. If email confirmation redirects to a generic page, the account can still be confirmed; return to the WX Studio tab.
4. Arrange your map exactly how you want: location, zoom, pitch, bearing, satellite/dark/custom, colors, labels, borders and overlays. Click **Save to Cloud** at the top, and enter a preset name.
5. On another computer or browser, open WX Studio, sign in with the **same cloud account**, click **Saved Styles → Load Preset**. All matching view/style values load into the active scene.
6. **Move, zoom and edit freely after loading.** This does not edit the stored preset. To intentionally update its stored version, click **Save to Cloud** again using the same name and approve overwrite.
7. To delete, choose **Delete** on the named cloud preset and confirm.
8. Any presets already stored in your browser appear under **This Browser — Local Presets**. Click **Upload Local Presets to Cloud** to copy them up; browser copies stay in place.

## Existing shows / default map

Cloud presets are separate from your WX Studio show files and **Save Default View**. Loading a preset does not automatically replace the startup default. To set that view as the startup default, load it and click **Save Default View**.

Cloud presets are private to the signed-in Supabase account; there is no cross-account sharing. Cloud presets are not saved as GitHub commits and not automatically imported from old browser storage.

## Setup and operational notes

- The user's deployed Streamlit Studio uses the new project automatically (no external Streamlit Secrets step).
- Supabase Auth sign-up may require email confirmation and be subject to built-in rate limits; if sign-in fails after confirming, check the dedicated project's **Authentication** configuration in the Supabase dashboard.
- Using a public Supabase publishable key is safe only with strict RLS. Keep every new Supabase table protected; **never** use a service-role / `sb_secret_` key in browser code.
- User's original WXfusion Supabase project has five old public tables with RLS disabled (`forecast_runs`, `forecast_daily`, `verification`, `custom_locations`, `wxfusion_schema_meta`). Those are unrelated to WX Studio; we left them unchanged. This still merits separate security review, without blindly disabling existing integrations.
- Test live signup, cloud Save/Load/Delete, local-preset upload and accessing saved presets from a second device. JS REST methods have unit tests, but real browser Auth flow requires user verification.

## Cloud Banners, Graphics and PNG Backgrounds (v0.9.42)

Your cloud account for banners and graphics is **the same account** you use for Map Style → Saved Styles → Cloud Presets. You do not need to register again or enter Supabase administrator credentials.

1. Sign in to WX Studio under **Map Style → Saved Styles → Cloud Presets** if you haven't already. Return to the Assets side tab.
2. Open **Assets → Banners** or **Assets → Graphics** and upload a transparent **PNG** using the existing local upload area. Your original PNG pixels and transparent background are preserved; no JPEG conversion or canvas resizing is performed. Maximum: **8 MB per file**.
3. On the thumbnail in **your local library**, click **☁ Save to cloud**. You may also click **Upload all local items to cloud** to copy all local PNGs in that category. Your browser copies stay intact.
4. Below the local library, the **Cloud library** shows the banners or graphics saved in your signed-in account. Click a cloud thumbnail or **Download** to copy it into the local library. Then click the local thumbnail to place it in a scene normally. Cloud files are *not* automatically added to scenes when browsing.
5. On another computer or browser, sign in to the **same WX Studio cloud account**, go to Assets → Banners/Graphics, click **Refresh cloud**, then **Download**. It will be available there like any local PNG.
6. **Rename** changes a cloud item's display name. **Delete** removes only the cloud copy after confirmation; existing downloaded local items and placed graphics remain in your shows.
7. Assets → Backgrounds also has a cloud list. The existing browser-local photo background workflow still works normally; when you upload a local JPG background to the cloud, only its **cloud copy** is converted into PNG. The local image is unchanged, and the 8 MB cloud limit still applies.

**The cloud library does not lock your scene.** Place a downloaded banner, move/resize it, animate it, or use it in another scene. Existing overlay asset IDs remain `ov_<local-id>`. Saving cloud items does not alter your scene objects or show file.

### Security and activation

- **No dashboard work is needed.** The dedicated WX Studio Supabase project (`lcujugmyyuumrshdasla`) now has the private Storage bucket `wx-studio-banners` and owner-only metadata table `public.wx_studio_assets`. Both were created through Supabase tooling and verified.
- Storage paths have the form `<your-account-id>/<banner|graphic|background>/<random-uuid>.png`. A separate login is not required, and no private/service-role key is placed in GitHub or browser code.
- The metadata table and Storage object policies allow signed-in users to read, upload, change or delete **only their own files**. Anonymous users have no metadata table privileges. Storage is private; thumbnail links expire.
- Bucket-level upload limit: 8 MB, PNG only. If an upload fails because of its type or size, the local copy is not deleted. An internet outage likewise leaves the local library usable.
- If the new features are missing, wait until the deployed app displays **v0.9.42** and hard refresh the browser (Ctrl+F5). For account issues, sign in again under Map Style → Saved Styles.

### Manual check (first use)

- Sign in to your existing WX Studio cloud account.
- Upload a transparent PNG banner, select **Save to cloud**, and check it appears under **Cloud library** with a transparent-background thumbnail.
- Open WX Studio in a second browser or computer, sign in with the same email/password, click **Refresh cloud**, and find the same banner.
- Click its thumbnail or Download. Confirm it appears in the **local library**; click the local item to place it in a scene. Check transparency, position, and resizing.
- Rename the cloud banner and refresh in both browsers. Confirm the new name is shown.
- Delete the cloud banner; confirm it disappears from the cloud list **but not** from previously downloaded local items or objects already placed in scenes.
- Try a JPG graphic or PNG larger than 8 MB and verify you see a readable error rather than a converted image.
- Temporarily disconnect from the internet and confirm already-downloaded local banners still work.

Automated tests: `node --test tests/cloud_assets.test.js` (Node 18+; uses an in-memory Supabase API mock and no real account). Browser login and cross-device sync still require your visual confirmation.
