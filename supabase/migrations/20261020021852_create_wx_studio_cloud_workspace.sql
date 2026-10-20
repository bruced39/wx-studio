-- WX Studio v0.10.2 Cloud Workspace — additive schema, independently owned.
-- Existing WX Studio tables/buckets are unchanged. No billable resources created.
-- All exposed writes go through explicitly authenticated, ownership-checking RPCs.
-- Read-only table access via RLS. No direct table writes for authenticated/anon.
CREATE TABLE public.wx_studio_shows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 doc jsonb NOT NULL CHECK (jsonb_typeof(doc)='object'),
 schema_version integer NOT NULL CHECK (schema_version=1),
 rev integer NOT NULL CHECK (rev>0),
 device_id text NOT NULL CHECK (length(device_id) BETWEEN 1 AND 128),
 device_name text NOT NULL CHECK (length(device_name) BETWEEN 1 AND 120),
 scene_count integer NOT NULL CHECK (scene_count BETWEEN 1 AND 300),
 doc_bytes integer NOT NULL CHECK (doc_bytes BETWEEN 1 AND 8388608),
 media_refs text[] NOT NULL DEFAULT '{}',
 doc_hash text NOT NULL CHECK (doc_hash ~ '^[0-9a-f]{64}$'),
 last_op_id uuid NOT NULL,
 last_op_payload_hash text NOT NULL CHECK (last_op_payload_hash ~ '^[0-9a-f]{64}$'),
 last_op_result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 UNIQUE (id,user_id)
);
CREATE INDEX wx_studio_shows_owner_recent ON public.wx_studio_shows (user_id,updated_at DESC) WHERE deleted_at IS NULL;
CREATE TABLE public.wx_studio_show_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 show_id uuid NOT NULL,
 rev integer NOT NULL CHECK (rev>0),
 doc jsonb NOT NULL,
 reason text NOT NULL CHECK (reason IN ('autosave','close','import','restore','overwrite','keep-both','manual','pre-overwrite','delete','undelete')),
 protected boolean NOT NULL DEFAULT false,
 name text NOT NULL,
 scene_count integer NOT NULL,
 doc_bytes integer NOT NULL,
 media_refs text[] NOT NULL DEFAULT '{}',
 doc_hash text NOT NULL,
 device_id text NOT NULL,
 device_name text NOT NULL,
 restored_from_rev integer,
 note text CHECK (note IS NULL OR length(note)<=200),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (show_id,rev),
 FOREIGN KEY (show_id,user_id) REFERENCES public.wx_studio_shows(id,user_id)
);
CREATE INDEX wx_studio_versions_owner_show_recent ON public.wx_studio_show_versions (user_id,show_id,rev DESC);
CREATE TABLE public.wx_studio_user_settings (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id),
 settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings)='object' AND octet_length(settings::text)<=262144),
 rev integer NOT NULL DEFAULT 1 CHECK (rev>0),
 device_id text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.wx_studio_workspace (
 user_id uuid NOT NULL REFERENCES auth.users(id),
 device_id text NOT NULL CHECK (length(device_id) BETWEEN 1 AND 128),
 device_name text NOT NULL CHECK (length(device_name) BETWEEN 1 AND 120),
 active_show_id uuid,
 active_scene_id text CHECK (active_scene_id IS NULL OR length(active_scene_id)<=64),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id,device_id),
 FOREIGN KEY (active_show_id,user_id) REFERENCES public.wx_studio_shows(id,user_id)
);
CREATE INDEX wx_studio_workspace_owner_recent ON public.wx_studio_workspace(user_id,updated_at DESC);
CREATE TABLE public.wx_studio_media (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
 kind text NOT NULL CHECK(kind IN ('image','video','gif','audio')),
 mime text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes>0),
 width integer CHECK(width IS NULL OR width BETWEEN 1 AND 20000),
 height integer CHECK(height IS NULL OR height BETWEEN 1 AND 20000),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
 storage_path text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,sha256)
);
CREATE INDEX wx_studio_media_owner_recent ON public.wx_studio_media(user_id,created_at DESC);

-- Initial image-only activation. Widen only at the authorized v0.10.3 stage.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('wx-studio-media','wx-studio-media',false,8388608,
 ARRAY['image/png','image/jpeg','image/webp']::text[]);

ALTER TABLE public.wx_studio_shows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wx_studio_show_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wx_studio_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wx_studio_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wx_studio_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY wx_studio_shows_read ON public.wx_studio_shows FOR SELECT TO authenticated
 USING (user_id = (SELECT auth.uid()));
CREATE POLICY wx_studio_versions_read ON public.wx_studio_show_versions FOR SELECT TO authenticated
 USING (user_id = (SELECT auth.uid()));
CREATE POLICY wx_studio_settings_read ON public.wx_studio_user_settings FOR SELECT TO authenticated
 USING (user_id = (SELECT auth.uid()));
CREATE POLICY wx_studio_workspace_read ON public.wx_studio_workspace FOR SELECT TO authenticated
 USING (user_id = (SELECT auth.uid()));
CREATE POLICY wx_studio_media_read ON public.wx_studio_media FOR SELECT TO authenticated
 USING (user_id = (SELECT auth.uid()));
-- Authenticated can only SELECT. RPCs are the sole write interface.
REVOKE ALL ON public.wx_studio_shows,public.wx_studio_show_versions,public.wx_studio_user_settings,
 public.wx_studio_workspace,public.wx_studio_media FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.wx_studio_shows,public.wx_studio_show_versions,public.wx_studio_user_settings,
 public.wx_studio_workspace,public.wx_studio_media TO authenticated;
-- Limit Storage objects to same-user canonical SHA filename, with no UPDATE or DELETE.
CREATE POLICY wx_studio_media_object_read ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='wx-studio-media'
  AND name ~ ('^' || (SELECT auth.uid())::text || '/[0-9a-f]{64}\.(png|jpg|webp)$'));
CREATE POLICY wx_studio_media_object_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id='wx-studio-media'
  AND name ~ ('^' || (SELECT auth.uid())::text || '/[0-9a-f]{64}\.(png|jpg|webp)$'));

CREATE OR REPLACE FUNCTION public.wx_studio_register_media(
 p_sha256 text,p_kind text,p_mime text,p_size_bytes bigint,p_name text,p_width integer,p_height integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
 u uuid := auth.uid(); ext text; path text; obj record; existing record; result jsonb;
BEGIN
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'status','unauthenticated'); END IF;
 IF p_kind IS DISTINCT FROM 'image' OR p_mime IS NULL OR p_mime NOT IN ('image/png','image/jpeg','image/webp') THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','mime_not_allowed'); END IF;
 IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' OR p_size_bytes IS NULL
    OR p_size_bytes<1 OR p_size_bytes>8388608 OR p_name IS NULL
    OR length(btrim(p_name)) NOT BETWEEN 1 AND 120
    OR (p_width IS NOT NULL AND p_width NOT BETWEEN 1 AND 20000)
    OR (p_height IS NOT NULL AND p_height NOT BETWEEN 1 AND 20000) THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','media_invalid'); END IF;
 ext:=CASE p_mime WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg' ELSE 'webp' END;
 path:=u::text || '/' || p_sha256 || '.' || ext;
 SELECT id,storage_path,mime,size_bytes,kind INTO existing FROM public.wx_studio_media
 WHERE user_id=u AND sha256=p_sha256;
 IF FOUND THEN
  IF existing.storage_path<>path OR existing.mime<>p_mime OR existing.size_bytes<>p_size_bytes OR existing.kind<>'image' THEN
   RETURN jsonb_build_object('ok',false,'status','invalid','code','media_conflict'); END IF;
  RETURN jsonb_build_object('ok',true,'status','exists','storage_path',path);
 END IF;
 SELECT metadata,name INTO obj FROM storage.objects WHERE bucket_id='wx-studio-media' AND name=path;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'status','invalid','code','object_missing'); END IF;
 IF (obj.metadata->>'size') IS NULL OR (obj.metadata->>'size') !~ '^[0-9]+$'
    OR (obj.metadata->>'size')::bigint<>p_size_bytes
    OR coalesce(obj.metadata->>'mimetype','')<>p_mime THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','object_mismatch'); END IF;
 INSERT INTO public.wx_studio_media(user_id,sha256,kind,mime,size_bytes,name,width,height,storage_path)
 VALUES(u,p_sha256,'image',p_mime,p_size_bytes,p_name,p_width,p_height,path)
 ON CONFLICT(user_id,sha256) DO NOTHING;
 SELECT kind,mime,size_bytes,storage_path INTO existing FROM public.wx_studio_media WHERE user_id=u AND sha256=p_sha256;
 IF existing.kind<>'image' OR existing.mime<>p_mime OR existing.size_bytes<>p_size_bytes OR existing.storage_path<>path THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','media_conflict'); END IF;
 RETURN jsonb_build_object('ok',true,'status','registered','storage_path',path);
END $fn$;

CREATE OR REPLACE FUNCTION public.wx_studio_save_show(
 p_show_id uuid,p_base_rev integer,p_doc jsonb,p_device_id text,p_device_name text,
 p_reason text,p_schema_version integer,p_op_id uuid,p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
 u uuid:=auth.uid(); sh public.wx_studio_shows%ROWTYPE; a record; s jsonb;
 bytes integer; hash text; op_hash text; refs text[]:='{}'; local_count integer:=0;
 title text; nsc integer; nowtime timestamptz:=clock_timestamp(); newrev integer;
 result jsonb; newest timestamptz; old_hash text; m record; restore_from integer; note_txt text;
BEGIN
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'status','unauthenticated'); END IF;
 IF p_show_id IS NULL OR p_op_id IS NULL OR p_base_rev IS NULL OR p_base_rev<0 OR
    p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 1 AND 128 OR
    p_device_name IS NULL OR length(p_device_name) NOT BETWEEN 1 AND 120 THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','base_rev_invalid'); END IF;
 IF p_reason IS NULL OR p_reason NOT IN ('autosave','close','import','restore','overwrite','keep-both','manual') THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','reason_invalid'); END IF;
 IF p_schema_version IS DISTINCT FROM 1 OR p_doc IS NULL OR jsonb_typeof(p_doc)<>'object'
    OR p_doc->'cloud_schema' IS DISTINCT FROM to_jsonb(p_schema_version) THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','schema_unsupported'); END IF;
 IF jsonb_typeof(p_doc->'scenes') IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_doc->'scenes') NOT BETWEEN 1 AND 300 OR
    jsonb_typeof(p_doc->'name') IS DISTINCT FROM 'string' OR
    length(btrim(p_doc->>'name')) NOT BETWEEN 1 AND 200 OR
    (p_doc ? 'assets' AND jsonb_typeof(p_doc->'assets')<>'object') OR
    (p_doc ? 'localOnlyMedia' AND jsonb_typeof(p_doc->'localOnlyMedia')<>'array') THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','doc_invalid'); END IF;
 IF p_doc ? 'v' AND p_doc->'v' IS DISTINCT FROM '1'::jsonb THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','schema_unsupported'); END IF;
 bytes:=octet_length(convert_to(p_doc::text,'UTF8'));
 IF bytes>8388608 THEN RETURN jsonb_build_object('ok',false,'status','invalid','code','doc_too_large',
 'bytes',bytes,'max_bytes',8388608); END IF;
 nsc:=jsonb_array_length(p_doc->'scenes'); title:=btrim(p_doc->>'name');
 FOR s IN SELECT value FROM jsonb_array_elements(p_doc->'scenes') LOOP
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR
     jsonb_typeof(s->'id') IS DISTINCT FROM 'string' OR
     length(s->>'id') NOT BETWEEN 1 AND 64 OR
     jsonb_typeof(s->'duration') IS DISTINCT FROM 'number' THEN
   RETURN jsonb_build_object('ok',false,'status','invalid','code','doc_invalid'); END IF;
 END LOOP;
 IF p_meta IS NULL OR jsonb_typeof(p_meta)<>'object' OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_meta) k WHERE k NOT IN ('note','restored_from_rev')) OR
    (p_meta ? 'note' AND jsonb_typeof(p_meta->'note') NOT IN ('string','null')) OR
    length(coalesce(p_meta->>'note',''))>200 OR
    (p_meta ? 'restored_from_rev' AND jsonb_typeof(p_meta->'restored_from_rev') NOT IN ('number','null')) THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','meta_invalid'); END IF;
 IF p_meta->>'restored_from_rev' IS NOT NULL THEN
  BEGIN restore_from:=(p_meta->>'restored_from_rev')::integer;
   IF restore_from<1 THEN RETURN jsonb_build_object('ok',false,'status','invalid','code','meta_invalid'); END IF;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
   RETURN jsonb_build_object('ok',false,'status','invalid','code','meta_invalid'); END;
 END IF;
 note_txt:=p_meta->>'note';
 FOR a IN SELECT key,value FROM jsonb_each(coalesce(p_doc->'assets','{}'::jsonb)) LOOP
  IF jsonb_typeof(a.value)<>'object' OR length(a.key)>160 THEN
   RETURN jsonb_build_object('ok',false,'status','invalid','code','doc_invalid'); END IF;
  IF a.value ? 'data' OR a.value ? 'embedded' OR (a.value::text LIKE '%data:%') THEN
   RETURN jsonb_build_object('ok',false,'status','invalid','code','embedded_data_not_allowed'); END IF;
  IF a.value ? 'media' THEN
   IF a.value ? 'local_only' OR jsonb_typeof(a.value->'media')<>'string' OR
      (a.value->>'media') !~ '^sha256:[0-9a-f]{64}$' OR
      jsonb_typeof(a.value->'mime')<>'string' OR
      jsonb_typeof(a.value->'bytes')<>'number' THEN
    RETURN jsonb_build_object('ok',false,'status','invalid','code','doc_invalid'); END IF;
   IF NOT EXISTS (
     SELECT 1 FROM public.wx_studio_media mm WHERE mm.user_id=u AND mm.kind='image'
      AND mm.sha256=substring(a.value->>'media' FROM 8)
      AND mm.mime=a.value->>'mime'
      AND mm.size_bytes::text=a.value->>'bytes'
   ) THEN RETURN jsonb_build_object('ok',false,'status','invalid','code','media_not_registered'); END IF;
   refs:=array_append(refs,substring(a.value->>'media' FROM 8));
  ELSIF a.value->'local_only' = 'true'::jsonb THEN
   IF a.value ? 'media' OR a.value->>'reason' NOT IN
       ('too_large','mime_not_allowed','upload_failed','unavailable')
      OR jsonb_typeof(a.value->'bytes')<>'number' OR
      jsonb_typeof(a.value->'mime')<>'string' OR
      jsonb_typeof(a.value->'source_device_id')<>'string' THEN
     RETURN jsonb_build_object('ok',false,'status','invalid','code','doc_invalid'); END IF;
   local_count:=local_count+1;
  ELSE RETURN jsonb_build_object('ok',false,'status','invalid','code','doc_invalid');
  END IF;
 END LOOP;
 SELECT coalesce(array_agg(DISTINCT x),'{}'::text[]) INTO refs FROM unnest(refs) x;
 hash:=encode(extensions.digest(convert_to(p_doc::text,'UTF8'),'sha256'),'hex');
 op_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
   'show_id',p_show_id,'base_rev',p_base_rev,'doc',p_doc,'device_id',p_device_id,
   'device_name',p_device_name,'reason',p_reason,'schema_version',p_schema_version,'meta',p_meta)::text,'UTF8'),'sha256'),'hex');
 SELECT * INTO sh FROM public.wx_studio_shows WHERE id=p_show_id FOR UPDATE;
 IF FOUND THEN
  IF sh.user_id<>u THEN RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;
  IF sh.last_op_id=p_op_id THEN
   IF sh.last_op_payload_hash<>op_hash THEN
    RETURN jsonb_build_object('ok',false,'status','invalid','code','op_id_reused'); END IF;
   RETURN sh.last_op_result || jsonb_build_object('replayed',true);
  END IF;
  IF sh.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'status','invalid','code','show_deleted'); END IF;
  IF sh.rev<>p_base_rev THEN
   RETURN jsonb_build_object('ok',false,'status','conflict','show_id',p_show_id,
    'current_rev',sh.rev,'updated_at',sh.updated_at,'device_id',sh.device_id,
    'device_name',sh.device_name,'name',sh.name,'scene_count',sh.scene_count,
    'last_op_id',sh.last_op_id,'current_doc_hash',sh.doc_hash); END IF;
  IF sh.doc_hash=hash AND sh.doc=p_doc THEN
   result:=jsonb_build_object('ok',true,'status','unchanged','show_id',p_show_id,
    'rev',sh.rev,'updated_at',sh.updated_at,'version_created',false,
    'replayed',false,'doc_bytes',sh.doc_bytes,'doc_hash',sh.doc_hash,
    'media_state',CASE WHEN local_count=0 THEN 'complete' ELSE 'incomplete' END,
    'local_only_image_count',local_count);
   UPDATE public.wx_studio_shows SET last_op_id=p_op_id,last_op_payload_hash=op_hash,
     last_op_result=result WHERE id=p_show_id;
   RETURN result;
  END IF;
  IF p_reason='overwrite' THEN
   -- Preserve the exact revision being replaced, even if autosave had not snapshotted it.
   INSERT INTO public.wx_studio_show_versions(
    user_id,show_id,rev,doc,reason,protected,name,scene_count,doc_bytes,media_refs,doc_hash,
    device_id,device_name,created_at)
   VALUES(u,p_show_id,sh.rev,sh.doc,'pre-overwrite',true,sh.name,sh.scene_count,
    sh.doc_bytes,sh.media_refs,sh.doc_hash,sh.device_id,sh.device_name,nowtime)
   ON CONFLICT(show_id,rev) DO UPDATE SET protected=true,reason='pre-overwrite',
    doc=EXCLUDED.doc,doc_hash=EXCLUDED.doc_hash,media_refs=EXCLUDED.media_refs,
    doc_bytes=EXCLUDED.doc_bytes;
  END IF;
  newrev:=sh.rev+1;
  UPDATE public.wx_studio_shows SET name=title,doc=p_doc,schema_version=p_schema_version,
    rev=newrev,device_id=p_device_id,device_name=p_device_name,scene_count=nsc,
    doc_bytes=bytes,media_refs=refs,doc_hash=hash,updated_at=nowtime WHERE id=p_show_id;
 ELSE
  IF p_base_rev<>0 THEN RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;
  newrev:=1;
  INSERT INTO public.wx_studio_shows(
    id,user_id,name,doc,schema_version,rev,device_id,device_name,scene_count,
    doc_bytes,media_refs,doc_hash,last_op_id,last_op_payload_hash,last_op_result,updated_at)
  VALUES(p_show_id,u,title,p_doc,p_schema_version,1,p_device_id,p_device_name,nsc,
    bytes,refs,hash,p_op_id,op_hash,'{}'::jsonb,nowtime)
  ON CONFLICT(id) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'status','conflict','show_id',p_show_id); END IF;
 END IF;
 SELECT created_at INTO newest FROM public.wx_studio_show_versions
   WHERE show_id=p_show_id ORDER BY created_at DESC LIMIT 1;
 IF newrev=1 OR p_reason<>'autosave' OR newest IS NULL OR newest<=nowtime-interval '10 minutes' THEN
  INSERT INTO public.wx_studio_show_versions(
    user_id,show_id,rev,doc,reason,protected,name,scene_count,doc_bytes,media_refs,
    doc_hash,device_id,device_name,restored_from_rev,note,created_at)
  VALUES(u,p_show_id,newrev,p_doc,p_reason,p_reason IN ('import','restore','overwrite'),
    title,nsc,bytes,refs,hash,p_device_id,p_device_name,restore_from,note_txt,nowtime);
  result:=jsonb_build_object('ok',true,'status',CASE WHEN newrev=1 THEN 'created' ELSE 'saved' END,
    'show_id',p_show_id,'rev',newrev,'updated_at',nowtime,
    'version_created',true,'replayed',false,'doc_bytes',bytes,'doc_hash',hash,
    'media_state',CASE WHEN local_count=0 THEN 'complete' ELSE 'incomplete' END,
    'local_only_image_count',local_count);
 ELSE
  result:=jsonb_build_object('ok',true,'status','saved','show_id',p_show_id,
    'rev',newrev,'updated_at',nowtime,'version_created',false,'replayed',false,
    'doc_bytes',bytes,'doc_hash',hash,
    'media_state',CASE WHEN local_count=0 THEN 'complete' ELSE 'incomplete' END,
    'local_only_image_count',local_count);
 END IF;
 UPDATE public.wx_studio_shows SET last_op_id=p_op_id,last_op_payload_hash=op_hash,
    last_op_result=result WHERE id=p_show_id;
 WITH ranked AS (
  SELECT id,protected,created_at,
   row_number() OVER(ORDER BY created_at DESC,rev DESC) AS global_rn,
   row_number() OVER(PARTITION BY (created_at AT TIME ZONE 'UTC')::date
     ORDER BY created_at DESC,rev DESC) AS daily_rn
  FROM public.wx_studio_show_versions WHERE show_id=p_show_id
 )
 DELETE FROM public.wx_studio_show_versions v USING ranked r
 WHERE v.id=r.id AND NOT r.protected AND r.global_rn>30
   AND (r.created_at<nowtime-interval '14 days' OR r.daily_rn>1);
 RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION public.wx_studio_delete_show(
 p_show_id uuid,p_base_rev integer,p_device_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=auth.uid(); sh public.wx_studio_shows%ROWTYPE; t timestamptz:=clock_timestamp(); r integer;
BEGIN
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'status','unauthenticated'); END IF;
 IF p_show_id IS NULL OR p_base_rev IS NULL OR p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 1 AND 128 THEN
 RETURN jsonb_build_object('ok',false,'status','invalid'); END IF;
 SELECT * INTO sh FROM public.wx_studio_shows WHERE id=p_show_id FOR UPDATE;
 IF NOT FOUND OR sh.user_id<>u THEN RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;
 IF sh.rev<>p_base_rev THEN RETURN jsonb_build_object('ok',false,'status','conflict',
  'current_rev',sh.rev,'updated_at',sh.updated_at,'device_name',sh.device_name); END IF;
 IF sh.deleted_at IS NOT NULL THEN
  RETURN jsonb_build_object('ok',true,'status','deleted','show_id',p_show_id,'rev',sh.rev,'updated_at',sh.updated_at,'deleted_at',sh.deleted_at); END IF;
 r:=sh.rev+1;
 INSERT INTO public.wx_studio_show_versions(user_id,show_id,rev,doc,reason,protected,name,scene_count,doc_bytes,media_refs,doc_hash,device_id,device_name)
 VALUES(u,p_show_id,sh.rev,sh.doc,'pre-overwrite',true,sh.name,sh.scene_count,sh.doc_bytes,sh.media_refs,sh.doc_hash,sh.device_id,sh.device_name)
 ON CONFLICT(show_id,rev) DO UPDATE SET protected=true;
 UPDATE public.wx_studio_shows SET rev=r,deleted_at=t,updated_at=t,device_id=p_device_id WHERE id=p_show_id;
 RETURN jsonb_build_object('ok',true,'status','deleted','show_id',p_show_id,'rev',r,'updated_at',t,'deleted_at',t);
END $fn$;
CREATE OR REPLACE FUNCTION public.wx_studio_undelete_show(
 p_show_id uuid,p_base_rev integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=auth.uid(); sh public.wx_studio_shows%ROWTYPE; t timestamptz:=clock_timestamp(); r integer;
BEGIN
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'status','unauthenticated'); END IF;
 IF p_show_id IS NULL OR p_base_rev IS NULL THEN RETURN jsonb_build_object('ok',false,'status','invalid'); END IF;
 SELECT * INTO sh FROM public.wx_studio_shows WHERE id=p_show_id FOR UPDATE;
 IF NOT FOUND OR sh.user_id<>u THEN RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;
 IF sh.rev<>p_base_rev THEN RETURN jsonb_build_object('ok',false,'status','conflict',
  'current_rev',sh.rev,'updated_at',sh.updated_at,'device_name',sh.device_name); END IF;
 IF sh.deleted_at IS NULL THEN RETURN jsonb_build_object('ok',true,'status','restored',
  'show_id',p_show_id,'rev',sh.rev,'updated_at',sh.updated_at); END IF;
 r:=sh.rev+1;
 UPDATE public.wx_studio_shows SET rev=r,deleted_at=NULL,updated_at=t WHERE id=p_show_id;
 INSERT INTO public.wx_studio_show_versions(user_id,show_id,rev,doc,reason,protected,name,scene_count,doc_bytes,media_refs,doc_hash,device_id,device_name)
 VALUES(u,p_show_id,r,sh.doc,'undelete',true,sh.name,sh.scene_count,sh.doc_bytes,sh.media_refs,sh.doc_hash,sh.device_id,sh.device_name);
 RETURN jsonb_build_object('ok',true,'status','restored','show_id',p_show_id,'rev',r,'updated_at',t);
END $fn$;

CREATE OR REPLACE FUNCTION public.wx_studio_save_settings(p_patch jsonb,p_device_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=auth.uid(); k text; v jsonb; settings_doc jsonb; prior jsonb; r integer;
 applied jsonb:='[]'::jsonb; ignored jsonb:='[]'::jsonb; reason text; t timestamptz:=clock_timestamp();
BEGIN
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'status','unauthenticated'); END IF;
 IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR octet_length(p_patch::text)>262144 OR
 p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 1 AND 128 THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','patch_invalid'); END IF;
 INSERT INTO public.wx_studio_user_settings(user_id,device_id) VALUES(u,p_device_id)
 ON CONFLICT(user_id) DO NOTHING;
 SELECT settings,rev INTO settings_doc,r FROM public.wx_studio_user_settings WHERE user_id=u FOR UPDATE;
 prior:=settings_doc;
 FOR k,v IN SELECT key,value FROM jsonb_each(p_patch) LOOP
  reason:=NULL;
  IF k NOT IN ('wx.mapbox.token','wx.mapbox.scale','wx.mapbox.nativeScale.v1',
    'wx.studio.defaultMap.v1','wx_bg_default','wx_fxpresets','wx_snap','wx_ov_opt','wx.export.v1') THEN
    reason:='key_not_allowed';
  ELSIF octet_length(v::text)>65536 THEN reason:='value_too_large';
  ELSIF k='wx.mapbox.token' AND v<>'null'::jsonb AND
        (jsonb_typeof(v)<>'string' OR (v #>> '{}') !~ '^pk\.[A-Za-z0-9._-]+$') THEN
    reason:='secret_token_rejected';
  ELSIF k<>'wx.mapbox.token' AND jsonb_typeof(v) NOT IN ('object','array','string','number','boolean','null') THEN
    reason:='invalid_value';
  END IF;
  IF reason IS NOT NULL THEN
   ignored:=ignored||jsonb_build_array(jsonb_build_object('key',k,'code',reason));
  ELSE
   IF v='null'::jsonb THEN settings_doc:=settings_doc-k;
   ELSE settings_doc:=jsonb_set(settings_doc,ARRAY[k],v,true); END IF;
   applied:=applied||to_jsonb(k);
  END IF;
 END LOOP;
 IF octet_length(settings_doc::text)>262144 THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','settings_too_large','max_bytes',262144); END IF;
 IF settings_doc IS DISTINCT FROM prior THEN
  r:=r+1;
  UPDATE public.wx_studio_user_settings SET settings=settings_doc,rev=r,updated_at=t,device_id=p_device_id WHERE user_id=u;
 ELSE
  SELECT updated_at INTO t FROM public.wx_studio_user_settings WHERE user_id=u;
 END IF;
 RETURN jsonb_build_object('ok',true,'status','saved','rev',r,'updated_at',t,
   'applied',applied,'ignored',ignored);
END $fn$;
CREATE OR REPLACE FUNCTION public.wx_studio_set_workspace(
 p_device_id text,p_device_name text,p_show_id uuid,p_scene_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=auth.uid(); t timestamptz:=clock_timestamp();
BEGIN
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'status','unauthenticated'); END IF;
 IF p_device_id IS NULL OR length(p_device_id) NOT BETWEEN 1 AND 128 OR
    p_device_name IS NULL OR length(p_device_name) NOT BETWEEN 1 AND 120 OR
    (p_scene_id IS NOT NULL AND length(p_scene_id)>64) THEN
  RETURN jsonb_build_object('ok',false,'status','invalid','code','workspace_invalid'); END IF;
 IF p_show_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.wx_studio_shows WHERE id=p_show_id AND user_id=u AND deleted_at IS NULL) THEN
   RETURN jsonb_build_object('ok',false,'status','not_found'); END IF;
 INSERT INTO public.wx_studio_workspace(user_id,device_id,device_name,active_show_id,active_scene_id,updated_at)
 VALUES(u,p_device_id,p_device_name,p_show_id,p_scene_id,t)
 ON CONFLICT(user_id,device_id) DO UPDATE SET device_name=EXCLUDED.device_name,
  active_show_id=EXCLUDED.active_show_id,active_scene_id=EXCLUDED.active_scene_id,updated_at=EXCLUDED.updated_at;
 RETURN jsonb_build_object('ok',true,'status','saved','updated_at',t);
END $fn$;

-- Do NOT inherit PostgreSQL default PUBLIC execute on exposed SECURITY DEFINER RPCs.
REVOKE ALL ON FUNCTION public.wx_studio_save_show(uuid,integer,jsonb,text,text,text,integer,uuid,jsonb),
 public.wx_studio_delete_show(uuid,integer,text),
 public.wx_studio_undelete_show(uuid,integer),
 public.wx_studio_save_settings(jsonb,text),
 public.wx_studio_set_workspace(text,text,uuid,text),
 public.wx_studio_register_media(text,text,text,bigint,text,integer,integer)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wx_studio_save_show(uuid,integer,jsonb,text,text,text,integer,uuid,jsonb),
 public.wx_studio_delete_show(uuid,integer,text),
 public.wx_studio_undelete_show(uuid,integer),
 public.wx_studio_save_settings(jsonb,text),
 public.wx_studio_set_workspace(text,text,uuid,text),
 public.wx_studio_register_media(text,text,text,bigint,text,integer,integer)
 TO authenticated;
