# v0.10.2 release checklist and Streamlit deployment

Status: **release authorized 2026-10-25; production verification follows the merge.** Owner authorized the release in chat. No Supabase migration or data changes are required at deployment. Production = the Streamlit Community Cloud app `wx-studio.streamlit.app`, deployed from branch `main`, main file `app.py` (see README). It redeploys automatically when `main` changes.

## 1. Gates (all must be ✔ before the release step)

| # | Gate | Owner | State |
|---|---|---|---|
| 1 | Real two-browser live test passed (sign-in, My Shows, sync idempotency, 3 conflict choices, history/restore, offline, New show isolation, sign-out/in, image upload to second browser) | user + ChatGPT | ✔ reported 2026-10-25 |
| 2 | Live database verified (revisions, media registered, offline edit preserved) | ChatGPT | ✔ reported |
| 3 | Weather-palettes grants migration (`20261021114902_…`) applied **and recorded** in the live project | ChatGPT | ✔ reported |
| 4 | Stuck-sync fix (request timeouts) on `claude/v0.10.2-sync-timeout`, automated tests green | Claude | ✔ see report |
| 5 | Targeted browser retest of the exact "Keep mine after offline" scenario on the fix branch (section I of `CLOUD_LIVE_TEST_WINDOWS.md`, ~10 min) | user | ✔ passed 2026-10-25 (revision 14 after Firefox Keep mine) |
| 6 | ChatGPT checks the Supabase API/Postgres logs for the hung `wx_studio_save_show` call from the live test (rule out a server-side lock; the client-side cause is already fixed and tested) | ChatGPT | ✔ reviewed 2026-10-25 (no server-side lock evidence) |
| 7 | Fix branch fast-forwarded into `claude/v0.10.2-release-test` (normal push, no force) | Claude, after gate 5 | ✔ fast-forward completed: 9040ebb |
| 8 | Owner says, in words, "release v0.10.2" | user | ✔ explicitly authorized 2026-10-25 |

## 2. Release steps (Claude, after gate 8) — a normal merge, never a force-push

```bash
git fetch origin
git log --oneline -3 origin/main ; cat VERSION          # main must still be 9bfcb89 (v0.10.1.6) – if it moved, merge the new main into the release branch first and retest
git checkout claude/v0.10.2-release-test && git pull --ff-only
git merge --no-edit origin/main                         # must be "Already up to date" (or a normal merge commit if main moved)
echo 0.10.2 > VERSION                                   # bump from the CURRENT version at that moment
# ONE coordinated AI_HANDOFF.md entry for v0.10.2 (client + DB), then:
python3 wxbuild.py && node --test tests/*.test.js       # + all tests/browser/*.py, incl. WX_BACKEND=pg variants
git commit -am "release: v0.10.2 – Cloud workspace (accounts, My Shows, sync, version history, conflict resolution)"
git checkout main && git pull --ff-only
git merge --no-ff claude/v0.10.2-release-test -m "release: v0.10.2"
git push origin main                                    # normal push; the production app redeploys by itself
git tag v0.10.2 && git push origin v0.10.2              # only if the owner wants a tag
```

Never `--force`, never reset `main`. The Supabase migrations are already applied to the live project; the release does **not** run any SQL.

## 3. Streamlit production deployment

1. After the push to `main`, open https://share.streamlit.io → your app → **Manage app**. The app restarts by itself within about a minute; watch the log until it prints no errors. If it does not pick up the new commit, use **⋮ ▸ Reboot app**.
2. **Secrets: nothing new is required.** `app.py` already injects the public Supabase project URL and the publishable key (`sb_publishable_…`, safe in the browser). Optional overrides `WX_SUPABASE_URL` / `WX_SUPABASE_PUBLISHABLE_KEY`, `MAPBOX_PUBLIC_TOKEN`, `WX_WEATHER_PROCESSOR_URL` stay as they are. Do **not** add a service-role/secret key anywhere.
3. `requirements.txt` is unchanged (`streamlit>=1.35`). No new Python packages.
4. In each browser that uses the app press **Ctrl+F5** once (Streamlit caches the iframe page). Your shows, images and autosaves are in the browser storage of the app address and are not touched by a deployment.
5. **Production smoke test (about 5 minutes, disposable show only):**
   - Cloud chip ▸ dialog bottom line shows `Cloud project: lcujugmyyuumrshdasla.supabase.co · publishable key …`.
   - Sign in → chip *Saved to cloud*; My Shows lists your existing shows unchanged.
   - New show `ZZ PROD SMOKE` + a background image → *Saved to cloud* → **Sync now** twice (*Cloud sync complete!*, then *Already up to date.*).
   - Open it in a second browser profile; image appears.
   - Delete `ZZ PROD SMOKE` (it moves to *Deleted shows*).
6. Version check: the studio header/About shows 0.10.2.

## 4. Rollback (only if the smoke test fails)

Code only; cloud data and browser data are unaffected:

```bash
git checkout main && git pull --ff-only
git revert -m 1 <the v0.10.2 merge commit>      # a new, normal commit
git push origin main                            # Streamlit redeploys the previous behaviour
```

Cloud shows created meanwhile stay in the database (the schema is additive; older builds simply do not show the cloud chip). If something looks wrong for a user, **do not delete anything**: ask for the `.wxshow` backup (File ▸ Save) first.

## 5. After the release

- Update `AI_HANDOFF.md` with the deployed commit and the smoke-test result.
- Known limits carried forward: videos/GIFs stay on the computer (cloud video/GIF is v0.10.3); the browser can clear IndexedDB under storage pressure (the cloud copy and `.wxshow` backups are the durable copies); the weather ingest/worker test dependencies (pytest, fastapi, httpx, pygrib) are for the separate Linux worker, not the Streamlit app.
