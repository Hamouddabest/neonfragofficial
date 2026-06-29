CREATE TABLE public.custom_arenas (
  room_id TEXT PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  spawn_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.custom_arenas TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_arenas TO authenticated;
GRANT ALL ON public.custom_arenas TO service_role;

ALTER TABLE public.custom_arenas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Custom arenas are publicly readable"
  ON public.custom_arenas FOR SELECT
  USING (true);

CREATE POLICY "Owners can insert their arenas"
  ON public.custom_arenas FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update their arenas"
  ON public.custom_arenas FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can delete their arenas"
  ON public.custom_arenas FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

CREATE TRIGGER touch_custom_arenas_updated_at
  BEFORE UPDATE ON public.custom_arenas
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();