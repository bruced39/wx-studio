# WX Studio cloud workspace — client/server contract (v0.10.2)

Status: **final**, agreed by the user, ChatGPT (Supabase side) and Claude (client side) on 2026-10-19.
Client: `studio/cloud_workspace.js`. Reference implementation of the server contract for tests: `tests/helpers/fake_supabase.js`.
Database objects, RLS, RPCs and the bucket are implemented by ChatGPT (`supabase/migrations/*`, `tests/supabase/*`). If database
work reveals a needed change, it is coordinated before the client contract changes. No client code depends on the migration filename.

## 0. Conventions

- Every RPC returns `jsonb` `{ ok, status, ... }`. Expected outcomes (conflict, invalid, not found…) are normal results with `ok:false`;
  the client never has to parse database errors. An unexpected exception (HTTP 4xx/5xx from PostgREST) is treated as "sync failed, retry".
- Timestamps are server UTC ISO strings. Hashes are lowercase 64-hex SHA-256.
- Statuses: `created`, `saved`, `unchanged`, `conflict`, `deleted`, `restored`, `invalid`, `not_found`, `forbidden`, `unauthenticated`.
  A user addressing another user's id always gets a generic `not_found`.
- `device_id`: random per browser (`dev_…`, ≤64 chars, kept in `localStorage wx.cloud.device.v1`); `device_name`: ≤60 chars, user-editable, e.g. "Home PC · Chrome".
- Only authenticated users may execute the RPCs. No service-role key is ever in the browser. Direct client INSERT/UPDATE/DELETE on the
  show, version, settings, workspace and media tables is not permitted; SELECT is owner-restricted by RLS.

## 1. Objects

Tables: `public.wx_studio_shows`, `public.wx_studio_show_versions`, `public.wx_studio_user_settings`, `public.wx_studio_workspace`, `public.wx_studio_media`.
Private bucket: `wx-studio-media` (v0.10.2: `image/png`, `image/jpeg`, `image/webp`, 8 MiB per file; v0.10.3 widens it for gif/video/audio).
Object path: `<user_id>/<sha256>.<ext>` (`png` | `jpg` | `webp`).

### SELECT columns the client reads (owner-restricted RLS; the document itself is fetched separately by id)

- Shows: `id, name, rev, scene_count, doc_bytes, schema_version, device_id, device_name, created_at, updated_at, deleted_at`
- Versions: `id, show_id, rev, reason, protected, name, scene_count, doc_bytes, doc_hash, device_id, device_name, restored_from_rev, note, created_at`
- Document of one show: `select doc, rev, name, updated_at from wx_studio_shows where id = eq.<id>`; of one version: `select doc, rev from wx_studio_show_versions where id = eq.<id>`.
- Settings: `select settings, rev, updated_at from wx_studio_user_settings` (one row per user).
- Workspace: `select device_id, device_name, show_id, scene_id, updated_at from wx_studio_workspace` (one row per user and device).
- Media: `select sha256, kind, mime, size_bytes, storage_path from wx_studio_media where sha256 = eq.<hash>`.

## 2. RPCs

### 2.1 `wx_studio_save_show`

```sql
public.wx_studio_save_show(
  p_show_id uuid, p_base_rev integer, p_doc jsonb, p_device_id text, p_device_name text,
  p_reason text, p_schema_version integer, p_op_id uuid, p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
```

- `p_base_rev = 0` creates the show at revision 1 (the id must not exist, otherwise `conflict`). Otherwise `p_base_rev` must equal the current revision.
- `p_reason` ∈ `autosave | close | import | restore | overwrite | keep-both | manual`. `import`, `restore`, `overwrite` create protected versions.
  The server itself creates a protected pre-overwrite copy of the exact document being replaced when reason is `overwrite` (regardless of the 10-minute interval).
- `p_op_id`: a new uuid per logical save. Retrying the exact same logical operation and payload reuses the same id; a later edit gets a new id.
  The **replay check runs before the revision check**: if `p_op_id` equals the show's `last_op_id` and the payload is the same, the earlier success is returned with `replayed:true`.
  Reusing an op id with different content is `invalid` / `op_id_reused`. Replay is only guaranteed while that op is the most recent one; if another device saved afterwards a normal `conflict` is returned.
- `p_base_rev` is checked **before** an identical document is treated as `unchanged` (a stale client cannot bypass conflict detection).
- `p_meta` keys: `restored_from_rev` (int), `note` (≤200 chars). Stored on the version row.
- `p_schema_version` must equal `p_doc.cloud_schema` (1).
- The save, revision bump and any history row are one atomic transaction.
- Versions: the current document updates on every successful save; a historical version row is written when the reason is not `autosave`, or the newest version is ≥10 minutes old.
  Retention: newest 30 historical versions, plus the newest version of each of the previous 14 calendar days, plus all protected versions (never pruned automatically). `(show_id, rev)` is unique.

Success:

```json
{ "ok": true, "status": "created|saved|unchanged", "show_id": "<uuid>", "rev": 7, "updated_at": "<ts>",
  "version_created": true, "replayed": false, "doc_bytes": 48211,
  "media_state": "complete|incomplete", "local_only_image_count": 0 }
```

Conflict (nothing changed):

```json
{ "ok": false, "status": "conflict", "show_id": "<uuid>", "current_rev": 12, "updated_at": "<ts>", "device_id": "...", "device_name": "...",
  "name": "...", "scene_count": 4, "last_op_id": "<uuid>", "current_doc_hash": "<sha256 of the current cloud document>" }
```

Invalid: `{ "ok": false, "status": "invalid", "code": "...", "message": "...", "bytes"?: n, "max_bytes"?: n }` with `code` ∈
`doc_too_large | doc_invalid | embedded_data_not_allowed | media_not_registered | local_only_reason_invalid | reason_invalid | schema_unsupported | show_deleted | base_rev_invalid | op_id_reused`.
Other: `{ "ok": false, "status": "not_found|forbidden|unauthenticated", "message": "..." }`.

### 2.2 Cloud document (`p_doc`)

```
{ "v": 1,                        // the engine's own show version field — preserved untouched
  "cloud_schema": 1,
  "name": "string ≤ 200", "accent": "...", "bugText": "...", "logo": "<assetId>|null",
  "scenes": [ { "id": "string ≤ 64", "duration": number, ...engine fields passed through } ],   // 1..300
  "assets": { "<assetId>": <uploaded image> | <local-only image> },
  "localOnlyMedia": [ { "id": "vid_…", "kind": "video|gif|audio", "name": "...", "bytes": 0, "scenes": ["Scene name"] } ],   // informational
  ...other show flags passed through }
```

Limits: ≤300 scenes, name ≤200 characters, serialized document ≤ 8 MiB (UTF-8 length of the normalized JSONB); `doc_bytes` and `media_refs` are computed by the server.

Image assets (scene, object and logo references keep the same asset ids as in the local show):

```json
{ "media": "sha256:<64-hex>", "mime": "image/png", "bytes": 123456 }
```
```json
{ "local_only": true, "reason": "upload_failed", "mime": "image/png", "bytes": 123456, "source_device_id": "<device id>" }
```

- Exactly one form per asset. `reason` ∈ `too_large | mime_not_allowed | upload_failed | unavailable`.
- Data URLs anywhere in `assets` are rejected (`embedded_data_not_allowed`).
- `{media}` must match a `wx_studio_media` record owned by the caller (`media_not_registered`). Local-only entries are excluded from `media_refs`.
- A local-only marker means the cloud **document** was saved, not that the complete show is available on another computer.
- When an image later uploads, its marker is replaced with the registered reference in a new revision.

Client rules that follow:

1. Images are hashed (SHA-256 of the original bytes, no recompression), uploaded and registered **before** the document that references them is published.
2. A failed upload never corrupts or blocks the show: the document publishes with a local-only marker (`too_large`, `mime_not_allowed` and `upload_failed`/`unavailable` after the failure is known) and the original image stays in local browser storage. A transient network failure instead leaves the sync pending (previous cloud revision untouched).
3. A valid cloud `{media}` reference is **never** replaced by a local-only marker just because this computer has not downloaded the image. Unresolved references are carried forward unchanged while any scene still references the asset.
4. Opening a partially synchronized show keeps the placeholder and reports which media is unavailable.

### 2.3 `wx_studio_delete_show` / `wx_studio_undelete_show`

```sql
public.wx_studio_delete_show(p_show_id uuid, p_base_rev integer, p_device_id text) RETURNS jsonb
public.wx_studio_undelete_show(p_show_id uuid, p_base_rev integer) RETURNS jsonb
```

Soft delete only; both advance the revision, enforce ownership and preserve content and history. No automatic permanent deletion, no media deletion.

```json
{ "ok": true, "status": "deleted|restored", "show_id": "<uuid>", "rev": 13, "updated_at": "<ts>" }
```
Conflict: `{ "ok": false, "status": "conflict", "current_rev": n, "updated_at": "...", "device_name": "..." }`; or `not_found | forbidden | unauthenticated | invalid`.

### 2.4 `wx_studio_save_settings`

```sql
public.wx_studio_save_settings(p_patch jsonb, p_device_id text) RETURNS jsonb
```

`p_patch` is a flat object `{ "<key>": <json value>, "<other>": null }`; `null` removes the key. Merge is atomic under a row lock, per-key last write wins.
Allowed keys: `wx.mapbox.token` (must match `^pk\.[A-Za-z0-9._-]+$`; `sk.` and anything else rejected), `wx.mapbox.scale`, `wx.mapbox.nativeScale.v1`,
`wx.studio.defaultMap.v1`, `wx_bg_default`, `wx_fxpresets`, `wx_snap`, `wx_ov_opt`, `wx.export.v1`. Limits: 64 KB per value; the complete settings document ≤ 256 KiB
(exceeding it rejects the whole transaction, nothing applied). Cloud map presets (`wx_studio_map_presets`) are NOT duplicated here.

```json
{ "ok": true, "status": "saved", "rev": 4, "updated_at": "<ts>", "applied": ["wx_snap"], "ignored": [ { "key": "x", "code": "key_not_allowed|secret_token_rejected|value_too_large|invalid_value" } ] }
```
Whole-document overflow: `{ "ok": false, "status": "invalid", "code": "settings_too_large" }`.

### 2.5 `wx_studio_set_workspace`

```sql
public.wx_studio_set_workspace(p_device_id text, p_device_name text, p_show_id uuid, p_scene_id text) RETURNS jsonb
```

Primary key `(user_id, device_id)`. Validates authentication, a valid device id, ownership of the non-deleted show, and `p_scene_id` null or text ≤64 chars (the scene need not exist in the last synchronized document; the client falls back to scene 1).
Returns `{ "ok": true, "status": "saved", "updated_at": "<ts>" }`.

### 2.6 `wx_studio_register_media`

```sql
public.wx_studio_register_media(p_sha256 text, p_kind text, p_mime text, p_size_bytes bigint, p_name text, p_width integer, p_height integer) RETURNS jsonb
```

Validates authentication, MIME (v0.10.2: png/jpeg/webp), kind (`image` active; `video|gif|audio` reserved for v0.10.3), hash format, size (≤ 8 MiB in v0.10.2) and the canonical path `<user_id>/<sha256>.<ext>`;
verifies the object exists in the caller's private folder and that its metadata matches; idempotent for an identical existing record; rejects an existing hash whose MIME, kind or size conflicts.
Storage metadata does not prove the bytes match the hash — **the browser verifies the original bytes before upload and the downloaded bytes before use**.

```json
{ "ok": true, "status": "registered|exists", "sha256": "...", "storage_path": "<uid>/<sha>.png" }
```
Failures: `{ "ok": false, "status": "invalid", "code": "mime_not_allowed|kind_not_allowed|too_large|bad_hash|object_missing|metadata_mismatch|conflicts_with_existing" }`.

## 3. Storage (not RPC) errors the client recognises

| Storage response | Client reason |
|---|---|
| HTTP 413 / `EntityTooLarge` | `too_large` |
| quota message (e.g. `exceed_storage_size_quota`, "quota", "exceeded the maximum") | `storage_full` (reported as an upload failure with that detail; never assumed for every quota error) |
| HTTP 409 / "already exists" for a content-addressed path | verify the existing object and register; never overwrite |
| network failure | retryable offline status (sync stays pending) |
| 401 / 403 auth | re-authenticate, retry once |
| anything else | `upload_failed`, original status/message kept for diagnostics |

No media is ever deleted automatically.

## 4. Client behaviour guaranteed by this contract

- Local autosave works regardless of Supabase. A failed sync never changes or replaces the local show.
- Debounce 3 s after the last change; one save in flight; retry backoff 5 s → 5 min. Pending op ids and payload identity survive reloads.
- A lost-response retry is recognised only when the conflict's `last_op_id` is one of this device's own pending/recent op ids **and** the current cloud document equals the document that was sent (verified by fetching it); otherwise it is a real conflict. Another device's save is never mistaken for ours.
- Conflict dialog: keep this computer's copy (explicit confirmation, saved with `overwrite` on the latest revision), open the cloud copy, or save separately (`keep-both`, new show id, base revision 0).
- A newer cloud revision produces a notification; the open show is never silently replaced.
- Sign-in: check unclaimed legacy browser data first (explicit Upload / Keep separate / Not now decision); prefer this device's saved workspace; for another device's workspace offer **Resume** unless the browser has no real local work, in which case the most recently updated cloud show opens automatically.
- Opening a `.wxshow`/`.wxshow.json` file or choosing New creates a new cloud identity; cloud ids and revisions never appear in portable files.
- Status is exactly one of: **Saved locally**, **Syncing**, **Saved to cloud**, **Sync failed**, or "Cloud document saved — N media only on <device>" (incomplete). Complete means the document is saved and every referenced image is uploaded and no video/GIF/audio is local-only.
- Cached data is tagged by account; one account cannot see another account's cached shows, images, videos, settings or recent autosaves. Signing out keeps the local show (default) or, on request, clears that account's local data (shared computers).
- Portable `.wxshow` / `.wxshow.json` Save and Open are unchanged.
