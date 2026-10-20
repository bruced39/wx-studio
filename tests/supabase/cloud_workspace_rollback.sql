-- WX Studio Cloud Workspace v0.10.2 live regression checks.
-- Safe for existing production Supabase: both synthetic auth users, show data and
-- storage metadata live only within this transaction and are ALWAYS ROLLED BACK.
-- Run as a database administrator; SET LOCAL ROLE simulates the Data API caller.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001'),
 ('bbbbbbbb-0000-0000-0000-000000000002');
-- Metadata fixture only, never a real file. The transaction rolls it back.
INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
 ('wx-studio-media',
  'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
  '{"size":12,"mimetype":"image/png"}'::jsonb);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',true);
DO $wxcheck$
DECLARE
 sid uuid:='cccccccc-0000-4444-8888-000000000001';
 h text:=repeat('a',64);
 doc jsonb:='{"cloud_schema":1,"v":1,"name":"Test show","accent":"#abc","bugText":"","logo":null,"scenes":[{"id":"sA","duration":6,"objects":[]}],"assets":{}}';
 candidate jsonb; outcome jsonb; n integer; i integer;
BEGIN
 IF has_table_privilege('authenticated','public.wx_studio_shows','INSERT') OR
    has_table_privilege('authenticated','public.wx_studio_show_versions','DELETE') OR
    has_function_privilege('anon','public.wx_studio_save_show(uuid,integer,jsonb,text,text,text,integer,uuid,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'PRIVILEGES: exposed unsafe write access'; END IF;
 outcome:=public.wx_studio_register_media(h,'image','image/png',12,'fixture.png',100,100);
 IF outcome->>'status'<>'registered' THEN RAISE EXCEPTION 'REGISTER: %',outcome; END IF;
 outcome:=public.wx_studio_register_media(h,'image','image/png',12,'fixture.png',100,100);
 IF outcome->>'status'<>'exists' THEN RAISE EXCEPTION 'REGISTER REPLAY: %',outcome; END IF;
 outcome:=public.wx_studio_register_media(h,'image','image/jpeg',12,'fixture.jpg',100,100);
 IF outcome->>'status'<>'invalid' THEN RAISE EXCEPTION 'MEDIA CONFLICT: %',outcome; END IF;
 candidate:=jsonb_set(doc,'{assets}',jsonb_build_object('logo',jsonb_build_object('media','sha256:'||h,'mime','image/png','bytes',12)));
 outcome:=public.wx_studio_save_show(sid,0,candidate,'dev1','Home PC','import',1,
  '11111111-1111-4111-8111-111111111111','{}');
 IF outcome->>'status'<>'created' OR outcome->>'media_state'<>'complete' OR
    (outcome->>'rev')::integer<>1 THEN RAISE EXCEPTION 'CREATE: %',outcome; END IF;
 outcome:=public.wx_studio_save_show(sid,0,candidate,'dev1','Home PC','import',1,
  '11111111-1111-4111-8111-111111111111','{}');
 IF outcome->>'replayed'<>'true' THEN RAISE EXCEPTION 'REPLAY: %',outcome; END IF;
 outcome:=public.wx_studio_save_show(sid,0,candidate,'dev1','Home PC','import',1,
  '22222222-2222-4222-8222-222222222222','{}');
 IF outcome->>'status'<>'conflict' OR outcome->>'last_op_id' IS NULL OR
    outcome->>'current_doc_hash' IS NULL THEN RAISE EXCEPTION 'CONFLICT: %',outcome; END IF;
 outcome:=public.wx_studio_save_show(sid,0,candidate,'dev1','Home PC','import',1,
  '11111111-1111-4111-8111-111111111111','{"note":"changed"}');
 IF outcome->>'code'<>'op_id_reused' THEN RAISE EXCEPTION 'OP REUSE: %',outcome; END IF;
 candidate:=jsonb_set(doc,'{assets}','{"x":{"local_only":true,"bytes":100,"mime":"image/png","source_device_id":"dev1"}}');
 outcome:=public.wx_studio_save_show(sid,1,candidate,'dev1','Home PC','manual',1,gen_random_uuid(),'{}');
 IF outcome->>'status'<>'invalid' THEN RAISE EXCEPTION 'MISSING REASON ACCEPTED: %',outcome; END IF;
 candidate:=jsonb_set(doc,'{assets}','{"x":{"local_only":true,"reason":"other","bytes":100,"mime":"image/png","source_device_id":"dev1"}}');
 outcome:=public.wx_studio_save_show(sid,1,candidate,'dev1','Home PC','manual',1,gen_random_uuid(),'{}');
 IF outcome->>'status'<>'invalid' THEN RAISE EXCEPTION 'INVALID REASON ACCEPTED: %',outcome; END IF;
 candidate:=jsonb_set(doc,'{assets}',jsonb_build_object('x',jsonb_build_object('media','sha256:'||repeat('b',64),'mime','image/png','bytes',5)));
 outcome:=public.wx_studio_save_show(sid,1,candidate,'dev1','Home PC','manual',1,gen_random_uuid(),'{}');
 IF outcome->>'code'<>'media_not_registered' THEN RAISE EXCEPTION 'UNREGISTERED MEDIA: %',outcome; END IF;
 candidate:=jsonb_set(doc,'{assets}','{"x":{"local_only":true,"reason":"upload_failed","bytes":100,"mime":"image/png","source_device_id":"dev1"}}');
 outcome:=public.wx_studio_save_show(sid,1,candidate,'dev1','Home PC','autosave',1,gen_random_uuid(),'{}');
 IF outcome->>'status'<>'saved' OR outcome->>'media_state'<>'incomplete' OR
    (outcome->>'local_only_image_count')::int<>1 THEN RAISE EXCEPTION 'PARTIAL SAVE: %',outcome; END IF;
 SELECT count(*) INTO n FROM public.wx_studio_show_versions WHERE show_id=sid;
 IF n<>1 THEN RAISE EXCEPTION 'AUTOSAVE HISTORY TOO DENSE: %',n; END IF;
 outcome:=public.wx_studio_save_show(sid,2,doc,'dev1','Home PC','overwrite',1,gen_random_uuid(),'{}');
 IF outcome->>'status'<>'saved' THEN RAISE EXCEPTION 'OVERWRITE: %',outcome; END IF;
 SELECT count(*) INTO n FROM public.wx_studio_show_versions WHERE show_id=sid AND protected;
 IF n<2 THEN RAISE EXCEPTION 'PROTECTED RECOVERY LOST: %',n; END IF;
 outcome:=public.wx_studio_save_settings('{"wx.mapbox.token":"pk.test_key","invalid.key":"x","wx_snap":true}','dev1');
 IF outcome->>'status'<>'saved' OR jsonb_array_length(outcome->'ignored')<>1 THEN RAISE EXCEPTION 'SETTINGS: %',outcome; END IF;
 outcome:=public.wx_studio_save_settings('{"wx.mapbox.token":"sk.secret"}','dev1');
 IF jsonb_array_length(outcome->'ignored')<>1 THEN RAISE EXCEPTION 'SECRET ALLOWED: %',outcome; END IF;
 outcome:=public.wx_studio_set_workspace('dev1','Home PC',sid,'new-scene-not-yet-synced');
 IF outcome->>'status'<>'saved' THEN RAISE EXCEPTION 'WORKSPACE: %',outcome; END IF;
 FOR i IN 1..36 LOOP
  doc:=jsonb_set(doc,'{name}',to_jsonb('Version '||i));
  outcome:=public.wx_studio_save_show(sid,2+i,doc,'dev1','Home PC','manual',1,gen_random_uuid(),'{}');
  -- first iteration starts from revision 3
  IF outcome->>'status'<>'saved' THEN RAISE EXCEPTION 'REVISION %: %',i,outcome; END IF;
 END LOOP;
 SELECT count(*) INTO n FROM public.wx_studio_show_versions WHERE show_id=sid AND NOT protected;
 IF n>30 THEN RAISE EXCEPTION 'HISTORY PRUNING FAILED: %',n; END IF;
 SELECT count(*) INTO n FROM public.wx_studio_show_versions WHERE show_id=sid AND protected;
 IF n<2 THEN RAISE EXCEPTION 'HISTORY PRUNED PROTECTED ROWS: %',n; END IF;
 outcome:=public.wx_studio_delete_show(sid,39,'dev1');
 IF outcome->>'status'<>'deleted' OR (outcome->>'rev')::int<>40 THEN RAISE EXCEPTION 'DELETE: %',outcome; END IF;
 outcome:=public.wx_studio_undelete_show(sid,40);
 IF outcome->>'status'<>'restored' OR (outcome->>'rev')::int<>41 THEN RAISE EXCEPTION 'UNDELETE: %',outcome; END IF;
 outcome:=public.wx_studio_save_show(sid,0,candidate,'dev1','Home PC','import',1,
  '11111111-1111-4111-8111-111111111111','{}');
 IF outcome->>'status'<>'conflict' THEN RAISE EXCEPTION 'STALE OP REPLAYED AFTER RESTORE: %',outcome; END IF;
 PERFORM set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',true);
 SELECT count(*) INTO n FROM public.wx_studio_shows WHERE id=sid;
 IF n<>0 THEN RAISE EXCEPTION 'CROSS USER SHOW LEAK'; END IF;
 SELECT count(*) INTO n FROM public.wx_studio_show_versions WHERE show_id=sid;
 IF n<>0 THEN RAISE EXCEPTION 'CROSS USER VERSION LEAK'; END IF;
 SELECT count(*) INTO n FROM public.wx_studio_media WHERE sha256=h;
 IF n<>0 THEN RAISE EXCEPTION 'CROSS USER MEDIA LEAK'; END IF;
 outcome:=public.wx_studio_delete_show(sid,41,'dev2');
 IF outcome->>'status'<>'not_found' THEN RAISE EXCEPTION 'CROSS USER DELETE: %',outcome; END IF;
 outcome:=public.wx_studio_save_show(sid,41,doc,'dev2','Office PC','manual',1,gen_random_uuid(),'{}');
 IF outcome->>'status'<>'not_found' THEN RAISE EXCEPTION 'CROSS USER SAVE: %',outcome; END IF;
 outcome:=public.wx_studio_set_workspace('dev2','Office PC',sid,'sA');
 IF outcome->>'status'<>'not_found' THEN RAISE EXCEPTION 'CROSS USER WORKSPACE: %',outcome; END IF;
 outcome:=public.wx_studio_register_media(h,'image','image/png',12,'fixture.png',100,100);
 IF outcome->>'code'<>'object_missing' THEN RAISE EXCEPTION 'CROSS USER MEDIA REGISTRATION: %',outcome; END IF;
END $wxcheck$;
ROLLBACK;
