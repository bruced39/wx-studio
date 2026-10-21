-- WX Studio: future-proof the pre-v0.10.2 Weather Palettes table for
-- Supabase's 2026-10-30 removal of automatic public-schema Data API grants.
--
-- WX Studio's map presets, private assets and cloud-workspace migrations
-- already grant the intended privileges explicitly. The original weather
-- palettes migration enables RLS and defines authenticated CRUD policies
-- but did not GRANT table privileges; it relied on the former default.
--
-- The client edits only the signed-in user's own palettes; no anonymous
-- Data API table access is required. Existing RLS policies remain intact.
-- Idempotent and safe whether default grants are still enabled or not.
REVOKE ALL ON TABLE public.wx_studio_weather_palettes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
 ON TABLE public.wx_studio_weather_palettes TO authenticated;
