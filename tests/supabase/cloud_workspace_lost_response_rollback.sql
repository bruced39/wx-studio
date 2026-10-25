-- WX Studio v0.10.2 lost-response-retry regression.
-- Simulates successfully committed response that a browser never received,
-- followed by a changed local document sent with a new op ID and old baseRev.
-- This test is read/write within one transaction, then rolls back everything.
BEGIN;
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',true);
DO $lost$
DECLARE
 sid uuid:='cccccccc-0000-4444-8888-000000000111';
 op_one uuid:='11111111-1111-4111-8111-111111111111';
 op_two uuid:='22222222-2222-4222-8222-222222222222';
 base jsonb:='{"cloud_schema":1,"v":1,"name":"Draft A","scenes":[{"id":"s1","duration":6}],"assets":{}}';
 changed jsonb; done jsonb; conflict jsonb;
BEGIN
 done:=public.wx_studio_save_show(sid,0,base,'dev1','Home PC','manual',1,op_one,'{}');
 IF done->>'status'<>'created' OR done->>'rev'<>'1' THEN
  RAISE EXCEPTION 'First save not committed: %',done; END IF;
 changed:=jsonb_set(base,'{name}',to_jsonb('Draft B'::text));
 conflict:=public.wx_studio_save_show(sid,0,changed,'dev1','Home PC','autosave',1,op_two,'{}');
 IF conflict->>'status'<>'conflict'
   OR conflict->>'last_op_id'<>op_one::text
   OR conflict->>'current_rev'<>'1'
   OR conflict->>'current_doc_hash' IS NULL THEN
  RAISE EXCEPTION 'Lost reply conflict incorrect: %',conflict; END IF;
 IF (SELECT doc->>'name' FROM public.wx_studio_shows WHERE id=sid)<>'Draft A' THEN
  RAISE EXCEPTION 'Conflict unexpectedly modified saved show'; END IF;
END $lost$;
ROLLBACK;
