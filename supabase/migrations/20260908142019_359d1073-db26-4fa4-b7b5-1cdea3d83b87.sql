
REVOKE EXECUTE ON FUNCTION public.ensure_wallet() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.claim_daily_reward() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.award_play_coins(integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.purchase_cosmetic(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.craft_custom_cosmetic(text, text, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.ensure_wallet() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_reward() TO authenticated;
GRANT EXECUTE ON FUNCTION public.award_play_coins(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_cosmetic(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.craft_custom_cosmetic(text, text, jsonb) TO authenticated;
