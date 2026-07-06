
ALTER TABLE public.custom_arenas
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_game_owner(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = uid AND lower(email) = 'totallybro541@gmail.com'
  );
$$;

-- Enforce that only the game owner can create/keep is_official = true rows.
DROP POLICY IF EXISTS "Owners can insert their arenas" ON public.custom_arenas;
CREATE POLICY "Owners can insert their arenas"
  ON public.custom_arenas FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    AND (is_official = false OR public.is_game_owner(auth.uid()))
  );

DROP POLICY IF EXISTS "Owners can update their arenas" ON public.custom_arenas;
CREATE POLICY "Owners can update their arenas"
  ON public.custom_arenas FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (
    auth.uid() = owner_id
    AND (is_official = false OR public.is_game_owner(auth.uid()))
  );

CREATE INDEX IF NOT EXISTS custom_arenas_official_published_idx
  ON public.custom_arenas (is_official, published)
  WHERE is_official AND published;

CREATE INDEX IF NOT EXISTS custom_arenas_owner_idx
  ON public.custom_arenas (owner_id);
