-- WX Studio v0.10.2: additive Title Banner #2 fields survive cloud JSONB save.
-- Safe on the live project: both fixture identity and show roll back.
BEGIN;
INSERT INTO auth.users (id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',true);
DO $test$
DECLARE
  doc jsonb;
  saved jsonb;
  returned jsonb;
  sid uuid:='cccccccc-0000-4000-8000-000000000222';
BEGIN
  doc:=jsonb_build_object(
    'cloud_schema',1,'v',1,'name','Banner #2 roundtrip',
    'scenes',jsonb_build_array(jsonb_build_object(
       'id','s1','duration',6,'title2',jsonb_build_object(
         'show',true,'dx',-73,'autoWidth',true,'height',154,
         'minW',750,'text','NOR''EASTER WATCH'))),
    'assets','{}'::jsonb
  );
  returned:=public.wx_studio_save_show(sid,0,doc,'home','Home PC','manual',1,gen_random_uuid(),'{}');
  IF returned->>'status'<>'created' THEN
    RAISE EXCEPTION 'New banner fields rejected by RPC: %',returned;
  END IF;
  SELECT s.doc INTO saved FROM public.wx_studio_shows s WHERE s.id=sid;
  IF saved->'scenes'->0->'title2' IS DISTINCT FROM doc->'scenes'->0->'title2' THEN
    RAISE EXCEPTION 'Title banner properties changed during persistence';
  END IF;
END $test$;
ROLLBACK;
