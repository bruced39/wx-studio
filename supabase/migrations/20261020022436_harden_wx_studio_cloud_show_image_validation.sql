-- Replaces only save RPC, preserving objects and existing user data.
-- Fix PostgreSQL NULL handling for local-only markers; block deleted-show replay.
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
   IF a.value ? 'local_only' OR jsonb_typeof(a.value->'media') IS DISTINCT FROM 'string' OR
      (a.value->>'media') !~ '^sha256:[0-9a-f]{64}$' OR
      jsonb_typeof(a.value->'mime') IS DISTINCT FROM 'string' OR
      jsonb_typeof(a.value->'bytes') IS DISTINCT FROM 'number' THEN
    RETURN jsonb_build_object('ok',false,'status','invalid','code','doc_invalid'); END IF;
   IF NOT EXISTS (
     SELECT 1 FROM public.wx_studio_media mm WHERE mm.user_id=u AND mm.kind='image'
      AND mm.sha256=substring(a.value->>'media' FROM 8)
      AND mm.mime=a.value->>'mime'
      AND mm.size_bytes::text=a.value->>'bytes'
   ) THEN RETURN jsonb_build_object('ok',false,'status','invalid','code','media_not_registered'); END IF;
   refs:=array_append(refs,substring(a.value->>'media' FROM 8));
  ELSIF a.value->'local_only' = 'true'::jsonb THEN
   IF a.value ? 'media' OR coalesce(a.value->>'reason','') NOT IN
       ('too_large','mime_not_allowed','upload_failed','unavailable')
      OR jsonb_typeof(a.value->'bytes') IS DISTINCT FROM 'number' OR
      jsonb_typeof(a.value->'mime') IS DISTINCT FROM 'string' OR
      jsonb_typeof(a.value->'source_device_id') IS DISTINCT FROM 'string' OR
      length(coalesce(a.value->>'source_device_id','')) NOT BETWEEN 1 AND 128 OR
      length(coalesce(a.value->>'mime','')) NOT BETWEEN 1 AND 120 OR
      coalesce(a.value->>'bytes','') !~ '^[0-9]{1,12}$' THEN
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
  IF sh.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'status','invalid','code','show_deleted'); END IF;
  IF sh.last_op_id=p_op_id THEN
   IF sh.last_op_payload_hash<>op_hash THEN
    RETURN jsonb_build_object('ok',false,'status','invalid','code','op_id_reused'); END IF;
   RETURN sh.last_op_result || jsonb_build_object('replayed',true);
  END IF;
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

