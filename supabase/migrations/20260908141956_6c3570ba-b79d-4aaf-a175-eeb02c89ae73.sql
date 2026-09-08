
CREATE TABLE public.player_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  coins integer NOT NULL DEFAULT 300,
  streak integer NOT NULL DEFAULT 0,
  last_daily date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.player_wallets TO authenticated;
GRANT ALL ON public.player_wallets TO service_role;
ALTER TABLE public.player_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own wallet" ON public.player_wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.cosmetic_catalog (
  id text PRIMARY KEY,
  name text NOT NULL,
  slot text NOT NULL,
  rarity text NOT NULL DEFAULT 'common',
  price integer NOT NULL DEFAULT 100,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0
);
GRANT SELECT ON public.cosmetic_catalog TO anon;
GRANT SELECT ON public.cosmetic_catalog TO authenticated;
GRANT ALL ON public.cosmetic_catalog TO service_role;
ALTER TABLE public.cosmetic_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Catalog is public" ON public.cosmetic_catalog FOR SELECT USING (true);

CREATE TABLE public.player_cosmetics (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);
GRANT SELECT ON public.player_cosmetics TO authenticated;
GRANT ALL ON public.player_cosmetics TO service_role;
ALTER TABLE public.player_cosmetics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own items" ON public.player_cosmetics FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.player_loadout (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  skin jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.player_loadout TO authenticated;
GRANT ALL ON public.player_loadout TO service_role;
ALTER TABLE public.player_loadout ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own loadout" ON public.player_loadout FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own loadout" ON public.player_loadout FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own loadout" ON public.player_loadout FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.custom_cosmetics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  slot text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE, DELETE ON public.custom_cosmetics TO authenticated;
GRANT ALL ON public.custom_cosmetics TO service_role;
ALTER TABLE public.custom_cosmetics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own customs" ON public.custom_cosmetics FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Users update own customs" ON public.custom_cosmetics FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users delete own customs" ON public.custom_cosmetics FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.ensure_wallet()
RETURNS public.player_wallets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.player_wallets;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.player_wallets (user_id) VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO w FROM public.player_wallets WHERE user_id = auth.uid();
  RETURN w;
END; $$;

CREATE OR REPLACE FUNCTION public.claim_daily_reward()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.player_wallets; reward integer; newstreak integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.player_wallets (user_id) VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO w FROM public.player_wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF w.last_daily = CURRENT_DATE THEN
    RETURN jsonb_build_object('claimed', false, 'coins', w.coins, 'streak', w.streak, 'reward', 0);
  END IF;
  IF w.last_daily = CURRENT_DATE - 1 THEN newstreak := LEAST(w.streak + 1, 7); ELSE newstreak := 1; END IF;
  reward := 100 + (newstreak - 1) * 50;
  UPDATE public.player_wallets
    SET coins = coins + reward, streak = newstreak, last_daily = CURRENT_DATE, updated_at = now()
    WHERE user_id = auth.uid()
    RETURNING * INTO w;
  RETURN jsonb_build_object('claimed', true, 'coins', w.coins, 'streak', w.streak, 'reward', reward);
END; $$;

CREATE OR REPLACE FUNCTION public.award_play_coins(_amount integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE amt integer; total integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  amt := GREATEST(0, LEAST(COALESCE(_amount, 0), 60));
  INSERT INTO public.player_wallets (user_id) VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.player_wallets SET coins = coins + amt, updated_at = now()
    WHERE user_id = auth.uid() RETURNING coins INTO total;
  RETURN total;
END; $$;

CREATE OR REPLACE FUNCTION public.purchase_cosmetic(_item_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p integer; bal integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT price INTO p FROM public.cosmetic_catalog WHERE id = _item_id;
  IF p IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown item'); END IF;
  IF EXISTS (SELECT 1 FROM public.player_cosmetics WHERE user_id = auth.uid() AND item_id = _item_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already owned');
  END IF;
  INSERT INTO public.player_wallets (user_id) VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
  SELECT coins INTO bal FROM public.player_wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF bal < p THEN RETURN jsonb_build_object('ok', false, 'error', 'not enough coins'); END IF;
  UPDATE public.player_wallets SET coins = coins - p, updated_at = now() WHERE user_id = auth.uid() RETURNING coins INTO bal;
  INSERT INTO public.player_cosmetics (user_id, item_id) VALUES (auth.uid(), _item_id);
  RETURN jsonb_build_object('ok', true, 'coins', bal);
END; $$;

CREATE OR REPLACE FUNCTION public.craft_custom_cosmetic(_name text, _slot text, _config jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cost integer := 500; bal integer; newid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _slot NOT IN ('hat','shirt','pants') THEN RETURN jsonb_build_object('ok', false, 'error', 'bad slot'); END IF;
  INSERT INTO public.player_wallets (user_id) VALUES (auth.uid()) ON CONFLICT (user_id) DO NOTHING;
  SELECT coins INTO bal FROM public.player_wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF bal < cost THEN RETURN jsonb_build_object('ok', false, 'error', 'not enough coins'); END IF;
  UPDATE public.player_wallets SET coins = coins - cost, updated_at = now() WHERE user_id = auth.uid() RETURNING coins INTO bal;
  INSERT INTO public.custom_cosmetics (owner_id, name, slot, config)
    VALUES (auth.uid(), LEFT(COALESCE(NULLIF(_name,''),'Custom'), 24), _slot, COALESCE(_config,'{}'::jsonb))
    RETURNING id INTO newid;
  RETURN jsonb_build_object('ok', true, 'coins', bal, 'id', newid);
END; $$;

INSERT INTO public.cosmetic_catalog (id, name, slot, rarity, price, config, sort_order) VALUES
('hat_cap',       'Neon Cap',        'hat',   'common',    150, '{"shape":"cap","color":"#22d3ee"}', 1),
('hat_beanie',    'Frost Beanie',    'hat',   'common',    150, '{"shape":"beanie","color":"#f43f5e"}', 2),
('hat_bucket',    'Bucket Hat',      'hat',   'common',    200, '{"shape":"bucket","color":"#84cc16"}', 3),
('hat_headphones','Headphones',      'hat',   'rare',      350, '{"shape":"headphones","color":"#a855f7"}', 4),
('hat_visor',     'Cyber Visor',     'hat',   'rare',      400, '{"shape":"visor","color":"#06b6d4"}', 5),
('hat_cowboy',    'Cowboy Hat',      'hat',   'rare',      450, '{"shape":"cowboy","color":"#b45309"}', 6),
('hat_helmet',    'Combat Helmet',   'hat',   'rare',      450, '{"shape":"helmet","color":"#3f6212"}', 7),
('hat_tophat',    'Top Hat',         'hat',   'epic',      700, '{"shape":"tophat","color":"#111827"}', 8),
('hat_horns',     'Demon Horns',     'hat',   'epic',      800, '{"shape":"horns","color":"#ef4444"}', 9),
('hat_party',     'Party Cone',      'hat',   'epic',      750, '{"shape":"party","color":"#ec4899"}', 10),
('hat_halo',      'Golden Halo',     'hat',   'legendary', 1500, '{"shape":"halo","color":"#fbbf24"}', 11),
('hat_crown',     'Frag Crown',      'hat',   'legendary', 2000, '{"shape":"crown","color":"#fde047"}', 12),
('shirt_recruit', 'Recruit Jersey',  'shirt', 'common',    120, '{"color":"#22d3ee"}', 20),
('shirt_crimson', 'Crimson Vest',    'shirt', 'common',    120, '{"color":"#e11d48"}', 21),
('shirt_toxic',   'Toxic Hoodie',    'shirt', 'rare',      300, '{"color":"#84cc16"}', 22),
('shirt_void',    'Void Jacket',     'shirt', 'epic',      650, '{"color":"#7c3aed"}', 23),
('shirt_gold',    'Gilded Armor',    'shirt', 'legendary', 1600, '{"color":"#facc15"}', 24),
('pants_navy',    'Navy Cargos',     'pants', 'common',    120, '{"color":"#1e3a8a"}', 30),
('pants_camo',    'Camo Pants',      'pants', 'common',    150, '{"color":"#4d7c0f"}', 31),
('pants_neon',    'Neon Trackies',   'pants', 'rare',      320, '{"color":"#f472b6"}', 32),
('pants_shadow',  'Shadow Greaves',  'pants', 'epic',      700, '{"color":"#111827"}', 33),
('pants_plasma',  'Plasma Leggings', 'pants', 'legendary', 1500, '{"color":"#06b6d4"}', 34);
