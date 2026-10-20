-- Resolve the two new Cloud Workspace foreign-key index advisories.
-- Does not alter any existing table data or earlier WX Studio features.
CREATE INDEX wx_studio_versions_show_owner_fk ON public.wx_studio_show_versions(show_id,user_id);
CREATE INDEX wx_studio_workspace_show_owner_fk ON public.wx_studio_workspace(active_show_id,user_id)
 WHERE active_show_id IS NOT NULL;
