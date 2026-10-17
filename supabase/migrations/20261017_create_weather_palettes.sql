-- Applied to existing WX Studio Supabase project on 2026-10-17.
-- Private user-owned palette records and LUT files; no public writes/reads.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('wx-studio-weather-palettes','wx-studio-weather-palettes',false,2097152,
 array['application/json','image/png']::text[])
on conflict(id) do nothing;

create table if not exists public.wx_studio_weather_palettes(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 category text not null check(category in('radar','satellite','rtma','models','custom')),
 product_id text not null,
 name text not null,
 stops jsonb not null check(jsonb_typeof(stops)='array'),
 units text not null default '',
 description text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists wx_weather_palettes_owner_category
 on public.wx_studio_weather_palettes(user_id,category,product_id);
alter table public.wx_studio_weather_palettes enable row level security;

create policy "weather palettes select own" on public.wx_studio_weather_palettes
 for select to authenticated using(auth.uid()=user_id);
create policy "weather palettes insert own" on public.wx_studio_weather_palettes
 for insert to authenticated with check(auth.uid()=user_id);
create policy "weather palettes update own" on public.wx_studio_weather_palettes
 for update to authenticated using(auth.uid()=user_id) with check(auth.uid()=user_id);
create policy "weather palettes delete own" on public.wx_studio_weather_palettes
 for delete to authenticated using(auth.uid()=user_id);

-- Each path begins with the authenticated Supabase user UUID:
-- user-uuid/radar/...; user-uuid/satellite/...; user-uuid/rtma/...;
-- user-uuid/models/...; user-uuid/custom/...
create policy "weather LUT select own" on storage.objects
 for select to authenticated using(bucket_id='wx-studio-weather-palettes'
   and (storage.foldername(name))[1]=auth.uid()::text);
create policy "weather LUT insert own" on storage.objects
 for insert to authenticated with check(bucket_id='wx-studio-weather-palettes'
   and (storage.foldername(name))[1]=auth.uid()::text);
create policy "weather LUT update own" on storage.objects
 for update to authenticated using(bucket_id='wx-studio-weather-palettes'
   and (storage.foldername(name))[1]=auth.uid()::text)
 with check(bucket_id='wx-studio-weather-palettes'
   and (storage.foldername(name))[1]=auth.uid()::text);
create policy "weather LUT delete own" on storage.objects
 for delete to authenticated using(bucket_id='wx-studio-weather-palettes'
   and (storage.foldername(name))[1]=auth.uid()::text);
