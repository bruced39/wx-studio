-- WX Studio v0.10.2 size and storage RLS regression checks.
-- All fixtures are transient and rolled back, including synthetic auth users.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001'),('bbbbbbbb-0000-0000-0000-000000000002');
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('wx-studio-media',
  'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
  '{"size":12,"mimetype":"image/png"}'::jsonb);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',true);
DO $limits$
DECLARE d jsonb; result jsonb; n integer;
BEGIN
 SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='wx-studio-media';
 IF n<>1 THEN RAISE EXCEPTION 'Storage owner cannot read own object'; END IF;
 d:=jsonb_build_object('cloud_schema',1,'v',1,'name','Oversized',
   'scenes',jsonb_build_array(jsonb_build_object('id','s1','duration',6)),
   'assets','{}'::jsonb,'padding',repeat('X',8388608));
 result:=public.wx_studio_save_show(gen_random_uuid(),0,d,'dev','Home PC','manual',1,gen_random_uuid(),'{}');
 IF result->>'code'<>'doc_too_large' THEN RAISE EXCEPTION '8 MiB cap failed: %',result; END IF;
 result:=public.wx_studio_save_settings('{"wx.mapbox.token":"sk.not_allowed"}','dev');
 IF jsonb_array_length(result->'ignored')<>1 THEN RAISE EXCEPTION 'Secret token rejection failed'; END IF;
 PERFORM set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',true);
 SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='wx-studio-media';
 IF n<>0 THEN RAISE EXCEPTION 'Another account can see private media'; END IF;
END $limits$;
ROLLBACK;
