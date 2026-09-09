import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { DEFAULT_SKIN, readLocalSkin, sanitizeSkin, writeLocalSkin, type PlayerSkin } from "@/lib/cosmetics";

/**
 * The player's equipped look. Signed-in players persist to the backend,
 * guests keep it in this browser.
 */
export function useSkin() {
  const { user, loading } = useAuth();
  const [skin, setSkinState] = useState<PlayerSkin>(DEFAULT_SKIN);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (loading) return;
    (async () => {
      if (!user) {
        if (!cancelled) {
          setSkinState(readLocalSkin());
          setReady(true);
        }
        return;
      }
      const { data } = await supabase.from("player_loadout").select("skin").eq("user_id", user.id).maybeSingle();
      if (cancelled) return;
      setSkinState(data?.skin ? sanitizeSkin(data.skin) : readLocalSkin());
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  const save = useCallback(
    async (next: PlayerSkin) => {
      const clean = sanitizeSkin(next);
      setSkinState(clean);
      writeLocalSkin(clean);
      if (user) {
        await supabase
          .from("player_loadout")
          .upsert({ user_id: user.id, skin: clean as unknown as never, updated_at: new Date().toISOString() });
      }
    },
    [user],
  );

  return { skin, setSkin: save, ready, isGuest: !user };
}
