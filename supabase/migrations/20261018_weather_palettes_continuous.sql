-- WX Studio weather palette interpolation mode. Safe for existing owner-only palettes.
-- Applied to project lcujugmyyuumrshdasla; false preserves historical stepped color tables.
ALTER TABLE public.wx_studio_weather_palettes
  ADD COLUMN IF NOT EXISTS continuous boolean NOT NULL DEFAULT false;
