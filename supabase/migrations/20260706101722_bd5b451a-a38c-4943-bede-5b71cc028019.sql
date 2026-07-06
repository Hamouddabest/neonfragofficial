
REVOKE ALL ON FUNCTION public.is_game_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_game_owner(uuid) TO authenticated, service_role;
