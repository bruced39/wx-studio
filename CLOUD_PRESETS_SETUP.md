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
