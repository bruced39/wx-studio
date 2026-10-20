-- WX Studio v0.10.2: verify cloud schema round-trip of 0.10.1.2/0.10.1.3.
-- Built-in template bytes stay in the deployed client bundle; the cloud document
-- retains the tpl_* background ID, while assets contains no redundant data URL.
-- Flow/jet object types and fit-box text are passed through as JSONB.
-- This creates no persistent user or show; transaction always rolls back.
BEGIN;
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',true);
DO $verify$
DECLARE
  document jsonb;
  result jsonb;
  stored jsonb;
  sid uuid:='cccccccc-0000-4000-8000-000000000343';
BEGIN
  document := jsonb_build_object(
    'cloud_schema',1,'v',1,'name','Templates Flow Jet',
    'scenes',jsonb_build_array(
      jsonb_build_object('id','s1','duration',8,
        'bg',jsonb_build_object('type','image','asset','tpl_hl_sky'),
        'title2',jsonb_build_object('textOnly',true,'region','upper-right','ty',-16),
        'objects',jsonb_build_array(
          jsonb_build_object('id','flow1','type','flow','pts',
            jsonb_build_array(jsonb_build_array(50,100),jsonb_build_array(200,190)),
            'color','#ff0000','size',34,'speed',1.5,'style','glossy'),
          jsonb_build_object('id','jet1','type','jet','pts',
            jsonb_build_array(jsonb_build_array(300,120),jsonb_build_array(800,320)),
            'color','#3fa9ff','width',60,'speed',2,'style','banded'),
          jsonb_build_object('id','text1','type','text',
            'fitBox',true,'autoFit',true,'maxLines',2,'fitH',100,'text','Weather Headlines')
        ))),
    'assets','{}'::jsonb);
  result:=public.wx_studio_save_show(sid,0,document,'dev','Home PC','manual',1,gen_random_uuid(),'{}');
  IF result->>'status'<>'created' THEN
    RAISE EXCEPTION '0.10.1.3 objects rejected: %',result;
  END IF;
  SELECT s.doc INTO stored FROM public.wx_studio_shows s WHERE s.id=sid;
  IF stored IS DISTINCT FROM document THEN
    RAISE EXCEPTION '0.10.1.3 objects were altered during cloud save';
  END IF;
END $verify$;
ROLLBACK;
