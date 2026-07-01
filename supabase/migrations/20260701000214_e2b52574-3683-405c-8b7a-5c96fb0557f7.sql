
-- 1) Case-insensitive unique index on usernames
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_key
  ON public.profiles (lower(username));

-- 2) Handler: fall back to suffixed name on collision
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uname TEXT;
  candidate TEXT;
  n INT := 0;
BEGIN
  uname := COALESCE(
    NEW.raw_user_meta_data->>'username',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1),
    'Player' || substr(NEW.id::text, 1, 6)
  );
  candidate := uname;
  -- On collision, append a random 4-digit suffix, up to a few attempts.
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(candidate)) LOOP
    n := n + 1;
    candidate := uname || floor(random() * 9000 + 1000)::text;
    EXIT WHEN n > 6;
  END LOOP;
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (NEW.id, candidate, NEW.raw_user_meta_data->>'avatar_url')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.player_stats (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 3) Public helper for signup form to precheck availability
CREATE OR REPLACE FUNCTION public.check_username_available(candidate TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE lower(username) = lower(candidate)
  );
$$;

GRANT EXECUTE ON FUNCTION public.check_username_available(TEXT) TO anon, authenticated;
