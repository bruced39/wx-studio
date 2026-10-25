-- WX Studio v0.10.2: built-in template artwork metadata is additive and
-- does NOT count as a cloud media object. No external objects or credentials used.
-- The entire fixture (including synthetic identity) is rolled back.
BEGIN;
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',true);
DO $check$
DECLARE
 sid uuid:='cccccccc-0000-4000-8000-000000000025';
 doc jsonb;
 result jsonb;
 stored jsonb;
 n integer;
BEGIN
 doc:=jsonb_build_object(
   'cloud_schema',1,'v',1,'name','Built-in template without uploaded media',
   'scenes',jsonb_build_array(jsonb_build_object('id','s1','duration',6,
     'bg',jsonb_build_object('type','image','asset','tpl_storm_night'),
     'objects',jsonb_build_array(
       jsonb_build_object('id','flow1','type','flow','geo',true,'z0',8.2,
         'pts',jsonb_build_array(jsonb_build_array(2,3),jsonb_build_array(4,5)),
         'size',48,'style','chevron')))),
   'assets','{}'::jsonb,
   'builtinAssets',jsonb_build_object('tpl_storm_night',repeat('a',64))
 );
 result:=public.wx_studio_save_show(sid,0,doc,'home','Home PC','manual',1,gen_random_uuid(),'{}');
 IF result->>'status'<>'created' OR result->>'media_state'<>'complete'
  OR (result->>'local_only_image_count')::integer<>0 THEN
   RAISE EXCEPTION 'Built-in metadata rejected or incorrectly counted: %',result;
 END IF;
 SELECT s.doc INTO stored FROM public.wx_studio_shows s WHERE s.id=sid;
 IF stored IS DISTINCT FROM doc THEN RAISE EXCEPTION 'Built-in metadata or scene changed'; END IF;
 SELECT count(*) INTO n FROM public.wx_studio_media;
 IF n<>0 THEN RAISE EXCEPTION 'Built-in image unexpectedly registered as media'; END IF;
END $check$;
ROLLBACK;
