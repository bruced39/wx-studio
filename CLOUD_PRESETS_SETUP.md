> **ACTIVATION BLOCKED — SECURITY REVIEW REQUIRED.** Do NOT add a publishable key from the existing `wxfusion` Supabase project to Streamlit. Its five older public forecast tables lack RLS. Prefer a dedicated, isolated Supabase project for cloud presets; ask the project owner to approve its cost and organization first. Update this guide with the NEW project's URL afterward.

# WX Studio Cloud Map Presets — Setup

**Status:** An empty, RLS-protected table was created in the existing `wxfusion` project, but we are NOT activating it because other WXfusion forecast tables remain accessible to its anonymous API role. A separate Supabase project with this same schema is the recommended deployment target. No forecast tables were changed.

## One-time Streamlit secrets configuration

Open the WX Studio application in Streamlit Community Cloud, go to **Manage app → Settings → Secrets** (wording can vary), and add:

```toml
WX_SUPABASE_URL = "https://YOUR_NEW_ISOLATED_PROJECT.supabase.co"
WX_SUPABASE_PUBLISHABLE_KEY = "YOUR_REAL_SB_PUBLISHABLE_KEY"
```

Find the value under **Supabase Dashboard → your NEW dedicated WX Studio project → Settings → API Keys → Publishable key**. Use only an `sb_publishable_` key (the application deliberately rejects legacy JWT keys to prevent accidentally exposing service-role credentials). **NEVER use a `service_role` or `sb_secret_` key.** Do not commit keys or passwords to GitHub or this file.

After saving Streamlit secrets and redeploying/rerunning the app, refresh WX Studio and open **Map Style → Saved Styles**.

## Using it

1. Under **Cloud Presets**, create a cloud account with your email and a unique password, or sign in with an existing Supabase Auth account for this project.
2. Depending on the project's authentication configuration, you may need to click a confirmation link sent to your email, return to WX Studio, then **Sign In**. For a dedicated WX Studio Supabase project, set the Auth Site URL/allowed redirects to the WX Studio app after reviewing email confirmation behavior.
3. Set up the map (center, zoom, pitch, bearing, colors, borders, overlays, etc.), and click **Save to Cloud**. Enter a preset name.
4. On any device, open WX Studio, sign in using the same email/password, open **Saved Styles** and click **Load Preset**.
5. Loading a preset changes the *current scene's* map view and settings only. You can then pan, zoom and edit the map without changing the stored preset. Objects/other scenes are preserved.
6. **Delete** removes a named cloud preset from the signed-in account, after confirmation.
7. If you have old browser-only presets, click **Upload Local Presets to Cloud**. Copies remain in this browser; matching cloud names will be overwritten only after confirmation. Old style-only presets without a saved camera still load without moving the map.

Cloud presets are NOT the same as **Save Default View**. Loading one does not change WX Studio's startup default; load it, then click Save Default View if you want that view at launch.

## Fallback / limitations

- Without Streamlit secrets, the Saved Styles tab shows that cloud setup is missing and continues to offer working browser-local presets. This preserves compatibility with prior versions.
- Cloud account passwords and session tokens are never stored in GitHub. The browser stores the signed-in session locally, while Supabase stores presets behind RLS. A publicly usable Supabase publishable key is not a service-role secret.
- Preset cloud sharing between different user accounts is not enabled; users see only their own account's rows. Same account on any device sees the same presets.
- Supabase Auth signup/confirmation email behavior depends on the connected project's Auth configuration and outgoing email provider/rate limits. Configure those in Supabase as necessary.
- A Streamlit app must be re-run after setting secrets. Cloud sync cannot work until the key has been entered in Streamlit Cloud.
- Browser-only local presets are not synced until explicitly uploaded.

## Supabase security advisory (existing WXfusion tables)

The connected Supabase project currently reports **RLS disabled** for these *pre-existing* public tables:
`forecast_runs`, `forecast_daily`, `verification`, `custom_locations` and `wxfusion_schema_meta`.
This may expose them to the project's anon/authenticated API roles. **Do not blindly turn on RLS for those tables:** existing WXfusion workflows might depend on their current permissions. Review their access patterns and appropriate policies separately. The new WX Studio presets table has its own RLS enabled and does not require altering the forecast tables.

See [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).
