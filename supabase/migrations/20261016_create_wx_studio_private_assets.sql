-- 2026-10-16: WX Studio private PNG cloud assets.
-- Applied to dedicated Supabase project lcujugmyyuumrshdasla.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('wx-studio-banners','wx-studio-banners',false,8388608,array['image/png']::text[])
on conflict (id) do update set public=false,file_size_limit=8388608,allowed_mime_types=array['image/png']::text[];
create table if not exists public.wx_studio_assets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check (kind in ('banner','graphic','background')),
 name text not null check (char_length(btrim(name)) between 1 and 100),
 storage_path text not null unique,
 width integer not null check (width between 1 and 20000),
 height integer not null check (height between 1 and 20000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint wx_studio_assets_owner_kind_name unique (user_id,kind,name),
 constraint wx_studio_assets_safe_path check (
  storage_path ~ ('^'||user_id::text||'/'||kind||'/[0-9a-fA-F-]{36}\.png$')
 )
);
create index if not exists wx_studio_assets_owner_updated
 on public.wx_studio_assets (user_id,kind,updated_at desc);
alter table public.wx_studio_assets enable row level security;
alter table public.wx_studio_assets force row level security;
revoke all on public.wx_studio_assets from anon;
grant select,insert,update,delete on public.wx_studio_assets to authenticated;
create policy wx_assets_select_own on public.wx_studio_assets for select
 to authenticated using ((select auth.uid())=user_id);
create policy wx_assets_insert_own on public.wx_studio_assets for insert
 to authenticated with check ((select auth.uid())=user_id);
create policy wx_assets_update_own on public.wx_studio_assets for update
 to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy wx_assets_delete_own on public.wx_studio_assets for delete
 to authenticated using ((select auth.uid())=user_id);

-- Storage paths: <user_id>/<banner|graphic|background>/<uuid>.png.
-- Read, insert, update, delete are separately authorized by auth.uid().
create policy wx_storage_select_own on storage.objects for select to authenticated using (
 bucket_id='wx-studio-banners' and split_part(name,'/',1)=(select auth.uid())::text
 and split_part(name,'/',2) in ('banner','graphic','background')
 and split_part(name,'/',3) ~* '^[0-9a-f-]{36}\.png$' and name not like '%/%/%/%');
create policy wx_storage_insert_own on storage.objects for insert to authenticated with check (
 bucket_id='wx-studio-banners' and split_part(name,'/',1)=(select auth.uid())::text
 and split_part(name,'/',2) in ('banner','graphic','background')
 and split_part(name,'/',3) ~* '^[0-9a-f-]{36}\.png$' and name not like '%/%/%/%');
create policy wx_storage_update_own on storage.objects for update to authenticated using (
 bucket_id='wx-studio-banners' and split_part(name,'/',1)=(select auth.uid())::text
 and split_part(name,'/',2) in ('banner','graphic','background')
 and split_part(name,'/',3) ~* '^[0-9a-f-]{36}\.png$' and name not like '%/%/%/%')
with check (
 bucket_id='wx-studio-banners' and split_part(name,'/',1)=(select auth.uid())::text
 and split_part(name,'/',2) in ('banner','graphic','background')
 and split_part(name,'/',3) ~* '^[0-9a-f-]{36}\.png$' and name not like '%/%/%/%');
create policy wx_storage_delete_own on storage.objects for delete to authenticated using (
 bucket_id='wx-studio-banners' and split_part(name,'/',1)=(select auth.uid())::text
 and split_part(name,'/',2) in ('banner','graphic','background')
 and split_part(name,'/',3) ~* '^[0-9a-f-]{36}\.png$' and name not like '%/%/%/%');
