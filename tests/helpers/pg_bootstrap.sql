-- Minimal stand-ins for the Supabase-managed pieces (auth, storage, roles, extensions) so the REAL v0.10.2 migrations can run in plain PostgreSQL.
-- Test infrastructure only; it is never applied to Supabase.
create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
do $$ begin
 if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth; create table if not exists auth.users(id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','')::uuid $$;
create schema if not exists storage;
create table if not exists storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema public, extensions, auth, storage to anon, authenticated;
grant select, insert on storage.objects to authenticated; grant select on storage.buckets to authenticated;
grant execute on function auth.uid() to anon, authenticated;
