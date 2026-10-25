# WX Studio v0.10.2 database handoff (ChatGPT-owned)

Deployment: **existing isolated WX Studio Supabase project** `lcujugmyyuumrshdasla`, Free tier. Migrations applied and committed on branch `feature/cloud-workspace-db-v0-10-2`; **the studio client is NOT integrated or released**. Preserve main v0.10.1 until Claude's client passes integration checks. No VERSION or AI_HANDOFF.md change until the complete release.

## Tables (read SELECT as authenticated, RLS owner only)

- `wx_studio_shows`: `id,user_id,name,doc,schema_version,rev,device_id,device_name,scene_count,doc_bytes,media_refs,doc_hash,last_op_id,last_op_payload_hash,last_op_result,created_at,updated_at,deleted_at`.
- `wx_studio_show_versions`: `id,user_id,show_id,rev,doc,reason,protected,name,scene_count,doc_bytes,media_refs,doc_hash,device_id,device_name,restored_from_rev,note,created_at`.
- `wx_studio_user_settings`: `user_id,settings,rev,device_id,updated_at`.
- `wx_studio_workspace`: `user_id,device_id,device_name,active_show_id,active_scene_id,updated_at` (primary key user_id+device_id).
- `wx_studio_media`: `id,user_id,sha256,kind,mime,size_bytes,width,height,name,storage_path,created_at`.

All show/version documents are read through ordinary owner-restricted SELECT. Direct client INSERT/UPDATE/DELETE to application tables is **not granted**; only the six RPCs can write. The workspace RPC permits a scene ID before the associated show revision has synced.

## RPCs (all return JSONB, authenticated only)

- `wx_studio_save_show(p_show_id uuid,p_base_rev integer,p_doc jsonb,p_device_id text,p_device_name text,p_reason text,p_schema_version integer,p_op_id uuid,p_meta jsonb default '{}')`.
- `wx_studio_delete_show(p_show_id uuid,p_base_rev integer,p_device_id text)`.
- `wx_studio_undelete_show(p_show_id uuid,p_base_rev integer)`.
- `wx_studio_save_settings(p_patch jsonb,p_device_id text)`.
- `wx_studio_set_workspace(p_device_id text,p_device_name text,p_show_id uuid,p_scene_id text)`.
- `wx_studio_register_media(p_sha256 text,p_kind text,p_mime text,p_size_bytes bigint,p_name text,p_width integer,p_height integer)`.

Save success: `ok,status,show_id,rev,updated_at,version_created,replayed,doc_bytes,doc_hash,media_state,local_only_image_count`. Conflict: `ok:false,status:'conflict',show_id,current_rev,updated_at,device_id,device_name,name,scene_count,last_op_id,current_doc_hash`. Error: `ok:false,status:'invalid',code` with optional details; ownership failures return `not_found`. Delete and undelete success include `rev,updated_at`; delete also includes `deleted_at`.

Save uses PostgreSQL's normalized `jsonb::text` UTF-8 serialization for `doc_bytes` and `doc_hash`. **JavaScript JSON.stringify SHA-256 is not guaranteed to match the server's `doc_hash` due to differing key order/serialization.** Client must not treat a raw JS hash as identical without verified canonicalization; for ambiguous lost responses, load the current cloud document and compare structurally before adopting it. `p_op_id` can be replayed only if it remains the show's `last_op_id` with an identical request payload.

Allowed uploaded assets: `{media:'sha256:<lowercase-64-hex>',mime:'image/png'|'image/jpeg'|'image/webp',bytes:<registered integer>}`. The media must be registered to the same account. Local-only assets: `{local_only:true,reason:'too_large'|'mime_not_allowed'|'upload_failed'|'unavailable',mime:<string>,bytes:<nonnegative integer>,source_device_id:<string>}`; no embedded data URLs. Partial saves report incomplete status. Client must never downgrade a valid cloud media reference just because another device has not yet downloaded the file.

Bucket: private `wx-studio-media`, 8 MiB per object; **only image/png, image/jpeg, image/webp** in v0.10.2. Canonical paths `<uid>/<sha256>.png|jpg|webp`; SELECT/INSERT owner-only. UPDATE/DELETE not enabled. Direct media registration checks that an object metadata record with matching canonical name, size and MIME exists. This is NOT cryptographic server-side inspection of object bytes: client must compute SHA before upload and verify after download. Storage HTTP 413 / plan quota errors happen before the registration RPC and must be handled in the client.

History: first show revision always snapshotted, autosaves snapshotted at most once each 10 minutes, non-autosaves snapshotted each changed revision. Retention holds 30 latest plus daily snapshots for 14 days, preserving all protected import, restore and pre-overwrite rows. Delete/undelete advance revision and invalidate the prior save replay token. No automatic hard-deletion of shows or media.

Security: six intentional `SECURITY DEFINER` RPCs are exposed **only to authenticated**, with fixed search_path and explicit auth.uid() ownership checks. Supabase Security Advisor currently flags their existence (lint 0029) because they are callable by authenticated users. This is deliberate to deny direct table writes and enforce revision locking inside RPCs; review functions carefully after future edits. The existing pre-v0.10.2 Auth leaked-password-protection warning is not modified.

## Verification

- Live Supabase transactional script: `tests/supabase/cloud_workspace_rollback.sql` (two synthetic users, RPC replays and conflicts, media, local-only validation, settings, workspace, history retention, protected copies, delete/undelete, cross-user isolation). All fixture data is rolled back.
- `tests/supabase/cloud_workspace_limits_rollback.sql` (8 MiB document cap and Storage RLS cross-account privacy), transaction rolled back.
- No real storage upload, live browser, two-computer test or Claude client integration performed yet.
