-- Invalidate a prior save operation token whenever soft-delete state changes.
-- This prevents reusing stale successful save responses after undelete.
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
 UPDATE public.wx_studio_shows SET rev=r,deleted_at=t,updated_at=t,device_id=p_device_id,
 last_op_id=gen_random_uuid(),last_op_payload_hash=repeat('0',64),
 last_op_result='{}'::jsonb WHERE id=p_show_id;
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
 UPDATE public.wx_studio_shows SET rev=r,deleted_at=NULL,updated_at=t,
 last_op_id=gen_random_uuid(),last_op_payload_hash=repeat('0',64),
 last_op_result='{}'::jsonb WHERE id=p_show_id;
 INSERT INTO public.wx_studio_show_versions(user_id,show_id,rev,doc,reason,protected,name,scene_count,doc_bytes,media_refs,doc_hash,device_id,device_name)
 VALUES(u,p_show_id,r,sh.doc,'undelete',true,sh.name,sh.scene_count,sh.doc_bytes,sh.media_refs,sh.doc_hash,sh.device_id,sh.device_name);
 RETURN jsonb_build_object('ok',true,'status','restored','show_id',p_show_id,'rev',r,'updated_at',t);
END $fn$;

