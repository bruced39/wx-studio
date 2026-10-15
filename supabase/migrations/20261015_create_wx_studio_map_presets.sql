-- Applied to the connected WXfusion Supabase project on 2026-10-15.
-- Creates a separate, RLS-protected storage table for WX Studio map presets.
-- Does not modify any existing forecast tables.
create table if not exists public.wx_studio_map_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  settings jsonb not null default '{}'::jsonb,
  camera jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wx_studio_map_presets_user_name_unique unique (user_id, name)
);
create index if not exists wx_studio_map_presets_user_updated_idx
  on public.wx_studio_map_presets (user_id, updated_at desc);

alter table public.wx_studio_map_presets enable row level security;
alter table public.wx_studio_map_presets force row level security;
revoke all on table public.wx_studio_map_presets from anon;
grant select, insert, update, delete on table public.wx_studio_map_presets to authenticated;

drop policy if exists wx_studio_map_presets_select_own on public.wx_studio_map_presets;
create policy wx_studio_map_presets_select_own on public.wx_studio_map_presets
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists wx_studio_map_presets_insert_own on public.wx_studio_map_presets;
create policy wx_studio_map_presets_insert_own on public.wx_studio_map_presets
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists wx_studio_map_presets_update_own on public.wx_studio_map_presets;
create policy wx_studio_map_presets_update_own on public.wx_studio_map_presets
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists wx_studio_map_presets_delete_own on public.wx_studio_map_presets;
create policy wx_studio_map_presets_delete_own on public.wx_studio_map_presets
  for delete to authenticated using ((select auth.uid()) = user_id);
